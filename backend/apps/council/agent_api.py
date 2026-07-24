"""智能体 Skill 配置与责任制调用统计接口。"""
from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.skills.models import SkillAsset, SkillUsageEvent, UserSkill

from .access import (
    agent_queryset_for_user,
    can_manage_agent,
)
from .models import AgentProfile
from .serializers import AgentProfileSerializer


def _user_payload(user) -> dict | None:
    if user is None:
        return None
    display_name = user.get_full_name().strip() or user.get_username()
    try:
        display_name = str(user.settings.display_name or "").strip() or display_name
    except Exception:
        pass
    return {
        "id": user.id,
        "username": user.get_username(),
        "display_name": display_name,
    }


def _skill_options(user) -> list[dict]:
    assets = list(
        SkillAsset.objects.filter(
            Q(visibility=SkillAsset.Visibility.SHARED) | Q(uploader=user)
        )
        .select_related("owner", "uploader")
        .order_by("name", "skill_id", "id")
    )
    personal = list(
        UserSkill.objects.filter(user=user, enabled=True)
        .select_related("source_asset", "source_asset__owner")
        .order_by("name", "skill_id")
    )

    options: dict[str, dict] = {}
    for asset in assets:
        options.setdefault(
            asset.skill_id,
            {
                "skill_id": asset.skill_id,
                "name": asset.name or asset.skill_id,
                "description": asset.description,
                "visibility": asset.visibility,
                "source": asset.source,
                "asset_id": asset.id,
                "owner": _user_payload(asset.owner),
                "is_personal_enabled": False,
            },
        )
    for skill in personal:
        asset = skill.source_asset
        previous = options.get(skill.skill_id, {})
        options[skill.skill_id] = {
            "skill_id": skill.skill_id,
            "name": skill.name or previous.get("name") or skill.skill_id,
            "description": skill.description or previous.get("description") or "",
            "visibility": (
                asset.visibility
                if asset
                else previous.get("visibility", SkillAsset.Visibility.PRIVATE)
            ),
            "source": asset.source if asset else previous.get("source", "personal"),
            "asset_id": asset.id if asset else previous.get("asset_id"),
            "owner": _user_payload(asset.owner) if asset else previous.get("owner"),
            "is_personal_enabled": True,
        }
    return sorted(options.values(), key=lambda row: (row["name"], row["skill_id"]))


def _agent_option(agent: AgentProfile) -> dict:
    return {
        "id": agent.id,
        "name": agent.name,
        "emoji": agent.emoji,
        "group": agent.group,
        "owner": _user_payload(agent.owner),
        "is_active": agent.is_active,
        "lifecycle_status": agent.lifecycle_status,
        "skill_ids": list(agent.skill_ids or []),
    }


def _skill_config_payload(agent: AgentProfile, user) -> dict:
    skill_options = _skill_options(user)
    skill_by_id = {row["skill_id"]: row for row in skill_options}
    return {
        "agent": _agent_option(agent),
        "skill_ids": list(agent.skill_ids or []),
        "skills": [
            skill_by_id.get(
                skill_id,
                {"skill_id": skill_id, "name": skill_id, "available": False},
            )
            for skill_id in (agent.skill_ids or [])
        ],
    }


def _positive_int(raw_value, *, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(raw_value or default)
    except (TypeError, ValueError) as exc:
        raise ValueError("查询参数必须是整数。") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"查询参数范围必须在 {minimum} 到 {maximum} 之间。")
    return value


def _event_payload(event: SkillUsageEvent) -> dict:
    return {
        "id": event.id,
        "skill_id": event.skill_id,
        "skill_name": event.skill_name or event.skill_id,
        "asset_id": event.asset_id,
        "skill_owner": _user_payload(event.asset.owner) if event.asset_id else None,
        "caller": _user_payload(event.user),
        "source": event.source,
        "source_label": event.get_source_display(),
        "used_at": event.used_at.isoformat(),
    }


def build_agent_usage(agent: AgentProfile, *, days: int, recent_limit: int) -> dict:
    since = timezone.now() - timedelta(days=days)
    events = list(
        SkillUsageEvent.objects.filter(agent=agent, used_at__gte=since)
        .select_related("user", "user__settings", "asset", "asset__owner")
        .order_by("-used_at", "-id")
    )

    by_skill: dict[str, dict] = {}
    callers: dict[int, dict] = {}
    trend_buckets: dict[str, dict] = defaultdict(
        lambda: {"invocations": 0, "caller_ids": set(), "skill_ids": set()}
    )
    for event in events:
        skill = by_skill.setdefault(
            event.skill_id,
            {
                "skill_id": event.skill_id,
                "skill_name": event.skill_name or event.skill_id,
                "invocations": 0,
                "caller_ids": set(),
                "last_used_at": None,
                "asset_id": event.asset_id,
                "owner": _user_payload(event.asset.owner) if event.asset_id else None,
            },
        )
        skill["invocations"] += 1
        if event.user_id:
            skill["caller_ids"].add(event.user_id)
        skill["last_used_at"] = skill["last_used_at"] or event.used_at.isoformat()

        if event.user_id:
            caller = callers.setdefault(
                event.user_id,
                {
                    "user": _user_payload(event.user),
                    "invocations": 0,
                    "skill_ids": set(),
                    "last_used_at": None,
                },
            )
            caller["invocations"] += 1
            caller["skill_ids"].add(event.skill_id)
            caller["last_used_at"] = caller["last_used_at"] or event.used_at.isoformat()

        day_key = timezone.localtime(event.used_at).date().isoformat()
        trend_buckets[day_key]["invocations"] += 1
        trend_buckets[day_key]["skill_ids"].add(event.skill_id)
        if event.user_id:
            trend_buckets[day_key]["caller_ids"].add(event.user_id)

    configured_skill_ids = list(
        dict.fromkeys(str(item).strip() for item in (agent.skill_ids or []) if str(item).strip())
    )
    configured_skill_id_set = set(configured_skill_ids)
    for skill_id in configured_skill_ids:
        by_skill.setdefault(
            skill_id,
            {
                "skill_id": skill_id,
                "skill_name": skill_id,
                "invocations": 0,
                "caller_ids": set(),
                "last_used_at": None,
                "asset_id": None,
                "owner": None,
            },
        )

    skills = []
    for row in by_skill.values():
        skills.append(
            {
                **{key: value for key, value in row.items() if key != "caller_ids"},
                "configured": row["skill_id"] in configured_skill_id_set,
                "unique_callers": len(row["caller_ids"]),
            }
        )
    skills.sort(key=lambda row: (-row["invocations"], row["skill_name"]))
    caller_rows = []
    for row in callers.values():
        caller_rows.append(
            {
                **{key: value for key, value in row.items() if key != "skill_ids"},
                "skill_count": len(row["skill_ids"]),
            }
        )
    caller_rows.sort(key=lambda row: (-row["invocations"], row["user"]["display_name"]))

    today = timezone.localdate()
    trend = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        bucket = trend_buckets[day.isoformat()]
        trend.append(
            {
                "date": day.isoformat(),
                "invocations": bucket["invocations"],
                "unique_callers": len(bucket["caller_ids"]),
                "active_skills": len(bucket["skill_ids"]),
            }
        )

    owner_id = agent.owner_id
    active_configured_skills = sum(
        1
        for row in skills
        if row["configured"] and row["invocations"] > 0
    )
    return {
        "agent": {
            "id": agent.id,
            "name": agent.name,
            "owner": _user_payload(agent.owner),
            "employee_code": agent.employee_code,
        },
        "range": {"days": days, "since": since.isoformat(), "until": timezone.now().isoformat()},
        "summary": {
            "configured_skills": len(configured_skill_ids),
            "active_skills": active_configured_skills,
            "total_invocations": len(events),
            "unique_callers": len(callers),
            "other_user_invocations": sum(
                1 for event in events if event.user_id and event.user_id != owner_id
            ),
            "utilization_rate": round(
                active_configured_skills / len(configured_skill_ids) * 100,
                1,
            )
            if configured_skill_ids
            else 0,
        },
        "skills": skills,
        "callers": caller_rows,
        "trend": trend,
        "recent_usage": [_event_payload(event) for event in events[:recent_limit]],
    }


@api_view(["GET"])
def agent_skill_options(request):
    agents = [
        _agent_option(agent)
        for agent in agent_queryset_for_user(request.user)
        if can_manage_agent(request.user, agent)
    ]
    return Response(
        {
            "agents": agents,
            "skills": _skill_options(request.user),
        }
    )


@api_view(["GET", "PATCH"])
def agent_skills(request, agent_id: int):
    agent = agent_queryset_for_user(request.user, include_archived=True).filter(id=agent_id).first()
    if agent is None:
        return Response({"detail": "智能体不存在或无权访问。"}, status=status.HTTP_404_NOT_FOUND)
    if not can_manage_agent(request.user, agent):
        raise PermissionDenied("只有智能体负责人或企业管理员可以配置技能。")
    if request.method == "PATCH":
        unexpected = set(request.data.keys()) - {"skill_ids"}
        if unexpected:
            return Response(
                {"detail": f"技能配置接口不接受字段：{', '.join(sorted(unexpected))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if "skill_ids" not in request.data:
            return Response(
                {"detail": "请提供 skill_ids。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = AgentProfileSerializer(
            agent,
            data={"skill_ids": request.data.get("skill_ids", [])},
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
    return Response(_skill_config_payload(agent, request.user))


@api_view(["GET"])
def agent_skill_usage(request, agent_id: int):
    agent = agent_queryset_for_user(request.user, include_archived=True).filter(id=agent_id).first()
    if agent is None:
        return Response({"detail": "智能体不存在或无权访问。"}, status=status.HTTP_404_NOT_FOUND)
    if not can_manage_agent(request.user, agent):
        raise PermissionDenied("只有智能体负责人或企业管理员可以查看调用明细。")
    try:
        days = _positive_int(request.query_params.get("days"), default=30, minimum=1, maximum=90)
        recent_limit = _positive_int(
            request.query_params.get("recent_limit"),
            default=20,
            minimum=1,
            maximum=100,
        )
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(build_agent_usage(agent, days=days, recent_limit=recent_limit))


@api_view(["GET"])
def agent_skill_usage_summary(request):
    try:
        days = _positive_int(request.query_params.get("days"), default=30, minimum=1, maximum=90)
    except ValueError as exc:
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    agents = [
        agent
        for agent in agent_queryset_for_user(request.user, include_archived=True)
        if can_manage_agent(request.user, agent)
    ]
    results = [
        build_agent_usage(agent, days=days, recent_limit=5)
        for agent in agents
    ]
    return Response(
        {
            "range": {"days": days},
            "summary": {
                "agent_count": len(results),
                "configured_skills": sum(
                    row["summary"]["configured_skills"] for row in results
                ),
                "total_invocations": sum(
                    row["summary"]["total_invocations"] for row in results
                ),
                "unique_callers": len(
                    {
                        caller["user"]["id"]
                        for row in results
                        for caller in row["callers"]
                        if caller.get("user")
                    }
                ),
                "other_user_invocations": sum(
                    row["summary"]["other_user_invocations"] for row in results
                ),
            },
            "results": results,
        }
    )
