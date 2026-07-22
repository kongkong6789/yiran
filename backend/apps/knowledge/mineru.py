from __future__ import annotations

import json
import mimetypes
import time
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePath

import requests
from django.conf import settings

from apps.skills.cos_storage import cos_enabled, upload_media_bytes


class MineruParseError(ValueError):
    def __init__(self, message: str, code: str = "mineru_parse_error"):
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class MineruMarkdownResult:
    markdown: bytes
    metadata: dict


def _setting(name: str, default=None):
    return getattr(settings, name, default)


def _require_config() -> tuple[str, str]:
    token = (_setting("MINERU_API_TOKEN", "") or "").strip()
    base_url = (_setting("MINERU_API_BASE_URL", "https://mineru.net") or "https://mineru.net").strip().rstrip("/")
    if not token:
        raise MineruParseError("MINERU_API_TOKEN is not configured.", "config_error")
    if not cos_enabled():
        raise MineruParseError("Tencent COS must be enabled before MinerU parsing.", "config_error")
    return token, base_url


def _source_key(filename: str, document_id: str | None) -> str:
    safe_name = PurePath(filename).name.strip() or "upload.bin"
    safe_name = "".join(char if char.isalnum() or char in {".", "_", "-", " ", "(", ")"} else "_" for char in safe_name)
    prefix = (document_id or "knowledge-upload").strip().replace("\\", "/").strip("/") or "knowledge-upload"
    return f"knowledge/mineru/source/{prefix}/{int(time.time() * 1000)}-{safe_name[:160]}"


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


def _task_id(payload: dict) -> str:
    data = payload.get("data") if isinstance(payload, dict) else None
    candidates = [
        payload.get("task_id") if isinstance(payload, dict) else None,
        payload.get("taskId") if isinstance(payload, dict) else None,
        data.get("task_id") if isinstance(data, dict) else None,
        data.get("taskId") if isinstance(data, dict) else None,
        data.get("id") if isinstance(data, dict) else None,
    ]
    for candidate in candidates:
        if candidate:
            return str(candidate)
    raise MineruParseError("MinerU did not return a task id.", "mineru_response_error")


def _response_data(payload: dict) -> dict:
    data = payload.get("data") if isinstance(payload, dict) else None
    return data if isinstance(data, dict) else payload


def _status(data: dict) -> str:
    for key in ("state", "status", "task_status", "taskStatus"):
        value = data.get(key)
        if value:
            return str(value).lower()
    return ""


def _download_url(data: dict) -> str:
    for key in ("full_zip_url", "fullZipUrl", "zip_url", "zipUrl", "download_url", "downloadUrl"):
        value = data.get(key)
        if value:
            return str(value)
    artifacts = data.get("artifacts")
    if isinstance(artifacts, dict):
        for key in ("full_zip_url", "zip_url", "download_url"):
            value = artifacts.get(key)
            if value:
                return str(value)
    return ""


def _submit_task(*, token: str, base_url: str, source_url: str, filename: str) -> str:
    payload = {
        "url": source_url,
        "model_version": _setting("MINERU_MODEL_VERSION", "vlm"),
        "language": _setting("MINERU_LANGUAGE", "ch"),
        "is_ocr": True,
        "enable_formula": True,
        "enable_table": True,
        "filename": filename,
    }
    endpoint = f"{base_url}/api/v4/extract/task"
    response = requests.post(
        endpoint,
        headers=_headers(token),
        data=json.dumps(payload),
        timeout=float(_setting("MINERU_REQUEST_TIMEOUT_SECONDS", 60)),
    )
    if response.status_code >= 400:
        raise MineruParseError(f"MinerU submit failed: HTTP {response.status_code}", "mineru_submit_error")
    return _task_id(response.json())


def _wait_for_zip_url(*, token: str, base_url: str, task_id: str) -> tuple[str, dict]:
    timeout_seconds = float(_setting("MINERU_POLL_TIMEOUT_SECONDS", 1200))
    interval_seconds = float(_setting("MINERU_POLL_INTERVAL_SECONDS", 5))
    deadline = time.monotonic() + timeout_seconds
    endpoint = f"{base_url}/api/v4/extract/task/{task_id}"
    while time.monotonic() < deadline:
        response = requests.get(
            endpoint,
            headers=_headers(token),
            timeout=float(_setting("MINERU_REQUEST_TIMEOUT_SECONDS", 60)),
        )
        if response.status_code >= 400:
            raise MineruParseError(f"MinerU status failed: HTTP {response.status_code}", "mineru_status_error")
        payload = response.json()
        data = _response_data(payload)
        status = _status(data)
        zip_url = _download_url(data)
        if zip_url:
            return zip_url, data
        if status in {"failed", "fail", "error", "canceled", "cancelled"}:
            message = data.get("message") or data.get("error") or "MinerU task failed."
            raise MineruParseError(str(message), "mineru_task_failed")
        time.sleep(max(1.0, interval_seconds))
    raise MineruParseError("MinerU parse timed out.", "mineru_timeout")


def _extract_full_markdown(archive: bytes) -> bytes:
    try:
        with zipfile.ZipFile(BytesIO(archive)) as zf:
            names = zf.namelist()
            preferred = [name for name in names if name.lower().endswith("/full.md") or name.lower() == "full.md"]
            markdown_names = preferred or [name for name in names if name.lower().endswith(".md")]
            if not markdown_names:
                raise MineruParseError("MinerU result did not include Markdown.", "mineru_response_error")
            markdown = zf.read(markdown_names[0])
    except zipfile.BadZipFile as error:
        raise MineruParseError("MinerU result archive is invalid.", "mineru_response_error") from error
    if not markdown.strip():
        raise MineruParseError("MinerU returned empty Markdown.", "mineru_empty_result")
    return markdown


def parse_to_markdown(*, filename: str, content: bytes, document_id: str | None = None) -> MineruMarkdownResult:
    token, base_url = _require_config()
    key = _source_key(filename, document_id)
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    uploaded = upload_media_bytes(key, content, content_type=content_type)
    source_url = uploaded["cos_url"]
    task_id = _submit_task(token=token, base_url=base_url, source_url=source_url, filename=filename)
    zip_url, task_metadata = _wait_for_zip_url(token=token, base_url=base_url, task_id=task_id)
    response = requests.get(zip_url, timeout=float(_setting("MINERU_DOWNLOAD_TIMEOUT_SECONDS", 180)))
    if response.status_code >= 400:
        raise MineruParseError(f"MinerU result download failed: HTTP {response.status_code}", "mineru_download_error")
    markdown = _extract_full_markdown(response.content)
    return MineruMarkdownResult(
        markdown=markdown,
        metadata={
            "task_id": task_id,
            "source": uploaded,
            "zip_url": zip_url,
            "task": task_metadata,
            "markdown_size": len(markdown),
            "parser": "mineru",
        },
    )
