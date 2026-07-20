from __future__ import annotations

import hashlib
import json
import secrets
import time
from typing import Any

import requests
from django.core.cache import cache

from .models import WeComCliConfig


class WeComCliError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class WeComCliClient:
    """服务端复用企业微信官方 wecom-cli 的 MCP 协议，配置按企业隔离。"""

    CONFIG_URL = "https://qyapi.weixin.qq.com/cgi-bin/aibot/cli/get_mcp_config"
    MCP_HEADERS = {"Accept": "application/json", "Content-Type": "application/json"}

    def __init__(self, config: WeComCliConfig):
        if not config.configured:
            raise WeComCliError("not_configured", "当前企业尚未配置企业微信待办机器人。", status_code=409)
        self.config = config

    def _cache_key(self) -> str:
        return f"wecom-cli:todo-url:{self.config.pk}:{int(self.config.updated_at.timestamp())}"

    def _todo_url(self, *, refresh: bool = False) -> str:
        key = self._cache_key()
        if not refresh:
            cached = cache.get(key)
            if cached:
                return str(cached)
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(12)
        signature = hashlib.sha256(
            f"{self.config.bot_secret}{self.config.bot_id}{timestamp}{nonce}".encode("utf-8")
        ).hexdigest()
        try:
            response = requests.post(
                self.CONFIG_URL,
                json={
                    "bot_id": self.config.bot_id,
                    "time": timestamp,
                    "nonce": nonce,
                    "signature": signature,
                    "bind_source": 1,
                    "cli_version": "WeComCLI/0.1.0 distribution/liangce-server",
                },
                timeout=15,
                headers={"User-Agent": "WeComCLI/0.1.0 distribution/liangce-server"},
            )
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise WeComCliError("network_error", "企业微信待办服务暂时不可用，请稍后重试。") from exc
        if response.status_code >= 400 or int(payload.get("errcode", 0) or 0) != 0:
            raise WeComCliError(str(payload.get("errcode") or response.status_code), "机器人凭据无效或尚未开通待办权限。")
        entries = payload.get("list") or payload.get("mcp_config_list") or payload.get("config_list") or payload.get("data") or []
        if isinstance(entries, dict):
            entries = entries.get("list") or entries.get("mcp_config_list") or []
        todo = next((item for item in entries if str(item.get("biz_type") or "").lower() == "todo"), None)
        if not todo or not todo.get("url"):
            raise WeComCliError("todo_not_enabled", "该企业微信机器人尚未开通待办能力。", status_code=409)
        if todo.get("is_authed") is False:
            raise WeComCliError("todo_not_authorized", "该机器人还未授权企业微信待办能力。", status_code=403)
        cache.set(key, todo["url"], 3600)
        return str(todo["url"])

    def call(self, method: str, arguments: dict[str, Any]) -> dict[str, Any]:
        body = {
            "jsonrpc": "2.0",
            "id": secrets.token_hex(8),
            "method": "tools/call",
            "params": {"name": method, "arguments": arguments},
        }
        response = None
        payload: dict[str, Any] = {}
        for attempt in range(2):
            try:
                response = requests.post(
                    self._todo_url(refresh=attempt == 1),
                    json=body,
                    timeout=30,
                    headers=self.MCP_HEADERS,
                )
                payload = response.json()
            except (requests.RequestException, ValueError) as exc:
                raise WeComCliError("network_error", "企业微信待办服务暂时不可用，请稍后重试。") from exc
            # 官方 MCP 地址可能过期；只有明确未鉴权/地址失效时才刷新，避免写操作重复执行。
            if attempt == 0 and response.status_code in {401, 403, 404, 410}:
                continue
            break
        assert response is not None
        if response.status_code >= 400 or payload.get("error"):
            raise WeComCliError("mcp_error", "企业微信未能完成待办操作，请稍后重试。")
        result = payload.get("result") or {}
        if result.get("isError"):
            raise WeComCliError("tool_error", "企业微信拒绝了本次待办操作，请检查机器人权限。")
        content = result.get("content") or []
        text = next((item.get("text") for item in content if item.get("type") == "text"), "{}")
        try:
            data = json.loads(text) if isinstance(text, str) else text
        except ValueError:
            data = {"message": str(text)}
        if not isinstance(data, dict):
            data = {"data": data}
        error_code = str(data.get("errcode") or "")
        if error_code and error_code != "0":
            friendly_messages = {
                "860042": "待办机器人无法触达部分负责人，请确认成员在机器人的可见范围内并已授权待办能力。",
            }
            raise WeComCliError(
                error_code,
                friendly_messages.get(error_code, "企业微信未能完成待办操作，请检查成员和机器人权限。"),
            )
        return data

    def test_connection(self) -> None:
        body = {
            "jsonrpc": "2.0",
            "id": secrets.token_hex(8),
            "method": "tools/list",
            "params": {},
        }
        try:
            response = requests.post(
                self._todo_url(refresh=True),
                json=body,
                timeout=30,
                headers=self.MCP_HEADERS,
            )
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise WeComCliError("network_error", "企业微信待办服务暂时不可用，请稍后重试。") from exc
        if response.status_code >= 400 or payload.get("error"):
            raise WeComCliError("mcp_error", "已获取机器人配置，但待办服务调用失败。")
        tools = (payload.get("result") or {}).get("tools") or []
        if not any(item.get("name") == "create_todo" for item in tools):
            raise WeComCliError("todo_not_enabled", "机器人连接成功，但尚未开放创建待办能力。", status_code=409)

    def create_todo(self, *, content: str, follower_ids: list[str], end_time: str = "", remind_types: list[int] | None = None) -> str:
        args: dict[str, Any] = {
            "content": content,
            "follower_list": {"followers": [{"follower_id": item, "follower_status": 1} for item in follower_ids]},
            "remind_type_list": remind_types or [0],
        }
        if end_time:
            args["end_time"] = end_time
        data = self.call("create_todo", args)
        todo_id = str(data.get("todo_id") or (data.get("data") or {}).get("todo_id") or "")
        if not todo_id:
            raise WeComCliError("missing_todo_id", "企业微信已响应，但未返回待办标识。")
        return todo_id

    def search_todo_userid(self, keyword: str) -> str:
        normalized = keyword.strip()
        if not normalized:
            return ""
        try:
            data = self.call("search_todo_userid", {"keyword": normalized})
        except WeComCliError as exc:
            if exc.code == "860046":
                return ""
            raise
        users = data.get("user_list") or []
        exact = [item for item in users if str(item.get("name") or "").strip() == normalized]
        candidates = exact or users
        if len(candidates) != 1:
            raise WeComCliError("todo_user_ambiguous", "待办机器人匹配到多个同名成员，请使用唯一姓名或别名。", status_code=409)
        return str(candidates[0].get("userid") or "")

    def list_todos(
        self, *, follower_id: str, todo_status: int | None = None, max_pages: int = 100
    ) -> list[dict[str, Any]]:
        """Read all available pages and hydrate details in API-sized batches."""
        todo_ids: list[str] = []
        cursor = ""
        exhausted = False
        for _page in range(max_pages):
            args: dict[str, Any] = {"follower_id": follower_id, "limit": 20}
            if todo_status is not None:
                args["todo_status"] = todo_status
            if cursor:
                args["cursor"] = cursor
            listed = self.call("get_todo_list", args)
            nested = listed.get("data") or {}
            rows = (
                listed.get("data_list") or listed.get("todo_list") or listed.get("todo_id_list")
                or nested.get("data_list") or nested.get("todo_list") or nested.get("todo_id_list") or []
            )
            todo_ids.extend(str(row.get("todo_id") or row) for row in rows if row)
            next_cursor = str(listed.get("next_cursor") or nested.get("next_cursor") or "")
            if not next_cursor or next_cursor == cursor:
                exhausted = True
                break
            cursor = next_cursor
        if not exhausted:
            raise WeComCliError(
                "todo_pagination_limit",
                "企业微信待办数量超过单次同步安全上限，请缩小同步范围后重试。",
                status_code=409,
            )
        unique_ids = list(dict.fromkeys(item for item in todo_ids if item))
        details: list[dict[str, Any]] = []
        for start in range(0, len(unique_ids), 20):
            response = self.call("get_todo_detail", {"todo_id_list": unique_ids[start:start + 20]})
            details.extend(response.get("data_list") or (response.get("data") or {}).get("data_list") or [])
        return details

    def update_todo(
        self,
        *,
        todo_id: str,
        content: str,
        follower_ids: list[str],
        todo_status: int,
        end_time: str = "",
        remind_types: list[int] | None = None,
    ) -> None:
        args: dict[str, Any] = {
            "todo_id": todo_id,
            "content": content,
            "follower_list": {
                "followers": [
                    {"follower_id": follower_id, "follower_status": 1}
                    for follower_id in list(dict.fromkeys(follower_ids))
                ]
            },
            "todo_status": todo_status,
            "remind_type_list": remind_types or [0],
        }
        if end_time:
            args["end_time"] = end_time
        self.call("update_todo", args)

    def change_user_status(self, *, todo_id: str, follower_id: str, user_status: int) -> None:
        self.call("change_todo_user_status", {"todo_id": todo_id, "follower_id": follower_id, "user_status": user_status})

    def delete_todo(self, *, todo_id: str) -> None:
        self.call("delete_todo", {"todo_id": todo_id})
