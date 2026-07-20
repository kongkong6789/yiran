from __future__ import annotations

import hashlib
import hmac
import re

from django.conf import settings


MOBILE_RE = re.compile(r"^\+861[3-9]\d{9}$")


def normalize_phone(phone: object) -> str:
    raw = str(phone or "").strip()
    if not raw:
        return ""
    value = re.sub(r"[\s\-().]", "", raw)
    if value.startswith("0086"):
        value = "+86" + value[4:]
    elif value.startswith("86") and not value.startswith("+86"):
        value = "+86" + value[2:]
    elif not value.startswith("+"):
        value = "+86" + value
    return value if MOBILE_RE.fullmatch(value) else ""


def hash_phone(normalized_phone: str) -> str:
    if not normalized_phone:
        return ""
    key = f"liangce-phone:{settings.SECRET_KEY}".encode("utf-8")
    return hmac.new(key, normalized_phone.encode("utf-8"), hashlib.sha256).hexdigest()


def mask_phone(phone: object) -> str:
    normalized = normalize_phone(phone)
    if not normalized:
        return "—" if not phone else "手机号格式无效"
    local = normalized[3:]
    return f"{local[:3]}****{local[-4:]}"
