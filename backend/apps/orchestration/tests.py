from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.council.models import AgentProfile
from apps.core.organizations import ensure_current_organization
from apps.skills.models import UserSkill


class RealAgentExecutionTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="agent-runner", password="test-pass")
        self.client.force_authenticate(self.user)
        self.organization = ensure_current_organization(self.user)
        self.agent = AgentProfile.objects.create(
            organization=self.organization,
            created_by=self.user,
            owner=self.user,
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
        skill = UserSkill.objects.create(
            user=self.user,
            skill_id="daily-report",
            name="日报 Skill",
            instructions="生成日报前先确认日期与统计范围。",
        )
        self.agent.skill_ids = [skill.skill_id]
        self.agent.capability_instructions = "日报必须标注数据日期。"
        self.agent.save(update_fields=["skill_ids", "capability_instructions"])
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
        capability_step = next(step for step in response.data["steps"] if step["node"] == "智能体能力加载")
        self.assertEqual(capability_step["data"]["skills"][0]["skill_id"], skill.skill_id)

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

    def test_task_creation_falls_back_to_manual_task_when_no_sop_matches(self):
        response = self.client.post(
            "/api/orchestration/run/",
            {
                "text": "联系杨院东确认下周会议时间",
                "payload": {},
                "agent_id": self.agent.id,
                "trace_id": "manual-task-1",
                "mode": "task_create",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["decision"], "allow")
        self.assertEqual(response.data["action"], "task.manual")
        self.assertTrue(response.data["result"]["task_created"])
        self.assertEqual(response.data["result"]["execution_mode"], "manual_task")

    def test_unmatched_direct_sop_request_still_blocks(self):
        response = self.client.post(
            "/api/orchestration/run/",
            {"text": "联系杨院东确认下周会议时间", "payload": {}, "agent_id": self.agent.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["decision"], "block")
        self.assertEqual(response.data["action"], "")
