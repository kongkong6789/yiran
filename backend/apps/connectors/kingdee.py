"""
金蝶云星空 (K3Cloud) 只读连接器骨架。

配置（backend/.env）：
  KINGDEE_BASE_URL=http://host/k3cloud
  KINGDEE_ACCT_ID=账套 ID
  KINGDEE_USERNAME=账号
  KINGDEE_PASSWORD=密码
  KINGDEE_LCID=2052   # 简体中文

未配齐账号密码时，协作/小策会明确提示缺凭据，不走 Mock 假数。
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urljoin, urlparse

from django.conf import settings

from .base import BaseConnector, MockConnector
from .credentials import cfg_value


def _cfg(name: str, default: str = "") -> str:
    return cfg_value(name, default)


def kingdee_configured() -> bool:
    return bool(
        _cfg("KINGDEE_BASE_URL")
        and _cfg("KINGDEE_ACCT_ID")
        and _cfg("KINGDEE_USERNAME")
        and _cfg("KINGDEE_PASSWORD")
    )


def kingdee_partial_config() -> dict[str, bool]:
    return {
        "base_url": bool(_cfg("KINGDEE_BASE_URL")),
        "acct_id": bool(_cfg("KINGDEE_ACCT_ID")),
        "username": bool(_cfg("KINGDEE_USERNAME")),
        "password": bool(_cfg("KINGDEE_PASSWORD")),
    }


class KingdeeError(RuntimeError):
    """金蝶调用失败（不回传密码）。"""


class KingdeeConnector(BaseConnector):
    key = "kingdee"
    name = "金蝶"

    def execute(self, action: str, payload: dict) -> dict:
        if action in ("kingdee.status", "kingdee.probe"):
            return kingdee_status(probe=True)
        if action in ("kingdee.query", "kingdee.bill_query"):
            return execute_bill_query(
                form_id=str(payload.get("form_id") or payload.get("FormId") or ""),
                field_keys=str(payload.get("field_keys") or payload.get("FieldKeys") or ""),
                filter_string=str(payload.get("filter_string") or payload.get("FilterString") or ""),
                top_row_count=int(payload.get("top_row_count") or payload.get("TopRowCount") or 20),
            )
        # 写动作暂不开放
        mock = MockConnector(self.key, self.name)
        result = mock.execute(action, payload)
        result["note"] = "金蝶写动作暂未开放；只读请用 status / bill_query"
        result["configured"] = kingdee_configured()
        return result


def _base_url() -> str:
    base = _cfg("KINGDEE_BASE_URL", "").rstrip("/") + "/"
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise KingdeeError("KINGDEE_BASE_URL 无效")
    return base


def _api_url(service: str) -> str:
    # 兼容 /k3cloud 与带尾斜杠
    return urljoin(_base_url(), service.lstrip("/"))


def _post_json(url: str, body: dict, *, cookie: str = "") -> tuple[dict, str]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json;charset=utf-8",
        "User-Agent": "LiangceAgent/1.0 (K3Cloud)",
    }
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    timeout = max(5, int(getattr(settings, "KINGDEE_API_TIMEOUT", 30)))
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        set_cookie = resp.headers.get("Set-Cookie") or cookie
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw[:2000]}
        return parsed if isinstance(parsed, dict) else {"data": parsed}, set_cookie


def login() -> dict[str, Any]:
    if not kingdee_configured():
        missing = [k for k, ok in kingdee_partial_config().items() if not ok]
        raise KingdeeError(f"金蝶凭据未配齐，缺少：{', '.join(missing)}")
    url = _api_url("Kingdee.BOS.WebApi.ServicesStub.AuthService.ValidateUser.common.kdsvc")
    body = {
        "acctID": _cfg("KINGDEE_ACCT_ID"),
        "username": _cfg("KINGDEE_USERNAME"),
        "password": _cfg("KINGDEE_PASSWORD"),
        "lcid": int(_cfg("KINGDEE_LCID", "2052") or "2052"),
    }
    try:
        result, cookie = _post_json(url, body)
    except urllib.error.HTTPError as exc:
        raise KingdeeError(f"金蝶登录 HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise KingdeeError(f"金蝶登录网络失败：{exc}") from exc

    # ValidateUser 常见返回 LoginResultType==1 表示成功
    login_type = result.get("LoginResultType", result.get("loginResultType"))
    if login_type not in (1, "1", True) and result.get("IsSuccessByAPI") is not True:
        msg = (
            result.get("Message")
            or result.get("message")
            or result.get("Msg")
            or "登录失败"
        )
        raise KingdeeError(f"金蝶登录失败：{msg}")
    return {"ok": True, "cookie": cookie, "raw": {k: v for k, v in result.items() if k.lower() != "password"}}


def execute_bill_query(
    *,
    form_id: str,
    field_keys: str,
    filter_string: str = "",
    top_row_count: int = 20,
) -> dict:
    """只读单据查询（ExecuteBillQuery）。"""
    form_id = (form_id or "").strip()
    field_keys = (field_keys or "").strip()
    if not form_id or not field_keys:
        raise KingdeeError("form_id 与 field_keys 必填")
    auth = login()
    url = _api_url("Kingdee.BOS.WebApi.ServicesStub.DynamicFormService.ExecuteBillQuery.common.kdsvc")
    payload = {
        "data": {
            "FormId": form_id,
            "FieldKeys": field_keys,
            "FilterString": filter_string or "",
            "OrderString": "",
            "TopRowCount": max(1, min(100, int(top_row_count))),
            "StartRow": 0,
            "Limit": max(1, min(100, int(top_row_count))),
        }
    }
    try:
        result, _ = _post_json(url, payload, cookie=auth.get("cookie") or "")
    except urllib.error.HTTPError as exc:
        raise KingdeeError(f"金蝶查询 HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise KingdeeError(f"金蝶查询网络失败：{exc}") from exc
    return {
        "ok": True,
        "connector": "kingdee",
        "mode": "live",
        "form_id": form_id,
        "result": result,
    }


def kingdee_status(*, probe: bool = False) -> dict:
    partial = kingdee_partial_config()
    configured = kingdee_configured()
    out: dict[str, Any] = {
        "configured": configured,
        "partial": partial,
        "base_url": _cfg("KINGDEE_BASE_URL"),
        "acct_id": _cfg("KINGDEE_ACCT_ID"),
        "lcid": int(_cfg("KINGDEE_LCID", "2052") or "2052"),
        "username_set": partial["username"],
        "auth_type": "k3cloud_validate_user",
        "read_only": True,
        "reachable": None,
    }
    if probe and configured:
        try:
            login()
            out["reachable"] = True
        except Exception as exc:
            out["reachable"] = False
            out["error"] = str(exc)
    elif probe and not configured:
        out["reachable"] = False
        out["error"] = "缺少账号或密码等凭据"
    return out


def kingdee_block(question: str) -> str:
    """协作/小策知识汇聚：金蝶意图证据块。"""
    q = (question or "").lower()
    triggers = (
        "金蝶", "kingdee", "k3cloud", "k3", "凭证", "应收", "应付", "总账",
        "科目", "账套", "财务对账", "余额表",
    )
    if not any(t.lower() in q for t in triggers):
        return ""
    status = kingdee_status(probe=False)
    if not status["configured"]:
        missing = [k for k, ok in (status.get("partial") or {}).items() if not ok]
        return (
            "【金蝶·配置】已登记服务器与账套，但凭据未配齐，无法实时查询。\n"
            f"- 地址：{status.get('base_url') or '（未配）'}\n"
            f"- 账套：{status.get('acct_id') or '（未配）'}\n"
            f"- LCID：{status.get('lcid')}\n"
            f"- 缺少：{', '.join(missing) or '未知'}\n"
            "- 请在 backend/.env 填写 KINGDEE_USERNAME / KINGDEE_PASSWORD 后重启服务。"
        )
    try:
        probe = kingdee_status(probe=True)
        if probe.get("reachable"):
            return (
                "【金蝶·连通】登录探测成功（ValidateUser）。\n"
                f"- 地址：{probe.get('base_url')}\n"
                f"- 账套：{probe.get('acct_id')}\n"
                "- 说明：已可做只读单据查询；具体科目/凭证请说明 FormId 或业务单据类型。"
            )
        return f"【金蝶·连通失败】{probe.get('error') or '未知错误'}"
    except Exception as exc:
        return f"【金蝶】探测异常：{exc}"
