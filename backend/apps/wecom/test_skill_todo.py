from django.test import SimpleTestCase, TestCase
from unittest.mock import patch
import uuid

from apps.core.models import Organization, OrganizationMembership, WorkTodo
from django.contrib.auth import get_user_model

from apps.wecom.skill_todo import (
    _looks_like_delete_intent,
    delete_wecom_todos_for_skill,
    is_wecom_todo_skill,
    parse_wecom_todo_delete_request,
    parse_wecom_todo_request,
)

User = get_user_model()


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


class WeComTodoSkillDeleteParseTests(SimpleTestCase):
    def test_detect_delete_intent(self):
        self.assertTrue(_looks_like_delete_intent("帮我把企业微信的也删除"))
        self.assertTrue(_looks_like_delete_intent("删除待办：今天要读书"))
        self.assertFalse(_looks_like_delete_intent("给张三创建待办：今天要读书"))

    def test_parse_delete_with_title(self):
        parsed = parse_wecom_todo_delete_request("删除企微待办：今天要读书", skill_explicit=True)
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.title_query, "今天要读书")

    def test_parse_delete_from_history(self):
        parsed = parse_wecom_todo_delete_request(
            "你帮我把企业微信的也删除",
            history=[
                {"role": "assistant", "content": "【企微待办技能执行结果】\n- 标题：蔡徐坤 代办告诉他今天要读书"},
            ],
            skill_explicit=True,
        )
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertIn("今天要读书", parsed.title_query)

    def test_parse_delete_name_title(self):
        parsed = parse_wecom_todo_delete_request(
            "删除蔡徐坤 代办告诉他今天要读书",
            known_names=["蔡徐坤"],
            skill_explicit=True,
        )
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertIn("读书", parsed.title_query)


class WeComTodoSkillDeleteExecutionTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="todo-skill-owner", password="pass")
        self.organization = Organization.objects.create(name="测试企业", created_by=self.owner)
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.owner,
            role=OrganizationMembership.Role.OWNER,
            is_primary=True,
        )

    @patch("apps.wecom.todo_sync_service.delete_work_todo_group")
    def test_delete_matching_todo_group(self, delete_group):
        group_id = uuid.uuid4()
        row = WorkTodo.objects.create(
            organization=self.organization,
            creator=self.owner,
            title="蔡徐坤 代办告诉他今天要读书",
            recipient_name="杨晓东",
            sync_group_id=group_id,
        )
        delete_group.return_value = {
            "ok": True,
            "detail": "待办已从平台和企业微信删除。",
            "deletedCount": 1,
            "weComDeleted": True,
        }

        result = delete_wecom_todos_for_skill(
            user=self.owner,
            title_query="今天要读书",
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "delete")
        delete_group.assert_called_once_with(group_id)
        self.assertEqual(result["title"], row.title)

    def test_delete_requires_creator_match(self):
        other = User.objects.create_user(username="todo-skill-other", password="pass")
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=other,
            role=OrganizationMembership.Role.MEMBER,
            is_primary=True,
        )
        WorkTodo.objects.create(
            organization=self.organization,
            creator=self.owner,
            title="只属于创建人的待办",
        )

        result = delete_wecom_todos_for_skill(
            user=other,
            title_query="只属于创建人的待办",
        )

        self.assertFalse(result["ok"])
        self.assertIn("没有找到", result["error"])
