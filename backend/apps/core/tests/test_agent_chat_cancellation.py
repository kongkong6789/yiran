import uuid
from unittest.mock import patch

from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from apps.core.agent_chat import run_chat
from apps.core.chat_runs import ChatRunCancelled, cancel_run
from apps.core.models import ChatMessage, ChatRun


class AgentChatRunLifecycleTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("chat-owner", password="pw")
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        self.run_id = uuid.uuid4()

    def post_chat(self):
        return self.client.post(
            "/api/agent/chat/",
            {"message": "请分析昨天经营数据", "run_id": str(self.run_id)},
            format="json",
        )

    @patch("apps.core.views.run_chat")
    def test_cancelled_run_keeps_user_and_pause_messages_only(self, mocked_run_chat):
        def cancel_while_running(*args, **kwargs):
            run = ChatRun.objects.get(id=self.run_id)
            cancel_run(run)
            self.assertTrue(kwargs["cancel_check"]())
            raise ChatRunCancelled()

        mocked_run_chat.side_effect = cancel_while_running

        response = self.post_chat()

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["ok"])
        self.assertTrue(response.data["cancelled"])
        run = ChatRun.objects.get(id=self.run_id)
        self.assertEqual(run.status, ChatRun.Status.CANCELLED)
        self.assertEqual(
            list(run.session.messages.values_list("role", "content")),
            [
                ("user", "请分析昨天经营数据"),
                ("assistant", "已暂停本次生成。"),
            ],
        )

    @patch("apps.core.views.run_chat")
    def test_successful_run_is_completed(self, mocked_run_chat):
        mocked_run_chat.return_value = {"ok": True, "reply": "经营数据正常"}

        response = self.post_chat()

        self.assertEqual(response.status_code, 200)
        run = ChatRun.objects.get(id=self.run_id)
        self.assertEqual(run.status, ChatRun.Status.COMPLETED)
        self.assertIsNotNone(run.finished_at)
        self.assertEqual(run.session.messages.filter(role="assistant").count(), 1)

    @patch("apps.core.views.run_chat")
    def test_failed_run_is_marked_failed(self, mocked_run_chat):
        mocked_run_chat.side_effect = RuntimeError("gateway down")

        response = self.post_chat()

        self.assertEqual(response.status_code, 500)
        run = ChatRun.objects.get(id=self.run_id)
        self.assertEqual(run.status, ChatRun.Status.FAILED)
        self.assertEqual(run.error, "gateway down")
        self.assertIsNotNone(run.finished_at)

    def test_missing_run_id_is_rejected(self):
        response = self.client.post(
            "/api/agent/chat/",
            {"message": "hello"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("run_id", response.data["error"])
        self.assertFalse(ChatMessage.objects.exists())


class RunChatCancellationCheckpointTests(APITestCase):
    def test_run_chat_checks_cancel_before_resolving_dependencies(self):
        with self.assertRaises(ChatRunCancelled):
            run_chat("hello", cancel_check=lambda: True)
