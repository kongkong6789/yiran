from django.test import SimpleTestCase

from apps.orchestration.sop_api import _normalize_editor_chat


class EditorChatNormalizeTests(SimpleTestCase):
    def test_normalize_keeps_trial_and_clarification(self):
        cleaned = _normalize_editor_chat([
            {"id": "welcome", "role": "assistant", "content": "欢迎"},
            {
                "id": "u1",
                "role": "user",
                "content": "优化流程",
            },
            {
                "id": "a1",
                "role": "assistant",
                "content": "先确认一下",
                "clarification": {"questions": ["删确认点", "保留确认点", ""]},
                "trial": {
                    "status": "completed",
                    "total": 4,
                    "current": 4,
                    "currentTitle": "完成",
                    "logs": [{"time": "10:00:00", "text": "开始", "status": "ok"}],
                    "artifacts": [{
                        "id": "report",
                        "kind": "markdown",
                        "title": "报告",
                        "summary": "摘要",
                        "content": "# 报告\n正文",
                    }],
                },
            },
        ])
        self.assertEqual(len(cleaned), 3)
        self.assertEqual(cleaned[2]["clarification"]["questions"], ["删确认点", "保留确认点"])
        self.assertEqual(cleaned[2]["trial"]["total"], 4)
        self.assertEqual(cleaned[2]["trial"]["artifacts"][0]["kind"], "markdown")

    def test_normalize_skips_invalid_roles(self):
        cleaned = _normalize_editor_chat([
            {"role": "system", "content": "x"},
            {"role": "user", "content": "你好"},
        ])
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0]["role"], "user")
