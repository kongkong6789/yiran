from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


class ModuleIngestError(RuntimeError):
    def __init__(self, message: str, *, code: str = "module_ingest_error", details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}


@dataclass(frozen=True)
class ModuleUserContext:
    user_id: str
    username: str
    is_admin: bool = True


def safe_module_username(user) -> str:
    user_id = getattr(user, "id", None) or "system"
    username = str(getattr(user, "username", "") or f"user-{user_id}")
    try:
        username.encode("latin-1")
    except UnicodeEncodeError:
        return f"user-{user_id}"
    return username


def module_user_context(user) -> ModuleUserContext:
    user_id = str(getattr(user, "id", None) or "0")
    return ModuleUserContext(user_id=user_id, username=safe_module_username(user), is_admin=True)


def internal_headers(token: str, user: ModuleUserContext) -> dict[str, str]:
    return {
        "x-ff-internal-token": token,
        "x-ff-user-id": user.user_id,
        "x-ff-username": user.username,
        "x-ff-is-admin": "true" if user.is_admin else "false",
    }


def post_json(url: str, payload: dict[str, Any], *, token: str, user: ModuleUserContext, timeout: float) -> dict:
    body = json.dumps(payload).encode("utf-8")
    headers = {
        **internal_headers(token, user),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    return request_json(request, timeout=timeout)


def get_json(url: str, *, token: str, user: ModuleUserContext, timeout: float) -> dict:
    request = urllib.request.Request(
        url,
        headers={**internal_headers(token, user), "Accept": "application/json"},
        method="GET",
    )
    return request_json(request, timeout=timeout)


def request_json(request: urllib.request.Request, *, timeout: float) -> dict:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        details = _decode_json(raw)
        message = details.get("message") or details.get("detail") or raw or str(error)
        raise ModuleIngestError(message, code=f"http_{error.code}", details=details) from error
    except urllib.error.URLError as error:
        raise ModuleIngestError(str(error.reason), code="network_error") from error
    except TimeoutError as error:
        raise ModuleIngestError("Module request timed out.", code="timeout") from error

    if not data:
        return {}
    payload = _decode_json(data.decode("utf-8", errors="replace"))
    if not isinstance(payload, dict):
        raise ModuleIngestError("Module returned a non-object JSON response.", code="invalid_response")
    return payload


def _decode_json(raw: str) -> dict:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}
