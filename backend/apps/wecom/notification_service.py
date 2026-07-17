from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import WeComApiConfig, WeComGroupWebhook, WeComNotificationRecord
from .services import WeComApiError, WeComClient, send_group_webhook_markdown
from .access import resolve_accessible_config, resolve_accessible_webhook


PRIORITY_LABELS = {"normal": "普通", "high": "高", "urgent": "紧急"}
RETRY_DELAYS = [timedelta(minutes=5), timedelta(minutes=30), timedelta(hours=2), timedelta(days=1)]


def build_task_message(data: dict) -> str:
    lines = [
        "【新任务通知】", "",
        f"任务：{data['task'].strip()}",
        f"执行智能体：{data.get('agentName') or '通用智能体'}",
        f"优先级：{PRIORITY_LABELS.get(data.get('priority'), '普通')}",
    ]
    if data.get("deadline"):
        lines.append(f"截止时间：{data['deadline']}")
    lines.extend(["", "任务已进入良策智能协作工作台，请及时处理。"])
    return "\n".join(lines)[:2048]


def _deadline_label(raw: str) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%Y年%m月%d日 %H:%M")
    except ValueError:
        return value.replace("T", " ")


def _markdown_text(value: object) -> str:
    return str(value or "").strip().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\r", " ").replace("\n", " ")


def build_group_task_markdown(data: dict) -> str:
    priority = PRIORITY_LABELS.get(data.get("priority"), "普通")
    color = "warning" if data.get("priority") in {"high", "urgent"} else "comment"
    lines = [
        "## 📌 新任务通知",
        f"> **任务：** {_markdown_text(data['task'])}",
        f"> **执行智能体：** {_markdown_text(data.get('agentName') or '通用智能体')}",
        f"> **优先级：** <font color=\"{color}\">{priority}</font>",
    ]
    deadline = _deadline_label(data.get("deadline", ""))
    if deadline:
        lines.append(f"> **截止时间：** {deadline}")
    lines.extend(["", "<font color=\"info\">任务已进入良策智能协作工作台，请及时处理。</font>"])
    return "\n".join(lines)[:4096]


def _idempotency_key(user_id: int, raw_key: str) -> str | None:
    raw = str(raw_key or "").strip()
    if not raw:
        return None
    return hashlib.sha256(f"{user_id}:{raw}".encode("utf-8")).hexdigest()


def _mark_webhook_success(webhook: WeComGroupWebhook) -> None:
    WeComGroupWebhook.objects.filter(pk=webhook.pk).update(
        last_success_at=timezone.now(), last_error_code="", last_error_reason="",
    )


def _mark_webhook_failure(webhook: WeComGroupWebhook | None, exc: WeComApiError) -> None:
    if webhook:
        WeComGroupWebhook.objects.filter(pk=webhook.pk).update(
            last_failure_at=timezone.now(), last_error_code=exc.code, last_error_reason=exc.detail[:500],
        )


def _attempt(record: WeComNotificationRecord) -> WeComNotificationRecord:
    record.last_attempt_at = timezone.now()
    record.next_retry_at = None
    try:
        if record.channel == WeComNotificationRecord.Channel.PERSON:
            config = record.config or resolve_accessible_config(record.user)
            if not config or not config.configured or not config.can_use(record.user):
                raise WeComApiError("WECOM_NOT_AUTHORIZED", "当前企业未配置企业微信应用，或你没有使用权限。", status_code=403)
            record.config = config
            result = WeComClient(config).send_app_text(record.target_ids, record.content)
            record.wecom_msgid = result["msgid"]
            record.invalid_users = result["invalidUsers"]
            record.status = WeComNotificationRecord.Status.PARTIAL if result["invalidUsers"] else WeComNotificationRecord.Status.ACCEPTED
        else:
            webhook = record.group_webhook
            if not webhook or not webhook.can_use(record.user):
                raise WeComApiError("WECOM_GROUP_WEBHOOK_NOT_AUTHORIZED", "群机器人不存在、已停用或你没有使用权限。", status_code=403)
            send_group_webhook_markdown(webhook.webhook_key, record.content)
            _mark_webhook_success(webhook)
            record.status = WeComNotificationRecord.Status.ACCEPTED
        record.accepted_at = timezone.now()
        record.error_code = ""
        record.error_reason = ""
    except WeComApiError as exc:
        _mark_webhook_failure(record.group_webhook, exc)
        record.error_code = exc.code
        record.error_reason = exc.detail[:500]
        if exc.retryable and record.retry_count < record.max_retries:
            delay = RETRY_DELAYS[min(record.retry_count, len(RETRY_DELAYS) - 1)]
            record.status = WeComNotificationRecord.Status.RETRY_WAITING
            record.next_retry_at = timezone.now() + delay
        else:
            record.status = WeComNotificationRecord.Status.FAILED
    record.save()
    from apps.core.models import WorkTask
    WorkTask.objects.filter(notification_record_id=record.id).update(
        notification_status=record.status,
        updated_at=timezone.now(),
    )
    return record


def send_task_notification(*, user, data: dict) -> WeComNotificationRecord:
    content = build_group_task_markdown(data) if data["mode"] == WeComNotificationRecord.Channel.GROUP else build_task_message(data)
    key = _idempotency_key(user.id, data.get("idempotencyKey", ""))
    with transaction.atomic():
        if key:
            existing = WeComNotificationRecord.objects.select_for_update().filter(idempotency_key=key).first()
            if existing:
                return existing
        webhook = None
        target_label = data.get("targetLabel", "")
        if data["mode"] == WeComNotificationRecord.Channel.GROUP:
            webhook = resolve_accessible_webhook(user, data["groupWebhookId"])
            if not webhook:
                raise WeComApiError("WECOM_GROUP_WEBHOOK_NOT_FOUND", "群机器人不存在或你没有使用权限。", status_code=404)
            target_label = webhook.name
        record = WeComNotificationRecord.objects.create(
            user=user, channel=data["mode"], config=resolve_accessible_config(user),
            group_webhook=webhook, target_ids=data.get("recipientUserIds", []), target_label=target_label,
            content=content, content_preview=content[:500], task_trace_id=data.get("taskTraceId", ""),
            idempotency_key=key, status=WeComNotificationRecord.Status.PENDING,
        )
    return _attempt(record)


def retry_notification(record: WeComNotificationRecord, *, force: bool = False) -> WeComNotificationRecord:
    with transaction.atomic():
        locked = WeComNotificationRecord.objects.select_for_update().get(pk=record.pk)
        if locked.status in {WeComNotificationRecord.Status.ACCEPTED, WeComNotificationRecord.Status.PARTIAL} and not force:
            return locked
        if locked.retry_count >= locked.max_retries and not force:
            return locked
        locked.retry_count += 1
        locked.status = WeComNotificationRecord.Status.PENDING
        locked.save(update_fields=["retry_count", "status"])
    return _attempt(locked)


def process_due_notifications(*, limit: int = 100) -> int:
    ids = list(WeComNotificationRecord.objects.filter(
        status=WeComNotificationRecord.Status.RETRY_WAITING,
        next_retry_at__lte=timezone.now(), retry_count__lt=F("max_retries"),
    ).order_by("next_retry_at").values_list("id", flat=True)[:limit])
    for record_id in ids:
        retry_notification(WeComNotificationRecord.objects.get(pk=record_id))
    return len(ids)
