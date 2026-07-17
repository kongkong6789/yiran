"""账号注册 / 登录 / 个人信息 API。"""
from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path

from django.conf import settings as django_settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, Http404
from django.utils import timezone
from django.http import FileResponse, Http404, HttpResponse
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import AuditLog, Organization, OrganizationMembership, UserSettings
from .organizations import (
    assign_user_to_organization,
    create_organization_with_owner,
    create_personal_organization,
    current_organization,
    is_organization_admin,
    primary_membership,
    transfer_organization_ownership,
)
from apps.wecom.phone import mask_phone

User = get_user_model()

AVATAR_MAX_BYTES = 5 * 1024 * 1024
AVATAR_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}


def _profiles_root() -> Path:
    root = Path(getattr(django_settings, "PROFILE_AVATARS_ROOT", django_settings.BASE_DIR / "profile_avatars"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def _wecom_binding_summary(user) -> dict:
    from apps.wecom.models import UserWeComBinding, WeComContact

    binding = UserWeComBinding.objects.filter(platform_user=user).first()
    if not binding:
        return {
            "status": "pending",
            "statusLabel": "待匹配",
            "weComUserId": "",
            "weComMember": "",
            "failureReason": "",
        }
    wecom_member = ""
    if binding.wecom_config_id and binding.wecom_userid:
        contact = WeComContact.objects.filter(
            config_id=binding.wecom_config_id,
            wecom_userid=binding.wecom_userid,
        ).only("name").first()
        wecom_member = contact.name if contact else ""
    return {
        "status": binding.status,
        "statusLabel": binding.get_status_display(),
        "weComUserId": binding.wecom_userid or "",
        "weComMember": wecom_member,
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
    membership = primary_membership(user)
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
        "organization": {
            "id": membership.organization_id,
            "name": membership.organization.name,
            "role": membership.role,
            "roleLabel": membership.get_role_display(),
            "canManage": membership.role in {
                OrganizationMembership.Role.OWNER,
                OrganizationMembership.Role.ADMIN,
            },
        } if membership else None,
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
    create_personal_organization(user, name=f"{username}的企业")
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
    if not primary_membership(user):
        create_personal_organization(user)
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
    if not (user.is_staff or user.is_superuser or is_organization_admin(user)):
        return Response({"ok": False, "error": "仅企业管理员可管理账号"}, status=403)
    return None


def _admin_user_row(user) -> dict:
    settings, _ = UserSettings.objects.get_or_create(user=user)
    display = (settings.display_name or "").strip() or user.username
    membership = primary_membership(user)
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
        "organization_id": membership.organization_id if membership else None,
        "organization_name": membership.organization.name if membership else "",
        "organization_role": membership.role if membership else "",
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_users(request):
    """管理员：账号列表 / 新建账号。密码不可回读，仅可设置或重置。"""
    denied = _require_staff(request.user)
    if denied:
        return denied

    if request.method == "GET":
        if request.user.is_superuser:
            qs = User.objects.all().order_by("id")
        else:
            organization = current_organization(request.user)
            qs = User.objects.filter(
                organization_memberships__organization=organization,
                organization_memberships__is_active=True,
            ).distinct().order_by("id")
        qs = qs.filter(Q(settings__isnull=True) | Q(settings__deleted_at__isnull=True))
        q = str(request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(email__icontains=q))
        rows = [_admin_user_row(u) for u in qs[:500]]
        return Response({"ok": True, "count": len(rows), "results": rows})

    username = str(request.data.get("username") or "").strip()
    password = str(request.data.get("password") or "")
    email = str(request.data.get("email") or "").strip()
    is_staff = bool(request.data.get("is_staff")) if request.user.is_superuser else False
    display_name = str(request.data.get("display_name") or "").strip()[:64]
    phone = str(request.data.get("phone") or "").strip()[:32]
    organization_id = request.data.get("organization_id")
    organization_role = str(request.data.get("organization_role") or OrganizationMembership.Role.MEMBER)
    if organization_role == OrganizationMembership.Role.OWNER:
        return Response({"ok": False, "error": "企业所有者只能通过创建企业或所有权转移接口设置"}, status=400)
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
    if request.user.is_superuser and organization_id:
        organization = Organization.objects.filter(id=organization_id, is_active=True).first()
    else:
        organization = current_organization(request.user)
    if organization:
        assign_user_to_organization(user, organization, role=organization_role)
    else:
        create_personal_organization(user)
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
    """管理员：改密 / 启停 / 角色 / 删除账号。"""
    """管理员：改密 / 启停 / 角色 / 删除。"""
    denied = _require_staff(request.user)
    if denied:
        return denied

    target = User.objects.filter(id=user_id).first()
    if not target:
        return Response({"ok": False, "error": "用户不存在"}, status=404)
    if not request.user.is_superuser:
        actor_organization = current_organization(request.user)
        target_current_membership = primary_membership(target)
        if (
            not actor_organization
            or not target_current_membership
            or target_current_membership.organization_id != actor_organization.id
        ):
            return Response({"ok": False, "error": "不能管理其他企业的用户"}, status=403)
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

    if request.method == "DELETE":
        if target.id == request.user.id:
            return Response({"ok": False, "error": "不能删除自己的账号"}, status=400)
        if target.is_superuser:
            return Response({"ok": False, "error": "超级管理员账号不能删除"}, status=400)
        if target.is_staff and not request.user.is_superuser:
            return Response({"ok": False, "error": "仅超级管理员可以删除平台管理员"}, status=403)
        owner_membership = OrganizationMembership.objects.filter(
            user=target,
            role=OrganizationMembership.Role.OWNER,
            is_active=True,
            organization__is_active=True,
        ).first()
        if owner_membership:
            return Response({"ok": False, "error": "请先转移企业所有权，再删除该账号"}, status=400)
        settings_row, _ = UserSettings.objects.get_or_create(user=target)
        if settings_row.deleted_at:
            return Response({"ok": False, "error": "账号已删除"}, status=404)

        original_username = target.username
        deleted_username = f"deleted-{target.id}-{uuid.uuid4().hex[:12]}"
        with transaction.atomic():
            OrganizationMembership.objects.filter(user=target, is_active=True).update(
                is_active=False,
                is_primary=False,
            )
            Token.objects.filter(user=target).delete()
            UserSettings.objects.filter(user=target).update(
                display_name="已删除用户",
                bio="",
                methodology="",
                avatar="",
                phone="",
                phone_hash="",
                phone_updated_at=None,
                llm_api_key="",
                llm_base_url="",
                llm_model="",
                deleted_at=timezone.now(),
            )
            target.username = deleted_username
            target.email = ""
            target.first_name = ""
            target.last_name = ""
            target.is_active = False
            target.is_staff = False
            target.set_unusable_password()
            target.save(update_fields=[
                "username",
                "email",
                "first_name",
                "last_name",
                "is_active",
                "is_staff",
                "password",
            ])
            AuditLog.objects.create(
                trace_id=f"account-delete-{target.id}-{uuid.uuid4().hex[:8]}",
                actor=request.user.username,
                intent="删除平台账号",
                action="account.delete",
                payload={
                    "user_id": target.id,
                    "username": original_username,
                },
                decision=AuditLog.Decision.ALLOW,
                result={"deleted": True},
            )
        return Response({
            "ok": True,
            "deletedUser": {"id": target.id, "username": original_username},
        })
    target_membership = OrganizationMembership.objects.filter(
        user=target,
        role=OrganizationMembership.Role.OWNER,
        is_active=True,
        organization__is_active=True,
    ).first()
    if (
        target_membership
        and target_membership.role == OrganizationMembership.Role.OWNER
        and request.data.get("is_active") is False
    ):
        return Response({"ok": False, "error": "请先转移企业所有权，再停用原所有者账号"}, status=400)
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
        if not request.user.is_superuser:
            return Response({"ok": False, "error": "仅超级管理员可调整平台管理权限"}, status=403)
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
    if "organization_id" in body or "organization_role" in body:
        if not request.user.is_superuser and not is_organization_admin(request.user):
            return Response({"ok": False, "error": "仅企业管理员可调整成员归属"}, status=403)
        current = primary_membership(target)
        organization_id = body.get("organization_id") or (current.organization_id if current else None)
        organization = Organization.objects.filter(id=organization_id, is_active=True).first()
        if not organization:
            return Response({"ok": False, "error": "企业不存在"}, status=404)
        if not request.user.is_superuser and organization != current_organization(request.user):
            return Response({"ok": False, "error": "不能将成员分配到其他企业"}, status=403)
        role = str(body.get("organization_role") or (current.role if current else OrganizationMembership.Role.MEMBER))
        if role not in OrganizationMembership.Role.values:
            return Response({"ok": False, "error": "企业角色无效"}, status=400)
        if role == OrganizationMembership.Role.OWNER:
            return Response({"ok": False, "error": "请使用企业所有权转移功能设置新的所有者"}, status=400)
        if current and current.role == OrganizationMembership.Role.OWNER and role != current.role:
            return Response({"ok": False, "error": "当前所有者不能直接降级，请先转移企业所有权"}, status=400)
        assign_user_to_organization(target, organization, role=role)

    if update_fields:
        target.save(update_fields=list(dict.fromkeys(update_fields)))

    resp = {"ok": True, "user": _admin_user_row(target)}
    if password_once is not None:
        resp["password_once"] = password_once
    return Response(resp)


def _organization_payload(organization: Organization, actor=None) -> dict:
    membership = primary_membership(actor) if actor else None
    return {
        "id": organization.id,
        "code": str(organization.code),
        "name": organization.name,
        "isActive": organization.is_active,
        "memberCount": organization.memberships.filter(is_active=True, user__is_active=True).count(),
        "role": membership.role if membership and membership.organization_id == organization.id else "",
        "canManage": is_organization_admin(actor, organization) if actor else False,
        "createdAt": organization.created_at.isoformat() if organization.created_at else None,
    }


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def current_organization_view(request):
    organization = current_organization(request.user)
    if not organization:
        membership = create_personal_organization(request.user)
        organization = membership.organization
    if request.method == "PATCH":
        if not is_organization_admin(request.user, organization):
            return Response({"ok": False, "error": "仅企业管理员可修改企业信息"}, status=403)
        name = str(request.data.get("name") or "").strip()
        if not name:
            return Response({"ok": False, "error": "企业名称不能为空"}, status=400)
        organization.name = name[:128]
        organization.save(update_fields=["name", "updated_at"])
    members = OrganizationMembership.objects.select_related("user", "user__settings").filter(
        organization=organization,
        is_active=True,
    ).order_by("role", "user_id")
    return Response({
        "ok": True,
        "organization": _organization_payload(organization, request.user),
        "members": [
            {
                "id": membership.user_id,
                "username": membership.user.username,
                "displayName": (
                    getattr(getattr(membership.user, "settings", None), "display_name", "")
                    or membership.user.username
                ),
                "role": membership.role,
                "roleLabel": membership.get_role_display(),
                "isActive": membership.user.is_active,
                "canRemove": bool(
                    is_organization_admin(request.user, organization)
                    and membership.user_id != request.user.id
                    and membership.role != OrganizationMembership.Role.OWNER
                ),
            }
            for membership in members
        ],
    })


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def remove_organization_member_view(request, user_id: int):
    organization = current_organization(request.user)
    if not organization:
        return Response({"ok": False, "error": "当前账号尚未加入企业"}, status=404)
    if not is_organization_admin(request.user, organization):
        return Response({"ok": False, "error": "仅企业管理员可移出成员"}, status=403)
    if user_id == request.user.id:
        return Response({"ok": False, "error": "不能将自己移出企业"}, status=400)

    membership = OrganizationMembership.objects.select_related("user").filter(
        organization=organization,
        user_id=user_id,
        is_active=True,
    ).first()
    if not membership:
        return Response({"ok": False, "error": "该用户不是当前企业的启用成员"}, status=404)
    if membership.role == OrganizationMembership.Role.OWNER:
        return Response({"ok": False, "error": "不能移出企业所有者，请先转移企业所有权"}, status=400)

    with transaction.atomic():
        locked_membership = OrganizationMembership.objects.select_for_update().get(id=membership.id)
        if not locked_membership.is_active:
            return Response({"ok": False, "error": "该成员已被移出企业"}, status=409)
        locked_membership.is_active = False
        locked_membership.is_primary = False
        locked_membership.save(update_fields=["is_active", "is_primary", "updated_at"])
        AuditLog.objects.create(
            trace_id=f"organization-remove-{organization.id}-{user_id}-{uuid.uuid4().hex[:8]}",
            actor=request.user.username,
            intent="移出企业成员",
            action="organization.remove_member",
            payload={
                "organization_id": organization.id,
                "user_id": user_id,
                "username": membership.user.username,
                "role": membership.role,
            },
            decision=AuditLog.Decision.ALLOW,
            result={"removed": True},
        )

    return Response({
        "ok": True,
        "organization": _organization_payload(organization, request.user),
        "removedUser": {
            "id": membership.user_id,
            "username": membership.user.username,
        },
    })


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def admin_organizations(request):
    if not request.user.is_superuser:
        if request.method == "POST":
            return Response({"ok": False, "error": "仅超级管理员可以创建企业"}, status=403)
        organization = current_organization(request.user)
        if not organization:
            return Response({"ok": True, "count": 0, "results": []})
        return Response({"ok": True, "count": 1, "results": [_organization_payload(organization, request.user)]})
    if request.method == "GET":
        rows = Organization.objects.all().order_by("name", "id")
        return Response({"ok": True, "count": rows.count(), "results": [_organization_payload(row, request.user) for row in rows]})
    name = str(request.data.get("name") or "").strip()
    if not name:
        return Response({"ok": False, "error": "企业名称不能为空"}, status=400)
    owner_user_id = request.data.get("ownerUserId") or request.user.id
    owner = User.objects.filter(id=owner_user_id, is_active=True).first()
    if not owner:
        return Response({"ok": False, "error": "企业所有者账号不存在或已停用"}, status=400)
    organization, owner_membership = create_organization_with_owner(
        name=name,
        owner=owner,
        actor=request.user,
    )
    return Response({
        "ok": True,
        "organization": _organization_payload(organization, request.user),
        "owner": {
            "id": owner.id,
            "username": owner.username,
            "role": owner_membership.role,
        },
    }, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def assign_organization_users(request):
    if not request.user.is_superuser:
        return Response({"ok": False, "error": "仅超级管理员可以跨企业分配现有用户"}, status=403)

    organization_id = request.data.get("organizationId")
    raw_user_ids = request.data.get("userIds")
    role = str(request.data.get("role") or OrganizationMembership.Role.MEMBER)
    if not organization_id:
        return Response({"ok": False, "error": "organizationId 必填"}, status=400)
    if not isinstance(raw_user_ids, list) or not raw_user_ids:
        return Response({"ok": False, "error": "请至少选择一个平台用户"}, status=400)
    if len(raw_user_ids) > 200:
        return Response({"ok": False, "error": "每次最多分配 200 个用户"}, status=400)
    if role not in {OrganizationMembership.Role.ADMIN, OrganizationMembership.Role.MEMBER}:
        return Response({"ok": False, "error": "批量分配仅支持企业管理员或企业成员角色"}, status=400)

    try:
        user_ids = list(dict.fromkeys(int(value) for value in raw_user_ids))
    except (TypeError, ValueError):
        return Response({"ok": False, "error": "userIds 格式无效"}, status=400)

    organization = Organization.objects.filter(id=organization_id, is_active=True).first()
    if not organization:
        return Response({"ok": False, "error": "目标企业不存在或已停用"}, status=404)
    users = list(User.objects.filter(id__in=user_ids, is_active=True).order_by("id"))
    if len(users) != len(user_ids):
        return Response({"ok": False, "error": "部分用户不存在或已停用，请刷新后重试"}, status=400)

    owner_rows = list(
        OrganizationMembership.objects.filter(
            user_id__in=user_ids,
            role=OrganizationMembership.Role.OWNER,
            is_active=True,
        ).select_related("user", "organization")
    )
    if owner_rows:
        names = "、".join(row.user.username for row in owner_rows)
        return Response({
            "ok": False,
            "error": f"{names} 仍是企业所有者，请先完成所有权转移",
        }, status=400)

    with transaction.atomic():
        locked_users = list(User.objects.select_for_update().filter(id__in=user_ids).order_by("id"))
        OrganizationMembership.objects.filter(
            user_id__in=user_ids,
            is_active=True,
        ).exclude(organization=organization).update(is_active=False, is_primary=False)

        assigned = []
        for user in locked_users:
            OrganizationMembership.objects.filter(user=user, is_primary=True).update(is_primary=False)
            membership, _ = OrganizationMembership.objects.update_or_create(
                organization=organization,
                user=user,
                defaults={
                    "role": role,
                    "is_active": True,
                    "is_primary": True,
                },
            )
            assigned.append({
                "id": user.id,
                "username": user.username,
                "role": membership.role,
            })

        AuditLog.objects.create(
            trace_id=f"organization-assign-{organization.id}-{uuid.uuid4().hex[:8]}",
            actor=request.user.username,
            intent="批量分配企业成员",
            action="organization.assign_users",
            payload={
                "organization_id": organization.id,
                "user_ids": user_ids,
                "role": role,
            },
            decision=AuditLog.Decision.ALLOW,
            result={"assigned_count": len(assigned)},
        )

    return Response({
        "ok": True,
        "organization": _organization_payload(organization, request.user),
        "assignedCount": len(assigned),
        "assignedUsers": assigned,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def transfer_organization_ownership_view(request):
    organization = current_organization(request.user)
    if not organization:
        return Response({"ok": False, "error": "当前账号尚未加入企业"}, status=404)
    target_user_id = request.data.get("targetUserId")
    if not target_user_id:
        return Response({"ok": False, "error": "targetUserId 必填"}, status=400)
    target = User.objects.filter(id=target_user_id).first()
    if not target:
        return Response({"ok": False, "error": "目标用户不存在"}, status=404)
    try:
        previous_owner, new_owner = transfer_organization_ownership(
            organization=organization,
            actor=request.user,
            target_user=target,
        )
    except PermissionError as exc:
        return Response({"ok": False, "error": str(exc)}, status=403)
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)
    return Response({
        "ok": True,
        "organization": _organization_payload(organization, request.user),
        "previousOwner": {
            "id": previous_owner.user_id,
            "username": previous_owner.user.username,
            "role": previous_owner.role,
        },
        "newOwner": {
            "id": new_owner.user_id,
            "username": new_owner.user.username,
            "role": new_owner.role,
        },
        "transferredAt": new_owner.updated_at.isoformat(),
    })


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
