from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.knowledge import traditional_rag
from apps.knowledge.traditional_rag import TraditionalRagError, clean_mineru_markdown, detect_file_type, prepare_content_for_parsing


@dataclass(frozen=True)
class _FakeMineruResult:
    markdown: bytes
    metadata: dict


class TraditionalRagFileTypeTests(SimpleTestCase):
    def test_mineru_backed_file_types_are_accepted(self):
        for filename in ("manual.pdf", "legacy.doc", "deck.ppt", "deck.pptx", "sheet.xls"):
            with self.subTest(filename=filename):
                self.assertEqual(detect_file_type(filename, b"source-bytes"), "mineru_markdown")

    def test_unsupported_file_type_still_fails(self):
        with self.assertRaises(TraditionalRagError) as ctx:
            detect_file_type("mail.msg", b"source-bytes")
        self.assertEqual(ctx.exception.code, "unsupported_file_type")


    def test_clean_mineru_markdown_removes_images_and_html_table_tags(self):
        markdown = b"![](images/page.jpg)\n\n<table><tr><td>Name</td><td>Value</td></tr></table>"
        cleaned = clean_mineru_markdown(markdown).decode("utf-8")
        self.assertNotIn("![](", cleaned)
        self.assertNotIn("<table", cleaned)
        self.assertNotIn("<td", cleaned)
        self.assertIn("Name", cleaned)
        self.assertIn("Value", cleaned)
    def test_prepare_mineru_content_returns_markdown_payload(self):
        with patch.object(
            traditional_rag,
            "parse_to_markdown",
            return_value=_FakeMineruResult(markdown=b"![](images/page.jpg)\n\n# Parsed\n\n<table><tr><td>Text</td></tr></table>", metadata={"task_id": "task-1"}),
        ) as parse_to_markdown:
            content, file_type, metadata = prepare_content_for_parsing(
                filename="manual.pdf",
                content=b"pdf-bytes",
                file_type="mineru_markdown",
                content_metadata={"ingest_mode": "traditional-rag"},
                document_id="knowledge-file-1",
            )

        decoded = content.decode("utf-8")
        self.assertIn("Parsed", decoded)
        self.assertIn("Text", decoded)
        self.assertNotIn("![](", decoded)
        self.assertNotIn("<table", decoded)
        self.assertEqual(file_type, "markdown")
        self.assertEqual(metadata["ingest_mode"], "mineru-traditional-rag")
        self.assertEqual(metadata["source_file_type"], "mineru_markdown")
        self.assertEqual(metadata["mineru"]["task_id"], "task-1")
        self.assertIn("converted_content_hash", metadata)
        parse_to_markdown.assert_called_once_with(
            filename="manual.pdf",
            content=b"pdf-bytes",
            document_id="knowledge-file-1",
        )
