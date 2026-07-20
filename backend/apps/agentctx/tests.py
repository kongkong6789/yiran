"""agentctx 基础测试。"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.agentctx.assembler import assemble_context
from apps.agentctx.memory import load_memory, maybe_update_memory
from apps.agentctx.models import AgentMemoryItem, AgentSessionSummary


class AgentContextTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="ctx_user", password="pass")

    def test_assemble_injects_memory(self):
        AgentMemoryItem.objects.create(
            user=self.user,
            scope=AgentMemoryItem.Scope.USER,
            kind=AgentMemoryItem.Kind.PREFERENCE,
            content="请用中文简洁回答",
            importance=8,
        )
        pack = assemble_context(
            message="你好",
            history=[],
            user=self.user,
            session_key="sess-1",
            reference_blocks=["知识A"],
        )
        self.assertIn("用户记忆", pack.user_block)
        self.assertIn("请用中文简洁回答", pack.user_block)
        self.assertIn("知识A", pack.user_block)

    def test_maybe_update_extracts_preference(self):
        maybe_update_memory(
            self.user,
            session_key="collab:room:1",
            message="希望以后用表格输出结果",
            reply="好的",
            history=[{"role": "user", "content": f"msg{i}"} for i in range(10)],
        )
        self.assertTrue(
            AgentMemoryItem.objects.filter(
                user=self.user, kind=AgentMemoryItem.Kind.PREFERENCE
            ).exists()
        )
        self.assertTrue(
            AgentSessionSummary.objects.filter(
                user=self.user, session_key="collab:room:1"
            ).exists()
        )

    def test_api_list_memories(self):
        AgentMemoryItem.objects.create(
            user=self.user,
            scope="user",
            kind="fact",
            content="品牌是伊蒂之屋",
        )
        self.client.force_login(self.user)
        # DRF Token auth — use APIRequestFactory style via force_authenticate if needed
        from rest_framework.test import APIClient

        api = APIClient()
        api.force_authenticate(user=self.user)
        res = api.get("/api/agentctx/memories/")
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(res.data["count"], 1)
