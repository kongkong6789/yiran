from __future__ import annotations

from collections import defaultdict
import uuid

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
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
from .serializers import WorkTodoCreateSerializer, WorkTodoStatusSerializer
from .todo_sync_service import (
    delete_work_todo_group,
    sync_work_todo_group,
)


def _display_name(user) -> str:
    settings = getattr(user, "settings", None)
    return (getattr(settings, "display_name", "") or user.username).strip()


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
            "avatar": contact.avatar_url if contact else "",
            "bound": bool(binding),
        })
    return Response({"ok": True, "results": results})


def _sync_status(rows: list[WorkTodo]) -> str:
    statuses_by_recipient: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        name = (_display_name(row.assignee) if row.assignee_id else row.recipient_name or "企业微信成员")
        statuses_by_recipient[name.strip().casefold()].add(row.sync_status)

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
    if (
        WorkTodo.SyncStatus.SYNCED in effective_statuses
        and WorkTodo.SyncStatus.NOT_REQUESTED in effective_statuses
    ):
        return "partial"
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
        name = (_display_name(row.assignee) if row.assignee_id else row.recipient_name or "企业微信成员")
        grouped[name.strip().casefold()].append(row)

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
        (item for item in rows if item.assignee_id == perspective_assignee_id),
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
        "assigneeNames": [
            _display_name(item.assignee) if item.assignee_id else item.recipient_name or "企业微信成员"
            for item in visible_recipient_rows
        ],
        "recipients": [{
            "name": _display_name(item.assignee) if item.assignee_id else item.recipient_name or "企业微信成员",
            "type": item.recipient_type,
            "avatar": _recipient_avatar(item),
            "syncStatus": item.sync_status,
        } for item in visible_recipient_rows],
        "remindTypes": row.remind_types,
        "syncRequested": row.sync_requested,
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
        rows = WorkTodo.objects.select_related(
            "creator", "creator__settings", "assignee", "assignee__settings", "wecom_contact"
        ).filter(organization=organization)
        if view == "created":
            rows = rows.filter(creator=request.user)
        else:
            assigned_rows = rows.filter(assignee=request.user)
        requested_status = request.query_params.get("status")
        if requested_status in WorkTodo.Status.values and view != "created":
            assigned_rows = assigned_rows.filter(status=requested_status)
        if view != "created":
            if requested_status == WorkTodo.Status.COMPLETED:
                assigned_rows = assigned_rows.order_by("-completed_at", "-updated_at")
            elif requested_status == WorkTodo.Status.PENDING:
                assigned_rows = assigned_rows.order_by("due_at", "-created_at")
            else:
                assigned_rows = assigned_rows.order_by("-updated_at")
            ordered_group_ids = list(assigned_rows.values_list("sync_group_id", flat=True))
            rows = rows.filter(sync_group_id__in=ordered_group_ids).order_by("sync_group_id", "id")
        if requested_status == WorkTodo.Status.COMPLETED:
            rows = rows.order_by("-completed_at", "-updated_at")
        elif requested_status == WorkTodo.Status.PENDING:
            rows = rows.order_by("due_at", "-created_at")
        else:
            rows = rows.order_by("-updated_at")
        results = _serialize_rows(
            rows,
            aggregate=True,
            perspective_assignee_id=request.user.id if view != "created" else None,
        )
        if view != "created":
            result_by_group = {
                next(
                    item.sync_group_id
                    for item in rows
                    if str(item.public_id) == result["id"]
                ): result
                for result in results
            }
            results = [result_by_group[group_id] for group_id in ordered_group_ids if group_id in result_by_group]
        if view == "created" and requested_status in WorkTodo.Status.values:
            results = [item for item in results if item["status"] == requested_status]
        if view == "created":
            results.sort(key=lambda item: item["updatedAt"], reverse=True)
        return Response({
            "ok": True,
            "source": "database",
            "results": results,
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
    bindings = {
        binding.platform_user_id: binding
        for binding in UserWeComBinding.objects.filter(
            platform_user_id__in=assignee_ids,
            status=UserWeComBinding.Status.MATCHED,
            wecom_userid__isnull=False,
            wecom_config__organization=organization,
        )
    }
    selected_bound_wecom_ids = {str(binding.wecom_userid) for binding in bindings.values()}
    contacts = [contact for contact in contacts if contact.wecom_userid not in selected_bound_wecom_ids]
    sync_group_id = uuid.uuid4()
    created = []
    skipped_sync_names = []
    with transaction.atomic():
        for assignee_id in assignee_ids:
            assignee = memberships[assignee_id]
            should_sync = bool(sync_requested and assignee_id in bindings)
            if sync_requested and not should_sync:
                skipped_sync_names.append(_display_name(assignee))
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
                sync_requested=should_sync,
                sync_status=WorkTodo.SyncStatus.PENDING if should_sync else WorkTodo.SyncStatus.NOT_REQUESTED,
                sync_next_retry_at=timezone.now() if should_sync else None,
            )
            created.append(str(row.public_id))
        for contact in contacts:
            row = WorkTodo.objects.create(
                organization=organization,
                creator=request.user,
                assignee=None,
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
            result={"created": True, "sync_requested": sync_requested, "sync_skipped_count": len(skipped_sync_names)},
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
        "skippedPlatformAssigneeNames": skipped_sync_names,
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
        organization=organization,
        assignee=request.user,
        public_id=serializer.validated_data["id"],
    ).first()
    if not row:
        return Response({"ok": False, "detail": "待办不存在或不属于当前账号。"}, status=404)
    completed = serializer.validated_data["status"] == WorkTodo.Status.COMPLETED
    WorkTodo.objects.filter(id=row.id).update(
        status=WorkTodo.Status.COMPLETED if completed else WorkTodo.Status.PENDING,
        completed_at=timezone.now() if completed else None,
        last_sync_source=WorkTodo.SyncSource.PLATFORM,
        updated_at=timezone.now(),
    )
    result = (
        sync_work_todo_group(row.sync_group_id, force=True)
        if row.sync_requested
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
    row = WorkTodo.objects.filter(
        Q(creator=request.user) | Q(assignee=request.user),
        organization=organization,
        public_id=todo_id,
    ).first()
    if not row:
        return Response({"ok": False, "detail": "待办不存在或无权操作。"}, status=404)
    if not WorkTodo.objects.filter(sync_group_id=row.sync_group_id, sync_requested=True).exists():
        return Response({"ok": False, "detail": "该待办未启用企业微信同步。"}, status=400)
    result = sync_work_todo_group(row.sync_group_id, force=True)
    return Response(result)


@extend_schema(summary="删除我创建的待办", request=None, responses=OpenApiTypes.OBJECT)
@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_todo(request, todo_id):
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
    try:
        result = delete_work_todo_group(row.sync_group_id)
    except WeComCliError as exc:
        return _error_response(exc)
    return Response(result)
