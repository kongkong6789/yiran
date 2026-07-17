import uuid

from django.contrib.auth.models import User
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from apps.collab.mentions import get_xiaoce_bot_user
from apps.collab.models import CollabMessage, CollabParticipant, CollabRoom, XiaoceRun
from apps.collab.xiaoce_runs import (
    cancel_xiaoce_run,
    complete_xiaoce_run,
    create_xiaoce_run,
)


class XiaoceRunTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("owner", password="pw")
        bot = get_xiaoce_bot_user()
        self.room = CollabRoom.objects.create(created_by=self.user, room_kind="dm")
        CollabParticipant.objects.create(room=self.room, user=self.user)
        CollabParticipant.objects.create(room=self.room, user=bot)
        self.trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="分析数据",
        )

    def make_run(self):
        return create_xiaoce_run(uuid.uuid4(), self.room, self.user, self.trigger)

    def test_cancel_is_idempotent(self):
        run = self.make_run()

        first = cancel_xiaoce_run(run)
        second = cancel_xiaoce_run(run)

        self.assertEqual(first.cancel_message_id, second.cancel_message_id)
        self.assertEqual(
            first.cancel_message.meta,
            {"run_id": str(run.id), "cancelled": True},
        )
        self.assertEqual(
            CollabMessage.objects.filter(content="已暂停本次生成。").count(),
            1,
        )

    def test_cancel_lock_does_not_join_nullable_message(self):
        run = self.make_run()

        with CaptureQueriesContext(connection) as captured:
            cancel_xiaoce_run(run)

        lock_query = next(
            query["sql"]
            for query in captured.captured_queries
            if "collab_xiaocerun" in query["sql"].lower()
            and query["sql"].lstrip().upper().startswith("SELECT")
        )
        self.assertNotIn("LEFT OUTER JOIN", lock_query.upper())

    def test_cancelled_run_cannot_save_reply(self):
        run = self.make_run()
        cancel_xiaoce_run(run)

        self.assertIsNone(complete_xiaoce_run(run.id, "不应保存"))
        self.assertFalse(CollabMessage.objects.filter(content="不应保存").exists())

    def test_completed_run_cannot_be_cancelled(self):
        run = self.make_run()
        complete_xiaoce_run(run.id, "完成")

        with self.assertRaisesMessage(ValueError, "本轮回答已经完成，无法暂停"):
            cancel_xiaoce_run(run)

    def test_only_one_running_run_is_allowed_per_user_and_room(self):
        self.make_run()
        other_trigger = CollabMessage.objects.create(
            room=self.room,
            sender=self.user,
            content="再分析一次",
        )

        with self.assertRaises(Exception):
            create_xiaoce_run(uuid.uuid4(), self.room, self.user, other_trigger)
