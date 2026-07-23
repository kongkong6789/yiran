"""Skill 仓库与个人 Skill 业务逻辑。"""
from __future__ import annotations

import os
import hashlib
import json
import shutil
import uuid
from copy import deepcopy
from pathlib import Path, PurePosixPath

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
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
    base_existed = base.exists()
    write_base = base
    if base_existed:
        write_base = base.with_name(f".{base.name}-write-{uuid.uuid4().hex}")
    manifest: list[dict] = []
    skill_md_key = ""
    try:
        for rel_path, payload in files:
            dest = write_base / rel_path.replace("/", os.sep)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(payload)
            entry = {
                "path": rel_path,
                "cos_key": "",
                "cos_url": "",
                "size": len(payload),
                "local_path": str(base / rel_path.replace("/", os.sep)),
            }
            manifest.append(entry)
            if rel_path.lower().endswith("skill.md"):
                skill_md_key = rel_path
    except Exception:
        shutil.rmtree(write_base, ignore_errors=True)
        raise

    if base_existed:
        backup = base.with_name(f".{base.name}-backup-{uuid.uuid4().hex}")
        base.rename(backup)
        try:
            write_base.rename(base)
        except Exception:
            backup.rename(base)
            shutil.rmtree(write_base, ignore_errors=True)
            raise
        shutil.rmtree(backup, ignore_errors=True)
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
            visibility_filter |= Q(uploader=user) | Q(owner=user)
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


class SkillFileConflictError(ValueError):
    """The file changed after the caller loaded the editor."""


TEXT_FILE_SUFFIXES = {
    ".md", ".markdown", ".txt", ".py", ".js", ".ts", ".tsx", ".jsx",
    ".json", ".yaml", ".yml", ".toml", ".sh", ".ps1", ".css", ".html",
    ".csv", ".xml", ".ini", ".cfg",
}
MAX_EDITABLE_SKILL_FILE_BYTES = 512 * 1024


def normalize_skill_file_path(raw_path: str) -> str:
    value = str(raw_path or "").replace("\\", "/").strip().lstrip("/")
    path = PurePosixPath(value)
    if (
        not value
        or value.startswith("/")
        or "\x00" in value
        or any(part in {"", ".", ".."} for part in path.parts)
        or len(value) > 300
    ):
        raise ValueError("技能文件路径无效")
    return path.as_posix()


def asset_file_manifest(asset: SkillAsset) -> list[dict]:
    rows = []
    for item in asset.package_manifest or []:
        path = normalize_skill_file_path(item.get("path") or "")
        suffix = PurePosixPath(path).suffix.lower()
        size = int(item.get("size") or 0)
        rows.append({
            "path": path,
            "size": size,
            "editable": suffix in TEXT_FILE_SUFFIXES and size <= MAX_EDITABLE_SKILL_FILE_BYTES,
        })
    return sorted(rows, key=lambda row: (row["path"].count("/"), row["path"].casefold()))


def _manifest_item(asset: SkillAsset, file_path: str) -> dict | None:
    normalized = normalize_skill_file_path(file_path)
    return next(
        (item for item in (asset.package_manifest or []) if normalize_skill_file_path(item.get("path") or "") == normalized),
        None,
    )


def read_asset_file_bytes(asset: SkillAsset, file_path: str) -> bytes:
    item = _manifest_item(asset, file_path)
    if not item:
        raise FileNotFoundError(file_path)
    if asset.cos_bucket and cos_enabled():
        key = str(item.get("cos_key") or "")
        if not key:
            raise FileNotFoundError(file_path)
        return fetch_skill_bytes(asset.cos_bucket, key)
    local_path = str(item.get("local_path") or "")
    if not local_path:
        local_path = str(_local_skill_root(asset.uploader_id, asset.skill_id) / normalize_skill_file_path(file_path))
    path = Path(local_path).resolve()
    root = _local_skill_root(asset.uploader_id, asset.skill_id).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("技能文件路径越界") from exc
    if not path.is_file():
        raise FileNotFoundError(file_path)
    return path.read_bytes()


def read_asset_text_file(asset: SkillAsset, file_path: str) -> str:
    normalized = normalize_skill_file_path(file_path)
    suffix = PurePosixPath(normalized).suffix.lower()
    if suffix not in TEXT_FILE_SUFFIXES:
        raise ValueError("该文件类型不支持在线查看或编辑")
    data = read_asset_file_bytes(asset, normalized)
    if len(data) > MAX_EDITABLE_SKILL_FILE_BYTES:
        raise ValueError("文件超过 512KB，不能在线编辑")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("文件不是 UTF-8 文本，不能在线编辑") from exc


def _sync_adopted_skill_content(asset: SkillAsset, file_path: str, content: str) -> None:
    skill_md_path = normalize_skill_file_path(asset.skill_md_key or "SKILL.md")
    if normalize_skill_file_path(file_path).casefold() != skill_md_path.casefold():
        return
    parsed = parse_skill_markdown(content, fallback_name=asset.name)
    asset.name = parsed["name"] or asset.name
    asset.description = parsed.get("description") or ""
    asset.instructions_preview = (parsed["instructions"] or "")[:500]
    UserSkill.objects.filter(source_asset=asset).update(
        name=asset.name,
        description=asset.description,
        raw_content=parsed["raw_content"],
        instructions=parsed["instructions"],
        updated_at=timezone.now(),
    )


@transaction.atomic
def save_asset_text_file(
    asset: SkillAsset,
    file_path: str,
    content: str,
    *,
    expected_updated_at: str = "",
) -> SkillAsset:
    # 只锁 SkillAsset 本身；owner 是可空外键，PostgreSQL 不允许对外连接的可空侧 FOR UPDATE。
    locked = SkillAsset.objects.select_for_update().get(id=asset.id)
    current_version = locked.updated_at.isoformat()
    if expected_updated_at and expected_updated_at != current_version:
        raise SkillFileConflictError("技能已被其他人更新，请刷新后再保存")

    normalized = normalize_skill_file_path(file_path)
    suffix = PurePosixPath(normalized).suffix.lower()
    if suffix not in TEXT_FILE_SUFFIXES:
        raise ValueError("该文件类型不支持在线编辑")
    payload = str(content).encode("utf-8")
    if len(payload) > MAX_EDITABLE_SKILL_FILE_BYTES:
        raise ValueError("文件超过 512KB，不能在线保存")

    manifest = deepcopy(locked.package_manifest or [])
    item = next(
        (entry for entry in manifest if normalize_skill_file_path(entry.get("path") or "") == normalized),
        None,
    )
    if locked.cos_bucket and cos_enabled():
        stored = upload_skill_bytes(locked.uploader_id, locked.skill_id, normalized, payload)
        next_entry = {
            "path": normalized,
            "cos_key": stored["cos_key"],
            "cos_url": stored["cos_url"],
            "size": len(payload),
        }
    else:
        root = _local_skill_root(locked.uploader_id, locked.skill_id).resolve()
        target = (root / normalized.replace("/", os.sep)).resolve()
        try:
            target.relative_to(root)
        except ValueError as exc:
            raise ValueError("技能文件路径越界") from exc
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_name(f".{target.name}-{uuid.uuid4().hex}.tmp")
        temporary.write_bytes(payload)
        temporary.replace(target)
        next_entry = {
            "path": normalized,
            "cos_key": "",
            "cos_url": "",
            "size": len(payload),
            "local_path": str(target),
        }
    if item is None:
        manifest.append(next_entry)
    else:
        item.clear()
        item.update(next_entry)

    locked.package_manifest = manifest
    locked.package_kind = "package" if len(manifest) > 1 else "single"
    locked.file_size = sum(int(entry.get("size") or 0) for entry in manifest)
    locked.content_hash = hashlib.sha256(
        json.dumps(
            [{"path": entry.get("path"), "size": entry.get("size")} for entry in manifest],
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8") + payload
    ).hexdigest()
    locked.source_verified = False
    metadata = dict(locked.source_metadata or {})
    metadata["local_edit"] = True
    metadata["verification_status"] = "modified"
    locked.source_metadata = metadata
    if normalized.casefold().endswith("skill.md") and not locked.skill_md_key:
        locked.skill_md_key = normalized
    _sync_adopted_skill_content(locked, normalized, str(content))
    locked.save()
    return locked


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
    rollback_storage_on_failure: bool = False,
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

    asset_defaults = {
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
        "file_size": sum(len(b) for _, b in package_files) or len(data),
        "instructions_preview": (parsed["instructions"] or "")[:500],
    }

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

        storage_snapshot = {
            "uploader_id": user.id,
            "skill_id": skill_id,
            "cos_bucket": stored["bucket"],
            "cos_key": stored["cos_key"],
            "package_kind": package_kind,
            "package_manifest": manifest,
        }
        try:
            asset, created = SkillAsset.objects.update_or_create(
                uploader=user,
                skill_id=skill_id,
                defaults={
                    **asset_defaults,
                    "cos_bucket": stored["bucket"],
                    "cos_key": stored["cos_key"],
                    "cos_url": stored["cos_url"],
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
        except Exception:
            if rollback_storage_on_failure:
                try:
                    delete_skill_storage(storage_snapshot)
                except Exception:
                    pass
            raise

    # 未启用 COS:写入本地工作区
    manifest, skill_md_key = _write_local_package(user.id, skill_id, package_files)
    package_kind = "package" if len(package_files) > 1 else "single"
    storage_snapshot = {
        "uploader_id": user.id,
        "skill_id": skill_id,
        "cos_bucket": "",
        "cos_key": skill_md_key or "SKILL.md",
        "package_kind": package_kind,
        "package_manifest": manifest,
    }
    try:
        asset, created = SkillAsset.objects.update_or_create(
            uploader=user,
            skill_id=skill_id,
            defaults={
                **asset_defaults,
                "cos_bucket": "",
                "cos_key": skill_md_key or "SKILL.md",
                "cos_url": "",
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
    except Exception:
        if rollback_storage_on_failure:
            try:
                delete_skill_storage(storage_snapshot)
            except Exception:
                pass
        raise


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
    UserSkill.objects.filter(source_asset=asset).delete()
    asset.delete()
