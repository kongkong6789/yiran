import uuid
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync, sync_to_async
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TransactionTestCase

from apps.collab import views, ws_push
from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom, XiaoceRun
from apps.collab.routing import websocket_urlpatterns
from apps.collab.xiaoce_runs import fail_xiaoce_run


class PublishRoomTests(SimpleTestCase):
    @patch("apps.collab.ws_push.get_channel_layer")
    def test_publisher_binds_event_to_its_room_group(self, get_layer):
        layer = get_layer.return_value
        layer.group_send = AsyncMock()
        room_id = uuid.uuid4()

        ws_push.publish_room(
            room_id,
            "sync",
            {"xiaoce_runs": [{"status": "failed"}]},
        )

        layer.group_send.assert_awaited_once_with(
            ws_push.room_group(room_id),
            {
                "type": "room.push",
                "room_id": str(room_id),
                "event": "sync",
                "data": {"xiaoce_runs": [{"status": "failed"}]},
            },
        )


class XiaoceRealtimeAccessTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.owner = User.objects.create_user("xiaoce-ws-owner", password="pw")
        self.other = User.objects.create_user("xiaoce-ws-other", password="pw")
        self.bot = get_xiaoce_bot_user()
        self.room = self._xiaoce_room(self.owner, "Owner task")
        self.other_room = self._xiaoce_room(self.other, "Other task")

    def _xiaoce_room(self, owner, title):
        room = CollabRoom.objects.create(
            created_by=owner,
            room_kind="dm",
            title=title,
        )
        CollabParticipant.objects.create(room=room, user=owner)
        CollabParticipant.objects.create(room=room, user=self.bot)
        return room

    @staticmethod
    def _application_for(user):
        app = URLRouter(websocket_urlpatterns)

        async def with_user(scope, receive, send):
            scoped = dict(scope)
            scoped["user"] = user
            return await app(scoped, receive, send)

        return with_user

    def _communicator(self, user, room):
        return WebsocketCommunicator(
            self._application_for(user),
            f"/ws/collab/rooms/{room.id}/",
        )

    def test_failure_event_reaches_only_its_owned_task_room(self):
        trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.owner,
            content="Run the task",
            msg_type="user",
        )
        run = XiaoceRun.objects.create(
            room=self.room,
            user=self.owner,
            trigger_message=trigger,
        )
        failure_message = fail_xiaoce_run(
            run.id,
            RuntimeError("internal failure"),
        )

        async_to_sync(self._failure_event_reaches_only_its_owned_task_room)(
            run,
            failure_message,
        )

    async def _failure_event_reaches_only_its_owned_task_room(self, run, failure_message):
        owner_socket = self._communicator(self.owner, self.room)
        other_socket = self._communicator(self.other, self.other_room)
        self.assertEqual(await owner_socket.connect(), (True, None))
        self.assertEqual(await other_socket.connect(), (True, None))
        await owner_socket.receive_json_from()
        await other_socket.receive_json_from()

        await sync_to_async(views._publish_xiaoce_message)(
            run,
            failure_message,
        )

        delivered = await owner_socket.receive_json_from()
        self.assertEqual(delivered["event"], "sync")
        self.assertEqual(delivered["data"]["messages"][0]["id"], failure_message.id)
        self.assertEqual(delivered["data"]["messages"][0]["meta"]["process_status"], "failed")
        self.assertEqual(delivered["data"]["xiaoce_runs"][0]["id"], str(run.id))
        self.assertEqual(delivered["data"]["xiaoce_runs"][0]["room_id"], str(self.room.id))
        self.assertEqual(delivered["data"]["xiaoce_runs"][0]["status"], "failed")
        self.assertTrue(await other_socket.receive_nothing(timeout=0.05))

        await owner_socket.disconnect()
        await other_socket.disconnect()

    def test_non_owner_cannot_connect_even_if_added_as_participant(self):
        CollabParticipant.objects.create(room=self.room, user=self.other)
        async_to_sync(self._assert_connection_rejected)(self.other, self.room)

    async def _assert_connection_rejected(self, user, room):
        socket = self._communicator(user, room)
        self.assertEqual(await socket.connect(), (False, 4403))
        await socket.disconnect()

    def test_cross_room_event_is_dropped_and_lost_access_closes_socket(self):
        async_to_sync(self._cross_room_event_is_dropped_and_lost_access_closes_socket)()

    async def _cross_room_event_is_dropped_and_lost_access_closes_socket(self):
        socket = self._communicator(self.owner, self.room)
        self.assertEqual(await socket.connect(), (True, None))
        await socket.receive_json_from()
        layer = get_channel_layer()

        await layer.group_send(
            ws_push.room_group(self.room.id),
            {
                "type": "room.push",
                "room_id": str(self.other_room.id),
                "event": "sync",
                "data": {"xiaoce_runs": [{"status": "failed"}]},
            },
        )
        self.assertTrue(await socket.receive_nothing(timeout=0.05))

        await sync_to_async(CollabRoom.objects.filter(id=self.room.id).update)(
            created_by=self.other,
        )
        await layer.group_send(
            ws_push.room_group(self.room.id),
            {
                "type": "room.push",
                "room_id": str(self.room.id),
                "event": "sync",
                "data": {"xiaoce_runs": [{"status": "failed"}]},
            },
        )

        self.assertEqual(
            await socket.receive_output(timeout=1),
            {"type": "websocket.close", "code": 4403},
        )
        await socket.disconnect()

    def test_disabled_account_is_closed_before_the_next_event_is_delivered(self):
        async_to_sync(self._disabled_account_is_closed_before_the_next_event_is_delivered)()

    async def _disabled_account_is_closed_before_the_next_event_is_delivered(self):
        socket = self._communicator(self.owner, self.room)
        self.assertEqual(await socket.connect(), (True, None))
        await socket.receive_json_from()

        # QuerySet.update intentionally leaves the user object in the socket
        # scope stale, matching a connection accepted before an admin disabled
        # the account.
        await sync_to_async(User.objects.filter(id=self.owner.id).update)(is_active=False)
        layer = get_channel_layer()
        await layer.group_send(
            ws_push.room_group(self.room.id),
            {
                "type": "room.push",
                "room_id": str(self.room.id),
                "event": "sync",
                "data": {"xiaoce_runs": [{"status": "failed"}]},
            },
        )

        self.assertEqual(
            await socket.receive_output(timeout=1),
            {"type": "websocket.close", "code": 4403},
        )
        await socket.disconnect()
