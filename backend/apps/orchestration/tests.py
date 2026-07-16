from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.council.models import AgentProfile


class RealAgentExecutionTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="agent-runner", password="test-pass")
        self.client.force_authenticate(self.user)
        self.agent = AgentProfile.objects.create(
            name="真实运营智能体",
            expertise="经营日报和数据分析",
            execution_role=AgentProfile.ExecutionRole.OPERATOR,
            quota_limit=10000,
        )

    def test_agent_catalog_returns_execution_fields(self):
        response = self.client.get("/api/council/agents/")
        self.assertEqual(response.status_code, 200)
        row = response.data["results"][0]
        self.assertEqual(row["id"], self.agent.id)
        self.assertEqual(row["execution_role"], "operator")
        self.assertEqual(row["quota_remaining"], 10000)
        self.assertEqual(row["status"], "available")

    def test_sop_uses_selected_real_agent(self):
        response = self.client.post(
            "/api/orchestration/run/",
            {
                "text": "生成日报",
                "payload": {"dt": "2026-07-15", "scope": "all"},
                "agent_id": self.agent.id,
                "role": "director",
                "trace_id": "frontend-trace-1",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["executor"]["id"], self.agent.id)
        self.assertEqual(response.data["trace_id"], "frontend-trace-1")
        self.assertEqual(response.data["executor"]["name"], "真实运营智能体")

    def test_disabled_agent_cannot_execute(self):
        self.agent.is_active = False
        self.agent.save(update_fields=["is_active"])
        response = self.client.post(
            "/api/orchestration/run/",
            {"text": "生成日报", "payload": {}, "agent_id": self.agent.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("停用", response.data["detail"])
