from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.skills.analytics import record_skill_usage
from apps.skills.models import SkillAsset, SkillUsageEvent, UserSkill


class SkillAnalyticsApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.manager = User.objects.create_user(username="manager", password="pass", is_staff=True)
        self.member = User.objects.create_user(username="member", password="pass")
        self.outsider = User.objects.create_user(username="outsider", password="pass")
        self.asset = SkillAsset.objects.create(
            uploader=self.member,
            owner=self.member,
            skill_id="daily-report",
            name="日经营日报",
            description="汇总每日经营指标",
            original_filename="SKILL.md",
            cos_bucket="",
            cos_key="SKILL.md",
            cos_url="",
            visibility=SkillAsset.Visibility.SHARED,
        )
        self.member_skill = UserSkill.objects.create(
            user=self.member,
            skill_id=self.asset.skill_id,
            name=self.asset.name,
            source_asset=self.asset,
            enabled=True,
        )
        outsider_skill = UserSkill.objects.create(
            user=self.outsider,
            skill_id=self.asset.skill_id,
            name=self.asset.name,
            source_asset=self.asset,
            enabled=True,
        )
        record_skill_usage([self.member_skill], self.member, source=SkillUsageEvent.Source.AGENT)
        record_skill_usage([outsider_skill], self.outsider, source=SkillUsageEvent.Source.COLLAB)

    def test_responsible_user_sees_every_user_of_their_skill(self):
        self.client.force_authenticate(self.member)
        response = self.client.get(reverse("skill-analytics"))

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["can_manage"])
        self.assertEqual(response.data["summary"]["total_invocations"], 2)
        self.assertEqual(response.data["skills"][0]["unique_users_30d"], 2)
        self.assertCountEqual(
            [event["user"] for event in response.data["skills"][0]["recent_usage"]],
            ["member", "outsider"],
        )
        self.assertTrue(response.data["skills"][0]["is_uploader"])
        self.assertEqual(response.data["owner_options"], [])

    def test_non_responsible_user_only_sees_their_own_usage(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.get(reverse("skill-analytics"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["total_invocations"], 1)
        self.assertEqual(response.data["skills"][0]["unique_users_30d"], 1)
        self.assertEqual(response.data["skills"][0]["recent_usage"][0]["user"], "outsider")
        self.assertFalse(response.data["skills"][0]["is_uploader"])

    def test_staff_sees_governance_metrics_and_can_reassign_owner(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(reverse("skill-analytics"))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["can_manage"])
        self.assertEqual(response.data["summary"]["total_invocations"], 2)
        self.assertEqual(response.data["skills"][0]["adoption_count"], 2)
        self.assertEqual(response.data["skills"][0]["unique_users_30d"], 2)

        update = self.client.patch(
            reverse("skill-asset-owner", args=[self.asset.id]),
            {"owner_id": self.outsider.id},
            format="json",
        )
        self.assertEqual(update.status_code, 200)
        self.asset.refresh_from_db()
        self.assertEqual(self.asset.owner_id, self.outsider.id)

    def test_regular_user_cannot_reassign_owner(self):
        self.client.force_authenticate(self.member)
        response = self.client.patch(
            reverse("skill-asset-owner", args=[self.asset.id]),
            {"owner_id": self.member.id},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
