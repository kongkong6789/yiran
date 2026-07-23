from __future__ import annotations

from copy import deepcopy

from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.ontology.registry import get_action

from .models import AuditLog, TaskTemplate
from .organizations import ensure_current_organization, is_organization_admin


BUILTIN_TEMPLATES = [
    {
        "key": "daily-ops-report", "name": "每日运营日报", "description": "汇总核心经营指标、异常波动和待跟进事项。",
        "category": "report", "actionName": "report.generate", "prompt": "帮我生成昨天的运营日报，并给出需要跟进的建议。",
        "defaults": {"output_type": "daily_report", "scope": "all", "brand_ids": []}, "tags": ["日报", "经营概览"], "estimatedMinutes": 8,
    },
    {
        "key": "weekly-sales-review", "name": "销售周报", "description": "按渠道和品牌复盘本周销售表现与异常。",
        "category": "report", "actionName": "report.generate", "prompt": "帮我生成本周销售周报，对比关键指标变化并给出建议。",
        "defaults": {"output_type": "weekly_report", "scope": "all", "brand_ids": []}, "tags": ["周报", "销售"], "estimatedMinutes": 12,
    },
    {
        "key": "monthly-business-review", "name": "经营月报", "description": "形成月度经营总结、风险和下月行动建议。",
        "category": "report", "actionName": "report.generate", "prompt": "帮我生成本月经营月报，覆盖销售、异常和行动建议。",
        "defaults": {"output_type": "monthly_report", "scope": "all", "brand_ids": []}, "tags": ["月报", "经营复盘"], "estimatedMinutes": 15,
    },
    {
        "key": "inventory-risk-scan", "name": "库存风险巡检", "description": "识别低库存、滞销和周转异常 SKU。",
        "category": "analysis", "actionName": "inventory.reorder.shadow", "prompt": "请做库存补货分析，识别库存风险并给出只读建议。",
        "defaults": {}, "tags": ["库存", "风险"], "estimatedMinutes": 10,
    },
]

CATEGORIES = set(TaskTemplate.Category.values)
VISIBILITIES = set(TaskTemplate.Visibility.values)


def _builtin_payload(item: dict) -> dict:
    return {
        **deepcopy(item), "description": item.get("description", ""), "outputConfig": {}, "assignmentConfig": {},
        "visibility": "workspace", "builtin": True, "overridden": False, "canEdit": True, "canReset": False,
        "createdBy": None, "updatedAt": None,
    }


def _row_payload(row: TaskTemplate, user, *, exposed_key: str | None = None, builtin: bool = False) -> dict:
    can_edit = row.created_by_id == user.id or is_organization_admin(user, row.organization)
    return {
        "id": row.id, "key": exposed_key or str(row.template_key), "name": row.name, "description": row.description,
        "category": row.category, "actionName": row.action_name, "prompt": row.prompt,
        "defaults": row.defaults, "outputConfig": row.output_config, "assignmentConfig": row.assignment_config,
        "tags": row.tags, "estimatedMinutes": row.estimated_minutes, "visibility": row.visibility,
        "builtin": builtin, "overridden": builtin, "canReset": builtin and can_edit, "canEdit": can_edit,
        "createdBy": row.created_by.get_full_name() or row.created_by.username,
        "updatedAt": row.updated_at.isoformat(),
    }


def _effective_builtin_payload(item: dict, row: TaskTemplate | None, user) -> dict:
    if not row:
        return _builtin_payload(item)
    return _row_payload(row, user, exposed_key=item["key"], builtin=True)


def _validate_payload(data: dict, current: TaskTemplate | None = None) -> dict:
    def value(camel: str, snake: str, fallback):
        return data.get(camel, data.get(snake, fallback))

    name = str(value("name", "name", current.name if current else "")).strip()[:128]
    description = str(value("description", "description", current.description if current else "")).strip()[:300]
    category = str(value("category", "category", current.category if current else TaskTemplate.Category.REPORT))
    action_name = str(value("actionName", "action_name", current.action_name if current else "report.generate")).strip()
    prompt = str(value("prompt", "prompt", current.prompt if current else "")).strip()
    defaults = value("defaults", "defaults", current.defaults if current else {})
    output_config = value("outputConfig", "output_config", current.output_config if current else {})
    assignment_config = value("assignmentConfig", "assignment_config", current.assignment_config if current else {})
    tags = value("tags", "tags", current.tags if current else [])
    visibility = str(value("visibility", "visibility", current.visibility if current else TaskTemplate.Visibility.PERSONAL))
    estimated_minutes = value("estimatedMinutes", "estimated_minutes", current.estimated_minutes if current else 10)
    if not name or not prompt:
        raise ValueError("模板名称和任务描述不能为空。")
    if category not in CATEGORIES:
        raise ValueError("模板分类无效。")
    if visibility not in VISIBILITIES:
        raise ValueError("模板可见范围无效。")
    action = get_action(action_name)
    if not action:
        raise ValueError("绑定的任务类型不存在。")
    if not isinstance(defaults, dict) or not isinstance(output_config, dict) or not isinstance(assignment_config, dict):
        raise ValueError("模板配置必须是对象。")
    if not isinstance(tags, list):
        raise ValueError("模板标签必须是数组。")
    try:
        estimated_minutes = max(1, min(240, int(estimated_minutes)))
    except (TypeError, ValueError):
        raise ValueError("预计耗时必须是数字。")
    # 模板只能提供默认值，不能修改动作契约、角色、审批或风险等级。
    return {
        "name": name, "description": description, "category": category, "action_name": action_name,
        "prompt": prompt, "defaults": defaults, "output_config": output_config,
        "assignment_config": assignment_config, "tags": [str(tag).strip()[:32] for tag in tags if str(tag).strip()][:12],
        "visibility": visibility, "estimated_minutes": estimated_minutes,
    }


def _visible_rows(user, organization):
    return TaskTemplate.objects.select_related("created_by", "organization").filter(
        organization=organization, is_active=True,
    ).filter(Q(visibility=TaskTemplate.Visibility.WORKSPACE) | Q(created_by=user))


def _find_template(user, organization, template_key: str):
    builtin = next((item for item in BUILTIN_TEMPLATES if item["key"] == template_key), None)
    if builtin:
        override = _visible_rows(user, organization).filter(builtin_key=template_key).first()
        return builtin, override
    return None, _visible_rows(user, organization).filter(template_key=template_key).first()


def _audit(user, action: str, payload: dict, result: dict):
    AuditLog.objects.create(
        trace_id=f"task-template-{action}-{user.id}", actor=user.username, intent="管理任务模板",
        action=f"task_template.{action}", payload=payload, decision=AuditLog.Decision.ALLOW, result=result,
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def task_templates(request):
    organization = ensure_current_organization(request.user)
    if request.method == "GET":
        visible = _visible_rows(request.user, organization)
        overrides = {row.builtin_key: row for row in visible.filter(builtin_key__isnull=False)}
        rows = [_effective_builtin_payload(item, overrides.get(item["key"]), request.user) for item in BUILTIN_TEMPLATES]
        rows.extend(_row_payload(row, request.user) for row in visible.filter(builtin_key__isnull=True))
        return Response({"results": rows})
    try:
        values = _validate_payload(request.data)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    row = TaskTemplate.objects.create(
        organization=organization, created_by=request.user, updated_by=request.user, **values,
    )
    _audit(request.user, "create", {"template_key": str(row.template_key)}, {"created": True})
    return Response(_row_payload(row, request.user), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def task_template_detail(request, template_key: str):
    organization = ensure_current_organization(request.user)
    builtin, row = _find_template(request.user, organization, template_key)
    if builtin:
        if request.method == "GET":
            return Response(_effective_builtin_payload(builtin, row, request.user))
        if row and row.created_by_id != request.user.id and not is_organization_admin(request.user, organization):
            return Response({"error": "没有权限管理该工作区模板。"}, status=status.HTTP_403_FORBIDDEN)
        if request.method == "DELETE":
            if not row:
                return Response({"error": "该模板当前使用系统默认配置。"}, status=status.HTTP_400_BAD_REQUEST)
            row.delete()
            _audit(request.user, "reset", {"template_key": template_key}, {"restored_builtin": True})
            return Response(status=status.HTTP_204_NO_CONTENT)
        source = _effective_builtin_payload(builtin, row, request.user)
        try:
            values = _validate_payload({**source, **request.data})
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        # 系统模板的覆盖版本始终属于当前工作区，不能改成个人模板。
        values["visibility"] = TaskTemplate.Visibility.WORKSPACE
        if row:
            for field, value in values.items():
                setattr(row, field, value)
            row.updated_by = request.user
            row.save()
        else:
            row = TaskTemplate.objects.create(
                organization=organization,
                builtin_key=template_key,
                created_by=request.user,
                updated_by=request.user,
                **values,
            )
        _audit(request.user, "override", {"template_key": template_key}, {"overridden": True})
        return Response(_effective_builtin_payload(builtin, row, request.user))
    if not row:
        return Response({"error": "任务模板不存在。"}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(_row_payload(row, request.user))
    if row.created_by_id != request.user.id and not is_organization_admin(request.user, organization):
        return Response({"error": "没有权限管理该模板。"}, status=status.HTTP_403_FORBIDDEN)
    if request.method == "DELETE":
        row.is_active = False
        row.updated_by = request.user
        row.save(update_fields=["is_active", "updated_by", "updated_at"])
        _audit(request.user, "delete", {"template_key": template_key}, {"deleted": True})
        return Response(status=status.HTTP_204_NO_CONTENT)
    try:
        values = _validate_payload(request.data, row)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    for field, value in values.items():
        setattr(row, field, value)
    row.updated_by = request.user
    row.save()
    _audit(request.user, "update", {"template_key": template_key}, {"updated": True})
    return Response(_row_payload(row, request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def task_template_duplicate(request, template_key: str):
    organization = ensure_current_organization(request.user)
    builtin, row = _find_template(request.user, organization, template_key)
    if not builtin and not row:
        return Response({"error": "任务模板不存在。"}, status=status.HTTP_404_NOT_FOUND)
    source = _builtin_payload(builtin) if builtin else _row_payload(row, request.user)
    values = _validate_payload({
        **source, "name": str(request.data.get("name") or f"{source['name']} 副本")[:128],
        "visibility": request.data.get("visibility") or TaskTemplate.Visibility.PERSONAL,
    })
    copy = TaskTemplate.objects.create(
        organization=organization, created_by=request.user, updated_by=request.user, **values,
    )
    _audit(request.user, "duplicate", {"source": template_key}, {"template_key": str(copy.template_key)})
    return Response(_row_payload(copy, request.user), status=status.HTTP_201_CREATED)
