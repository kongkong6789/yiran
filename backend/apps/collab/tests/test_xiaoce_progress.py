import uuid
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase

from apps.collab.models import CollabMessage, CollabRoom, XiaoceRun
from apps.collab.xiaoce_progress import (
    XiaoceProgressReporter,
    xiaoce_run_payload,
)


class XiaoceProgressTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("progress-owner", password="pw")
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
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
    def test_progress_updates_one_allowlisted_step_and_publishes_snapshot(self, publish):
        reporter = XiaoceProgressReporter(self.run.id)
        with self.captureOnCommitCallbacks(execute=True):
            reporter.start("understanding")
            reporter.complete("understanding")
            reporter.complete("tools", tool_count=2)

        self.run.refresh_from_db()
        self.assertEqual(
            [step["code"] for step in self.run.progress_steps],
            ["understanding", "tools"],
        )
        self.assertEqual(self.run.progress_steps[0]["status"], "completed")
        self.assertEqual(self.run.progress_steps[1]["label"], "已运行 2 个工具")
        self.assertEqual(self.run.current_stage, "tools")
        self.assertGreaterEqual(publish.call_count, 3)

    def test_progress_rejects_unknown_stage_without_persisting_raw_detail(self):
        reporter = XiaoceProgressReporter(self.run.id)

        with self.assertRaises(ValueError):
            reporter.start("print-secret", detail="sk-secret-value")

        self.run.refresh_from_db()
        self.assertEqual(self.run.progress_steps, [])
        self.assertNotIn("sk-secret-value", str(xiaoce_run_payload(self.run)))

    def test_payload_exposes_only_public_progress_fields(self):
        reporter = XiaoceProgressReporter(self.run.id)
        reporter.fail("knowledge_search", error_code="knowledge_unavailable")
        self.run.refresh_from_db()

        payload = xiaoce_run_payload(self.run)

        self.assertEqual(payload["id"], str(self.run.id))
        self.assertEqual(payload["status"], XiaoceRun.Status.FAILED)
        self.assertEqual(payload["error_code"], "knowledge_unavailable")
        self.assertEqual(payload["progress_steps"][0]["status"], "failed")
        self.assertNotIn("error", payload)
