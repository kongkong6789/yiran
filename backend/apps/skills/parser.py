"""解析 Cursor 风格 SKILL.md 与 zip 包。"""
from __future__ import annotations

import io
import re
import zipfile
from typing import Any

from django.utils.text import slugify

FRONTMATTER_RE = re.compile(r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n", re.DOTALL)
MAX_SKILL_BYTES = 512_000
MAX_SKILL_ZIP_BYTES = 20 * 1024 * 1024
SKIP_ZIP_PREFIXES = ("__MACOSX/", ".DS_Store", "Thumbs.db")
SKIP_ZIP_SUFFIXES = (".DS_Store",)


def _parse_frontmatter_block(block: str) -> dict[str, str]:
    data: dict[str, str] = {}
    for line in block.splitlines():
        if ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            data[key] = val
    return data


def parse_skill_markdown(text: str, *, fallback_name: str = "") -> dict[str, Any]:
    text = (text or "").strip()
    if not text:
        raise ValueError("Skill 内容为空")

    name = description = ""
    instructions = text
    meta: dict[str, str] = {}

    match = FRONTMATTER_RE.match(text)
    if match:
        meta = _parse_frontmatter_block(match.group(1))
        name = meta.get("name", "").strip()
        description = meta.get("description", "").strip()
        instructions = text[match.end() :].strip()

    if not name:
        name = fallback_name.strip() or "custom-skill"
    skill_id = slugify(name, allow_unicode=True) or "custom-skill"
    if not description and instructions:
        description = instructions.splitlines()[0][:200]

    return {
        "skill_id": skill_id[:64],
        "name": name[:128],
        "description": description,
        "raw_content": text,
        "instructions": instructions,
        "meta": meta,
    }


def _normalize_zip_path(name: str) -> str:
    path = name.replace("\\", "/")
    if path.startswith("/") or re.match(r"^[A-Za-z]:/", path):
        raise ValueError("Skill 包含不安全的绝对路径")
    parts = [p for p in path.split("/") if p and p != "."]
    if any(part == ".." for part in parts):
        raise ValueError("Skill 包含不安全的上级目录路径")
    return "/".join(parts)


def _should_skip_zip_entry(name: str) -> bool:
    if not name or name.endswith("/"):
        return True
    for prefix in SKIP_ZIP_PREFIXES:
        if name.startswith(prefix) or f"/{prefix}" in name:
            return True
    for suffix in SKIP_ZIP_SUFFIXES:
        if name.endswith(suffix):
            return True
    return False


def _strip_package_root(files: list[tuple[str, bytes]], skill_md_path: str) -> list[tuple[str, bytes]]:
    """去掉 zip 内公共顶层目录,统一为 SKILL.md + scripts/… 结构。"""
    folder = skill_md_path.rsplit("/", 1)[0]
    if not folder:
        return files
    prefix = f"{folder}/"
    stripped: list[tuple[str, bytes]] = []
    for path, data in files:
        if path == skill_md_path:
            stripped.append((path.rsplit("/", 1)[-1], data))
        elif path.startswith(prefix):
            stripped.append((path[len(prefix):], data))
        else:
            stripped.append((path, data))
    return stripped


def extract_zip_package(data: bytes) -> tuple[dict[str, Any], list[tuple[str, bytes]]]:
    """从 zip 提取 SKILL.md 与全部附属文件(scripts/ 等)。"""
    if len(data) > MAX_SKILL_ZIP_BYTES:
        raise ValueError(f"zip 过大,上限 {MAX_SKILL_ZIP_BYTES // (1024 * 1024)}MB")

    files: list[tuple[str, bytes]] = []
    skill_md_path = ""

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        total_size = sum(info.file_size for info in zf.infolist() if not info.is_dir())
        if total_size > MAX_SKILL_ZIP_BYTES:
            raise ValueError(f"Skill 目录过大,上限 {MAX_SKILL_ZIP_BYTES // (1024 * 1024)}MB")
        for raw_name in zf.namelist():
            norm = _normalize_zip_path(raw_name)
            if _should_skip_zip_entry(norm):
                continue
            payload = zf.read(raw_name)
            files.append((norm, payload))
            if norm.rsplit("/", 1)[-1].lower() == "skill.md":
                if not skill_md_path or norm.count("/") < skill_md_path.count("/"):
                    skill_md_path = norm

    if not skill_md_path:
        raise ValueError("zip 中未找到 SKILL.md,请确保目录结构为: 技能名/SKILL.md + scripts/…")

    skill_bytes = next(b for p, b in files if p == skill_md_path)
    files = _strip_package_root(files, skill_md_path)
    text = skill_bytes.decode("utf-8", errors="replace")
    folder = skill_md_path.rsplit("/", 1)[0]
    fallback = folder.split("/")[-1] if folder else skill_md_path
    parsed = parse_skill_markdown(text, fallback_name=fallback)
    return parsed, files


def build_skill_folder_archive(files: list[tuple[str, bytes]]) -> tuple[str, bytes]:
    """把浏览器目录选择器提交的相对路径安全封装为 Skill zip。"""
    if not files:
        raise ValueError("请选择包含 SKILL.md 的技能文件夹")

    normalized: list[tuple[str, bytes]] = []
    seen: set[str] = set()
    total_size = 0
    for raw_path, payload in files:
        path = _normalize_zip_path(raw_path)
        if _should_skip_zip_entry(path):
            continue
        if path in seen:
            raise ValueError(f"技能文件夹包含重复路径: {path}")
        seen.add(path)
        total_size += len(payload)
        if total_size > MAX_SKILL_ZIP_BYTES:
            raise ValueError(f"Skill 目录过大,上限 {MAX_SKILL_ZIP_BYTES // (1024 * 1024)}MB")
        normalized.append((path, payload))

    if not any(path.rsplit("/", 1)[-1].lower() == "skill.md" for path, _ in normalized):
        raise ValueError("文件夹中未找到 SKILL.md,请选择完整的技能目录")

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for path, payload in normalized:
            package.writestr(path, payload)

    root = normalized[0][0].split("/", 1)[0]
    filename = f"{root if '/' in normalized[0][0] else 'skill-folder'}.zip"
    return filename, archive.getvalue()


def extract_skill_from_upload(filename: str, data: bytes) -> dict[str, Any]:
    lower = (filename or "").lower()
    if lower.endswith(".zip"):
        try:
            parsed, files = extract_zip_package(data)
        except zipfile.BadZipFile as exc:
            raise ValueError("zip 文件无效或已损坏") from exc
        return {
            **parsed,
            "package_files": files,
            "upload_kind": "package",
        }

    if len(data) > MAX_SKILL_BYTES:
        raise ValueError(f"文件过大,上限 {MAX_SKILL_BYTES // 1024}KB")

    if lower.endswith(".md") or lower.endswith(".markdown"):
        text = data.decode("utf-8", errors="replace")
        base = filename.rsplit(".", 1)[0]
        return {
            **parse_skill_markdown(text, fallback_name=base),
            "package_files": [(filename.rsplit("/", 1)[-1] or "SKILL.md", data)],
            "upload_kind": "single",
        }

    raise ValueError("仅支持 .md / .markdown / .zip(含 SKILL.md 与 scripts 等完整目录)")
