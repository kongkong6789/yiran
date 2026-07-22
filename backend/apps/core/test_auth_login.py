from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from .organizations import create_personal_organization


User = get_user_model()


class AuthLoginApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("active-user", password="password123")
        create_personal_organization(self.user, name="测试企业")
        self.disabled_user = User.objects.create_user("disabled-user", password="password123")
        self.disabled_user.is_active = False
        self.disabled_user.save(update_fields=["is_active"])

    def test_login_rejects_invalid_credentials(self):
        response = self.client.post(
            "/api/auth/login/",
            {"username": "active-user", "password": "wrong-password"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"], "用户名或密码错误")

    def test_login_rejects_disabled_user_with_specific_message(self):
        response = self.client.post(
            "/api/auth/login/",
            {"username": "disabled-user", "password": "password123"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"], "账号已停用，请联系管理员")

    def test_token_auth_rejects_disabled_user_with_specific_message(self):
        token = Token.objects.create(user=self.disabled_user)
        response = self.client.get(
            "/api/auth/me/",
            HTTP_AUTHORIZATION=f"Token {token.key}",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["detail"], "账号已停用，请联系管理员")
