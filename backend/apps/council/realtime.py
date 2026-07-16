"""圆桌会议 WebSocket 推送。"""
from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def meeting_group(meeting_id: int) -> str:
    return f"council_meeting_{int(meeting_id)}"


def publish_meeting(meeting_id: int, event: str, data: dict | None = None) -> None:
    """向会议室房间广播事件（同步视图/引擎里调用）。"""
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(
            meeting_group(meeting_id),
            {
                "type": "meeting.push",
                "event": event,
                "data": data or {},
            },
        )
    except Exception:
        logger.exception("council ws publish failed meeting=%s event=%s", meeting_id, event)


def publish_messages(meeting, messages: list[dict]) -> None:
    if not messages:
        return
    publish_meeting(
        meeting.id,
        "messages",
        {
            "status": meeting.status,
            "round": meeting.round,
            "results": messages,
        },
    )


def publish_status(meeting) -> None:
    publish_meeting(
        meeting.id,
        "status",
        {
            "status": meeting.status,
            "round": meeting.round,
        },
    )
