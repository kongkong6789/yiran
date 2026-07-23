import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import UserSettings

from apps.collab.models import (
    CollabMessage,
    CollabMessageRead,
    CollabParticipant,
    CollabReadSession,
    CollabRoom,
    CollabSummary,
)
from apps.collab.analyze import analyze_room_messages
from apps.collab.mentions import get_collab_ai_user, get_xiaoce_bot_user


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

    def test_group_read_receipts_exclude_bots_and_agents(self):
        xiaoce = get_xiaoce_bot_user()
        liangce_ai = get_collab_ai_user()
        CollabParticipant.objects.create(room=self.room, user=xiaoce)
        CollabParticipant.objects.create(room=self.room, user=liangce_ai)
        self.client.force_authenticate(self.owner)

        response = self.client.get(
            f"/api/collab/rooms/{self.room.id}/messages/",
            {"limit": 20, "include_participants": "1"},
        )

        self.assertEqual(response.status_code, 200)
        owner_message = next(
            row for row in response.data["results"]
            if row["sender"]["id"] == self.owner.id
        )
        self.assertEqual(owner_message["read_state"]["unread_count"], 2)
        self.assertNotIn("小策bot", owner_message["read_state"]["unread_by"])
        self.assertNotIn("良策AI", owner_message["read_state"]["unread_by"])
        participants = response.data["room"]["participants"]
        automated = {
            row["username"]: row
            for row in participants
            if row["username"] in {"小策bot", "良策AI"}
        }
        self.assertEqual(automated["小策bot"]["kind"], "bot")
        self.assertEqual(automated["良策AI"]["kind"], "bot")

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

    @patch("apps.collab.analyze.llm.chat")
    @patch("apps.collab.analyze.llm.llm_available", return_value=True)
    def test_normal_message_cannot_be_escalated_by_model_without_evidence(
        self,
        _mock_available,
        mock_chat,
    ):
        mock_chat.return_value = json.dumps({
            "risk_level": "red",
            "title": "模型误判风险",
            "analysis": "普通进度消息被误判。",
            "advice": "不应触发提醒。",
            "control": "",
            "tags": ["监控介入"],
            "draft_reply": "",
            "should_speak": True,
            "evidence_message_ids": [101],
            "message_flags": [{"message_id": 101, "label": "风险", "level": "red"}],
        }, ensure_ascii=False)

        result = analyze_room_messages([
            {
                "id": 101,
                "username": "owner",
                "content": "今天进度正常，下午把方案文档发到群里。",
                "msg_type": "user",
            },
        ], llm_user=self.owner)

        self.assertEqual(result["risk_level"], "green")
        self.assertFalse(result["should_speak"])
        self.assertEqual(result["message_flags"], [])

    @patch("apps.collab.analyze.llm.chat")
    @patch("apps.collab.analyze.llm.llm_available", return_value=True)
    def test_old_risk_does_not_repeat_after_a_normal_message(
        self,
        _mock_available,
        mock_chat,
    ):
        mock_chat.return_value = json.dumps({
            "risk_level": "red",
            "title": "历史消息仍有风险",
            "analysis": "前一条消息涉及绕过审批。",
            "advice": "按流程处理。",
            "control": "",
            "tags": ["监控介入"],
            "draft_reply": "",
            "should_speak": True,
            "evidence_message_ids": [201],
            "message_flags": [{"message_id": 201, "label": "违规承诺", "level": "red"}],
        }, ensure_ascii=False)

        result = analyze_room_messages([
            {
                "id": 201,
                "username": "owner",
                "content": "先绕过审批直接处理。",
                "msg_type": "user",
            },
            {
                "id": 202,
                "username": "owner",
                "content": "下午三点开会同步项目进度。",
                "msg_type": "user",
            },
        ], llm_user=self.owner)

        self.assertEqual(result["risk_level"], "green")
        self.assertFalse(result["should_speak"])

    @patch("apps.collab.views.analyze_room_messages")
    def test_current_room_risk_recovers_after_normal_analysis(self, mock_analyze):
        self.room.risk_level = "red"
        self.room.save(update_fields=["risk_level"])
        mock_analyze.return_value = {
            "risk_level": "green",
            "title": "会话运行正常",
            "analysis": "暂未发现明显异常。",
            "advice": "",
            "control": "",
            "tags": ["正常"],
            "draft_reply": "",
            "evidence_message_ids": [],
            "should_speak": False,
            "message_flags": [],
        }
        self.client.force_authenticate(self.owner)

        response = self.client.post(f"/api/collab/rooms/{self.room.id}/insights/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        self.room.refresh_from_db()
        self.assertEqual(self.room.risk_level, "green")

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
