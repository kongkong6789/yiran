from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from apps.core.models import UserSettings

from .binding_service import candidate_user_ids, manual_bind, match_user
from .models import UserWeComBinding, WeComApiConfig, WeComBindingAuditLog
from .phone import hash_phone, mask_phone, normalize_phone
from .services import WeComApiError


User = get_user_model()


@override_settings(WECOM_BINDING_ASYNC_ENABLED=False)
class PhoneAndBindingTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("admin", "a@example.com", "password123")
        self.config = WeComApiConfig.objects.create(user=self.admin, corp_id="corp", agent_id="1")
        self.config.secret = "secret"
        self.config.save()

    def make_user(self, username="member", phone="13800000000"):
        user = User.objects.create_user(username, password="password123")
        UserSettings.objects.create(user=user, phone=phone)
        return user

    def test_phone_normalization_and_masking(self):
        self.assertEqual(normalize_phone("(+86) 138-0000-0000"), "+8613800000000")
        self.assertEqual(normalize_phone("13800000000"), "+8613800000000")
        self.assertEqual(mask_phone("+8613800000000"), "138****0000")
        self.assertEqual(normalize_phone("123"), "")

    def test_missing_and_invalid_phone_do_not_call_wecom(self):
        for i, phone in enumerate(["", "12345"]):
            user = self.make_user(f"bad{i}", phone)
            with patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile") as api:
                row = match_user(user.id, source="manual", config=self.config)
            api.assert_not_called()
            self.assertEqual(row.status, "pending" if not phone else "invalid_phone")

    @patch("apps.wecom.binding_service.WeComClient.get_wecom_user", return_value={"status": 1, "name": "成员"})
    @patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile", return_value="zhangsan")
    def test_success_is_idempotent(self, mobile_api, _user_api):
        user = self.make_user()
        first = match_user(user.id, source="manual", config=self.config)
        second = match_user(user.id, source="scheduled_sync", config=self.config)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(UserWeComBinding.objects.filter(platform_user=user).count(), 1)
        self.assertEqual(first.wecom_userid, "zhangsan")
        self.assertEqual(mobile_api.call_count, 1)

    def test_duplicate_platform_phone_is_blocked(self):
        first = self.make_user("first")
        second = self.make_user("second", "+8613800000000")
        row = match_user(first.id, source="manual", config=self.config)
        self.assertEqual(row.status, "duplicate_phone")
        self.assertFalse(row.wecom_userid)
        self.assertEqual(UserSettings.objects.get(user=first).phone_hash, UserSettings.objects.get(user=second).phone_hash)

    @patch("apps.wecom.binding_service.WeComClient.get_wecom_user", return_value={"status": 1})
    @patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile", return_value="same_wecom")
    def test_wecom_userid_conflict_does_not_overwrite(self, *_):
        first = self.make_user("first", "13800000000")
        second = self.make_user("second", "13900000000")
        manual_bind(platform_user=first, wecom_userid="same_wecom", config=self.config, actor=self.admin)
        row = match_user(second.id, source="manual", config=self.config, actor=self.admin)
        self.assertEqual(row.status, "conflict")
        self.assertIsNone(row.wecom_userid)

    @patch("apps.wecom.binding_service.WeComClient.get_wecom_user", return_value={"status": 1})
    @patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile")
    def test_phone_change_same_member_revalidates_but_different_member_conflicts(self, mobile_api, *_):
        user = self.make_user()
        mobile_api.return_value = "member_a"
        matched = match_user(user.id, source="manual", config=self.config)
        previous_verified = matched.verified_at
        profile = user.settings
        profile.phone = "13900000000"
        profile.save()
        mobile_api.return_value = "member_a"
        same = match_user(user.id, source="phone_updated", config=self.config, force=True)
        self.assertGreaterEqual(same.verified_at, previous_verified)
        profile.phone = "13700000000"
        profile.save()
        mobile_api.return_value = "member_b"
        changed = match_user(user.id, source="phone_updated", config=self.config, force=True)
        self.assertEqual(changed.status, "conflict")
        self.assertEqual(changed.wecom_userid, "member_a")

    def test_error_classification_and_retry_schedule(self):
        user = self.make_user()
        with patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile", side_effect=WeComApiError("WEWORK_USER_NOT_FOUND", "未找到", 404)):
            self.assertEqual(match_user(user.id, source="manual", config=self.config).status, "not_found")
        with patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile", side_effect=WeComApiError("WEWORK_NO_PERMISSION", "权限不足", 403)):
            self.assertEqual(match_user(user.id, source="manual", config=self.config, force=True).status, "permission_denied")
        with patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile", side_effect=WeComApiError("WEWORK_TIMEOUT", "超时", 503, retryable=True)):
            row = match_user(user.id, source="manual", config=self.config, force=True)
        self.assertEqual(row.status, "retry_waiting")
        self.assertEqual(row.retry_count, 1)
        self.assertGreater(row.next_retry_at, timezone.now())

    @patch("apps.wecom.binding_service.WeComClient.get_wecom_user", return_value={"status": 1})
    @patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile", return_value="manual_user")
    def test_manual_binding_is_not_overwritten_by_scheduled_sync(self, *_):
        user = self.make_user()
        manual_bind(platform_user=user, wecom_userid="manual_user", config=self.config, actor=self.admin)
        self.assertNotIn(user.id, candidate_user_ids())
        row = match_user(user.id, source="scheduled_sync", config=self.config)
        self.assertEqual(row.wecom_userid, "manual_user")

    def test_admin_api_is_isolated_and_audited(self):
        user = self.make_user()
        normal = APIClient()
        normal.force_authenticate(user=user)
        self.assertEqual(normal.get("/api/wecom/bindings/").status_code, 403)
        client = APIClient()
        client.force_authenticate(user=self.admin)
        self.assertEqual(client.get("/api/wecom/bindings/").status_code, 200)
        response = client.post("/api/wecom/bindings/manual/", {"platformUserId": user.id, "weComUserId": "manual"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(WeComBindingAuditLog.objects.filter(platform_user=user, actor=self.admin).exists())


@override_settings(WECOM_BINDING_ASYNC_ENABLED=False)
class BindingConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def test_repeated_matching_keeps_one_binding(self):
        admin = User.objects.create_superuser("admin", "a@example.com", "password123")
        config = WeComApiConfig.objects.create(user=admin, corp_id="corp", agent_id="1")
        config.secret = "secret"
        config.save()
        user = User.objects.create_user("member", password="password123")
        UserSettings.objects.create(user=user, phone="13800000000")
        with patch("apps.wecom.binding_service.WeComClient.get_wecom_userid_by_mobile", return_value="parallel"), patch("apps.wecom.binding_service.WeComClient.get_wecom_user", return_value={"status": 1}):
            # SQLite 不适合真正并行写；连续重复执行仍覆盖任务重入的幂等路径。
            match_user(user.id, source="manual", config=config)
            match_user(user.id, source="manual", config=config)
        self.assertEqual(UserWeComBinding.objects.filter(platform_user=user).count(), 1)
