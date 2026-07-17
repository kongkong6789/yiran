"""圆桌会议 WebSocket 消费者。"""
from __future__ import annotations

import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser

logger = logging.getLogger(__name__)


class MeetingConsumer(AsyncJsonWebsocketConsumer):
    meeting_id: int
    group_name: str

    async def connect(self):
        self.meeting_id = int(self.scope["url_route"]["kwargs"]["meeting_id"])
        self.group_name = f"council_meeting_{self.meeting_id}"

        user = self.scope.get("user")
        if user is None or isinstance(user, AnonymousUser) or not getattr(user, "is_authenticated", False):
            logger.warning("council ws reject: unauthorized meeting=%s", self.meeting_id)
            await self.close(code=4401)
            return

        exists = await self._meeting_exists(self.meeting_id)
        if not exists:
            logger.warning("council ws reject: missing meeting=%s", self.meeting_id)
            await self.close(code=4404)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.info("council ws connected meeting=%s user=%s", self.meeting_id, getattr(user, "id", None))
        await self.send_json({
            "event": "hello",
            "data": {"meeting_id": self.meeting_id},
        })

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        logger.info("council ws disconnected meeting=%s code=%s", getattr(self, "meeting_id", None), code)

    async def receive_json(self, content, **kwargs):
        # 客户端可发 ping；消息发送仍走 HTTP interject（含鉴权与业务逻辑）
        if (content or {}).get("type") == "ping":
            await self.send_json({"event": "pong", "data": {}})

    async def meeting_push(self, event):
        await self.send_json({
            "event": event.get("event") or "messages",
            "data": event.get("data") or {},
        })

    @database_sync_to_async
    def _meeting_exists(self, meeting_id: int) -> bool:
        from .models import Meeting
        return Meeting.objects.filter(id=meeting_id).exists()
