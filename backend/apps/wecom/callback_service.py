from __future__ import annotations

import hashlib
from xml.etree import ElementTree

from django.db import IntegrityError, transaction
from django.utils import timezone

from .crypto import WeComCallbackCryptoError, decrypt_callback_message, verify_callback_signature
from .models import WeComApiConfig, WeComCallbackEvent


MAX_CALLBACK_BYTES = 1024 * 1024


def callback_url(config: WeComApiConfig, request=None) -> str:
    from django.conf import settings
    path = f"/api/wecom/callback/{config.callback_key}/"
    base = str(getattr(settings, "WECOM_CALLBACK_BASE_URL", "") or "").strip().rstrip("/")
    if base:
        return f"{base}{path}"
    return request.build_absolute_uri(path) if request is not None else path


def decrypt_verified_payload(config: WeComApiConfig, *, signature: str, timestamp: str, nonce: str, encrypted: str) -> str:
    config.ensure_callback_credentials()
    if not verify_callback_signature(config.token, timestamp, nonce, encrypted, signature):
        raise WeComCallbackCryptoError("企业微信回调签名校验失败。")
    return decrypt_callback_message(config.encoding_aes_key, encrypted, config.corp_id)


def parse_xml(xml_text: str) -> dict[str, str]:
    if "<!DOCTYPE" in xml_text.upper() or "<!ENTITY" in xml_text.upper():
        raise WeComCallbackCryptoError("企业微信回调 XML 包含不允许的声明。")
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as exc:
        raise WeComCallbackCryptoError("企业微信回调 XML 格式无效。") from exc
    return {child.tag: (child.text or "") for child in root}


def receive_event(config: WeComApiConfig, *, signature: str, timestamp: str, nonce: str, encrypted: str) -> tuple[WeComCallbackEvent, bool]:
    xml_text = decrypt_verified_payload(
        config, signature=signature, timestamp=timestamp, nonce=nonce, encrypted=encrypted,
    )
    payload = parse_xml(xml_text)
    dedup_key = hashlib.sha256(f"{config.pk}:{signature}:{timestamp}:{nonce}:{encrypted}".encode("utf-8")).hexdigest()
    try:
        with transaction.atomic():
            event, created = WeComCallbackEvent.objects.get_or_create(
                dedup_key=dedup_key,
                defaults={
                    "config": config,
                    "msg_type": payload.get("MsgType", ""),
                    "event_type": payload.get("Event", ""),
                    "change_type": payload.get("ChangeType", ""),
                    "from_user_id": payload.get("FromUserName", payload.get("UserID", "")),
                    "to_user_name": payload.get("ToUserName", ""),
                    "event_key": payload.get("EventKey", ""),
                    "payload": payload,
                },
            )
    except IntegrityError:
        event = WeComCallbackEvent.objects.get(dedup_key=dedup_key)
        created = False
    WeComApiConfig.objects.filter(pk=config.pk).update(last_event_at=timezone.now())
    return event, created
