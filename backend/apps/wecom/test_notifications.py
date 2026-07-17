from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.core.models import Organization, OrganizationMembership
from .models import WeComApiConfig, WeComGroupWebhook, WeComNotificationRecord
from .services import WeComApiError, WeComClient, send_group_webhook_text


User = get_user_model()
WEBHOOK_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=12345678-1234-1234-1234-123456789abc"


class WeComNotificationApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("sender", password="password123")
        self.other = User.objects.create_user("other", password="password123")
        self.organization = Organization.objects.create(name="通知测试企业", created_by=self.user)
        OrganizationMembership.objects.create(organization=self.organization, user=self.user, role="owner")
        OrganizationMembership.objects.create(organization=self.organization, user=self.other, role="member")
        self.config = WeComApiConfig.objects.create(
            user=self.user,
            organization=self.organization,
            corp_id="wwcorp",
            agent_id="100001",
        )
        self.config.secret = "secret"
        self.config.save()
        self.client.force_authenticate(self.user)

    def create_group(self, name="运营群"):
        response = self.client.post("/api/wecom/group-webhooks/", {"name": name, "webhookUrl": WEBHOOK_URL}, format="json")
        self.assertEqual(response.status_code, 201)
        return WeComGroupWebhook.objects.get(id=response.data["group"]["id"])

    def test_group_webhook_is_encrypted_masked_and_user_isolated(self):
        row = self.create_group()
        self.assertNotIn("123456789abc", row.webhook_key_encrypted)
        response = self.client.get("/api/wecom/group-webhooks/")
        self.assertNotContains(response, "12345678-1234-1234-1234-123456789abc")
        self.assertIn("***", response.data["results"][0]["maskedWebhook"])
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.delete(f"/api/wecom/group-webhooks/{row.id}/").status_code, 404)

    @patch("apps.wecom.notification_service.WeComClient.send_app_text", return_value={"msgid": "msg-001", "invalidUsers": []})
    def test_person_notification_uses_real_service_result(self, send):
        response = self.client.post("/api/wecom/notifications/", {
            "mode": "person", "recipientUserIds": ["xieyiping"], "task": "生成日报",
            "agentName": "运营智能体", "deadline": "2026-07-16 18:00", "priority": "high", "targetLabel": "谢依萍",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["notification"]["status"], "accepted")
        self.assertEqual(response.data["notification"]["wecom_msgid"], "msg-001")
        send.assert_called_once()

    @patch("apps.wecom.notification_service.WeComClient.send_app_text", return_value={"msgid": "msg-002", "invalidUsers": ["invalid"]})
    def test_invalid_user_returns_partial_status(self, _send):
        response = self.client.post("/api/wecom/notifications/", {
            "mode": "person", "recipientUserIds": ["valid", "invalid"], "task": "生成日报",
        }, format="json")
        self.assertEqual(response.status_code, 207)
        self.assertEqual(response.data["notification"]["status"], "partial")
        self.assertEqual(response.data["notification"]["invalid_users"], ["invalid"])

    @patch("apps.wecom.notification_service.WeComClient.send_app_text", side_effect=WeComApiError("WEWORK_NO_PERMISSION", "应用无发送权限", 403))
    def test_send_failure_is_persisted_and_returned(self, _send):
        response = self.client.post("/api/wecom/notifications/", {
            "mode": "person", "recipientUserIds": ["xieyiping"], "task": "生成日报",
        }, format="json")
        self.assertEqual(response.status_code, 403)
        record = WeComNotificationRecord.objects.get()
        self.assertEqual(record.status, "failed")
        self.assertEqual(record.error_code, "WEWORK_NO_PERMISSION")

    @patch("apps.wecom.notification_service.send_group_webhook_markdown", return_value={"errcode": 0})
    def test_group_notification_uses_owned_webhook(self, send):
        row = self.create_group()
        response = self.client.post("/api/wecom/notifications/", {
            "mode": "group", "groupWebhookId": row.id, "task": "项目例会", "targetLabel": "运营群",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["notification"]["status"], "accepted")
        send.assert_called_once()
        self.assertEqual(send.call_args.args[0], row.webhook_key)

    def test_cannot_send_to_another_users_webhook(self):
        row = WeComGroupWebhook(user=self.other, name="其他群")
        row.webhook_key = "12345678-1234-1234-1234-123456789abc"
        row.save()
        response = self.client.post("/api/wecom/notifications/", {"mode": "group", "groupWebhookId": row.id, "task": "越权消息"}, format="json")
        self.assertEqual(response.status_code, 404)

    @patch("apps.wecom.notification_service.WeComClient.send_app_text", return_value={"msgid": "admin-retry", "invalidUsers": []})
    def test_admin_can_list_all_and_resend_another_users_notification(self, send):
        record = WeComNotificationRecord.objects.create(
            user=self.other, config=self.config, channel="person", target_ids=["other-user"],
            target_label="其他用户", content="待重发消息", status="failed", error_code="WEWORK_NETWORK_ERROR",
        )
        admin = User.objects.create_superuser("admin", password="password123", email="admin@example.com")
        self.client.force_authenticate(admin)
        listing = self.client.get("/api/wecom/notifications/?all=1")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.data["results"][0]["userId"], self.other.id)
        response = self.client.post(f"/api/wecom/notifications/{record.id}/retry/", {}, format="json")
        self.assertEqual(response.status_code, 200)
        record.refresh_from_db()
        self.assertEqual(record.status, "accepted")
        send.assert_called_once()

    @patch("apps.wecom.notification_service.send_group_webhook_markdown", return_value={"errcode": 0})
    def test_group_notification_idempotency_prevents_duplicate_send(self, send):
        row = self.create_group()
        payload = {"mode": "group", "groupWebhookId": row.id, "task": "幂等任务", "idempotencyKey": "trace-1:group"}
        first = self.client.post("/api/wecom/notifications/", payload, format="json")
        second = self.client.post("/api/wecom/notifications/", payload, format="json")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.data["notification"]["id"], first.data["notification"]["id"])
        self.assertEqual(WeComNotificationRecord.objects.count(), 1)
        send.assert_called_once()

    @patch("apps.wecom.notification_service.WeComClient.send_app_text")
    def test_retryable_failure_is_queued_and_can_be_retried(self, send):
        send.side_effect = [WeComApiError("WEWORK_NETWORK_ERROR", "网络超时", 502, retryable=True), {"msgid": "retry-ok", "invalidUsers": []}]
        response = self.client.post("/api/wecom/notifications/", {"mode": "person", "recipientUserIds": ["xieyiping"], "task": "重试任务", "idempotencyKey": "retry-1"}, format="json")
        self.assertEqual(response.status_code, 202)
        record = WeComNotificationRecord.objects.get()
        self.assertEqual(record.status, "retry_waiting")
        self.assertIsNotNone(record.next_retry_at)
        retry = self.client.post(f"/api/wecom/notifications/{record.id}/retry/", {}, format="json")
        self.assertEqual(retry.status_code, 200)
        record.refresh_from_db()
        self.assertEqual(record.status, "accepted")
        self.assertEqual(record.retry_count, 1)

    @patch("apps.wecom.services.send_group_webhook_markdown", return_value={"errcode": 0})
    def test_group_can_be_updated_disabled_and_tested(self, send):
        row = self.create_group()
        changed = self.client.patch(f"/api/wecom/group-webhooks/{row.id}/", {"name": "新群名", "enabled": False}, format="json")
        self.assertEqual(changed.status_code, 200)
        self.assertFalse(changed.data["group"]["enabled"])
        self.assertEqual(self.client.post(f"/api/wecom/group-webhooks/{row.id}/test/", {}, format="json").status_code, 404)
        self.client.patch(f"/api/wecom/group-webhooks/{row.id}/", {"enabled": True}, format="json")
        tested = self.client.post(f"/api/wecom/group-webhooks/{row.id}/test/", {}, format="json")
        self.assertEqual(tested.status_code, 200)
        send.assert_called_once()


class WeComNotificationClientTests(APITestCase):
    def test_app_message_send_body(self):
        user = User.objects.create_user("client", password="password123")
        config = WeComApiConfig.objects.create(user=user, corp_id="ww", agent_id="100001")
        config.secret = "secret"
        config.save()
        client = WeComClient(config)
        with patch.object(client, "_token_call", return_value={"errcode": 0, "msgid": "m1", "invaliduser": "bad"}) as call:
            result = client.send_app_text(["good", "bad"], "任务消息")
        self.assertEqual(result["invalidUsers"], ["bad"])
        body = call.call_args.kwargs["body"]
        self.assertEqual(body["touser"], "good|bad")
        self.assertEqual(body["agentid"], 100001)
        self.assertEqual(call.call_args.args[:2], ("POST", "message/send"))

    @patch("apps.wecom.services.requests.post")
    def test_group_robot_calls_official_webhook(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"errcode": 0, "errmsg": "ok"}
        post.return_value = response
        send_group_webhook_text("robot-key", "群消息")
        self.assertEqual(post.call_args.kwargs["params"], {"key": "robot-key"})
        self.assertEqual(post.call_args.kwargs["json"]["msgtype"], "text")

    @patch("apps.wecom.services.requests.post")
    def test_group_robot_markdown_calls_official_webhook(self, post):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"errcode": 0, "errmsg": "ok"}
        post.return_value = response
        from .services import send_group_webhook_markdown
        send_group_webhook_markdown("robot-key", "## 新任务\n> 内容")
        self.assertEqual(post.call_args.kwargs["params"], {"key": "robot-key"})
        self.assertEqual(post.call_args.kwargs["json"]["msgtype"], "markdown")
        self.assertEqual(post.call_args.kwargs["json"]["markdown"]["content"], "## 新任务\n> 内容")
