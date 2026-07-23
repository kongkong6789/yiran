"""对话附件：保存、文本抽取与图片 vision 准备。"""
from __future__ import annotations

import base64
import mimetypes
import os
import re
import tempfile
import uuid
import warnings
from io import BytesIO
from pathlib import Path

from django.conf import settings

from .document_io import (
    DOWNLOAD_ONLY_EXTENSIONS,
    READABLE_DOCUMENT_EXTENSIONS,
    SPREADSHEET_EXTENSIONS,
    TEXT_EXTENSIONS,
    extract_document,
    is_supported_non_image_name,
)

MAX_ATTACH_BYTES = 20 * 1024 * 1024
MAX_ATTACH_FILES = 5
MAX_ATTACH_TOTAL_BYTES = 50 * 1024 * 1024
UPLOAD_READ_CHUNK_BYTES = 64 * 1024
MAX_IMAGE_DIMENSION = 16_384
MAX_IMAGE_PIXELS = 25_000_000
MAX_IMAGE_FRAMES = 100
MAX_IMAGE_TOTAL_FRAME_PIXELS = 50_000_000
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
DOC_EXTENSIONS = READABLE_DOCUMENT_EXTENSIONS | DOWNLOAD_ONLY_EXTENSIONS
IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}


def attachments_root(user_id: int) -> Path:
    base = Path(getattr(settings, "CHAT_ATTACHMENTS_ROOT", settings.BASE_DIR / "chat_attachments"))
    return base / str(user_id)


def _normalized_mime(mime: str) -> str:
    value = str(mime or "").split(";", 1)[0].strip().casefold()
    if value == "image/jpg":
        return "image/jpeg"
    return value


def _looks_like_image(name: str, mime: str = "") -> bool:
    ext = Path((name or "").casefold()).suffix
    declared = _normalized_mime(mime)
    if ext == ".svg" or declared == "image/svg+xml":
        raise ValueError("暂不支持 SVG 图片，请转换为 PNG、JPEG、GIF、WEBP 或 BMP")
    if declared.startswith("image/") and ext not in IMAGE_EXTENSIONS:
        raise ValueError(f"文件 {name} 的扩展名与声明的图片 MIME 类型不一致")
    return ext in IMAGE_EXTENSIONS


def _sniff_image_mime(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    if data.startswith(b"BM"):
        return "image/bmp"
    return None


def _validated_image_mime(name: str, mime: str, data: bytes) -> str:
    extension = Path((name or "").casefold()).suffix
    declared = _normalized_mime(mime)
    if extension == ".svg" or declared == "image/svg+xml":
        raise ValueError("暂不支持 SVG 图片，请转换为 PNG、JPEG、GIF、WEBP 或 BMP")
    if extension not in IMAGE_EXTENSIONS:
        raise ValueError(f"文件 {name} 缺少受支持的图片扩展名")
    detected = _sniff_image_mime(data)
    if detected is None:
        raise ValueError(f"文件 {name} 的图片内容与格式不匹配")
    expected = IMAGE_MIME.get(extension)
    if expected and expected != detected:
        raise ValueError(f"文件 {name} 的扩展名与真实图片格式不匹配")
    if declared and declared != "application/octet-stream" and declared != detected:
        raise ValueError(f"文件 {name} 的声明 MIME 与真实图片格式不匹配")

    try:
        from PIL import Image, UnidentifiedImageError

        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                width, height = image.size
                frame_count = int(getattr(image, "n_frames", 1) or 1)
                decoded_format = str(image.format or "").upper()
                expected_format = {
                    "image/png": "PNG",
                    "image/jpeg": "JPEG",
                    "image/gif": "GIF",
                    "image/webp": "WEBP",
                    "image/bmp": "BMP",
                }[detected]
                if decoded_format != expected_format:
                    raise ValueError(f"文件 {name} 的图片解码格式不一致")
                if (
                    width <= 0
                    or height <= 0
                    or width > MAX_IMAGE_DIMENSION
                    or height > MAX_IMAGE_DIMENSION
                    or width * height > MAX_IMAGE_PIXELS
                ):
                    raise ValueError(f"文件 {name} 的图片尺寸或像素总量超过安全上限")
                if (
                    frame_count > MAX_IMAGE_FRAMES
                    or width * height * frame_count > MAX_IMAGE_TOTAL_FRAME_PIXELS
                ):
                    raise ValueError(f"文件 {name} 的动画帧数或总像素量超过安全上限")
                image.verify()

            # ``verify`` checks the container. Reopen and decode every bounded
            # frame as well so a valid magic header with truncated/corrupt
            # payload cannot reach the vision provider.
            with Image.open(BytesIO(data)) as image:
                for frame_index in range(frame_count):
                    image.seek(frame_index)
                    image.load()
    except ImportError as exc:
        raise ValueError("图片校验组件尚未安装，暂时无法安全读取图片") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, EOFError) as exc:
        raise ValueError(f"文件 {name} 的图片内容损坏或不完整") from exc
    except Image.DecompressionBombError as exc:
        raise ValueError(f"文件 {name} 的图片像素总量超过安全上限") from exc
    return detected


def _atomic_copy_upload(
    path: Path,
    upload,
    *,
    batch_bytes_before: int,
) -> int:
    """Copy an upload with bounded reads; never allocate an unbounded read()."""
    temporary_path: Path | None = None
    written = 0
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=".upload-",
            dir=path.parent,
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            try:
                upload.seek(0)
            except (AttributeError, OSError):
                pass
            while True:
                chunk = upload.read(UPLOAD_READ_CHUNK_BYTES)
                if not chunk:
                    break
                if not isinstance(chunk, (bytes, bytearray, memoryview)):
                    raise ValueError("上传附件返回了无效的二进制内容")
                written += len(chunk)
                if written > MAX_ATTACH_BYTES:
                    raise ValueError(
                        f"文件 {getattr(upload, 'name', 'file')} "
                        f"超过 {MAX_ATTACH_BYTES // (1024 * 1024)}MB 上限"
                    )
                if batch_bytes_before + written > MAX_ATTACH_TOTAL_BYTES:
                    raise ValueError(
                        f"本批附件总大小超过 "
                        f"{MAX_ATTACH_TOTAL_BYTES // (1024 * 1024)}MB 上限"
                    )
                temporary.write(chunk)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
        return written
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _safe_storage_name(name: str) -> str:
    cleaned = re.sub(r"[\x00-\x1f/:*?\"<>|]+", "_", str(name or "file")).strip(" .")
    suffix = Path(cleaned).suffix[:20]
    stem = Path(cleaned).stem or "file"
    while stem and len(f"{stem}{suffix}".encode("utf-8")) > 180:
        stem = stem[:-1]
    return f"{stem or 'file'}{suffix}"


def process_uploaded_files(files, user_id: int) -> list[dict]:
    """保存上传文件并返回元数据、文本或图片 base64。"""
    if not files:
        return []
    if len(files) > MAX_ATTACH_FILES:
        raise ValueError(f"最多上传 {MAX_ATTACH_FILES} 个附件")

    root = attachments_root(user_id)
    root.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    written_paths: list[Path] = []
    total_bytes = 0

    try:
        for upload in files:
            name = (getattr(upload, "name", "") or "file").replace("\\", "/").split("/")[-1]
            mime = getattr(upload, "content_type", "") or ""
            declared_size = getattr(upload, "size", None)
            if isinstance(declared_size, int) and declared_size > MAX_ATTACH_BYTES:
                raise ValueError(
                    f"文件 {name} 超过 {MAX_ATTACH_BYTES // (1024 * 1024)}MB 上限"
                )
            if (
                isinstance(declared_size, int)
                and total_bytes + declared_size > MAX_ATTACH_TOTAL_BYTES
            ):
                raise ValueError(
                    f"本批附件总大小超过 {MAX_ATTACH_TOTAL_BYTES // (1024 * 1024)}MB 上限"
                )

            image_candidate = _looks_like_image(name, mime)
            if not image_candidate and not is_supported_non_image_name(name):
                raise ValueError(
                    f"暂不支持文件类型: {name}，"
                    "请上传图片、文本、代码、PDF、Office、RTF 或 ZIP 等常见附件"
                )

            # The original display name remains in metadata.  Keep the physical
            # basename bounded so a valid upload cannot exceed filesystem limits.
            stored_name = _safe_storage_name(name)
            stored = f"{uuid.uuid4().hex}_{stored_name}"
            path = root / stored
            file_size = _atomic_copy_upload(
                path,
                upload,
                batch_bytes_before=total_bytes,
            )
            written_paths.append(path)
            total_bytes += file_size
            data = path.read_bytes()
            image_mime = _validated_image_mime(name, mime, data) if image_candidate else ""

            item = {
                "id": stored,
                "name": name,
                "size": file_size,
                "mime": image_mime
                or mime
                or mimetypes.guess_type(name)[0]
                or "application/octet-stream",
                "text": "",
                "has_text": False,
                "is_image": image_candidate,
                "is_file": not image_candidate,
                "stored_path": str(path),
                "url": f"/api/agent/attachments/{stored}",
                "extraction_status": "image" if image_candidate else "pending",
                "extraction_error": "",
                "truncated": False,
                "metadata": {},
            }
            if image_candidate:
                item["data_url"] = (
                    f"data:{image_mime};base64,"
                    + base64.b64encode(data).decode("ascii")
                )
                item["metadata"] = {
                    "parser": "vision",
                    "validated_mime": image_mime,
                }
            else:
                item.update(extract_document(name, data).attachment_fields())

            results.append(item)
        return results
    except Exception:
        for path in written_paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def load_stored_attachments(items: list[dict], user_id: int) -> list[dict]:
    """从可信的用户附件目录恢复模型所需文本或图片数据。"""
    loaded: list[dict] = []
    total_bytes = 0
    for raw in (items or [])[:MAX_ATTACH_FILES]:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        stored_id = str(item.get("id") or "")
        path = resolve_attachment_path(user_id, stored_id)
        if path is None:
            item.update({
                "text": "（附件文件不可用或已删除，无法读取内容。）",
                "has_text": True,
                "extraction_status": "error",
                "extraction_error": "附件文件不可用或已删除",
                "truncated": False,
                "metadata": {},
                "image_base64": "",
                "data_url": "",
            })
            loaded.append(item)
            continue

        path_size = path.stat().st_size
        if path_size > MAX_ATTACH_BYTES:
            item.update({
                "text": "（附件超过读取上限，无法解析内容。）",
                "has_text": True,
                "extraction_status": "error",
                "extraction_error": "附件超过读取上限",
                "truncated": False,
                "metadata": {"size": path.stat().st_size},
                "image_base64": "",
                "data_url": "",
            })
            loaded.append(item)
            continue

        total_bytes += path_size
        if total_bytes > MAX_ATTACH_TOTAL_BYTES:
            item.update({
                "text": "（本批附件超过总读取上限，无法解析该文件。）",
                "has_text": True,
                "extraction_status": "error",
                "extraction_error": "本批附件超过总读取上限",
                "truncated": False,
                "metadata": {"size": path_size},
                "image_base64": "",
                "data_url": "",
            })
            loaded.append(item)
            continue

        data = path.read_bytes()
        name = str(item.get("name") or path.name)
        mime = str(item.get("mime") or mimetypes.guess_type(name)[0] or "application/octet-stream")
        try:
            image_candidate = _looks_like_image(name, mime)
        except ValueError as exc:
            detail = str(exc)
            item.update({
                "name": name,
                "size": len(data),
                "mime": mime,
                "is_image": False,
                "is_file": True,
                "stored_path": str(path),
                "text": f"（{detail}）",
                "has_text": True,
                "extraction_status": "error",
                "extraction_error": detail,
                "truncated": False,
                "metadata": {"parser": "image_validation"},
                "image_base64": "",
                "data_url": "",
            })
            loaded.append(item)
            continue
        item.update({
            "name": name,
            "size": len(data),
            "mime": mime,
            "is_image": image_candidate,
            "is_file": not image_candidate,
            "stored_path": str(path),
            "text": "",
            "has_text": False,
            "extraction_status": "image" if image_candidate else "pending",
            "extraction_error": "",
            "truncated": False,
            "metadata": {},
        })
        if image_candidate:
            try:
                image_mime = _validated_image_mime(name, mime, data)
            except ValueError as exc:
                detail = str(exc)
                item.update({
                    "text": f"（{detail}）",
                    "has_text": True,
                    "is_image": False,
                    "is_file": True,
                    "extraction_status": "error",
                    "extraction_error": detail,
                    "metadata": {"parser": "image_validation"},
                    "image_base64": "",
                    "data_url": "",
                })
                loaded.append(item)
                continue
            item.update({
                "mime": image_mime,
                "image_base64": "",
                "data_url": (
                    f"data:{image_mime};base64,"
                    + base64.b64encode(data).decode("ascii")
                ),
                "metadata": {"parser": "vision", "validated_mime": image_mime},
            })
        else:
            item.update(extract_document(name, data).attachment_fields())
        loaded.append(item)
    return loaded


def format_attachment_context(attachments: list[dict]) -> str:
    if not attachments:
        return ""
    parts = ["【用户上传附件】"]
    for item in attachments:
        parts.append(f"\n### 文件: {item.get('name', 'file')} ({item.get('size', 0)} bytes)")
        if item.get("is_image"):
            parts.append("[解析状态: 已验证图片，将随消息发送给视觉模型]")
            continue
        status = str(item.get("extraction_status") or "")
        error = str(item.get("extraction_error") or "").strip()
        status_label = {
            "success": "解析成功",
            "truncated": "解析成功，但内容已截断",
            "unsupported": "不支持自动解析",
            "encrypted": "文件已加密，无法解析",
            "scanned": "未提取到文字，可能是扫描件并需要 OCR",
            "empty": "未发现可读取文本",
            "error": "解析失败或文件损坏",
        }.get(status, "解析状态未知")
        parts.append(f"[解析状态: {status_label}]")
        if error:
            parts.append(f"[解析说明: {error}]")
        text = (item.get("text") or "").strip()
        if text:
            parts.append(text)
        else:
            parts.append("(未向模型提供该文件的正文内容。)")
    return "\n".join(parts)


def vision_image_parts(attachments: list[dict]) -> list[dict]:
    """组装 OpenAI 兼容 vision content parts。"""
    parts: list[dict] = []
    for item in attachments:
        if not item.get("is_image"):
            continue
        data_url = item.get("data_url")
        if not data_url and item.get("image_base64"):
            mime = item.get("mime") or "image/jpeg"
            data_url = f"data:{mime};base64,{item['image_base64']}"
        if not data_url:
            continue
        parts.append({
            "type": "image_url",
            "image_url": {"url": data_url},
        })
    return parts


def attachment_public_meta(items: list[dict]) -> list[dict]:
    return [
        {
            "id": item.get("id"),
            "name": item.get("name"),
            "size": item.get("size"),
            "mime": item.get("mime"),
            "has_text": item.get("has_text"),
            "is_image": bool(item.get("is_image")),
            "is_file": bool(item.get("is_file") or not item.get("is_image")),
            "url": item.get("url") or "",
            "extraction_status": item.get("extraction_status") or "",
            "extraction_error": item.get("extraction_error") or "",
            "truncated": bool(item.get("truncated")),
            "metadata": item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
        }
        for item in items
    ]


def resolve_attachment_path(user_id: int, stored_id: str) -> Path | None:
    safe = (stored_id or "").replace("\\", "/").split("/")[-1]
    if not safe or ".." in safe:
        return None
    root = attachments_root(user_id)
    candidate = root / safe
    if candidate.is_symlink():
        return None
    try:
        resolved_root = root.resolve()
        path = candidate.resolve(strict=True)
        path.relative_to(resolved_root)
    except (FileNotFoundError, OSError, RuntimeError, ValueError):
        return None
    if path.is_file():
        return path
    return None


def resolve_attachment_path_any(stored_id: str) -> Path | None:
    """管理员跨用户查找附件。"""
    safe = (stored_id or "").replace("\\", "/").split("/")[-1]
    if not safe or ".." in safe:
        return None
    root = Path(getattr(settings, "CHAT_ATTACHMENTS_ROOT", settings.BASE_DIR / "chat_attachments"))
    if not root.exists():
        return None
    for child in root.iterdir():
        if child.is_symlink() or not child.is_dir():
            continue
        candidate = child / safe
        if candidate.is_symlink():
            continue
        try:
            path = candidate.resolve(strict=True)
            path.relative_to(child.resolve())
        except (FileNotFoundError, OSError, RuntimeError, ValueError):
            continue
        if path.is_file():
            return path
    return None
