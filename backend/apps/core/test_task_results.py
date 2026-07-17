from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import TaskFollowUp, TaskResultRecord
from .models import WorkTask, WorkTaskArtifact
from .organizations import assign_user_to_organization, create_personal_organization
from apps.wecom.models import UserWeComBinding, WeComApiConfig


User = get_user_model()


class TaskResultApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("task-owner", password="password123")
        self.other = User.objects.create_user("other-owner", password="password123")
        membership = create_personal_organization(self.user, name="测试企业")
        assign_user_to_organization(self.other, membership.organization)
        self.wecom_config = WeComApiConfig.objects.create(
            user=self.user,
            organization=membership.organization,
            corp_id="ww-test",
            agent_id="100001",
        )
        self.client.force_authenticate(self.user)

    def test_result_actions_are_persisted_and_user_isolated(self):
        created = self.client.post("/api/task-results/", {"traceId": "trace-1", "sopId": "report.generate", "status": "success", "title": "日报", "snapshot": {"summary": ["完成"]}}, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(TaskResultRecord.objects.count(), 1)
        follow = self.client.post("/api/task-results/trace-1/follow-ups/", {"title": "检查异常"}, format="json")
        self.assertEqual(follow.status_code, 201)
        self.assertEqual(TaskFollowUp.objects.count(), 1)
        resolved = self.client.post("/api/task-results/trace-1/attention/a1/resolve/", {}, format="json")
        self.assertEqual(resolved.data["resolvedAttentionIds"], ["a1"])
        exported = self.client.get("/api/task-results/trace-1/export/")
        self.assertEqual(exported.status_code, 200)
        self.assertIn("attachment", exported["Content-Disposition"])
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/task-results/trace-1/").status_code, 404)

    def test_sent_and_received_tasks_use_real_priority_and_user_isolation(self):
        UserWeComBinding.objects.create(
            platform_user=self.other,
            wecom_config=self.wecom_config,
            wecom_userid="other-wecom",
            status=UserWeComBinding.Status.MATCHED,
            source=UserWeComBinding.Source.ADMIN_CONFIRMED,
        )
        created = self.client.post("/api/tasks/", {
            "traceId": "task-trace-1",
            "title": "复核销售异常",
            "sopId": "sales.review",
            "priority": "urgent",
            "deadline": "2026-07-17T18:00:00+08:00",
            "assigneeWeComUserIds": ["other-wecom"],
            "assigneeNames": ["其他用户"],
            "notificationTarget": "其他用户",
            "notificationMode": "none",
            "timeline": [{"title": "任务已创建", "status": "completed", "detail": "已创建"}],
            "parameters": {"dt": "2026-07-16", "scope": "all"},
            "resultData": {"ok": True, "processed_count": 12},
        }, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["task"]["priority"], "urgent")
        self.assertEqual(WorkTask.objects.get().assignees.get(), self.other)
        self.assertEqual(WorkTaskArtifact.objects.filter(task=WorkTask.objects.get()).count(), 3)
        artifact = created.data["task"]["artifacts"][0]
        preview = self.client.get(f"/api{artifact['preview_url']}")
        self.assertEqual(preview.status_code, 200)
        download = self.client.get(f"/api{artifact['download_url']}")
        self.assertEqual(download.status_code, 200)
        self.assertIn("attachment", download["Content-Disposition"])
        sent = self.client.get("/api/tasks/?view=sent")
        self.assertEqual(sent.data["count"], 1)

        self.client.force_authenticate(self.other)
        received = self.client.get("/api/tasks/?view=received")
        self.assertEqual(received.status_code, 200)
        self.assertEqual(received.data["results"][0]["sender"], self.user.username)
        self.assertEqual(self.client.get(f"/api{artifact['download_url']}").status_code, 200)
        self.assertEqual(self.client.patch("/api/tasks/task-trace-1/", {"status": "completed"}, format="json").status_code, 404)

        self.client.force_authenticate(self.user)
        updated = self.client.patch("/api/tasks/task-trace-1/", {
            "status": "completed",
            "progress": 100,
            "sopId": "report.generate",
            "notificationStatus": "accepted",
            "timeline": [{"title": "任务执行完成", "status": "completed", "detail": "已完成"}],
        }, format="json")
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["task"]["progress"], 100)
        self.assertEqual(updated.data["task"]["sopId"], "report.generate")
        self.assertEqual(updated.data["task"]["timeline"][0]["status"], "completed")
