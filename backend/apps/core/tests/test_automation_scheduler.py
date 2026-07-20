from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.core.automation_scheduler import (
    claim_due_automation,
    configure_next_run,
    execute_automation,
    next_schedule_time,
)
from apps.core.models import Organization, WorkAutomation, WorkAutomationRun


class AutomationScheduleTests(TestCase):
    def test_daily_and_workday_rules_use_shanghai_time(self):
        shanghai = ZoneInfo("Asia/Shanghai")
        friday = datetime(2026, 7, 17, 11, 0, tzinfo=shanghai)
        self.assertEqual(
            next_schedule_time("每天 09:00", after=friday),
            datetime(2026, 7, 18, 9, 0, tzinfo=shanghai),
        )
        self.assertEqual(
            next_schedule_time("工作日 10:00", after=friday),
            datetime(2026, 7, 20, 10, 0, tzinfo=shanghai),
        )

    def test_hour_interval_is_strictly_in_the_future(self):
        now = timezone.now()
        self.assertEqual(next_schedule_time("每 2 小时", after=now), now + timedelta(hours=2))


class AutomationExecutionTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="scheduler-user", password="test")
        self.organization = Organization.objects.create(name="Scheduler Org", created_by=self.user)

    def _automation(self):
        row = WorkAutomation(
            organization=self.organization,
            creator=self.user,
            name="日报",
            trigger_type=WorkAutomation.TriggerType.SCHEDULE,
            trigger_rule="每天 09:00",
            action="同步经营数据",
            notification_channel=WorkAutomation.NotificationChannel.NONE,
            enabled=True,
        )
        configure_next_run(row)
        row.save()
        return row

    @patch("apps.core.automation_scheduler.run_sop")
    def test_due_run_is_claimed_once_and_persisted(self, run_sop_mock):
        run_sop_mock.return_value = {
            "trace_id": "ignored",
            "decision": "allow",
            "action": "jackyun.sync",
            "result": {"ok": True},
            "steps": [{"node": "done"}],
        }
        row = self._automation()
        due_at = timezone.now() - timedelta(minutes=1)
        WorkAutomation.objects.filter(pk=row.pk).update(next_run_at=due_at)

        claim = claim_due_automation()
        self.assertIsNotNone(claim)
        claimed_row, scheduled_for = claim
        self.assertEqual(scheduled_for, due_at)
        self.assertIsNone(claim_due_automation())

        run = execute_automation(claimed_row, scheduled_for=scheduled_for)
        self.assertEqual(run.status, WorkAutomationRun.Status.SUCCESS)
        row.refresh_from_db()
        self.assertEqual(row.run_count, 1)
        self.assertEqual(row.last_run_status, WorkAutomationRun.Status.SUCCESS)
        self.assertIsNone(row.claim_token)
        self.assertGreater(row.next_run_at, timezone.now())
