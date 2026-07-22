import uuid
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.collab import views
from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom, XiaoceRun
from apps.collab.xiaoce_runs import complete_xiaoce_run
from apps.collab.tests.test_xiaoce_runs import prepared_skill
from apps.skills.models import SkillAsset, UserSkill


class XiaoceApiTests(APITestCase):
    def setUp(self):
        realtime_patcher = patch("apps.collab.views.ws_push.publish_sync")
        realtime_patcher.start()
        self.addCleanup(realtime_patcher.stop)
        self.user = User.objects.create_user("api-owner", password="pw")
        self.other = User.objects.create_user("api-other", password="pw")
        self.colleague = User.objects.create_user("api-colleague", password="pw")
        self.staff = User.objects.create_user("api-staff", password="pw", is_staff=True)
        bot = get_xiaoce_bot_user()
        self.bot = bot
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=self.room, user=self.user)
        CollabParticipant.objects.create(room=self.room, user=bot)
        self.client.force_authenticate(self.user)

    def create_context_room(self, *, owner=None, title="旧任务：夏季上新"):
        owner = owner or self.user
        room = CollabRoom.objects.create(
            created_by=owner,
            room_kind="dm",
            title=title,
        )
        CollabParticipant.objects.create(room=room, user=owner)
        CollabParticipant.objects.create(room=room, user=self.bot)
        return room

    @property
    def messages_url(self):
        return f"/api/collab/rooms/{self.room.id}/messages/"

    @property
    def tasks_url(self):
        return "/api/collab/xiaoce-tasks/"

    def test_create_xiaoce_task_always_creates_an_independent_room(self):
        first = self.client.post(self.tasks_url, {}, format="json")
        second = self.client.post(self.tasks_url, {}, format="json")

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first.data["id"], second.data["id"])
        self.assertEqual(first.data["title"], "小策bot（新任务）")
        self.assertEqual(second.data["title"], "小策bot（新任务）")
        for payload in (first.data, second.data):
            self.assertEqual(payload["room_kind"], "dm")
            self.assertEqual(payload["display_title"], "小策bot（新任务）")
            self.assertEqual(len(payload["messages"]), 1)
            self.assertEqual(payload["messages"][0]["ai_kind"], "xiaoce")

    def test_create_xiaoce_task_trims_and_limits_custom_title(self):
        response = self.client.post(
            self.tasks_url,
            {"title": f"  {'GMV' * 60}  "},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(response.data["title"]), 120)
        self.assertTrue(response.data["title"].startswith("GMV"))

    def test_room_list_uses_task_title_only_for_xiaoce_direct_messages(self):
        task = self.client.post(
            self.tasks_url,
            {"title": "小策bot（GMV运算处理任务）"},
            format="json",
        ).data
        normal = self.client.post(
            "/api/collab/rooms/",
            {"peer_username": self.colleague.username, "room_kind": "dm", "title": "内部标题"},
            format="json",
        ).data

        listed = self.client.get("/api/collab/rooms/").data["results"]
        by_id = {row["id"]: row for row in listed}
        self.assertEqual(by_id[task["id"]]["display_title"], "小策bot（GMV运算处理任务）")
        self.assertEqual(by_id[normal["id"]]["display_title"], self.colleague.username)

    def test_staff_observer_sees_active_room_run_while_ordinary_outsider_is_isolated(self):
        trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="long running task",
            msg_type="user",
        )
        run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=self.room,
            user=self.user,
            trigger_message=trigger,
        )

        self.client.force_authenticate(self.staff)
        detail = self.client.get(f"/api/collab/rooms/{self.room.id}/")
        listed = self.client.get("/api/collab/rooms/")
        listed_room = next(row for row in listed.data["results"] if row["id"] == str(self.room.id))

        self.assertEqual(detail.status_code, 200)
        self.assertIsNotNone(detail.data["active_xiaoce_run"])
        self.assertEqual(detail.data["active_xiaoce_run"]["id"], str(run.id))
        self.assertEqual(detail.data["active_xiaoce_run"]["status"], "running")
        self.assertEqual(listed_room["active_xiaoce_run"]["id"], str(run.id))

        self.client.force_authenticate(self.other)
        self.assertEqual(
            self.client.get(f"/api/collab/rooms/{self.room.id}/").status_code,
            403,
        )
        ordinary_ids = {
            row["id"] for row in self.client.get("/api/collab/rooms/").data["results"]
        }
        self.assertNotIn(str(self.room.id), ordinary_ids)

    def test_existing_room_endpoint_reuses_the_latest_xiaoce_task(self):
        first = self.client.post(self.tasks_url, {"title": "任务一"}, format="json").data
        second = self.client.post(self.tasks_url, {"title": "任务二"}, format="json").data

        opened = self.client.post(
            "/api/collab/rooms/",
            {"peer_username": "小策bot", "room_kind": "dm"},
            format="json",
        )

        self.assertEqual(opened.status_code, 200)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(opened.data["id"], second["id"])

    @patch("apps.collab.views.threading.Thread")
    def test_send_returns_progress_run_and_room_detail_recovers_it(self, thread_cls):
        run_id = uuid.uuid4()

        response = self.client.post(
            self.messages_url,
            {"content": "分析", "run_id": str(run_id)},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["xiaoce_run"]["id"], str(run_id))
        self.assertEqual(
            response.data["xiaoce_run"]["progress_steps"][0]["code"],
            "understanding",
        )
        self.assertEqual(response.data["message"]["meta"]["run_id"], str(run_id))
        thread_cls.return_value.start.assert_called_once()
        thread_args = thread_cls.call_args.kwargs["args"]
        self.assertEqual(thread_args, (run_id,))

        detail = self.client.get(f"/api/collab/rooms/{self.room.id}/")
        self.assertEqual(detail.data["active_xiaoce_run"]["id"], str(run_id))

    @patch("apps.collab.views.threading.Thread")
    def test_second_send_is_rejected_without_creating_an_orphan_message(self, _thread_cls):
        self.client.post(
            self.messages_url,
            {"content": "第一次", "run_id": str(uuid.uuid4())},
        )
        before = CollabMessage.objects.count()

        response = self.client.post(
            self.messages_url,
            {"content": "第二次", "run_id": str(uuid.uuid4())},
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(CollabMessage.objects.count(), before)

    @patch("apps.collab.views.threading.Thread")
    def test_send_can_reference_one_owned_xiaoce_task(self, _thread_cls):
        context_room = self.create_context_room()
        CollabMessage.objects.create(
            room=context_room,
            sender=self.user,
            content="目标是八月上新 3 个 SKU",
            msg_type="user",
        )
        CollabMessage.objects.create(
            room=context_room,
            sender=self.bot,
            content="已确定先完成定价表",
            msg_type="ai",
            ai_kind="xiaoce",
        )

        response = self.client.post(
            self.messages_url,
            {
                "content": "@「旧任务：夏季上新」 继续排期",
                "run_id": str(uuid.uuid4()),
                "context_room_ids": [str(context_room.id)],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        refs = response.data["message"]["meta"]["context_rooms"]
        self.assertEqual(refs[0]["id"], str(context_room.id))
        self.assertEqual(refs[0]["title"], "旧任务：夏季上新")
        self.assertEqual(refs[0]["message_count"], 2)
        self.assertEqual(
            refs[0]["last_message_id"],
            context_room.messages.order_by("-id").values_list("id", flat=True).first(),
        )
        saved_message = CollabMessage.objects.get(id=response.data["message"]["id"])
        self.assertEqual(views._xiaoce_trigger_prompt(saved_message), "继续排期")

    @patch("apps.collab.views.threading.Thread")
    def test_formdata_reference_payload_is_supported_for_file_sends(self, _thread_cls):
        context_room = self.create_context_room()

        response = self.client.post(
            self.messages_url,
            {
                "content": "继续",
                "run_id": str(uuid.uuid4()),
                "context_room_ids": f'["{context_room.id}"]',
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.data["message"]["meta"]["context_rooms"][0]["id"],
            str(context_room.id),
        )

    @patch("apps.collab.views.threading.Thread")
    def test_reference_rejects_unowned_or_current_task(self, _thread_cls):
        foreign_room = self.create_context_room(owner=self.other, title="他人任务")

        foreign = self.client.post(
            self.messages_url,
            {
                "content": "继续",
                "run_id": str(uuid.uuid4()),
                "context_room_ids": [str(foreign_room.id)],
            },
            format="json",
        )
        current = self.client.post(
            self.messages_url,
            {
                "content": "继续",
                "run_id": str(uuid.uuid4()),
                "context_room_ids": [str(self.room.id)],
            },
            format="json",
        )

        self.assertEqual(foreign.status_code, 400)
        self.assertEqual(current.status_code, 400)
        self.assertEqual(self.room.messages.count(), 0)

    @patch("apps.collab.views.threading.Thread")
    def test_cancel_is_idempotent_and_returns_persisted_snapshot(self, _thread_cls):
        run_id = uuid.uuid4()
        self.client.post(
            self.messages_url,
            {"content": "分析", "run_id": str(run_id)},
        )
        url = f"/api/collab/rooms/{self.room.id}/xiaoce-runs/{run_id}/cancel/"

        first = self.client.post(url)
        second = self.client.post(url)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data["message"]["id"], first.data["message"]["id"])
        self.assertTrue(first.data["message"]["meta"]["cancelled"])
        self.assertEqual(first.data["xiaoce_run"]["status"], "cancelled")
        self.assertIsNone(first.data["active_xiaoce_run"])

    @patch("apps.collab.views.threading.Thread")
    def test_finished_or_unowned_run_cannot_be_cancelled(self, _thread_cls):
        run_id = uuid.uuid4()
        self.client.post(
            self.messages_url,
            {"content": "分析", "run_id": str(run_id)},
        )
        complete_xiaoce_run(run_id, "已完成")
        url = f"/api/collab/rooms/{self.room.id}/xiaoce-runs/{run_id}/cancel/"
        self.assertEqual(self.client.post(url).status_code, 409)

        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(url).status_code, 404)

    @patch("apps.collab.views.threading.Thread")
    @patch("apps.collab.views.ws_push.publish_sync")
    def test_delete_running_xiaoce_task_prevents_late_worker_output(
        self,
        publish,
        _thread_cls,
    ):
        run_id = uuid.uuid4()
        self.client.post(
            self.messages_url,
            {"content": "长任务", "run_id": str(run_id)},
            format="json",
        )
        publish.reset_mock()

        response = self.client.delete(f"/api/collab/rooms/{self.room.id}/")
        views._run_xiaoce_reply_async(run_id)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(CollabRoom.objects.filter(id=self.room.id).exists())
        self.assertFalse(XiaoceRun.objects.filter(id=run_id).exists())
        publish.assert_not_called()

    def test_xiaoce_task_rename_rejects_blank_and_has_no_group_announcement(self):
        before = CollabMessage.objects.filter(room=self.room, msg_type="system").count()

        renamed = self.client.patch(
            f"/api/collab/rooms/{self.room.id}/",
            {"title": "  小策bot（GMV运算处理任务）  "},
            format="json",
        )
        blank = self.client.patch(
            f"/api/collab/rooms/{self.room.id}/",
            {"title": "   "},
            format="json",
        )

        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.data["title"], "小策bot（GMV运算处理任务）")
        self.assertEqual(blank.status_code, 400)
        self.assertEqual(blank.data["error"], "会话名称不能为空")
        self.assertEqual(
            CollabMessage.objects.filter(room=self.room, msg_type="system").count(),
            before,
        )

    @patch("apps.core.agent_chat.run_chat")
    def test_worker_persists_final_process_snapshot(self, run_chat):
        trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="分析",
            msg_type="user",
            meta={},
        )
        run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=self.room,
            user=self.user,
            trigger_message=trigger,
        )

        def answer(**kwargs):
            callback = kwargs["progress_callback"]
            callback("understanding", "running", {})
            callback("understanding", "completed", {})
            callback("composing", "running", {})
            callback("composing", "completed", {})
            return {"ok": True, "reply": "最终答案"}

        run_chat.side_effect = answer

        views._run_xiaoce_reply_async(run.id)

        run.refresh_from_db()
        self.assertEqual(run.status, XiaoceRun.Status.COMPLETED)
        self.assertEqual(run.result_message.content, "最终答案")
        self.assertEqual(run.result_message.meta["process_steps"], run.progress_steps)

    @patch("apps.core.agent_chat.run_chat")
    def test_worker_injects_referenced_task_transcript(self, run_chat):
        context_room = self.create_context_room()
        CollabMessage.objects.create(
            room=context_room,
            sender=self.user,
            content="方案代号是 Aurora，预算 20 万",
            msg_type="user",
        )
        snapshot_tail = CollabMessage.objects.create(
            room=context_room,
            sender=self.bot,
            content="下一步是确认供应商档期",
            msg_type="ai",
            ai_kind="xiaoce",
        )
        trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="继续这个任务",
            msg_type="user",
            meta={
                "context_rooms": [{
                    "id": str(context_room.id),
                    "title": context_room.title,
                    "message_count": 2,
                    "last_message_id": snapshot_tail.id,
                }],
            },
        )
        CollabMessage.objects.create(
            room=context_room,
            sender=self.user,
            content="引用后新增的内容不应读取",
            msg_type="user",
        )
        run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=self.room,
            user=self.user,
            trigger_message=trigger,
        )
        run_chat.return_value = {"ok": True, "reply": "已承接"}

        views._run_xiaoce_reply_async(run.id)

        self.assertEqual(run_chat.call_args.kwargs["usage_source"], "agent")
        block = run_chat.call_args.kwargs["extra_reference_blocks"][0]
        self.assertIn("方案代号是 Aurora", block)
        self.assertIn("下一步是确认供应商档期", block)
        self.assertIn(context_room.title, block)
        self.assertNotIn("引用后新增的内容不应读取", block)

        run_chat.reset_mock()
        followup = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="那么现在先做什么？",
            msg_type="user",
            meta={},
        )
        followup_run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=self.room,
            user=self.user,
            trigger_message=followup,
        )

        views._run_xiaoce_reply_async(followup_run.id)

        inherited_block = run_chat.call_args.kwargs["extra_reference_blocks"][0]
        self.assertIn("方案代号是 Aurora", inherited_block)

    @patch("apps.core.agent_chat.run_chat")
    def test_worker_maps_internal_failure_to_safe_message(self, run_chat):
        trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="分析",
            msg_type="user",
        )
        run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=self.room,
            user=self.user,
            trigger_message=trigger,
        )
        run_chat.side_effect = RuntimeError("Traceback /srv/app.py sk-secret-value")

        views._run_xiaoce_reply_async(run.id)

        run.refresh_from_db()
        self.assertEqual(run.status, XiaoceRun.Status.FAILED)
        self.assertNotIn("Traceback", run.result_message.content)
        self.assertNotIn("sk-secret-value", run.result_message.content)

    @patch("apps.skills.repository.cos_enabled", return_value=False)
    @patch("apps.core.conversation_skill.prepare_conversation_skill")
    def test_worker_packages_explicit_request_and_enables_private_skill(
        self,
        prepare,
        _cos_enabled,
    ):
        trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="把当前聊天记录打包成 Skill 并自动上传平台",
            msg_type="user",
        )
        run = XiaoceRun.objects.create(
            id=uuid.uuid4(),
            room=self.room,
            user=self.user,
            trigger_message=trigger,
        )
        prepare.return_value = prepared_skill(self.room)

        with tempfile.TemporaryDirectory() as tmp:
            with override_settings(SKILLS_WORKSPACE_ROOT=Path(tmp)):
                views._run_xiaoce_reply_async(run.id)

        run.refresh_from_db()
        asset = SkillAsset.objects.get()
        personal = UserSkill.objects.get()
        self.assertEqual(run.status, XiaoceRun.Status.COMPLETED)
        self.assertEqual(asset.visibility, SkillAsset.Visibility.PRIVATE)
        self.assertTrue(personal.enabled)
        self.assertEqual(run.result_message.meta["created_skill"]["skill_id"], asset.skill_id)
