import io
import tempfile
import zipfile
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.skills.models import SkillAsset, UserSkill


class SkillFolderUploadApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("folder-owner", password="pw")
        self.client.force_authenticate(self.user)

    def test_uploads_browser_selected_folder_as_complete_skill_package(self):
        files = [
            SimpleUploadedFile("SKILL.md", b"---\nname: Folder skill\ndescription: Folder upload\n---\n\nRun it."),
            SimpleUploadedFile("run.py", b"print('ok')"),
        ]
        with tempfile.TemporaryDirectory() as workspace:
            with override_settings(SKILLS_WORKSPACE_ROOT=workspace):
                with patch("apps.skills.repository.cos_enabled", return_value=False):
                    response = self.client.post(
                        "/api/skills/assets/upload/",
                        {
                            "files": files,
                            "paths": ["folder-skill/SKILL.md", "folder-skill/scripts/run.py"],
                            "adopt": "1",
                            "category": SkillAsset.Category.AUTOMATION,
                        },
                        format="multipart",
                    )

        self.assertEqual(response.status_code, 201, response.data)
        asset = SkillAsset.objects.get(skill_id="folder-skill")
        self.assertEqual(asset.package_kind, "package")
        self.assertEqual(asset.category, SkillAsset.Category.AUTOMATION)
        self.assertEqual(asset.visibility, SkillAsset.Visibility.PRIVATE)
        self.assertEqual(
            [entry["path"] for entry in asset.package_manifest],
            ["SKILL.md", "scripts/run.py"],
        )
        self.assertTrue(UserSkill.objects.filter(user=self.user, source_asset=asset).exists())

    def test_keeps_zip_package_upload_supported(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as package:
            package.writestr("zip-skill/SKILL.md", "---\nname: Zip skill\n---\n\nRun zip.")
            package.writestr("zip-skill/scripts/run.py", "print('zip')")

        with tempfile.TemporaryDirectory() as workspace:
            with override_settings(SKILLS_WORKSPACE_ROOT=workspace):
                with patch("apps.skills.repository.cos_enabled", return_value=False):
                    response = self.client.post(
                        "/api/skills/assets/upload/",
                        {
                            "file": SimpleUploadedFile(
                                "zip-skill.zip",
                                archive.getvalue(),
                                content_type="application/zip",
                            ),
                            "adopt": "1",
                        },
                        format="multipart",
                    )

        self.assertEqual(response.status_code, 201, response.data)
        asset = SkillAsset.objects.get(skill_id="zip-skill")
        self.assertEqual(asset.package_kind, "package")
        self.assertEqual(asset.visibility, SkillAsset.Visibility.PRIVATE)
        self.assertEqual(len(asset.package_manifest), 2)

    def test_creates_skill_from_editor_content_with_explicit_skill_id(self):
        with tempfile.TemporaryDirectory() as workspace:
            with override_settings(SKILLS_WORKSPACE_ROOT=workspace):
                with patch("apps.skills.repository.cos_enabled", return_value=False):
                    response = self.client.post(
                        "/api/skills/assets/upload/",
                        {
                            "filename": "SKILL.md",
                            "skill_id": "daily-ops-copilot",
                            "content": "---\nname: 日常运营助手\ndescription: 从页面创建\n---\n\n分析运营数据并给出建议。",
                            "adopt": "1",
                            "category": SkillAsset.Category.BUSINESS,
                        },
                        format="multipart",
                    )

        self.assertEqual(response.status_code, 201, response.data)
        asset = SkillAsset.objects.get(skill_id="daily-ops-copilot")
        self.assertEqual(asset.name, "日常运营助手")
        self.assertEqual(asset.category, SkillAsset.Category.BUSINESS)
        self.assertTrue(UserSkill.objects.filter(user=self.user, source_asset=asset).exists())

    def test_rejects_folder_without_skill_manifest(self):
        response = self.client.post(
            "/api/skills/assets/upload/",
            {
                "files": [SimpleUploadedFile("run.py", b"print('missing manifest')")],
                "paths": ["broken-skill/scripts/run.py"],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("SKILL.md", response.data["error"])

    def test_rejects_unsafe_folder_paths(self):
        response = self.client.post(
            "/api/skills/assets/upload/",
            {
                "files": [SimpleUploadedFile("SKILL.md", b"# Unsafe")],
                "paths": ["../SKILL.md"],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("不安全", response.data["error"])

    def test_rejects_oversized_markdown_before_processing(self):
        with patch("apps.skills.views.MAX_SKILL_BYTES", 10):
            with patch("apps.skills.views.save_skill_asset_from_bytes") as save_asset:
                response = self.client.post(
                    "/api/skills/assets/upload/",
                    {"file": SimpleUploadedFile("SKILL.md", b"x" * 11)},
                    format="multipart",
                )

        self.assertEqual(response.status_code, 400)
        self.assertIn("过大", response.data["error"])
        save_asset.assert_not_called()

    def test_rejects_oversized_folder_before_processing(self):
        with patch("apps.skills.views.MAX_SKILL_ZIP_BYTES", 10):
            with patch("apps.skills.views.save_skill_asset_from_bytes") as save_asset:
                response = self.client.post(
                    "/api/skills/assets/upload/",
                    {
                        "files": [SimpleUploadedFile("SKILL.md", b"x" * 11)],
                        "paths": ["large-skill/SKILL.md"],
                    },
                    format="multipart",
                )

        self.assertEqual(response.status_code, 400)
        self.assertIn("文件夹过大", response.data["error"])
        save_asset.assert_not_called()

    def test_rejects_folder_with_too_many_files_before_processing(self):
        with patch("apps.skills.views.MAX_SKILL_PACKAGE_FILES", 1):
            with patch("apps.skills.views.save_skill_asset_from_bytes") as save_asset:
                response = self.client.post(
                    "/api/skills/assets/upload/",
                    {
                        "files": [
                            SimpleUploadedFile("SKILL.md", b"# Skill"),
                            SimpleUploadedFile("run.py", b"print('ok')"),
                        ],
                        "paths": ["large-skill/SKILL.md", "large-skill/scripts/run.py"],
                    },
                    format="multipart",
                )

        self.assertEqual(response.status_code, 400)
        self.assertIn("文件过多", response.data["error"])
        save_asset.assert_not_called()

    def test_rejects_zip_with_too_many_entries(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as package:
            package.writestr("zip-skill/SKILL.md", "# Skill")
            package.writestr("zip-skill/scripts/run.py", "print('ok')")

        with patch("apps.skills.parser.MAX_SKILL_PACKAGE_FILES", 1):
            response = self.client.post(
                "/api/skills/assets/upload/",
                {
                    "file": SimpleUploadedFile(
                        "zip-skill.zip",
                        archive.getvalue(),
                        content_type="application/zip",
                    ),
                },
                format="multipart",
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("文件过多", response.data["error"])

    def test_returns_diagnostic_error_when_storage_fails(self):
        with patch("apps.skills.views.save_skill_asset_from_bytes", side_effect=RuntimeError("COS unavailable")):
            response = self.client.post(
                "/api/skills/assets/upload/",
                {"file": SimpleUploadedFile("SKILL.md", b"# Skill")},
                format="multipart",
            )

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.data["error"], "技能存储服务处理失败，请稍后重试")
