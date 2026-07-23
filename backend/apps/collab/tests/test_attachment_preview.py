import tempfile
from io import BytesIO
from pathlib import Path

from openpyxl import Workbook
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.collab.models import CollabParticipant, CollabRoom


User = get_user_model()


class CollabAttachmentPreviewTests(TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.override = override_settings(CHAT_ATTACHMENTS_ROOT=Path(self.tempdir.name))
        self.override.enable()
        self.user = User.objects.create_user(username="preview-owner", password="test-pass")
        self.room = CollabRoom.objects.create(
            title="产物预览",
            room_kind="group",
            created_by=self.user,
        )
        CollabParticipant.objects.create(room=self.room, user=self.user)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def tearDown(self):
        self.override.disable()
        self.tempdir.cleanup()

    def test_markdown_attachment_can_be_previewed_and_downloaded(self):
        upload = SimpleUploadedFile(
            "report.md",
            "# 周报\n\n本周完成库存分析。".encode(),
            content_type="text/markdown",
        )
        sent = self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/",
            {"content": "", "files": [upload]},
            format="multipart",
        )
        self.assertEqual(sent.status_code, 201)
        attachment = sent.data["message"]["attachments"][0]

        preview = self.client.get(f"{attachment['url']}?preview=1")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data["kind"], "markdown")
        self.assertIn("库存分析", preview.data["text"])

        download = self.client.get(f"{attachment['url']}?download=1")
        self.assertEqual(download.status_code, 200)
        self.assertIn("attachment", download["Content-Disposition"])

    def test_spreadsheet_attachment_has_bounded_table_preview(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "经营数据"
        sheet.append(["品牌", "销售额"])
        sheet.append(["良策", 128000])
        stream = BytesIO()
        workbook.save(stream)
        workbook.close()

        sent = self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/",
            {
                "content": "",
                "files": [SimpleUploadedFile(
                    "report.xlsx",
                    stream.getvalue(),
                    content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )],
            },
            format="multipart",
        )
        self.assertEqual(sent.status_code, 201)

        preview = self.client.get(
            f"{sent.data['message']['attachments'][0]['url']}?preview=1",
        )
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data["kind"], "spreadsheet")
        self.assertEqual(preview.data["sheets"][0]["name"], "经营数据")
        self.assertEqual(preview.data["sheets"][0]["rows"][1], ["良策", "128000"])
