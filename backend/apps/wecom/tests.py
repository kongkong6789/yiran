from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase
from unittest.mock import Mock, patch

from .models import UserWeComBinding, WeComApiConfig, WeComBindingSyncJob, WeComContact
from .services import WeComClient


class WeComApiConfigTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user_a = user_model.objects.create_user(username="wecom-a", password="test-pass-123")
        self.user_b = user_model.objects.create_user(username="wecom-b", password="test-pass-123")
        self.token_a = Token.objects.create(user=self.user_a)
        self.token_b = Token.objects.create(user=self.user_b)

    def authenticate(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    def test_contact_avatar_falls_back_to_member_detail_and_https(self):
        config = WeComApiConfig.objects.create(user=self.user_a, corp_id="ww-a", agent_id="100001")
        config.secret = "secret"
        config.save()
        client = WeComClient(config)
        with patch.object(client, "_token_call", side_effect=[
            {"department": [{"id": 1, "name": "良策"}]},
            {"userlist": [{"userid": "member-a", "name": "成员 A", "department": [1], "status": 1}]},
            {"userid": "member-a", "avatar": "http://example.com/member-a.png"},
        ]) as call:
            rows = client.get_visible_contacts()
        self.assertEqual(rows[0]["avatar"], "https://example.com/member-a.png")
        self.assertEqual(call.call_count, 3)

    def test_requires_authentication(self):
        response = self.client.get("/api/wecom/config/")
        self.assertEqual(response.status_code, 401)

    def test_configs_are_encrypted_and_isolated_by_user(self):
        self.authenticate(self.token_a)
        response_a = self.client.put("/api/wecom/config/", {
            "corpId": "ww-user-a",
            "agentId": "100001",
            "secret": "secret-user-a",
            "callbackUrl": "https://a.example.com/wecom/callback",
            "token": "token-user-a",
            "encodingAesKey": "aes-user-a",
        }, format="json")
        self.assertEqual(response_a.status_code, 200)
        self.assertEqual(response_a.data["secret"], "***")

        self.authenticate(self.token_b)
        response_b = self.client.put("/api/wecom/config/", {
            "corpId": "ww-user-b",
            "agentId": "100002",
            "secret": "secret-user-b",
        }, format="json")
        self.assertEqual(response_b.status_code, 200)

        config_a = WeComApiConfig.objects.get(user=self.user_a)
        config_b = WeComApiConfig.objects.get(user=self.user_b)
        self.assertNotEqual(config_a.secret_encrypted, "secret-user-a")
        self.assertNotEqual(config_a.secret_encrypted, config_b.secret_encrypted)
        self.assertEqual(config_a.secret, "secret-user-a")
        self.assertEqual(config_b.secret, "secret-user-b")

        get_b = self.client.get("/api/wecom/config/")
        self.assertEqual(get_b.data["corpId"], "ww-user-b")
        self.assertNotContains(get_b, "ww-user-a")

    def test_masked_secret_preserves_existing_ciphertext(self):
        self.authenticate(self.token_a)
        self.client.put("/api/wecom/config/", {
            "corpId": "ww-user-a",
            "agentId": "100001",
            "secret": "secret-user-a",
        }, format="json")
        before = WeComApiConfig.objects.get(user=self.user_a).secret_encrypted
        response = self.client.patch("/api/wecom/config/", {"secret": "***", "agentId": "100009"}, format="json")
        self.assertEqual(response.status_code, 200)
        after = WeComApiConfig.objects.get(user=self.user_a)
        self.assertEqual(after.secret_encrypted, before)
        self.assertEqual(after.agent_id, "100009")

    def test_saving_config_requeues_stale_not_configured_binding(self):
        self.authenticate(self.token_a)
        binding = UserWeComBinding.objects.create(
            platform_user=self.user_a,
            status=UserWeComBinding.Status.PERMISSION_DENIED,
            failure_code="WECOM_NOT_CONFIGURED",
            failure_reason="请先配置企业微信 API。",
        )

        response = self.client.put("/api/wecom/config/", {
            "corpId": "ww-user-a",
            "agentId": "100001",
            "secret": "secret-user-a",
        }, format="json")

        self.assertEqual(response.status_code, 200)
        binding.refresh_from_db()
        self.assertEqual(binding.status, UserWeComBinding.Status.PENDING)
        self.assertEqual(binding.failure_code, "")
        self.assertEqual(binding.failure_reason, "")
        self.assertEqual(binding.wecom_config.corp_id, "ww-user-a")
        self.assertTrue(WeComBindingSyncJob.objects.filter(
            config=binding.wecom_config,
            status=WeComBindingSyncJob.Status.PENDING,
        ).exists())

    @patch("apps.wecom.views.WeComClient")
    def test_connection_test_uses_only_saved_credentials(self, client_class):
        config = WeComApiConfig.objects.create(
            user=self.user_a,
            corp_id="ww-saved",
            agent_id="100001",
        )
        config.secret = "saved-secret"
        config.save()
        ciphertext_before = config.secret_encrypted
        client_class.return_value.test_wecom_connection.return_value = {"appName": "Saved app"}
        client_class.return_value.get_visible_contacts.return_value = []

        self.authenticate(self.token_a)
        response = self.client.post("/api/wecom/config/test/", {
            "corpId": "ww-unsaved",
            "agentId": "999999",
            "secret": "unsaved-secret",
        }, format="json")

        self.assertEqual(response.status_code, 200)
        tested_config = client_class.call_args.args[0]
        self.assertEqual(tested_config.pk, config.pk)
        self.assertEqual(tested_config.corp_id, "ww-saved")
        config.refresh_from_db()
        self.assertEqual(config.secret_encrypted, ciphertext_before)
        self.assertEqual(config.secret, "saved-secret")

    def test_contacts_require_authentication(self):
        response = self.client.get("/api/wecom/contacts/")
        self.assertEqual(response.status_code, 401)

    def test_contacts_require_current_users_config(self):
        self.authenticate(self.token_a)
        response = self.client.get("/api/wecom/contacts/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "wecom_not_configured")

    @patch("apps.wecom.services.requests.get")
    def test_contacts_use_current_users_config_and_return_visible_members(self, mock_get):
        config_a = WeComApiConfig.objects.create(
            user=self.user_a,
            corp_id="ww-user-a",
            agent_id="100001",
        )
        config_a.secret = "secret-user-a"
        config_a.save()
        config_b = WeComApiConfig.objects.create(
            user=self.user_b,
            corp_id="ww-user-b",
            agent_id="100002",
        )
        config_b.secret = "secret-user-b"
        config_b.save()

        def response(payload):
            item = Mock()
            item.raise_for_status.return_value = None
            item.json.return_value = payload
            return item

        mock_get.side_effect = [
            response({"errcode": 0, "access_token": "token-b", "expires_in": 7200}),
            response({"errcode": 0, "department": [{"id": 1, "name": "良策"}, {"id": 8, "name": "运营中心"}]}),
            response({
                "errcode": 0,
                "userlist": [{
                    "userid": "xieyiping",
                    "name": "谢依萍",
                    "department": [8],
                    "position": "运营经理",
                    "status": 1,
                    "thumb_avatar": "http://example.com/avatar.png",
                }],
            }),
        ]

        self.authenticate(self.token_b)
        response_value = self.client.get("/api/wecom/contacts/")

        self.assertEqual(response_value.status_code, 200)
        self.assertEqual(response_value.data["count"], 1)
        self.assertNotIn("weComUserId", response_value.data["results"][0])
        self.assertTrue(response_value.data["results"][0]["key"].startswith("contact:"))
        self.assertEqual(response_value.data["results"][0]["department"], "运营中心")
        self.assertEqual(response_value.data["results"][0]["avatar"], "https://example.com/avatar.png")
        self.assertEqual(response_value.data["dataSource"], "wecom_sync")
        self.assertEqual(WeComContact.objects.get(config=config_b).avatar_url, "https://example.com/avatar.png")
        token_params = mock_get.call_args_list[0].kwargs["params"]
        self.assertEqual(token_params["corpid"], "ww-user-b")
        self.assertEqual(token_params["corpsecret"], "secret-user-b")
        self.assertNotEqual(token_params["corpsecret"], "secret-user-a")

        cached = self.client.get("/api/wecom/contacts/")
        self.assertEqual(cached.status_code, 200)
        self.assertEqual(cached.data["dataSource"], "database")
        self.assertEqual(cached.data["results"][0]["avatar"], "https://example.com/avatar.png")
        self.assertEqual(mock_get.call_count, 3)
