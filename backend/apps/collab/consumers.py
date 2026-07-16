"""协作会话 WebSocket 消费者。"""
from __future__ import annotations

import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth.models import AnonymousUser

logger = logging.getLogger(__name__)


class RoomConsumer(AsyncJsonWebsocketConsumer):
    room_id: str
    group_name: str

    async def connect(self):
        self.room_id = str(self.scope["url_route"]["kwargs"]["room_id"])
        self.group_name = f"collab_room_{self.room_id}"

        user = self.scope.get("user")
        if user is None or isinstance(user, AnonymousUser) or not getattr(user, "is_authenticated", False):
            logger.warning("collab ws reject: unauthorized room=%s", self.room_id)
            await self.close(code=4401)
            return

        ok = await self._can_access(user, self.room_id)
        if not ok:
            logger.warning("collab ws reject: no access room=%s user=%s", self.room_id, getattr(user, "id", None))
            await self.close(code=4403)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.info("collab ws connected room=%s user=%s", self.room_id, getattr(user, "id", None))
        await self.send_json({
            "event": "hello",
            "data": {"room_id": self.room_id},
        })

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        logger.info("collab ws disconnected room=%s code=%s", getattr(self, "room_id", None), code)

    async def receive_json(self, content, **kwargs):
        if (content or {}).get("type") == "ping":
            await self.send_json({"event": "pong", "data": {}})

    async def room_push(self, event):
        await self.send_json({
            "event": event.get("event") or "sync",
            "data": event.get("data") or {},
        })

    @database_sync_to_async
    def _can_access(self, user, room_id: str) -> bool:
        from .models import CollabRoom
        from .views import _can_access_room

        try:
            room = CollabRoom.objects.get(id=room_id)
        except CollabRoom.DoesNotExist:
            return False
        return bool(_can_access_room(user, room))
