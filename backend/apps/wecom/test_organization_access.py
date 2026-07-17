from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.core.models import Organization, OrganizationMembership

from .models import WeComApiConfig, WeComContact, WeComGroupWebhook


User = get_user_model()
WEBHOOK_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=12345678-1234-1234-1234-123456789abc"


class WeComOrganizationAccessTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user("org-admin", password="password123")
        self.member = User.objects.create_user("org-member", password="password123")
        self.outsider = User.objects.create_user("org-outsider", password="password123")
        self.organization = Organization.objects.create(name="测试企业", created_by=self.admin)
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.admin,
            role=OrganizationMembership.Role.OWNER,
        )
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.member,
            role=OrganizationMembership.Role.MEMBER,
        )
        self.config = WeComApiConfig.objects.create(
            user=self.admin,
            organization=self.organization,
            corp_id="ww-org",
            agent_id="100001",
            access_scope=WeComApiConfig.AccessScope.ORGANIZATION,
            contacts_synced_at=timezone.now(),
        )
        self.config.secret = "org-secret"
        self.config.save()
        WeComContact.objects.create(
            config=self.config,
            wecom_userid="member-a",
            name="成员 A",
            available=True,
            synced_at=timezone.now(),
        )

    def test_member_uses_organization_config_but_cannot_read_secret_or_modify(self):
        self.client.force_authenticate(self.member)
        response = self.client.get("/api/wecom/config/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["corpId"], "ww-org")
        self.assertFalse(response.data["canManage"])
        self.assertEqual(response.data["secret"], "")
        self.assertEqual(self.client.patch("/api/wecom/config/", {"agentId": "100009"}, format="json").status_code, 403)
        contacts = self.client.get("/api/wecom/contacts/")
        self.assertEqual(contacts.status_code, 200)
        self.assertEqual(contacts.data["results"][0]["name"], "成员 A")

    def test_selected_scope_denies_unselected_member(self):
        self.config.access_scope = WeComApiConfig.AccessScope.SELECTED
        self.config.save(update_fields=["access_scope", "updated_at"])
        self.client.force_authenticate(self.member)
        denied = self.client.get("/api/wecom/contacts/")
        self.assertEqual(denied.status_code, 409)
        self.config.allowed_users.add(self.member)
        allowed = self.client.get("/api/wecom/contacts/")
        self.assertEqual(allowed.status_code, 200)

    @patch("apps.wecom.notification_service.send_group_webhook_markdown", return_value={"errcode": 0})
    def test_shared_webhook_can_be_used_by_member_but_not_outsider(self, send):
        webhook = WeComGroupWebhook(
            user=self.admin,
            organization=self.organization,
            name="经营群",
            access_scope=WeComGroupWebhook.AccessScope.ORGANIZATION,
        )
        webhook.webhook_key = WEBHOOK_URL.split("key=", 1)[1]
        webhook.save()
        self.client.force_authenticate(self.member)
        sent = self.client.post("/api/wecom/notifications/", {
            "mode": "group",
            "groupWebhookId": webhook.id,
            "task": "企业共享任务",
        }, format="json")
        self.assertEqual(sent.status_code, 200)
        send.assert_called_once()
        self.client.force_authenticate(self.outsider)
        denied = self.client.post("/api/wecom/notifications/", {
            "mode": "group",
            "groupWebhookId": webhook.id,
            "task": "越权任务",
        }, format="json")
        self.assertEqual(denied.status_code, 404)
