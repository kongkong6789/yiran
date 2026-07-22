from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import Organization, OrganizationMembership, TaskTemplate


class TaskTemplateApiTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="template-owner", password="password")
        self.organization = Organization.objects.create(name="Template workspace", created_by=self.user)
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.user,
            role=OrganizationMembership.Role.OWNER,
            is_primary=True,
        )
        self.client.force_authenticate(self.user)

    def test_template_crud_and_duplicate_keep_action_contract_separate(self):
        listed = self.client.get("/api/task-templates/")
        self.assertEqual(listed.status_code, 200)
        self.assertTrue(any(row["key"] == "weekly-sales-review" for row in listed.data["results"]))

        created = self.client.post("/api/task-templates/", {
            "name": "品牌 A 销售周报",
            "description": "只分析品牌 A",
            "category": "report",
            "actionName": "report.generate",
            "prompt": "生成品牌 A 销售周报",
            "defaults": {"output_type": "weekly_report", "scope": "all", "brand_ids": ["品牌A"]},
            "visibility": "personal",
            "estimatedMinutes": 10,
        }, format="json")
        self.assertEqual(created.status_code, 201)
        key = created.data["key"]
        row = TaskTemplate.objects.get(template_key=key)
        self.assertEqual(row.organization, self.organization)
        self.assertEqual(row.defaults["brand_ids"], ["品牌A"])

        updated = self.client.patch(f"/api/task-templates/{key}/", {"name": "品牌 A 周报（新版）"}, format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["name"], "品牌 A 周报（新版）")

        duplicated = self.client.post(f"/api/task-templates/{key}/duplicate/", {}, format="json")
        self.assertEqual(duplicated.status_code, 201)
        self.assertNotEqual(duplicated.data["key"], key)

        deleted = self.client.delete(f"/api/task-templates/{key}/")
        self.assertEqual(deleted.status_code, 204)
        row.refresh_from_db()
        self.assertFalse(row.is_active)

    def test_unknown_action_contract_is_rejected(self):
        response = self.client.post("/api/task-templates/", {
            "name": "非法模板",
            "category": "report",
            "actionName": "unsafe.write.anything",
            "prompt": "绕过动作契约",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(TaskTemplate.objects.count(), 0)

    def test_builtin_template_can_be_overridden_and_restored_for_workspace(self):
        updated = self.client.patch(
            "/api/task-templates/weekly-sales-review/",
            {"name": "工作区销售周报", "defaults": {"brand_ids": ["品牌A"]}},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["key"], "weekly-sales-review")
        self.assertTrue(updated.data["builtin"])
        self.assertTrue(updated.data["overridden"])
        override = TaskTemplate.objects.get(builtin_key="weekly-sales-review")
        self.assertEqual(override.organization, self.organization)
        self.assertEqual(override.visibility, TaskTemplate.Visibility.WORKSPACE)

        listed = self.client.get("/api/task-templates/")
        effective = next(row for row in listed.data["results"] if row["key"] == "weekly-sales-review")
        self.assertEqual(effective["name"], "工作区销售周报")
        self.assertEqual(sum(row["key"] == "weekly-sales-review" for row in listed.data["results"]), 1)

        restored = self.client.delete("/api/task-templates/weekly-sales-review/")
        self.assertEqual(restored.status_code, 204)
        self.assertFalse(TaskTemplate.objects.filter(builtin_key="weekly-sales-review").exists())
        default = self.client.get("/api/task-templates/weekly-sales-review/")
        self.assertFalse(default.data["overridden"])
