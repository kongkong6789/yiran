"""Skill 仓库与个人 Skill 业务逻辑。"""
from __future__ import annotations

import os
from pathlib import Path

from django.conf import settings
from django.db.models import Q
from django.utils.text import slugify

from .cos_storage import (
    cos_enabled,
    delete_object,
    delete_skill_package,
    fetch_skill_bytes,
    upload_skill_bytes,
    upload_skill_package,
)
from .models import SkillAsset, UserSkill
from .parser import extract_skill_from_upload, parse_skill_markdown


def _local_skill_root(user_id: int, skill_id: str) -> Path:
    root = Path(getattr(settings, "SKILLS_WORKSPACE_ROOT", settings.BASE_DIR / "skill_workspaces"))
    return root / str(user_id) / skill_id


def _write_local_package(user_id: int, skill_id: str, files: list[tuple[str, bytes]]) -> tuple[list[dict], str]:
    base = _local_skill_root(user_id, skill_id)
    if base.exists():
        for p in sorted(base.rglob("*"), reverse=True):
            if p.is_file():
                p.unlink()
            elif p.is_dir():
                p.rmdir()
    manifest: list[dict] = []
    skill_md_key = ""
    for rel_path, payload in files:
        dest = base / rel_path.replace("/", os.sep)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(payload)
        entry = {
            "path": rel_path,
            "cos_key": "",
            "cos_url": "",
            "size": len(payload),
            "local_path": str(dest),
        }
        manifest.append(entry)
        if rel_path.lower().endswith("skill.md"):
            skill_md_key = rel_path
    return manifest, skill_md_key


def _asset_payload(row: SkillAsset) -> dict:
    return {
        "id": row.id,
        "skill_id": row.skill_id,
        "category": row.category,
        "visibility": row.visibility,
        "name": row.name,
        "description": row.description,
        "original_filename": row.original_filename,
        "cos_bucket": row.cos_bucket,
        "cos_key": row.cos_key,
        "cos_url": row.cos_url,
        "file_size": row.file_size,
        "instructions_preview": row.instructions_preview,
        "package_kind": row.package_kind,
        "package_file_count": len(row.package_manifest or []),
        "has_scripts": any(
            (item.get("path") or "").startswith("scripts/")
            for item in (row.package_manifest or [])
        ),
        "storage": "cos" if row.cos_bucket else "local",
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def list_skill_assets(user=None, *, shared: bool = True) -> list[SkillAsset]:
    """列出共享技能以及当前用户自己的私有技能，并按 skill_id 去重。"""
    if shared or user is None:
        visibility_filter = Q(visibility=SkillAsset.Visibility.SHARED)
        if user is not None:
            visibility_filter |= Q(uploader=user)
        rows = list(
            SkillAsset.objects.filter(visibility_filter)
            .select_related("uploader", "owner")
            .order_by("-updated_at")
        )
        if user is not None:
            rows.sort(key=lambda row: (row.uploader_id == user.id, row.updated_at), reverse=True)
        seen: set[str] = set()
        unique: list[SkillAsset] = []
        for row in rows:
            if row.skill_id in seen:
                continue
            seen.add(row.skill_id)
            unique.append(row)
        return unique
    return list(SkillAsset.objects.filter(uploader=user).select_related("uploader", "owner").order_by("-updated_at"))


def find_shared_asset(skill_id: str) -> SkillAsset | None:
    return (
        SkillAsset.objects.filter(
            skill_id=skill_id,
            visibility=SkillAsset.Visibility.SHARED,
        )
        .select_related("uploader")
        .order_by("-updated_at")
        .first()
    )


def _skill_md_from_manifest(asset: SkillAsset) -> tuple[str, bytes]:
    manifest = asset.package_manifest or []
    skill_key = asset.skill_md_key or asset.cos_key
    for item in manifest:
        path = item.get("path") or ""
        if path.lower().endswith("skill.md"):
            skill_key = item.get("cos_key") or skill_key
            break
    if cos_enabled() and asset.cos_bucket and skill_key:
        return skill_key, fetch_skill_bytes(asset.cos_bucket, skill_key)
    # 本地工作区的单文件与完整包都通过 manifest 保存实际路径。
    # 统一回读，避免单文件上传后立即采用时找不到刚写入的 SKILL.md。
    if manifest:
        local_path = ""
        for item in manifest:
            if (item.get("path") or "").lower().endswith("skill.md"):
                local_path = item.get("local_path") or ""
                break
        if local_path and Path(local_path).is_file():
            return skill_key, Path(local_path).read_bytes()
    if asset.cos_bucket and asset.cos_key and cos_enabled():
        return asset.cos_key, fetch_skill_bytes(asset.cos_bucket, asset.cos_key)
    return "", b""


def load_asset_content(asset: SkillAsset) -> str:
    _, data = _skill_md_from_manifest(asset)
    if not data:
        return ""
    return data.decode("utf-8", errors="replace")


def materialize_user_skill(user, asset: SkillAsset) -> UserSkill:
    """从 COS 仓库启用到个人 Skill 列表。"""
    content = load_asset_content(asset)
    parsed = parse_skill_markdown(content, fallback_name=asset.name)
    row, _ = UserSkill.objects.update_or_create(
        user=user,
        skill_id=asset.skill_id,
        defaults={
            "name": parsed["name"] or asset.name,
            "description": parsed.get("description") or asset.description,
            "raw_content": parsed["raw_content"],
            "instructions": parsed["instructions"],
            "source_asset": asset,
            "enabled": True,
        },
    )
    return row


def save_skill_asset_from_bytes(
    user,
    filename: str,
    data: bytes,
    *,
    adopt: bool = False,
    visibility: str = SkillAsset.Visibility.PRIVATE,
    category: str = SkillAsset.Category.GENERAL,
    skill_id_override: str | None = None,
    source: str = SkillAsset.Source.UPLOAD,
    source_url: str = "",
    source_version: str = "",
    source_verified: bool = False,
    source_metadata: dict | None = None,
    content_hash: str = "",
) -> tuple[SkillAsset, UserSkill | None]:
    extracted = extract_skill_from_upload(filename, data)
    parsed = {k: v for k, v in extracted.items() if k not in {"package_files", "upload_kind"}}
    package_files: list[tuple[str, bytes]] = extracted.get("package_files") or []
    upload_kind = extracted.get("upload_kind") or "single"
    if visibility not in SkillAsset.Visibility.values:
        raise ValueError("Skill 可见范围无效")
    if category not in SkillAsset.Category.values:
        raise ValueError("能力分类无效")
    if source not in SkillAsset.Source.values:
        raise ValueError("Skill 来源无效")
    skill_id = parsed["skill_id"]
    if skill_id_override is not None:
        skill_id = slugify(skill_id_override, allow_unicode=False)[:64]
        if not skill_id:
            raise ValueError("Skill ID 无效")

    skill_md_key = ""
    for path, _ in package_files:
        if path.lower().endswith("skill.md"):
            skill_md_key = path
            break

    if cos_enabled():
        if upload_kind == "package" and len(package_files) > 1:
            uploaded = upload_skill_package(user.id, skill_id, package_files)
            manifest = uploaded["manifest"]
            stored = {
                "bucket": uploaded["bucket"],
                "cos_key": "",
                "cos_url": "",
            }
            primary = next(
                (m for m in manifest if (m.get("path") or "").lower().endswith("skill.md")),
                manifest[0],
            )
            stored["cos_key"] = primary.get("cos_key", "")
            stored["cos_url"] = primary.get("cos_url", "")
            package_kind = "package"
        else:
            single_name = package_files[0][0] if package_files else "SKILL.md"
            stored = upload_skill_bytes(user.id, skill_id, single_name, package_files[0][1] if package_files else data)
            manifest = [{
                "path": single_name,
                "cos_key": stored["cos_key"],
                "cos_url": stored["cos_url"],
                "size": len(package_files[0][1]) if package_files else len(data),
            }]
            skill_md_key = single_name
            package_kind = "single"

        asset, created = SkillAsset.objects.update_or_create(
            uploader=user,
            skill_id=skill_id,
            defaults={
                "name": parsed["name"],
                "source": source,
                "source_url": source_url,
                "source_version": source_version,
                "source_verified": source_verified,
                "source_metadata": source_metadata or {},
                "content_hash": content_hash,
                "category": category,
                "visibility": visibility,
                "description": parsed.get("description") or "",
                "original_filename": filename.rsplit("/", 1)[-1] or "SKILL.md",
                "cos_bucket": stored["bucket"],
                "cos_key": stored["cos_key"],
                "cos_url": stored["cos_url"],
                "file_size": sum(len(b) for _, b in package_files) or len(data),
                "instructions_preview": (parsed["instructions"] or "")[:500],
                "package_kind": package_kind,
                "package_manifest": manifest,
                "skill_md_key": skill_md_key or stored["cos_key"],
            },
        )
        if created or asset.owner_id is None:
            asset.owner = user
            asset.save(update_fields=["owner"])
        personal = materialize_user_skill(user, asset) if adopt else None
        return asset, personal

    # 未启用 COS:写入本地工作区
    manifest, skill_md_key = _write_local_package(user.id, skill_id, package_files)
    package_kind = "package" if len(package_files) > 1 else "single"
    asset, created = SkillAsset.objects.update_or_create(
        uploader=user,
        skill_id=skill_id,
        defaults={
            "name": parsed["name"],
            "source": source,
            "source_url": source_url,
            "source_version": source_version,
            "source_verified": source_verified,
            "source_metadata": source_metadata or {},
            "content_hash": content_hash,
            "category": category,
            "visibility": visibility,
            "description": parsed.get("description") or "",
            "original_filename": filename.rsplit("/", 1)[-1] or "SKILL.md",
            "cos_bucket": "",
            "cos_key": skill_md_key or "SKILL.md",
            "cos_url": "",
            "file_size": sum(len(b) for _, b in package_files) or len(data),
            "instructions_preview": (parsed["instructions"] or "")[:500],
            "package_kind": package_kind,
            "package_manifest": manifest,
            "skill_md_key": skill_md_key or "SKILL.md",
        },
    )
    if created or asset.owner_id is None:
        asset.owner = user
        asset.save(update_fields=["owner"])
    personal = materialize_user_skill(user, asset) if adopt else None
    return asset, personal


def delete_skill_asset(user, skill_id: str) -> None:
    asset = SkillAsset.objects.filter(uploader=user, skill_id=skill_id).first()
    if not asset:
        return
    if asset.package_kind == "package" and asset.package_manifest:
        delete_skill_package(asset.cos_bucket, asset.package_manifest)
    elif asset.cos_bucket and asset.cos_key:
        delete_object(asset.cos_bucket, asset.cos_key)
    local_root = _local_skill_root(user.id, skill_id)
    if local_root.exists():
        import shutil
        shutil.rmtree(local_root, ignore_errors=True)
    UserSkill.objects.filter(source_asset=asset).delete()
    asset.delete()
