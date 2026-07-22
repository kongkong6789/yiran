from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core.models import OrganizationMembership
from apps.core.organizations import assign_user_to_organization, create_personal_organization
from .models import McpServerConfig
from .nas_files import (
    NasFileError,
    create_access_ticket,
    list_directory,
    preview_file,
    read_access_ticket,
    read_nas_for_agent,
)


class NasFileServiceTests(SimpleTestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        (self.root / "合同").mkdir()
        (self.root / "合同" / "子目录").mkdir()
        (self.root / "合同" / "条款.txt").write_text("第一条：按时交付", encoding="utf-8")
        (self.root / "合同" / "子目录" / "备注.md").write_text("需要法务复核", encoding="utf-8")
        (self.root / "合同" / "附件.bin").write_bytes(b"binary")
        (self.root / "说明.txt").write_text("NAS 文件预览", encoding="utf-8")

    def tearDown(self):
        self.temp_dir.cleanup()

    def _config(self):
        return {
            "enabled": True,
            "configured": True,
            "args": ["-y", "@modelcontextprotocol/server-filesystem", str(self.root)],
        }

    def test_list_directory_and_preview_text_file(self):
        with patch("apps.mcp.nas_files.resolve_config", return_value=self._config()):
            payload = list_directory(user=object())
            preview = preview_file(user=object(), virtual_path="/说明.txt")

        self.assertEqual(payload["count"], 2)
        self.assertEqual(payload["entries"][0]["kind"], "folder")
        self.assertEqual(payload["entries"][0]["name"], "合同")
        self.assertTrue(preview["previewable"])
        self.assertEqual(preview["content"], "NAS 文件预览")

    def test_rejects_parent_path_escape(self):
        with patch("apps.mcp.nas_files.resolve_config", return_value=self._config()):
            with self.assertRaises(NasFileError) as caught:
                list_directory(user=object(), virtual_path="/../")

        self.assertEqual(caught.exception.status_code, 403)

    def test_requires_enabled_config(self):
        config = {"enabled": False, "configured": False, "args": []}
        with patch("apps.mcp.nas_files.resolve_config", return_value=config):
            with self.assertRaises(NasFileError) as caught:
                list_directory(user=object())

        self.assertEqual(caught.exception.status_code, 409)

    def test_unc_server_root_lists_disk_shares(self):
        config = {
            "enabled": True,
            "configured": True,
            "args": ["-y", "@modelcontextprotocol/server-filesystem", r"\\192.168.0.188"],
        }
        with (
            patch("apps.mcp.nas_files.resolve_config", return_value=config),
            patch("apps.mcp.nas_files._list_windows_shares", return_value=["amuse", "财务部"]),
        ):
            payload = list_directory(user=object())

        self.assertEqual(payload["root_name"], "192.168.0.188")
        self.assertEqual([item["name"] for item in payload["entries"]], ["amuse", "财务部"])
        self.assertTrue(all(item["kind"] == "folder" for item in payload["entries"]))

    def test_agent_reads_explicit_nas_path_without_upload(self):
        user = SimpleNamespace(id=17)
        with patch("apps.mcp.nas_files.resolve_config", return_value=self._config()):
            result = read_nas_for_agent(user, "请读取 NAS：`/说明.txt`")

        self.assertTrue(result["attempted"])
        self.assertEqual(result["error"], "")
        self.assertEqual(result["files"][0]["name"], "说明.txt")
        self.assertEqual(result["files"][0]["text"], "NAS 文件预览")
        self.assertIn("download_url", result["files"][0])

    def test_agent_accepts_configured_native_path_wrapped_in_backticks(self):
        user = SimpleNamespace(id=17)
        native_path = self.root / "说明.txt"
        with patch("apps.mcp.nas_files.resolve_config", return_value=self._config()):
            result = read_nas_for_agent(user, f"请读取 NAS：`{native_path}`")

        self.assertEqual(result["error"], "")
        self.assertEqual([item["name"] for item in result["files"]], ["说明.txt"])

    def test_agent_reads_folder_files_recursively_with_bounded_context(self):
        user = SimpleNamespace(id=17)
        with patch("apps.mcp.nas_files.resolve_config", return_value=self._config()):
            result = read_nas_for_agent(user, "请读取 NAS 文件夹：`/合同`")

        self.assertEqual(result["error"], "")
        self.assertEqual(
            {item["path"] for item in result["files"]},
            {"/合同/条款.txt", "/合同/附件.bin", "/合同/子目录/备注.md"},
        )
        self.assertIn("第一条：按时交付", result["content"])
        self.assertIn("需要法务复核", result["content"])
        self.assertTrue(all(item["download_url"] for item in result["files"]))

    def test_signed_file_ticket_is_scoped_to_user_and_path(self):
        ticket = create_access_ticket(SimpleNamespace(id=23), "/共享/说明.txt")
        payload = read_access_ticket(ticket)

        self.assertEqual(payload, {"user_id": 23, "path": "/共享/说明.txt"})


class NasDownloadEndpointTests(TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.file = self.root / "下载测试.txt"
        self.file.write_text("download works", encoding="utf-8")
        self.user = get_user_model().objects.create_user(username="nas-test-user")
        self.organization = create_personal_organization(
            self.user,
            name="NAS 测试企业",
        ).organization
        McpServerConfig.objects.create(
            user=self.user,
            organization=self.organization,
            server_id="nas",
            command="npx",
            args=["-y", "@modelcontextprotocol/server-filesystem", str(self.root)],
            enabled=True,
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_download_with_signed_ticket_without_auth_header(self):
        ticket = create_access_ticket(self.user, "/下载测试.txt")
        response = self.client.get(
            reverse("mcp-server-file-download", args=["nas"]),
            {"ticket": ticket, "download": "1"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), b"download works")
        self.assertIn("attachment", response["Content-Disposition"])


class McpEnterpriseIsolationTests(TestCase):
    server_id = "wecom"

    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(username="mcp-org-owner")
        self.member = User.objects.create_user(username="mcp-org-member")
        self.other_owner = User.objects.create_user(username="mcp-other-owner")
        self.organization = create_personal_organization(
            self.owner,
            name="连接器企业 A",
        ).organization
        assign_user_to_organization(
            self.member,
            self.organization,
            role=OrganizationMembership.Role.MEMBER,
        )
        self.other_organization = create_personal_organization(
            self.other_owner,
            name="连接器企业 B",
        ).organization
        McpServerConfig.objects.create(
            organization=self.organization,
            user=self.owner,
            server_id=self.server_id,
            url="https://enterprise-a.example/mcp",
        )
        McpServerConfig.objects.create(
            organization=self.other_organization,
            user=self.other_owner,
            server_id=self.server_id,
            url="https://enterprise-b.example/mcp",
        )
        self.client = APIClient()

    def test_member_reads_enterprise_config_but_cannot_modify_it(self):
        self.client.force_authenticate(self.member)
        response = self.client.get(f"/api/mcp/servers/{self.server_id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["url"], "https://enterprise-a.example/mcp")
        self.assertEqual(response.data["organization_id"], self.organization.id)
        self.assertFalse(response.data["can_manage"])

        update = self.client.patch(
            f"/api/mcp/servers/{self.server_id}/",
            {"url": "https://forbidden.example/mcp"},
            format="json",
        )
        self.assertEqual(update.status_code, 403)
        self.assertEqual(
            McpServerConfig.objects.get(
                organization=self.organization,
                server_id=self.server_id,
            ).url,
            "https://enterprise-a.example/mcp",
        )

    def test_owner_update_does_not_modify_another_enterprise(self):
        self.client.force_authenticate(self.owner)
        response = self.client.patch(
            f"/api/mcp/servers/{self.server_id}/",
            {"url": "https://enterprise-a-new.example/mcp", "enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            McpServerConfig.objects.get(
                organization=self.organization,
                server_id=self.server_id,
            ).url,
            "https://enterprise-a-new.example/mcp",
        )
        self.assertEqual(
            McpServerConfig.objects.get(
                organization=self.other_organization,
                server_id=self.server_id,
            ).url,
            "https://enterprise-b.example/mcp",
        )
