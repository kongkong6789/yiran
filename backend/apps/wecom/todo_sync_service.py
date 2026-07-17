from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.models import AuditLog, Organization, WorkTodo

from .cli_service import WeComCliClient, WeComCliError
from .models import UserWeComBinding, WeComCliConfig, WeComContact


RETRY_DELAYS = [
    timedelta(minutes=5),
    timedelta(minutes=30),
    timedelta(hours=2),
    timedelta(days=1),
]
RETRYABLE_CODES = {"network_error", "mcp_error", "missing_todo_id"}


def _audit(*, row: WorkTodo, action: str, result: dict) -> None:
    AuditLog.objects.create(
        trace_id=f"todo-{row.public_id.hex[:12]}-{int(timezone.now().timestamp())}",
        actor=row.creator.username,
        intent="同步企业微信待办",
        action=action,
        payload={"organization_id": row.organization_id, "sync_group_id": str(row.sync_group_id)},
        decision=AuditLog.Decision.ALLOW,
        result=result,
    )


def _mark_failed(rows: list[WorkTodo], *, code: str, reason: str) -> dict:
    if not rows:
        return {"ok": False, "syncStatus": WorkTodo.SyncStatus.FAILED, "detail": reason}
    retry_count = max((row.sync_retry_count for row in rows), default=0) + 1
    retryable = code in RETRYABLE_CODES and retry_count <= len(RETRY_DELAYS)
    next_retry_at = (
        timezone.now() + RETRY_DELAYS[min(retry_count - 1, len(RETRY_DELAYS) - 1)]
        if retryable
        else None
    )
    WorkTodo.objects.filter(id__in=[row.id for row in rows]).update(
        sync_status=WorkTodo.SyncStatus.FAILED,
        sync_error_code=code[:64],
        sync_error_reason=reason[:500],
        sync_retry_count=retry_count,
        sync_next_retry_at=next_retry_at,
        last_sync_source=WorkTodo.SyncSource.PLATFORM,
        updated_at=timezone.now(),
    )
    _audit(row=rows[0], action="wecom.todo.sync_failed", result={"code": code, "retryable": retryable})
    return {
        "ok": False,
        "syncStatus": WorkTodo.SyncStatus.FAILED,
        "detail": reason,
        "nextRetryAt": next_retry_at.isoformat() if next_retry_at else None,
    }


def _recipient_todo_userids(
    rows: list[WorkTodo], client: WeComCliClient
) -> tuple[dict[int, str], list[tuple[WorkTodo, str, str]]]:
    """Resolve robot-scoped todo IDs separately from app-directory UserIDs."""
    organization_id = rows[0].organization_id
    platform_rows = [row for row in rows if row.recipient_type == WorkTodo.RecipientType.PLATFORM]
    bindings = {
        binding.platform_user_id: str(binding.wecom_userid)
        for binding in UserWeComBinding.objects.filter(
            platform_user_id__in=[row.assignee_id for row in platform_rows if row.assignee_id],
            status=UserWeComBinding.Status.MATCHED,
            wecom_userid__isnull=False,
            wecom_config__organization_id=organization_id,
        )
    }
    resolved: dict[int, str] = {}
    unresolved: list[tuple[WorkTodo, str, str]] = []
    for row in rows:
        eligible = False
        if row.recipient_type == WorkTodo.RecipientType.PLATFORM and row.assignee_id:
            eligible = bool(bindings.get(row.assignee_id))
        elif (
            row.recipient_type == WorkTodo.RecipientType.WECOM
            and row.wecom_contact_id
            and row.wecom_contact
            and row.wecom_contact.available
            and row.wecom_contact.config.organization_id == organization_id
        ):
            eligible = True
        if not eligible:
            unresolved.append((
                row,
                "recipient_unavailable",
                "企业微信负责人已停用、未绑定或不再属于当前企业，平台待办已保留。",
            ))
            continue
        todo_userid = row.wecom_todo_userid if row.wecom_todo_userid_encrypted else ""
        if not todo_userid:
            try:
                todo_userid = client.search_todo_userid(row.recipient_name)
            except WeComCliError as exc:
                unresolved.append((row, exc.code, exc.message))
                continue
            if todo_userid:
                row.wecom_todo_userid = todo_userid
                row.save(update_fields=["wecom_todo_userid_encrypted", "updated_at"])
        if todo_userid:
            resolved[row.id] = todo_userid
        else:
            unresolved.append((
                row,
                "todo_user_not_in_scope",
                f"{row.recipient_name}未加入机器人可添加待办的成员范围，平台待办已保留。",
            ))
    return resolved, unresolved


def sync_work_todo_group(sync_group_id: UUID | str, *, force: bool = False) -> dict:
    """Create or update one WeCom todo for all syncable recipients in a platform todo group."""
    with transaction.atomic():
        rows = list(
            WorkTodo.objects.select_for_update(of=("self",))
            .select_related("organization", "creator", "assignee", "wecom_contact", "wecom_contact__config")
            .filter(sync_group_id=sync_group_id)
            .order_by("id")
        )
        if not rows:
            return {"ok": False, "syncStatus": "missing", "detail": "平台待办不存在。"}
        sync_rows = [row for row in rows if row.sync_requested]
        if not sync_rows:
            return {"ok": True, "syncStatus": WorkTodo.SyncStatus.NOT_REQUESTED, "detail": "仅创建平台待办。"}
        if all(row.sync_status == WorkTodo.SyncStatus.SYNCED for row in sync_rows) and not force:
            return {"ok": True, "syncStatus": WorkTodo.SyncStatus.SYNCED, "detail": "企业微信待办已同步。"}

        config = WeComCliConfig.objects.filter(organization_id=rows[0].organization_id).first()
        if not config or not config.configured:
            return _mark_failed(sync_rows, code="not_configured", reason="当前企业尚未配置企业微信待办机器人。")
        if not config.can_use(rows[0].creator):
            return _mark_failed(sync_rows, code="not_authorized", reason="当前账号没有企业微信待办使用权限。")

        client = WeComCliClient(config)
        recipient_userids, unresolved = _recipient_todo_userids(sync_rows, client)
        if unresolved:
            for row, code, reason in unresolved:
                _mark_failed([row], code=code, reason=reason)
        resolved_rows = [row for row in sync_rows if row.id in recipient_userids]
        if not resolved_rows:
            return {
                "ok": False,
                "syncStatus": WorkTodo.SyncStatus.FAILED,
                "detail": "没有可同步的企业微信负责人，平台待办已保留。",
            }

        now = timezone.now()
        WorkTodo.objects.filter(id__in=[row.id for row in resolved_rows]).update(
            sync_status=WorkTodo.SyncStatus.PENDING,
            sync_error_code="",
            sync_error_reason="",
            sync_next_retry_at=None,
            last_sync_source=WorkTodo.SyncSource.PLATFORM,
            updated_at=now,
        )
        native_id = next((row.wecom_todo_id for row in resolved_rows if row.wecom_todo_id_encrypted), "")
        try:
            if not native_id:
                content = rows[0].title if not rows[0].description else f"{rows[0].title}\n{rows[0].description}"
                native_id = client.create_todo(
                    content=content[:2000],
                    follower_ids=list(dict.fromkeys(recipient_userids.values())),
                    end_time=(
                        timezone.localtime(rows[0].due_at).strftime("%Y-%m-%d %H:%M:%S")
                        if rows[0].due_at and rows[0].due_at > timezone.now()
                        else ""
                    ),
                    remind_types=rows[0].remind_types,
                )
                for row in resolved_rows:
                    row.wecom_todo_id = native_id
                    row.save(update_fields=["wecom_todo_id_encrypted", "updated_at"])
            for row in resolved_rows:
                client.change_user_status(
                    todo_id=row.wecom_todo_id or native_id,
                    follower_id=recipient_userids[row.id],
                    user_status=2 if row.status == WorkTodo.Status.COMPLETED else 1,
                )
        except WeComCliError as exc:
            return _mark_failed(resolved_rows, code=exc.code, reason=exc.message)

        now = timezone.now()
        WorkTodo.objects.filter(id__in=[row.id for row in resolved_rows]).update(
            sync_status=WorkTodo.SyncStatus.SYNCED,
            sync_error_code="",
            sync_error_reason="",
            sync_retry_count=0,
            sync_next_retry_at=None,
            last_synced_at=now,
            last_sync_source=WorkTodo.SyncSource.PLATFORM,
            updated_at=now,
        )
        partial = bool(unresolved) or len(resolved_rows) != len(rows)
        _audit(
            row=resolved_rows[0],
            action="wecom.todo.synced",
            result={"synced": True, "recipient_count": len(resolved_rows), "partial": partial},
        )
        return {
            "ok": True,
            "syncStatus": "partial" if partial else WorkTodo.SyncStatus.SYNCED,
            "detail": "可用负责人已同步到企业微信。" if partial else "平台待办已同步到企业微信。",
        }


def delete_work_todo_group(sync_group_id: UUID | str) -> dict:
    """Delete the native WeCom todo first, then remove its platform mirror group."""
    with transaction.atomic():
        rows = list(
            WorkTodo.objects.select_for_update(of=("self",))
            .select_related("organization", "creator")
            .filter(sync_group_id=sync_group_id)
            .order_by("id")
        )
        if not rows:
            return {"ok": False, "code": "missing", "detail": "待办不存在。"}

        native_ids = list(dict.fromkeys(
            row.wecom_todo_id for row in rows if row.wecom_todo_id_encrypted and row.wecom_todo_id
        ))
        if native_ids:
            config = WeComCliConfig.objects.filter(organization_id=rows[0].organization_id).first()
            if not config or not config.configured:
                raise WeComCliError(
                    "not_configured",
                    "企业微信待办连接不可用，暂时无法删除已同步的企业微信待办。",
                    status_code=409,
                )
            if not config.can_use(rows[0].creator):
                raise WeComCliError(
                    "not_authorized",
                    "创建人当前没有企业微信待办使用权限，暂时无法删除已同步待办。",
                    status_code=403,
                )
            client = WeComCliClient(config)
            for native_id in native_ids:
                client.delete_todo(todo_id=native_id)

        first = rows[0]
        deleted_count = len(rows)
        AuditLog.objects.create(
            trace_id=f"todo-delete-{first.public_id.hex[:12]}-{int(timezone.now().timestamp())}",
            actor=first.creator.username,
            intent="删除工作待办",
            action="wecom.todo.deleted",
            payload={"organization_id": first.organization_id, "sync_group_id": str(first.sync_group_id)},
            decision=AuditLog.Decision.ALLOW,
            result={"platform_deleted": deleted_count, "wecom_deleted": len(native_ids)},
        )
        WorkTodo.objects.filter(id__in=[row.id for row in rows]).delete()
        return {
            "ok": True,
            "detail": "待办已从平台和企业微信删除。" if native_ids else "平台待办已删除。",
            "deletedCount": deleted_count,
            "weComDeleted": bool(native_ids),
        }


def _refresh_rows(*, config: WeComCliConfig, rows: list[WorkTodo]) -> int:
    if not rows:
        return 0
    client = WeComCliClient(config)
    grouped: dict[str, list[WorkTodo]] = {}
    for row in rows:
        todo_userid = row.wecom_todo_userid if row.wecom_todo_userid_encrypted else ""
        if not todo_userid:
            try:
                todo_userid = client.search_todo_userid(row.recipient_name)
            except WeComCliError:
                continue
            if todo_userid:
                row.wecom_todo_userid = todo_userid
                row.save(update_fields=["wecom_todo_userid_encrypted", "updated_at"])
        if todo_userid:
            grouped.setdefault(todo_userid, []).append(row)
    now = timezone.now()
    updated = 0
    for todo_userid, recipient_rows in grouped.items():
        try:
            native_rows = client.list_todos(follower_id=todo_userid)
        except WeComCliError:
            continue
        native_map = {str(item.get("todo_id") or ""): item for item in native_rows}
        for row in recipient_rows:
            native = native_map.get(row.wecom_todo_id)
            if not native:
                continue
            followers = (native.get("follower_list") or {}).get("followers") or []
            follower = next(
                (item for item in followers if str(item.get("follower_id") or "") == todo_userid),
                {},
            )
            user_status = int(follower.get("follower_status", native.get("user_status", 1)) or 1)
            completed = int(native.get("todo_status", 1) or 1) == 0 or user_status == 2
            WorkTodo.objects.filter(id=row.id).update(
                status=WorkTodo.Status.COMPLETED if completed else WorkTodo.Status.PENDING,
                completed_at=now if completed else None,
                sync_status=WorkTodo.SyncStatus.SYNCED,
                sync_error_code="",
                sync_error_reason="",
                last_synced_at=now,
                last_sync_source=WorkTodo.SyncSource.WECOM,
                updated_at=now,
            )
            updated += 1
    WorkTodo.objects.filter(id__in=[row.id for row in rows]).update(last_synced_at=now)
    return updated


def refresh_assignee_from_wecom(*, organization: Organization, assignee_id: int) -> int:
    config = WeComCliConfig.objects.filter(organization=organization).first()
    if not config or not config.configured:
        return 0
    rows = list(
        WorkTodo.objects.filter(
            organization=organization,
            recipient_type=WorkTodo.RecipientType.PLATFORM,
            assignee_id=assignee_id,
            sync_requested=True,
        ).exclude(wecom_todo_id_encrypted="")
    )
    return _refresh_rows(config=config, rows=rows)


def refresh_contact_from_wecom(*, organization: Organization, contact_id: int) -> int:
    config = WeComCliConfig.objects.filter(organization=organization).first()
    contact = WeComContact.objects.filter(
        id=contact_id,
        config__organization=organization,
        available=True,
    ).first()
    if not config or not config.configured or not contact:
        return 0
    rows = list(
        WorkTodo.objects.filter(
            organization=organization,
            recipient_type=WorkTodo.RecipientType.WECOM,
            wecom_contact=contact,
            sync_requested=True,
        ).exclude(wecom_todo_id_encrypted="")
    )
    return _refresh_rows(config=config, rows=rows)


def refresh_creator_todos_from_wecom(*, organization: Organization, creator_id: int, limit: int = 20) -> int:
    rows = WorkTodo.objects.filter(
        organization=organization,
        creator_id=creator_id,
        sync_requested=True,
        status=WorkTodo.Status.PENDING,
    ).exclude(wecom_todo_id_encrypted="")
    assignee_ids = list(
        rows.filter(recipient_type=WorkTodo.RecipientType.PLATFORM, assignee_id__isnull=False)
        .values_list("assignee_id", flat=True).distinct()[:limit]
    )
    remaining = max(limit - len(assignee_ids), 0)
    contact_ids = list(
        rows.filter(recipient_type=WorkTodo.RecipientType.WECOM, wecom_contact_id__isnull=False)
        .values_list("wecom_contact_id", flat=True).distinct()[:remaining]
    )
    return sum(refresh_assignee_from_wecom(organization=organization, assignee_id=user_id) for user_id in assignee_ids) + sum(
        refresh_contact_from_wecom(organization=organization, contact_id=contact_id) for contact_id in contact_ids
    )


def process_due_work_todo_syncs(*, limit: int = 100) -> int:
    now = timezone.now()
    group_ids = list(
        WorkTodo.objects.filter(sync_requested=True)
        .filter(
            Q(sync_status=WorkTodo.SyncStatus.PENDING)
            | Q(sync_status=WorkTodo.SyncStatus.FAILED, sync_next_retry_at__lte=now)
        )
        .filter(Q(sync_next_retry_at__isnull=True) | Q(sync_next_retry_at__lte=now))
        .order_by("sync_next_retry_at", "created_at")
        .values_list("sync_group_id", flat=True)
        .distinct()[:limit]
    )
    for group_id in group_ids:
        sync_work_todo_group(group_id, force=True)
    return len(group_ids)


def refresh_due_work_todos(*, limit: int = 100) -> int:
    cutoff = timezone.now() - timedelta(minutes=5)
    rows = list(
        WorkTodo.objects.filter(
            sync_requested=True,
            sync_status=WorkTodo.SyncStatus.SYNCED,
            status=WorkTodo.Status.PENDING,
        )
        .filter(Q(last_synced_at__isnull=True) | Q(last_synced_at__lte=cutoff))
        .order_by("last_synced_at")[:limit]
    )
    organizations = {
        row.id: row
        for row in Organization.objects.filter(id__in={item.organization_id for item in rows})
    }
    updated = 0
    seen: set[tuple[str, int, int]] = set()
    for row in rows:
        recipient_id = row.assignee_id if row.recipient_type == WorkTodo.RecipientType.PLATFORM else row.wecom_contact_id
        if not recipient_id:
            continue
        key = (row.recipient_type, row.organization_id, recipient_id)
        if key in seen:
            continue
        seen.add(key)
        organization = organizations.get(row.organization_id)
        if not organization:
            continue
        if row.recipient_type == WorkTodo.RecipientType.PLATFORM:
            updated += refresh_assignee_from_wecom(organization=organization, assignee_id=recipient_id)
        else:
            updated += refresh_contact_from_wecom(organization=organization, contact_id=recipient_id)
    return updated
