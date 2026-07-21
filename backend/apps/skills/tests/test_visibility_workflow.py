from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.test import APITestCase
from unittest.mock import patch

from apps.skills.models import SkillAsset, UserSkill


def make_asset(user, *, visibility=SkillAsset.Visibility.PRIVATE):
    return SkillAsset.objects.create(
        uploader=user,
        owner=user,
        skill_id="governed-skill",
        name="Governed skill",
        visibility=visibility,
        original_filename="SKILL.md",
        cos_bucket="",
        cos_key="SKILL.md",
        cos_url="",
    )


class SkillVisibilityWorkflowTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user("visibility-owner", password="pw")
        self.member = User.objects.create_user("visibility-member", password="pw")
        self.asset = make_asset(self.owner)
        UserSkill.objects.create(
            user=self.owner,
            skill_id=self.asset.skill_id,
            name=self.asset.name,
            source_asset=self.asset,
            enabled=True,
        )

    def test_private_upload_is_not_visible_or_auto_adopted_by_other_users(self):
        self.client.force_authenticate(self.member)

        assets = self.client.get(reverse("skill-asset-list"))
        skills = self.client.get(reverse("skill-list"))

        self.assertEqual(assets.status_code, 200)
        self.assertEqual(assets.data["count"], 0)
        self.assertEqual(skills.status_code, 200)
        self.assertEqual(skills.data["count"], 0)
        self.assertFalse(UserSkill.objects.filter(user=self.member).exists())

    def test_publish_requires_explicit_adoption_and_unpublish_revokes_other_users(self):
        self.client.force_authenticate(self.owner)
        publish = self.client.patch(
            reverse("skill-asset-visibility", args=[self.asset.id]),
            {"visibility": SkillAsset.Visibility.SHARED},
            format="json",
        )
        self.assertEqual(publish.status_code, 200)

        self.client.force_authenticate(self.member)
        assets = self.client.get(reverse("skill-asset-list"))
        skills_before = self.client.get(reverse("skill-list"))
        with patch("apps.skills.views.materialize_user_skill") as materialize:
            materialize.side_effect = lambda user, asset: UserSkill.objects.create(
                user=user,
                skill_id=asset.skill_id,
                name=asset.name,
                source_asset=asset,
                enabled=True,
            )
            adopt = self.client.post(reverse("skill-asset-adopt", args=[self.asset.skill_id]))

        self.assertEqual(assets.data["count"], 1)
        self.assertEqual(skills_before.data["count"], 0)
        self.assertEqual(adopt.status_code, 200)
        self.assertTrue(UserSkill.objects.filter(user=self.member, source_asset=self.asset).exists())

        self.client.force_authenticate(self.owner)
        unpublish = self.client.patch(
            reverse("skill-asset-visibility", args=[self.asset.id]),
            {"visibility": SkillAsset.Visibility.PRIVATE},
            format="json",
        )

        self.assertEqual(unpublish.status_code, 200)
        self.assertGreaterEqual(unpublish.data["revoked_count"], 1)
        self.assertFalse(UserSkill.objects.filter(user=self.member, source_asset=self.asset).exists())
        self.assertTrue(UserSkill.objects.filter(user=self.owner, source_asset=self.asset).exists())

    def test_non_uploader_cannot_change_visibility(self):
        self.client.force_authenticate(self.member)
        response = self.client.patch(
            reverse("skill-asset-visibility", args=[self.asset.id]),
            {"visibility": SkillAsset.Visibility.SHARED},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

    def test_deleting_asset_removes_all_linked_personal_skills(self):
        self.asset.visibility = SkillAsset.Visibility.SHARED
        self.asset.save(update_fields=["visibility"])
        UserSkill.objects.create(
            user=self.member,
            skill_id=self.asset.skill_id,
            name=self.asset.name,
            source_asset=self.asset,
            enabled=True,
        )
        self.client.force_authenticate(self.owner)

        response = self.client.delete(reverse("skill-asset-detail", args=[self.asset.skill_id]))

        self.assertEqual(response.status_code, 204)
        self.assertFalse(SkillAsset.objects.filter(id=self.asset.id).exists())
        self.assertFalse(UserSkill.objects.filter(skill_id=self.asset.skill_id).exists())
