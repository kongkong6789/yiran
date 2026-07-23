import io
import tempfile
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from openpyxl import Workbook

from apps.core.attachments import (
    attachment_public_meta,
    load_stored_attachments,
    process_uploaded_files,
)


def workbook_bytes() -> bytes:
    stream = io.BytesIO()
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "补货计划"
    sheet.append(["SKU", "商品名称", "建议补货量"])
    sheet.append(["SKU-001", "修护洗发水", 120])
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


class StoredAttachmentTests(SimpleTestCase):
    def test_excel_text_is_extracted_and_rehydrated_after_public_metadata_storage(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(CHAT_ATTACHMENTS_ROOT=Path(tmp)):
                uploaded = SimpleUploadedFile(
                    "补货计划.xlsx",
                    workbook_bytes(),
                    content_type=(
                        "application/vnd.openxmlformats-officedocument."
                        "spreadsheetml.sheet"
                    ),
                )
                processed = process_uploaded_files([uploaded], user_id=7)

                self.assertTrue(processed[0]["has_text"])
                self.assertIn("工作表: 补货计划", processed[0]["text"])
                self.assertIn("SKU-001", processed[0]["text"])
                self.assertIn("建议补货量", processed[0]["text"])

                public = attachment_public_meta(processed)
                self.assertNotIn("text", public[0])
                restored = load_stored_attachments(public, user_id=7)

                self.assertTrue(restored[0]["has_text"])
                self.assertIn("修护洗发水", restored[0]["text"])
                self.assertIn("120", restored[0]["text"])

    def test_missing_stored_attachment_reports_that_it_cannot_be_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(CHAT_ATTACHMENTS_ROOT=Path(tmp)):
                restored = load_stored_attachments(
                    [{"id": "missing.xlsx", "name": "missing.xlsx"}],
                    user_id=7,
                )

        self.assertTrue(restored[0]["has_text"])
        self.assertIn("不可用或已删除", restored[0]["text"])
