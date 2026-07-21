import io
import tempfile
import threading
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import IntegrityError, close_old_connections, connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab import views
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom, XiaoceRun
from apps.collab.xiaoce_progress import XiaoceProgressReporter, _publish_after_commit
from apps.collab.xiaoce_runs import (
    _adopt_staged_skill,
    cancel_xiaoce_run,
    complete_xiaoce_run,
    complete_xiaoce_run_with_skill,
    fail_xiaoce_run,
    is_xiaoce_run_cancelled,
)
from apps.core.conversation_skill import ConversationSkillError
from apps.core.conversation_skill import PreparedConversationSkill
from apps.skills.models import SkillAsset, UserSkill
from apps.skills.repository import save_skill_asset_from_bytes


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
    def test_progress_writer_acquires_room_before_run(self, _publish):
        with CaptureQueriesContext(connection) as captured:
            XiaoceProgressReporter(self.run.id).start("understanding")

        selects = [query["sql"].lower() for query in captured.captured_queries if "select" in query["sql"].lower()]
        room_index = next((
            index for index, sql in enumerate(selects) if "collab_collabroom" in sql
        ), -1)
        run_index = next((
            index for index, sql in reversed(list(enumerate(selects))) if "collab_xiaocerun" in sql
        ), -1)
        self.assertGreaterEqual(room_index, 0)
        self.assertGreaterEqual(run_index, 0)
        self.assertLess(room_index, run_index)

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

    @patch("apps.collab.xiaoce_runs.save_skill_asset_from_bytes")
    def test_deleted_run_does_not_start_skill_upload(self, save_asset):
        run_id = self.run.id
        prepared = prepared_skill(self.room)
        self.room.delete()

        message = complete_xiaoce_run_with_skill(run_id, prepared)

        self.assertIsNone(message)
        save_asset.assert_not_called()

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    @patch("apps.collab.xiaoce_progress.ws_push.publish_sync")
    def test_room_deleted_after_skill_staging_cleans_stage_and_preserves_existing_skill(
        self,
        _publish,
        _cos_enabled,
    ):
        prepared = prepared_skill(self.room)
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(SKILLS_WORKSPACE_ROOT=Path(tmp)):
                existing_asset, existing_personal = save_skill_asset_from_bytes(
                    self.user,
                    prepared.filename,
                    prepared.package_data,
                    adopt=True,
                    visibility=SkillAsset.Visibility.PRIVATE,
                    skill_id_override=prepared.skill_id,
                )
                existing_asset.name = "Existing skill"
                existing_asset.save(update_fields=["name"])
                existing_personal.name = "Existing personal skill"
                existing_personal.save(update_fields=["name"])

                real_save = save_skill_asset_from_bytes

                def delete_room_after_staging(*args, **kwargs):
                    staged = real_save(*args, **kwargs)
                    self.room.delete()
                    return staged

                with patch(
                    "apps.collab.xiaoce_runs.save_skill_asset_from_bytes",
                    side_effect=delete_room_after_staging,
                ):
                    message = complete_xiaoce_run_with_skill(self.run.id, prepared)

                self.assertIsNone(message)
                self.assertEqual(SkillAsset.objects.count(), 1)
                self.assertEqual(UserSkill.objects.count(), 1)
                existing_asset.refresh_from_db()
                existing_personal.refresh_from_db()
                self.assertEqual(existing_asset.skill_id, prepared.skill_id)
                self.assertEqual(existing_asset.name, "Existing skill")
                self.assertEqual(existing_personal.name, "Existing personal skill")
                self.assertEqual(
                    sorted(path.name for path in (Path(tmp) / str(self.user.id)).iterdir()),
                    [prepared.skill_id],
                )

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    def test_shared_stable_skill_with_foreign_adopter_is_never_replaced(self, _cos_enabled):
        prepared = prepared_skill(self.room)
        other = User.objects.create_user("shared-adopter", password="pw")
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(SKILLS_WORKSPACE_ROOT=Path(tmp)):
                stable_asset, stable_personal = save_skill_asset_from_bytes(
                    self.user,
                    prepared.filename,
                    prepared.package_data,
                    adopt=True,
                    visibility=SkillAsset.Visibility.SHARED,
                    skill_id_override=prepared.skill_id,
                )
                foreign = UserSkill.objects.create(
                    user=other,
                    skill_id=prepared.skill_id,
                    name="Foreign adoption",
                    source_asset=stable_asset,
                )
                stable_snapshot = {
                    "name": stable_asset.name,
                    "visibility": stable_asset.visibility,
                    "cos_bucket": stable_asset.cos_bucket,
                    "cos_key": stable_asset.cos_key,
                    "cos_url": stable_asset.cos_url,
                    "skill_md_key": stable_asset.skill_md_key,
                    "package_manifest": stable_asset.package_manifest,
                }

                with self.assertRaises(ConversationSkillError):
                    complete_xiaoce_run_with_skill(self.run.id, prepared)

                stable_asset.refresh_from_db()
                stable_personal.refresh_from_db()
                foreign.refresh_from_db()
                self.assertEqual(stable_asset.name, stable_snapshot["name"])
                self.assertEqual(stable_asset.visibility, SkillAsset.Visibility.SHARED)
                self.assertEqual(stable_asset.cos_bucket, stable_snapshot["cos_bucket"])
                self.assertEqual(stable_asset.cos_key, stable_snapshot["cos_key"])
                self.assertEqual(stable_asset.cos_url, stable_snapshot["cos_url"])
                self.assertEqual(stable_asset.skill_md_key, stable_snapshot["skill_md_key"])
                self.assertEqual(stable_asset.package_manifest, stable_snapshot["package_manifest"])
                self.assertEqual(foreign.source_asset_id, stable_asset.id)
                self.assertEqual(stable_personal.source_asset_id, stable_asset.id)
                self.assertEqual(SkillAsset.objects.count(), 1)
                self.assertEqual(UserSkill.objects.count(), 2)
                self.assertEqual(
                    sorted(path.name for path in (Path(tmp) / str(self.user.id)).iterdir()),
                    [prepared.skill_id],
                )

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    def test_adopt_rejects_private_stable_asset_with_foreign_adopter(self, _cos_enabled):
        prepared = prepared_skill(self.room)
        other = User.objects.create_user("private-adopter", password="pw")
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(SKILLS_WORKSPACE_ROOT=Path(tmp)):
                stable_asset, _ = save_skill_asset_from_bytes(
                    self.user,
                    prepared.filename,
                    prepared.package_data,
                    adopt=True,
                    visibility=SkillAsset.Visibility.PRIVATE,
                    skill_id_override=prepared.skill_id,
                )
                UserSkill.objects.create(
                    user=other,
                    skill_id=prepared.skill_id,
                    name="Foreign adoption",
                    source_asset=stable_asset,
                )
                staging_id = f"stage-{self.run.id.hex}"
                staged_asset, staged_personal = save_skill_asset_from_bytes(
                    self.user,
                    prepared.filename,
                    prepared.package_data,
                    adopt=True,
                    visibility=SkillAsset.Visibility.PRIVATE,
                    skill_id_override=staging_id,
                )

                with self.assertRaises(ConversationSkillError):
                    _adopt_staged_skill(
                        self.user,
                        staged_asset,
                        staged_personal,
                        prepared.skill_id,
                    )

                stable_asset.refresh_from_db()
                self.assertEqual(stable_asset.visibility, SkillAsset.Visibility.PRIVATE)
                self.assertEqual(stable_asset.adoptions.count(), 2)

    @patch("apps.collab.views.ws_push.publish_sync")
    def test_final_publish_is_a_noop_after_room_deletion(self, publish):
        message = complete_xiaoce_run(self.run.id, "finished")
        self.room.delete()

        views._publish_xiaoce_message(self.run, message)

        publish.assert_not_called()

    @patch("apps.collab.xiaoce_progress.ws_push.publish_sync")
    def test_committed_progress_publish_is_a_noop_after_room_deletion(self, publish):
        self.room.delete()

        with self.captureOnCommitCallbacks(execute=True):
            _publish_after_commit(self.run)

        publish.assert_not_called()

    def test_same_user_can_run_in_two_rooms_but_not_twice_in_one_room(self):
        room_b = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=room_b, user=self.user)
        CollabParticipant.objects.create(room=room_b, user=self.bot)
        trigger_b = CollabMessage.objects.create(
            room=room_b,
            sender=self.user,
            content="分析库存",
            msg_type="user",
        )

        second_room_run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=room_b,
            user=self.user,
            trigger_message=trigger_b,
        )
        self.assertEqual(second_room_run.status, XiaoceRun.Status.RUNNING)

        duplicate_trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="重复分析",
            msg_type="user",
        )
        with self.assertRaises(IntegrityError), transaction.atomic():
            XiaoceRun.objects.create(
                id=uuid.uuid4(),
                room=self.room,
                user=self.user,
                trigger_message=duplicate_trigger,
            )

    def test_deleted_run_is_cancelled_and_late_writes_are_noops(self):
        run_id = self.run.id
        self.room.delete()

        self.assertTrue(is_xiaoce_run_cancelled(run_id))
        self.assertIsNone(complete_xiaoce_run(run_id, "迟到回答"))
        self.assertIsNone(fail_xiaoce_run(run_id, RuntimeError("late")))
        self.assertFalse(CollabMessage.objects.filter(content="迟到回答").exists())


class XiaoceRunConcurrencyTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user("concurrent-owner", password="pw")
        bot = get_xiaoce_bot_user()
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=self.room, user=self.user)
        CollabParticipant.objects.create(room=self.room, user=bot)
        trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="package this room",
            msg_type="user",
        )
        self.run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=self.room,
            user=self.user,
            trigger_message=trigger,
        )

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    def test_delete_wins_while_worker_waits_after_staging(self, _cos_enabled):
        staged = threading.Event()
        allow_finalize = threading.Event()
        outcome: dict[str, object] = {}
        prepared = prepared_skill(self.room)
        real_save = save_skill_asset_from_bytes

        def stage_then_wait(*args, **kwargs):
            result = real_save(*args, **kwargs)
            staged.set()
            self.assertTrue(allow_finalize.wait(timeout=5))
            return result

        def worker():
            close_old_connections()
            try:
                with patch(
                    "apps.collab.xiaoce_runs.save_skill_asset_from_bytes",
                    side_effect=stage_then_wait,
                ):
                    outcome["message"] = complete_xiaoce_run_with_skill(
                        self.run.id,
                        prepared,
                    )
            except BaseException as exc:  # surfaced in the main test thread
                outcome["error"] = exc
            finally:
                close_old_connections()

        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(SKILLS_WORKSPACE_ROOT=Path(tmp)):
                thread = threading.Thread(target=worker)
                thread.start()
                try:
                    self.assertTrue(staged.wait(timeout=5))
                    client = APIClient()
                    client.force_authenticate(self.user)
                    response = client.delete(f"/api/collab/rooms/{self.room.id}/")
                    self.assertEqual(response.status_code, 200)
                finally:
                    allow_finalize.set()
                    thread.join(timeout=5)

                self.assertFalse(thread.is_alive())
                self.assertNotIn("error", outcome)
                self.assertIsNone(outcome.get("message"))
                self.assertFalse(SkillAsset.objects.exists())
                self.assertFalse(UserSkill.objects.exists())
                user_root = Path(tmp) / str(self.user.id)
                self.assertFalse(user_root.exists() and any(user_root.iterdir()))
