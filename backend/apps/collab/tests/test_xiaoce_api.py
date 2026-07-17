import io
import tempfile
import uuid
import zipfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import (
    CollabMessage,
    CollabParticipant,
    CollabRoom,
    XiaoceRun,
)
from apps.collab.xiaoce_runs import (
    complete_xiaoce_run,
    complete_xiaoce_run_with_skill,
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


class XiaoceApiTests(APITestCase):
    def setUp(self):
        realtime_patcher = patch("apps.collab.views.ws_push.publish_sync")
        realtime_patcher.start()
        self.addCleanup(realtime_patcher.stop)
        self.user = User.objects.create_user("api-owner", password="pw")
        self.other = User.objects.create_user("api-other", password="pw")
        bot = get_xiaoce_bot_user()
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=self.room, user=self.user)
        CollabParticipant.objects.create(room=self.room, user=bot)
        self.client.force_authenticate(self.user)

    @patch("apps.collab.views.threading.Thread")
    def test_send_returns_run_and_room_detail_recovers_it(self, thread_cls):
        run_id = uuid.uuid4()
        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/",
            {"content": "分析", "run_id": str(run_id)},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["xiaoce_run"]["id"], str(run_id))
        self.assertEqual(response.data["message"]["meta"]["run_id"], str(run_id))
        thread_cls.return_value.start.assert_called_once()
        thread_args = thread_cls.call_args.kwargs["args"]
        self.assertEqual(thread_args, (run_id,))

        detail = self.client.get(f"/api/collab/rooms/{self.room.id}/")
        self.assertEqual(detail.data["active_xiaoce_run"]["id"], str(run_id))

    @patch("apps.collab.views.threading.Thread")
    def test_second_send_is_rejected_without_creating_an_orphan_message(self, _thread_cls):
        first_id = uuid.uuid4()
        self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/",
            {"content": "第一次", "run_id": str(first_id)},
        )
        before = CollabMessage.objects.count()

        response = self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/",
            {"content": "第二次", "run_id": str(uuid.uuid4())},
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(CollabMessage.objects.count(), before)

    @patch("apps.collab.views.threading.Thread")
    def test_cancel_is_idempotent_and_returns_the_persisted_message(self, _thread_cls):
        run_id = uuid.uuid4()
        self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/",
            {"content": "分析", "run_id": str(run_id)},
        )
        url = f"/api/collab/rooms/{self.room.id}/xiaoce-runs/{run_id}/cancel/"

        first = self.client.post(url)
        second = self.client.post(url)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data["message"]["id"], first.data["message"]["id"])
        self.assertTrue(first.data["message"]["meta"]["cancelled"])
        self.assertIsNone(first.data["active_xiaoce_run"])

    @patch("apps.collab.views.threading.Thread")
    def test_finished_or_unowned_run_cannot_be_cancelled(self, _thread_cls):
        run_id = uuid.uuid4()
        self.client.post(
            f"/api/collab/rooms/{self.room.id}/messages/",
            {"content": "分析", "run_id": str(run_id)},
        )
        complete_xiaoce_run(run_id, "已完成")
        url = f"/api/collab/rooms/{self.room.id}/xiaoce-runs/{run_id}/cancel/"
        self.assertEqual(self.client.post(url).status_code, 409)

        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(url).status_code, 404)

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    def test_skill_completion_is_private_enabled_and_atomic(self, _cos_enabled):
        trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="打包当前对话为 Skill",
        )
        run_id = uuid.uuid4()
        run = XiaoceRun.objects.create(
            id=run_id,
            room=self.room,
            user=self.user,
            trigger_message=trigger,
        )
        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(SKILLS_WORKSPACE_ROOT=Path(tmp)):
                message = complete_xiaoce_run_with_skill(run.id, prepared_skill(self.room))
                second_trigger = CollabMessage.objects.create(
                    room=self.room,
                    sender=self.user,
                    content="再次打包当前对话为 Skill",
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
        self.assertEqual(message.meta["created_skill"]["skill_id"], asset.skill_id)
        self.assertEqual(second_message.meta["created_skill"]["skill_id"], asset.skill_id)
        self.assertEqual(SkillAsset.objects.count(), 1)
        self.assertEqual(UserSkill.objects.count(), 1)

    @patch("apps.collab.xiaoce_runs.save_skill_asset_from_bytes")
    def test_cancelled_run_does_not_start_skill_upload(self, save_asset):
        trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="打包当前对话为 Skill",
        )
        run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=self.room,
            user=self.user,
            trigger_message=trigger,
            status=XiaoceRun.Status.CANCELLED,
        )

        message = complete_xiaoce_run_with_skill(run.id, prepared_skill(self.room))

        self.assertIsNone(message)
        save_asset.assert_not_called()
