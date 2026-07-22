from django.test import SimpleTestCase

from apps.wecom.skill_todo import is_wecom_todo_skill, parse_wecom_todo_request


class _Skill:
    def __init__(self, skill_id: str, name: str = ""):
        self.skill_id = skill_id
        self.name = name


class WeComTodoSkillParseTests(SimpleTestCase):
    def test_detect_skill_ids(self):
        self.assertTrue(is_wecom_todo_skill(_Skill("wecom-todo", "企微待办")))
        self.assertTrue(is_wecom_todo_skill(_Skill("custom", "企业微信待办助手")))
        self.assertFalse(is_wecom_todo_skill(_Skill("brand-insight", "品牌洞察")))

    def test_parse_named_assignee(self):
        parsed = parse_wecom_todo_request("给张三创建一个企业微信待办：跟进合同盖章")
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.assignee_names, ["张三"])
        self.assertEqual(parsed.title, "跟进合同盖章")
        self.assertFalse(parsed.use_self)

    def test_parse_self_default(self):
        parsed = parse_wecom_todo_request("创建企微待办：检查本周库存")
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertTrue(parsed.use_self)
        self.assertEqual(parsed.title, "检查本周库存")

    def test_parse_multiple_assignees(self):
        parsed = parse_wecom_todo_request("给张三、李四创建待办：准备周会材料")
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.assignee_names, ["张三", "李四"])
        self.assertEqual(parsed.title, "准备周会材料")

    def test_parse_natural_after_skill_mention(self):
        parsed = parse_wecom_todo_request(
            "@wecom-todo 黄炜龙今天要读书",
            known_names=["黄炜龙", "张三"],
            skill_explicit=True,
        )
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.assignee_names, ["黄炜龙"])
        self.assertEqual(parsed.title, "今天要读书")
        self.assertFalse(parsed.use_self)

    def test_parse_name_dot_title(self):
        parsed = parse_wecom_todo_request(
            "创建企微待办：黄炜龙 · 今天要读书",
            known_names=["黄炜龙"],
        )
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.assignee_names, ["黄炜龙"])
        self.assertEqual(parsed.title, "今天要读书")

    def test_parse_name_colon_title(self):
        parsed = parse_wecom_todo_request(
            "黄炜龙：今天要读书",
            known_names=["黄炜龙"],
            skill_explicit=True,
        )
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.assignee_names, ["黄炜龙"])
        self.assertEqual(parsed.title, "今天要读书")

    def test_parse_retry_uses_history(self):
        parsed = parse_wecom_todo_request(
            "再试一次",
            known_names=["黄炜龙"],
            history=[
                {"role": "user", "content": "@wecom-todo 给黄炜龙创建待办：今天要读书"},
                {"role": "assistant", "content": "未能识别"},
            ],
            skill_explicit=True,
        )
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.assignee_names, ["黄炜龙"])
        self.assertEqual(parsed.title, "今天要读书")

    def test_llm_payload_to_parsed(self):
        from apps.wecom.skill_todo import parsed_from_llm_payload

        parsed = parsed_from_llm_payload({
            "ok": True,
            "assignee_names": ["黄炜龙"],
            "use_self": False,
            "title": "今天要读书",
            "description": "",
        })
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.assignee_names, ["黄炜龙"])
        self.assertEqual(parsed.title, "今天要读书")
        self.assertFalse(parsed.use_self)
