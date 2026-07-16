from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase

from apps.skills.models import SkillAsset, UserSkill
from apps.skills.repository import (
    ensure_shared_skills_for_user,
    find_shared_asset,
    list_skill_assets,
)


def make_asset(user, skill_id: str, visibility: str) -> SkillAsset:
    return SkillAsset.objects.create(
        uploader=user,
        skill_id=skill_id,
        name=skill_id,
        description=f"{skill_id} description",
        original_filename=f"{skill_id}.zip",
        cos_bucket="",
        cos_key="SKILL.md",
        cos_url="",
        file_size=128,
        visibility=visibility,
    )


class PrivateSkillAssetTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user("skill-owner", password="pw")
        self.other = User.objects.create_user("skill-other", password="pw")

    def test_private_assets_are_only_visible_in_the_owners_repository(self):
        private = make_asset(self.owner, "private-workflow", "private")
        shared = make_asset(self.owner, "shared-workflow", "shared")

        self.assertEqual(list_skill_assets(shared=True), [shared])
        self.assertCountEqual(
            list_skill_assets(user=self.owner, shared=False),
            [private, shared],
        )
        self.assertIsNone(find_shared_asset(private.skill_id))
        self.assertEqual(find_shared_asset(shared.skill_id), shared)

    def test_private_assets_are_not_auto_adopted_by_another_user(self):
        make_asset(self.owner, "private-workflow", "private")
        shared = make_asset(self.owner, "shared-workflow", "shared")

        def materialize(user, asset):
            return UserSkill.objects.create(
                user=user,
                skill_id=asset.skill_id,
                name=asset.name,
                source_asset=asset,
            )

        with patch("apps.skills.repository.materialize_user_skill", side_effect=materialize):
            created = ensure_shared_skills_for_user(self.other)

        self.assertEqual([row.skill_id for row in created], [shared.skill_id])
        self.assertEqual(
            list(UserSkill.objects.filter(user=self.other).values_list("skill_id", flat=True)),
            [shared.skill_id],
        )
