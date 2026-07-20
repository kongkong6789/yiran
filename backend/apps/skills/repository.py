"""Skill 仓库与个人 Skill 业务逻辑。"""
from __future__ import annotations

import os
import shutil
from copy import deepcopy
from pathlib import Path

from django.conf import settings
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
    """共享技能仓库：全员可见；按 skill_id 去重，取最新一条。"""
    if shared or user is None:
        rows = list(
            SkillAsset.objects.filter(visibility=SkillAsset.Visibility.SHARED)
            .select_related("uploader")
            .order_by("-updated_at")
        )
        seen: set[str] = set()
        unique: list[SkillAsset] = []
        for row in rows:
            if row.skill_id in seen:
                continue
            seen.add(row.skill_id)
            unique.append(row)
        return unique
    return list(SkillAsset.objects.filter(uploader=user).order_by("-updated_at"))


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


def ensure_shared_skills_for_user(user) -> list[UserSkill]:
    """把共享仓库里的 Skill 自动启用到当前用户，其他人打开对话即可看到。"""
    if user is None or not getattr(user, "is_authenticated", False):
        return []
    owned = {
        row.skill_id
        for row in UserSkill.objects.filter(user=user).only("skill_id")
    }
    created: list[UserSkill] = []
    for asset in list_skill_assets(shared=True):
        if asset.skill_id in owned:
            continue
        try:
            created.append(materialize_user_skill(user, asset))
        except Exception:
            continue
    return created


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
    if asset.package_kind == "package" and manifest:
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
    visibility: str = SkillAsset.Visibility.SHARED,
    skill_id_override: str | None = None,
) -> tuple[SkillAsset, UserSkill | None]:
    extracted = extract_skill_from_upload(filename, data)
    parsed = {k: v for k, v in extracted.items() if k not in {"package_files", "upload_kind"}}
    package_files: list[tuple[str, bytes]] = extracted.get("package_files") or []
    upload_kind = extracted.get("upload_kind") or "single"
    if visibility not in SkillAsset.Visibility.values:
        raise ValueError("Skill 可见范围无效")
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

        asset, _ = SkillAsset.objects.update_or_create(
            uploader=user,
            skill_id=skill_id,
            defaults={
                "name": parsed["name"],
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
        personal = materialize_user_skill(user, asset) if adopt else None
        return asset, personal

    # 未启用 COS:写入本地工作区
    manifest, skill_md_key = _write_local_package(user.id, skill_id, package_files)
    package_kind = "package" if len(package_files) > 1 else "single"
    asset, _ = SkillAsset.objects.update_or_create(
        uploader=user,
        skill_id=skill_id,
        defaults={
            "name": parsed["name"],
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
    personal = materialize_user_skill(user, asset) if adopt else None
    return asset, personal


def skill_asset_storage_snapshot(asset: SkillAsset) -> dict:
    return {
        "uploader_id": asset.uploader_id,
        "skill_id": asset.skill_id,
        "cos_bucket": asset.cos_bucket,
        "cos_key": asset.cos_key,
        "package_kind": asset.package_kind,
        "package_manifest": deepcopy(asset.package_manifest or []),
    }


def _remove_local_skill_paths(snapshot: dict) -> None:
    user_id = int(snapshot.get("uploader_id") or 0)
    if user_id <= 0:
        return
    workspace = Path(
        getattr(settings, "SKILLS_WORKSPACE_ROOT", settings.BASE_DIR / "skill_workspaces")
    ).resolve()
    user_root = (workspace / str(user_id)).resolve()
    local_files: list[Path] = []
    for item in snapshot.get("package_manifest") or []:
        raw_path = item.get("local_path") or ""
        if not raw_path:
            continue
        path = Path(raw_path).resolve()
        try:
            path.relative_to(user_root)
        except ValueError:
            continue
        local_files.append(path)
        if path.is_file() or path.is_symlink():
            path.unlink(missing_ok=True)

    for path in local_files:
        parent = path.parent
        while parent != user_root and user_root in parent.parents:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent

    skill_id = str(snapshot.get("skill_id") or "")
    legacy_root = (user_root / skill_id).resolve() if skill_id else user_root
    if legacy_root != user_root and user_root in legacy_root.parents and legacy_root.exists():
        shutil.rmtree(legacy_root, ignore_errors=True)


def delete_skill_storage(snapshot: dict) -> None:
    try:
        manifest = snapshot.get("package_manifest") or []
        bucket = str(snapshot.get("cos_bucket") or "")
        if snapshot.get("package_kind") == "package" and manifest:
            delete_skill_package(bucket, manifest)
        elif bucket and snapshot.get("cos_key"):
            delete_object(bucket, str(snapshot["cos_key"]))
    finally:
        _remove_local_skill_paths(snapshot)


def delete_skill_asset(user, skill_id: str) -> None:
    asset = SkillAsset.objects.filter(uploader=user, skill_id=skill_id).first()
    if not asset:
        return
    delete_skill_storage(skill_asset_storage_snapshot(asset))
    asset.delete()
