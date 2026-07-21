"""团队管理 API：平台团队(跨企业) 与 企业团队(企业内小组)。

供知识库等场景界定可见范围，独立于企业成员角色。
"""
from __future__ import annotations

import uuid

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import AuditLog, Organization, Team, TeamMembership, UserSettings
from .organizations import (
    current_organization,
    is_organization_admin,
    organization_user_ids,
)

User = get_user_model()


def _display_name(user) -> str:
    settings = getattr(user, "settings", None)
    name = (getattr(settings, "display_name", "") or "").strip()
    return name or user.username


def _can_manage_team(user, team: Team) -> bool:
    if team.kind == Team.Kind.PLATFORM:
        return bool(
            (user.is_staff or getattr(user, "is_superuser", False))
            and team.memberships.filter(user=user).exists()
        )
    organization = current_organization(user)
    return bool(
        organization
        and team.organization_id == organization.id
        and is_organization_admin(user, organization)
    )


def _wecom_bound_user_ids(user_ids) -> set[int]:
    """已成功绑定企业微信（status=matched）的平台用户 id 集合。"""
    ids = [uid for uid in user_ids if uid]
    if not ids:
        return set()
    from apps.wecom.models import UserWeComBinding

    return set(
        UserWeComBinding.objects.filter(
            platform_user_id__in=ids,
            status=UserWeComBinding.Status.MATCHED,
        ).values_list("platform_user_id", flat=True)
    )


def _team_member_payload(membership: TeamMembership, bound_ids: set[int] = frozenset()) -> dict:
    settings = getattr(membership.user, "settings", None)
    return {
        "id": membership.user_id,
        "username": membership.user.username,
        "displayName": _display_name(membership.user),
        "avatarUrl": getattr(settings, "avatar_url", "") or "",
        "role": membership.role,
        "roleLabel": membership.get_role_display(),
        "isActive": bool(membership.user.is_active),
        "wecomBound": membership.user_id in bound_ids,
    }


def _team_payload(team: Team, actor=None) -> dict:
    memberships = list(
        team.memberships.select_related("user", "user__settings").all()
    )
    bound_ids = _wecom_bound_user_ids([m.user_id for m in memberships])
    return {
        "id": team.id,
        "name": team.name,
        "kind": team.kind,
        "kindLabel": team.get_kind_display(),
        "description": team.description or "",
        "organizationId": team.organization_id,
        "organizationName": team.organization.name if team.organization_id else "",
        "isActive": bool(team.is_active),
        "memberCount": sum(1 for m in memberships if m.user.is_active),
        "pendingWecomCount": sum(
            1 for m in memberships if m.user.is_active and m.user_id not in bound_ids
        ) if team.kind == Team.Kind.ENTERPRISE else 0,
        "canManage": _can_manage_team(actor, team) if actor else False,
        "createdAt": team.created_at.isoformat() if team.created_at else None,
        "members": [_team_member_payload(m, bound_ids) for m in memberships],
    }


def _visible_teams(user):
    qs = Team.objects.select_related("organization").prefetch_related(
        "memberships__user", "memberships__user__settings"
    )
    # 企业团队严格跟随当前企业，避免多企业用户在一个上下文中看到其他
    # 企业的组织结构；平台团队不受当前企业影响，但必须是团队成员。
    filters = Q(kind=Team.Kind.PLATFORM, memberships__user=user)
    organization = current_organization(user)
    if organization:
        filters |= Q(kind=Team.Kind.ENTERPRISE, organization=organization)
    return qs.filter(filters).distinct()


def _require_manager(user) -> Response | None:
    if not user or not getattr(user, "is_authenticated", False):
        return Response({"ok": False, "error": "未登录"}, status=401)
    if not (user.is_staff or user.is_superuser or is_organization_admin(user)):
        return Response({"ok": False, "error": "仅平台或企业管理员可管理团队"}, status=403)
    return None


def _eligible_user_ids_for_team(team: Team) -> set[int]:
    if team.kind == Team.Kind.PLATFORM:
        return set(User.objects.filter(is_active=True).values_list("id", flat=True))
    return set(organization_user_ids(team.organization))


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def teams(request):
    if request.method == "GET":
        qs = _visible_teams(request.user)
        kind = str(request.query_params.get("kind") or "").strip()
        if kind in Team.Kind.values:
            qs = qs.filter(kind=kind)
        organization_id = request.query_params.get("organizationId")
        if organization_id:
            qs = qs.filter(organization_id=organization_id)
        rows = [_team_payload(team, request.user) for team in qs]
        return Response({"ok": True, "count": len(rows), "results": rows})

    denied = _require_manager(request.user)
    if denied:
        return denied

    name = str(request.data.get("name") or "").strip()
    kind = str(request.data.get("kind") or Team.Kind.ENTERPRISE)
    description = str(request.data.get("description") or "").strip()[:255]
    if not name:
        return Response({"ok": False, "error": "团队名称不能为空"}, status=400)
    if kind not in Team.Kind.values:
        return Response({"ok": False, "error": "团队类型无效"}, status=400)

    organization = None
    if kind == Team.Kind.PLATFORM:
        if not (request.user.is_staff or request.user.is_superuser):
            return Response({"ok": False, "error": "仅平台管理员可创建平台团队"}, status=403)
    else:
        organization_id = request.data.get("organizationId")
        if organization_id and request.user.is_superuser:
            organization = Organization.objects.filter(id=organization_id, is_active=True).first()
        else:
            organization = current_organization(request.user)
        if not organization:
            return Response({"ok": False, "error": "企业不存在或未指定"}, status=404)
        if not is_organization_admin(request.user, organization):
            return Response({"ok": False, "error": "仅该企业管理员可创建企业团队"}, status=403)

    raw_member_ids = request.data.get("memberIds") or []
    try:
        member_ids = list(dict.fromkeys(int(v) for v in raw_member_ids))
    except (TypeError, ValueError):
        return Response({"ok": False, "error": "memberIds 格式无效"}, status=400)

    if member_ids:
        if kind == Team.Kind.PLATFORM:
            eligible = set(User.objects.filter(is_active=True).values_list("id", flat=True))
        else:
            eligible = set(organization_user_ids(organization))
        invalid = [uid for uid in member_ids if uid not in eligible]
        if invalid:
            return Response({"ok": False, "error": "部分成员不在可选范围内"}, status=400)

    with transaction.atomic():
        team = Team.objects.create(
            name=name[:128],
            kind=kind,
            organization=organization,
            description=description,
            created_by=request.user,
        )
        if kind == Team.Kind.PLATFORM and request.user.id not in member_ids:
            # 平台团队仅成员可见，因此创建人必须进入团队，避免创建成功后
            # 立即从自己的列表中消失，也保证后续具备明确的管理身份。
            member_ids.insert(0, request.user.id)
        if member_ids:
            TeamMembership.objects.bulk_create([
                TeamMembership(
                    team=team,
                    user_id=uid,
                    role=(
                        TeamMembership.Role.LEAD
                        if kind == Team.Kind.PLATFORM and uid == request.user.id
                        else TeamMembership.Role.MEMBER
                    ),
                )
                for uid in member_ids
            ])
        AuditLog.objects.create(
            trace_id=f"team-create-{team.id}-{uuid.uuid4().hex[:8]}",
            actor=request.user.username,
            intent="创建团队",
            action="team.create",
            payload={"team_id": team.id, "name": team.name, "kind": team.kind, "member_ids": member_ids},
            decision=AuditLog.Decision.ALLOW,
            result={"created": True},
        )

    team.refresh_from_db()
    return Response({"ok": True, "team": _team_payload(team, request.user)}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def team_detail(request, team_id: int):
    denied = _require_manager(request.user)
    if denied:
        return denied
    team = Team.objects.select_related("organization").filter(id=team_id).first()
    if not team:
        return Response({"ok": False, "error": "团队不存在"}, status=404)
    if not _can_manage_team(request.user, team):
        return Response({"ok": False, "error": "无权管理该团队"}, status=403)

    if request.method == "DELETE":
        name = team.name
        team.delete()
        AuditLog.objects.create(
            trace_id=f"team-delete-{team_id}-{uuid.uuid4().hex[:8]}",
            actor=request.user.username,
            intent="删除团队",
            action="team.delete",
            payload={"team_id": team_id, "name": name},
            decision=AuditLog.Decision.ALLOW,
            result={"deleted": True},
        )
        return Response({"ok": True, "deleted": name})

    body = request.data or {}
    update_fields: list[str] = []
    if "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            return Response({"ok": False, "error": "团队名称不能为空"}, status=400)
        team.name = name[:128]
        update_fields.append("name")
    if "description" in body:
        team.description = str(body.get("description") or "").strip()[:255]
        update_fields.append("description")
    if "isActive" in body:
        team.is_active = bool(body.get("isActive"))
        update_fields.append("is_active")
    if update_fields:
        update_fields.append("updated_at")
        team.save(update_fields=update_fields)
    return Response({"ok": True, "team": _team_payload(team, request.user)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def team_members(request, team_id: int):
    denied = _require_manager(request.user)
    if denied:
        return denied
    team = Team.objects.select_related("organization").filter(id=team_id).first()
    if not team:
        return Response({"ok": False, "error": "团队不存在"}, status=404)
    if not _can_manage_team(request.user, team):
        return Response({"ok": False, "error": "无权管理该团队"}, status=403)

    raw_ids = request.data.get("userIds")
    if not isinstance(raw_ids, list) or not raw_ids:
        return Response({"ok": False, "error": "请至少选择一位成员"}, status=400)
    role = str(request.data.get("role") or TeamMembership.Role.MEMBER)
    if role not in TeamMembership.Role.values:
        return Response({"ok": False, "error": "团队角色无效"}, status=400)
    try:
        user_ids = list(dict.fromkeys(int(v) for v in raw_ids))
    except (TypeError, ValueError):
        return Response({"ok": False, "error": "userIds 格式无效"}, status=400)

    eligible = _eligible_user_ids_for_team(team)
    invalid = [uid for uid in user_ids if uid not in eligible]
    if invalid:
        return Response({"ok": False, "error": "部分成员不在可选范围内"}, status=400)

    added = 0
    for uid in user_ids:
        _, created = TeamMembership.objects.get_or_create(
            team=team, user_id=uid, defaults={"role": role}
        )
        if created:
            added += 1
    team.refresh_from_db()
    return Response({"ok": True, "addedCount": added, "team": _team_payload(team, request.user)})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def team_member_detail(request, team_id: int, user_id: int):
    denied = _require_manager(request.user)
    if denied:
        return denied
    team = Team.objects.select_related("organization").filter(id=team_id).first()
    if not team:
        return Response({"ok": False, "error": "团队不存在"}, status=404)
    if not _can_manage_team(request.user, team):
        return Response({"ok": False, "error": "无权管理该团队"}, status=403)
    membership = TeamMembership.objects.filter(team=team, user_id=user_id).first()
    if not membership:
        return Response({"ok": False, "error": "该成员不在团队内"}, status=404)
    membership.delete()
    team.refresh_from_db()
    return Response({"ok": True, "removedUserId": user_id, "team": _team_payload(team, request.user)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def team_user_options(request):
    """团队成员候选人：平台团队取全部启用用户，企业团队取本企业成员。"""
    denied = _require_manager(request.user)
    if denied:
        return denied
    kind = str(request.query_params.get("kind") or Team.Kind.ENTERPRISE)
    if kind == Team.Kind.PLATFORM:
        if not (request.user.is_staff or request.user.is_superuser):
            return Response({"ok": False, "error": "仅平台管理员可查看平台团队候选人"}, status=403)
        users = User.objects.filter(is_active=True).select_related("settings").order_by("id")
    else:
        organization_id = request.query_params.get("organizationId")
        if organization_id and request.user.is_superuser:
            organization = Organization.objects.filter(id=organization_id, is_active=True).first()
        else:
            organization = current_organization(request.user)
        if not organization:
            return Response({"ok": True, "count": 0, "results": []})
        if not is_organization_admin(request.user, organization):
            return Response({"ok": False, "error": "无权查看该企业成员"}, status=403)
        member_ids = organization_user_ids(organization)
        users = User.objects.filter(id__in=member_ids).select_related("settings").order_by("id")

    user_list = list(users[:1000])
    bound_ids = _wecom_bound_user_ids([user.id for user in user_list])
    options = [
        {
            "id": user.id,
            "username": user.username,
            "displayName": _display_name(user),
            "avatarUrl": getattr(getattr(user, "settings", None), "avatar_url", "") or "",
            "wecomBound": user.id in bound_ids,
        }
        for user in user_list
    ]
    return Response({"ok": True, "count": len(options), "results": options})
