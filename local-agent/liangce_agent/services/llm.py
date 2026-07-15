"""LLM 调用（无 Django 依赖）。"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from .. import config
from ..storage import UserStore


def _resolve_llm(user_store: UserStore | None = None) -> dict[str, str]:
    personal = user_store.read_llm() if user_store else {}
    return {
        "api_key": personal.get("api_key") or config.LLM_API_KEY,
        "base_url": personal.get("base_url") or config.LLM_BASE_URL,
        "model": personal.get("model") or config.LLM_MODEL,
    }


def llm_available(user_store: UserStore | None = None) -> bool:
    return bool(_resolve_llm(user_store).get("api_key"))


def chat_messages(
    system: str,
    messages: list[dict[str, str]],
    *,
    user_store: UserStore | None = None,
    temperature: float = 0.7,
    max_tokens: int = 900,
    timeout: int = 60,
) -> str:
    cfg = _resolve_llm(user_store)
    if not cfg["api_key"]:
        return ""

    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    payload_messages = [{"role": "system", "content": system}]
    for item in messages[-20:]:
        role = item.get("role", "user")
        if role not in {"user", "assistant", "system"}:
            role = "user"
        content = (item.get("content") or "").strip()
        if content:
            payload_messages.append({"role": role, "content": content})

    body = json.dumps({
        "model": cfg["model"],
        "messages": payload_messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {cfg['api_key']}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"].strip()
    except (urllib.error.URLError, KeyError, json.JSONDecodeError, TimeoutError):
        return ""
