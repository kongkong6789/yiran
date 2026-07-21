from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.skills.models import SkillAsset


class SkillCategoryApiTests(APITestCase):
    def setUp(self):
        self.uploader = User.objects.create_user("category-owner", password="pw")
        self.member = User.objects.create_user("category-member", password="pw")
        self.asset = SkillAsset.objects.create(
            uploader=self.uploader,
            owner=self.uploader,
            skill_id="category-skill",
            name="Category skill",
            original_filename="SKILL.md",
            cos_bucket="",
            cos_key="SKILL.md",
            cos_url="",
        )

    def test_uploader_can_change_category(self):
        self.client.force_authenticate(self.uploader)

        response = self.client.patch(
            reverse("skill-asset-category", args=[self.asset.id]),
            {"category": SkillAsset.Category.ANALYSIS},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.category, SkillAsset.Category.ANALYSIS)
        self.assertEqual(response.data["asset"]["category"], SkillAsset.Category.ANALYSIS)

    def test_regular_member_cannot_change_category(self):
        self.client.force_authenticate(self.member)

        response = self.client.patch(
            reverse("skill-asset-category", args=[self.asset.id]),
            {"category": SkillAsset.Category.CONTENT},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_rejects_unknown_category(self):
        self.client.force_authenticate(self.uploader)

        response = self.client.patch(
            reverse("skill-asset-category", args=[self.asset.id]),
            {"category": "unexpected"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"], "能力分类无效")
