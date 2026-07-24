import tempfile
from pathlib import Path

from django.test import SimpleTestCase, override_settings

from apps.core.generated_artifacts import (
    detect_artifact_request,
    materialize_generated_artifacts,
    sanitize_static_html,
)


class GeneratedArtifactTests(SimpleTestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.override = override_settings(
            CHAT_ATTACHMENTS_ROOT=Path(self.tempdir.name),
        )
        self.override.enable()

    def tearDown(self):
        self.override.disable()
        self.tempdir.cleanup()

    def test_html_report_request_materializes_a_real_file(self):
        visible, artifacts = materialize_generated_artifacts(
            message="请生成一个 HTML 图表报告文件",
            reply="销售额：120 万\n\n转化率：18%",
            user_id=7,
        )

        self.assertIn("已生成文件", visible)
        self.assertEqual(len(artifacts), 1)
        artifact = artifacts[0]
        self.assertTrue(artifact["artifact"])
        self.assertEqual(artifact["mime"], "text/html")
        path = Path(artifact["stored_path"])
        self.assertTrue(path.is_file())
        html = path.read_text()
        self.assertIn("<!doctype html>", html.lower())
        self.assertIn("销售额", html)
        self.assertNotIn("<script", html.lower())

    def test_model_artifact_protocol_is_extracted_from_visible_reply(self):
        visible, artifacts = materialize_generated_artifacts(
            message="输出 report.html 文件",
            reply=(
                '文件已完成。\n'
                '<<<LIANGCE_ARTIFACT filename="report.html" mime="text/html">>>\n'
                '<h1>库存报告</h1><script>alert(1)</script>\n'
                '<<<END_LIANGCE_ARTIFACT>>>'
            ),
            user_id=9,
        )

        self.assertEqual(visible, "文件已完成。\n\n已生成文件：`report.html`")
        content = Path(artifacts[0]["stored_path"]).read_text()
        self.assertIn("库存报告", content)
        self.assertNotIn("<script", content.lower())

    def test_non_file_request_does_not_create_artifact(self):
        self.assertIsNone(detect_artifact_request("帮我解释一下库存周转率"))

    def test_html_sanitizer_removes_active_and_remote_content(self):
        result = sanitize_static_html(
            '<img src="https://tracker.example/a" onerror="alert(1)">'
            '<iframe src="//evil.example"></iframe>'
        )
        self.assertNotIn("https://", result)
        self.assertNotIn("onerror", result)
        self.assertNotIn("<iframe", result)
