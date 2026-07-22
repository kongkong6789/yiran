import io
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings

from apps.skills.models import SkillAsset, UserSkill
from apps.skills import repository
from apps.skills.repository import (
    find_shared_asset,
    list_skill_assets,
    save_skill_asset_from_bytes,
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

    def test_private_asset_can_use_a_stable_room_skill_id_and_auto_enable(self):
        content = b"---\nname: Room workflow\ndescription: Prepared workflow\n---\n\nFollow the steps."
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as package:
            package.writestr("SKILL.md", content)
            package.writestr("references/workflow-summary.md", "Prepared summary")
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(SKILLS_WORKSPACE_ROOT=tmp):
                with patch("apps.skills.repository.cos_enabled", return_value=False):
                    asset, personal = save_skill_asset_from_bytes(
                        self.owner,
                        "room-workflow.zip",
                        archive.getvalue(),
                        adopt=True,
                        visibility=SkillAsset.Visibility.PRIVATE,
                        skill_id_override="xiaoce-room-123",
                    )

        self.assertEqual(asset.skill_id, "xiaoce-room-123")
        self.assertEqual(asset.visibility, SkillAsset.Visibility.PRIVATE)
        self.assertIsNotNone(personal)
        self.assertEqual(personal.skill_id, asset.skill_id)
        self.assertTrue(personal.enabled)

    def test_storage_snapshot_cleanup_removes_cos_manifest_and_staged_local_paths(self):
        self.assertTrue(hasattr(repository, "delete_skill_storage"))
        with tempfile.TemporaryDirectory() as tmp:
            user_root = Path(tmp) / str(self.owner.id)
            staged_root = user_root / "private-stage"
            staged_file = staged_root / "references" / "summary.md"
            staged_file.parent.mkdir(parents=True)
            staged_file.write_text("staged", encoding="utf-8")
            snapshot = {
                "uploader_id": self.owner.id,
                "skill_id": "private-stage",
                "cos_bucket": "skill-bucket",
                "cos_key": "",
                "package_kind": "package",
                "package_manifest": [
                    {
                        "path": "references/summary.md",
                        "cos_key": "skills/1/private-stage/references/summary.md",
                        "local_path": str(staged_file),
                    },
                ],
            }

            with override_settings(SKILLS_WORKSPACE_ROOT=tmp):
                with patch("apps.skills.repository.delete_skill_package") as delete_package:
                    repository.delete_skill_storage(snapshot)

            delete_package.assert_called_once_with(
                "skill-bucket",
                snapshot["package_manifest"],
            )
            self.assertFalse(staged_file.exists())
            self.assertFalse(staged_root.exists())
