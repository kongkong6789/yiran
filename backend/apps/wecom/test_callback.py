import base64
import hashlib
import os
import struct
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from apps.core.models import Organization, OrganizationMembership

from .models import WeComApiConfig, WeComBindingSyncJob, WeComCallbackEvent
from .event_processor import process_callback_event


User = get_user_model()


def encrypt_for_wecom(aes_key_43: str, message: str, receive_id: str) -> str:
    key = base64.b64decode(f"{aes_key_43}=")
    message_bytes = message.encode("utf-8")
    plain = os.urandom(16) + struct.pack(">I", len(message_bytes)) + message_bytes + receive_id.encode("utf-8")
    pad = 32 - len(plain) % 32
    plain += bytes([pad]) * pad
    encryptor = Cipher(algorithms.AES(key), modes.CBC(key[:16])).encryptor()
    return base64.b64encode(encryptor.update(plain) + encryptor.finalize()).decode("ascii")


def signature(token: str, timestamp: str, nonce: str, encrypted: str) -> str:
    return hashlib.sha1("".join(sorted([token, timestamp, nonce, encrypted])).encode("utf-8")).hexdigest()


@override_settings(WECOM_CALLBACK_BASE_URL="https://xx.stillgroup.net:8000")
class WeComCallbackTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("callback-owner", password="test-pass-123")
        self.token = Token.objects.create(user=self.user)
        self.organization = Organization.objects.create(name="回调测试企业", created_by=self.user)
        OrganizationMembership.objects.create(
            organization=self.organization,
            user=self.user,
            role=OrganizationMembership.Role.OWNER,
        )
        self.config = WeComApiConfig.objects.create(
            user=self.user,
            organization=self.organization,
            corp_id="ww-callback",
            agent_id="100001",
        )
        self.config.secret = "app-secret"
        self.config.save()
        self.config.ensure_callback_credentials()
        self.url = f"/api/wecom/callback/{self.config.callback_key}/"

    def test_config_returns_generated_readonly_callback_values_to_owner(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token.key}")
        response = self.client.get("/api/wecom/config/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["callbackUrl"], f"https://xx.stillgroup.net:8000{self.url}")
        self.assertEqual(response.data["token"], self.config.token)
        self.assertEqual(response.data["encodingAesKey"], self.config.encoding_aes_key)
        self.assertEqual(len(response.data["encodingAesKey"]), 43)
        self.assertEqual(response.data["secret"], "***")

    def test_get_verification_decrypts_echo_and_marks_verified(self):
        encrypted = encrypt_for_wecom(self.config.encoding_aes_key, "verified-echo", self.config.corp_id)
        timestamp, nonce = "1720000000", "nonce-a"
        response = self.client.get(self.url, {
            "msg_signature": signature(self.config.token, timestamp, nonce, encrypted),
            "timestamp": timestamp, "nonce": nonce, "echostr": encrypted,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content.decode(), "verified-echo")
        self.config.refresh_from_db()
        self.assertIsNotNone(self.config.callback_verified_at)

    def test_post_decrypts_and_persists_event_idempotently(self):
        event_xml = "<xml><ToUserName>ww-callback</ToUserName><FromUserName>xieyiping</FromUserName><MsgType>event</MsgType><Event>change_contact</Event><ChangeType>update_user</ChangeType><UserID>xieyiping</UserID></xml>"
        encrypted = encrypt_for_wecom(self.config.encoding_aes_key, event_xml, self.config.corp_id)
        timestamp, nonce = "1720000001", "nonce-b"
        params = {"msg_signature": signature(self.config.token, timestamp, nonce, encrypted), "timestamp": timestamp, "nonce": nonce}
        body = f"<xml><ToUserName>ww-callback</ToUserName><Encrypt>{encrypted}</Encrypt></xml>"
        first = self.client.post(self.url, data=body, content_type="application/xml", QUERY_STRING="&".join(f"{k}={v}" for k, v in params.items()))
        second = self.client.post(self.url, data=body, content_type="application/xml", QUERY_STRING="&".join(f"{k}={v}" for k, v in params.items()))
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.content.decode(), "success")
        self.assertEqual(second.status_code, 200)
        self.assertEqual(WeComCallbackEvent.objects.count(), 1)
        event = WeComCallbackEvent.objects.get()
        self.assertEqual(event.event_type, "change_contact")
        self.assertEqual(event.change_type, "update_user")
        self.assertEqual(event.from_user_id, "xieyiping")

    def test_invalid_signature_and_wrong_corp_are_rejected(self):
        encrypted = encrypt_for_wecom(self.config.encoding_aes_key, "echo", self.config.corp_id)
        response = self.client.get(self.url, {"msg_signature": "bad", "timestamp": "1", "nonce": "2", "echostr": encrypted})
        self.assertEqual(response.status_code, 400)
        wrong = encrypt_for_wecom(self.config.encoding_aes_key, "echo", "ww-other")
        response = self.client.get(self.url, {"msg_signature": signature(self.config.token, "1", "2", wrong), "timestamp": "1", "nonce": "2", "echostr": wrong})
        self.assertEqual(response.status_code, 400)

    def test_callback_urls_are_isolated_per_config(self):
        other = User.objects.create_user("other", password="test-pass-123")
        other_config = WeComApiConfig.objects.create(user=other)
        self.assertNotEqual(self.config.callback_key, other_config.callback_key)

    @patch("apps.wecom.event_processor.sync_contacts", return_value=[])
    def test_contact_event_queues_durable_binding_sync(self, sync_contacts_mock):
        event = WeComCallbackEvent.objects.create(
            config=self.config, dedup_key="event-process-1", msg_type="event",
            event_type="change_contact", change_type="update_user", payload={"UserID": "member"},
        )
        processed = process_callback_event(event)
        self.assertEqual(processed.processing_status, "completed")
        self.assertEqual(processed.processing_result["action"], "contacts_refreshed_and_binding_sync_queued")
        sync_contacts_mock.assert_called_once()
        self.assertEqual(WeComBindingSyncJob.objects.filter(config=self.config, status="pending").count(), 1)
