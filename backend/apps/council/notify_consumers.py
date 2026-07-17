"""用户级通知 WebSocket（会议邀请等）。"""
from __future__ import annotations

import logging

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser

from .invites import user_notify_group

logger = logging.getLogger(__name__)


class UserNotifyConsumer(AsyncJsonWebsocketConsumer):
    group_name: str
    user_id: int

    async def connect(self):
        user = self.scope.get("user")
        if user is None or isinstance(user, AnonymousUser) or not getattr(user, "is_authenticated", False):
            await self.close(code=4401)
            return

        self.user_id = int(user.id)
        self.group_name = user_notify_group(self.user_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.info("user notify ws connected user=%s", self.user_id)
        await self.send_json({"event": "hello", "data": {"user_id": self.user_id}})

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if (content or {}).get("type") == "ping":
            await self.send_json({"event": "pong", "data": {}})

    async def notify_push(self, event):
        await self.send_json({
            "event": event.get("event") or "notify",
            "data": event.get("data") or {},
        })
