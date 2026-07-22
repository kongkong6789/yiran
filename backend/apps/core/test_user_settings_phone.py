from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TransactionTestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from apps.core.models import UserSettings
from apps.wecom.models import UserWeComBinding, WeComApiConfig
from apps.wecom.phone import hash_phone, normalize_phone

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

    def test_existing_binding_pending_reverification_is_not_presented_as_unbound(self):
        UserWeComBinding.objects.update_or_create(
            platform_user=self.user,
            defaults={
                "wecom_config": self.config,
                "wecom_userid": "existing-userid",
                "status": UserWeComBinding.Status.PENDING,
            },
        )

        response = self.client.get("/api/auth/settings/")

        self.assertEqual(response.status_code, 200)
        summary = response.data["wecom_binding"]
        self.assertEqual(summary["status"], "pending")
        self.assertEqual(summary["statusLabel"], "待重新验证")
        self.assertIn("原绑定关系会保留", summary["statusHint"])

    def test_non_phone_profile_save_does_not_reset_matched_binding(self):
        settings = UserSettings.objects.get(user=self.user)
        phone = "17630925326"
        UserSettings.objects.filter(pk=settings.pk).update(
            phone=phone,
            phone_hash=hash_phone(normalize_phone(phone)),
        )
        settings.refresh_from_db()
        binding = UserWeComBinding.objects.update_or_create(
            platform_user=self.user,
            defaults={
                "wecom_config": self.config,
                "wecom_userid": "existing-userid",
                "normalized_phone_hash": "legacy-key-hash",
                "status": UserWeComBinding.Status.MATCHED,
            },
        )[0]

        settings.display_name = "只修改昵称"
        settings.save()

        binding.refresh_from_db()
        settings.refresh_from_db()
        self.assertEqual(binding.status, UserWeComBinding.Status.MATCHED)
        self.assertEqual(binding.normalized_phone_hash, settings.phone_hash)

    def test_avatar_only_save_does_not_touch_phone_binding_state(self):
        settings = UserSettings.objects.get(user=self.user)
        phone = "17630925326"
        UserSettings.objects.filter(pk=settings.pk).update(
            phone=phone,
            phone_hash=hash_phone(normalize_phone(phone)),
        )
        settings.refresh_from_db()
        binding = UserWeComBinding.objects.update_or_create(
            platform_user=self.user,
            defaults={
                "wecom_config": self.config,
                "wecom_userid": "existing-userid",
                "normalized_phone_hash": settings.phone_hash,
                "status": UserWeComBinding.Status.MATCHED,
            },
        )[0]
        previous_updated_at = settings.phone_updated_at

        settings.avatar = "avatar.png"
        settings.save(update_fields=["avatar", "updated_at"])

        binding.refresh_from_db()
        settings.refresh_from_db()
        self.assertEqual(binding.status, UserWeComBinding.Status.MATCHED)
        self.assertEqual(settings.phone_updated_at, previous_updated_at)

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
        self.assertEqual(response.data["wecom_binding"]["weComMember"], "成员")
