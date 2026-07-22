from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.presence import ONLINE_WINDOW_SECONDS, is_online, presence_map


class PresencePolicyTests(TestCase):
    def test_xiaoce_is_online_without_a_browser_heartbeat(self):
        bot = get_xiaoce_bot_user()

        state = presence_map([bot.id])[bot.id]

        self.assertTrue(state["online"])
        self.assertIsNone(state["last_seen"])

    def test_human_presence_uses_the_documented_ttl_boundary(self):
        now = timezone.now()
        with patch("apps.collab.presence.timezone.now", return_value=now):
            self.assertTrue(is_online(now - timedelta(seconds=ONLINE_WINDOW_SECONDS)))
            self.assertFalse(
                is_online(
                    now
                    - timedelta(seconds=ONLINE_WINDOW_SECONDS, microseconds=1)
                )
            )
            self.assertFalse(is_online(None))


class PresenceApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("presence-viewer", password="pw")
        self.bot = get_xiaoce_bot_user()
        self.client.force_authenticate(self.user)

    def test_batch_presence_uses_the_same_always_online_bot_policy(self):
        response = self.client.get(
            "/api/collab/presence/",
            {"user_ids": str(self.bot.id)},
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["users"][str(self.bot.id)]["online"])
        self.assertEqual(response.data["window_seconds"], ONLINE_WINDOW_SECONDS)
