from datetime import timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.core.models import UserSettings
from apps.skills.analytics import record_skill_usage
from apps.skills.models import SkillAsset, SkillUsageEvent, UserSkill


class SkillAnalyticsApiTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.manager = User.objects.create_user(username="manager", password="pass", is_staff=True)
        self.member = User.objects.create_user(username="member", password="pass")
        self.outsider = User.objects.create_user(username="outsider", password="pass")
        UserSettings.objects.create(user=self.member, avatar="member-avatar.png")
        UserSettings.objects.create(user=self.outsider, avatar="outsider-avatar.png")
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
            category=SkillAsset.Category.BUSINESS,
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
        self.assertEqual(
            response.data["skills"][0]["owner_avatar_url"],
            "/api/auth/avatars/member-avatar.png/",
        )
        self.assertCountEqual(
            [event["avatar_url"] for event in response.data["skills"][0]["recent_usage"]],
            ["/api/auth/avatars/member-avatar.png/", "/api/auth/avatars/outsider-avatar.png/"],
        )
        self.assertCountEqual(
            [person["user"] for person in response.data["people_ranking"]],
            ["member", "outsider"],
        )
        self.assertCountEqual(
            [person["avatar_url"] for person in response.data["people_ranking"]],
            ["/api/auth/avatars/member-avatar.png/", "/api/auth/avatars/outsider-avatar.png/"],
        )
        self.assertTrue(all(person["usage_count_30d"] == 1 for person in response.data["people_ranking"]))
        self.assertTrue(all(person["skill_count_30d"] == 1 for person in response.data["people_ranking"]))
        self.assertTrue(response.data["skills"][0]["is_uploader"])
        self.assertEqual(response.data["owner_options"], [])
        self.assertEqual(response.data["trend_by_category"]["all"]["total"], 2)
        self.assertEqual(response.data["trend_by_category"]["business"]["total"], 2)
        self.assertEqual(response.data["trend_by_category"]["business"]["unique_users"], 2)
        self.assertEqual(response.data["trend_by_category"]["business"]["active_skills"], 1)
        self.assertEqual(response.data["trend_by_category"]["content"]["total"], 0)
        self.assertEqual(len(response.data["trend_by_category"]["business"]["points"]), 7)
        self.assertEqual(response.data["trend_range"]["days"], 7)

    def test_trend_supports_custom_date_range(self):
        self.client.force_authenticate(self.member)
        today = timezone.localdate()
        start = today - timedelta(days=29)

        response = self.client.get(reverse("skill-analytics"), {
            "trend_start": start.isoformat(),
            "trend_end": today.isoformat(),
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["trend_range"], {
            "start": start.isoformat(),
            "end": today.isoformat(),
            "days": 30,
        })
        self.assertEqual(len(response.data["trend_by_category"]["all"]["points"]), 30)
        self.assertEqual(response.data["trend_by_category"]["all"]["total"], 2)

    def test_trend_rejects_invalid_or_oversized_date_range(self):
        self.client.force_authenticate(self.member)
        today = timezone.localdate()

        reversed_response = self.client.get(reverse("skill-analytics"), {
            "trend_start": today.isoformat(),
            "trend_end": (today - timedelta(days=1)).isoformat(),
        })
        oversized_response = self.client.get(reverse("skill-analytics"), {
            "trend_start": (today - timedelta(days=90)).isoformat(),
            "trend_end": today.isoformat(),
        })

        self.assertEqual(reversed_response.status_code, 400)
        self.assertEqual(oversized_response.status_code, 400)

    def test_non_responsible_user_only_sees_their_own_usage(self):
        self.client.force_authenticate(self.outsider)
        response = self.client.get(reverse("skill-analytics"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["total_invocations"], 1)
        self.assertEqual(response.data["skills"][0]["unique_users_30d"], 1)
        self.assertEqual(response.data["skills"][0]["recent_usage"][0]["user"], "outsider")
        self.assertEqual(
            response.data["skills"][0]["recent_usage"][0]["avatar_url"],
            "/api/auth/avatars/outsider-avatar.png/",
        )
        self.assertEqual(response.data["people_ranking"][0]["user"], "outsider")
        self.assertEqual(response.data["people_ranking"][0]["usage_count_30d"], 1)
        self.assertFalse(response.data["skills"][0]["is_uploader"])

        history = self.client.get(reverse("skill-asset-usage", args=[self.asset.id]))
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.data["count"], 1)
        self.assertEqual(history.data["results"][0]["user"], "outsider")
        self.assertEqual(history.data["results"][0]["avatar_url"], "/api/auth/avatars/outsider-avatar.png/")

    def test_uploader_can_page_through_complete_usage_history(self):
        self.client.force_authenticate(self.member)
        response = self.client.get(
            reverse("skill-asset-usage", args=[self.asset.id]),
            {"page": 1, "page_size": 1},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(response.data["page_size"], 1)
        self.assertEqual(len(response.data["results"]), 1)

    def test_staff_sees_governance_metrics_and_can_reassign_owner(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(reverse("skill-analytics"))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["can_manage"])
        self.assertEqual(response.data["summary"]["total_invocations"], 2)
        self.assertEqual(response.data["skills"][0]["adoption_count"], 2)
        self.assertEqual(response.data["skills"][0]["unique_users_30d"], 2)
        self.assertEqual(len(response.data["people_ranking"]), 2)

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
