from unittest import mock

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.core.organizations import assign_user_to_organization, ensure_current_organization
from apps.skills.models import SkillAsset, SkillUsageEvent

from .capabilities import build_agent_capability_context
from .models import AgentProfile


class AgentSkillApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username="agent-owner", password="pass")
        self.member = User.objects.create_user(username="agent-member", password="pass")
        self.organization = ensure_current_organization(self.owner)
        assign_user_to_organization(self.member, self.organization)
        self.agent = AgentProfile.objects.create(
            organization=self.organization,
            created_by=self.owner,
            owner=self.owner,
            name="经营分析智能体",
        )
        self.asset = SkillAsset.objects.create(
            uploader=self.owner,
            owner=self.owner,
            skill_id="agent-report",
            name="智能体日报",
            description="按责任口径生成经营日报",
            original_filename="SKILL.md",
            cos_bucket="",
            cos_key="skills/agent-report/SKILL.md",
            cos_url="",
            visibility=SkillAsset.Visibility.SHARED,
        )

    def test_owner_can_read_options_and_patch_agent_skills(self):
        self.client.force_authenticate(self.owner)
        options = self.client.get("/api/council/agents/skill-options/")
        response = self.client.patch(
            f"/api/council/agents/{self.agent.id}/skills/",
            {"skill_ids": [self.asset.skill_id]},
            format="json",
        )

        self.assertEqual(options.status_code, 200)
        self.assertEqual(options.data["agents"][0]["id"], self.agent.id)
        self.assertEqual(options.data["skills"][0]["skill_id"], self.asset.skill_id)
        self.assertEqual(options.data["skills"][0]["owner"]["id"], self.owner.id)
        self.assertEqual(response.status_code, 200, response.data)
        self.agent.refresh_from_db()
        self.assertEqual(self.agent.skill_ids, [self.asset.skill_id])
        self.assertEqual(response.data["skills"][0]["asset_id"], self.asset.id)

        rejected = self.client.patch(
            f"/api/council/agents/{self.agent.id}/skills/",
            {"knowledge_base_ids": [42]},
            format="json",
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("不接受字段", rejected.data["detail"])

    def test_member_invocation_is_attributed_to_agent_and_skill_owner(self):
        self.agent.skill_ids = [self.asset.skill_id]
        self.agent.save(update_fields=["skill_ids"])

        skill_markdown = (
            "---\n"
            "name: 智能体日报\n"
            "description: 生成经营日报\n"
            "---\n"
            "生成日报时必须标注统计日期。"
        )
        with mock.patch("apps.skills.service.load_asset_content", return_value=skill_markdown):
            context = build_agent_capability_context(
                self.agent,
                self.member,
                "生成今天的经营日报",
                record_usage=True,
            )

        self.assertEqual(context["skills"][0]["skill_id"], self.asset.skill_id)
        event = SkillUsageEvent.objects.get()
        self.assertEqual(event.agent_id, self.agent.id)
        self.assertEqual(event.user_id, self.member.id)
        self.assertEqual(event.asset_id, self.asset.id)

        self.client.force_authenticate(self.owner)
        usage = self.client.get(f"/api/council/agents/{self.agent.id}/skill-usage/")
        self.assertEqual(usage.status_code, 200)
        self.assertEqual(usage.data["summary"]["total_invocations"], 1)
        self.assertEqual(usage.data["summary"]["other_user_invocations"], 1)
        self.assertEqual(usage.data["summary"]["utilization_rate"], 100.0)
        self.assertTrue(usage.data["skills"][0]["configured"])
        self.assertEqual(usage.data["skills"][0]["owner"]["id"], self.owner.id)
        self.assertEqual(usage.data["recent_usage"][0]["caller"]["id"], self.member.id)

    def test_member_cannot_change_skills_or_read_usage_detail(self):
        self.client.force_authenticate(self.member)

        update = self.client.patch(
            f"/api/council/agents/{self.agent.id}/skills/",
            {"skill_ids": [self.asset.skill_id]},
            format="json",
        )
        usage = self.client.get(f"/api/council/agents/{self.agent.id}/skill-usage/")

        self.assertEqual(update.status_code, 403)
        self.assertEqual(usage.status_code, 403)

    def test_usage_summary_only_contains_agents_the_user_can_manage(self):
        other_agent = AgentProfile.objects.create(
            organization=self.organization,
            created_by=self.member,
            owner=self.member,
            name="成员智能体",
        )
        SkillUsageEvent.objects.create(
            skill_id=self.asset.skill_id,
            skill_name=self.asset.name,
            asset=self.asset,
            user=self.member,
            agent=self.agent,
        )

        self.client.force_authenticate(self.owner)
        response = self.client.get("/api/council/agents/skill-usage/summary/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["agent_count"], 2)
        self.assertEqual(response.data["summary"]["total_invocations"], 1)
        self.assertCountEqual(
            [row["agent"]["id"] for row in response.data["results"]],
            [self.agent.id, other_agent.id],
        )
