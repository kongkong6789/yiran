"""微信开放平台扫码登录。"""
from __future__ import annotations

import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .. import config
from ..storage import AuthStateStore, UserStore

_auth_states = AuthStateStore()


def wechat_enabled() -> bool:
    return bool(config.WECHAT_APP_ID and config.WECHAT_APP_SECRET)


def build_qrconnect_url(state: str) -> str:
    params = urllib.parse.urlencode({
        "appid": config.WECHAT_APP_ID,
        "redirect_uri": config.WECHAT_REDIRECT_URI,
        "response_type": "code",
        "scope": "snsapi_login",
        "state": state,
    })
    return f"https://open.weixin.qq.com/connect/qrconnect?{params}#wechat_redirect"


def start_login() -> dict[str, Any]:
    state = _auth_states.create()
    if wechat_enabled():
        return {
            "mode": "wechat",
            "state": state,
            "appid": config.WECHAT_APP_ID,
            "redirect_uri": config.WECHAT_REDIRECT_URI,
            "qr_url": build_qrconnect_url(state),
        }
    return {"mode": "dev", "state": state, "message": "未配置微信 AppID,请使用本地开发登录"}


def poll_login(state: str) -> dict[str, Any]:
    data = _auth_states.get(state)
    if not data:
        return {"status": "expired"}
    return data


def _http_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


def exchange_code(code: str) -> dict[str, Any]:
    token_url = (
        "https://api.weixin.qq.com/sns/oauth2/access_token?"
        + urllib.parse.urlencode({
            "appid": config.WECHAT_APP_ID,
            "secret": config.WECHAT_APP_SECRET,
            "code": code,
            "grant_type": "authorization_code",
        })
    )
    token_data = _http_json(token_url)
    if token_data.get("errcode"):
        raise ValueError(token_data.get("errmsg") or "微信授权失败")

    openid = token_data["openid"]
    access_token = token_data["access_token"]
    userinfo_url = (
        "https://api.weixin.qq.com/sns/userinfo?"
        + urllib.parse.urlencode({
            "access_token": access_token,
            "openid": openid,
            "lang": "zh_CN",
        })
    )
    try:
        profile = _http_json(userinfo_url)
    except (urllib.error.URLError, json.JSONDecodeError):
        profile = {"openid": openid, "nickname": "微信用户"}

    user = {
        "openid": openid,
        "nickname": profile.get("nickname") or "微信用户",
        "avatar": profile.get("headimgurl") or "",
        "unionid": profile.get("unionid") or "",
    }
    store = UserStore(openid)
    store.save_profile(user)
    return user


def handle_callback(code: str, state: str) -> dict[str, Any]:
    try:
        user = exchange_code(code)
        _auth_states.complete(state, user)
        return {"ok": True, "user": user}
    except ValueError as exc:
        _auth_states.fail(state, str(exc))
        return {"ok": False, "error": str(exc)}


def dev_login(nickname: str = "本地用户") -> dict[str, Any]:
    if not config.ALLOW_DEV_LOGIN:
        raise ValueError("本地开发登录已禁用")
    openid = f"dev_{secrets.token_hex(8)}"
    user = {"openid": openid, "nickname": nickname or "本地用户", "avatar": "", "unionid": ""}
    UserStore(openid).save_profile(user)
    return user
