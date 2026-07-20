from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase


User = get_user_model()


class BotRoomResolutionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="bot_handoff_user", password="pass12345")
        self.client.force_authenticate(self.user)

    def test_room_can_be_created_by_stable_bot_id(self):
        response = self.client.post(
            "/api/collab/rooms/",
            {"peer_bot_id": "xiaoce", "room_kind": "dm"},
            format="json",
        )
        self.assertIn(response.status_code, (200, 201))
        bot = next(item for item in response.data["participants"] if item.get("kind") == "bot")
        self.assertEqual(bot["bot_id"], "xiaoce")

    def test_unknown_bot_id_is_rejected(self):
        response = self.client.post(
            "/api/collab/rooms/",
            {"peer_bot_id": "missing", "room_kind": "dm"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertIn("不存在", response.data["error"])
