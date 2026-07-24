from __future__ import annotations

import logging

from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.core.conversation_skill import ConversationSkillError
from apps.skills.models import SkillAsset, UserSkill
from apps.skills.repository import (
    delete_skill_storage,
    save_skill_asset_from_bytes,
    skill_asset_storage_snapshot,
)

from .mentions import get_collab_ai_user, get_xiaoce_bot_user
from .models import CollabMessage, CollabRoom, XiaoceRun
from .xiaoce_progress import ERROR_MESSAGES, _upsert_step, xiaoce_run_payload

PAUSED_REPLY = "已暂停本次生成。"
logger = logging.getLogger(__name__)


def _lock_room_then_run(run_id, *, room_id=None, with_user: bool = False):
    if room_id is None:
        room_id = (
            XiaoceRun.objects.filter(id=run_id)
            .values_list("room_id", flat=True)
            .first()
        )
    if room_id is None:
        return None, None
    room = CollabRoom.objects.select_for_update().filter(id=room_id).first()
    if room is None:
        return None, None
    query = XiaoceRun.objects.select_for_update()
    if with_user:
        query = query.select_related("user")
    locked = query.filter(id=run_id, room_id=room.id).first()
    if locked is not None:
        locked.room = room
    return room, locked


def create_xiaoce_run(run_id, room, user, trigger_message):
    return XiaoceRun.objects.create(
        id=run_id,
        room=room,
        user=user,
        trigger_message=trigger_message,
    )


def is_xiaoce_run_cancelled(run_id) -> bool:
    status = (
        XiaoceRun.objects.filter(id=run_id)
        .values_list("status", flat=True)
        .first()
    )
    return status is None or status == XiaoceRun.Status.CANCELLED


def _message_meta(run: XiaoceRun, process_status: str, **extra) -> dict:
    agent_kind = "mention" if (run.trigger_message.meta or {}).get("agent_kind") == "mention" else "xiaoce"
    return {
        "run_id": str(run.id),
        "process_status": process_status,
        "process_steps": run.progress_steps or [],
        "agent_kind": agent_kind,
        **extra,
    }


def _create_bot_message(run: XiaoceRun, content: str, meta: dict) -> CollabMessage:
    is_mention = (run.trigger_message.meta or {}).get("agent_kind") == "mention"
    return CollabMessage.objects.create(
        room=run.room,
        sender=get_collab_ai_user() if is_mention else get_xiaoce_bot_user(),
        content=(content or "")[:8000],
        attachments=[],
        mentions=[],
        msg_type="ai",
        ai_kind="reply" if is_mention else "xiaoce",
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
    _, locked = _lock_room_then_run(run.id, room_id=run.room_id)
    if locked is None:
        raise ValueError("本轮回答已经结束，无法暂停")
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
def cancel_xiaoce_runs_for_room_deletion(room: CollabRoom) -> int:
    locked_room = CollabRoom.objects.select_for_update().filter(id=room.id).first()
    if locked_room is None:
        return 0
    now = timezone.now()
    return XiaoceRun.objects.filter(
        room=locked_room,
        status=XiaoceRun.Status.RUNNING,
    ).update(
        status=XiaoceRun.Status.CANCELLED,
        error_code="cancelled",
        error=ERROR_MESSAGES["cancelled"],
        cancelled_at=now,
        finished_at=now,
        updated_at=now,
    )


@transaction.atomic
def complete_xiaoce_run(
    run_id,
    reply: str,
    meta: dict | None = None,
) -> CollabMessage | None:
    _, locked = _lock_room_then_run(run_id)
    if locked is None or locked.status != XiaoceRun.Status.RUNNING:
        return None
    return _complete_locked_run(locked, reply, meta)


def _staging_skill_id(skill_id: str, run_id) -> tuple[str, str]:
    stable_id = slugify(skill_id, allow_unicode=False)[:64]
    if not stable_id:
        raise ValueError("Skill ID 无效")
    suffix = f"-stage-{run_id.hex}"
    return stable_id, f"{stable_id[:64 - len(suffix)]}{suffix}"


def _cleanup_staged_skill(user, staging_id: str) -> None:
    try:
        UserSkill.objects.filter(user=user, skill_id=staging_id).delete()
    except Exception:
        logger.exception("failed to clean staged Xiaoce UserSkill %s", staging_id)
    asset = SkillAsset.objects.filter(uploader=user, skill_id=staging_id).first()
    if asset is None:
        return
    try:
        delete_skill_storage(skill_asset_storage_snapshot(asset))
    except Exception:
        logger.exception("failed to clean staged Xiaoce skill storage %s", staging_id)
    try:
        asset.delete()
    except Exception:
        logger.exception("failed to clean staged Xiaoce SkillAsset %s", staging_id)


def _adopt_staged_skill(
    user,
    staged_asset: SkillAsset,
    staged_personal: UserSkill,
    stable_id: str,
) -> tuple[SkillAsset, UserSkill, dict | None]:
    final_asset = (
        SkillAsset.objects.select_for_update()
        .filter(uploader=user, skill_id=stable_id)
        .first()
    )
    final_personal = (
        UserSkill.objects.select_for_update()
        .filter(user=user, skill_id=stable_id)
        .first()
    )
    if final_asset is not None:
        has_foreign_adopters = final_asset.adoptions.exclude(user=user).exists()
        if (
            final_asset.visibility == SkillAsset.Visibility.SHARED
            or has_foreign_adopters
        ):
            raise ConversationSkillError("同名 Skill 已共享或已被其他用户启用，无法覆盖")
    old_storage = skill_asset_storage_snapshot(final_asset) if final_asset else None
    asset_fields = [
        "name",
        "visibility",
        "description",
        "original_filename",
        "cos_bucket",
        "cos_key",
        "cos_url",
        "file_size",
        "instructions_preview",
        "package_kind",
        "package_manifest",
        "skill_md_key",
    ]
    personal_fields = ["name", "description", "raw_content", "instructions", "enabled"]

    if final_asset is None:
        staged_asset.skill_id = stable_id
        staged_asset.save(update_fields=["skill_id", "updated_at"])
        final_asset = staged_asset
    else:
        for field in asset_fields:
            setattr(final_asset, field, getattr(staged_asset, field))
        final_asset.save(update_fields=[*asset_fields, "updated_at"])

    if final_personal is None:
        staged_personal.skill_id = stable_id
        staged_personal.source_asset = final_asset
        staged_personal.save(update_fields=["skill_id", "source_asset", "updated_at"])
        final_personal = staged_personal
    else:
        for field in personal_fields:
            setattr(final_personal, field, getattr(staged_personal, field))
        final_personal.source_asset = final_asset
        final_personal.save(update_fields=[*personal_fields, "source_asset", "updated_at"])

    if staged_personal.id != final_personal.id:
        staged_personal.delete()
    if staged_asset.id != final_asset.id:
        staged_asset.delete()
    return final_asset, final_personal, old_storage


def complete_xiaoce_run_with_skill(run_id, prepared) -> CollabMessage | None:
    candidate = (
        XiaoceRun.objects.select_related("user")
        .filter(id=run_id, status=XiaoceRun.Status.RUNNING)
        .first()
    )
    if candidate is None:
        return None
    stable_id, staging_id = _staging_skill_id(prepared.skill_id, candidate.id)
    staged_asset = None
    staged_personal = None
    try:
        staged_asset, staged_personal = save_skill_asset_from_bytes(
            candidate.user,
            prepared.filename,
            prepared.package_data,
            adopt=True,
            visibility=SkillAsset.Visibility.PRIVATE,
            skill_id_override=staging_id,
            rollback_storage_on_failure=True,
        )
        if staged_personal is None:
            raise ConversationSkillError("Skill 已生成但未能自动启用")
    except Exception:
        _cleanup_staged_skill(candidate.user, staging_id)
        raise

    old_storage = None
    message = None
    try:
        with transaction.atomic():
            _, locked = _lock_room_then_run(
                run_id,
                room_id=candidate.room_id,
                with_user=True,
            )
            if (
                locked is not None
                and locked.status == XiaoceRun.Status.RUNNING
                and locked.user_id == candidate.user_id
            ):
                staged_asset = SkillAsset.objects.select_for_update().get(id=staged_asset.id)
                staged_personal = UserSkill.objects.select_for_update().get(id=staged_personal.id)
                asset, personal, old_storage = _adopt_staged_skill(
                    locked.user,
                    staged_asset,
                    staged_personal,
                    stable_id,
                )
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
                message = _complete_locked_run(locked, reply, {"created_skill": created})
    except Exception:
        _cleanup_staged_skill(candidate.user, staging_id)
        raise

    if message is None:
        _cleanup_staged_skill(candidate.user, staging_id)
        return None
    if old_storage is not None:
        try:
            delete_skill_storage(old_storage)
        except Exception:
            logger.exception("failed to clean replaced Xiaoce skill storage %s", stable_id)
    return message


@transaction.atomic
def fail_xiaoce_run(
    run_id,
    error,
    *,
    error_code: str = "stage_failed",
) -> CollabMessage | None:
    _, locked = _lock_room_then_run(run_id)
    if locked is None or locked.status != XiaoceRun.Status.RUNNING:
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
    "cancel_xiaoce_runs_for_room_deletion",
    "complete_xiaoce_run",
    "complete_xiaoce_run_with_skill",
    "create_xiaoce_run",
    "fail_xiaoce_run",
    "is_xiaoce_run_cancelled",
    "xiaoce_run_payload",
]
