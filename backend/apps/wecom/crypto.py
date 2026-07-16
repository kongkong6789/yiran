from __future__ import annotations

import base64
import hashlib
import hmac
import struct

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _fernet() -> Fernet:
    configured = str(getattr(settings, "WECOM_CONFIG_ENCRYPTION_KEY", "") or "").strip()
    if configured:
        key = configured.encode("ascii")
    else:
        digest = hashlib.sha256(f"liangce-wecom:{settings.SECRET_KEY}".encode("utf-8")).digest()
        key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""


class WeComCallbackCryptoError(ValueError):
    pass


def verify_callback_signature(token: str, timestamp: str, nonce: str, encrypted: str, signature: str) -> bool:
    expected = hashlib.sha1("".join(sorted([token, timestamp, nonce, encrypted])).encode("utf-8")).hexdigest()
    return hmac.compare_digest(expected, str(signature or ""))


def decrypt_callback_message(encoding_aes_key: str, encrypted: str, expected_receive_id: str) -> str:
    try:
        aes_key = base64.b64decode(f"{encoding_aes_key}=")
        ciphertext = base64.b64decode(encrypted)
    except (ValueError, TypeError) as exc:
        raise WeComCallbackCryptoError("企业微信回调密文格式无效。") from exc
    if len(aes_key) != 32 or not ciphertext or len(ciphertext) % 16:
        raise WeComCallbackCryptoError("企业微信回调加密参数无效。")
    decryptor = Cipher(algorithms.AES(aes_key), modes.CBC(aes_key[:16])).decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    pad = padded[-1]
    if pad < 1 or pad > 32 or padded[-pad:] != bytes([pad]) * pad:
        raise WeComCallbackCryptoError("企业微信回调消息填充校验失败。")
    plain = padded[:-pad]
    if len(plain) < 20:
        raise WeComCallbackCryptoError("企业微信回调消息长度无效。")
    msg_len = struct.unpack(">I", plain[16:20])[0]
    message_end = 20 + msg_len
    if message_end > len(plain):
        raise WeComCallbackCryptoError("企业微信回调消息长度不匹配。")
    receive_id = plain[message_end:].decode("utf-8")
    if expected_receive_id and not hmac.compare_digest(receive_id, expected_receive_id):
        raise WeComCallbackCryptoError("企业微信回调 CorpID 校验失败。")
    try:
        return plain[20:message_end].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise WeComCallbackCryptoError("企业微信回调消息编码无效。") from exc
