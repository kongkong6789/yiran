"""最小 Streamable HTTP MCP 客户端，供后端 Agent 调用已配置的工具。"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from apps.core.cancellation import AgentRunCancelled, raise_if_cancelled

from .registry import get_def, resolve_config


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
    def __init__(self, url: str, timeout: int = 20, cancel_check=None):
        self.url = url
        self.timeout = timeout
        self.cancel_check = cancel_check
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
            raise_if_cancelled(self.cancel_check)
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raise_if_cancelled(self.cancel_check)
                session_id = resp.headers.get("Mcp-Session-Id")
                if session_id:
                    self.session_id = session_id
                if notification or resp.status == 202:
                    return {}
                chunks: list[bytes] = []
                while True:
                    raise_if_cancelled(self.cancel_check)
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    chunks.append(chunk)
                raise_if_cancelled(self.cancel_check)
                return _decode_response(
                    b"".join(chunks),
                    resp.headers.get("Content-Type", ""),
                )
        except AgentRunCancelled:
            raise
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise McpClientError(f"MCP HTTP {exc.code}: {detail or exc.reason}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise McpClientError(f"MCP 连接失败: {exc}") from exc
        except (json.JSONDecodeError, ValueError) as exc:
            raise McpClientError(f"MCP 返回内容无法解析: {exc}") from exc

    def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._request_id += 1
        payload: dict[str, Any] = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
        }
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
                "clientInfo": {"name": "liangce-agent", "version": "1.0.0"},
            },
        )
        self._post(
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            notification=True,
        )

    def list_tools(self) -> list[dict[str, Any]]:
        return self.request("tools/list").get("tools") or []

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return self.request("tools/call", {"name": name, "arguments": arguments})


def probe_streamable_http(url: str, timeout: int = 10) -> dict[str, Any]:
    """Streamable HTTP MCP 探测: POST initialize + tools/list(GET 会 405)。"""
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
    except Exception as exc:
        return {"ok": False, "status": "unreachable", "message": str(exc)}


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
    raise_if_cancelled(client.cancel_check)
    sheet_result = client.call_tool("smartsheet_get_sheet", {"url": document_url})
    if sheet_result.get("isError"):
        raise McpClientError(_content_text(sheet_result) or "smartsheet_get_sheet 失败")

    sheet_payload = _parse_json_text(_content_text(sheet_result))
    api_error = _is_wecom_api_error(json.dumps(sheet_payload, ensure_ascii=False))
    if api_error:
        raise McpClientError(api_error)

    sheets = sheet_payload.get("sheet_list") or []
    if not sheets:
        raise McpClientError("文档中未找到子表,请确认链接权限")

    chunks: list[str] = []
    used_tools: list[str] = []
    for sheet in sheets[:5]:
        raise_if_cancelled(client.cancel_check)
        sheet_id = str(sheet.get("sheet_id") or "").strip()
        title = str(sheet.get("title") or sheet_id)
        if not sheet_id:
            continue
        records_result = client.call_tool(
            "smartsheet_get_records",
            {"url": document_url, "sheet_id": sheet_id, "limit": 200},
        )
        if records_result.get("isError"):
            raise McpClientError(_content_text(records_result) or "smartsheet_get_records 失败")
        records_text = _content_text(records_result)
        api_error = _is_wecom_api_error(records_text)
        if api_error:
            raise McpClientError(f"子表 {title}: {api_error}")
        chunks.append(f"### 子表: {title} (sheet_id={sheet_id})\n{records_text}")
        used_tools.append("smartsheet_get_records")

    if not chunks:
        raise McpClientError("未能读取任何子表数据")

    return {
        "content": "\n\n".join(chunks)[:16000],
        "tool": "smartsheet_get_sheet + smartsheet_get_records",
        "source": document_url,
    }


def _extract_document_url(text: str) -> str:
    match = re.search(r"https?://doc\.weixin\.qq\.com/[^\s<>\"]+", text)
    return match.group(0).rstrip("。），,)]") if match else ""


def find_document_url_in_thread(message: str, history: list[dict] | None = None) -> str:
    """从当前消息或历史用户消息中提取企微文档链接。"""
    if url := _extract_document_url(message):
        return url
    for item in reversed(history or []):
        if item.get("role") != "user":
            continue
        if url := _extract_document_url(str(item.get("content") or "")):
            return url
    return ""


def is_document_followup(message: str, history: list[dict] | None, doc_url: str) -> bool:
    if not doc_url:
        return False
    hints = ("原始", "表格", "导出", "上面", "刚才", "这份", "这个文档", "筛选", "展示", "字段", "记录")
    if any(h in message for h in hints):
        return True
    for item in history or []:
        content = str(item.get("content") or "")
        if item.get("role") == "assistant" and ("MCP" in content or "智能表格" in content or "sheet_id" in content):
            return True
    return True  # 线程里已有文档链接,默认继续文档上下文


def _tool_score(tool: dict[str, Any]) -> int:
    text = f"{tool.get('name', '')} {tool.get('description', '')}".lower()
    score = 0
    for word in ("read", "get", "fetch", "query", "读取", "获取", "查询"):
        if word in text:
            score += 3
    for word in ("document", "doc", "sheet", "smartsheet", "文档", "表格"):
        if word in text:
            score += 4
    for word in ("write", "send", "create", "delete", "update", "写入", "发送", "创建", "删除"):
        if word in text:
            score -= 8
    return score


def _build_arguments(tool: dict[str, Any], document_url: str) -> dict[str, Any]:
    schema = tool.get("inputSchema") or {}
    properties = schema.get("properties") or {}
    required = schema.get("required") or []
    parsed = urllib.parse.urlparse(document_url)
    path_parts = [p for p in parsed.path.split("/") if p]
    document_id = path_parts[-1] if path_parts else ""
    query = urllib.parse.parse_qs(parsed.query)
    scode = (query.get("scode") or [""])[0]

    values: dict[str, str] = {}
    for name in properties:
        key = name.lower()
        if key in {"url", "uri", "link", "doc_url", "document_url", "share_url"}:
            values[name] = document_url
        elif key in {"doc_id", "document_id", "file_id", "sheet_id", "smartsheet_id"}:
            values[name] = document_id
        elif key in {"scode", "share_code"} and scode:
            values[name] = scode

    missing = [name for name in required if name not in values]
    if missing:
        raise McpClientError(
            f"工具 {tool.get('name')} 还需要参数: {', '.join(missing)}"
        )
    return values


def _content_text(result: dict[str, Any]) -> str:
    parts: list[str] = []
    for item in result.get("content") or []:
        if item.get("type") == "text" and item.get("text"):
            parts.append(str(item["text"]))
        elif item.get("type") in {"resource", "resource_link"}:
            resource = item.get("resource") or item
            if resource.get("text"):
                parts.append(str(resource["text"]))
    if not parts and result.get("structuredContent"):
        parts.append(json.dumps(result["structuredContent"], ensure_ascii=False))
    return "\n".join(parts).strip()


def read_wecom_document(
    question: str,
    document_url: str | None = None,
    user=None,
    cancel_check=None,
) -> dict[str, Any]:
    """识别企微文档链接，通过已配置的 MCP 自动发现并调用只读工具。"""
    document_url = document_url or _extract_document_url(question)
    if not document_url:
        return {"attempted": False, "content": "", "error": ""}

    defn = get_def("wecom")
    if not defn:
        return {"attempted": True, "content": "", "error": "企业微信 MCP 未注册"}
    cfg = resolve_config(defn, user=user)
    if not cfg.get("configured") or not cfg.get("url"):
        return {
            "attempted": True,
            "content": "",
            "error": "企业微信 MCP 尚未配置 StreamableHttp URL",
        }

    try:
        client = StreamableHttpClient(cfg["url"], cancel_check=cancel_check)
        client.initialize()

        if "/smartsheet/" in document_url:
            result = _read_smartsheet(client, document_url)
            return {"attempted": True, "error": "", **result}

        tools = sorted(client.list_tools(), key=_tool_score, reverse=True)
        readable = [tool for tool in tools if _tool_score(tool) > 0]
        if not readable:
            names = ", ".join(str(t.get("name")) for t in tools[:8])
            raise McpClientError(f"服务未提供可识别的文档读取工具;现有工具: {names or '无'}")

        errors: list[str] = []
        for tool in readable[:5]:
            raise_if_cancelled(cancel_check)
            try:
                arguments = _build_arguments(tool, document_url)
                result = client.call_tool(str(tool["name"]), arguments)
                if result.get("isError"):
                    errors.append(_content_text(result) or f"{tool['name']} 调用失败")
                    continue
                content = _content_text(result)
                if content:
                    api_error = _is_wecom_api_error(content)
                    if api_error:
                        errors.append(f"{tool['name']}: {api_error}")
                        continue
                    return {
                        "attempted": True,
                        "content": content[:16000],
                        "error": "",
                        "tool": tool["name"],
                        "source": document_url,
                    }
            except McpClientError as exc:
                errors.append(str(exc))
        raise McpClientError("; ".join(errors[-3:]) or "读取工具未返回文档内容")
    except AgentRunCancelled:
        raise
    except McpClientError as exc:
        return {
            "attempted": True,
            "content": "",
            "error": str(exc),
            "source": document_url,
        }
