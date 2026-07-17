from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.core.conversation_skill import ConversationSkillError
from apps.skills.models import SkillAsset
from apps.skills.repository import save_skill_asset_from_bytes

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


def fail_xiaoce_run(run_id, error) -> None:
    XiaoceRun.objects.filter(
        id=run_id,
        status=XiaoceRun.Status.RUNNING,
    ).update(
        status=XiaoceRun.Status.FAILED,
        error=str(error)[:2000],
        finished_at=timezone.now(),
    )
