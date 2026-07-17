"""会议邀请：落库 + 用户级 WebSocket 推送。"""
from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Meeting, MeetingInvite

logger = logging.getLogger(__name__)


def user_notify_group(user_id: int) -> str:
    return f"user_notify_{int(user_id)}"


def _display_name(user) -> str:
    try:
        settings_obj = user.settings
        name = (getattr(settings_obj, "display_name", None) or "").strip()
        if name:
            return name
    except Exception:
        pass
    return user.get_username()


def invite_payload(inv: MeetingInvite) -> dict:
    m = inv.meeting
    return {
        "invite_id": inv.id,
        "meeting_id": m.id,
        "title": m.title,
        "question": (m.question or "")[:120],
        "status": m.status,
        "inviter_name": _display_name(inv.invited_by) if inv.invited_by_id else "同事",
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
    }


def publish_user_event(user_id: int, event: str, data: dict) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(
            user_notify_group(user_id),
            {"type": "notify.push", "event": event, "data": data},
        )
    except Exception:
        logger.exception("user notify failed user=%s event=%s", user_id, event)


def issue_invites(
    meeting: Meeting,
    users,
    *,
    invited_by=None,
    exclude_user_ids: set[int] | None = None,
) -> list[MeetingInvite]:
    """为同事创建/刷新待处理邀请，并推送到其用户频道。"""
    exclude = set(exclude_user_ids or set())
    if invited_by is not None:
        exclude.add(invited_by.id)

    created: list[MeetingInvite] = []
    for user in users:
        if not user or user.id in exclude:
            continue
        inv, _ = MeetingInvite.objects.update_or_create(
            meeting=meeting,
            user=user,
            defaults={
                "invited_by": invited_by,
                "status": MeetingInvite.Status.PENDING,
            },
        )
        created.append(inv)
        publish_user_event(user.id, "council_invite", invite_payload(inv))
    return created
