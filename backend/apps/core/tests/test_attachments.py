import io
import importlib.util
import re
import tempfile
import zipfile
from pathlib import Path
from unittest import skipUnless

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from openpyxl import Workbook

from apps.core.attachments import (
    MAX_ATTACH_BYTES,
    attachment_public_meta,
    format_attachment_context,
    load_stored_attachments,
    process_uploaded_files,
)
from apps.core.document_io import MAX_EXTRACT_CHARS, extract_document


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


def sparse_workbook_bytes() -> bytes:
    stream = io.BytesIO()
    workbook = Workbook()
    sheet = workbook.active
    sheet["A1"] = "可读取"
    # 恶意/异常维度不能让附件解析器遍历一百万个空行。
    sheet["A1000000"] = "不应扫描到"
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


def archive_bytes(entries: list[tuple[str, bytes]], *, compression=zipfile.ZIP_DEFLATED) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=compression) as archive:
        for name, content in entries:
            archive.writestr(name, content)
    return stream.getvalue()


def docx_bytes() -> bytes:
    return archive_bytes([
        (
            "[Content_Types].xml",
            b'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        ),
        (
            "word/document.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
            <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
              <w:body>
                <w:p><w:r><w:t>季度经营报告</w:t></w:r></w:p>
                <w:tbl>
                  <w:tr><w:tc><w:p><w:r><w:t>渠道</w:t></w:r></w:p></w:tc>
                    <w:tc><w:p><w:r><w:t>GMV</w:t></w:r></w:p></w:tc></w:tr>
                  <w:tr><w:tc><w:p><w:r><w:t>天猫</w:t></w:r></w:p></w:tc>
                    <w:tc><w:p><w:r><w:t>1200</w:t></w:r></w:p></w:tc></w:tr>
                </w:tbl>
              </w:body>
            </w:document>""".encode(),
        ),
    ])


def pptx_bytes() -> bytes:
    return archive_bytes([
        (
            "[Content_Types].xml",
            b'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        ),
        (
            "ppt/slides/slide1.xml",
            """<?xml version="1.0" encoding="UTF-8"?>
            <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                   xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <p:cSld><p:spTree><p:sp><p:txBody><a:p>
                <a:r><a:t>新品发布</a:t></a:r>
                <a:r><a:t>销售目标 300 万</a:t></a:r>
              </a:p></p:txBody></p:sp></p:spTree></p:cSld>
            </p:sld>""".encode(),
        ),
    ])


def png_bytes() -> bytes:
    from PIL import Image

    stream = io.BytesIO()
    image = Image.new("RGB", (2, 2), color=(20, 80, 140))
    image.save(stream, format="PNG")
    image.close()
    return stream.getvalue()


def oversized_pixel_png_bytes() -> bytes:
    from PIL import Image

    stream = io.BytesIO()
    image = Image.new("1", (5001, 5001))
    image.save(stream, format="PNG")
    image.close()
    return stream.getvalue()


def encrypted_zip_flag(data: bytes) -> bytes:
    """Set the encryption bit in local and central ZIP headers for validation."""
    output = bytearray(data)
    local = output.find(b"PK\x03\x04")
    central = output.find(b"PK\x01\x02")
    if local >= 0:
        flags = int.from_bytes(output[local + 6:local + 8], "little") | 0x1
        output[local + 6:local + 8] = flags.to_bytes(2, "little")
    if central >= 0:
        flags = int.from_bytes(output[central + 8:central + 10], "little") | 0x1
        output[central + 8:central + 10] = flags.to_bytes(2, "little")
    return bytes(output)


def xlsx_with_nonstandard_oversized_worksheet_target() -> bytes:
    source = workbook_bytes()
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(source), "r") as original:
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as mutated:
            for info in original.infolist():
                content = original.read(info.filename)
                name = info.filename
                if name == "xl/_rels/workbook.xml.rels":
                    content = content.replace(b"sheet1.xml", b"evil.bin")
                elif name == "xl/worksheets/sheet1.xml":
                    name = "xl/worksheets/evil.bin"
                    content = re.sub(
                        rb'<dimension ref="[^"]+"\s*/>',
                        b'<dimension ref="A1:XFD1048576"/>',
                        content,
                        count=1,
                    )
                mutated.writestr(name, content)
    return output.getvalue()


def xlsx_with_unknown_sheet_relationship_type() -> bytes:
    source = workbook_bytes()
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(source), "r") as original:
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as mutated:
            for info in original.infolist():
                content = original.read(info.filename)
                if info.filename == "xl/_rels/workbook.xml.rels":
                    content = content.replace(
                        b"/relationships/worksheet",
                        b"/relationships/not-a-worksheet",
                    )
                mutated.writestr(info.filename, content)
    return output.getvalue()


def xlsx_with_external_sheet_target_mode() -> bytes:
    source = workbook_bytes()
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(source), "r") as original:
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as mutated:
            for info in original.infolist():
                content = original.read(info.filename)
                if info.filename == "xl/_rels/workbook.xml.rels":
                    content = re.sub(
                        rb'(<Relationship\b[^>]*Type="[^"]*/worksheet"[^>]*)/>',
                        rb'\1 TargetMode="External"/>',
                        content,
                        count=1,
                    )
                mutated.writestr(info.filename, content)
    return output.getvalue()


def damaged_stored_docx_bytes(*, unknown_compression: bool = False) -> bytes:
    xml = (
        b'<w:document xmlns:w="http://schemas.openxmlformats.org/'
        b'wordprocessingml/2006/main"><w:body/></w:document>'
    )
    payload = bytearray(
        archive_bytes(
            [("word/document.xml", xml)],
            compression=zipfile.ZIP_STORED,
        )
    )
    if unknown_compression:
        local = payload.find(b"PK\x03\x04")
        central = payload.find(b"PK\x01\x02")
        payload[local + 8:local + 10] = (99).to_bytes(2, "little")
        payload[central + 10:central + 12] = (99).to_bytes(2, "little")
    else:
        content = payload.find(xml)
        payload[content + len(xml) // 2] ^= 0x01
    return bytes(payload)


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

    def test_sparse_excel_dimension_is_bounded_to_a_safe_physical_row_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(CHAT_ATTACHMENTS_ROOT=Path(tmp)):
                uploaded = SimpleUploadedFile(
                    "sparse.xlsx",
                    sparse_workbook_bytes(),
                    content_type=(
                        "application/vnd.openxmlformats-officedocument."
                        "spreadsheetml.sheet"
                    ),
                )
                processed = process_uploaded_files([uploaded], user_id=7)

        text = processed[0]["text"]
        self.assertIn("可读取", text)
        self.assertNotIn("不应扫描到", text)
        self.assertIn("仅扫描前 200 行以保证安全", text)

    def test_structured_extraction_fields_survive_public_metadata_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(CHAT_ATTACHMENTS_ROOT=Path(tmp)):
                processed = process_uploaded_files(
                    [SimpleUploadedFile("report.md", b"# Report\n\nreal evidence")],
                    user_id=8,
                )
                public = attachment_public_meta(processed)
                restored = load_stored_attachments(public, user_id=8)

        self.assertEqual(processed[0]["extraction_status"], "success")
        self.assertEqual(public[0]["extraction_status"], "success")
        self.assertFalse(public[0]["truncated"])
        self.assertEqual(public[0]["metadata"]["parser"], "md")
        self.assertEqual(restored[0]["extraction_status"], "success")
        self.assertIn("real evidence", restored[0]["text"])

    def test_html_removes_active_content_before_model_context(self):
        result = extract_document(
            "report.html",
            b"<html><body><h1>Visible title</h1><script>steal_secret()</script>"
            b"<style>.hidden{}</style><p>Visible body</p></body></html>",
        )

        self.assertEqual(result.status, "success")
        self.assertIn("Visible title", result.text)
        self.assertIn("Visible body", result.text)
        self.assertNotIn("steal_secret", result.text)
        self.assertNotIn(".hidden", result.text)
        self.assertTrue(result.metadata["active_content_removed"])

    def test_json_csv_tsv_xml_rtf_and_code_are_read_structurally(self):
        json_result = extract_document("data.json", b'{"sku":"A-1","qty":3}')
        csv_result = extract_document("data.csv", "sku,数量\nA-1,3".encode())
        tsv_result = extract_document("data.tsv", "sku\t数量\nA-1\t3".encode())
        xml_result = extract_document(
            "data.xml",
            b'<?xml version="1.0"?><root><sku>A-1</sku><qty unit="pcs">3</qty></root>',
        )
        rtf_result = extract_document(
            "brief.rtf",
            rb"{\rtf1\ansi Quarterly \b report\b0\par GMV 1200}",
        )
        code_result = extract_document("query.ts", b"const sku: string = 'A-1';")

        self.assertIn('"sku": "A-1"', json_result.text)
        self.assertEqual(json_result.metadata["validated"], True)
        self.assertIn("sku\t数量", csv_result.text)
        self.assertEqual(csv_result.metadata["delimiter"], ",")
        self.assertIn("A-1\t3", tsv_result.text)
        self.assertEqual(tsv_result.metadata["delimiter"], "\t")
        self.assertIn("root/sku: A-1", xml_result.text)
        self.assertIn("unit=pcs", xml_result.text)
        self.assertIn("Quarterly", rtf_result.text)
        self.assertIn("GMV 1200", rtf_result.text)
        self.assertIn("const sku", code_result.text)

    def test_rtf_rejects_unbounded_or_unclosed_group_nesting(self):
        excessive_nesting = extract_document(
            "nested.rtf",
            b"{\\rtf1 " + (b"{" * (1024 * 1024)),
        )
        unclosed = extract_document("unclosed.rtf", b"{\\rtf1 visible")

        self.assertEqual(excessive_nesting.status, "error")
        self.assertIn("嵌套深度", excessive_nesting.error)
        self.assertEqual(unclosed.status, "error")
        self.assertIn("未闭合", unclosed.error)

    def test_invalid_json_and_dangerous_xml_report_explicit_errors(self):
        invalid_json = extract_document("bad.json", b'{"missing":')
        dangerous_xml = extract_document(
            "bad.xml",
            b'<!DOCTYPE root [<!ENTITY x "boom">]><root>&x;</root>',
        )

        self.assertEqual(invalid_json.status, "error")
        self.assertIn("JSON 解析失败", invalid_json.error)
        self.assertEqual(dangerous_xml.status, "error")
        self.assertIn("DTD", dangerous_xml.error)

    def test_csv_row_and_column_limits_are_explicit(self):
        rows = [",".join(f"c{index}" for index in range(45))]
        rows.extend(f"{index},value" for index in range(205))
        result = extract_document("large.csv", "\n".join(rows).encode())

        self.assertEqual(result.status, "truncated")
        self.assertTrue(result.truncated)
        self.assertLessEqual(len(result.text), MAX_EXTRACT_CHARS)
        self.assertIn("其余列已省略", result.text)
        self.assertIn("内容已按安全上限截断", result.text)

    def test_docx_paragraphs_and_tables_are_read_without_executing_office(self):
        result = extract_document("report.docx", docx_bytes())

        self.assertEqual(result.status, "success")
        self.assertIn("季度经营报告", result.text)
        self.assertIn("渠道 | GMV", result.text)
        self.assertIn("天猫 | 1200", result.text)
        self.assertEqual(result.metadata["paragraph_count"], 1)
        self.assertEqual(result.metadata["table_count"], 1)

    def test_pptx_slides_are_read_in_slide_order(self):
        result = extract_document("launch.pptx", pptx_bytes())

        self.assertEqual(result.status, "success")
        self.assertIn("幻灯片 1", result.text)
        self.assertIn("新品发布", result.text)
        self.assertIn("销售目标 300 万", result.text)
        self.assertEqual(result.metadata["slide_count"], 1)

    def test_corrupt_ooxml_reports_failure_instead_of_read_success(self):
        for name in ("bad.docx", "bad.pptx", "bad.xlsx"):
            with self.subTest(name=name):
                result = extract_document(name, b"not-a-zip")
                self.assertEqual(result.status, "error")
                self.assertTrue(result.error)

    def test_xlsx_validates_actual_relationship_target_even_without_xml_suffix(self):
        result = extract_document(
            "nonstandard-target.xlsx",
            xlsx_with_nonstandard_oversized_worksheet_target(),
        )

        self.assertEqual(result.status, "error")
        self.assertIn("声明维度过大", result.error)

    def test_xlsx_rejects_unknown_sheet_relationship_type(self):
        result = extract_document(
            "unknown-relation.xlsx",
            xlsx_with_unknown_sheet_relationship_type(),
        )

        self.assertEqual(result.status, "error")
        self.assertIn("不受支持的关系类型", result.error)

    def test_xlsx_rejects_external_sheet_target_mode(self):
        result = extract_document(
            "external-target.xlsx",
            xlsx_with_external_sheet_target_mode(),
        )

        self.assertEqual(result.status, "error")
        self.assertIn("TargetMode", result.error)

    def test_corrupt_zip_entry_reads_are_structured_errors(self):
        for payload in (
            damaged_stored_docx_bytes(),
            damaged_stored_docx_bytes(unknown_compression=True),
        ):
            with self.subTest(unknown_compression=payload[8:10] == (99).to_bytes(2, "little")):
                result = extract_document("broken.docx", payload)
                self.assertEqual(result.status, "error")
                self.assertIn("ZIP 条目", result.error)

    def test_zip_lists_names_without_extracting_contents(self):
        result = extract_document(
            "bundle.zip",
            archive_bytes([
                ("reports/", b""),
                ("reports/q1.md", b"secret report body"),
                ("data/summary.csv", b"a,b\n1,2"),
            ]),
        )

        self.assertEqual(result.status, "success")
        self.assertIn("reports/q1.md", result.text)
        self.assertIn("data/summary.csv", result.text)
        self.assertNotIn("secret report body", result.text)
        self.assertFalse(result.metadata["contents_extracted"])

    def test_zip_rejects_traversal_encryption_duplicate_and_bomb_shapes(self):
        traversal = archive_bytes([("../escape.txt", b"bad")])
        encrypted = encrypted_zip_flag(archive_bytes([("locked.txt", b"secret")]))
        with self.assertWarns(UserWarning):
            duplicate = archive_bytes([("same.txt", b"one"), ("same.txt", b"two")])
        bomb = archive_bytes([("huge.txt", b"A" * (2 * 1024 * 1024))])

        expectations = (
            (traversal, "路径穿越"),
            (encrypted, "加密"),
            (duplicate, "重复"),
            (bomb, "压缩比异常"),
        )
        for payload, detail in expectations:
            with self.subTest(detail=detail):
                result = extract_document("unsafe.zip", payload)
                self.assertEqual(result.status, "error")
                self.assertIn(detail, result.error)

    def test_real_image_header_is_required_and_svg_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(CHAT_ATTACHMENTS_ROOT=Path(tmp)):
                valid = process_uploaded_files(
                    [SimpleUploadedFile("real.png", png_bytes(), content_type="image/png")],
                    user_id=9,
                )
                self.assertTrue(valid[0]["is_image"])
                self.assertEqual(valid[0]["mime"], "image/png")
                self.assertEqual(valid[0]["extraction_status"], "image")
                self.assertIn("data_url", valid[0])
                self.assertNotIn("image_base64", valid[0])

                with self.assertRaisesRegex(ValueError, "内容与格式不匹配"):
                    process_uploaded_files(
                        [SimpleUploadedFile("fake.png", b"<script>bad</script>", content_type="image/png")],
                        user_id=9,
                    )
                with self.assertRaisesRegex(ValueError, "SVG"):
                    process_uploaded_files(
                        [SimpleUploadedFile("bad.svg", b"<svg/>", content_type="image/svg+xml")],
                        user_id=9,
                    )
                with self.assertRaisesRegex(ValueError, "损坏或不完整"):
                    process_uploaded_files(
                        [
                            SimpleUploadedFile(
                                "truncated.png",
                                b"\x89PNG\r\n\x1a\ntruncated",
                                content_type="image/png",
                            )
                        ],
                        user_id=9,
                    )
                with self.assertRaisesRegex(ValueError, "扩展名与声明"):
                    process_uploaded_files(
                        [
                            SimpleUploadedFile(
                                "report.pdf",
                                png_bytes(),
                                content_type="image/png",
                            )
                        ],
                        user_id=9,
                    )
                with self.assertRaisesRegex(ValueError, "像素总量"):
                    process_uploaded_files(
                        [
                            SimpleUploadedFile(
                                "oversized.png",
                                oversized_pixel_png_bytes(),
                                content_type="image/png",
                            )
                        ],
                        user_id=9,
                    )

    def test_batch_upload_failure_rolls_back_files_written_earlier_in_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with override_settings(CHAT_ATTACHMENTS_ROOT=root):
                with self.assertRaisesRegex(ValueError, "暂不支持文件类型"):
                    process_uploaded_files(
                        [
                            SimpleUploadedFile("first.txt", b"must be rolled back"),
                            SimpleUploadedFile("second.exe", b"unsupported"),
                        ],
                        user_id=10,
                    )

            user_root = root / "10"
            self.assertEqual(list(user_root.iterdir()), [])

    def test_upload_is_read_in_bounded_chunks_and_oversize_temp_file_is_removed(self):
        class StreamingUpload:
            name = "stream.txt"
            content_type = "text/plain"
            size = None

            def __init__(self):
                self.remaining = MAX_ATTACH_BYTES + 1
                self.max_requested = 0

            def seek(self, _offset):
                self.remaining = MAX_ATTACH_BYTES + 1

            def read(self, size=-1):
                if size < 0:
                    raise AssertionError("unbounded upload.read() is forbidden")
                self.max_requested = max(self.max_requested, size)
                amount = min(size, self.remaining)
                self.remaining -= amount
                return b"x" * amount

        upload = StreamingUpload()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with override_settings(CHAT_ATTACHMENTS_ROOT=root):
                with self.assertRaisesRegex(ValueError, "超过 20MB"):
                    process_uploaded_files([upload], user_id=11)
            self.assertEqual(list((root / "11").iterdir()), [])

        self.assertLessEqual(upload.max_requested, 64 * 1024)

    def test_legacy_office_and_media_have_explicit_unsupported_status(self):
        for name in ("legacy.doc", "deck.ppt", "voice.mp3", "archive.rar"):
            with self.subTest(name=name):
                result = extract_document(name, b"download-only")
                self.assertEqual(result.status, "unsupported")
                self.assertTrue(result.error)
                self.assertTrue(result.has_text)

    def test_attachment_context_states_success_truncation_scan_and_damage(self):
        context = format_attachment_context([
            {
                "name": "ok.md",
                "size": 2,
                "text": "ok",
                "extraction_status": "success",
            },
            {
                "name": "large.csv",
                "size": 20,
                "text": "partial",
                "extraction_status": "truncated",
                "truncated": True,
            },
            {
                "name": "scan.pdf",
                "size": 30,
                "text": "（需要 OCR）",
                "extraction_status": "scanned",
                "extraction_error": "需要 OCR",
            },
            {
                "name": "bad.docx",
                "size": 40,
                "text": "（文件损坏）",
                "extraction_status": "error",
                "extraction_error": "文件损坏",
            },
        ])

        self.assertIn("解析成功]", context)
        self.assertIn("内容已截断", context)
        self.assertIn("扫描件并需要 OCR", context)
        self.assertIn("解析失败或文件损坏", context)


@skipUnless(
    importlib.util.find_spec("pypdf") and importlib.util.find_spec("reportlab"),
    "PDF parser test dependencies are not installed",
)
class PdfAttachmentTests(SimpleTestCase):
    @staticmethod
    def _text_pdf() -> bytes:
        from reportlab.pdfgen import canvas

        stream = io.BytesIO()
        pdf = canvas.Canvas(stream)
        pdf.drawString(72, 720, "Quarterly GMV 1200")
        pdf.save()
        return stream.getvalue()

    def test_text_pdf_is_read_and_blank_pdf_is_identified_as_scanned(self):
        from pypdf import PdfWriter

        text_result = extract_document("report.pdf", self._text_pdf())
        blank_stream = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)
        writer.write(blank_stream)
        scanned_result = extract_document("scan.pdf", blank_stream.getvalue())

        self.assertEqual(text_result.status, "success")
        self.assertIn("Quarterly GMV 1200", text_result.text)
        self.assertEqual(scanned_result.status, "scanned")
        self.assertIn("OCR", scanned_result.error)

    def test_encrypted_pdf_has_explicit_status(self):
        from pypdf import PdfWriter

        stream = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)
        writer.encrypt("secret")
        writer.write(stream)

        result = extract_document("locked.pdf", stream.getvalue())
        self.assertEqual(result.status, "encrypted")
        self.assertIn("加密", result.error)
