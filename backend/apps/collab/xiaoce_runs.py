from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.core.conversation_skill import ConversationSkillError
from apps.skills.models import SkillAsset
from apps.skills.repository import save_skill_asset_from_bytes

from .mentions import get_xiaoce_bot_user
from .models import CollabMessage, XiaoceRun
from .xiaoce_progress import ERROR_MESSAGES, _upsert_step, xiaoce_run_payload

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


def _message_meta(run: XiaoceRun, process_status: str, **extra) -> dict:
    return {
        "run_id": str(run.id),
        "process_status": process_status,
        "process_steps": run.progress_steps or [],
        **extra,
    }


def _create_bot_message(run: XiaoceRun, content: str, meta: dict) -> CollabMessage:
    return CollabMessage.objects.create(
        room=run.room,
        sender=get_xiaoce_bot_user(),
        content=(content or "")[:8000],
        attachments=[],
        mentions=[],
        msg_type="ai",
        ai_kind="xiaoce",
        meta=meta,
    )


def _complete_locked_run(
    locked: XiaoceRun,
    reply: str,
    meta: dict | None = None,
) -> CollabMessage:
    message = _create_bot_message(
        locked,
        reply,
        _message_meta(locked, "completed", **(meta or {})),
    )
    locked.status = XiaoceRun.Status.COMPLETED
    locked.finished_at = timezone.now()
    locked.result_message = message
    locked.save(
        update_fields=["status", "finished_at", "result_message", "updated_at"],
    )
    locked.room.save(update_fields=["updated_at"])
    return message


@transaction.atomic
def cancel_xiaoce_run(run: XiaoceRun) -> XiaoceRun:
    locked = (
        XiaoceRun.objects.select_for_update()
        .select_related("room")
        .get(id=run.id)
    )
    if locked.status == XiaoceRun.Status.COMPLETED:
        raise ValueError("本轮回答已经完成，无法暂停")
    if locked.status == XiaoceRun.Status.CANCELLED:
        return locked
    if locked.status == XiaoceRun.Status.FAILED:
        raise ValueError("本轮回答已经结束，无法暂停")

    now = timezone.now()
    stage = locked.current_stage or "understanding"
    locked.current_stage = stage
    locked.progress_steps = _upsert_step(locked.progress_steps, stage, "cancelled")
    locked.status = XiaoceRun.Status.CANCELLED
    locked.error_code = "cancelled"
    locked.error = ERROR_MESSAGES["cancelled"]
    locked.cancelled_at = now
    locked.finished_at = now
    locked.cancel_message = _create_bot_message(
        locked,
        PAUSED_REPLY,
        _message_meta(locked, "cancelled", cancelled=True),
    )
    locked.save(
        update_fields=[
            "current_stage",
            "progress_steps",
            "status",
            "error_code",
            "error",
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


@transaction.atomic
def complete_xiaoce_run_with_skill(run_id, prepared) -> CollabMessage | None:
    locked = (
        XiaoceRun.objects.select_for_update()
        .select_related("room", "user")
        .get(id=run_id)
    )
    if locked.status != XiaoceRun.Status.RUNNING:
        return None
    asset, personal = save_skill_asset_from_bytes(
        locked.user,
        prepared.filename,
        prepared.package_data,
        adopt=True,
        visibility=SkillAsset.Visibility.PRIVATE,
        skill_id_override=prepared.skill_id,
    )
    if personal is None:
        raise ConversationSkillError("Skill 已生成但未能自动启用")
    locked.current_stage = "skill_upload"
    locked.progress_steps = _upsert_step(
        locked.progress_steps,
        "skill_upload",
        "completed",
    )
    locked.save(update_fields=["current_stage", "progress_steps", "updated_at"])
    created = {
        "asset_id": asset.id,
        "personal_id": personal.id,
        "skill_id": asset.skill_id,
        "name": personal.name,
        "description": personal.description,
        "visibility": asset.visibility,
        "enabled": personal.enabled,
        "package_kind": asset.package_kind,
        "storage": "cos" if asset.cos_bucket else "local",
    }
    reply = (
        f"已将这次对话提炼为 Skill「{personal.name}」，"
        "已自动上传并启用（仅你可见）。\n\n"
        f"Skill ID：`{asset.skill_id}`"
    )
    return _complete_locked_run(locked, reply, {"created_skill": created})


@transaction.atomic
def fail_xiaoce_run(
    run_id,
    error,
    *,
    error_code: str = "stage_failed",
) -> CollabMessage | None:
    locked = (
        XiaoceRun.objects.select_for_update()
        .select_related("room")
        .get(id=run_id)
    )
    if locked.status != XiaoceRun.Status.RUNNING:
        return None
    del error
    if error_code not in ERROR_MESSAGES:
        error_code = "stage_failed"
    stage = locked.current_stage or "understanding"
    locked.current_stage = stage
    locked.progress_steps = _upsert_step(locked.progress_steps, stage, "failed")
    locked.status = XiaoceRun.Status.FAILED
    locked.error_code = error_code
    locked.error = ERROR_MESSAGES[error_code]
    locked.finished_at = timezone.now()
    message = _create_bot_message(
        locked,
        f"执行失败：{locked.error}。",
        _message_meta(
            locked,
            "failed",
            error_code=locked.error_code,
            error_message=locked.error,
        ),
    )
    locked.result_message = message
    locked.save(
        update_fields=[
            "current_stage",
            "progress_steps",
            "status",
            "error_code",
            "error",
            "finished_at",
            "result_message",
            "updated_at",
        ],
    )
    locked.room.save(update_fields=["updated_at"])
    return message


__all__ = [
    "PAUSED_REPLY",
    "cancel_xiaoce_run",
    "complete_xiaoce_run",
    "complete_xiaoce_run_with_skill",
    "create_xiaoce_run",
    "fail_xiaoce_run",
    "is_xiaoce_run_cancelled",
    "xiaoce_run_payload",
]
