"""
MCP(Model Context Protocol) 服务注册表。

MCP 配置按当前企业保存与读取，不跨企业共享。
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from django.conf import settings


@dataclass
class McpServerDef:
    id: str
    name: str
    desc: str
    layer: str
    transport: str
    tools: list[str] = field(default_factory=list)
    url_env: str = ""
    command_env: str = ""
    args_env: str = ""
    env_env: str = ""  # JSON object in .env, e.g. {"WECOM_WEBHOOK_URL":"..."}
    probe_path: str = ""
    # 表单提示(前端展示)
    placeholders: dict[str, str] = field(default_factory=dict)
    hints: list[str] = field(default_factory=list)


def _env(key: str) -> str:
    return (os.getenv(key) or getattr(settings, key, "") or "").strip()


def _args_from_env(key: str) -> list[str]:
    raw = _env(key)
    if not raw:
        return []
    try:
        val = json.loads(raw)
        return [str(x) for x in val] if isinstance(val, list) else [str(val)]
    except json.JSONDecodeError:
        return [x.strip() for x in raw.split(",") if x.strip()]


def _dict_from_env(key: str) -> dict[str, str]:
    raw = _env(key)
    if not raw:
        return {}
    try:
        val = json.loads(raw)
        if isinstance(val, dict):
            return {str(k): str(v) for k, v in val.items()}
    except json.JSONDecodeError:
        pass
    return {}


REGISTRY: list[McpServerDef] = [
    McpServerDef(
        id="wecom",
        name="企业微信",
        desc="企微官方 MCP · 文档 / 机器人 StreamableHttp",
        layer="协作",
        transport="streamable_http",
        url_env="MCP_WECOM_URL",
        tools=["read_doc", "write_doc", "search_docs", "send_message"],
        placeholders={
            "url": "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=你的apikey",
        },
        hints=[
            "方式一: 粘贴企微后台提供的 StreamableHttp URL",
            "方式二: 粘贴企微后台提供的 JSON Config 后点「导入并保存」",
            "配置关联机器人与个人信息,请妥善保管;泄露可在企微后台重置",
        ],
    ),
    McpServerDef(
        id="kingdee", name="金蝶云", desc="财务 · 对账 · 凭证 · 应收",
        layer="感知", transport="openapi", url_env="MCP_KINGDEE_URL",
        tools=["query_voucher", "query_receivable", "query_balance", "sync_gl"],
        placeholders={
            "base_url": "http://159.75.104.61/k3cloud",
            "acct_id": "65405d0ec432ee",
            "lcid": "2052",
            "username": "金蝶登录账号",
            "password": "金蝶登录密码",
        },
        hints=[
            "在连接中心填写 K3Cloud 地址、账套、账号密码与 LCID（简体中文一般为 2052）",
            "配置按当前企业隔离；保存后可用「探测连通」验证登录",
            "未填密码时会保留原密码；全局 .env 仅作兜底",
        ],
    ),
    McpServerDef(
        id="jackyun", name="吉客云", desc="订单 · 库存 · 商品 · 发货",
        layer="感知", transport="openapi", url_env="MCP_JACKYUN_URL",
        tools=["list_goods", "list_trades", "query_stock", "sync_orders"],
        placeholders={
            "base_url": "https://open.jackyun.com/open/openapi/do",
            "app_key": "开放平台 AppKey",
            "app_secret": "开放平台 AppSecret",
            "method_inventory": "erp.stockquantity.get",
        },
        hints=[
            "填写吉客云开放平台 AppKey / AppSecret；库存方法默认 erp.stockquantity.get",
            "配置按当前企业隔离；小策与协作 @AI 会自动使用企业配置",
            "未填 Secret 时会保留原 Secret；全局 .env 仅作兜底",
        ],
    ),
    McpServerDef(
        id="nas", name="NAS 文件库", desc="合同 · 归档 · 附件检索",
        layer="协作", transport="stdio", command_env="MCP_NAS_COMMAND", args_env="MCP_NAS_ARGS",
        tools=["list_directory", "read_file", "search_files", "get_metadata"],
    ),
]


def get_def(server_id: str) -> McpServerDef | None:
    return next((s for s in REGISTRY if s.id == server_id), None)


def _db_row(server_id: str, user=None, organization=None):
    from .models import McpServerConfig
    from apps.core.organizations import current_organization
    if user is None or not getattr(user, "is_authenticated", False):
        return None
    organization = organization or current_organization(user)
    if organization is None:
        return None
    return McpServerConfig.objects.filter(organization=organization, server_id=server_id).first()


def _effective_transport(defn: McpServerDef, url: str, command: str) -> str:
    if url and not command:
        return "streamable_http" if defn.transport != "sse" else "sse"
    if command:
        return "stdio"
    return defn.transport


def resolve_config(defn: McpServerDef, user=None, organization=None) -> dict[str, Any]:
    """解析当前企业配置；未登录或未加入企业时不返回 MCP 密钥。"""
    from apps.core.organizations import current_organization, is_organization_admin
    from apps.connectors.credentials import (
        is_native_configured,
        load_merged_secrets,
        native_fields_for_response,
    )

    organization = organization or current_organization(user)
    url = command = ""
    args: list[str] = []
    env: dict[str, str] = {}
    source = "none"
    enabled = True

    row = _db_row(defn.id, user, organization=organization)
    if row:
        enabled = row.enabled
        url = (row.url or "").strip()
        command = (row.command or "").strip()
        args = [str(a) for a in (row.args or [])]
        raw_env = row.env if isinstance(row.env, dict) else {}
        env = {str(k): str(v) for k, v in raw_env.items()}
        if url or command or env:
            source = "organization"

    # 金蝶/吉客云：合并 .env 兜底后的完整凭据用于「是否已配置」判断与表单回填
    if defn.id in ("jackyun", "kingdee"):
        merged = load_merged_secrets(defn.id, user=user)
        if merged and source == "none":
            source = "env"
        display_env = dict(merged)
        # 表单优先展示企业已存字段；密钥不回传明文
        if row and isinstance(row.env, dict):
            for k, v in row.env.items():
                if v is not None and str(v).strip():
                    display_env[str(k)] = str(v)
        native = native_fields_for_response(defn.id, display_env)
        configured = bool(enabled and is_native_configured(defn.id, merged))
        return {
            "id": defn.id,
            "name": defn.name,
            "desc": defn.desc,
            "layer": defn.layer,
            "transport": "openapi",
            "declared_transport": defn.transport,
            "configured": configured,
            "enabled": enabled,
            "url": "",
            "command": "",
            "args": [],
            "env": {},  # 不把密钥明文塞给前端
            "native": native,
            "tools": defn.tools,
            "config_source": source,
            "env_keys": list(merged.keys()),
            "placeholders": defn.placeholders,
            "hints": defn.hints,
            "updated_at": row.updated_at.isoformat() if row else None,
            "organization_id": organization.id if organization else None,
            "organization_name": organization.name if organization else "",
            "can_manage": bool(organization and is_organization_admin(user, organization)),
        }

    transport = _effective_transport(defn, url, command)

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
        "config_source": source,
        "env_keys": [],
        "placeholders": defn.placeholders,
        "hints": defn.hints,
        "updated_at": row.updated_at.isoformat() if row else None,
        "organization_id": organization.id if organization else None,
        "organization_name": organization.name if organization else "",
        "can_manage": bool(organization and is_organization_admin(user, organization)),
    }


def cursor_snippet(defn: McpServerDef, cfg: dict[str, Any]) -> dict[str, Any]:
    key = defn.id.replace("-", "_")
    transport = cfg.get("transport") or defn.transport
    env = cfg.get("env") or {}

    if transport in ("streamable_http", "sse") and cfg.get("url"):
        entry: dict[str, Any] = {"url": cfg["url"]}
        if defn.id == "wecom":
            entry["type"] = "streamable-http"
        if transport == "sse":
            entry["transport"] = "sse"
        if env:
            entry["env"] = env
        return {key: entry}

    if cfg.get("command"):
        entry = {"command": cfg["command"]}
        if cfg.get("args"):
            entry["args"] = cfg["args"]
        if env:
            entry["env"] = env
        return {key: entry}

    # 未配置时给出可复制的模板
    ph = defn.placeholders or {}
    if defn.transport == "stdio" or ph.get("command"):
        entry = {
            "command": ph.get("command") or "npx",
            "args": json.loads(ph["args"]) if ph.get("args", "").startswith("[") else ["-y", f"@your-org/mcp-{defn.id}"],
        }
        if ph.get("env"):
            try:
                entry["env"] = json.loads(ph["env"])
            except json.JSONDecodeError:
                pass
        return {key: entry}

    if defn.transport in ("streamable_http", "sse"):
        return {key: {"url": ph.get("url") or f"http://127.0.0.1:8xxx/mcp/{defn.id}"}}
    return {key: {"command": "npx", "args": ["-y", f"@your-org/mcp-{defn.id}"]}}


def list_servers(user=None) -> list[dict[str, Any]]:
    return [resolve_config(d, user=user) for d in REGISTRY]


def _parse_args(raw_args: Any) -> list[str]:
    if isinstance(raw_args, str):
        raw_args = raw_args.strip()
        if raw_args.startswith("["):
            try:
                raw_args = json.loads(raw_args)
            except json.JSONDecodeError as exc:
                raise ValueError(f"args 必须是 JSON 数组: {exc}") from exc
        elif raw_args:
            raw_args = [x.strip() for x in raw_args.split() if x.strip()]
        else:
            raw_args = []
    return [str(a) for a in raw_args] if isinstance(raw_args, list) else []


def _parse_env(raw_env: Any) -> dict[str, str]:
    if raw_env is None or raw_env == "":
        return {}
    if isinstance(raw_env, str):
        raw_env = raw_env.strip()
        if not raw_env:
            return {}
        try:
            raw_env = json.loads(raw_env)
        except json.JSONDecodeError as exc:
            raise ValueError(f"env 必须是 JSON 对象: {exc}") from exc
    if not isinstance(raw_env, dict):
        raise ValueError("env 必须是 JSON 对象,如 {\"WECOM_WEBHOOK_URL\":\"...\"}")
    return {str(k): str(v) for k, v in raw_env.items()}


def _is_wecom_server_key(key: str) -> bool:
    k = str(key).lower()
    return k in ("wecom", "wechat_work", "wework") or "企业微信" in str(key)


def parse_cursor_json(raw: str | dict, prefer_id: str | None = None) -> dict[str, Any]:
    """从 Cursor mcp.json / 企微 JSON Config / StreamableHttp URL 解析配置。"""
    if isinstance(raw, str):
        raw = raw.strip()
        if not raw:
            raise ValueError("粘贴内容为空")
        if raw.startswith("http://") or raw.startswith("https://"):
            return {"url": raw, "command": "", "args": [], "env": {}, "enabled": True}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON 解析失败: {exc}") from exc
    else:
        data = raw

    if not isinstance(data, dict):
        raise ValueError("期望 JSON 对象或 StreamableHttp URL")

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
        elif prefer_id and prefer_id in servers:
            entry = servers[prefer_id]
        elif prefer_id and prefer_id.replace("-", "_") in servers:
            entry = servers[prefer_id.replace("-", "_")]
        elif len(servers) == 1:
            entry = next(iter(servers.values()))
        elif "wecom" in servers:
            entry = servers["wecom"]
        else:
            entry = next(iter(servers.values()))

    if not isinstance(entry, dict):
        raise ValueError("未找到有效的 MCP Server 配置对象")

    url = str(entry.get("url") or "").strip()
    if not url and prefer_id == "wecom":
        raise ValueError("JSON Config 中缺少 url 字段")

    return {
        "url": url,
        "command": "",
        "args": [],
        "env": {},
        "enabled": True,
    }


def save_config(server_id: str, data: dict[str, Any], user=None) -> dict[str, Any]:
    defn = get_def(server_id)
    if not defn:
        raise ValueError(f"未知 MCP Server: {server_id}")
    if user is None or not getattr(user, "is_authenticated", False):
        raise ValueError("请先登录后再保存企业 MCP 配置")

    from apps.core.organizations import current_organization, is_organization_admin
    organization = current_organization(user)
    if organization is None:
        raise ValueError("当前账号尚未加入企业")
    if not is_organization_admin(user, organization):
        raise PermissionError("仅当前企业的所有者或管理员可以修改连接器配置")

    from .models import McpServerConfig

    # 支持直接粘贴 mcp.json
    if data.get("cursor_json") or data.get("mcp_json") or data.get("import_json"):
        raw = data.get("cursor_json") or data.get("mcp_json") or data.get("import_json")
        parsed = parse_cursor_json(raw, prefer_id=server_id)
        data = {**data, **parsed}

    args = _parse_args(data.get("args", []))
    env = _parse_env(data.get("env", {}))

    url = str(data.get("url") or "").strip()
    command = str(data.get("command") or "").strip()

    # 企微官方 MCP 仅 StreamableHttp,保存 URL 时清空 stdio 字段
    if server_id == "wecom" and url:
        command = ""
        args = []
        env = {}

    # 金蝶 / 吉客云：把表单原生字段写入 env
    if server_id in ("jackyun", "kingdee"):
        from apps.connectors.credentials import merge_native_into_env

        existing = {}
        row = McpServerConfig.objects.filter(
            organization=organization, server_id=server_id
        ).first()
        if row and isinstance(row.env, dict):
            existing = row.env
        # 允许 data.native 或扁平字段
        native_data = data.get("native") if isinstance(data.get("native"), dict) else data
        env = merge_native_into_env(server_id, native_data, existing)
        url = ""
        command = ""
        args = []

    McpServerConfig.objects.update_or_create(
        organization=organization,
        server_id=server_id,
        defaults={
            "user": user,
            "url": url,
            "command": command,
            "args": args,
            "env": env,
            "enabled": bool(data.get("enabled", True)),
        },
    )
    return resolve_config(defn, user=user, organization=organization)
