import uuid
from unittest.mock import patch

from django.contrib.auth.models import User
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from apps.core.agent_chat import run_chat
from apps.core.chat_runs import ChatRunCancelled, cancel_run
from apps.core.conversation_skill import ConversationSkillError
from apps.core.models import ChatMessage, ChatRun, ChatSession


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


class ConversationSkillRoutingTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("skill-chat-owner", password="pw")
        token = Token.objects.create(user=self.user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        self.session = ChatSession.objects.create(user=self.user, title="经营复盘")
        ChatMessage.objects.create(session=self.session, role="user", content="分析昨天 GMV")
        ChatMessage.objects.create(session=self.session, role="assistant", content="GMV 为 41.8 万元")

    @patch("apps.core.views.run_chat")
    @patch("apps.core.views.build_conversation_skill")
    def test_explicit_request_routes_to_packager_and_persists_created_skill(
        self,
        mocked_builder,
        mocked_run_chat,
    ):
        created_skill = {
            "asset_id": 9,
            "personal_id": 10,
            "skill_id": "gmv-review-12345678",
            "name": "GMV 复盘流程",
            "description": "复用 GMV 复盘流程",
            "visibility": "private",
            "enabled": True,
            "package_kind": "package",
            "storage": "local",
        }
        mocked_builder.return_value = created_skill
        run_id = uuid.uuid4()

        response = self.client.post(
            "/api/agent/chat/",
            {
                "message": "把这次对话打包成一个 skill 并自动上传平台",
                "conversation_id": str(self.session.id),
                "run_id": str(run_id),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["ok"])
        self.assertEqual(response.data["created_skill"], created_skill)
        self.assertIn("已自动上传", response.data["reply"])
        mocked_run_chat.assert_not_called()
        mocked_builder.assert_called_once()
        builder_args = mocked_builder.call_args.args
        builder_kwargs = mocked_builder.call_args.kwargs
        self.assertEqual(builder_args[:2], (self.user, self.session))
        command = self.session.messages.filter(role="user").latest("id")
        self.assertEqual(builder_kwargs["exclude_message_id"], command.id)
        self.assertTrue(callable(builder_kwargs["cancel_check"]))

        run = ChatRun.objects.get(id=run_id)
        self.assertEqual(run.status, ChatRun.Status.COMPLETED)
        assistant = self.session.messages.filter(role="assistant").latest("id")
        self.assertEqual(assistant.meta["created_skill"], created_skill)

    @patch("apps.core.views.run_chat")
    @patch("apps.core.views.build_conversation_skill")
    def test_packaging_failure_is_returned_as_an_assistant_reply_without_partial_success(
        self,
        mocked_builder,
        mocked_run_chat,
    ):
        mocked_builder.side_effect = ConversationSkillError("模型未返回有效的 Skill 结构")

        response = self.client.post(
            "/api/agent/chat/",
            {
                "message": "把这次对话打包成一个 skill 并自动上传平台",
                "conversation_id": str(self.session.id),
                "run_id": str(uuid.uuid4()),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["ok"])
        self.assertNotIn("created_skill", response.data)
        self.assertIn("自动生成失败", response.data["reply"])
        mocked_run_chat.assert_not_called()
