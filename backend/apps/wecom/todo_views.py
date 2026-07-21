from __future__ import annotations

from collections import defaultdict
import uuid

from django.db import transaction
from django.db.models import Count, F, Max, Min, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.models import AuditLog, OrganizationMembership, WorkTodo
from apps.core.organizations import current_organization, is_organization_admin, organization_user_ids

from .cli_service import WeComCliClient, WeComCliError
from .models import UserWeComBinding, WeComCliConfig, WeComContact
from .access import resolve_accessible_config
from .serializers import WorkTodoCreateSerializer, WorkTodoStatusSerializer, WorkTodoUpdateSerializer
from .todo_sync_service import (
    delete_work_todo_group,
    sync_work_todo_group,
)


def _display_name(user) -> str:
    settings = getattr(user, "settings", None)
    return (getattr(settings, "display_name", "") or user.username).strip()


def _recipient_name(row: WorkTodo) -> str:
    if row.recipient_type == WorkTodo.RecipientType.WECOM:
        return row.recipient_name or "企业微信成员"
    return _display_name(row.assignee) if row.assignee_id else row.recipient_name or "平台成员"


def _recipient_identity(row: WorkTodo) -> str:
    """Use real binding identities; names are display-only and may collide."""
    if row.recipient_type == WorkTodo.RecipientType.PLATFORM and row.assignee_id:
        return f"platform:{row.assignee_id}"
    if row.linked_platform_user_id:
        return f"platform:{row.linked_platform_user_id}"
    if row.wecom_contact_id:
        return f"wecom:{row.wecom_contact_id}"
    return f"row:{row.id}"


def _config_for(request):
    organization = current_organization(request.user)
    config = WeComCliConfig.objects.prefetch_related("allowed_users").filter(organization=organization).first() if organization else None
    return organization, config


def _error_response(exc: WeComCliError):
    return Response({"ok": False, "code": exc.code, "detail": exc.message}, status=exc.status_code)


@extend_schema_view(
    get=extend_schema(summary="读取企业微信待办机器人配置", responses=OpenApiTypes.OBJECT),
    patch=extend_schema(summary="保存企业微信待办机器人配置", request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT),
)
@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def cli_config(request):
    organization = current_organization(request.user)
    if not organization:
        return Response({"ok": False, "detail": "请先加入企业后再配置企业微信待办。"}, status=409)
    can_manage = is_organization_admin(request.user, organization)
    config = WeComCliConfig.objects.filter(organization=organization).first()
    if request.method == "GET":
        return Response({
            "ok": True,
            "configured": bool(config and config.configured),
            "enabled": bool(config and config.enabled),
            "botId": config.bot_id if config and can_manage else ("已配置" if config and config.bot_id else ""),
            "secretConfigured": bool(config and config.bot_secret_encrypted),
            "canManage": can_manage,
            "canUse": bool(config and config.can_use(request.user)),
            "accessScope": config.access_scope if config else WeComCliConfig.AccessScope.ORGANIZATION,
            "allowedUserIds": list(config.allowed_users.values_list("id", flat=True)) if config and can_manage else [],
            "lastTestedAt": config.last_tested_at.isoformat() if config and config.last_tested_at else None,
            "lastErrorReason": config.last_error_reason if config else "",
            "organizationName": organization.name,
        })
    if not can_manage:
        return Response({"ok": False, "detail": "仅企业所有者或管理员可以修改待办机器人配置。"}, status=403)
    bot_id = str(request.data.get("botId") or "").strip()
    secret = str(request.data.get("secret") or "").strip()
    if not bot_id:
        return Response({"ok": False, "detail": "请填写机器人 Bot ID。"}, status=400)
    config, _ = WeComCliConfig.objects.get_or_create(organization=organization, defaults={"user": request.user})
    config.user = request.user
    config.bot_id = bot_id
    config.enabled = bool(request.data.get("enabled", True))
    access_scope = str(request.data.get("accessScope") or WeComCliConfig.AccessScope.ORGANIZATION)
    if access_scope not in WeComCliConfig.AccessScope.values:
        return Response({"ok": False, "detail": "待办能力使用范围无效。"}, status=400)
    allowed_user_ids = request.data.get("allowedUserIds") or []
    valid_user_ids = set(organization_user_ids(organization))
    selected_ids = {int(item) for item in allowed_user_ids if str(item).isdigit()}
    if access_scope == WeComCliConfig.AccessScope.SELECTED and (not selected_ids or not selected_ids.issubset(valid_user_ids)):
        return Response({"ok": False, "detail": "请选择当前企业内的启用成员。"}, status=400)
    config.access_scope = access_scope
    if secret:
        config.bot_secret = secret
    if not config.bot_secret_encrypted:
        return Response({"ok": False, "detail": "请填写机器人 Secret。"}, status=400)
    config.last_error_code = ""
    config.last_error_reason = ""
    config.save()
    config.allowed_users.set(selected_ids if access_scope == WeComCliConfig.AccessScope.SELECTED else [])
    AuditLog.objects.create(
        trace_id=f"wecom-cli-config-{organization.id}-{int(timezone.now().timestamp())}", actor=request.user.username,
        intent="配置企业微信原生待办", action="wecom.todo.config", payload={"organization_id": organization.id},
        decision=AuditLog.Decision.ALLOW, result={"configured": True},
    )
    return Response({"ok": True, "configured": True, "detail": "企业微信待办配置已保存。"})


@extend_schema(summary="测试企业微信待办机器人连接", request=None, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cli_config_test(request):
    organization, config = _config_for(request)
    if not organization or not is_organization_admin(request.user, organization):
        return Response({"ok": False, "detail": "仅企业管理员可以测试连接。"}, status=403)
    if not config:
        return Response({"ok": False, "detail": "请先保存机器人配置。"}, status=409)
    if config.bot_secret_encrypted and not config.bot_secret:
        return Response({
            "ok": False,
            "code": "credential_decrypt_failed",
            "detail": "已保存的 Secret 无法解密，请重新输入 Secret 并点击保存。",
        }, status=409)
    try:
        WeComCliClient(config).test_connection()
    except WeComCliError as exc:
        config.last_error_code = exc.code
        config.last_error_reason = exc.message
        config.save(update_fields=["last_error_code", "last_error_reason", "updated_at"])
        return _error_response(exc)
    config.last_tested_at = timezone.now()
    config.last_error_code = ""
    config.last_error_reason = ""
    config.save(update_fields=["last_tested_at", "last_error_code", "last_error_reason", "updated_at"])
    return Response({"ok": True, "detail": "连接测试成功，企业微信原生待办能力可用。"})


@extend_schema(summary="查询平台待办负责人", responses=OpenApiTypes.OBJECT)
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def todo_members(request):
    organization, _config = _config_for(request)
    if not organization:
        return Response({"ok": True, "results": []})

    memberships = list(
        OrganizationMembership.objects.select_related("user", "user__settings")
        .filter(organization=organization, is_active=True, user__is_active=True)
        .order_by("user__username", "user_id")
    )
    user_ids = [membership.user_id for membership in memberships]
    bindings = {
        binding.platform_user_id: binding
        for binding in UserWeComBinding.objects.select_related("wecom_config").filter(
            platform_user_id__in=user_ids,
            status=UserWeComBinding.Status.MATCHED,
            wecom_userid__isnull=False,
            wecom_config__organization=organization,
        )
    }
    contacts = {
        (contact.config_id, contact.wecom_userid): contact
        for contact in WeComContact.objects.filter(
            config__organization=organization,
            available=True,
            wecom_userid__in=[binding.wecom_userid for binding in bindings.values()],
        )
    }
    results = []
    for membership in memberships:
        binding = bindings.get(membership.user_id)
        contact = contacts.get((binding.wecom_config_id, binding.wecom_userid)) if binding else None
        results.append({
            "id": membership.user_id,
            "name": contact.name if contact else _display_name(membership.user),
            "department": contact.department if contact else "",
            # This endpoint represents platform members. Their platform profile
            # avatar is authoritative; WeCom-only contacts are returned by the
            # separate contacts endpoint with their WeCom avatar.
            "avatar": getattr(getattr(membership.user, "settings", None), "avatar_url", "") or "",
            "bound": bool(binding),
        })
    return Response({"ok": True, "results": results})


def _sync_status(rows: list[WorkTodo]) -> str:
    sync_rows = [row for row in rows if row.sync_requested]
    if not sync_rows:
        return WorkTodo.SyncStatus.NOT_REQUESTED
    statuses_by_recipient: dict[str, set[str]] = defaultdict(set)
    for row in sync_rows:
        statuses_by_recipient[_recipient_identity(row)].add(row.sync_status)

    effective_statuses: set[str] = set()
    for statuses in statuses_by_recipient.values():
        if WorkTodo.SyncStatus.PENDING in statuses:
            effective_statuses.add(WorkTodo.SyncStatus.PENDING)
        elif WorkTodo.SyncStatus.SYNCED in statuses:
            # 同一个人同时以平台成员和企微通讯录成员存在时，只要企微记录成功即视为已触达。
            effective_statuses.add(WorkTodo.SyncStatus.SYNCED)
        elif WorkTodo.SyncStatus.FAILED in statuses:
            effective_statuses.add(WorkTodo.SyncStatus.FAILED)
        else:
            effective_statuses.add(WorkTodo.SyncStatus.NOT_REQUESTED)

    if WorkTodo.SyncStatus.PENDING in effective_statuses:
        return WorkTodo.SyncStatus.PENDING
    if WorkTodo.SyncStatus.FAILED in effective_statuses and len(effective_statuses) > 1:
        return "partial"
    if WorkTodo.SyncStatus.FAILED in effective_statuses:
        return WorkTodo.SyncStatus.FAILED
    if WorkTodo.SyncStatus.SYNCED in effective_statuses:
        return WorkTodo.SyncStatus.SYNCED
    return WorkTodo.SyncStatus.NOT_REQUESTED


def _recipient_avatar(item: WorkTodo) -> str:
    if item.wecom_contact_id and item.wecom_contact:
        return item.wecom_contact.avatar_url or ""
    if item.assignee_id:
        settings = getattr(item.assignee, "settings", None)
        return getattr(settings, "avatar_url", "") or ""
    return ""


def _deduplicated_recipient_rows(rows: list[WorkTodo]) -> list[WorkTodo]:
    grouped: dict[str, list[WorkTodo]] = defaultdict(list)
    for row in rows:
        grouped[_recipient_identity(row)].append(row)

    status_rank = {
        WorkTodo.SyncStatus.NOT_REQUESTED: 0,
        WorkTodo.SyncStatus.FAILED: 1,
        WorkTodo.SyncStatus.PENDING: 2,
        WorkTodo.SyncStatus.SYNCED: 3,
    }
    return [
        max(
            recipient_rows,
            key=lambda item: (
                status_rank.get(item.sync_status, 0),
                1 if item.recipient_type == WorkTodo.RecipientType.WECOM else 0,
                1 if _recipient_avatar(item) else 0,
            ),
        )
        for recipient_rows in grouped.values()
    ]


def _platform_payload(rows: list[WorkTodo], *, perspective_assignee_id: int | None = None) -> dict:
    perspective_row = next(
        (
            item for item in rows
            if item.assignee_id == perspective_assignee_id
            or item.linked_platform_user_id == perspective_assignee_id
        ),
        None,
    ) if perspective_assignee_id else None
    row = perspective_row or rows[0]
    completed = (
        perspective_row.status == WorkTodo.Status.COMPLETED
        if perspective_row
        else all(item.status == WorkTodo.Status.COMPLETED for item in rows)
    )
    last_synced = max((item.last_synced_at for item in rows if item.last_synced_at), default=None)
    failure = next((item.sync_error_reason for item in rows if item.sync_error_reason), "")
    ordered_rows = sorted(
        rows,
        key=lambda item: (0 if perspective_assignee_id and item.assignee_id == perspective_assignee_id else 1, item.id),
    )
    visible_recipient_rows = _deduplicated_recipient_rows(ordered_rows)
    return {
        "id": str(row.public_id),
        "title": row.title,
        "description": row.description,
        "status": WorkTodo.Status.COMPLETED if completed else row.status,
        "priority": row.priority,
        "dueAt": row.due_at.isoformat() if row.due_at else None,
        "createdAt": row.created_at.isoformat(),
        "updatedAt": max(item.updated_at for item in rows).isoformat(),
        "creatorName": _display_name(row.creator),
        "assigneeNames": [_recipient_name(item) for item in visible_recipient_rows],
        "recipients": [{
            "name": _recipient_name(item),
            "type": item.recipient_type,
            "avatar": _recipient_avatar(item),
            "syncStatus": item.sync_status,
        } for item in visible_recipient_rows],
        "remindTypes": row.remind_types,
        "syncRequested": any(item.sync_requested for item in rows),
        "syncStatus": _sync_status(rows),
        "syncErrorReason": failure,
        "lastSyncedAt": last_synced.isoformat() if last_synced else None,
        "source": "platform",
    }


def _serialize_rows(rows, *, aggregate: bool, perspective_assignee_id: int | None = None) -> list[dict]:
    materialized = list(rows)
    if not aggregate:
        return [_platform_payload([row], perspective_assignee_id=perspective_assignee_id) for row in materialized]
    grouped: dict[object, list[WorkTodo]] = defaultdict(list)
    for row in materialized:
        grouped[row.sync_group_id].append(row)
    return [
        _platform_payload(group, perspective_assignee_id=perspective_assignee_id)
        for group in grouped.values()
    ]


@extend_schema_view(
    get=extend_schema(
        summary="查询我的待办或我创建的待办",
        parameters=[
            OpenApiParameter("view", OpenApiTypes.STR, description="assigned 或 created"),
            OpenApiParameter("status", OpenApiTypes.STR, description="pending、completed；不传表示全部"),
            OpenApiParameter("q", OpenApiTypes.STR, description="搜索标题和补充说明"),
            OpenApiParameter("priority", OpenApiTypes.STR, description="normal、high、urgent"),
            OpenApiParameter("dateFrom", OpenApiTypes.DATE, description="截止日期起始值"),
            OpenApiParameter("dateTo", OpenApiTypes.DATE, description="截止日期结束值"),
            OpenApiParameter("page", OpenApiTypes.INT),
            OpenApiParameter("pageSize", OpenApiTypes.INT),
        ],
        responses=OpenApiTypes.OBJECT,
    ),
    post=extend_schema(summary="创建平台待办并按需同步企业微信", request=WorkTodoCreateSerializer, responses=OpenApiTypes.OBJECT),
)
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def todos(request):
    organization, config = _config_for(request)
    if not organization:
        return Response({"ok": False, "detail": "当前账号尚未加入企业。"}, status=409)
    if request.method == "GET":
        view = request.query_params.get("view")
        try:
            page = max(int(request.query_params.get("page") or 1), 1)
            page_size = min(max(int(request.query_params.get("pageSize") or 20), 1), 100)
        except (TypeError, ValueError):
            return Response({"ok": False, "detail": "页码或每页数量格式不正确。"}, status=400)

        base_rows = WorkTodo.objects.filter(organization=organization)
        keyword = str(request.query_params.get("q") or "").strip()
        if keyword:
            base_rows = base_rows.filter(Q(title__icontains=keyword) | Q(description__icontains=keyword))
        requested_priority = request.query_params.get("priority")
        if requested_priority in WorkTodo.Priority.values:
            base_rows = base_rows.filter(priority=requested_priority)
        date_from_raw = str(request.query_params.get("dateFrom") or "").strip()
        date_to_raw = str(request.query_params.get("dateTo") or "").strip()
        date_from = parse_date(date_from_raw) if date_from_raw else None
        date_to = parse_date(date_to_raw) if date_to_raw else None
        if (date_from_raw and not date_from) or (date_to_raw and not date_to) or (date_from and date_to and date_from > date_to):
            return Response({"ok": False, "detail": "截止日期范围格式不正确。"}, status=400)
        if date_from:
            base_rows = base_rows.filter(due_at__date__gte=date_from)
        if date_to:
            base_rows = base_rows.filter(due_at__date__lte=date_to)

        requested_status = request.query_params.get("status")
        if view == "created":
            perspective_rows = base_rows.filter(creator=request.user)
            groups = perspective_rows.values("sync_group_id").annotate(
                pending_count=Count("id", filter=Q(status=WorkTodo.Status.PENDING)),
                completed_count=Count("id", filter=Q(status=WorkTodo.Status.COMPLETED)),
                sort_updated=Max("updated_at"),
                sort_completed=Max("completed_at"),
                sort_due=Min("due_at"),
                sort_created=Max("created_at"),
            )
            if requested_status == WorkTodo.Status.PENDING:
                groups = groups.filter(pending_count__gt=0)
            elif requested_status == WorkTodo.Status.COMPLETED:
                groups = groups.filter(pending_count=0, completed_count__gt=0)
        else:
            perspective_rows = base_rows.filter(
                Q(assignee=request.user) | Q(linked_platform_user=request.user)
            ).distinct()
            if requested_status in WorkTodo.Status.values:
                perspective_rows = perspective_rows.filter(status=requested_status)
            groups = perspective_rows.values("sync_group_id").annotate(
                sort_updated=Max("updated_at"),
                sort_completed=Max("completed_at"),
                sort_due=Min("due_at"),
                sort_created=Max("created_at"),
            )

        if requested_status == WorkTodo.Status.COMPLETED:
            groups = groups.order_by(F("sort_completed").desc(nulls_last=True), F("sort_updated").desc())
        elif requested_status == WorkTodo.Status.PENDING:
            groups = groups.order_by(F("sort_due").asc(nulls_last=True), F("sort_created").desc())
        else:
            groups = groups.order_by(F("sort_updated").desc())
        count = groups.count()
        start = (page - 1) * page_size
        ordered_group_ids = [item["sync_group_id"] for item in groups[start:start + page_size]]

        rows = WorkTodo.objects.select_related(
            "creator", "creator__settings", "assignee", "assignee__settings",
            "linked_platform_user", "wecom_contact",
        ).filter(organization=organization, sync_group_id__in=ordered_group_ids).order_by("sync_group_id", "id")
        materialized_rows = list(rows)
        results = _serialize_rows(
            materialized_rows,
            aggregate=True,
            perspective_assignee_id=request.user.id if view != "created" else None,
        )
        result_by_group = {
            group_id: _platform_payload(
                [item for item in materialized_rows if item.sync_group_id == group_id],
                perspective_assignee_id=request.user.id if view != "created" else None,
            )
            for group_id in ordered_group_ids
        }
        results = [result_by_group[group_id] for group_id in ordered_group_ids if group_id in result_by_group]
        return Response({
            "ok": True,
            "source": "database",
            "results": results,
            "count": count,
            "page": page,
            "pageSize": page_size,
        })

    serializer = WorkTodoCreateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    assignee_ids = data["platformAssigneeIds"]
    contact_ids = data["wecomContactIds"]
    valid_user_ids = set(organization_user_ids(organization))
    if any(item not in valid_user_ids for item in assignee_ids):
        return Response({"ok": False, "detail": "负责人必须是当前企业的启用成员。"}, status=400)
    memberships = {
        membership.user_id: membership.user
        for membership in OrganizationMembership.objects.select_related("user").filter(
            organization=organization, user_id__in=assignee_ids, is_active=True, user__is_active=True
        )
    }
    sync_requested = data["syncToWeCom"]
    api_config = resolve_accessible_config(request.user) if contact_ids else None
    contacts = list(WeComContact.objects.filter(
        id__in=contact_ids,
        config=api_config,
        config__organization=organization,
        available=True,
    )) if api_config else []
    if contact_ids and len(contacts) != len(contact_ids):
        return Response({"ok": False, "detail": "部分企业微信负责人不存在、已停用或不属于当前企业。"}, status=400)
    linked_user_by_contact_id = {
        contact.id: binding.platform_user_id
        for contact in contacts
        for binding in UserWeComBinding.objects.filter(
            wecom_config=contact.config,
            wecom_userid=contact.wecom_userid,
            platform_user_id__in=assignee_ids,
            status=UserWeComBinding.Status.MATCHED,
        )[:1]
    }
    sync_group_id = uuid.uuid4()
    created = []
    with transaction.atomic():
        for assignee_id in assignee_ids:
            assignee = memberships[assignee_id]
            row = WorkTodo.objects.create(
                organization=organization,
                creator=request.user,
                assignee=assignee,
                recipient_type=WorkTodo.RecipientType.PLATFORM,
                recipient_name=_display_name(assignee),
                title=data["title"],
                description=data["description"],
                priority=data["priority"],
                due_at=data.get("dueAt"),
                remind_types=data["remindTypes"] or [0],
                sync_group_id=sync_group_id,
                sync_requested=False,
                sync_status=WorkTodo.SyncStatus.NOT_REQUESTED,
                sync_next_retry_at=None,
            )
            created.append(str(row.public_id))
        for contact in contacts:
            row = WorkTodo.objects.create(
                organization=organization,
                creator=request.user,
                assignee=None,
                linked_platform_user_id=linked_user_by_contact_id.get(contact.id),
                recipient_type=WorkTodo.RecipientType.WECOM,
                recipient_name=contact.name,
                wecom_contact=contact,
                title=data["title"],
                description=data["description"],
                priority=data["priority"],
                due_at=data.get("dueAt"),
                remind_types=data["remindTypes"] or [0],
                sync_group_id=sync_group_id,
                sync_requested=True,
                sync_status=WorkTodo.SyncStatus.PENDING,
                sync_next_retry_at=timezone.now(),
            )
            created.append(str(row.public_id))
        AuditLog.objects.create(
            trace_id=f"work-todo-create-{created[0]}", actor=request.user.username, intent="创建平台待办",
            action="work.todo.create",
            payload={
                "organization_id": organization.id,
                "platform_assignee_count": len(assignee_ids),
                "wecom_contact_count": len(contacts),
            },
            decision=AuditLog.Decision.ALLOW,
            result={"created": True, "sync_requested": sync_requested, "wecom_recipient_count": len(contacts)},
        )
    queued = any(row.sync_requested for row in WorkTodo.objects.filter(sync_group_id=sync_group_id))
    sync_result = (
        {"ok": True, "syncStatus": WorkTodo.SyncStatus.PENDING, "detail": "已进入企业微信待办同步队列。"}
        if queued
        else {"ok": True, "syncStatus": WorkTodo.SyncStatus.NOT_REQUESTED, "detail": "平台待办已创建。"}
    )
    return Response({
        "ok": True,
        "ids": created,
        "syncStatus": sync_result["syncStatus"],
        "syncDetail": sync_result["detail"],
        "skippedPlatformAssigneeNames": [],
        "detail": "平台待办已创建。" if not queued else "平台待办已创建，企业微信同步状态已记录。",
    }, status=201)


@extend_schema(summary="更新待办状态", request=WorkTodoStatusSerializer, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def todo_status(request):
    organization, _config = _config_for(request)
    if not organization:
        return Response({"ok": False, "detail": "当前账号尚未加入企业。"}, status=409)
    serializer = WorkTodoStatusSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    row = WorkTodo.objects.filter(
        Q(assignee=request.user) | Q(linked_platform_user=request.user),
        organization=organization,
        public_id=serializer.validated_data["id"],
    ).first()
    if not row:
        return Response({"ok": False, "detail": "待办不存在或不属于当前账号。"}, status=404)
    completed = serializer.validated_data["status"] == WorkTodo.Status.COMPLETED
    linked_rows = WorkTodo.objects.filter(sync_group_id=row.sync_group_id).filter(
        Q(recipient_type=WorkTodo.RecipientType.PLATFORM, assignee=request.user)
        | Q(recipient_type=WorkTodo.RecipientType.WECOM, linked_platform_user=request.user)
    )
    linked_rows.update(
        status=WorkTodo.Status.COMPLETED if completed else WorkTodo.Status.PENDING,
        completed_at=timezone.now() if completed else None,
        last_sync_source=WorkTodo.SyncSource.PLATFORM,
        updated_at=timezone.now(),
    )
    result = (
        sync_work_todo_group(row.sync_group_id, force=True)
        if linked_rows.filter(sync_requested=True).exists()
        else {"ok": True, "syncStatus": WorkTodo.SyncStatus.NOT_REQUESTED, "detail": "平台待办状态已更新。"}
    )
    return Response({
        "ok": True,
        "syncStatus": result["syncStatus"],
        "detail": "平台待办状态已更新。" if result["ok"] else "平台状态已更新，企业微信同步失败并已记录。",
    })


@extend_schema(summary="重新同步企业微信待办", request=None, responses=OpenApiTypes.OBJECT)
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def retry_todo_sync(request, todo_id):
    organization, _config = _config_for(request)
    if not organization:
        return Response({"ok": False, "detail": "当前账号尚未加入企业。"}, status=409)
    row = WorkTodo.objects.filter(organization=organization, public_id=todo_id).first()
    if not row:
        return Response({"ok": False, "detail": "待办不存在。"}, status=404)
    if row.creator_id != request.user.id and not is_organization_admin(request.user, organization):
        return Response({"ok": False, "detail": "仅创建人或企业管理员可以重新同步整组待办。"}, status=403)
    if not WorkTodo.objects.filter(sync_group_id=row.sync_group_id, sync_requested=True).exists():
        return Response({"ok": False, "detail": "该待办未启用企业微信同步。"}, status=400)
    result = sync_work_todo_group(row.sync_group_id, force=True)
    return Response(result)


@extend_schema(summary="删除我创建的待办", request=None, responses=OpenApiTypes.OBJECT)
@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def todo_detail(request, todo_id):
    organization, _config = _config_for(request)
    if not organization:
        return Response({"ok": False, "detail": "当前账号尚未加入企业。"}, status=409)
    row = WorkTodo.objects.filter(
        organization=organization,
        creator=request.user,
        public_id=todo_id,
    ).first()
    if not row:
        return Response({"ok": False, "detail": "待办不存在，或只有创建人可以删除。"}, status=404)
    if request.method == "PATCH":
        serializer = WorkTodoUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not data:
            return Response({"ok": False, "detail": "请至少提交一个需要修改的字段。"}, status=400)
        field_map = {
            "title": "title",
            "description": "description",
            "dueAt": "due_at",
            "priority": "priority",
            "remindTypes": "remind_types",
        }
        updates = {field_map[key]: value for key, value in data.items()}
        updates["updated_at"] = timezone.now()
        WorkTodo.objects.filter(sync_group_id=row.sync_group_id).update(**updates)
        result = (
            sync_work_todo_group(row.sync_group_id, force=True)
            if WorkTodo.objects.filter(sync_group_id=row.sync_group_id, sync_requested=True).exists()
            else {"ok": True, "syncStatus": WorkTodo.SyncStatus.NOT_REQUESTED}
        )
        AuditLog.objects.create(
            trace_id=f"work-todo-update-{row.public_id.hex[:12]}-{int(timezone.now().timestamp())}",
            actor=request.user.username,
            intent="修改工作待办",
            action="work.todo.update",
            payload={"organization_id": organization.id, "fields": sorted(data.keys())},
            decision=AuditLog.Decision.ALLOW,
            result={"updated": True, "wecom_synced": bool(result.get("ok"))},
        )
        return Response({
            "ok": True,
            "syncStatus": result.get("syncStatus", WorkTodo.SyncStatus.NOT_REQUESTED),
            "detail": "待办已更新。" if result.get("ok") else "平台待办已更新，企业微信同步失败并已记录。",
        })
    try:
        result = delete_work_todo_group(row.sync_group_id)
    except WeComCliError as exc:
        return _error_response(exc)
    return Response(result)
