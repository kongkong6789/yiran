from __future__ import annotations

from copy import deepcopy
import json
import re

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.organizations import ensure_current_organization, is_organization_admin
from apps.council import llm
from apps.ontology.registry import get_action

from .models import SopDefinition, SopVersion
from .sop_schema import graph_hash, validate_graph


def _extract_json_object(text: str) -> dict:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise ValueError("AI 未返回可解析的 SOP 结构。")
        value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise ValueError("AI 返回的 SOP 结构必须是 JSON 对象。")
    return value


def _fallback_rewrite(instruction: str, draft: dict) -> dict:
    """LLM 未配置时仍允许用自然语言完成常见的流程增删。"""
    result = deepcopy(draft)
    graph = deepcopy(result.get("graph") or {})
    nodes = list(graph.get("nodes") or [])
    edges = list(graph.get("edges") or [])
    terminal = str((graph.get("terminals") or ["finish"])[0])
    if any(word in instruction for word in ("人工确认", "审批", "人工审核")) and not any(node.get("type") == "checkpoint" for node in nodes):
        new_key = "confirm.result"
        insert_at = max(0, len(nodes) - 1)
        nodes.insert(insert_at, {"key": new_key, "type": "checkpoint", "title": "人工确认结果", "config": {"detail": "等待负责人确认后继续"}})
        incoming = [edge for edge in edges if edge.get("target") == terminal]
        for edge in incoming:
            edge["target"] = new_key
        edges.append({"source": new_key, "target": terminal, "condition": "always", "priority": 1})
    if any(word in instruction for word in ("失败", "异常", "兜底")) and not any(node.get("type") == "handoff" for node in nodes):
        key = "handoff.failure"
        nodes.append({"key": key, "type": "handoff", "title": "异常转人工处理", "config": {"message": "自动处理失败，请人工接管"}})
        execute = next((node for node in nodes if node.get("type") == "execute_action"), None)
        if execute:
            edges.append({"source": execute["key"], "target": key, "condition": "decision:block", "priority": 2})
        graph["terminals"] = list(dict.fromkeys([*(graph.get("terminals") or []), key]))
    graph["nodes"], graph["edges"] = nodes, edges
    result["graph"] = validate_graph(graph)
    return {"assistant": "已根据你的描述更新流程草稿。你可以继续告诉我需要增加、删除或调整的步骤。", "draft": result, "model": "local-rules"}


def _visible_sops(organization):
    return SopDefinition.objects.filter(Q(organization=organization) | Q(organization__isnull=True)).order_by(
        "business_domain", "name"
    )


def _find_sop(organization, sop_key: str):
    return _visible_sops(organization).filter(sop_key=sop_key).order_by("organization_id").last()


def _can_edit(sop: SopDefinition, user) -> bool:
    return bool(sop.organization_id and (sop.created_by_id == user.id or is_organization_admin(user, sop.organization)))


def _version_payload(row: SopVersion, *, include_graph: bool = True) -> dict:
    payload = {
        "id": row.id,
        "version": row.version,
        "status": row.status,
        "contentHash": row.content_hash,
        "changeSummary": row.change_summary,
        "triggerIntents": row.trigger_intents,
        "utteranceExamples": row.utterance_examples,
        "publishedAt": row.published_at.isoformat() if row.published_at else None,
        "createdAt": row.created_at.isoformat(),
    }
    if include_graph:
        payload.update({"graph": row.graph, "inputSchema": row.input_schema, "outputSchema": row.output_schema})
    return payload


def _sop_payload(row: SopDefinition, user, *, include_graph: bool = False) -> dict:
    current = row.versions.filter(version=row.current_version).first() if row.current_version else row.versions.first()
    editable = _can_edit(row, user)
    draft = row.versions.filter(status=SopVersion.Status.DRAFT).order_by("-created_at").first() if editable else None
    selected = draft or current
    success_rate = round((row.success_count / row.call_count) * 100, 1) if row.call_count else 0
    payload = {
        "id": row.id,
        "key": row.sop_key,
        "name": row.name,
        "businessDomain": row.business_domain,
        "description": row.description,
        "actionName": row.action_name,
        "status": row.status,
        "currentVersion": row.current_version,
        "system": row.is_system,
        "canEdit": editable,
        "hasDraft": bool(draft),
        "draftVersion": draft.version if draft else None,
        "callCount": row.call_count,
        "successRate": success_rate,
        "nodeCount": len((selected.graph or {}).get("nodes") or []) if selected else 0,
        "updatedAt": row.updated_at.isoformat(),
    }
    if include_graph and selected:
        payload["version"] = _version_payload(selected)
    return payload


def _version_values(data: dict, *, fallback: SopVersion | None = None) -> dict:
    graph = validate_graph(data.get("graph", fallback.graph if fallback else {}))
    input_schema = data.get("inputSchema", data.get("input_schema", fallback.input_schema if fallback else {}))
    output_schema = data.get("outputSchema", data.get("output_schema", fallback.output_schema if fallback else {}))
    triggers = data.get("triggerIntents", data.get("trigger_intents", fallback.trigger_intents if fallback else []))
    examples = data.get("utteranceExamples", data.get("utterance_examples", fallback.utterance_examples if fallback else []))
    if not isinstance(input_schema, dict) or not isinstance(output_schema, dict):
        raise ValueError("输入与输出 Schema 必须是 JSON 对象。")
    if not isinstance(triggers, list) or not isinstance(examples, list):
        raise ValueError("触发意图和示例指令必须是数组。")
    return {
        "graph": graph,
        "input_schema": input_schema,
        "output_schema": output_schema,
        "trigger_intents": [str(item).strip()[:120] for item in triggers if str(item).strip()][:30],
        "utterance_examples": [str(item).strip()[:300] for item in examples if str(item).strip()][:30],
        "change_summary": str(data.get("changeSummary", data.get("change_summary", fallback.change_summary if fallback else "")))[:300],
        "content_hash": graph_hash(graph=graph, input_schema=input_schema, output_schema=output_schema, trigger_intents=triggers, examples=examples),
    }


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_ai_rewrite(request):
    ensure_current_organization(request.user)
    instruction = str(request.data.get("instruction") or "").strip()
    draft = request.data.get("draft") or {}
    history = request.data.get("history") or []
    if not instruction:
        return Response({"error": "请输入你希望 AI 如何创建或修改 SOP。"}, status=400)
    if not isinstance(draft, dict) or not isinstance(history, list):
        return Response({"error": "SOP 草稿或对话历史格式错误。"}, status=400)
    current_graph = draft.get("graph") or {}
    try:
        validate_graph(current_graph)
    except ValueError as exc:
        return Response({"error": f"当前流程无法交给 AI 修改：{exc}"}, status=400)

    if not llm.llm_available(request.user):
        try:
            return Response(_fallback_rewrite(instruction, draft))
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)

    system = """你是企业 SOP 流程设计师。根据用户指令修改当前 SOP 草稿，只返回一个 JSON 对象，禁止 Markdown。
返回字段必须为 assistant、key、name、businessDomain、description、actionName、triggerIntents、utteranceExamples、graph。新建 SOP 时生成稳定的英文 key；修改已有 SOP 时必须保留原 key。
graph 必须含 start、terminals、nodes、edges。节点字段：key、type、title、config。
节点 type 仅允许 collect_info、checkpoint、execute_action、gate、handoff、end。
边字段：source、target、condition、priority。condition 仅允许 always、result_ok、result_failed、decision:<值>、field_present:<字段>、field_missing:<字段>。
必须保留用户没有要求修改的内容；节点 key 稳定且使用小写英文、数字、点、下划线或短横线；至少一个终止节点；不要生成环。
execute_action 的 action_name 优先沿用现有 actionName，不能凭空创造不存在的系统能力。assistant 用简短中文说明本次修改以及仍需用户确认的信息。"""
    compact_history = [
        {"role": str(item.get("role") or "user"), "content": str(item.get("content") or "")[:1000]}
        for item in history[-8:] if isinstance(item, dict)
    ]
    messages = [
        *compact_history,
        {"role": "user", "content": json.dumps({"instruction": instruction, "currentDraft": draft}, ensure_ascii=False)},
    ]
    result = llm.chat_messages_result(
        system, messages, temperature=0.15, max_tokens=3000, timeout=60,
        llm_user=request.user, allow_images=False,
    )
    if not result.get("content"):
        raw_error = str(result.get("error") or "")
        if "HTTP 400" in raw_error or "invalid_request_error" in raw_error:
            user_error = "当前账户选择的模型与接口不兼容，请在个人设置中检查模型名称。"
        elif "timeout" in raw_error.lower():
            user_error = "AI 生成流程超时，请稍后重试或简化本次修改要求。"
        else:
            user_error = "AI 暂时没有返回可用的 SOP 草稿，请稍后重试。"
        return Response({"error": user_error}, status=502)
    try:
        generated = _extract_json_object(str(result["content"]))
        graph = validate_graph(generated.get("graph") or current_graph)
    except (ValueError, json.JSONDecodeError):
        repair = llm.chat_messages_result(
            "修复下面的 SOP JSON。只返回语法正确的完整 JSON 对象，不要 Markdown，不要解释，不要改变业务含义。",
            [{"role": "user", "content": str(result["content"])[:12000]}],
            temperature=0, max_tokens=3500, timeout=45, llm_user=request.user, allow_images=False,
        )
        try:
            generated = _extract_json_object(str(repair.get("content") or ""))
            graph = validate_graph(generated.get("graph") or current_graph)
        except (ValueError, json.JSONDecodeError):
            return Response({"error": "AI 返回的流程结构不完整，请重新发送一次或把要求拆成两步修改。"}, status=422)
    action_name = str(generated.get("actionName") or draft.get("actionName") or "").strip()
    if action_name and not get_action(action_name):
        action_name = str(draft.get("actionName") or "")
    proposed_key = str(draft.get("key") or generated.get("key") or "").strip()
    if proposed_key and not re.fullmatch(r"[a-z][a-z0-9_.-]{1,95}", proposed_key):
        proposed_key = ""
    revised = {
        "key": proposed_key,
        "version": str(draft.get("version") or "1.0.0"),
        "name": str(generated.get("name") or draft.get("name") or "新建 SOP")[:128],
        "businessDomain": str(generated.get("businessDomain") or draft.get("businessDomain") or "")[:64],
        "description": str(generated.get("description") or draft.get("description") or "")[:500],
        "actionName": action_name[:96],
        "triggerIntents": list(generated.get("triggerIntents") or draft.get("triggerIntents") or [])[:30],
        "utteranceExamples": list(generated.get("utteranceExamples") or draft.get("utteranceExamples") or [])[:30],
        "graph": graph,
    }
    return Response({
        "assistant": str(generated.get("assistant") or "已更新 SOP 流程草稿。")[:1200],
        "draft": revised,
        "model": result.get("model") or "",
    })


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def sops(request):
    organization = ensure_current_organization(request.user)
    if request.method == "GET":
        return Response({"results": [_sop_payload(row, request.user) for row in _visible_sops(organization)]})
    data = request.data
    key = str(data.get("key") or data.get("sopKey") or "").strip()
    name = str(data.get("name") or "").strip()
    version_number = str(data.get("version") or "1.0.0").strip()
    action_name = str(data.get("actionName") or "").strip()
    if not key or not name:
        return Response({"error": "SOP ID 和名称不能为空。"}, status=400)
    if action_name and not get_action(action_name):
        return Response({"error": "绑定的动作契约不存在。"}, status=400)
    if SopDefinition.objects.filter(organization=organization, sop_key=key).exists():
        return Response({"error": "当前工作区已存在相同 SOP ID。"}, status=400)
    try:
        values = _version_values(data)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    with transaction.atomic():
        sop = SopDefinition.objects.create(
            organization=organization,
            sop_key=key,
            name=name[:128],
            business_domain=str(data.get("businessDomain") or "")[:64],
            description=str(data.get("description") or "")[:500],
            action_name=action_name,
            created_by=request.user,
            updated_by=request.user,
        )
        SopVersion.objects.create(definition=sop, version=version_number, created_by=request.user, **values)
    return Response(_sop_payload(sop, request.user, include_graph=True), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def sop_detail(request, sop_key: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    if not sop:
        return Response({"error": "SOP 不存在。"}, status=404)
    if request.method == "GET":
        return Response(_sop_payload(sop, request.user, include_graph=True))
    if not _can_edit(sop, request.user):
        return Response({"error": "系统 SOP 请先复制到当前工作区后编辑。"}, status=403)
    if request.method == "DELETE":
        sop.status = SopDefinition.Status.ARCHIVED
        sop.updated_by = request.user
        sop.save(update_fields=["status", "updated_by", "updated_at"])
        return Response(status=204)
    for field, key, limit in [
        ("name", "name", 128), ("business_domain", "businessDomain", 64),
        ("description", "description", 500), ("action_name", "actionName", 96),
    ]:
        if key in request.data:
            setattr(sop, field, str(request.data.get(key) or "")[:limit])
    if sop.action_name and not get_action(sop.action_name):
        return Response({"error": "绑定的动作契约不存在。"}, status=400)
    sop.updated_by = request.user
    sop.save()
    return Response(_sop_payload(sop, request.user, include_graph=True))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_duplicate(request, sop_key: str):
    organization = ensure_current_organization(request.user)
    source = _find_sop(organization, sop_key)
    if not source:
        return Response({"error": "SOP 不存在。"}, status=404)
    source_version = source.versions.filter(version=source.current_version).first() or source.versions.first()
    key = str(request.data.get("key") or f"{source.sop_key}.local").strip()[:96]
    if SopDefinition.objects.filter(organization=organization, sop_key=key).exists():
        return Response({"error": "当前工作区已存在相同 SOP ID。"}, status=400)
    with transaction.atomic():
        copy = SopDefinition.objects.create(
            organization=organization,
            sop_key=key,
            name=str(request.data.get("name") or f"{source.name}（本地版）")[:128],
            business_domain=source.business_domain,
            description=source.description,
            action_name=source.action_name,
            created_by=request.user,
            updated_by=request.user,
        )
        if source_version:
            SopVersion.objects.create(
                definition=copy,
                version="1.0.0",
                graph=deepcopy(source_version.graph),
                input_schema=deepcopy(source_version.input_schema),
                output_schema=deepcopy(source_version.output_schema),
                trigger_intents=deepcopy(source_version.trigger_intents),
                utterance_examples=deepcopy(source_version.utterance_examples),
                content_hash=source_version.content_hash,
                change_summary=f"复制自 {source.sop_key}@{source_version.version}",
                created_by=request.user,
            )
    return Response(_sop_payload(copy, request.user, include_graph=True), status=201)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def sop_versions(request, sop_key: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    if not sop:
        return Response({"error": "SOP 不存在。"}, status=404)
    if request.method == "GET":
        return Response({"results": [_version_payload(row) for row in sop.versions.all()]})
    if not _can_edit(sop, request.user):
        return Response({"error": "没有权限创建该 SOP 的版本。"}, status=403)
    version_number = str(request.data.get("version") or "").strip()
    if not version_number or sop.versions.filter(version=version_number).exists():
        return Response({"error": "版本号为空或已经存在。"}, status=400)
    base = sop.versions.filter(version=sop.current_version).first() or sop.versions.first()
    try:
        values = _version_values(request.data, fallback=base)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    row = SopVersion.objects.create(definition=sop, version=version_number, created_by=request.user, **values)
    return Response(_version_payload(row), status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def sop_version_detail(request, sop_key: str, version: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    row = sop.versions.filter(version=version).first() if sop else None
    if not row:
        return Response({"error": "SOP 版本不存在。"}, status=404)
    if request.method == "GET":
        return Response(_version_payload(row))
    if not _can_edit(sop, request.user) or row.status != SopVersion.Status.DRAFT:
        return Response({"error": "只有当前工作区的草稿版本可以修改。"}, status=403)
    try:
        values = _version_values(request.data, fallback=row)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    for field, value in values.items():
        setattr(row, field, value)
    row.save()
    return Response(_version_payload(row))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_publish(request, sop_key: str, version: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    row = sop.versions.filter(version=version).first() if sop else None
    if not row:
        return Response({"error": "SOP 版本不存在。"}, status=404)
    if not _can_edit(sop, request.user):
        return Response({"error": "没有权限发布该 SOP。"}, status=403)
    validate_graph(row.graph)
    with transaction.atomic():
        sop.versions.filter(status=SopVersion.Status.PUBLISHED).exclude(id=row.id).update(status=SopVersion.Status.RETIRED)
        row.status = SopVersion.Status.PUBLISHED
        row.published_by = request.user
        row.published_at = timezone.now()
        row.save(update_fields=["status", "published_by", "published_at", "updated_at"])
        sop.current_version = row.version
        sop.status = SopDefinition.Status.PUBLISHED
        sop.updated_by = request.user
        sop.save(update_fields=["current_version", "status", "updated_by", "updated_at"])
    return Response(_sop_payload(sop, request.user, include_graph=True))
