"""MCP 注册表 + 本地文件配置（每人一份 JSON）。"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from ..storage import UserStore


@dataclass
class McpServerDef:
    id: str
    name: str
    desc: str
    layer: str
    transport: str
    tools: list[str] = field(default_factory=list)
    placeholders: dict[str, str] = field(default_factory=dict)
    hints: list[str] = field(default_factory=list)


REGISTRY: list[McpServerDef] = [
    McpServerDef(
        id="wecom",
        name="企业微信",
        desc="企微官方 MCP · 文档 / 智能表格",
        layer="协作",
        transport="streamable_http",
        tools=["read_doc", "write_doc", "search_docs", "send_message"],
        placeholders={"url": "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=你的apikey"},
        hints=[
            "配置保存在本机用户目录,不会上传服务器",
            "方式一: 粘贴 StreamableHttp URL",
            "方式二: 粘贴企微 JSON Config 导入",
        ],
    ),
    McpServerDef(
        id="tencent_docs", name="腾讯文档", desc="协作文档",
        layer="协作", transport="streamable_http",
        tools=["read_doc", "write_doc", "list_docs", "search_docs"],
    ),
    McpServerDef(
        id="wedrive", name="微盘", desc="资料分发",
        layer="协作", transport="streamable_http",
        tools=["list_files", "upload_file", "download_file"],
    ),
    McpServerDef(
        id="kingdee", name="金蝶云", desc="财务对账",
        layer="感知", transport="streamable_http",
        tools=["query_voucher", "query_receivable"],
    ),
    McpServerDef(
        id="jackyun", name="吉客云", desc="订单库存",
        layer="感知", transport="streamable_http",
        tools=["list_goods", "list_trades", "query_stock"],
    ),
    McpServerDef(
        id="nas", name="NAS 文件库", desc="本地文件",
        layer="协作", transport="stdio",
        tools=["list_directory", "read_file", "search_files"],
    ),
    McpServerDef(
        id="workbuddy", name="WorkBuddy", desc="企微 AI",
        layer="终端", transport="sse",
        tools=["chat", "trigger_agent"],
    ),
]


def get_def(server_id: str) -> McpServerDef | None:
    return next((item for item in REGISTRY if item.id == server_id), None)


def _is_wecom_server_key(key: str) -> bool:
    k = str(key).lower()
    return k in ("wecom", "wechat_work", "wework") or "企业微信" in str(key)


def parse_cursor_json(raw: str | dict, prefer_id: str | None = None) -> dict[str, Any]:
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            raise ValueError("粘贴内容为空")
        if raw.startswith("http://") or raw.startswith("https://"):
            return {"url": raw, "command": "", "args": [], "env": {}, "enabled": True}
        data = json.loads(raw)
    else:
        data = raw

    if not isinstance(data, dict):
        raise ValueError("期望 JSON 对象或 URL")

    entry = data
    if "mcpServers" in data and isinstance(data["mcpServers"], dict):
        servers = data["mcpServers"]
        if prefer_id == "wecom":
            for name, cfg in servers.items():
                if _is_wecom_server_key(name):
                    entry = cfg
                    break
            else:
                entry = next(iter(servers.values()))
        elif len(servers) == 1:
            entry = next(iter(servers.values()))
        else:
            entry = next(iter(servers.values()))

    if not isinstance(entry, dict):
        raise ValueError("未找到有效的 MCP 配置")

    return {
        "url": str(entry.get("url") or "").strip(),
        "command": str(entry.get("command") or "").strip(),
        "args": [str(x) for x in (entry.get("args") or [])],
        "env": {str(k): str(v) for k, v in (entry.get("env") or {}).items()},
        "enabled": True,
    }


def resolve_config(store: UserStore, defn: McpServerDef) -> dict[str, Any]:
    row = store.read_mcp(defn.id)
    url = str(row.get("url") or "").strip()
    command = str(row.get("command") or "").strip()
    args = [str(x) for x in (row.get("args") or [])]
    env = {str(k): str(v) for k, v in (row.get("env") or {}).items()}
    enabled = bool(row.get("enabled", True))

    transport = defn.transport
    if url and not command:
        transport = "streamable_http" if defn.transport != "sse" else "sse"
    elif command:
        transport = "stdio"

    if not enabled:
        configured = False
    elif transport in ("streamable_http", "sse"):
        configured = bool(url)
    else:
        configured = bool(command)

    return {
        "id": defn.id,
        "name": defn.name,
        "desc": defn.desc,
        "layer": defn.layer,
        "transport": transport,
        "declared_transport": defn.transport,
        "configured": configured,
        "enabled": enabled,
        "url": url,
        "command": command,
        "args": args,
        "env": env,
        "tools": defn.tools,
        "config_source": "local_file" if row else "none",
        "placeholders": defn.placeholders,
        "hints": defn.hints,
        "local_path": str((store.mcp_dir / f"{defn.id}.json").resolve()),
        "updated_at": row.get("updated_at"),
        "status": "configured" if configured else "unconfigured",
    }


def cursor_snippet(defn: McpServerDef, cfg: dict[str, Any]) -> dict[str, Any]:
    key = defn.id.replace("-", "_")
    if cfg.get("url"):
        entry: dict[str, Any] = {"url": cfg["url"]}
        if defn.id == "wecom":
            entry["type"] = "streamable-http"
        return {key: entry}
    if cfg.get("command"):
        entry = {"command": cfg["command"]}
        if cfg.get("args"):
            entry["args"] = cfg["args"]
        if cfg.get("env"):
            entry["env"] = cfg["env"]
        return {key: entry}
    return {key: defn.placeholders or {"url": f"http://127.0.0.1/mcp/{defn.id}"}}


def save_config(store: UserStore, server_id: str, data: dict[str, Any]) -> dict[str, Any]:
    defn = get_def(server_id)
    if not defn:
        raise ValueError(f"未知 MCP Server: {server_id}")

    if data.get("import_json") or data.get("cursor_json"):
        parsed = parse_cursor_json(data.get("import_json") or data.get("cursor_json"), prefer_id=server_id)
        data = {**data, **parsed}

    url = str(data.get("url") or "").strip()
    command = str(data.get("command") or "").strip()
    args = [str(x) for x in (data.get("args") or [])]
    env = {str(k): str(v) for k, v in (data.get("env") or {}).items()}
    if server_id == "wecom" and url:
        command, args, env = "", [], {}

    store.save_mcp(server_id, {
        "url": url,
        "command": command,
        "args": args,
        "env": env,
        "enabled": bool(data.get("enabled", True)),
    })
    return resolve_config(store, defn)


def detail_payload(store: UserStore, defn: McpServerDef) -> dict[str, Any]:
    cfg = resolve_config(store, defn)
    snippet = cursor_snippet(defn, cfg)
    return {
        **cfg,
        "cursor_config": {"mcpServers": snippet},
        "cursor_json": json.dumps({"mcpServers": snippet}, ensure_ascii=False, indent=2),
    }
