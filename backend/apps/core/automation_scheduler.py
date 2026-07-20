from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, time, timedelta

from django.db import connection, transaction
from django.db.models import F, Max, Q
from django.utils import timezone

from apps.orchestration.graph import run_sop
from apps.wecom.notification_service import send_task_notification

from .models import WorkAutomation, WorkAutomationRun, WorkTodo


CLAIM_TIMEOUT = timedelta(hours=1)


def _json_safe(value):
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def next_schedule_time(rule: str, *, after: datetime | None = None) -> datetime:
    """Return the first scheduled time strictly after ``after`` in the project timezone."""
    after = after or timezone.now()
    local_after = timezone.localtime(after)
    normalized = re.sub(r"\s+", " ", str(rule or "").strip())

    interval_match = re.fullmatch(r"每\s*(\d+)\s*小时", normalized)
    if interval_match:
        hours = int(interval_match.group(1))
        if not 1 <= hours <= 168:
            raise ValueError("每小时规则的间隔必须在 1 到 168 小时之间。")
        return after + timedelta(hours=hours)

    fixed_match = re.fullmatch(r"(每天|工作日)\s*(\d{1,2}):(\d{2})", normalized)
    if not fixed_match:
        raise ValueError("暂不支持该定时规则，请使用“每天 HH:MM”“工作日 HH:MM”或“每 N 小时”。")
    hour, minute = int(fixed_match.group(2)), int(fixed_match.group(3))
    if hour > 23 or minute > 59:
        raise ValueError("定时时间无效。")
    candidate = datetime.combine(local_after.date(), time(hour, minute), tzinfo=local_after.tzinfo)
    if candidate <= local_after:
        candidate += timedelta(days=1)
    if fixed_match.group(1) == "工作日":
        while candidate.weekday() >= 5:
            candidate += timedelta(days=1)
    return candidate.astimezone(timezone.get_current_timezone())


def configure_next_run(row: WorkAutomation, *, now: datetime | None = None) -> None:
    now = now or timezone.now()
    row.claim_token = None
    row.claimed_at = None
    if not row.enabled or row.trigger_type == WorkAutomation.TriggerType.MANUAL:
        row.next_run_at = None
    elif row.trigger_type == WorkAutomation.TriggerType.SCHEDULE:
        row.next_run_at = next_schedule_time(row.trigger_rule, after=now)
    else:
        # Data triggers keep a baseline cursor and are polled by refresh_data_triggers.
        row.next_run_at = None
        row.trigger_state = data_trigger_signature(row) or {}


def data_trigger_signature(row: WorkAutomation) -> dict:
    if row.trigger_rule == "待办状态变化时":
        latest = WorkTodo.objects.filter(organization=row.organization).aggregate(
            value=Max("updated_at"), max_id=Max("id")
        )
        return {
            "kind": "work_todo",
            "updatedAt": latest["value"].isoformat() if latest["value"] else None,
            "maxId": latest["max_id"],
        }
    if row.trigger_rule in {"经营数据更新时", "库存低于安全阈值时"}:
        return {"kind": "unsupported", "rule": row.trigger_rule}
    return {"kind": "unsupported", "rule": row.trigger_rule}


def initialize_missing_schedules(*, now: datetime | None = None, limit: int = 100) -> int:
    now = now or timezone.now()
    initialized = 0
    rows = WorkAutomation.objects.filter(
        enabled=True,
        trigger_type=WorkAutomation.TriggerType.SCHEDULE,
        next_run_at__isnull=True,
    ).order_by("id")[:limit]
    for row in rows:
        try:
            next_run_at = next_schedule_time(row.trigger_rule, after=now)
            initialized += WorkAutomation.objects.filter(pk=row.pk, next_run_at__isnull=True).update(
                next_run_at=next_run_at, last_error="",
            )
        except ValueError as exc:
            WorkAutomation.objects.filter(pk=row.pk).update(last_error=str(exc)[:500])
    return initialized


def refresh_data_triggers(*, now: datetime | None = None, limit: int = 100) -> int:
    now = now or timezone.now()
    changed = 0
    rows = WorkAutomation.objects.filter(
        enabled=True, trigger_type=WorkAutomation.TriggerType.DATA, next_run_at__isnull=True,
    ).order_by("id")[:limit]
    for row in rows:
        signature = data_trigger_signature(row)
        previous = row.trigger_state or {}
        if signature.get("kind") == "unsupported":
            WorkAutomation.objects.filter(pk=row.pk).update(last_error="暂不支持该数据触发规则。")
            continue
        if not previous:
            WorkAutomation.objects.filter(pk=row.pk).update(trigger_state=signature)
            continue
        if signature != previous and signature.get("available", True):
            updated = WorkAutomation.objects.filter(pk=row.pk, next_run_at__isnull=True).update(
                trigger_state=signature, next_run_at=now, last_error="",
            )
            changed += updated
    return changed


def _claim_queryset(now: datetime):
    stale_before = now - CLAIM_TIMEOUT
    queryset = WorkAutomation.objects.filter(
        enabled=True, next_run_at__isnull=False, next_run_at__lte=now,
    ).filter(Q(claim_token__isnull=True) | Q(claimed_at__lt=stale_before)).order_by("next_run_at", "id")
    if connection.features.has_select_for_update:
        kwargs = {"skip_locked": True} if connection.features.has_select_for_update_skip_locked else {}
        queryset = queryset.select_for_update(**kwargs)
    return queryset


def claim_due_automation(*, now: datetime | None = None) -> tuple[WorkAutomation, datetime] | None:
    now = now or timezone.now()
    with transaction.atomic():
        row = _claim_queryset(now).first()
        if row is None:
            return None
        scheduled_for = row.next_run_at
        row.claim_token = uuid.uuid4()
        row.claimed_at = now
        row.save(update_fields=["claim_token", "claimed_at", "updated_at"])
        return row, scheduled_for


def execute_automation(row: WorkAutomation, *, scheduled_for: datetime, trigger_source: str | None = None) -> WorkAutomationRun:
    trace_id = f"automation-{row.id}-{uuid.uuid4().hex[:16]}"
    run = WorkAutomationRun.objects.create(
        automation=row,
        organization=row.organization,
        creator=row.creator,
        trigger_source=trigger_source or row.trigger_type,
        trace_id=trace_id,
        scheduled_for=scheduled_for,
    )
    status_value = WorkAutomationRun.Status.FAILED
    error = ""
    notification_status = ""
    notification_record_id = None
    output: dict = {}
    try:
        local_scheduled = timezone.localtime(scheduled_for)
        output = run_sop(
            row.action,
            {
                "automation_id": row.id,
                "automation_name": row.name,
                "automation_trigger": row.trigger_type,
                "trigger_rule": row.trigger_rule,
                "scheduled_for": scheduled_for.isoformat(),
                "dt": (local_scheduled.date() - timedelta(days=1)).isoformat(),
                "scope": row.organization.name,
            },
            "operator",
            trace_id=trace_id,
        )
        decision = str(output.get("decision") or "")
        if decision == "allow" and output.get("result", {}).get("ok", True) is not False:
            status_value = WorkAutomationRun.Status.SUCCESS
        elif decision == "need_approval":
            status_value = WorkAutomationRun.Status.NEED_APPROVAL
        elif decision == "need_input":
            status_value = WorkAutomationRun.Status.NEED_INPUT
        elif decision == "block":
            status_value = WorkAutomationRun.Status.BLOCKED
        else:
            error = str(output.get("result", {}).get("error") or "自动化执行未返回成功结果。")

        if status_value == WorkAutomationRun.Status.SUCCESS and row.notification_channel == WorkAutomation.NotificationChannel.WECOM:
            record = send_task_notification(user=row.creator, data={
                "mode": "person",
                "recipientContactIds": row.recipient_contact_ids,
                "task": f"[自动化执行] {row.name}\n{row.action}",
                "agentName": "自动化助手",
                "targetLabel": row.name,
                "taskTraceId": trace_id,
                "idempotencyKey": f"{trace_id}:automation-run",
            })
            notification_status = record.status
            notification_record_id = record.id
            if record.status == "failed":
                error = record.error_reason or "企业微信通知发送失败。"
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"[:1000]
        output = output or {}
        status_value = WorkAutomationRun.Status.FAILED

    finished_at = timezone.now()
    run.status = status_value
    run.decision = str(output.get("decision") or "")[:32]
    run.action_name = str(output.get("action") or "")[:128]
    run.result = _json_safe(output.get("result") or {})
    run.steps = _json_safe(output.get("steps") or [])
    run.error = error[:1000]
    run.notification_status = notification_status
    run.notification_record_id = notification_record_id
    run.finished_at = finished_at
    run.save()
    next_run_at = (
        next_schedule_time(row.trigger_rule, after=max(finished_at, scheduled_for))
        if row.trigger_type == WorkAutomation.TriggerType.SCHEDULE
        else None
    )
    WorkAutomation.objects.filter(pk=row.pk, claim_token=row.claim_token).update(
        last_run_at=finished_at,
        last_run_status=status_value,
        last_error=error[:500],
        run_count=F("run_count") + 1,
        next_run_at=next_run_at,
        claim_token=None,
        claimed_at=None,
    )
    return run


def process_due_automations(*, limit: int = 50) -> int:
    processed = 0
    for _ in range(max(1, min(limit, 500))):
        claim = claim_due_automation()
        if claim is None:
            break
        row, scheduled_for = claim
        execute_automation(row, scheduled_for=scheduled_for)
        processed += 1
    return processed
