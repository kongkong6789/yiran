from django.test import SimpleTestCase

from apps.orchestration.report_html import markdown_to_html_document


class ReportHtmlTests(SimpleTestCase):
    def test_markdown_lists_render_without_f_string_parser_errors(self):
        rendered = markdown_to_html_document("- 第一项\n- 第二项\n\n1. 第一步\n2. 第二步")

        self.assertIn("<ul><li>第一项</li><li>第二项</li></ul>", rendered)
        self.assertIn("<ol><li>第一步</li><li>第二步</li></ol>", rendered)

    def test_html_document_keeps_hero_title(self):
        rendered = markdown_to_html_document("正文内容", title="天猫销售周报")
        self.assertIn("<h1>天猫销售周报</h1>", rendered)
        self.assertIn("正文内容", rendered)
