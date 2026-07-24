from django.test import SimpleTestCase

from apps.orchestration.sop_api import (
    _clarification_response,
    _is_clarification_response,
    _normalize_clarify_questions,
)


class SopClarifyHelpersTests(SimpleTestCase):
    def test_normalize_clarify_questions_keeps_short_clickable_prompts(self):
        self.assertEqual(
            _normalize_clarify_questions([" 先确认删哪一步 ", "", "用企微通知", 12, None]),
            ["先确认删哪一步", "用企微通知", "12"],
        )
        self.assertEqual(len(_normalize_clarify_questions([f"q{i}" for i in range(10)])), 4)

    def test_is_clarification_response_detects_flags_and_questions(self):
        self.assertTrue(_is_clarification_response({"need_clarification": True}))
        self.assertTrue(_is_clarification_response({"needClarification": True, "questions": ["A"]}))
        self.assertTrue(_is_clarification_response({"changed": False, "questions": ["要删确认点吗？"]}))
        self.assertFalse(_is_clarification_response({"changed": False, "assistant": "这是说明"}))
        self.assertFalse(_is_clarification_response({"changed": True, "graph": {}}))

    def test_clarification_response_payload_shape(self):
        payload = _clarification_response(
            {
                "assistant": "想先确认通知渠道",
                "need_clarification": True,
                "questions": ["发企微", "发邮件", ""],
            },
            draft={"key": "demo"},
            node_count=5,
            model="test-model",
            target_keys=["n1"],
        )
        self.assertFalse(payload["changed"])
        self.assertTrue(payload["needClarification"])
        self.assertEqual(payload["scope"], "clarify")
        self.assertEqual(payload["draft"], {"key": "demo"})
        self.assertEqual(payload["questions"], ["发企微", "发邮件"])
        self.assertEqual(payload["targetNodeKeys"], ["n1"])
        self.assertTrue(any(tool["name"] == "clarify" for tool in payload["tools"]))
