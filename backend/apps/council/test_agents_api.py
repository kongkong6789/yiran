from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.core.models import Organization, OrganizationMembership
from apps.orchestration.models import SopDefinition

from .models import AgentProfile


User = get_user_model()


class AgentApiTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="owner", password="pass")
        self.member = User.objects.create_user(username="member", password="pass")
        self.organization = Organization.objects.create(name="测试企业", created_by=self.owner)
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.owner,
            role=OrganizationMembership.Role.OWNER,
            is_primary=True,
        )
        self.sop = SopDefinition.objects.create(
            organization=self.organization,
            sop_key="finance.reconcile",
            name="财务对账",
            business_domain="财务",
            description="核对费用与经营数据",
            status=SopDefinition.Status.PUBLISHED,
            current_version="1.0.0",
            created_by=self.owner,
            updated_by=self.owner,
        )
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.member,
            role=OrganizationMembership.Role.MEMBER,
            is_primary=True,
        )

    def test_owner_can_create_list_update_and_archive_agent(self):
        self.client.force_authenticate(self.owner)

        create_response = self.client.post(
            reverse("council-agents"),
            {
                "name": "财务智能体",
                "group": "财务",
                "role": "财务分析师",
                "expertise": "费用分析与经营对账",
                "persona": "先核对事实，再给出结论。",
                "capability_instructions": "先核对事实，再给出结论。",
                "execution_role": "manager",
                "is_active": True,
                "skill_ids": [],
                "knowledge_base_ids": [],
                "sop_keys": [self.sop.sop_key],
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, 201)
        agent_id = create_response.data["id"]
        agent = AgentProfile.objects.get(id=agent_id)
        self.assertEqual(agent.organization, self.organization)
        self.assertEqual(agent.created_by, self.owner)
        self.assertEqual(agent.owner, self.owner)
        self.assertTrue(agent.employee_code.startswith("DE-"))
        self.assertEqual(agent.sop_keys, ["finance.reconcile"])

        list_response = self.client.get(reverse("council-agents"))
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data["count"], 1)
        self.assertTrue(list_response.data["permissions"]["can_create"])
        self.assertEqual(list_response.data["results"][0]["organization_name"], "测试企业")
        self.assertTrue(list_response.data["results"][0]["can_manage"])
        self.assertEqual(list_response.data["results"][0]["sops"][0]["name"], "财务对账")

        update_response = self.client.patch(
            reverse("council-agent-detail", args=[agent_id]),
            {"name": "财务伙伴", "is_active": False},
            format="json",
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data["name"], "财务伙伴")
        self.assertEqual(update_response.data["status"], "disabled")

        invalid_sop_response = self.client.patch(
            reverse("council-agent-detail", args=[agent_id]),
            {"sop_keys": ["missing.sop"]},
            format="json",
        )
        self.assertEqual(invalid_sop_response.status_code, 400)
        self.assertIn("sop_keys", invalid_sop_response.data)

        delete_response = self.client.delete(
            reverse("council-agent-detail", args=[agent_id])
        )
        self.assertEqual(delete_response.status_code, 204)
        agent.refresh_from_db()
        self.assertEqual(agent.lifecycle_status, AgentProfile.LifecycleStatus.ARCHIVED)

        after_archive = self.client.get(reverse("council-agents"))
        self.assertEqual(after_archive.data["count"], 0)

    def test_member_can_view_but_cannot_create_or_update_agent(self):
        agent = AgentProfile.objects.create(
            organization=self.organization,
            created_by=self.owner,
            owner=self.owner,
            name="运营智能体",
        )
        self.client.force_authenticate(self.member)

        list_response = self.client.get(reverse("council-agents"))
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data["count"], 1)
        self.assertFalse(list_response.data["permissions"]["can_create"])
        self.assertFalse(list_response.data["results"][0]["can_manage"])

        create_response = self.client.post(
            reverse("council-agents"),
            {"name": "无权创建"},
            format="json",
        )
        self.assertEqual(create_response.status_code, 403)

        update_response = self.client.patch(
            reverse("council-agent-detail", args=[agent.id]),
            {"name": "无权修改"},
            format="json",
        )
        self.assertEqual(update_response.status_code, 403)
