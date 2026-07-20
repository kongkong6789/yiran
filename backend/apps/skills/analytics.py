"""技能责任与使用分析。"""
from __future__ import annotations

import logging
from collections import Counter
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.utils import timezone

from apps.core.models import OrganizationMembership

from .models import SkillAsset, SkillUsageEvent, UserSkill

logger = logging.getLogger(__name__)


def record_skill_usage(skills: list[UserSkill], user, *, source: str) -> None:
    """记录实际加载的技能；审计失败不能阻断对话主链路。"""
    if not skills or user is None or not getattr(user, "is_authenticated", False):
        return
    if source not in SkillUsageEvent.Source.values:
        source = SkillUsageEvent.Source.AGENT
    try:
        SkillUsageEvent.objects.bulk_create([
            SkillUsageEvent(
                skill_id=skill.skill_id,
                skill_name=skill.name,
                asset_id=skill.source_asset_id,
                user=user,
                source=source,
            )
            for skill in skills
        ])
    except Exception:
        logger.exception("记录 Skill 使用事件失败")


def management_scope(user) -> tuple[bool, str, set[int] | None]:
    if user.is_staff or user.is_superuser:
        return True, "全平台", None
    membership = (
        OrganizationMembership.objects.filter(user=user, is_primary=True, is_active=True)
        .select_related("organization")
        .first()
    )
    if membership and membership.role in {
        OrganizationMembership.Role.OWNER,
        OrganizationMembership.Role.ADMIN,
    }:
        user_ids = set(
            OrganizationMembership.objects.filter(
                organization=membership.organization,
                is_active=True,
            ).values_list("user_id", flat=True)
        )
        return True, membership.organization.name, user_ids
    return False, "我的使用与负责技能", {user.id}


def _user_label(user) -> str:
    if user is None:
        return "未知用户"
    return user.get_full_name().strip() or user.username


def _owner_team(user) -> str:
    if user is None:
        return ""
    membership = next(iter(user.team_memberships.all()), None)
    return membership.team.name if membership else ""


def _event_payload(event: SkillUsageEvent) -> dict:
    return {
        "id": event.id,
        "skill_id": event.skill_id,
        "skill_name": event.skill_name or event.skill_id,
        "user_id": event.user_id,
        "user": _user_label(event.user),
        "source": event.source,
        "source_label": event.get_source_display(),
        "used_at": event.used_at.isoformat(),
    }


def build_skill_analytics(user) -> dict:
    can_manage, scope_label, scoped_user_ids = management_scope(user)

    assets = SkillAsset.objects.select_related("owner", "uploader").prefetch_related(
        "owner__team_memberships__team"
    )
    if scoped_user_ids is not None and can_manage:
        assets = assets.filter(uploader_id__in=scoped_user_ids)
    elif not can_manage:
        assets = assets.filter(Q(visibility=SkillAsset.Visibility.SHARED) | Q(uploader=user))
    assets = list(assets.order_by("-updated_at"))
    asset_ids = [asset.id for asset in assets]
    responsible_asset_ids = {
        asset.id
        for asset in assets
        if asset.uploader_id == user.id or asset.owner_id == user.id
    }

    events = SkillUsageEvent.objects.select_related("user", "asset")
    if can_manage and scoped_user_ids is not None:
        events = events.filter(user_id__in=scoped_user_ids)
    elif not can_manage:
        events = events.filter(Q(user=user) | Q(asset_id__in=responsible_asset_ids))
    thirty_days_ago = timezone.now() - timedelta(days=30)
    recent_events = events.filter(used_at__gte=thirty_days_ago)

    usage_by_asset = {
        row["asset_id"]: row
        for row in recent_events.filter(asset_id__in=asset_ids)
        .values("asset_id")
        .annotate(usage_count=Count("id"), unique_users=Count("user_id", distinct=True))
    }
    adoption_qs = UserSkill.objects.filter(source_asset_id__in=asset_ids)
    if can_manage and scoped_user_ids is not None:
        adoption_qs = adoption_qs.filter(user_id__in=scoped_user_ids)
    elif not can_manage:
        adoption_qs = adoption_qs.filter(Q(user=user) | Q(source_asset_id__in=responsible_asset_ids))
    adoption_by_asset = {
        row["source_asset_id"]: row
        for row in adoption_qs.values("source_asset_id").annotate(
            adoption_count=Count("user_id", distinct=True),
            enabled_count=Count("user_id", filter=Q(enabled=True), distinct=True),
        )
    }
    last_event_by_asset: dict[int, SkillUsageEvent] = {}
    recent_by_asset: dict[int, list[dict]] = {}
    for event in events.filter(asset_id__in=asset_ids).order_by("-used_at"):
        if event.asset_id not in last_event_by_asset:
            last_event_by_asset[event.asset_id] = event
        event_rows = recent_by_asset.setdefault(event.asset_id, [])
        if len(event_rows) < 5:
            event_rows.append(_event_payload(event))
        if len(last_event_by_asset) == len(asset_ids) and all(
            len(recent_by_asset.get(asset_id, [])) >= 5 for asset_id in asset_ids
        ):
            break

    rows: list[dict] = []
    for asset in assets:
        usage = usage_by_asset.get(asset.id, {})
        adoption = adoption_by_asset.get(asset.id, {})
        last_event = last_event_by_asset.get(asset.id)
        rows.append({
            "asset_id": asset.id,
            "skill_id": asset.skill_id,
            "name": asset.name,
            "description": asset.description,
            "visibility": asset.visibility,
            "owner_id": asset.owner_id,
            "owner": _user_label(asset.owner) if asset.owner_id else "待认领",
            "owner_team": _owner_team(asset.owner),
            "uploader": _user_label(asset.uploader),
            "is_uploader": asset.uploader_id == user.id,
            "adoption_count": adoption.get("adoption_count", 0),
            "enabled_count": adoption.get("enabled_count", 0),
            "usage_count_30d": usage.get("usage_count", 0),
            "unique_users_30d": usage.get("unique_users", 0),
            "last_used_at": last_event.used_at.isoformat() if last_event else None,
            "last_used_by": _user_label(last_event.user) if last_event else "暂无调用",
            "last_source": last_event.get_source_display() if last_event else "",
            "recent_usage": recent_by_asset.get(asset.id, []),
            "updated_at": asset.updated_at.isoformat(),
        })

    today = timezone.localdate()
    trend_counter = Counter(
        timezone.localtime(value).date()
        for value in recent_events.filter(used_at__date__gte=today - timedelta(days=6))
        .values_list("used_at", flat=True)
    )
    trend = [
        {
            "date": (today - timedelta(days=offset)).isoformat(),
            "label": (today - timedelta(days=offset)).strftime("%m-%d"),
            "count": trend_counter.get(today - timedelta(days=offset), 0),
        }
        for offset in range(6, -1, -1)
    ]

    ranked = sorted(
        rows,
        key=lambda row: (row["usage_count_30d"], row["unique_users_30d"], row["adoption_count"]),
        reverse=True,
    )
    total_skills = len(rows)
    active_skills = sum(1 for row in rows if row["usage_count_30d"] > 0)
    owner_covered = sum(1 for row in rows if row["owner_id"])

    owner_options: list[dict] = []
    if can_manage:
        owners = get_user_model().objects.filter(is_active=True).order_by("username")
        if scoped_user_ids is not None:
            owners = owners.filter(id__in=scoped_user_ids)
        owner_options = [
            {"id": owner.id, "name": _user_label(owner), "username": owner.username}
            for owner in owners
        ]

    return {
        "scope_label": scope_label,
        "can_manage": can_manage,
        "summary": {
            "total_skills": total_skills,
            "total_invocations": events.count(),
            "invocations_30d": recent_events.count(),
            "active_skills_30d": active_skills,
            "utilization_rate": round(active_skills / total_skills * 100, 1) if total_skills else 0,
            "shared_skills": sum(1 for row in rows if row["visibility"] == SkillAsset.Visibility.SHARED),
            "shared_adoptions": sum(
                row["adoption_count"]
                for row in rows
                if row["visibility"] == SkillAsset.Visibility.SHARED
            ),
            "owner_count": len({row["owner_id"] for row in rows if row["owner_id"]}),
            "responsibility_coverage": round(owner_covered / total_skills * 100, 1) if total_skills else 0,
        },
        "skills": rows,
        "ranking": ranked[:5],
        "trend": trend,
        "recent_usage": [
            _event_payload(event)
            for event in events.order_by("-used_at")[:12]
        ],
        "owner_options": owner_options,
    }
