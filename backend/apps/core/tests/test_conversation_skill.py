import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings

from apps.core.chat_runs import ChatRunCancelled
from apps.core.conversation_skill import (
    ConversationSkillError,
    build_conversation_skill,
    is_conversation_skill_request,
)
from apps.core.models import ChatMessage, ChatSession
from apps.skills.models import SkillAsset, UserSkill


VALID_LLM_PAYLOAD = {
    "name": "GMV 退款率复盘流程",
    "description": "复用经营对话中的 GMV 与退款率复盘方法。",
    "instructions": """## 目标
复盘指定日期的 GMV 与退款率并给出可执行结论。

## 输入
- 日期或时间范围
- 渠道范围
- GMV 与退款明细

## 步骤
1. 确认日期、渠道和指标口径。
2. 查询 GMV 与退款率并计算环比。
3. 识别冲突口径并标注风险。
4. 输出结论和后续动作。

## 输出
输出指标表、口径说明、风险与建议动作。

## 验证
- 核对渠道合计与全站值。
- 核对时间窗口和数据刷新批次。

## 失败处理
- 数据缺失时列出缺失字段并停止下结论。
- 指标冲突时同时展示各口径并请求确认。""",
    "workflow_summary": "先锁定时间与渠道口径，再查询指标、核对冲突并形成行动建议。",
}


class ConversationSkillBuilderTests(TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(
            SKILLS_WORKSPACE_ROOT=Path(self.tempdir.name),
        )
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.tempdir.cleanup)
        self.user = User.objects.create_user("conversation-owner", password="pw")
        self.session = ChatSession.objects.create(user=self.user, title="经营复盘")

    def add_message(self, role: str, content: str, **meta) -> ChatMessage:
        return ChatMessage.objects.create(
            session=self.session,
            role=role,
            content=content,
            meta=meta,
        )

    def test_recognizes_explicit_conversation_packaging_intent(self):
        self.assertTrue(is_conversation_skill_request("把这次对话打包成一个 skill 并自动上传平台"))
        self.assertTrue(is_conversation_skill_request("帮我打包成一个 skill 并自动上传平台"))
        self.assertTrue(is_conversation_skill_request("总结当前聊天记录，生成技能"))
        self.assertFalse(is_conversation_skill_request("帮我写一个查询 GMV 的 SQL"))
        self.assertFalse(is_conversation_skill_request("平台现在有哪些 skill？"))

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    @patch("apps.core.conversation_skill.llm.chat_messages_result")
    def test_builds_a_private_enabled_package_from_the_full_sanitized_conversation(
        self,
        mocked_llm,
        _mocked_cos,
    ):
        first = self.add_message(
            "user",
            "最初的 GMV 复盘任务，api_key=sk-THISSECRET123456789",
        )
        self.add_message("assistant", "先确认日期与渠道口径。")
        for index in range(31):
            self.add_message("user", f"第 {index} 轮补充")
            self.add_message("assistant", f"第 {index} 轮处理结果")
        self.add_message("assistant", "已暂停本次生成。", cancelled=True)
        command = self.add_message("user", "把这次对话打包成一个 skill 并自动上传平台")
        mocked_llm.return_value = {
            "content": json.dumps(VALID_LLM_PAYLOAD, ensure_ascii=False),
            "error": "",
            "configured": True,
            "model": "test-model",
        }

        created = build_conversation_skill(
            self.user,
            self.session,
            exclude_message_id=command.id,
        )

        prompt_messages = mocked_llm.call_args.args[1]
        transcript = prompt_messages[0]["content"]
        self.assertIn(first.content.split("，")[0], transcript)
        self.assertIn("第 30 轮处理结果", transcript)
        self.assertNotIn("THISSECRET", transcript)
        self.assertNotIn("已暂停本次生成", transcript)
        self.assertNotIn(command.content, transcript)

        asset = SkillAsset.objects.get(id=created["asset_id"])
        personal = UserSkill.objects.get(user=self.user, skill_id=created["skill_id"])
        self.assertEqual(asset.visibility, SkillAsset.Visibility.PRIVATE)
        self.assertTrue(personal.enabled)
        self.assertEqual(personal.source_asset, asset)
        self.assertTrue(created["skill_id"].startswith("gmv-"))
        self.assertTrue(created["skill_id"].endswith(self.session.id.hex[:8]))
        self.assertEqual(
            sorted(item["path"] for item in asset.package_manifest),
            ["SKILL.md", "references/workflow-summary.md"],
        )
        self.assertEqual(created["visibility"], "private")
        self.assertTrue(created["enabled"])

        stored_text = "\n".join(
            Path(item["local_path"]).read_text(encoding="utf-8")
            for item in asset.package_manifest
        )
        self.assertNotIn("THISSECRET", stored_text)
        self.assertIn("## 失败处理", personal.raw_content)
        self.assertIn("workflow-summary.md", stored_text)

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    @patch("apps.core.conversation_skill.llm.chat_messages_result")
    def test_reuses_a_stable_skill_id_for_the_same_conversation(self, mocked_llm, _mocked_cos):
        self.add_message("user", "GMV daily review")
        self.add_message("assistant", "Review complete")
        mocked_llm.return_value = {
            "content": json.dumps(VALID_LLM_PAYLOAD, ensure_ascii=False),
            "error": "",
            "configured": True,
            "model": "test-model",
        }

        first = build_conversation_skill(self.user, self.session)
        second = build_conversation_skill(self.user, self.session)

        self.assertEqual(first["skill_id"], second["skill_id"])
        self.assertEqual(SkillAsset.objects.count(), 1)
        self.assertEqual(UserSkill.objects.count(), 1)

    @patch("apps.core.conversation_skill.llm.chat_messages_result")
    def test_malformed_generation_leaves_no_skill_asset(self, mocked_llm):
        self.add_message("user", "复盘 GMV")
        self.add_message("assistant", "已完成复盘")
        mocked_llm.return_value = {
            "content": "not-json",
            "error": "",
            "configured": True,
            "model": "test-model",
        }

        with self.assertRaises(ConversationSkillError):
            build_conversation_skill(self.user, self.session)

        self.assertFalse(SkillAsset.objects.exists())
        self.assertFalse(UserSkill.objects.exists())

    def test_requires_a_completed_user_assistant_exchange(self):
        self.add_message("user", "只有一个需求")

        with self.assertRaisesMessage(ConversationSkillError, "至少完成一轮"):
            build_conversation_skill(self.user, self.session)

    @patch("apps.core.conversation_skill.save_skill_asset_from_bytes")
    @patch("apps.core.conversation_skill.extract_skill_from_upload")
    @patch("apps.core.conversation_skill.llm.chat_messages_result")
    def test_cancelled_after_validation_does_not_start_upload(
        self,
        mocked_llm,
        mocked_extract,
        mocked_save,
    ):
        self.add_message("user", "复盘 GMV")
        self.add_message("assistant", "已完成复盘")
        mocked_llm.return_value = {
            "content": json.dumps(VALID_LLM_PAYLOAD, ensure_ascii=False),
            "error": "",
            "configured": True,
            "model": "test-model",
        }
        cancelled = False

        def validate_then_cancel(*_args, **_kwargs):
            nonlocal cancelled
            cancelled = True
            return {
                "package_files": [
                    ("SKILL.md", b"skill"),
                    ("references/workflow-summary.md", b"summary"),
                ],
            }

        mocked_extract.side_effect = validate_then_cancel

        with self.assertRaises(ChatRunCancelled):
            build_conversation_skill(
                self.user,
                self.session,
                cancel_check=lambda: cancelled,
            )

        mocked_save.assert_not_called()
