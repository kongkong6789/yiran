from __future__ import annotations

from dataclasses import dataclass
import hashlib
import logging

import requests
from django.core.cache import cache

from .models import WeComApiConfig


WECOM_API_BASE = "https://qyapi.weixin.qq.com/cgi-bin"
REQUEST_TIMEOUT_SECONDS = 12
TOKEN_TTL_SECONDS = 7000
TOKEN_ERROR_CODES = {40014, 42001}
PERMISSION_ERROR_CODES = {48002, 60011, 60020, 60023}
NOT_FOUND_CODES = {46004, 60111}
RATE_LIMIT_CODES = {45009}

logger = logging.getLogger(__name__)

USER_NOT_FOUND_DETAIL = "未在企业微信通讯录中找到该成员，请确认手机号与企业微信一致，并检查应用可见范围。"


def user_friendly_wecom_error(code: str, detail: str) -> str:
    """把数据库中的历史上游错误转换成可直接展示的中文业务原因。"""
    normalized = str(detail or "").strip()
    lowered = normalized.lower()
    if code == "WEWORK_USER_NOT_FOUND" or "user no exist" in lowered or "46004" in lowered:
        return USER_NOT_FOUND_DETAIL
    known = {
        "WEWORK_NO_PERMISSION": "企业微信应用没有通讯录权限，或该成员不在应用可见范围内，请联系企业管理员处理。",
        "WEWORK_RATE_LIMITED": "企业微信请求较多，系统稍后会自动重试。",
        "WEWORK_NETWORK_ERROR": "企业微信服务暂时无法连接，系统稍后会自动重试。",
        "WEWORK_TEMPORARY_ERROR": "企业微信服务暂时不可用，系统稍后会自动重试。",
        "TOKEN_EXPIRED": "企业微信访问凭证已失效，系统正在重新获取。",
    }
    if code in known:
        return known[code]
    if any(marker in lowered for marker in ("hint:", "from ip:", "devtool/query", "more info at")):
        return "企业微信接口调用失败，请联系企业管理员检查应用配置和通讯录权限。"
    return normalized or "企业微信账号匹配失败，请稍后重试。"


@dataclass
class WeComApiError(Exception):
    code: str
    detail: str
    status_code: int = 502
    retryable: bool = False
    upstream_code: int | None = None

    def __str__(self) -> str:
        return self.detail


def _classify_error(payload: dict) -> WeComApiError | None:
    errcode = int(payload.get("errcode", 0) or 0)
    if not errcode:
        return None
    errmsg = str(payload.get("errmsg", "企业微信接口调用失败"))
    logger.warning("WeCom API rejected request: errcode=%s errmsg=%s", errcode, errmsg)
    if errcode in TOKEN_ERROR_CODES:
        return WeComApiError("TOKEN_EXPIRED", "企业微信访问凭证已失效。", retryable=True, upstream_code=errcode)
    if errcode in PERMISSION_ERROR_CODES:
        return WeComApiError("WEWORK_NO_PERMISSION", "企业微信应用没有读取该成员的权限。", upstream_code=errcode)
    if errcode in NOT_FOUND_CODES:
        return WeComApiError("WEWORK_USER_NOT_FOUND", USER_NOT_FOUND_DETAIL, upstream_code=errcode)
    if errcode in RATE_LIMIT_CODES:
        return WeComApiError("WEWORK_RATE_LIMITED", "企业微信接口请求频繁，请稍后重试。", retryable=True, upstream_code=errcode)
    if 50000 <= errcode < 60000:
        return WeComApiError("WEWORK_TEMPORARY_ERROR", "企业微信服务暂时不可用，请稍后重试。", retryable=True, upstream_code=errcode)
    return WeComApiError(
        "WEWORK_API_ERROR",
        "企业微信接口调用失败，请联系企业管理员检查应用配置和权限。",
        upstream_code=errcode,
    )


def _parse_response(response) -> dict:
    try:
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise WeComApiError("WEWORK_NETWORK_ERROR", "企业微信接口暂时不可用，请稍后重试。", retryable=True) from exc
    error = _classify_error(payload)
    if error:
        raise error
    return payload


def _get_json(path: str, params: dict[str, object]) -> dict:
    try:
        response = requests.get(f"{WECOM_API_BASE}/{path.lstrip('/')}", params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise WeComApiError("WEWORK_NETWORK_ERROR", "企业微信接口暂时不可用，请稍后重试。", retryable=True) from exc
    return _parse_response(response)


def _post_json(path: str, params: dict[str, object], body: dict[str, object]) -> dict:
    try:
        response = requests.post(
            f"{WECOM_API_BASE}/{path.lstrip('/')}",
            params=params,
            json=body,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise WeComApiError("WEWORK_NETWORK_ERROR", "企业微信接口暂时不可用，请稍后重试。", retryable=True) from exc
    return _parse_response(response)


class WeComClient:
    """企业微信 API 统一入口；token 按用户配置缓存，异常不包含 Secret/token。"""

    def __init__(self, config: WeComApiConfig):
        self.config = config

    @property
    def token_cache_key(self) -> str:
        stamp = int(self.config.updated_at.timestamp()) if self.config.updated_at else 0
        identity = str(self.config.pk) if self.config.pk else hashlib.sha256(f"{self.config.corp_id}:{self.config.agent_id}".encode()).hexdigest()[:16]
        return f"wecom:access-token:{identity}:{stamp}"

    def clear_access_token(self) -> None:
        cache.delete(self.token_cache_key)

    def get_access_token(self, force_refresh: bool = False) -> str:
        if not self.config.configured or not self.config.secret:
            raise WeComApiError("WECOM_NOT_CONFIGURED", "请先配置企业微信 API。", status_code=409)
        if not force_refresh:
            cached = cache.get(self.token_cache_key)
            if cached:
                return str(cached)
        payload = _get_json("gettoken", {"corpid": self.config.corp_id, "corpsecret": self.config.secret})
        token = str(payload.get("access_token", ""))
        if not token:
            raise WeComApiError("TOKEN_MISSING", "企业微信未返回访问凭证。", retryable=True)
        expires_in = max(60, int(payload.get("expires_in", 7200) or 7200) - 200)
        cache.set(self.token_cache_key, token, min(TOKEN_TTL_SECONDS, expires_in))
        return token

    def _token_call(self, method: str, path: str, *, params: dict[str, object] | None = None, body: dict[str, object] | None = None) -> dict:
        for attempt in range(2):
            token = self.get_access_token(force_refresh=attempt > 0)
            call_params = {"access_token": token, **(params or {})}
            try:
                return _post_json(path, call_params, body or {}) if method == "POST" else _get_json(path, call_params)
            except WeComApiError as exc:
                if exc.upstream_code in TOKEN_ERROR_CODES and attempt == 0:
                    self.clear_access_token()
                    continue
                raise
        raise WeComApiError("TOKEN_EXPIRED", "企业微信访问凭证已失效。", retryable=True)

    def get_wecom_userid_by_mobile(self, mobile: str) -> str:
        payload = self._token_call("POST", "user/getuserid", body={"mobile": mobile})
        user_id = str(payload.get("userid", "")).strip()
        if not user_id:
            raise WeComApiError("WEWORK_USER_NOT_FOUND", "企业微信中未查询到该手机号对应的成员。")
        return user_id

    def get_wecom_user(self, user_id: str) -> dict:
        payload = self._token_call("GET", "user/get", params={"userid": user_id})
        avatar = str(payload.get("avatar") or payload.get("thumb_avatar") or "").strip()
        if avatar.startswith("http://"):
            avatar = f"https://{avatar[7:]}"
        return {
            "userid": str(payload.get("userid", user_id)),
            "name": str(payload.get("name", "")),
            "status": int(payload.get("status", 1) or 1),
            "department": payload.get("department", []),
            "position": str(payload.get("position", "")),
            "avatar": avatar,
        }

    def test_wecom_connection(self) -> dict:
        payload = self._token_call("GET", "agent/get", params={"agentid": self.config.agent_id})
        return {"ok": True, "appName": str(payload.get("name", "企业微信自建应用"))}

    def send_app_text(self, user_ids: list[str], content: str) -> dict:
        recipients = [str(item).strip() for item in user_ids if str(item).strip()]
        if not recipients:
            raise WeComApiError("WECOM_RECIPIENT_REQUIRED", "请选择企业微信接收成员。", status_code=400)
        agent_id: int | str = int(self.config.agent_id) if self.config.agent_id.isdigit() else self.config.agent_id
        payload = self._token_call("POST", "message/send", body={
            "touser": "|".join(dict.fromkeys(recipients)),
            "msgtype": "text",
            "agentid": agent_id,
            "text": {"content": content},
            "safe": 0,
            "enable_id_trans": 0,
            "enable_duplicate_check": 1,
            "duplicate_check_interval": 1800,
        })
        invalid = [item for item in str(payload.get("invaliduser", "")).split("|") if item]
        return {"msgid": str(payload.get("msgid", "")), "invalidUsers": invalid}

    def get_visible_contacts(self) -> list[dict]:
        departments_payload = self._token_call("GET", "department/list")
        departments = {
            int(item.get("id")): str(item.get("name", ""))
            for item in departments_payload.get("department", [])
            if item.get("id") is not None
        }
        members_payload = self._token_call("GET", "user/list", params={"department_id": 1, "fetch_child": 1})
        contacts = []
        avatar_from_list = 0
        avatar_from_detail = 0
        avatar_missing = 0
        detail_errors: dict[str, int] = {}
        for member in members_payload.get("userlist", []):
            user_id = str(member.get("userid", "")).strip()
            if not user_id:
                continue
            department_ids = [int(value) for value in member.get("department", [])]
            # 企业微信自 2022-08-15 起，user/list 不再返回 avatar，需回退到 user/get 逐个读取。
            avatar = str(member.get("avatar") or member.get("thumb_avatar") or "").strip()
            if avatar.startswith("http://"):
                avatar = f"https://{avatar[7:]}"
            if avatar:
                avatar_from_list += 1
            else:
                try:
                    detail = self.get_wecom_user(user_id)
                    avatar = str(detail.get("avatar") or "")
                    if avatar:
                        avatar_from_detail += 1
                    else:
                        avatar_missing += 1
                except WeComApiError as exc:
                    # 头像属于可选资料；单个成员详情不可见时仍保存基础通讯录，但记录原因便于排查。
                    avatar = ""
                    key = f"{exc.code}:{exc.upstream_code}"
                    detail_errors[key] = detail_errors.get(key, 0) + 1
            contacts.append({
                "key": f"wecom:{user_id}",
                "name": str(member.get("name", "") or user_id),
                "department": " / ".join(departments[value] for value in department_ids if departments.get(value)),
                "departmentIds": department_ids,
                "weComUserId": user_id,
                "position": str(member.get("position", "")),
                "avatar": avatar,
                "available": int(member.get("status", 1) or 1) == 1,
                "source": "wecom",
            })
        logger.info(
            "WeCom contact sync: config=%s members=%s avatar_from_list=%s avatar_from_detail=%s "
            "avatar_missing=%s detail_errors=%s",
            self.config.pk,
            len(contacts),
            avatar_from_list,
            avatar_from_detail,
            avatar_missing,
            detail_errors or "{}",
        )
        if detail_errors:
            logger.warning(
                "WeCom avatar fetch via user/get failed for some members (config=%s): %s. "
                "常见原因：应用无「通讯录」权限或成员不在应用可见范围。",
                self.config.pk,
                detail_errors,
            )
        return sorted(contacts, key=lambda item: (item["department"], item["name"]))


def get_access_token(config: WeComApiConfig) -> str:
    return WeComClient(config).get_access_token()


def get_visible_contacts(config: WeComApiConfig) -> list[dict]:
    return WeComClient(config).get_visible_contacts()


def send_group_webhook_text(webhook_key: str, content: str) -> dict:
    key = str(webhook_key or "").strip()
    if not key:
        raise WeComApiError("WECOM_WEBHOOK_NOT_CONFIGURED", "群机器人 Webhook 未配置。", status_code=409)
    try:
        response = requests.post(
            f"{WECOM_API_BASE}/webhook/send",
            params={"key": key},
            json={"msgtype": "text", "text": {"content": content}},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise WeComApiError("WEWORK_NETWORK_ERROR", "企业微信群机器人暂时不可用，请稍后重试。", retryable=True) from exc
    return _parse_response(response)


def send_group_webhook_markdown(webhook_key: str, content: str) -> dict:
    key = str(webhook_key or "").strip()
    if not key:
        raise WeComApiError("WECOM_WEBHOOK_NOT_CONFIGURED", "群机器人 Webhook 未配置。", status_code=409)
    try:
        response = requests.post(
            f"{WECOM_API_BASE}/webhook/send",
            params={"key": key},
            json={"msgtype": "markdown", "markdown": {"content": str(content)[:4096]}},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise WeComApiError("WEWORK_NETWORK_ERROR", "企业微信群机器人暂时不可用，请稍后重试。", retryable=True) from exc
    return _parse_response(response)
