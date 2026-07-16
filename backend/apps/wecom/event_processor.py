from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.core.models import AuditLog, TaskResultRecord

from .binding_service import create_sync_job
from .contact_service import sync_contacts
from .models import WeComBindingSyncJob, WeComCallbackEvent


RETRY_DELAYS = [timedelta(minutes=5), timedelta(minutes=30), timedelta(hours=2), timedelta(days=1)]


def _task_trace(event_key: str) -> str:
    value = str(event_key or "")
    for prefix in ("task:", "task_", "TASK:"):
        if value.startswith(prefix):
            return value[len(prefix):].split(":", 1)[0]
    return ""


def process_callback_event(event: WeComCallbackEvent) -> WeComCallbackEvent:
    with transaction.atomic():
        row = WeComCallbackEvent.objects.select_for_update().select_related("config", "config__user").get(pk=event.pk)
        if row.processing_status == WeComCallbackEvent.ProcessingStatus.COMPLETED:
            return row
        row.processing_status = WeComCallbackEvent.ProcessingStatus.PROCESSING
        row.attempt_count += 1
        row.save(update_fields=["processing_status", "attempt_count"])
    try:
        result: dict = {"action": "recorded"}
        if row.event_type == "change_contact" or row.change_type in {
            "create_user", "update_user", "delete_user", "create_party", "update_party", "delete_party",
        }:
            contacts = sync_contacts(row.config)
            pending = WeComBindingSyncJob.objects.filter(config=row.config, status=WeComBindingSyncJob.Status.PENDING).first()
            job = pending or create_sync_job(config=row.config, source="scheduled_sync", batch_size=100)
            result = {"action": "contacts_refreshed_and_binding_sync_queued", "contacts": len(contacts), "job_id": job.id}
        elif row.msg_type == "text":
            AuditLog.objects.get_or_create(
                trace_id=f"wecom-{row.dedup_key[:24]}", action="wecom.callback.message",
                defaults={"actor": row.from_user_id or "wecom", "intent": "企业微信应用消息", "payload": row.payload, "decision": AuditLog.Decision.ALLOW, "result": {"received": True}},
            )
            result = {"action": "message_recorded"}
        elif row.event_type in {"click", "view"}:
            trace_id = _task_trace(row.event_key)
            task = TaskResultRecord.objects.filter(user=row.config.user, trace_id=trace_id).first() if trace_id else None
            if task:
                snapshot = dict(task.snapshot or {})
                events = list(snapshot.get("wecomMenuEvents") or [])
                events.append({"eventKey": row.event_key, "fromUserId": row.from_user_id, "receivedAt": row.received_at.isoformat()})
                snapshot["wecomMenuEvents"] = events[-20:]
                task.snapshot = snapshot
                task.save(update_fields=["snapshot", "updated_at"])
                result = {"action": "task_updated", "trace_id": trace_id}
            else:
                result = {"action": "menu_event_recorded", "trace_id": trace_id}
        row.processing_status = WeComCallbackEvent.ProcessingStatus.COMPLETED
        row.processing_result = result
        row.processed_at = timezone.now()
        row.next_retry_at = None
        row.failure_reason = ""
    except Exception as exc:
        row.failure_reason = str(exc)[:500]
        if row.attempt_count <= len(RETRY_DELAYS):
            row.processing_status = WeComCallbackEvent.ProcessingStatus.RETRY_WAITING
            row.next_retry_at = timezone.now() + RETRY_DELAYS[row.attempt_count - 1]
        else:
            row.processing_status = WeComCallbackEvent.ProcessingStatus.FAILED
    row.save()
    return row


def process_due_callback_events(*, limit: int = 100) -> int:
    now = timezone.now()
    ids = list(WeComCallbackEvent.objects.filter(processing_status__in=[
        WeComCallbackEvent.ProcessingStatus.PENDING,
        WeComCallbackEvent.ProcessingStatus.RETRY_WAITING,
    ]).filter(next_retry_at__isnull=True).values_list("id", flat=True)[:limit])
    retry_ids = list(WeComCallbackEvent.objects.filter(
        processing_status=WeComCallbackEvent.ProcessingStatus.RETRY_WAITING,
        next_retry_at__lte=now,
    ).values_list("id", flat=True)[:max(0, limit - len(ids))])
    for event_id in [*ids, *retry_ids]:
        process_callback_event(WeComCallbackEvent.objects.get(pk=event_id))
    return len(ids) + len(retry_ids)
