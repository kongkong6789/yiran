"""个人头像的腾讯云 COS 存储封装。"""
from __future__ import annotations

import io
import mimetypes
from dataclasses import dataclass

from django.conf import settings


COS_MARKER = "cos:"


class AvatarStorageError(RuntimeError):
    pass


@dataclass(frozen=True)
class StoredAvatar:
    token: str
    key: str


def enabled() -> bool:
    return bool(
        getattr(settings, "USE_TENCENT_COS", False)
        and getattr(settings, "TENCENT_COS_SECRET_ID", "")
        and getattr(settings, "TENCENT_COS_SECRET_KEY", "")
        and getattr(settings, "TENCENT_COS_BUCKET", "")
    )


def _bucket() -> str:
    return str(getattr(settings, "TENCENT_COS_BUCKET", "") or "").strip()


def _prefix() -> str:
    return str(getattr(settings, "TENCENT_COS_AVATAR_LOCATION", "media/avatars") or "media/avatars").strip("/")


def _client():
    from qcloud_cos import CosConfig, CosS3Client

    return CosS3Client(CosConfig(
        Region=settings.TENCENT_COS_REGION,
        SecretId=settings.TENCENT_COS_SECRET_ID,
        SecretKey=settings.TENCENT_COS_SECRET_KEY,
        Scheme=getattr(settings, "TENCENT_COS_SCHEME", "https"),
    ))


def is_cos_token(value: str) -> bool:
    return str(value or "").startswith(COS_MARKER)


def key_from_token(token: str) -> str:
    if not is_cos_token(token):
        raise AvatarStorageError("头像对象标识无效")
    filename = token[len(COS_MARKER):]
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise AvatarStorageError("头像对象标识无效")
    return f"{_prefix()}/{filename}"


def upload(filename: str, payload: bytes, *, content_type: str = "") -> StoredAvatar:
    if not enabled():
        raise AvatarStorageError("头像对象存储尚未配置")
    token = f"{COS_MARKER}{filename}"
    key = key_from_token(token)
    mime = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    try:
        _client().put_object(
            Bucket=_bucket(),
            Key=key,
            Body=payload,
            ContentType=mime,
            ACL=getattr(settings, "TENCENT_COS_AVATAR_ACL", "private"),
        )
    except Exception as exc:
        raise AvatarStorageError("头像上传到对象存储失败") from exc
    return StoredAvatar(token=token, key=key)


def fetch(token: str) -> tuple[io.BytesIO, str, int]:
    if not enabled():
        raise AvatarStorageError("头像对象存储尚未配置")
    key = key_from_token(token)
    try:
        response = _client().get_object(Bucket=_bucket(), Key=key)
        payload = response["Body"].get_raw_stream().read()
    except Exception as exc:
        raise AvatarStorageError("头像对象读取失败") from exc
    mime = str(response.get("Content-Type") or mimetypes.guess_type(key)[0] or "image/png")
    return io.BytesIO(payload), mime, len(payload)


def delete(token: str) -> None:
    if not enabled() or not is_cos_token(token):
        return
    try:
        _client().delete_object(Bucket=_bucket(), Key=key_from_token(token))
    except Exception as exc:
        raise AvatarStorageError("旧头像对象删除失败") from exc
