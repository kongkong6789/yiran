import uuid

from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from apps.core.models import ChatMessage, ChatRun, ChatSession


class ChatRunCancelTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner", password="pw")
        self.other = User.objects.create_user("other", password="pw")
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        self.session = ChatSession.objects.create(user=self.user, title="测试")
        self.run = ChatRun.objects.create(
            id=uuid.uuid4(),
            user=self.user,
            session=self.session,
        )

    def cancel_url(self):
        return reverse("agent-chat-run-cancel", args=[self.run.id])

    def test_cancel_is_idempotent_and_creates_one_placeholder(self):
        first = self.client.post(self.cancel_url())
        second = self.client.post(self.cancel_url())

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.run.refresh_from_db()
        self.assertEqual(self.run.status, ChatRun.Status.CANCELLED)
        self.assertIsNotNone(self.run.cancelled_at)
        self.assertEqual(
            ChatMessage.objects.filter(
                session=self.session,
                meta__run_id=str(self.run.id),
                meta__cancelled=True,
            ).count(),
            1,
        )
        self.assertEqual(self.run.cancel_message.content, "已暂停本次生成。")

    def test_other_user_receives_not_found(self):
        token = Token.objects.create(user=self.other)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

        response = self.client.post(self.cancel_url())

        self.assertEqual(response.status_code, 404)

    def test_completed_run_cannot_be_cancelled(self):
        self.run.status = ChatRun.Status.COMPLETED
        self.run.save(update_fields=["status"])

        response = self.client.post(self.cancel_url())

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"], "本轮回答已经完成，无法暂停")
        self.assertFalse(ChatMessage.objects.filter(session=self.session).exists())
