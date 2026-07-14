"""对话附件：保存、文本抽取与图片 vision 准备。"""
from __future__ import annotations

import base64
import json
import mimetypes
import uuid
from pathlib import Path

from django.conf import settings

MAX_ATTACH_BYTES = 20 * 1024 * 1024
MAX_ATTACH_FILES = 5
TEXT_EXTENSIONS = {
    ".md", ".markdown", ".txt", ".json", ".csv", ".py", ".log",
    ".yaml", ".yml", ".xml", ".html", ".htm", ".tsv",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
# 协作/对话可下载的二进制附件（不做文本解析）
DOC_EXTENSIONS = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".rar", ".7z", ".tar", ".gz",
    ".mp3", ".wav", ".mp4", ".mov", ".avi",
    ".apk", ".ipa",
}
IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}
MAX_TEXT_INJECT = 12_000


def attachments_root(user_id: int) -> Path:
    base = Path(getattr(settings, "CHAT_ATTACHMENTS_ROOT", settings.BASE_DIR / "chat_attachments"))
    return base / str(user_id)


def _decode_text(data: bytes) -> str:
    for enc in ("utf-8", "utf-8-sig", "gbk", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _extract_text(name: str, data: bytes) -> str:
    lower = name.lower()
    ext = Path(lower).suffix
    if ext not in TEXT_EXTENSIONS:
        return ""
    text = _decode_text(data)
    if ext == ".json":
        try:
            obj = json.loads(text)
            text = json.dumps(obj, ensure_ascii=False, indent=2)
        except json.JSONDecodeError:
            pass
    return text[:MAX_TEXT_INJECT]


def _is_image(name: str, mime: str = "") -> bool:
    ext = Path((name or "").lower()).suffix
    if ext in IMAGE_EXTENSIONS:
        return True
    return (mime or "").lower().startswith("image/")


def _image_mime(name: str, mime: str = "") -> str:
    if mime and mime.startswith("image/"):
        return mime
    ext = Path((name or "").lower()).suffix
    return IMAGE_MIME.get(ext) or mimetypes.guess_type(name)[0] or "image/jpeg"


def process_uploaded_files(files, user_id: int) -> list[dict]:
    """保存上传文件并返回元数据、文本或图片 base64。"""
    if not files:
        return []
    if len(files) > MAX_ATTACH_FILES:
        raise ValueError(f"最多上传 {MAX_ATTACH_FILES} 个附件")

    root = attachments_root(user_id)
    root.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []

    for upload in files:
        name = (getattr(upload, "name", "") or "file").replace("\\", "/").split("/")[-1]
        mime = getattr(upload, "content_type", "") or ""
        data = upload.read()
        if len(data) > MAX_ATTACH_BYTES:
            raise ValueError(f"文件 {name} 超过 {MAX_ATTACH_BYTES // (1024 * 1024)}MB 上限")

        ext = Path(name.lower()).suffix
        is_image = _is_image(name, mime)
        is_text = ext in TEXT_EXTENSIONS
        is_doc = ext in DOC_EXTENSIONS
        if not is_image and not is_text and not is_doc:
            raise ValueError(
                f"暂不支持文件类型: {name}，"
                "请上传图片、文本(json/md/csv 等)或常见附件(pdf/office/zip 等)"
            )

        stored = f"{uuid.uuid4().hex}_{name}"
        path = root / stored
        path.write_bytes(data)

        item = {
            "id": stored,
            "name": name,
            "size": len(data),
            "mime": mime or (_image_mime(name) if is_image else (mimetypes.guess_type(name)[0] or "application/octet-stream")),
            "text": "",
            "has_text": False,
            "is_image": is_image,
            "is_file": not is_image,
            "stored_path": str(path),
            "url": f"/api/agent/attachments/{stored}",
        }
        if is_image:
            img_mime = _image_mime(name, mime)
            item["mime"] = img_mime
            item["image_base64"] = base64.b64encode(data).decode("ascii")
            item["data_url"] = f"data:{img_mime};base64,{item['image_base64']}"
        elif is_text:
            text = _extract_text(name, data)
            item["text"] = text
            item["has_text"] = bool(text)

        results.append(item)
    return results


def format_attachment_context(attachments: list[dict]) -> str:
    if not attachments:
        return ""
    parts = ["【用户上传附件】"]
    for item in attachments:
        parts.append(f"\n### 文件: {item.get('name', 'file')} ({item.get('size', 0)} bytes)")
        if item.get("is_image"):
            parts.append("(图片已随消息发送给视觉模型,请直接根据图像内容回答)")
            continue
        text = (item.get("text") or "").strip()
        if text:
            parts.append(text)
        else:
            parts.append("(该文件类型暂不支持自动解析,已记录文件名与大小)")
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
        }
        for item in items
    ]


def resolve_attachment_path(user_id: int, stored_id: str) -> Path | None:
    safe = (stored_id or "").replace("\\", "/").split("/")[-1]
    if not safe or ".." in safe:
        return None
    path = attachments_root(user_id) / safe
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
        if not child.is_dir():
            continue
        path = child / safe
        if path.is_file():
            return path
    return None
