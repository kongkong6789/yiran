from __future__ import annotations

from functools import wraps

from flask import jsonify, redirect, request, session, url_for

from ..auth import wechat
from ..storage import UserStore


def current_user() -> dict | None:
    openid = session.get("openid")
    if not openid:
        return None
    profile = UserStore(openid).get_profile()
    return profile or {"openid": openid, "nickname": session.get("nickname", "用户")}


def current_store() -> UserStore | None:
    user = current_user()
    return UserStore(user["openid"]) if user else None


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not current_user():
            if request.path.startswith("/api/"):
                return jsonify({"error": "未登录"}), 401
            return redirect(url_for("pages.login"))
        return view(*args, **kwargs)
    return wrapper


def register_auth_routes(app):
    @app.get("/auth/wechat/start")
    def auth_wechat_start():
        return jsonify(wechat.start_login())

    @app.get("/auth/wechat/poll")
    def auth_wechat_poll():
        state = request.args.get("state", "")
        return jsonify(wechat.poll_login(state))

    @app.post("/auth/wechat/claim")
    def auth_wechat_claim():
        body = request.get_json(silent=True) or {}
        state = str(body.get("state") or "")
        data = wechat.poll_login(state)
        if data.get("status") != "ok" or not data.get("user"):
            return jsonify({"ok": False, "error": "登录未完成或已过期"}), 400
        user = data["user"]
        session["openid"] = user["openid"]
        session["nickname"] = user.get("nickname", "微信用户")
        return jsonify({"ok": True, "user": user})

    @app.get("/auth/wechat/callback")
    def auth_wechat_callback():
        code = request.args.get("code", "")
        state = request.args.get("state", "")
        result = wechat.handle_callback(code, state)
        if result.get("ok"):
            return (
                "<html><body style='font-family:sans-serif;text-align:center;padding:40px'>"
                "<h2>微信登录成功</h2><p>请回到原页面,即将自动跳转…</p>"
                "<script>setTimeout(()=>location.href='/app', 800)</script></body></html>"
            )
        return redirect(url_for("pages.login", error=result.get("error", "登录失败")))

    @app.post("/auth/dev-login")
    def auth_dev_login():
        try:
            nickname = "本地用户"
            if request.is_json and isinstance(request.json, dict):
                nickname = request.json.get("nickname") or nickname
            user = wechat.dev_login(nickname)
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400
        session["openid"] = user["openid"]
        session["nickname"] = user["nickname"]
        return jsonify({"ok": True, "user": user})

    @app.post("/auth/logout")
    def auth_logout():
        session.clear()
        return jsonify({"ok": True})

    @app.get("/api/me")
    def api_me():
        user = current_user()
        if not user:
            return jsonify({"logged_in": False})
        store = UserStore(user["openid"])
        return jsonify({
            "logged_in": True,
            "user": user,
            "data_dir": str(store.root),
            "llm_configured": bool(store.read_llm().get("api_key")),
        })
