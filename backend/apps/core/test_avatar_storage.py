from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from apps.core.avatar_storage import StoredAvatar
from apps.core.models import UserSettings


User = get_user_model()


class AvatarStorageApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="avatar-user", password="pass12345")
        self.profile = UserSettings.objects.create(user=self.user)
        token = Token.objects.create(user=self.user)
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")

    @patch("apps.core.auth_views.upload_avatar_object")
    def test_upload_persists_cos_token_instead_of_local_path(self, upload_mock):
        upload_mock.return_value = StoredAvatar(
            token="cos:u1_avatar.png",
            key="media/avatars/u1_avatar.png",
        )
        image = SimpleUploadedFile("avatar.png", b"fake-png", content_type="image/png")

        response = self.client.post("/api/auth/avatar/", {"file": image}, format="multipart")

        self.assertEqual(response.status_code, 200)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.avatar, "cos:u1_avatar.png")
        self.assertEqual(response.data["avatar_url"], "/api/auth/avatars/cos:u1_avatar.png/")

    @patch("apps.core.auth_views.fetch_avatar_object")
    def test_cos_avatar_is_served_through_authenticated_endpoint(self, fetch_mock):
        self.profile.avatar = "cos:u1_avatar.png"
        self.profile.save(update_fields=["avatar", "updated_at"])
        fetch_mock.return_value = (BytesIO(b"image-data"), "image/png", 10)

        response = self.client.get("/api/auth/avatars/cos:u1_avatar.png/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), b"image-data")

    def test_avatar_endpoint_requires_authentication(self):
        client = APIClient()
        response = client.get("/api/auth/avatars/cos:u1_avatar.png/")
        self.assertEqual(response.status_code, 401)
