from django.contrib.auth.models import User
from rest_framework.test import APITestCase

from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom


class CollabSearchTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("search-owner", password="pw")
        self.colleague = User.objects.create_user("search-colleague", password="pw")
        self.outsider = User.objects.create_user("search-outsider", password="pw")
        self.bot = get_xiaoce_bot_user()

        self.normal_room = self._room(
            self.user,
            self.colleague,
            title="销售复盘会",
        )
        self.xiaoce_room = self._room(
            self.user,
            self.bot,
            title="小策bot（采购复盘任务）",
        )
        self.private_room = self._room(
            self.outsider,
            self.colleague,
            title="其他人的私密对话",
        )
        self.client.force_authenticate(self.user)

    @staticmethod
    def _room(owner, peer, *, title):
        room = CollabRoom.objects.create(
            created_by=owner,
            room_kind="dm",
            title=title,
        )
        CollabParticipant.objects.create(room=room, user=owner)
        CollabParticipant.objects.create(room=room, user=peer)
        return room

    def _message(self, room, sender, content, **kwargs):
        return CollabMessage.objects.create(
            room=room,
            sender=sender,
            content=content,
            **kwargs,
        )

    def test_searches_normal_and_xiaoce_messages_without_crossing_room_permissions(self):
        normal = self._message(self.normal_room, self.colleague, "普通对话的星河计划进度")
        xiaoce = self._message(
            self.xiaoce_room,
            self.bot,
            "小策任务已整理星河计划明细",
            msg_type="ai",
            ai_kind="xiaoce",
        )
        self._message(self.private_room, self.outsider, "不应暴露的星河计划")
        self._message(
            self.normal_room,
            self.user,
            "已撤回的星河计划",
            status="recalled",
        )
        self._message(
            self.normal_room,
            self.user,
            "已删除的星河计划",
            status="deleted",
        )

        response = self.client.get("/api/collab/search/", {"q": "星河计划"})

        self.assertEqual(response.status_code, 200)
        message_results = [row for row in response.data["results"] if row["kind"] == "message"]
        self.assertEqual(
            {row["message"]["id"] for row in message_results},
            {normal.id, xiaoce.id},
        )
        by_id = {row["message"]["id"]: row for row in message_results}
        self.assertFalse(by_id[normal.id]["room"]["is_xiaoce"])
        self.assertTrue(by_id[xiaoce.id]["room"]["is_xiaoce"])
        self.assertIn("星河计划", by_id[xiaoce.id]["message"]["snippet"])

    def test_searches_xiaoce_task_title_as_a_conversation_result(self):
        response = self.client.get("/api/collab/search/", {"q": "采购复盘"})

        self.assertEqual(response.status_code, 200)
        room_result = next(row for row in response.data["results"] if row["kind"] == "room")
        self.assertEqual(room_result["room"]["id"], str(self.xiaoce_room.id))
        self.assertTrue(room_result["room"]["is_xiaoce"])
        self.assertEqual(room_result["message"], None)

    def test_around_id_returns_context_on_both_sides_of_the_target(self):
        messages = [
            self._message(self.normal_room, self.user, f"历史消息 {index:02d}")
            for index in range(31)
        ]
        target = messages[15]

        response = self.client.get(
            f"/api/collab/rooms/{self.normal_room.id}/messages/",
            {"around_id": target.id, "limit": 11, "include_participants": "0"},
        )

        self.assertEqual(response.status_code, 200)
        ids = [row["id"] for row in response.data["results"]]
        self.assertEqual(len(ids), 11)
        self.assertEqual(ids[5], target.id)
        self.assertTrue(response.data["has_more_before"])
        self.assertTrue(response.data["has_more_after"])

    def test_around_id_rejects_a_message_from_another_room(self):
        private = self._message(self.private_room, self.outsider, "不可访问")

        response = self.client.get(
            f"/api/collab/rooms/{self.normal_room.id}/messages/",
            {"around_id": private.id},
        )

        self.assertEqual(response.status_code, 404)
