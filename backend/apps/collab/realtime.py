"""协作会话实时推送（SSE）：取代前端高频轮询。"""
from __future__ import annotations

import json
import time
from datetime import timedelta

from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, renderer_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import BaseRenderer
from rest_framework.response import Response

from .models import CollabInsight, CollabMessage, CollabParticipant, CollabRoom
from .presence import presence_map, touch_presence


class EventStreamRenderer(BaseRenderer):
    """让 DRF 接受 Accept: text/event-stream，避免 406 风暴。"""
    media_type = "text/event-stream"
    format = "event-stream"
    charset = None

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data


def _helpers():
    """延迟导入，避免与 views 循环依赖。"""
    from . import views as v
    return v


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@api_view(["GET"])
@renderer_classes([EventStreamRenderer])
@permission_classes([IsAuthenticated])
def room_events(request, room_id):
    """
    Server-Sent Events：推送新消息 / 撤回变更 / 新洞察。
    短连接（约 90s）后发 reconnect，由前端自动续连。
    """
    v = _helpers()
    touch_presence(request.user)
    room = get_object_or_404(CollabRoom, id=room_id)
    if not v._can_access_room(request.user, room):
        return StreamingHttpResponse(
            (_sse("error", {"error": "无权访问该会话"}) for _ in range(1)),
            content_type="text/event-stream",
            status=403,
        )

    try:
        after_id = int(request.query_params.get("after_id") or 0)
    except (TypeError, ValueError):
        after_id = 0
    try:
        after_insight_id = int(request.query_params.get("after_insight_id") or 0)
    except (TypeError, ValueError):
        after_insight_id = 0

    state = {"after_id": after_id, "after_insight_id": after_insight_id, "ticks": 0}

    def event_stream():
        yield _sse("hello", {"room_id": str(room.id), "after_id": state["after_id"]})
        while state["ticks"] < 60:
            state["ticks"] += 1
            if state["ticks"] % 8 == 0:
                try:
                    touch_presence(request.user)
                except Exception:
                    pass

            nick_map = v._nickname_map(room)
            new_rows = list(
                CollabMessage.objects.filter(room_id=room.id, id__gt=state["after_id"])
                .select_related("sender")
                .order_by("id")[:80]
            )
            changed_rows = []
            if state["after_id"] > 0:
                changed_rows = list(
                    CollabMessage.objects.filter(
                        room_id=room.id,
                        id__lte=state["after_id"],
                        updated_at__gte=timezone.now() - timedelta(minutes=3),
                    )
                    .select_related("sender")
                    .order_by("-updated_at")[:40]
                )
            insight_rows = list(
                CollabInsight.objects.filter(room_id=room.id, id__gt=state["after_insight_id"])
                .order_by("id")[:20]
            )

            if new_rows or changed_rows or insight_rows:
                sender_ids = list(
                    {m.sender_id for m in new_rows} | {m.sender_id for m in changed_rows}
                )
                profiles = v._profile_map(sender_ids)
                if new_rows:
                    state["after_id"] = new_rows[-1].id
                if insight_rows:
                    state["after_insight_id"] = insight_rows[-1].id
                room.refresh_from_db(fields=["status", "risk_level", "updated_at", "room_kind"])
                member_ids = list(
                    CollabParticipant.objects.filter(room_id=room.id).values_list("user_id", flat=True)
                )
                pmap = presence_map(member_ids)
                online_count = sum(1 for uid in member_ids if pmap.get(uid, {}).get("online"))
                peer_online = None
                if room.room_kind == "dm":
                    peer_id = next((uid for uid in member_ids if uid != request.user.id), None)
                    peer_online = bool(pmap.get(peer_id or 0, {}).get("online"))
                yield _sse("sync", {
                    "messages": [
                        v._message_payload(m, nickname_map=nick_map, profile_map=profiles)
                        for m in new_rows
                    ],
                    "changed": [
                        v._message_payload(m, nickname_map=nick_map, profile_map=profiles)
                        for m in changed_rows
                    ],
                    "insights": [v._insight_payload(i) for i in insight_rows],
                    "room": {
                        "id": str(room.id),
                        "status": room.status,
                        "risk_level": room.risk_level,
                        "updated_at": room.updated_at.isoformat(),
                        "online_count": online_count,
                        "peer_online": peer_online,
                        "active_xiaoce_run": v._active_xiaoce_run_payload(
                            room,
                            request.user,
                        ),
                    },
                    "after_id": state["after_id"],
                    "after_insight_id": state["after_insight_id"],
                })
            else:
                yield _sse("ping", {"t": int(time.time())})

            time.sleep(1.5)

        yield _sse("reconnect", {"after_id": state["after_id"], "after_insight_id": state["after_insight_id"]})

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    # 勿设 Connection: keep-alive——Django runserver/WSGI 会抛
    # AssertionError: Hop-by-hop header not allowed，导致 SSE 500 风暴拖垮发送。
    response["X-Accel-Buffering"] = "no"
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def room_presence(request, room_id):
    """成员 / 在线态，与消息增量拆开，供低频刷新。"""
    v = _helpers()
    touch_presence(request.user)
    room = get_object_or_404(CollabRoom.objects.select_related("created_by"), id=room_id)
    if not v._can_access_room(request.user, room):
        return Response({"ok": False, "error": "无权访问该会话"}, status=403)
    payload = v._room_payload(room, include_messages=False, viewer=request.user)
    return Response({
        "ok": True,
        "id": payload["id"],
        "status": payload["status"],
        "risk_level": payload["risk_level"],
        "updated_at": payload["updated_at"],
        "online_count": payload.get("online_count"),
        "peer_online": payload.get("peer_online"),
        "participants": payload.get("participants") or [],
        "member_count": payload.get("member_count"),
        "display_title": payload.get("display_title"),
        "active_xiaoce_run": payload.get("active_xiaoce_run"),
    })
