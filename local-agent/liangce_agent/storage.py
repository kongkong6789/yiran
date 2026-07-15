"""个人本地文件存储：MCP、对话、用户资料均落在用户目录下。"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import DATA_DIR


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


class UserStore:
    """单个微信用户的数据目录：~/.local/share/liangce-agent/users/{openid}/"""

    def __init__(self, openid: str):
        self.openid = openid
        self.root = DATA_DIR / "users" / openid
        self.profile_path = self.root / "profile.json"
        self.mcp_dir = self.root / "mcp"
        self.chats_dir = self.root / "chats"
        self.llm_path = self.root / "llm.json"
        self.root.mkdir(parents=True, exist_ok=True)
        self.mcp_dir.mkdir(parents=True, exist_ok=True)
        self.chats_dir.mkdir(parents=True, exist_ok=True)

    def get_profile(self) -> dict[str, Any]:
        return _read_json(self.profile_path, {})

    def save_profile(self, profile: dict[str, Any]) -> None:
        profile = {**self.get_profile(), **profile, "openid": self.openid, "updated_at": _now_iso()}
        _write_json(self.profile_path, profile)

    def read_mcp(self, server_id: str) -> dict[str, Any]:
        return _read_json(self.mcp_dir / f"{server_id}.json", {})

    def save_mcp(self, server_id: str, data: dict[str, Any]) -> dict[str, Any]:
        payload = {
            **data,
            "server_id": server_id,
            "updated_at": _now_iso(),
        }
        _write_json(self.mcp_dir / f"{server_id}.json", payload)
        return payload

    def list_chats(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for path in sorted(self.chats_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            data = _read_json(path, {})
            if data:
                rows.append({
                    "id": data.get("id") or path.stem,
                    "title": data.get("title") or "新对话",
                    "updated_at": data.get("updated_at") or _now_iso(),
                    "created_at": data.get("created_at") or _now_iso(),
                })
        return rows

    def read_chat(self, session_id: str) -> dict[str, Any]:
        return _read_json(self.chats_dir / f"{session_id}.json", {})

    def save_chat(self, session_id: str, data: dict[str, Any]) -> dict[str, Any]:
        existing = self.read_chat(session_id)
        payload = {
            **existing,
            **data,
            "id": session_id,
            "updated_at": _now_iso(),
        }
        if "created_at" not in payload:
            payload["created_at"] = _now_iso()
        _write_json(self.chats_dir / f"{session_id}.json", payload)
        return payload

    def create_chat(self, title: str = "新对话") -> dict[str, Any]:
        session_id = str(uuid.uuid4())
        return self.save_chat(session_id, {"title": title, "messages": []})

    def delete_chat(self, session_id: str) -> None:
        path = self.chats_dir / f"{session_id}.json"
        if path.exists():
            path.unlink()

    def read_llm(self) -> dict[str, str]:
        return _read_json(self.llm_path, {})

    def save_llm(self, data: dict[str, str]) -> None:
        _write_json(self.llm_path, data)


class AuthStateStore:
    """OAuth state 临时文件。"""

    def __init__(self):
        self.dir = DATA_DIR / "auth_states"
        self.dir.mkdir(parents=True, exist_ok=True)

    def create(self) -> str:
        state = uuid.uuid4().hex
        _write_json(self.dir / f"{state}.json", {"status": "pending", "created_at": _now_iso()})
        return state

    def get(self, state: str) -> dict[str, Any]:
        return _read_json(self.dir / f"{state}.json", {})

    def complete(self, state: str, user: dict[str, Any]) -> None:
        _write_json(self.dir / f"{state}.json", {"status": "ok", "user": user, "completed_at": _now_iso()})

    def fail(self, state: str, error: str) -> None:
        _write_json(self.dir / f"{state}.json", {"status": "error", "error": error})
