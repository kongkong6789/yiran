"""Agent-scoped SOP run API (harness) tests."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.council.models import AgentProfile
from apps.core.organizations import ensure_current_organization
from apps.orchestration.models import SopDefinition, SopVersion
from apps.orchestration.sop_schema import graph_hash, validate_graph


class AgentScopedSopApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="agent-sop-runner", password="test-pass")
        self.client.force_authenticate(self.user)
        self.organization = ensure_current_organization(self.user)

        graph = validate_graph(
            {
                "start": "collect.info",
                "terminals": ["finish"],
                "nodes": [
                    {
                        "key": "collect.info",
                        "type": "collect_info",
                        "title": "确认品牌",
                        "config": {
                            "instruction": "请提供品牌。",
                            "expected_user_info": ["brand"],
                            "required_fields": ["brand"],
                        },
                    },
                    {"key": "finish", "type": "end", "title": "结束", "config": {}},
                ],
                "edges": [
                    {"source": "collect.info", "target": "finish", "condition": "always", "priority": 1},
                ],
            }
        )
        self.sop = SopDefinition.objects.create(
            organization=self.organization,
            sop_key="agent.harness.demo",
            name="Harness 演示流程",
            status=SopDefinition.Status.PUBLISHED,
            current_version="1.0.0",
            created_by=self.user,
            updated_by=self.user,
        )
        self.version = SopVersion.objects.create(
            definition=self.sop,
            version="1.0.0",
            status=SopVersion.Status.PUBLISHED,
            graph=graph,
            content_hash=graph_hash(
                graph=graph, input_schema={}, output_schema={}, trigger_intents=[], examples=[]
            ),
            created_by=self.user,
            published_by=self.user,
        )
        self.agent = AgentProfile.objects.create(
            organization=self.organization,
            created_by=self.user,
            owner=self.user,
            name="Harness Agent",
            sop_keys=["agent.harness.demo"],
            quota_limit=10000,
        )

    def test_list_bound_sops(self):
        response = self.client.get(f"/api/orchestration/agents/{self.agent.id}/sops/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["key"], "agent.harness.demo")

    def test_run_rejects_unbound_sop(self):
        response = self.client.post(
            f"/api/orchestration/agents/{self.agent.id}/sops/other.sop/run/",
            {"text": "跑一下", "payload": {}},
            format="json",
        )
        self.assertEqual(response.status_code, 403, response.data)
        self.assertIn("未绑定", response.data["detail"])

    def test_run_need_input_then_resume(self):
        first = self.client.post(
            f"/api/orchestration/agents/{self.agent.id}/sops/agent.harness.demo/run/",
            {"text": "跑 harness", "payload": {}, "trace_id": "harness-trace-1"},
            format="json",
        )
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data["decision"], "need_input")
        self.assertEqual(first.data["agent_sop"]["sop_key"], "agent.harness.demo")
        self.assertEqual(first.data["executor"]["id"], self.agent.id)
        self.assertIn("brand", first.data.get("missing") or [])

        second = self.client.post(
            f"/api/orchestration/agents/{self.agent.id}/sops/agent.harness.demo/run/",
            {
                "text": "品牌是 Unove",
                "payload": {"brand": "Unove"},
                "trace_id": "harness-trace-1",
            },
            format="json",
        )
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(second.data["decision"], "allow")
        self.assertEqual(second.data["trace_id"], "harness-trace-1")

    def test_disabled_agent_cannot_run(self):
        self.agent.is_active = False
        self.agent.lifecycle_status = AgentProfile.LifecycleStatus.DISABLED
        self.agent.save(update_fields=["is_active", "lifecycle_status"])
        response = self.client.post(
            f"/api/orchestration/agents/{self.agent.id}/sops/agent.harness.demo/run/",
            {"text": "跑", "payload": {"brand": "X"}},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("停用", response.data["detail"])
