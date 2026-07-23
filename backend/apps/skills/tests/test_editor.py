from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from apps.skills.models import UserSkill
from apps.skills.repository import materialize_user_skill, save_skill_asset_from_bytes


@override_settings(USE_TENCENT_COS=False)
class SkillEditorApiTests(APITestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.override = override_settings(SKILLS_WORKSPACE_ROOT=Path(self.temp.name))
        self.override.enable()
        users = get_user_model()
        self.owner = users.objects.create_user("editor-owner", password="pw")
        self.member = users.objects.create_user("editor-member", password="pw")
        archive_name = "inventory-helper.zip"
        from apps.skills.parser import build_skill_folder_archive
        filename, data = build_skill_folder_archive([
            ("inventory-helper/SKILL.md", b"---\nname: Inventory helper\ndescription: old\n---\n\n# Old\n"),
            ("inventory-helper/scripts/check.py", b"print('old')\n"),
        ])
        self.assertEqual(filename.rsplit(".", 1)[-1], archive_name.rsplit(".", 1)[-1])
        self.asset, _ = save_skill_asset_from_bytes(
            self.owner,
            filename,
            data,
            adopt=True,
            visibility="shared",
        )
        materialize_user_skill(self.member, self.asset)

    def tearDown(self):
        self.override.disable()
        self.temp.cleanup()

    def test_shared_member_can_browse_but_only_owner_can_edit(self):
        self.client.force_authenticate(self.member)
        response = self.client.get(reverse("skill-asset-files", args=[self.asset.id]))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["can_edit"])
        self.assertEqual(len(response.data["files"]), 2)

        response = self.client.put(
            reverse("skill-asset-file-detail", args=[self.asset.id, "scripts/check.py"]),
            {"content": "print('member')\n", "expected_version": response.data["version"]},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_owner_edit_updates_adopted_skill_and_rejects_stale_save(self):
        self.client.force_authenticate(self.owner)
        listing = self.client.get(reverse("skill-asset-files", args=[self.asset.id]))
        version = listing.data["version"]
        path = self.asset.skill_md_key
        content = "---\nname: Inventory helper\ndescription: updated\n---\n\n# New workflow\n"
        response = self.client.put(
            reverse("skill-asset-file-detail", args=[self.asset.id, path]),
            {"content": content, "expected_version": version},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.data["version"], version)
        self.assertEqual(UserSkill.objects.get(user=self.member, source_asset=self.asset).description, "updated")

        stale = self.client.put(
            reverse("skill-asset-file-detail", args=[self.asset.id, path]),
            {"content": content + "stale", "expected_version": version},
            format="json",
        )
        self.assertEqual(stale.status_code, 409)
        self.assertTrue(stale.data["conflict"])

    @patch("apps.skills.agent_editor.llm.chat_messages_result")
    def test_owner_can_edit_selected_skill_from_chat_tool(self, mocked_llm):
        from apps.skills.agent_editor import try_edit_skill_from_chat

        mocked_llm.return_value = {
            "content": '{"content":"---\\nname: Inventory helper\\ndescription: agent updated\\n---\\n\\n# Agent workflow\\n","summary":"更新流程"}'
        }
        skill = UserSkill.objects.get(user=self.owner, source_asset=self.asset)
        result = try_edit_skill_from_chat("请修改技能，把流程写清楚", [skill], self.owner)
        self.assertTrue(result["ok"])
        self.assertEqual(UserSkill.objects.get(user=self.member, source_asset=self.asset).description, "agent updated")
