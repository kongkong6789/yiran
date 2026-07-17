from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from .mentions import get_xiaoce_bot_user
from .models import CollabMessage, XiaoceRun

PAUSED_REPLY = "已暂停本次生成。"


def create_xiaoce_run(run_id, room, user, trigger_message):
    return XiaoceRun.objects.create(
        id=run_id,
        room=room,
        user=user,
        trigger_message=trigger_message,
    )


def is_xiaoce_run_cancelled(run_id) -> bool:
    return XiaoceRun.objects.filter(
        id=run_id,
        status=XiaoceRun.Status.CANCELLED,
    ).exists()


def xiaoce_run_payload(run: XiaoceRun | None) -> dict | None:
    if run is None:
        return None
    return {
        "id": str(run.id),
        "status": run.status,
        "room_id": str(run.room_id),
    }


def _complete_locked_run(
    locked: XiaoceRun,
    reply: str,
    meta: dict | None = None,
) -> CollabMessage:
    message = CollabMessage.objects.create(
        room=locked.room,
        sender=get_xiaoce_bot_user(),
        content=(reply or "")[:8000],
        attachments=[],
        mentions=[],
        msg_type="ai",
        ai_kind="xiaoce",
        meta={"run_id": str(locked.id), **(meta or {})},
    )
    locked.status = XiaoceRun.Status.COMPLETED
    locked.finished_at = timezone.now()
    locked.save(update_fields=["status", "finished_at", "updated_at"])
    locked.room.save(update_fields=["updated_at"])
    return message


@transaction.atomic
def cancel_xiaoce_run(run: XiaoceRun) -> XiaoceRun:
    locked = (
        XiaoceRun.objects.select_for_update()
        .select_related("room", "cancel_message")
        .get(id=run.id)
    )
    if locked.status == XiaoceRun.Status.COMPLETED:
        raise ValueError("本轮回答已经完成，无法暂停")
    if locked.status == XiaoceRun.Status.CANCELLED:
        return locked
    if locked.status == XiaoceRun.Status.FAILED:
        raise ValueError("本轮回答已经结束，无法暂停")

    now = timezone.now()
    locked.status = XiaoceRun.Status.CANCELLED
    locked.cancelled_at = now
    locked.finished_at = now
    locked.cancel_message = CollabMessage.objects.create(
        room=locked.room,
        sender=get_xiaoce_bot_user(),
        content=PAUSED_REPLY,
        attachments=[],
        mentions=[],
        msg_type="ai",
        ai_kind="xiaoce",
        meta={"run_id": str(locked.id), "cancelled": True},
    )
    locked.save(
        update_fields=[
            "status",
            "cancelled_at",
            "finished_at",
            "cancel_message",
            "updated_at",
        ],
    )
    locked.room.save(update_fields=["updated_at"])
    return locked


@transaction.atomic
def complete_xiaoce_run(
    run_id,
    reply: str,
    meta: dict | None = None,
) -> CollabMessage | None:
    locked = (
        XiaoceRun.objects.select_for_update()
        .select_related("room")
        .get(id=run_id)
    )
    if locked.status != XiaoceRun.Status.RUNNING:
        return None
    return _complete_locked_run(locked, reply, meta)


def fail_xiaoce_run(run_id, error) -> None:
    XiaoceRun.objects.filter(
        id=run_id,
        status=XiaoceRun.Status.RUNNING,
    ).update(
        status=XiaoceRun.Status.FAILED,
        error=str(error)[:2000],
        finished_at=timezone.now(),
    )
