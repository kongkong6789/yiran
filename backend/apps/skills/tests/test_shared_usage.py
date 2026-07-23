from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.skills.analytics import record_skill_usage
from apps.skills.models import SkillAsset, SkillUsageEvent, UserSkill
from apps.skills.service import resolve_skills


class SharedSkillUsageTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user("shared-owner", password="pw")
        self.member = user_model.objects.create_user("shared-member", password="pw")
        self.asset = SkillAsset.objects.create(
            uploader=self.owner,
            owner=self.owner,
            skill_id="shared-report",
            name="共享日报",
            description="团队共享的日报技能",
            visibility=SkillAsset.Visibility.SHARED,
            original_filename="SKILL.md",
        )

    @patch(
        "apps.skills.service.load_asset_content",
        return_value="---\nname: 共享日报\ndescription: 生成团队日报\n---\n\n请生成日报。",
    )
    def test_using_shared_skill_records_usage_without_adopting(self, _load_content):
        resolved = resolve_skills("请用 @shared-report 处理", self.member)

        self.assertEqual(len(resolved), 1)
        self.assertIsNone(resolved[0].pk)
        self.assertEqual(resolved[0].source_asset_id, self.asset.id)
        self.assertFalse(UserSkill.objects.filter(user=self.member).exists())

        record_skill_usage(resolved, self.member, source=SkillUsageEvent.Source.AGENT)

        event = SkillUsageEvent.objects.get(user=self.member)
        self.assertEqual(event.asset_id, self.asset.id)
        self.assertEqual(event.skill_id, self.asset.skill_id)
        self.assertFalse(UserSkill.objects.filter(user=self.member).exists())

    def test_private_skill_cannot_be_used_without_adopting(self):
        self.asset.visibility = SkillAsset.Visibility.PRIVATE
        self.asset.save(update_fields=["visibility"])

        self.assertEqual(resolve_skills("@shared-report", self.member), [])
        self.assertFalse(UserSkill.objects.filter(user=self.member).exists())
