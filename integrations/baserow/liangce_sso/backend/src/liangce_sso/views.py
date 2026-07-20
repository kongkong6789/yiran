"""Liangce → Baserow one-time ticket exchange."""

from __future__ import annotations

import json
import logging
import os
import secrets
import urllib.error
import urllib.request
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import HttpResponse, HttpResponseBadRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from baserow.api.user.serializers import get_all_user_data_serialized
from baserow.core.handler import CoreHandler
from baserow.core.user.handler import UserHandler
from baserow.core.user.utils import generate_session_tokens_for_user, normalize_email_address

logger = logging.getLogger(__name__)
User = get_user_model()


def _cfg(name: str, default: str = "") -> str:
    return str(getattr(settings, name, "") or default).strip()


def _verify_and_consume(ticket: str) -> dict[str, Any]:
    """Ask Liangce platform to verify + consume the one-time ticket."""
    base = _cfg("LIANGCE_API_BASE", "http://127.0.0.1:8000/api").rstrip("/")
    secret = _cfg("LIANGCE_SSO_SHARED_SECRET")
    if not secret:
        raise RuntimeError("LIANGCE_SSO_SHARED_SECRET is not configured")

    payload = json.dumps({"ticket": ticket}).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/smarttable/baserow/sso-consume/",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Liangce-SSO-Secret": secret,
            "User-Agent": "liangce-baserow-sso/0.1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        logger.warning("Liangce SSO consume failed: %s %s", exc.code, body)
        raise ValueError(f"ticket rejected ({exc.code})") from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Liangce SSO consume error")
        raise ValueError(str(exc)) from exc

    if not data.get("ok"):
        raise ValueError(data.get("error") or "ticket invalid")
    return data


def _ensure_user(payload: dict[str, Any]):
    email = normalize_email_address(str(payload.get("email") or ""))
    if not email:
        # Stable synthetic email for platform users without email.
        uid = payload.get("user_id") or secrets.token_hex(4)
        email = normalize_email_address(f"user{uid}@liangce.local")

    name = str(payload.get("display_name") or payload.get("username") or email).strip()[:60]
    if len(name) < 2:
        name = email[:60]

    existing = User.objects.filter(username=email).first()
    if existing:
        if not existing.is_active:
            raise ValueError("user deactivated")
        # Keep profile in sync with platform display name.
        if existing.first_name != name:
            existing.first_name = name
            existing.save(update_fields=["first_name"])
        if hasattr(existing, "profile") and not existing.profile.email_verified:
            existing.profile.email_verified = True
            existing.profile.completed_onboarding = True
            existing.profile.save(update_fields=["email_verified", "completed_onboarding"])
        return existing

    password = secrets.token_urlsafe(32)
    # Bypass public signup gates for SSO provisioning.
    settings_obj = CoreHandler().get_settings()
    previous = settings_obj.allow_new_signups
    try:
        if not previous:
            settings_obj.allow_new_signups = True
            settings_obj.save(update_fields=["allow_new_signups"])
        user = UserHandler().create_user(
            name=name,
            email=email,
            password=password,
            language="zh-CN",
        )
    finally:
        if not previous:
            settings_obj.allow_new_signups = previous
            settings_obj.save(update_fields=["allow_new_signups"])

    user.profile.email_verified = True
    user.profile.completed_onboarding = True
    user.profile.save(update_fields=["email_verified", "completed_onboarding"])
    return user


def _login_payload(request, user) -> dict[str, Any]:
    data = generate_session_tokens_for_user(
        user,
        include_refresh_token=True,
        verified_email_claim="enforced",
    )
    data.update(**get_all_user_data_serialized(user, request))
    return data


@csrf_exempt
@require_POST
def embedded_bootstrap(request):
    """Open Baserow as a built-in, shared Liangce module without a login page.

    This endpoint deliberately provisions one local workspace user. It is only
    enabled by LIANGCE_EMBEDDED_MODE and must not be exposed as a public Baserow
    installation.
    """
    if os.getenv("LIANGCE_EMBEDDED_MODE", "no").lower() not in {"1", "true", "yes", "on"}:
        return JsonResponse({"ok": False, "error": "embedded mode disabled"}, status=403)

    try:
        user = _ensure_user(
            {
                "user_id": "embedded",
                "username": "智能表格",
                "email": os.getenv(
                    "LIANGCE_EMBEDDED_USER_EMAIL",
                    "smarttable@liangce.local",
                ),
                "display_name": "良策智能表格",
            }
        )
        data = _login_payload(request, user)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Embedded Baserow bootstrap failed")
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)

    return JsonResponse({"ok": True, **data})


@csrf_exempt
@require_POST
def exchange_ticket(request):
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"ok": False, "error": "invalid json"}, status=400)

    ticket = str(body.get("ticket") or "").strip()
    if not ticket:
        return JsonResponse({"ok": False, "error": "ticket required"}, status=400)

    try:
        platform_user = _verify_and_consume(ticket)
        user = _ensure_user(platform_user)
        data = _login_payload(request, user)
    except ValueError as exc:
        return JsonResponse({"ok": False, "error": str(exc)}, status=401)
    except Exception as exc:  # noqa: BLE001
        logger.exception("SSO exchange failed")
        return JsonResponse({"ok": False, "error": str(exc)}, status=500)

    return JsonResponse({"ok": True, **data})


@csrf_exempt
@require_GET
def login_redirect(request):
    """
    Browser entry: /api/liangce-sso/login/?ticket=...
    Validates ticket, sets Baserow auth cookies, redirects to frontend.
    """
    ticket = str(request.GET.get("ticket") or "").strip()
    if not ticket:
        return HttpResponseBadRequest("missing ticket")

    try:
        platform_user = _verify_and_consume(ticket)
        user = _ensure_user(platform_user)
        data = _login_payload(request, user)
    except ValueError as exc:
        return HttpResponse(f"SSO failed: {exc}", status=401, content_type="text/plain; charset=utf-8")
    except Exception as exc:  # noqa: BLE001
        logger.exception("SSO login redirect failed")
        return HttpResponse(f"SSO error: {exc}", status=500, content_type="text/plain; charset=utf-8")

    frontend = _cfg("PUBLIC_WEB_FRONTEND_URL", "http://127.0.0.1:3001").rstrip("/")
    # Tiny HTML bridge so cookies are set from the Baserow frontend origin via postMessage fallback.
    # Primary path: set cookies on backend host then redirect; frontend also accepts jwt_token cookie.
    refresh = data.get("refresh_token") or ""
    user_session = data.get("user_session") or ""
    access = data.get("access_token") or data.get("token") or ""

    html = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>正在进入智能表格…</title></head>
<body style="font-family:sans-serif;padding:40px;background:#fff;color:#111">
<p>正在进入良策智能表格…</p>
<script>
(function () {{
  var refresh = {json.dumps(refresh)};
  var session = {json.dumps(user_session)};
  var access = {json.dumps(access)};
  var target = {json.dumps(frontend + "/")};
  try {{
    // Baserow frontend reads jwt_token cookie as refresh token.
    document.cookie = "jwt_token=" + encodeURIComponent(refresh) + "; path=/; max-age=604800; SameSite=Lax";
    if (session) {{
      document.cookie = "user_session=" + encodeURIComponent(session) + "; path=/; max-age=604800; SameSite=Lax";
    }}
    localStorage.setItem("baserow_liangce_bootstrap", JSON.stringify({{
      refresh_token: refresh,
      access_token: access,
      user_session: session
    }}));
  }} catch (e) {{}}
  window.location.replace(target);
}})();
</script>
</body></html>"""
    resp = HttpResponse(html, content_type="text/html; charset=utf-8")
    # Also attempt Set-Cookie on API host (useful when FE/BE share parent domain).
    resp.set_cookie("jwt_token", refresh, max_age=604800, path="/", samesite="Lax")
    if user_session:
        resp.set_cookie("user_session", user_session, max_age=604800, path="/", samesite="Lax")
    return resp
