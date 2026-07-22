import base64
import io
import json
import tempfile
import zipfile
from unittest.mock import patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.skills.models import SkillAsset, UserSkill
from apps.skills.skillhub import calculate_content_hash, search_skills, verify_package_signature


def build_skill_zip() -> bytes:
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as package:
        package.writestr(
            "market-skill/SKILL.md",
            "---\nname: Market skill\ndescription: Imported from SkillHub\n---\n\nRun it.",
        )
        package.writestr("market-skill/scripts/run.py", "print('market')")
        package.writestr("market-skill/.DS_Store", "ignored")
    return archive.getvalue()


class SkillHubServiceTests(APITestCase):
    @patch("apps.skills.skillhub._get_json")
    def test_normalizes_search_results(self, get_json):
        get_json.return_value = {
            "code": 0,
            "data": {
                "total": 1,
                "skills": [{
                    "slug": "find-skill-skillhub",
                    "name": "find skill",
                    "description_zh": "查找技能",
                    "version": "1.0.2",
                    "downloads": 23664,
                    "stars": 92,
                    "labels": {"requires_api_key": "false"},
                }],
            },
        }

        result = search_skills(
            "https://www.skillhub.cn/skills/find-skill-skillhub",
            sort_by="stars",
            source="community",
            category="ai-agent",
            api_key="not_required",
        )

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["results"][0]["slug"], "find-skill-skillhub")
        self.assertEqual(result["results"][0]["version"], "1.0.2")
        self.assertFalse(result["results"][0]["requires_api_key"])
        params = get_json.call_args.kwargs["params"]
        self.assertEqual(params["keyword"], "find-skill-skillhub")
        self.assertEqual(params["sortBy"], "stars")
        self.assertEqual(params["source"], "community")
        self.assertEqual(params["category"], "ai-agent")
        self.assertEqual(params["labels"], "requires_api_key:false")

    @patch("apps.skills.skillhub._get_json")
    def test_filters_and_paginates_showcase_results(self, get_json):
        get_json.return_value = {
            "section": "recommended",
            "skills": [
                {
                    "slug": "office-no-key",
                    "name": "Office helper",
                    "description_zh": "办公助手",
                    "source": "community",
                    "category": "office-efficiency",
                    "labels": {"requires_api_key": "false"},
                },
                {
                    "slug": "office-with-key",
                    "name": "Office API helper",
                    "description_zh": "办公 API 助手",
                    "source": "enterprise",
                    "category": "office-efficiency",
                    "labels": {"requires_api_key": "true"},
                },
            ],
        }

        result = search_skills(
            "office",
            sort_by="curated_score",
            source="community",
            category="office-efficiency",
            api_key="required",
            page_size=1,
        )

        self.assertEqual(result["total"], 1)
        self.assertEqual(result["results"][0]["slug"], "office-with-key")
        get_json.assert_called_once_with("/api/v1/showcase/recommended")

    @patch("apps.skills.skillhub._get_json")
    def test_verifies_signature_and_content_hash(self, get_json):
        data = build_skill_zip()
        content_hash = calculate_content_hash(data)
        payload = json.dumps({
            "skill_slug": "market-skill",
            "skill_version": "1.2.0",
            "content_hash": content_hash,
        }, separators=(",", ":"))
        private_key = Ed25519PrivateKey.generate()
        public_key = private_key.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        signature = private_key.sign(payload.encode("utf-8"))
        get_json.side_effect = [
            {
                "signed": True,
                "payload": payload,
                "signature": base64.b64encode(signature).decode(),
                "content_hash": content_hash,
                "key_id": "test-key",
            },
            {"keys": [{"key_id": "test-key", "public_key_raw_b64": base64.b64encode(public_key).decode()}]},
        ]

        result = verify_package_signature("market-skill", "1.2.0", data)

        self.assertTrue(result["verified"])
        self.assertEqual(result["content_hash"], content_hash)


class SkillHubImportApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("market-owner", password="pw")
        self.client.force_authenticate(self.user)

    @patch("apps.skills.views.download_verified_skill")
    def test_imports_skillhub_zip_as_private_managed_asset(self, download_skill):
        data = build_skill_zip()
        content_hash = calculate_content_hash(data)
        download_skill.return_value = (
            {
                "slug": "market-skill",
                "name": "Market skill",
                "version": "1.2.0",
                "detail_url": "https://www.skillhub.cn/skills/market-skill",
                "owner": "SkillHub author",
                "downloads": 120,
                "stars": 8,
                "security_reports": {"keen": {"status": "benign", "status_text": "安全"}},
            },
            data,
            {"verified": True, "status": "verified", "content_hash": content_hash, "key_id": "platform-v1"},
        )

        with tempfile.TemporaryDirectory() as workspace:
            with override_settings(SKILLS_WORKSPACE_ROOT=workspace):
                with patch("apps.skills.repository.cos_enabled", return_value=False):
                    response = self.client.post(
                        "/api/skills/skillhub/import/",
                        {"slug": "market-skill", "version": "1.2.0", "category": "automation", "adopt": True},
                        format="json",
                    )
                    self.assertEqual(response.data["asset"]["visibility"], SkillAsset.Visibility.PRIVATE)
                    SkillAsset.objects.filter(uploader=self.user, skill_id="market-skill").update(
                        visibility=SkillAsset.Visibility.SHARED,
                    )
                    update_response = self.client.post(
                        "/api/skills/skillhub/import/",
                        {"slug": "market-skill", "version": "1.2.0", "category": "automation", "adopt": True},
                        format="json",
                    )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(update_response.status_code, 201, update_response.data)
        asset = SkillAsset.objects.get(uploader=self.user, skill_id="market-skill")
        self.assertEqual(asset.source, SkillAsset.Source.SKILLHUB)
        self.assertEqual(asset.source_version, "1.2.0")
        self.assertTrue(asset.source_verified)
        self.assertEqual(asset.visibility, SkillAsset.Visibility.SHARED)
        self.assertEqual(asset.category, SkillAsset.Category.AUTOMATION)
        self.assertTrue(UserSkill.objects.filter(user=self.user, source_asset=asset, enabled=True).exists())

    @patch("apps.skills.views.download_verified_skill")
    def test_returns_readable_error_when_skillhub_rejects_download(self, download_skill):
        from apps.skills.skillhub import SkillHubError

        download_skill.side_effect = SkillHubError("SkillHub 数字签名校验失败，已停止导入")

        response = self.client.post(
            "/api/skills/skillhub/import/",
            {"slug": "unsafe-skill", "version": "1.0.0"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("签名校验失败", response.data["error"])
