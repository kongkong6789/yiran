"""Shared WeCom queue processing for management command and in-process scheduler."""
from __future__ import annotations

from apps.wecom.binding_service import claim_sync_job, run_sync_job
from apps.wecom.event_processor import process_due_callback_events
from apps.wecom.models import WeComBindingSyncJob
from apps.wecom.notification_service import process_due_notifications
from apps.wecom.todo_sync_service import process_due_work_todo_syncs, refresh_due_work_todos


def process_wecom_queue_once(*, limit: int = 100) -> dict:
    batch = min(max(int(limit), 1), 500)
    notifications = process_due_notifications(limit=batch)
    events = process_due_callback_events(limit=batch)
    todo_syncs = process_due_work_todo_syncs(limit=batch)
    todo_refreshes = refresh_due_work_todos(limit=batch)
    job_ids = list(
        WeComBindingSyncJob.objects.filter(status=WeComBindingSyncJob.Status.PENDING)
        .order_by("created_at")
        .values_list("id", flat=True)[:batch]
    )
    bindings = 0
    for job_id in job_ids:
        job = claim_sync_job(job_id)
        if job:
            bindings += 1
            run_sync_job(job)
    return {
        "notifications": notifications,
        "events": events,
        "bindings": bindings,
        "todo_syncs": todo_syncs,
        "todo_refreshes": todo_refreshes,
    }
