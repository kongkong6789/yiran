"""Streamable HTTP MCP 客户端（本地版）。"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable


class McpClientError(RuntimeError):
    pass


def _decode_response(raw: bytes, content_type: str) -> dict[str, Any]:
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return {}
    if "text/event-stream" in content_type:
        for line in text.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload and payload != "[DONE]":
                    return json.loads(payload)
        return {}
    return json.loads(text)


class StreamableHttpClient:
    def __init__(self, url: str, timeout: int = 20):
        self.url = url
        self.timeout = timeout
        self.session_id = ""
        self._request_id = 0

    def _post(self, payload: dict[str, Any], notification: bool = False) -> dict[str, Any]:
        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        req = urllib.request.Request(
            self.url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                session_id = resp.headers.get("Mcp-Session-Id")
                if session_id:
                    self.session_id = session_id
                if notification or resp.status == 202:
                    return {}
                return _decode_response(resp.read(), resp.headers.get("Content-Type", ""))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise McpClientError(f"MCP HTTP {exc.code}: {detail or exc.reason}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise McpClientError(f"MCP 连接失败: {exc}") from exc

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._request_id += 1
        payload: dict[str, Any] = {"jsonrpc": "2.0", "id": self._request_id, "method": method}
        if params is not None:
            payload["params"] = params
        response = self._post(payload)
        if response.get("error"):
            err = response["error"]
            raise McpClientError(str(err.get("message") or err))
        return response.get("result") or {}

    def initialize(self) -> None:
        self.request(
            "initialize",
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {"name": "liangce-local-agent", "version": "1.0.0"},
            },
        )
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, notification=True)

    def list_tools(self) -> list[dict[str, Any]]:
        return self.request("tools/list").get("tools") or []

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return self.request("tools/call", {"name": name, "arguments": arguments})


def probe_streamable_http(url: str, timeout: int = 10) -> dict[str, Any]:
    try:
        client = StreamableHttpClient(url, timeout=timeout)
        client.initialize()
        tools = client.list_tools()
        sample = ", ".join(str(t.get("name")) for t in tools[:4])
        suffix = f" · 如 {sample}" if sample else ""
        return {
            "ok": True,
            "status": "reachable",
            "message": f"MCP 握手成功,可用工具 {len(tools)} 个{suffix}",
            "tool_count": len(tools),
        }
    except McpClientError as exc:
        return {"ok": False, "status": "error", "message": str(exc)}


def _content_text(result: dict[str, Any]) -> str:
    parts: list[str] = []
    for item in result.get("content") or []:
        if item.get("type") == "text" and item.get("text"):
            parts.append(str(item["text"]))
    if not parts and result.get("structuredContent"):
        parts.append(json.dumps(result["structuredContent"], ensure_ascii=False))
    return "\n".join(parts).strip()


def _parse_json_text(text: str) -> dict[str, Any]:
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _is_wecom_api_error(text: str) -> str:
    data = _parse_json_text(text)
    errcode = data.get("errcode")
    if errcode not in (None, 0, "0"):
        return str(data.get("errmsg") or f"企微 API 错误 {errcode}")
    return ""


def _read_smartsheet(client: StreamableHttpClient, document_url: str) -> dict[str, Any]:
    sheet_result = client.call_tool("smartsheet_get_sheet", {"url": document_url})
    if sheet_result.get("isError"):
        raise McpClientError(_content_text(sheet_result) or "smartsheet_get_sheet 失败")
    sheet_payload = _parse_json_text(_content_text(sheet_result))
    api_error = _is_wecom_api_error(json.dumps(sheet_payload, ensure_ascii=False))
    if api_error:
        raise McpClientError(api_error)
    sheets = sheet_payload.get("sheet_list") or []
    if not sheets:
        raise McpClientError("文档中未找到子表")
    chunks: list[str] = []
    for sheet in sheets[:5]:
        sheet_id = str(sheet.get("sheet_id") or "").strip()
        title = str(sheet.get("title") or sheet_id)
        if not sheet_id:
            continue
        records_result = client.call_tool(
            "smartsheet_get_records",
            {"url": document_url, "sheet_id": sheet_id, "limit": 200},
        )
        records_text = _content_text(records_result)
        api_error = _is_wecom_api_error(records_text)
        if api_error:
            raise McpClientError(f"子表 {title}: {api_error}")
        chunks.append(f"### 子表: {title}\n{records_text}")
    if not chunks:
        raise McpClientError("未能读取任何子表数据")
    return {
        "content": "\n\n".join(chunks)[:16000],
        "tool": "smartsheet_get_sheet + smartsheet_get_records",
        "source": document_url,
    }


def read_wecom_document(question: str, wecom_url: str, document_url: str | None = None) -> dict[str, Any]:
    if not document_url:
        match = re.search(r"https?://doc\.weixin\.qq\.com/[^\s<>\"]+", question)
        document_url = match.group(0).rstrip("。），,)]") if match else ""
    if not document_url:
        return {"attempted": False, "content": "", "error": ""}
    if not wecom_url:
        return {"attempted": True, "content": "", "error": "请先在 MCP 配置中填写企业微信 StreamableHttp URL"}

    try:
        client = StreamableHttpClient(wecom_url)
        client.initialize()
        if "/smartsheet/" in document_url:
            result = _read_smartsheet(client, document_url)
            return {"attempted": True, "error": "", **result}
        result = client.call_tool("read_doc", {"url": document_url})
        content = _content_text(result)
        api_error = _is_wecom_api_error(content)
        if api_error:
            raise McpClientError(api_error)
        return {
            "attempted": True,
            "content": content[:16000],
            "error": "",
            "tool": "read_doc",
            "source": document_url,
        }
    except McpClientError as exc:
        return {"attempted": True, "content": "", "error": str(exc), "source": document_url}
