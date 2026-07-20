import io
import tempfile
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase, override_settings

from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom, XiaoceRun
from apps.collab.xiaoce_progress import XiaoceProgressReporter
from apps.collab.xiaoce_runs import (
    cancel_xiaoce_run,
    complete_xiaoce_run,
    complete_xiaoce_run_with_skill,
    fail_xiaoce_run,
)
from apps.core.conversation_skill import PreparedConversationSkill
from apps.skills.models import SkillAsset, UserSkill


def prepared_skill(room) -> PreparedConversationSkill:
    skill_id = f"conversation-workflow-{room.id.hex[:8]}"
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as package:
        package.writestr(
            "SKILL.md",
            "---\nname: Room workflow\ndescription: A reusable room workflow\n---\n\n"
            "## 目标\n复用流程\n## 输入\n任务\n## 步骤\n1. 执行\n"
            "## 输出\n结果\n## 验证\n核对\n## 失败处理\n停止并说明",
        )
        package.writestr("references/workflow-summary.md", "# Summary\n\nPrepared safely.")
    return PreparedConversationSkill(
        skill_id=skill_id,
        filename=f"{skill_id}.zip",
        package_data=archive.getvalue(),
        name="Room workflow",
        description="A reusable room workflow",
    )


class XiaoceRunLifecycleTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("run-owner", password="pw")
        self.bot = get_xiaoce_bot_user()
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=self.room, user=self.user)
        CollabParticipant.objects.create(room=self.room, user=self.bot)
        self.trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="分析经营数据",
            msg_type="user",
        )
        self.run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=self.room,
            user=self.user,
            trigger_message=self.trigger,
        )

    @patch("apps.collab.xiaoce_progress.ws_push.publish_sync")
    def test_cancel_keeps_progress_is_idempotent_and_complete_cannot_overwrite(self, _publish):
        XiaoceProgressReporter(self.run.id).start("knowledge_search")

        cancelled = cancel_xiaoce_run(self.run)
        repeated = cancel_xiaoce_run(cancelled)

        self.assertEqual(cancelled.progress_steps[-1]["status"], "cancelled")
        self.assertEqual(repeated.cancel_message_id, cancelled.cancel_message_id)
        self.assertEqual(CollabMessage.objects.filter(meta__cancelled=True).count(), 1)
        self.assertIsNone(complete_xiaoce_run(self.run.id, "late answer"))
        self.assertFalse(CollabMessage.objects.filter(content="late answer").exists())

    @patch("apps.collab.xiaoce_progress.ws_push.publish_sync")
    def test_complete_persists_process_snapshot_on_the_answer(self, _publish):
        reporter = XiaoceProgressReporter(self.run.id)
        reporter.start("composing")
        reporter.complete("composing")

        message = complete_xiaoce_run(self.run.id, "最终回答")

        self.run.refresh_from_db()
        self.assertEqual(self.run.status, XiaoceRun.Status.COMPLETED)
        self.assertEqual(self.run.result_message, message)
        self.assertEqual(message.meta["process_status"], "completed")
        self.assertEqual(message.meta["process_steps"], self.run.progress_steps)

    @patch("apps.collab.xiaoce_progress.ws_push.publish_sync")
    def test_failure_persists_safe_message_and_failed_snapshot(self, _publish):
        XiaoceProgressReporter(self.run.id).start("skill_summary")

        message = fail_xiaoce_run(
            self.run.id,
            RuntimeError("Traceback /srv/app.py sk-secret-value"),
            error_code="skill_generation_failed",
        )

        self.run.refresh_from_db()
        self.assertEqual(self.run.status, XiaoceRun.Status.FAILED)
        self.assertEqual(message.meta["process_status"], "failed")
        self.assertEqual(message.meta["process_steps"][-1]["status"], "failed")
        self.assertNotIn("Traceback", message.content)
        self.assertNotIn("sk-secret-value", message.content)

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    @patch("apps.collab.xiaoce_progress.ws_push.publish_sync")
    def test_skill_completion_is_private_enabled_and_stable(self, _publish, _cos_enabled):
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(SKILLS_WORKSPACE_ROOT=Path(tmp)):
                first_message = complete_xiaoce_run_with_skill(
                    self.run.id,
                    prepared_skill(self.room),
                )
                second_trigger = CollabMessage.objects.create(
                    room=self.room,
                    sender=self.user,
                    content="再次打包当前对话为 Skill",
                    msg_type="user",
                )
                second_run = XiaoceRun.objects.create(
                    id=uuid.uuid4(),
                    room=self.room,
                    user=self.user,
                    trigger_message=second_trigger,
                )
                second_message = complete_xiaoce_run_with_skill(
                    second_run.id,
                    prepared_skill(self.room),
                )

        asset = SkillAsset.objects.get()
        personal = UserSkill.objects.get()
        self.assertEqual(asset.visibility, SkillAsset.Visibility.PRIVATE)
        self.assertTrue(personal.enabled)
        self.assertEqual(first_message.meta["created_skill"]["skill_id"], asset.skill_id)
        self.assertEqual(second_message.meta["created_skill"]["skill_id"], asset.skill_id)
        self.assertEqual(SkillAsset.objects.count(), 1)
        self.assertEqual(UserSkill.objects.count(), 1)

    @patch("apps.collab.xiaoce_runs.save_skill_asset_from_bytes")
    def test_cancelled_run_does_not_start_skill_upload(self, save_asset):
        self.run.status = XiaoceRun.Status.CANCELLED
        self.run.save(update_fields=["status"])

        message = complete_xiaoce_run_with_skill(self.run.id, prepared_skill(self.room))

        self.assertIsNone(message)
        save_asset.assert_not_called()
