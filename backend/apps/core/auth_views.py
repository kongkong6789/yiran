"""账号注册 / 登录 / 个人设置 API。"""
from __future__ import annotations

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import UserSettings

User = get_user_model()


def _user_payload(user) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email or "",
        "is_staff": bool(user.is_staff or user.is_superuser),
        "is_superuser": bool(user.is_superuser),
    }


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    username = str(request.data.get("username") or "").strip()
    password = str(request.data.get("password") or "")
    email = str(request.data.get("email") or "").strip()
    if not username or not password:
        return Response({"ok": False, "error": "用户名和密码不能为空"}, status=400)
    if User.objects.filter(username=username).exists():
        return Response({"ok": False, "error": "用户名已存在"}, status=400)
    try:
        validate_password(password, user=User(username=username, email=email))
    except ValidationError as exc:
        return Response({"ok": False, "error": " ".join(exc.messages)}, status=400)

    user = User.objects.create_user(username=username, password=password, email=email)
    UserSettings.objects.create(user=user)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"ok": True, "token": token.key, "user": _user_payload(user)}, status=201)


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    username = str(request.data.get("username") or "").strip()
    password = str(request.data.get("password") or "")
    user = authenticate(request, username=username, password=password)
    if not user:
        return Response({"ok": False, "error": "用户名或密码错误"}, status=400)
    UserSettings.objects.get_or_create(user=user)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"ok": True, "token": token.key, "user": _user_payload(user)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    Token.objects.filter(user=request.user).delete()
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    settings, _ = UserSettings.objects.get_or_create(user=request.user)
    return Response({
        "ok": True,
        "user": _user_payload(request.user),
        "settings": {
            "llm_configured": bool(settings.llm_api_key),
            "llm_base_url": settings.llm_base_url or "",
            "llm_model": settings.llm_model or "",
        },
    })


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def user_settings(request):
    settings, _ = UserSettings.objects.get_or_create(user=request.user)
    if request.method == "GET":
        return Response({
            "llm_api_key": "***" if settings.llm_api_key else "",
            "llm_base_url": settings.llm_base_url or "",
            "llm_model": settings.llm_model or "",
            "configured": bool(settings.llm_api_key),
        })
    body = request.data or {}
    if "llm_api_key" in body and body.get("llm_api_key") not in (None, "", "***"):
        settings.llm_api_key = str(body.get("llm_api_key") or "").strip()
    if body.get("llm_base_url") is not None:
        settings.llm_base_url = str(body.get("llm_base_url") or "").strip()
    if body.get("llm_model") is not None:
        settings.llm_model = str(body.get("llm_model") or "").strip()
    settings.save()
    return Response({"ok": True, "configured": bool(settings.llm_api_key)})
