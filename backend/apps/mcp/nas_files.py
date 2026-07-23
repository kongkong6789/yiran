"""NAS 文件库只读浏览服务。

目录访问严格限制在当前登录用户为 NAS MCP 配置的根目录内，避免通过相对路径
或符号链接越界读取服务器上的其他文件。
"""
from __future__ import annotations

import mimetypes
import os
import re
import sys
import ctypes
import base64
from ctypes import POINTER, Structure, byref, cast
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlencode

from django.core import signing
from django.urls import reverse

from .registry import get_def, resolve_config


MAX_ENTRIES = 500
MAX_PREVIEW_BYTES = 512 * 1024
MAX_AGENT_FILE_BYTES = 20 * 1024 * 1024
MAX_AGENT_TEXT_BYTES = 12_000
MAX_AGENT_DIRECTORY_FILES = 40
MAX_AGENT_DIRECTORY_DEPTH = 4
MAX_AGENT_DIRECTORY_TEXT_CHARS = 60_000
MAX_AGENT_DIRECTORY_IMAGES = 4
MAX_AGENT_DIRECTORY_IMAGE_BYTES = 12 * 1024 * 1024
DOWNLOAD_TICKET_SALT = "liangce.nas.file"
TEXT_EXTENSIONS = {
    ".txt", ".md", ".csv", ".json", ".jsonl", ".yaml", ".yml", ".log",
    ".ini", ".cfg", ".conf", ".py", ".js", ".jsx", ".ts", ".tsx",
    ".css", ".scss", ".html", ".htm", ".xml", ".sql", ".sh", ".ps1",
}


class NasFileError(RuntimeError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _is_unc_server_root(value: str) -> bool:
    return bool(re.fullmatch(r"\\\\[^\\/]+\\?", value.strip()))


def _configured_target(user) -> tuple[str, Path | None]:
    defn = get_def("nas")
    if not defn:
        raise NasFileError("NAS 文件库未注册", 404)

    cfg = resolve_config(defn, user=user)
    if not cfg.get("enabled", True) or not cfg.get("configured"):
        raise NasFileError("请先完成 NAS 连接设置并启用连接", 409)

    candidates: list[str] = []
    for value in reversed(cfg.get("args") or []):
        raw = str(value or "").strip()
        if not raw or raw.startswith("-") or raw.startswith("@"):
            continue
        expanded = os.path.expandvars(os.path.expanduser(raw))
        candidates.append(expanded)

    for candidate in candidates:
        if _is_unc_server_root(candidate):
            return candidate.rstrip("\\"), None
        try:
            resolved = Path(candidate).resolve(strict=True)
        except (OSError, RuntimeError):
            continue
        if resolved.is_dir():
            return str(resolved), resolved

    raise NasFileError("NAS 配置中没有可访问的网络路径，请检查连接设置", 409)


def _list_windows_shares(server: str) -> list[str]:
    """通过 Windows NetShareEnum 枚举 SMB 服务器的普通磁盘共享。"""
    if sys.platform != "win32":
        raise NasFileError("仅 Windows 服务端支持直接浏览 SMB 服务器根路径", 501)

    class SHARE_INFO_1(Structure):
        _fields_ = [
            ("shi1_netname", wintypes.LPWSTR),
            ("shi1_type", wintypes.DWORD),
            ("shi1_remark", wintypes.LPWSTR),
        ]

    netapi32 = ctypes.windll.Netapi32
    buffer = wintypes.LPBYTE()
    entries_read = wintypes.DWORD()
    total_entries = wintypes.DWORD()
    resume_handle = wintypes.DWORD()
    status_code = netapi32.NetShareEnum(
        wintypes.LPWSTR(server),
        1,
        byref(buffer),
        wintypes.DWORD(0xFFFFFFFF),
        byref(entries_read),
        byref(total_entries),
        byref(resume_handle),
    )
    try:
        if status_code not in (0, 234):
            if status_code in (5, 53, 67, 1219, 1326):
                raise NasFileError(
                    "无法读取 NAS 共享目录，请确认当前 Windows 账户已登录该 NAS 且有访问权限",
                    403,
                )
            raise NasFileError(f"枚举 NAS 共享目录失败（Windows 错误 {status_code}）", 502)

        rows = cast(buffer, POINTER(SHARE_INFO_1))
        shares = [
            rows[index].shi1_netname
            for index in range(entries_read.value)
            if rows[index].shi1_netname
            and (rows[index].shi1_type & 0xFF) == 0
            and not rows[index].shi1_netname.endswith("$")
        ]
        return sorted(set(shares), key=str.casefold)
    finally:
        if buffer:
            netapi32.NetApiBufferFree(buffer)


def _virtual_parts(virtual_path: str) -> list[str]:
    raw = str(virtual_path or "/").replace("\\", "/")
    pure = PurePosixPath(raw)
    parts = [part for part in pure.parts if part not in ("/", "", ".")]
    if any(part == ".." for part in parts):
        raise NasFileError("不允许访问 NAS 根目录之外的路径", 403)
    return parts


def _resolve_virtual_path(root: Path, virtual_path: str) -> tuple[Path, str]:
    parts = _virtual_parts(virtual_path)

    try:
        target = root.joinpath(*parts).resolve(strict=True)
        target.relative_to(root)
    except FileNotFoundError as exc:
        raise NasFileError("文件或目录不存在", 404) from exc
    except (OSError, RuntimeError, ValueError) as exc:
        raise NasFileError("不允许访问 NAS 根目录之外的路径", 403) from exc

    normalized = "/" + "/".join(parts) if parts else "/"
    return target, normalized


def _resolve_server_path(server: str, virtual_path: str) -> tuple[Path, str]:
    parts = _virtual_parts(virtual_path)
    if not parts:
        raise NasFileError("请选择一个共享文件夹", 400)

    available = {name.casefold(): name for name in _list_windows_shares(server)}
    share = available.get(parts[0].casefold())
    if not share:
        raise NasFileError("共享文件夹不存在或当前账户无权访问", 404)

    try:
        share_root = Path(f"{server}\\{share}").resolve(strict=True)
    except PermissionError as exc:
        raise NasFileError("当前 Windows 账户没有读取该共享文件夹的权限", 403) from exc
    except OSError as exc:
        raise NasFileError(f"无法打开共享文件夹：{exc}", 502) from exc

    target, _ = _resolve_virtual_path(share_root, "/" + "/".join(parts[1:]))
    normalized = "/" + "/".join([share, *parts[1:]])
    return target, normalized


def _virtual_child(parent: str, name: str) -> str:
    return f"/{name}" if parent == "/" else f"{parent.rstrip('/')}/{name}"


def _iso_time(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def _preview_kind(extension: str, mime_type: str) -> str:
    if extension in TEXT_EXTENSIONS:
        return "text"
    if mime_type.startswith("image/"):
        return "image"
    if mime_type == "application/pdf" or extension == ".pdf":
        return "pdf"
    return "none"


def create_access_ticket(user, virtual_path: str) -> str:
    user_id = getattr(user, "id", None)
    if not user_id:
        return ""
    return signing.dumps(
        {"user_id": user_id, "path": virtual_path},
        salt=DOWNLOAD_TICKET_SALT,
        compress=True,
    )


def read_access_ticket(ticket: str, max_age: int = 3600) -> dict[str, Any]:
    try:
        payload = signing.loads(ticket, salt=DOWNLOAD_TICKET_SALT, max_age=max_age)
    except signing.BadSignature as exc:
        raise NasFileError("文件链接无效或已过期，请刷新目录后重试", 403) from exc
    if not isinstance(payload, dict) or not payload.get("user_id") or not payload.get("path"):
        raise NasFileError("文件链接无效", 403)
    return payload


def _file_urls(user, virtual_path: str) -> tuple[str, str]:
    ticket = create_access_ticket(user, virtual_path)
    if not ticket:
        return "", ""
    base = reverse("mcp-server-file-download", args=["nas"])
    download_url = f"{base}?{urlencode({'ticket': ticket, 'download': '1'})}"
    preview_url = f"{base}?{urlencode({'ticket': ticket, 'download': '0'})}"
    return download_url, preview_url


def resolve_nas_path(user, virtual_path: str) -> tuple[Path, str]:
    """把用户可见的虚拟路径解析为已配置 NAS 内的真实路径。"""
    configured_path, root = _configured_target(user)
    if root is None:
        return _resolve_server_path(configured_path, virtual_path)
    return _resolve_virtual_path(root, virtual_path)


def list_directory(user, virtual_path: str = "/") -> dict[str, Any]:
    configured_path, root = _configured_target(user)
    if root is None and not _virtual_parts(virtual_path):
        shares = _list_windows_shares(configured_path)
        entries = [{
            "name": name,
            "path": f"/{name}",
            "kind": "folder",
            "size": None,
            "modified_at": "",
            "extension": "",
            "mime_type": "inode/directory",
            "previewable": False,
            "preview_kind": "none",
            "native_path": f"{configured_path}\\{name}",
            "download_url": "",
            "preview_url": "",
        } for name in shares[:MAX_ENTRIES]]
        return {
            "root_name": configured_path.removeprefix("\\\\"),
            "current_path": "/",
            "current_native_path": configured_path,
            "parent_path": None,
            "entries": entries,
            "count": len(entries),
            "truncated": len(shares) > MAX_ENTRIES,
            "read_only": True,
        }

    if root is None:
        directory, normalized = _resolve_server_path(configured_path, virtual_path)
    else:
        directory, normalized = _resolve_virtual_path(root, virtual_path)
    if not directory.is_dir():
        raise NasFileError("目标路径不是文件夹", 400)

    entries: list[dict[str, Any]] = []
    try:
        children = sorted(
            directory.iterdir(),
            key=lambda item: (not item.is_dir(), item.name.casefold()),
        )
        for child in children[:MAX_ENTRIES]:
            try:
                stat = child.stat()
                is_dir = child.is_dir()
            except (OSError, RuntimeError):
                continue
            extension = "" if is_dir else child.suffix.lower()
            mime_type = "inode/directory" if is_dir else (mimetypes.guess_type(child.name)[0] or "application/octet-stream")
            child_virtual_path = _virtual_child(normalized, child.name)
            preview_kind = "none" if is_dir else _preview_kind(extension, mime_type)
            download_url, preview_url = ("", "") if is_dir else _file_urls(user, child_virtual_path)
            entries.append({
                "name": child.name,
                "path": child_virtual_path,
                "kind": "folder" if is_dir else "file",
                "size": None if is_dir else stat.st_size,
                "modified_at": _iso_time(stat.st_mtime),
                "extension": extension,
                "mime_type": mime_type,
                "previewable": preview_kind != "none",
                "preview_kind": preview_kind,
                "native_path": str(child),
                "download_url": download_url,
                "preview_url": preview_url,
            })
    except PermissionError as exc:
        raise NasFileError("当前服务账号没有读取该目录的权限", 403) from exc
    except OSError as exc:
        raise NasFileError(f"读取 NAS 目录失败：{exc}", 500) from exc

    parent = None if normalized == "/" else str(PurePosixPath(normalized).parent)
    if parent == ".":
        parent = "/"
    return {
        "root_name": (root.name if root else configured_path.removeprefix("\\\\")) or "NAS",
        "current_path": normalized,
        "current_native_path": str(directory),
        "parent_path": parent,
        "entries": entries,
        "count": len(entries),
        "truncated": len(children) > MAX_ENTRIES,
        "read_only": True,
    }


def preview_file(user, virtual_path: str) -> dict[str, Any]:
    target, normalized = resolve_nas_path(user, virtual_path)
    if not target.is_file():
        raise NasFileError("目标路径不是文件", 400)

    stat = target.stat()
    extension = target.suffix.lower()
    mime_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    preview_kind = _preview_kind(extension, mime_type)
    download_url, preview_url = _file_urls(user, normalized)
    if preview_kind != "text":
        return {
            "name": target.name,
            "path": normalized,
            "size": stat.st_size,
            "modified_at": _iso_time(stat.st_mtime),
            "mime_type": mime_type,
            "previewable": preview_kind != "none",
            "preview_kind": preview_kind,
            "native_path": str(target),
            "download_url": download_url,
            "preview_url": preview_url,
            "content": "",
            "truncated": False,
        }

    try:
        raw = target.read_bytes()[: MAX_PREVIEW_BYTES + 1]
    except PermissionError as exc:
        raise NasFileError("当前服务账号没有读取该文件的权限", 403) from exc
    except OSError as exc:
        raise NasFileError(f"读取 NAS 文件失败：{exc}", 500) from exc

    truncated = len(raw) > MAX_PREVIEW_BYTES
    raw = raw[:MAX_PREVIEW_BYTES]
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("gb18030", errors="replace")
    return {
        "name": target.name,
        "path": normalized,
        "size": stat.st_size,
        "modified_at": _iso_time(stat.st_mtime),
        "mime_type": mime_type,
        "previewable": True,
        "preview_kind": "text",
        "native_path": str(target),
        "download_url": download_url,
        "preview_url": preview_url,
        "content": content,
        "truncated": truncated,
    }


def _reference_candidates(message: str, configured_path: str) -> list[str]:
    text = str(message or "")
    candidates: list[str] = []
    for value in re.findall(r"`([^`]+)`", text):
        value = value.strip()
        if value.startswith(("\\\\", "/")) or value.lower().startswith("nas:"):
            candidates.append(value)

    server = configured_path.rstrip("\\/")
    server_index = text.casefold().find(server.casefold())
    if server_index >= 0:
        tail = text[server_index:].splitlines()[0]
        tail = re.split(r"[，。；;]", tail, maxsplit=1)[0].strip()
        candidates.append(tail)

    for value in re.findall(r"(?:NAS|nas)\s*[:：]\s*([^\r\n]+)", text):
        value = re.split(r"[，。；;]", value, maxsplit=1)[0].strip()
        if value:
            candidates.append(value)

    unique: list[str] = []
    for value in candidates:
        cleaned = value.strip().strip("`'\"“”‘’")
        if cleaned and cleaned not in unique:
            unique.append(cleaned)
    return unique[:3]


def _reference_to_virtual(configured_path: str, root: Path | None, reference: str) -> str:
    raw = reference.strip().strip("`'\"“”‘’")
    if raw.lower().startswith("nas:"):
        raw = raw[4:].strip()
    if root is None:
        server = configured_path.rstrip("\\")
        if raw.casefold().startswith(server.casefold()):
            raw = raw[len(server):]
        return "/" + "/".join(_virtual_parts(raw))

    if raw.startswith(("/", "\\")) and not raw.startswith("\\\\"):
        # POSIX native paths and NAS virtual paths both start with ``/``.  Prefer
        # a real path inside the configured root when one was pasted, then fall
        # back to the user-facing virtual-path interpretation (for example
        # ``/合同/条款.txt``).  ``relative_to`` keeps either form confined to the
        # configured NAS root, including after symlink resolution.
        try:
            candidate = Path(raw).resolve(strict=True)
            relative = candidate.relative_to(root)
        except (OSError, RuntimeError, ValueError):
            pass
        else:
            return "/" + "/".join(relative.parts)
        return "/" + "/".join(_virtual_parts(raw))
    try:
        candidate = Path(raw).resolve(strict=True)
        relative = candidate.relative_to(root)
    except (OSError, RuntimeError, ValueError) as exc:
        raise NasFileError("NAS 路径不在当前账号配置的文件库内", 403) from exc
    return "/" + "/".join(relative.parts)


def _agent_file_item(
    user,
    target: Path,
    normalized: str,
    *,
    text_limit: int = MAX_AGENT_TEXT_BYTES,
    include_image: bool = True,
) -> dict[str, Any]:
    stat = target.stat()
    mime_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    extension = target.suffix.lower()
    download_url, preview_url = _file_urls(user, normalized)
    item: dict[str, Any] = {
        "name": target.name,
        "path": normalized,
        "native_path": str(target),
        "size": stat.st_size,
        "mime": mime_type,
        "download_url": download_url,
        "preview_url": preview_url,
        "has_text": False,
        "text": "",
        "is_image": mime_type.startswith("image/"),
        "stored_path": str(target),
    }
    if stat.st_size > MAX_AGENT_FILE_BYTES:
        return item
    if extension in TEXT_EXTENSIONS and text_limit > 0:
        raw = target.read_bytes()
        try:
            decoded = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            decoded = raw.decode("gb18030", errors="replace")
        item["text"] = decoded[: min(text_limit, MAX_AGENT_TEXT_BYTES)]
        item["has_text"] = bool(item["text"])
    elif item["is_image"] and include_image:
        raw = target.read_bytes()
        item["image_base64"] = base64.b64encode(raw).decode("ascii")
        item["data_url"] = f"data:{mime_type};base64,{item['image_base64']}"
    return item


def _agent_directory_payload(user, target: Path, normalized: str) -> tuple[str, list[dict[str, Any]]]:
    """受控读取目录树，避免大目录无限占用 NAS I/O 和模型上下文。"""
    files: list[dict[str, Any]] = []
    text_chars = 0
    image_count = 0
    image_bytes = 0
    truncated = False
    skipped: list[str] = []
    base_target = target.resolve(strict=True)

    def on_walk_error(error: OSError) -> None:
        skipped.append(str(error))

    stop = False
    for current_root, dirnames, filenames in os.walk(base_target, onerror=on_walk_error):
        current = Path(current_root)
        try:
            depth = len(current.relative_to(base_target).parts)
        except ValueError:
            continue
        dirnames.sort(key=str.casefold)
        filenames.sort(key=str.casefold)
        if depth >= MAX_AGENT_DIRECTORY_DEPTH:
            if dirnames:
                truncated = True
            dirnames[:] = []

        for filename in filenames:
            if len(files) >= MAX_AGENT_DIRECTORY_FILES:
                truncated = True
                stop = True
                break
            child = current / filename
            try:
                resolved_child = child.resolve(strict=True)
                resolved_child.relative_to(base_target)
                relative = resolved_child.relative_to(base_target)
                child_virtual = f"{normalized.rstrip('/')}/{relative.as_posix()}"
                stat = resolved_child.stat()
                mime_type = mimetypes.guess_type(resolved_child.name)[0] or "application/octet-stream"
                can_include_image = (
                    mime_type.startswith("image/")
                    and image_count < MAX_AGENT_DIRECTORY_IMAGES
                    and image_bytes + stat.st_size <= MAX_AGENT_DIRECTORY_IMAGE_BYTES
                )
                item = _agent_file_item(
                    user,
                    resolved_child,
                    child_virtual,
                    text_limit=max(0, MAX_AGENT_DIRECTORY_TEXT_CHARS - text_chars),
                    include_image=can_include_image,
                )
            except (OSError, RuntimeError, ValueError) as exc:
                skipped.append(f"{child}: {exc}")
                continue
            text_chars += len(item.get("text") or "")
            if item.get("image_base64"):
                image_count += 1
                image_bytes += int(item.get("size") or 0)
            files.append(item)
        if stop:
            break

    summary = [
        f"### NAS 目录: {target}",
        f"已扫描 {len(files)} 个文件（最多 {MAX_AGENT_DIRECTORY_FILES} 个、{MAX_AGENT_DIRECTORY_DEPTH} 层子目录）。",
    ]
    if truncated:
        summary.append("目录内容已达到读取上限；需要更多文件时，请提供更具体的子目录路径。")
    if skipped:
        summary.append(f"有 {len(skipped)} 个项目因权限或路径问题跳过。")
    blocks = ["\n".join(summary)]
    for item in files:
        relative_label = item["path"][len(normalized.rstrip("/")):].lstrip("/") or item["name"]
        blocks.append(
            f"### 目录内文件: {relative_label} ({item['size']} bytes, {item['mime']})\n"
            + (item.get("text") or "该文件已提供路径与下载链接，当前类型不做文本抽取。")
        )
    return "\n\n".join(blocks), files


def read_nas_for_agent(user, message: str) -> dict[str, Any]:
    """按消息中的明确 NAS 路径读取目录或文件，供对话 Agent 注入上下文。"""
    text = str(message or "")
    try:
        configured_path, root = _configured_target(user)
    except NasFileError:
        return {"attempted": False, "content": "", "files": [], "error": ""}

    mentions_nas = "nas" in text.casefold() or "网络盘" in text or configured_path.casefold() in text.casefold()
    if not mentions_nas:
        return {"attempted": False, "content": "", "files": [], "error": ""}

    references = _reference_candidates(text, configured_path)
    if not references:
        return {
            "attempted": True,
            "content": "",
            "files": [],
            "error": "请提供完整 NAS 路径，例如 `\\\\192.168.0.188\\共享目录\\文件名`",
        }

    blocks: list[str] = []
    files: list[dict[str, Any]] = []
    errors: list[str] = []
    for reference in references:
        try:
            virtual_path = _reference_to_virtual(configured_path, root, reference)
            target, normalized = resolve_nas_path(user, virtual_path)
            if target.is_dir():
                directory_content, directory_files = _agent_directory_payload(user, target, normalized)
                blocks.append(directory_content)
                files.extend(directory_files)
                continue

            item = _agent_file_item(user, target, normalized)
            files.append(item)
            blocks.append(
                f"### NAS 文件: {target} ({item['size']} bytes)\n"
                + (item["text"] or "该文件可获取，但当前类型不做文本抽取。")
            )
        except (NasFileError, OSError) as exc:
            errors.append(f"{reference}: {exc}")

    return {
        "attempted": True,
        "content": "\n\n".join(blocks),
        "files": files,
        "error": "；".join(errors),
    }
