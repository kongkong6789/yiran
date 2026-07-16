from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from apps.core.models import UserSettings
from apps.wecom.models import UserWeComBinding, WeComApiConfig

User = get_user_model()


@override_settings(WECOM_BINDING_ASYNC_ENABLED=False)
class UserSettingsPhoneTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="profile_user", password="pass12345")
        UserSettings.objects.create(user=self.user)
        self.token = Token.objects.create(user=self.user)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")
        self.config = WeComApiConfig.objects.create(
            user=self.user,
            corp_id="ww123",
            agent_id="1000001",
            secret="secret",
        )

    def test_get_settings_includes_phone_and_binding_summary(self):
        response = self.client.get("/api/auth/settings/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["phone_masked"], "—")
        self.assertIn("wecom_binding", response.data)
        self.assertEqual(response.data["wecom_binding"]["status"], "pending")

    @patch("apps.wecom.binding_service.WeComClient.get_wecom_user", return_value={"status": 1, "name": "成员"})
    @patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile", return_value="zhangsan")
    def test_put_phone_triggers_wecom_sync(self, *_):
        response = self.client.put(
            "/api/auth/settings/",
            {"phone": "13800000000"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["wecom_sync_triggered"])
        self.assertEqual(response.data["phone_masked"], "138****0000")
        binding = UserWeComBinding.objects.get(platform_user=self.user)
        self.assertEqual(binding.status, UserWeComBinding.Status.MATCHED)
        self.assertEqual(binding.wecom_userid, "zhangsan")
        self.assertEqual(binding.source, UserWeComBinding.Source.PHONE_UPDATED)
