"""协作会话 WebSocket 推送。"""
from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def room_group(room_id) -> str:
    return f"collab_room_{room_id}"


def publish_room(room_id, event: str, data: dict | None = None) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(
            room_group(room_id),
            {
                "type": "room.push",
                # Bind every event to the room selected by the publisher.  The
                # consumer verifies this value before forwarding the payload,
                # so a stale/mistargeted channel-layer event cannot cross rooms.
                "room_id": str(room_id),
                "event": event,
                "data": data or {},
            },
        )
    except Exception:
        logger.exception("collab ws publish failed room=%s event=%s", room_id, event)


def publish_sync(
    room_id,
    *,
    messages=None,
    changed=None,
    insights=None,
    room=None,
    xiaoce_runs=None,
    xiaoce_streams=None,
    read_receipts=None,
) -> None:
    """与前端 CollabSyncEvent / 旧 SSE sync 对齐。"""
    payload: dict = {}
    if messages:
        payload["messages"] = messages
        payload["after_id"] = messages[-1].get("id")
    if changed:
        payload["changed"] = changed
    if insights:
        payload["insights"] = insights
        payload["after_insight_id"] = insights[-1].get("id")
    if room:
        payload["room"] = room
    if xiaoce_runs:
        payload["xiaoce_runs"] = xiaoce_runs
    if xiaoce_streams:
        payload["xiaoce_streams"] = xiaoce_streams
    if read_receipts:
        payload["read_receipts"] = read_receipts
    if not payload:
        return
    publish_room(room_id, "sync", payload)
