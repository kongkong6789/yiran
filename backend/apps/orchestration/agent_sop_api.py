"""Agent-scoped SOP catalog + execution for harness / digital employees."""
from __future__ import annotations

import uuid

from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.council.access import agent_queryset_for_user
from apps.council.capabilities import build_agent_capability_context
from apps.council.models import AgentProfile
from apps.council.serializers import AgentProfileSerializer
from apps.core.organizations import ensure_current_organization

from .models import SopDefinition, SopVersion
from .sop_api import _bindable_sop_payload
from .sop_runtime import execute_sop_version


def bound_sop_keys(agent: AgentProfile | None) -> list[str]:
    if agent is None:
        return []
    raw = agent.sop_keys if isinstance(agent.sop_keys, list) else []
    return list(dict.fromkeys(str(item).strip() for item in raw if str(item).strip()))


def resolve_published_version(*, organization, sop_key: str) -> SopVersion | None:
    key = str(sop_key or "").strip()
    if not key:
        return None
    definitions = list(
        SopDefinition.objects.filter(
            Q(organization=organization) | Q(organization__isnull=True),
            status=SopDefinition.Status.PUBLISHED,
            sop_key=key,
        ).select_related("organization")
    )
    if not definitions:
        return None
    # Prefer org-owned definition over system gallery when both exist.
    definition = sorted(
        definitions,
        key=lambda row: (0 if row.organization_id else 1, -(row.id or 0)),
    )[0]
    if not definition.current_version:
        return None
    return definition.versions.filter(
        version=definition.current_version,
        status=SopVersion.Status.PUBLISHED,
    ).first()


def _load_agent(request, agent_id: int) -> tuple[AgentProfile | None, Response | None]:
    try:
        agent = agent_queryset_for_user(request.user).get(id=int(agent_id))
    except (AgentProfile.DoesNotExist, TypeError, ValueError):
        return None, Response(
            {"ok": False, "detail": "所选执行智能体不存在或无权访问。"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not agent.is_active or agent.lifecycle_status != AgentProfile.LifecycleStatus.PUBLISHED:
        return None, Response(
            {"ok": False, "detail": "所选执行智能体已停用。"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if agent.quota_remaining <= 0:
        return None, Response(
            {"ok": False, "detail": "所选执行智能体额度已用尽。"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return agent, None


def _with_capability(result: dict, capability: dict | None, agent: AgentProfile, request) -> dict:
    payload = {
        **result,
        "ok": result.get("decision") in {"allow", "need_input", "handoff"} or bool(result.get("ok", True)),
        "executor": AgentProfileSerializer(agent, context={"request": request}).data,
    }
    if not capability:
        return payload
    skill_count = len(capability.get("skills") or [])
    knowledge_count = len(capability.get("configured_knowledge_base_ids") or [])
    step = {
        "node": "智能体能力加载",
        "status": "done" if capability.get("prompt") else "warn",
        "detail": f"已加载 {skill_count} 个 Skill、{knowledge_count} 个指定知识库",
        "data": {
            "skills": capability.get("skills") or [],
            "knowledge_bases": capability.get("knowledge_bases") or [],
            "configured_knowledge_base_ids": capability.get("configured_knowledge_base_ids") or [],
        },
    }
    payload["steps"] = [step, *(result.get("steps") or [])]
    payload["capability"] = capability
    return payload


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agent_bound_sops(request, agent_id: int):
    """List published SOPs bound on this agent (harness catalog)."""
    agent, error = _load_agent(request, agent_id)
    if error:
        return error
    organization = ensure_current_organization(request.user)
    keys = bound_sop_keys(agent)
    if not keys:
        return Response({"agent_id": agent.id, "results": [], "count": 0})

    definitions = list(
        SopDefinition.objects.filter(
            Q(organization=organization) | Q(organization__isnull=True),
            status=SopDefinition.Status.PUBLISHED,
            sop_key__in=keys,
        )
    )
    by_key: dict[str, SopDefinition] = {}
    for row in definitions:
        prev = by_key.get(row.sop_key)
        if prev is None or (prev.organization_id is None and row.organization_id is not None):
            by_key[row.sop_key] = row

    results = []
    for key in keys:
        row = by_key.get(key)
        if row is None:
            continue
        results.append(_bindable_sop_payload(row))
    return Response({"agent_id": agent.id, "results": results, "count": len(results)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def agent_run_sop(request, agent_id: int, sop_key: str):
    """Run a published SOP that this agent is explicitly bound to.

    body: {
      "text": "...",
      "payload": {...},
      "trace_id": "...",   # reuse to resume NEED_INPUT runs
      "role": "operator"   # optional; defaults to agent.execution_role
    }
    """
    agent, error = _load_agent(request, agent_id)
    if error:
        return error

    key = str(sop_key or "").strip()
    if not key:
        return Response({"ok": False, "detail": "缺少 sop_key。"}, status=status.HTTP_400_BAD_REQUEST)

    allowed = bound_sop_keys(agent)
    if key not in allowed:
        return Response(
            {
                "ok": False,
                "detail": f"智能体未绑定 SOP `{key}`，请先在 Agent 配置中勾选。",
                "bound_sop_keys": allowed,
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    organization = ensure_current_organization(request.user)
    version = resolve_published_version(organization=organization, sop_key=key)
    if version is None:
        return Response(
            {
                "ok": False,
                "detail": f"SOP `{key}` 不存在、未发布或当前工作区不可见。",
                "bound_sop_keys": allowed,
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    text = str(request.data.get("text") or "").strip()
    payload = request.data.get("payload") or {}
    if not isinstance(payload, dict):
        return Response({"ok": False, "detail": "payload 必须是对象。"}, status=status.HTTP_400_BAD_REQUEST)

    run_payload = dict(payload)
    # Explicit key wins for runtime matching / observability.
    run_payload["sop_key"] = key
    run_payload["_sop_key"] = key

    capability = build_agent_capability_context(agent, request.user, text)
    if capability:
        run_payload["_agent_kb_ids"] = capability.get("configured_knowledge_base_ids") or []

    role = str(request.data.get("role") or "").strip() or (agent.execution_role or "operator")
    trace_id = str(request.data.get("trace_id") or "").strip() or f"agent-{agent.id}-{uuid.uuid4().hex[:16]}"

    result = execute_sop_version(
        version=version,
        text=text or f"执行 SOP {version.definition.name}",
        payload=run_payload,
        role=role,
        trace_id=trace_id,
        user=request.user,
        organization=organization,
    )
    enriched = _with_capability(result, capability, agent, request)
    enriched["agent_sop"] = {
        "sop_key": key,
        "version": version.version,
        "bound": True,
        "agent_id": agent.id,
    }
    return Response(enriched)
