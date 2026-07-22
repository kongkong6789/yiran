from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from apps.council.access import agent_queryset_for_user
from apps.council.models import AgentProfile
from apps.council.serializers import AgentProfileSerializer
from apps.council.capabilities import build_agent_capability_context
from .graph import run_sop, catalog, resume_approval


@api_view(["POST"])
def run(request):
    """执行一次 Agent SOP 编排。

    body: { "text": "帮我生成昨天的日报", "payload": {...}, "agent_id": 1 }
    """
    text = request.data.get("text", "")
    payload = request.data.get("payload", {}) or {}
    agent_id = request.data.get("agent_id")
    executor = None
    if agent_id not in (None, ""):
        try:
            executor = agent_queryset_for_user(request.user).get(id=int(agent_id))
        except (AgentProfile.DoesNotExist, TypeError, ValueError):
            return Response(
                {"ok": False, "detail": "所选执行智能体不存在或无权访问。"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if (
            not executor.is_active
            or executor.lifecycle_status != AgentProfile.LifecycleStatus.PUBLISHED
        ):
            return Response({"ok": False, "detail": "所选执行智能体已停用。"}, status=status.HTTP_400_BAD_REQUEST)
        if executor.quota_remaining <= 0:
            return Response({"ok": False, "detail": "所选执行智能体额度已用尽。"}, status=status.HTTP_400_BAD_REQUEST)

    role = executor.execution_role if executor else request.data.get("role", "operator")
    requested_trace_id = str(request.data.get("trace_id") or "").strip()
    capability = build_agent_capability_context(executor, request.user, text) if executor else None
    result = run_sop(
        text,
        payload,
        role,
        trace_id=requested_trace_id or None,
        capability_context=capability["prompt"] if capability else "",
        capability_summary=capability,
    )
    if executor:
        result["executor"] = AgentProfileSerializer(
            executor,
            context={"request": request},
        ).data
    return Response(result)


@api_view(["GET"])
def actions_catalog(request):
    return Response(catalog())


@api_view(["POST"])
def resume(request):
    """审批通过后续跑: body { approval_id, approve, approver, comment }。"""
    approval_id = request.data.get("approval_id")
    if not approval_id:
        return Response({"ok": False, "error": "缺少 approval_id"}, status=400)
    return Response(resume_approval(
        int(approval_id),
        approve=bool(request.data.get("approve", True)),
        approver=request.data.get("approver") or request.data.get("role") or "manager",
        comment=request.data.get("comment") or "",
    ))
