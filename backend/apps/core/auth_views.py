"""账号注册 / 登录 / 个人信息 API。"""
from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path

from django.conf import settings as django_settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db.models import Q
from django.http import FileResponse, Http404, HttpResponse
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import UserSettings
from apps.wecom.phone import mask_phone

User = get_user_model()

AVATAR_MAX_BYTES = 5 * 1024 * 1024
AVATAR_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def _profiles_root() -> Path:
    root = Path(getattr(django_settings, "PROFILE_AVATARS_ROOT", django_settings.BASE_DIR / "profile_avatars"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def _wecom_binding_summary(user) -> dict:
    from apps.wecom.models import UserWeComBinding

    binding = UserWeComBinding.objects.filter(platform_user=user).first()
    if not binding:
        return {
            "status": "pending",
            "statusLabel": "待匹配",
            "weComUserId": "",
            "failureReason": "",
        }
    return {
        "status": binding.status,
        "statusLabel": binding.get_status_display(),
        "weComUserId": binding.wecom_userid or "",
        "failureReason": binding.failure_reason or "",
    }


def _settings_payload(row: UserSettings) -> dict:
    return {
        "display_name": row.display_name or "",
        "bio": row.bio or "",
        "methodology": row.methodology or "",
        "avatar": row.avatar or "",
        "avatar_url": row.avatar_url,
        "llm_api_key": "***" if row.llm_api_key else "",
        "llm_base_url": row.llm_base_url or "",
        "llm_model": row.llm_model or "",
        "configured": bool(row.llm_api_key),
        "phone_masked": mask_phone(row.phone),
        "wecom_binding": _wecom_binding_summary(row.user),
    }


def _user_payload(user, settings: UserSettings | None = None) -> dict:
    if settings is None:
        settings, _ = UserSettings.objects.get_or_create(user=user)
    display = (settings.display_name or "").strip() or user.username
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email or "",
        "display_name": display,
        "bio": settings.bio or "",
        "methodology": settings.methodology or "",
        "avatar_url": settings.avatar_url,
        "is_staff": bool(user.is_staff or user.is_superuser),
        "is_superuser": bool(user.is_superuser),
    }


@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    username = str(request.data.get("username") or "").strip()
    password = str(request.data.get("password") or "")
    email = str(request.data.get("email") or "").strip()
    phone = str(request.data.get("phone") or "").strip()
    if not username or not password:
        return Response({"ok": False, "error": "用户名和密码不能为空"}, status=400)
    if User.objects.filter(username=username).exists():
        return Response({"ok": False, "error": "用户名已存在"}, status=400)
    try:
        validate_password(password, user=User(username=username, email=email))
    except ValidationError as exc:
        return Response({"ok": False, "error": " ".join(exc.messages)}, status=400)

    user = User.objects.create_user(username=username, password=password, email=email)
    UserSettings.objects.create(user=user, phone=phone)
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
        "user": _user_payload(request.user, settings),
        "settings": {
            "llm_configured": bool(settings.llm_api_key),
            "llm_base_url": settings.llm_base_url or "",
            "llm_model": settings.llm_model or "",
            "display_name": settings.display_name or "",
            "bio": settings.bio or "",
            "methodology": settings.methodology or "",
            "avatar_url": settings.avatar_url,
        },
    })


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def user_settings(request):
    settings, _ = UserSettings.objects.get_or_create(user=request.user)
    if request.method == "GET":
        return Response(_settings_payload(settings))

    body = request.data or {}
    if body.get("display_name") is not None:
        settings.display_name = str(body.get("display_name") or "").strip()[:64]
    if body.get("bio") is not None:
        settings.bio = str(body.get("bio") or "").strip()[:200]
    if body.get("methodology") is not None:
        settings.methodology = str(body.get("methodology") or "").strip()[:4000]
    if "llm_api_key" in body and body.get("llm_api_key") not in (None, "", "***"):
        settings.llm_api_key = str(body.get("llm_api_key") or "").strip()
    if body.get("llm_base_url") is not None:
        settings.llm_base_url = str(body.get("llm_base_url") or "").strip()
    if body.get("llm_model") is not None:
        settings.llm_model = str(body.get("llm_model") or "").strip()
    phone_updated = False
    if "phone" in body:
        settings.phone = str(body.get("phone") or "").strip()[:32]
        phone_updated = True
    settings.save()
    wecom_sync_triggered = phone_updated and bool(getattr(settings, "_wecom_phone_changed", False))
    return Response({
        "ok": True,
        "configured": bool(settings.llm_api_key),
        "wecom_sync_triggered": wecom_sync_triggered,
        "user": _user_payload(request.user, settings),
        **{k: v for k, v in _settings_payload(settings).items() if k != "llm_api_key"},
        "llm_api_key": "***" if settings.llm_api_key else "",
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_avatar(request):
    """上传个人头像。"""
    upload = request.FILES.get("file") or request.FILES.get("avatar")
    if not upload:
        return Response({"ok": False, "error": "请选择图片文件"}, status=400)
    name = (getattr(upload, "name", "") or "avatar.png").replace("\\", "/").split("/")[-1]
    ext = Path(name).suffix.lower()
    if ext not in AVATAR_EXTS:
        return Response({"ok": False, "error": "仅支持 png/jpg/gif/webp"}, status=400)
    data = upload.read()
    if len(data) > AVATAR_MAX_BYTES:
        return Response({"ok": False, "error": "头像不能超过 5MB"}, status=400)

    settings, _ = UserSettings.objects.get_or_create(user=request.user)
    stored = f"u{request.user.id}_{uuid.uuid4().hex[:12]}{ext}"
    path = _profiles_root() / stored
    path.write_bytes(data)

    # 清理旧文件
    if settings.avatar:
        old = _profiles_root() / settings.avatar
        if old.is_file() and old.name.startswith(f"u{request.user.id}_"):
            try:
                old.unlink()
            except OSError:
                pass

    settings.avatar = stored
    settings.save(update_fields=["avatar", "updated_at"])
    return Response({
        "ok": True,
        "avatar": stored,
        "avatar_url": settings.avatar_url,
        "user": _user_payload(request.user, settings),
    })


def _require_staff(user) -> Response | None:
    if not user or not getattr(user, "is_authenticated", False):
        return Response({"ok": False, "error": "未登录"}, status=401)
    if not (user.is_staff or user.is_superuser):
        return Response({"ok": False, "error": "仅管理员可管理账号"}, status=403)
    return None


def _admin_user_row(user) -> dict:
    settings, _ = UserSettings.objects.get_or_create(user=user)
    display = (settings.display_name or "").strip() or user.username
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email or "",
        "display_name": display,
        "is_active": bool(user.is_active),
        "is_staff": bool(user.is_staff or user.is_superuser),
        "is_superuser": bool(user.is_superuser),
        "has_usable_password": user.has_usable_password(),
        "date_joined": user.date_joined.isoformat() if user.date_joined else None,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "phone_masked": mask_phone(settings.phone),
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_users(request):
    """管理员：账号列表 / 新建账号。密码不可回读，仅可设置或重置。"""
    denied = _require_staff(request.user)
    if denied:
        return denied

    if request.method == "GET":
        qs = User.objects.all().order_by("id")
        q = str(request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(email__icontains=q))
        rows = [_admin_user_row(u) for u in qs[:500]]
        return Response({"ok": True, "count": len(rows), "results": rows})

    username = str(request.data.get("username") or "").strip()
    password = str(request.data.get("password") or "")
    email = str(request.data.get("email") or "").strip()
    is_staff = bool(request.data.get("is_staff"))
    display_name = str(request.data.get("display_name") or "").strip()[:64]
    phone = str(request.data.get("phone") or "").strip()[:32]
    if not username or not password:
        return Response({"ok": False, "error": "用户名和密码不能为空"}, status=400)
    if User.objects.filter(username=username).exists():
        return Response({"ok": False, "error": "用户名已存在"}, status=400)
    try:
        validate_password(password, user=User(username=username, email=email))
    except ValidationError as exc:
        return Response({"ok": False, "error": " ".join(exc.messages)}, status=400)

    user = User.objects.create_user(
        username=username,
        password=password,
        email=email,
        is_staff=is_staff,
    )
    settings = UserSettings.objects.create(user=user, display_name=display_name, phone=phone)
    row = _admin_user_row(user)
    # 仅创建当下回显一次明文，便于管理员抄录；库内仍为哈希
    return Response({
        "ok": True,
        "user": row,
        "password_once": password,
        "settings": _settings_payload(settings),
    }, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def admin_user_detail(request, user_id: int):
    """管理员：改密 / 启停 / 角色 / 删除。"""
    denied = _require_staff(request.user)
    if denied:
        return denied

    target = User.objects.filter(id=user_id).first()
    if not target:
        return Response({"ok": False, "error": "用户不存在"}, status=404)
    if target.is_superuser and not request.user.is_superuser:
        return Response({"ok": False, "error": "不能修改超级管理员"}, status=403)

    if request.method == "DELETE":
        if target.id == request.user.id:
            return Response({"ok": False, "error": "不能删除自己的账号"}, status=400)
        if target.is_superuser and not request.user.is_superuser:
            return Response({"ok": False, "error": "不能删除超级管理员"}, status=403)
        if target.is_superuser:
            other_supers = User.objects.filter(is_superuser=True).exclude(id=target.id).count()
            if other_supers < 1:
                return Response({"ok": False, "error": "不能删除唯一的超级管理员"}, status=400)
        username = target.username
        Token.objects.filter(user=target).delete()
        target.delete()
        return Response({"ok": True, "deleted": username})

    if target.id == request.user.id and request.data.get("is_active") is False:
        return Response({"ok": False, "error": "不能停用自己的账号"}, status=400)

    body = request.data or {}
    update_fields: list[str] = []

    if "email" in body:
        target.email = str(body.get("email") or "").strip()
        update_fields.append("email")
    if "is_active" in body:
        target.is_active = bool(body.get("is_active"))
        update_fields.append("is_active")
    if "is_staff" in body:
        if target.is_superuser:
            return Response({"ok": False, "error": "超级管理员角色不可降级"}, status=400)
        target.is_staff = bool(body.get("is_staff"))
        update_fields.append("is_staff")

    password_once = None
    if body.get("password"):
        password = str(body.get("password") or "")
        try:
            validate_password(password, user=target)
        except ValidationError as exc:
            return Response({"ok": False, "error": " ".join(exc.messages)}, status=400)
        target.set_password(password)
        update_fields.append("password")
        password_once = password
        # 改密后作废旧 Token
        Token.objects.filter(user=target).delete()

    if "display_name" in body:
        settings, _ = UserSettings.objects.get_or_create(user=target)
        settings.display_name = str(body.get("display_name") or "").strip()[:64]
        settings.save(update_fields=["display_name", "updated_at"])
    if "phone" in body:
        settings, _ = UserSettings.objects.get_or_create(user=target)
        settings.phone = str(body.get("phone") or "").strip()[:32]
        # 使用完整 save，确保手机号标准化和绑定事件同步执行。
        settings.save()

    if update_fields:
        target.save(update_fields=list(dict.fromkeys(update_fields)))

    resp = {"ok": True, "user": _admin_user_row(target)}
    if password_once is not None:
        resp["password_once"] = password_once
    return Response(resp)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    """当前用户修改自己的登录密码。"""
    old_password = str(request.data.get("old_password") or "")
    new_password = str(request.data.get("new_password") or "")
    if not old_password or not new_password:
        return Response({"ok": False, "error": "请填写原密码和新密码"}, status=400)
    if not request.user.check_password(old_password):
        return Response({"ok": False, "error": "原密码不正确"}, status=400)
    try:
        validate_password(new_password, user=request.user)
    except ValidationError as exc:
        return Response({"ok": False, "error": " ".join(exc.messages)}, status=400)

    request.user.set_password(new_password)
    request.user.save(update_fields=["password"])
    # 刷新当前 Token，避免立刻被踢出
    Token.objects.filter(user=request.user).delete()
    token, _ = Token.objects.get_or_create(user=request.user)
    return Response({
        "ok": True,
        "token": token.key,
        "user": _user_payload(request.user),
    })


@api_view(["GET", "HEAD"])
@permission_classes([AllowAny])
def serve_avatar(request, stored_id: str):
    """头像静态拉取：Header Token 或 ?token=。"""
    from rest_framework.authtoken.models import Token as AuthToken

    user = request.user if getattr(request.user, "is_authenticated", False) else None
    if user is None:
        raw = (request.META.get("HTTP_AUTHORIZATION") or "").strip()
        key = ""
        if raw.lower().startswith("token "):
            key = raw[6:].strip()
        if not key:
            key = str(request.query_params.get("token") or "").strip()
        if key:
            row = AuthToken.objects.select_related("user").filter(key=key).first()
            user = row.user if row else None
    if user is None or not getattr(user, "is_authenticated", False):
        return Response({"ok": False, "error": "未登录"}, status=401)

    safe = Path(stored_id).name
    if safe != stored_id or ".." in stored_id:
        raise Http404()
    path = _profiles_root() / safe
    if not path.is_file():
        raise Http404()
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    if request.method == "HEAD":
        resp = HttpResponse(status=200, content_type=mime)
        try:
            resp["Content-Length"] = str(path.stat().st_size)
        except OSError:
            pass
        return resp
    return FileResponse(path.open("rb"), as_attachment=False, filename=safe, content_type=mime)
