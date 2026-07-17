import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import UserSettings

from .models import (
    CollabMessage,
    CollabMessageRead,
    CollabParticipant,
    CollabReadSession,
    CollabRoom,
    CollabSummary,
)


User = get_user_model()


class CollabConversationIntelligenceTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="owner", password="test-pass-123")
        self.member = User.objects.create_user(username="member", password="test-pass-123")
        self.third = User.objects.create_user(username="third", password="test-pass-123")
        self.room = CollabRoom.objects.create(
            title="项目群",
            room_kind="group",
            created_by=self.owner,
        )
        for user in (self.owner, self.member, self.third):
            CollabParticipant.objects.create(room=self.room, user=user)
        self.messages = [
            CollabMessage.objects.create(
                room=self.room,
                sender=self.owner if index % 2 == 0 else self.member,
                content=f"第 {index + 1} 条讨论，需要确认下一步负责人和时间。",
            )
            for index in range(10)
        ]
        self.client = APIClient()

    def test_quote_is_a_real_message_relation(self):
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/",
            {
                "content": "同意这条，明天继续。",
                "reply_to_id": self.messages[2].id,
                "analyze": "0",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        created = CollabMessage.objects.get(id=response.data["message"]["id"])
        self.assertEqual(created.reply_to_id, self.messages[2].id)
        self.assertEqual(response.data["message"]["reply_to"]["id"], self.messages[2].id)

    def test_read_receipts_and_active_session_are_persisted(self):
        self.client.force_authenticate(self.third)
        last_id = self.messages[-1].id
        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/read/",
            {
                "up_to_id": last_id,
                "session_id": "session-test-1",
                "active_duration_ms": 4200,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["last_read_message_id"], last_id)
        self.assertEqual(
            CollabMessageRead.objects.filter(room=self.room, user=self.third).count(),
            len(self.messages),
        )
        session = CollabReadSession.objects.get(
            room=self.room,
            user=self.third,
            session_key="session-test-1",
        )
        self.assertEqual(session.active_duration_ms, 4200)
        self.assertEqual(session.up_to_message_id, last_id)

    @patch("apps.collab.summary.llm.chat_messages_result")
    def test_summary_requires_a_configured_llm(self, mock_llm):
        mock_llm.return_value = {
            "content": "",
            "error": "未配置 LLM API Key",
            "configured": False,
            "model": "gpt-4o-mini",
        }
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/summaries/",
            {"range_mode": "auto"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("未配置可用的 LLM", response.data["error"])
        self.assertFalse(CollabSummary.objects.filter(room=self.room).exists())

    @patch("apps.collab.summary.llm.chat_messages_result")
    def test_auto_summary_uses_configured_llm_and_records_model(self, mock_llm):
        UserSettings.objects.create(
            user=self.owner,
            llm_api_key="test-key",
            llm_base_url="https://llm.example/v1",
            llm_model="summary-pro",
        )
        mock_llm.return_value = {
            "content": json.dumps(
                {
                    "content": "团队已完成阶段任务讨论，并明确下一步推进安排。",
                    "key_points": ["已核对当前进度", "需要确认负责人和时间"],
                    "decisions": ["先完成负责人确认"],
                    "action_items": ["本周内补齐排期"],
                },
                ensure_ascii=False,
            ),
            "error": "",
            "configured": True,
            "model": "summary-pro",
            "base_url": "https://llm.example/v1",
        }
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/summaries/",
            {"range_mode": "auto"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        payload = response.data["summary"]
        self.assertEqual(payload["message_count"], len(self.messages))
        self.assertTrue(payload["key_points"])
        self.assertTrue(payload["action_items"])
        self.assertEqual(payload["generated_by"], "llm")
        self.assertEqual(payload["model_name"], "summary-pro")
        self.assertEqual(payload["model_source"], "personal")
        self.assertEqual(CollabSummary.objects.filter(room=self.room).count(), 1)

        stats = self.client.get(f"/api/collab/rooms/{self.room.id}/stats/")
        self.assertEqual(stats.status_code, 200)
        self.assertIn("latest_summary", stats.data)
        self.assertIn("summary_suggestion", stats.data)
        self.assertEqual(stats.data["summary_model"]["model"], "summary-pro")
        self.assertTrue(stats.data["summary_model"]["configured"])
        self.assertIn("read_metrics", stats.data)

    @patch("apps.collab.summary.llm.chat_messages_result")
    def test_llm_failure_does_not_create_local_summary(self, mock_llm):
        mock_llm.return_value = {
            "content": "",
            "error": "LLM HTTP 429: rate limited",
            "configured": True,
            "model": "summary-pro",
        }
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/summaries/",
            {"range_mode": "auto"},
            format="json",
        )
        self.assertEqual(response.status_code, 502)
        self.assertIn("LLM 总结失败", response.data["error"])
        self.assertFalse(CollabSummary.objects.filter(room=self.room).exists())
