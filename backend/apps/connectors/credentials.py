"""企业级连接器凭据：界面配置（McpServerConfig.env）优先于全局 .env。"""
from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator

_active_secrets: ContextVar[dict[str, str] | None] = ContextVar(
    "connector_active_secrets", default=None
)

# 各连接器写入 env 的标准键
JACKYUN_KEYS = (
    "JACKYUN_APP_KEY",
    "JACKYUN_APP_SECRET",
    "JACKYUN_BASE_URL",
    "JACKYUN_METHOD_INVENTORY",
    "JACKYUN_METHOD_GOODS",
    "JACKYUN_METHOD_TRADE",
)
KINGDEE_KEYS = (
    "KINGDEE_BASE_URL",
    "KINGDEE_ACCT_ID",
    "KINGDEE_USERNAME",
    "KINGDEE_PASSWORD",
    "KINGDEE_LCID",
)

SECRET_KEYS = frozenset({
    "JACKYUN_APP_SECRET",
    "KINGDEE_PASSWORD",
})


def active_secrets() -> dict[str, str]:
    return dict(_active_secrets.get() or {})


@contextmanager
def use_connector_secrets(server_id: str, user=None) -> Iterator[dict[str, str]]:
    secrets = load_merged_secrets(server_id, user=user)
    token = _active_secrets.set(secrets)
    try:
        yield secrets
    finally:
        _active_secrets.reset(token)


def _org_env(server_id: str, user=None) -> dict[str, str]:
    if user is None or not getattr(user, "is_authenticated", False):
        return {}
    try:
        from apps.core.organizations import current_organization
        from apps.mcp.models import McpServerConfig
    except Exception:
        return {}
    org = current_organization(user)
    if org is None:
        return {}
    row = McpServerConfig.objects.filter(organization=org, server_id=server_id).first()
    if not row or not isinstance(row.env, dict):
        return {}
    return {str(k): str(v) for k, v in row.env.items() if v is not None and str(v).strip() != ""}


def _settings_fallback(keys: tuple[str, ...]) -> dict[str, str]:
    from django.conf import settings

    out: dict[str, str] = {}
    for key in keys:
        val = (getattr(settings, key, None) or "").strip()
        if val:
            out[key] = val
    return out


def load_merged_secrets(server_id: str, user=None) -> dict[str, str]:
    """企业界面配置覆盖全局 .env。"""
    sid = (server_id or "").strip()
    if sid == "jackyun":
        keys = JACKYUN_KEYS
    elif sid == "kingdee":
        keys = KINGDEE_KEYS
    else:
        return {}
    merged = _settings_fallback(keys)
    merged.update(_org_env(sid, user=user))
    # 激活上下文时也合并进来（嵌套调用）
    active = active_secrets()
    for key in keys:
        if key in active and active[key]:
            merged[key] = active[key]
    return merged


def cfg_value(name: str, default: str = "") -> str:
    """连接器内读取配置：先看上下文凭据，再看 Django settings。"""
    secrets = active_secrets()
    if name in secrets and str(secrets[name]).strip():
        return str(secrets[name]).strip()
    from django.conf import settings
    return (getattr(settings, name, None) or default or "").strip()


def native_fields_for_response(server_id: str, env: dict[str, Any]) -> dict[str, Any]:
    """返回给前端的原生字段；密钥只标记是否已设置。"""
    env = {str(k): str(v) for k, v in (env or {}).items()}
    if server_id == "jackyun":
        return {
            "native_type": "jackyun",
            "app_key": env.get("JACKYUN_APP_KEY", ""),
            "app_secret_set": bool(env.get("JACKYUN_APP_SECRET")),
            "base_url": env.get("JACKYUN_BASE_URL", "") or "https://open.jackyun.com/open/openapi/do",
            "method_inventory": env.get("JACKYUN_METHOD_INVENTORY", "") or "erp.stockquantity.get",
        }
    if server_id == "kingdee":
        return {
            "native_type": "kingdee",
            "base_url": env.get("KINGDEE_BASE_URL", ""),
            "acct_id": env.get("KINGDEE_ACCT_ID", ""),
            "username": env.get("KINGDEE_USERNAME", ""),
            "password_set": bool(env.get("KINGDEE_PASSWORD")),
            "lcid": env.get("KINGDEE_LCID", "") or "2052",
        }
    return {}


def merge_native_into_env(server_id: str, data: dict[str, Any], existing_env: dict[str, Any]) -> dict[str, str]:
    """把前端 native 字段写入 env；空密钥表示保留原值。"""
    env = {str(k): str(v) for k, v in (existing_env or {}).items() if v is not None}
    if server_id == "jackyun":
        mapping = {
            "app_key": "JACKYUN_APP_KEY",
            "base_url": "JACKYUN_BASE_URL",
            "method_inventory": "JACKYUN_METHOD_INVENTORY",
        }
        for form_key, env_key in mapping.items():
            if form_key in data and data[form_key] is not None:
                env[env_key] = str(data[form_key]).strip()
        secret = str(data.get("app_secret") or "").strip()
        if secret and secret not in ("******", "__KEEP__"):
            env["JACKYUN_APP_SECRET"] = secret
        elif "JACKYUN_APP_SECRET" not in env and data.get("app_secret_set"):
            pass
    elif server_id == "kingdee":
        mapping = {
            "base_url": "KINGDEE_BASE_URL",
            "acct_id": "KINGDEE_ACCT_ID",
            "username": "KINGDEE_USERNAME",
            "lcid": "KINGDEE_LCID",
        }
        for form_key, env_key in mapping.items():
            if form_key in data and data[form_key] is not None:
                env[env_key] = str(data[form_key]).strip()
        password = str(data.get("password") or "").strip()
        if password and password not in ("******", "__KEEP__"):
            env["KINGDEE_PASSWORD"] = password
    # 清理空值
    return {k: v for k, v in env.items() if str(v).strip() != ""}


def is_native_configured(server_id: str, env: dict[str, Any]) -> bool:
    env = {str(k): str(v) for k, v in (env or {}).items()}
    if server_id == "jackyun":
        return bool(env.get("JACKYUN_APP_KEY") and env.get("JACKYUN_APP_SECRET"))
    if server_id == "kingdee":
        return bool(
            env.get("KINGDEE_BASE_URL")
            and env.get("KINGDEE_ACCT_ID")
            and env.get("KINGDEE_USERNAME")
            and env.get("KINGDEE_PASSWORD")
        )
    return False
