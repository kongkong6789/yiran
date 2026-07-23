import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom
from apps.core.models import UserSettings


User = get_user_model()


class CollabTranslationApiTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="translate-owner", password="test-pass-123")
        self.outsider = User.objects.create_user(username="translate-outsider", password="test-pass-123")
        self.room = CollabRoom.objects.create(title="双语项目群", room_kind="group", created_by=self.owner)
        CollabParticipant.objects.create(room=self.room, user=self.owner)
        self.zh = CollabMessage.objects.create(room=self.room, sender=self.owner, content="项目明天开始")
        self.en = CollabMessage.objects.create(room=self.room, sender=self.owner, content="The project starts tomorrow")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    @patch("apps.collab.translation.llm.chat_messages_result")
    def test_translates_chinese_and_english_in_one_batch(self, mock_llm):
        mock_llm.return_value = {
            "configured": True,
            "model": "translation-pro",
            "content": json.dumps([
                {
                    "message_id": self.zh.id,
                    "source_language": "zh",
                    "target_language": "en",
                    "translated_text": "The project starts tomorrow.",
                },
                {
                    "message_id": self.en.id,
                    "source_language": "en",
                    "target_language": "zh-CN",
                    "translated_text": "项目明天开始。",
                },
            ]),
            "error": "",
        }

        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/translate/",
            {"message_ids": [self.zh.id, self.en.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["model"], "translation-pro")
        self.assertEqual(len(response.data["translations"]), 2)
        prompt = json.loads(mock_llm.call_args.args[1][0]["content"])
        self.assertEqual(prompt[0]["target_language"], "en")
        self.assertEqual(prompt[1]["target_language"], "zh-CN")

    def test_translation_rejects_non_participant(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/translate/",
            {"message_ids": [self.zh.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    @patch("apps.collab.translation.llm.chat_messages_result")
    def test_translation_requires_configured_llm(self, mock_llm):
        mock_llm.return_value = {
            "configured": False,
            "model": "",
            "content": "",
            "error": "未配置 LLM API Key",
        }
        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/translate/",
            {"message_ids": [self.zh.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("未配置", response.data["error"])

    @patch("apps.collab.translation.llm.chat_messages_result")
    def test_translation_uses_personal_model_with_personal_credentials(self, mock_llm):
        UserSettings.objects.create(
            user=self.owner,
            llm_api_key="personal-key",
            llm_base_url="https://llm.example.test/v1",
            llm_model="personal-translation-model",
        )
        mock_llm.return_value = {
            "configured": True,
            "model": "personal-translation-model",
            "content": json.dumps([{
                "message_id": self.zh.id,
                "source_language": "zh",
                "target_language": "en",
                "translated_text": "The project starts tomorrow.",
            }]),
            "error": "",
        }

        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/translate/",
            {"message_ids": [self.zh.id]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            mock_llm.call_args.kwargs["model"],
            "personal-translation-model",
        )
