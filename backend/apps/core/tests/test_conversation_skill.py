import io
import json
import zipfile
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase

from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom
from apps.core.cancellation import AgentRunCancelled
from apps.core.conversation_skill import (
    ConversationSkillError,
    _conversation_rows,
    _sanitize,
    is_conversation_skill_request,
    prepare_conversation_skill,
)
from apps.skills.models import SkillAsset, UserSkill


VALID_GENERATION = {
    "name": "GMV 复盘流程",
    "description": "复用对话中的 GMV 与退款率复盘方法。",
    "instructions": """## 目标
复盘指定日期的 GMV 与退款率。

## 输入
- 日期和渠道范围

## 步骤
1. 确认口径。
2. 计算指标。

## 输出
输出指标与建议。

## 验证
核对汇总值。

## 失败处理
数据缺失时列出缺失项。""",
    "workflow_summary": "先锁定口径，再计算、核对并形成建议。",
}


class ConversationSkillTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner")
        self.bot = get_xiaoce_bot_user()
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=self.room, user=self.user)
        CollabParticipant.objects.create(room=self.room, user=self.bot)

    def add_message(self, sender, content: str, **fields) -> CollabMessage:
        return CollabMessage.objects.create(
            room=self.room,
            sender=sender,
            content=content,
            **fields,
        )

    def test_intent_requires_conversation_skill_and_action(self):
        self.assertTrue(is_conversation_skill_request("把这次对话打包成 Skill 并上传"))
        self.assertTrue(is_conversation_skill_request("帮我打包成一个 skill 并自动上传平台"))
        self.assertFalse(is_conversation_skill_request("Skill 是什么"))
        self.assertFalse(is_conversation_skill_request("总结这次对话"))

    def test_sanitize_removes_credentials(self):
        text = _sanitize("api_key=sk-1234567890abcdef password:secret Bearer abc.def")
        self.assertNotIn("secret", text)
        self.assertNotIn("sk-1234567890abcdef", text)
        self.assertNotIn("abc.def", text)

    def test_rows_exclude_command_paused_system_and_removed_messages(self):
        self.add_message(self.user, "分析销售")
        self.add_message(self.bot, "结论", msg_type="ai", ai_kind="xiaoce")
        self.add_message(
            self.bot,
            "已暂停本次生成。",
            msg_type="ai",
            ai_kind="xiaoce",
            meta={"cancelled": True},
        )
        self.add_message(self.bot, "系统通知", msg_type="system")
        self.add_message(self.user, "已撤回", status="recalled")
        command = self.add_message(self.user, "打包成 Skill")

        rows = _conversation_rows(self.room, exclude_message_id=command.id)

        self.assertEqual([row["content"] for row in rows], ["分析销售", "结论"])

    @patch("apps.core.conversation_skill.llm.chat_messages_result")
    def test_prepares_a_validated_two_file_package_without_writing_assets(self, mocked_llm):
        first = self.add_message(self.user, "GMV 复盘 api_key=sk-THISSECRET123456789")
        self.add_message(self.bot, "复盘完成", msg_type="ai", ai_kind="xiaoce")
        command = self.add_message(self.user, "把这次对话打包成 Skill 并上传")
        mocked_llm.return_value = {
            "content": json.dumps(VALID_GENERATION, ensure_ascii=False),
            "error": "",
        }

        prepared = prepare_conversation_skill(
            self.user,
            self.room,
            exclude_message_id=command.id,
        )

        transcript = mocked_llm.call_args.args[1][0]["content"]
        self.assertIn(first.content.split(" api_key")[0], transcript)
        self.assertNotIn("THISSECRET", transcript)
        self.assertNotIn(command.content, transcript)
        self.assertTrue(prepared.skill_id.endswith(self.room.id.hex[:8]))
        with zipfile.ZipFile(io.BytesIO(prepared.package_data)) as package:
            self.assertEqual(
                sorted(package.namelist()),
                ["SKILL.md", "references/workflow-summary.md"],
            )
            stored = "\n".join(
                package.read(name).decode("utf-8") for name in package.namelist()
            )
        self.assertNotIn("THISSECRET", stored)
        self.assertNotIn("把这次对话", stored)
        self.assertFalse(SkillAsset.objects.exists())
        self.assertFalse(UserSkill.objects.exists())

    @patch("apps.core.conversation_skill.llm.chat_messages_result")
    def test_rejects_non_strict_generation_and_honors_cancellation(self, mocked_llm):
        self.add_message(self.user, "复盘 GMV")
        self.add_message(self.bot, "完成", msg_type="ai", ai_kind="xiaoce")
        mocked_llm.return_value = {
            "content": json.dumps({**VALID_GENERATION, "unexpected": True}, ensure_ascii=False),
            "error": "",
        }
        with self.assertRaises(ConversationSkillError):
            prepare_conversation_skill(self.user, self.room)

        with self.assertRaises(AgentRunCancelled):
            prepare_conversation_skill(
                self.user,
                self.room,
                cancel_check=lambda: True,
            )
