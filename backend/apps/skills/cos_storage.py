"""腾讯云 COS 存储( Skill 仓库与通用媒体分离路径/桶 )。"""
from __future__ import annotations

import mimetypes
from typing import Any

from django.conf import settings


def cos_enabled() -> bool:
    return bool(
        getattr(settings, "USE_TENCENT_COS", False)
        and getattr(settings, "TENCENT_COS_SECRET_ID", "")
        and getattr(settings, "TENCENT_COS_SECRET_KEY", "")
    )


def _skills_bucket() -> str:
    return (
        getattr(settings, "TENCENT_COS_SKILLS_BUCKET", "")
        or getattr(settings, "TENCENT_COS_BUCKET", "")
    ).strip()


def _skills_prefix() -> str:
    prefix = (getattr(settings, "TENCENT_COS_SKILLS_LOCATION", "skills") or "skills").strip("/")
    return prefix


def _media_prefix() -> str:
    return (getattr(settings, "TENCENT_COS_LOCATION", "media") or "media").strip("/")


def _client():
    from qcloud_cos import CosConfig, CosS3Client

    region = settings.TENCENT_COS_REGION
    config = CosConfig(
        Region=region,
        SecretId=settings.TENCENT_COS_SECRET_ID,
        SecretKey=settings.TENCENT_COS_SECRET_KEY,
        Scheme=getattr(settings, "TENCENT_COS_SCHEME", "https"),
    )
    return CosS3Client(config)


def public_url(bucket: str, key: str) -> str:
    custom = (getattr(settings, "TENCENT_COS_CUSTOM_DOMAIN", "") or "").strip().rstrip("/")
    scheme = getattr(settings, "TENCENT_COS_SCHEME", "https")
    if custom and bucket == getattr(settings, "TENCENT_COS_BUCKET", ""):
        return f"{scheme}://{custom.replace('https://', '').replace('http://', '')}/{key.lstrip('/')}"
    region = settings.TENCENT_COS_REGION
    return f"{scheme}://{bucket}.cos.{region}.myqcloud.com/{key.lstrip('/')}"


def ensure_bucket(bucket: str) -> None:
    """桶不存在时尝试创建(仅 Skill 专用桶)。"""
    client = _client()
    try:
        client.head_bucket(Bucket=bucket)
        return
    except Exception:
        pass
    client.create_bucket(
        Bucket=bucket,
        ACL=getattr(settings, "TENCENT_COS_ACL", "public-read"),
    )


def build_skill_key(user_id: int, skill_id: str, filename: str = "SKILL.md") -> str:
    safe_name = filename.replace("\\", "/").lstrip("/")
    return f"{_skills_prefix()}/{user_id}/{skill_id}/{safe_name}"


def upload_skill_package(
    user_id: int,
    skill_id: str,
    files: list[tuple[str, bytes]],
) -> dict[str, Any]:
    """上传完整 Skill 包(多文件)到 COS。"""
    if not cos_enabled():
        raise RuntimeError("未启用腾讯云 COS,请配置 USE_TENCENT_COS 与密钥")

    bucket = _skills_bucket()
    if not bucket:
        raise RuntimeError("未配置 TENCENT_COS_SKILLS_BUCKET 或 TENCENT_COS_BUCKET")

    skills_bucket = getattr(settings, "TENCENT_COS_SKILLS_BUCKET", "").strip()
    if skills_bucket:
        ensure_bucket(bucket)

    client = _client()
    manifest: list[dict[str, Any]] = []
    for rel_path, payload in files:
        key = build_skill_key(user_id, skill_id, rel_path)
        content_type = mimetypes.guess_type(rel_path)[0] or "application/octet-stream"
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=payload,
            ACL=getattr(settings, "TENCENT_COS_ACL", "public-read"),
            ContentType=content_type,
        )
        manifest.append({
            "path": rel_path,
            "cos_key": key,
            "cos_url": public_url(bucket, key),
            "size": len(payload),
        })
    return {"bucket": bucket, "manifest": manifest}


def delete_skill_package(bucket: str, manifest: list[dict]) -> None:
    if not cos_enabled() or not bucket:
        return
    for item in manifest or []:
        key = item.get("cos_key") or ""
        if key:
            delete_object(bucket, key)


def upload_skill_bytes(
    user_id: int,
    skill_id: str,
    filename: str,
    data: bytes,
) -> dict[str, Any]:
    if not cos_enabled():
        raise RuntimeError("未启用腾讯云 COS,请配置 USE_TENCENT_COS 与密钥")

    bucket = _skills_bucket()
    if not bucket:
        raise RuntimeError("未配置 TENCENT_COS_SKILLS_BUCKET 或 TENCENT_COS_BUCKET")

    skills_bucket = getattr(settings, "TENCENT_COS_SKILLS_BUCKET", "").strip()
    if skills_bucket:
        ensure_bucket(bucket)

    key = build_skill_key(user_id, skill_id, filename)
    content_type = mimetypes.guess_type(filename)[0] or "text/markdown"
    client = _client()
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ACL=getattr(settings, "TENCENT_COS_ACL", "public-read"),
        ContentType=content_type,
    )
    return {
        "bucket": bucket,
        "cos_key": key,
        "cos_url": public_url(bucket, key),
        "storage": "cos",
    }


def delete_object(bucket: str, key: str) -> None:
    if not cos_enabled() or not bucket or not key:
        return
    _client().delete_object(Bucket=bucket, Key=key)


def fetch_skill_bytes(bucket: str, key: str) -> bytes:
    client = _client()
    resp = client.get_object(Bucket=bucket, Key=key)
    return resp["Body"].get_raw_stream().read()
