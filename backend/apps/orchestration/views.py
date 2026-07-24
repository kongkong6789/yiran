from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from apps.council.access import agent_queryset_for_user
from apps.council.models import AgentProfile
from apps.council.serializers import AgentProfileSerializer
from apps.council.capabilities import build_agent_capability_context
from apps.core.organizations import ensure_current_organization, primary_membership
from .graph import run_sop, catalog, resume_approval


def _business_role(user) -> str:
    membership = primary_membership(user)
    if not membership:
        return "operator"
    return {"owner": "director", "admin": "manager", "member": "operator"}.get(membership.role, "operator")


def _with_capability_step(result: dict, capability: dict | None) -> dict:
    if not capability:
        return result
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
    steps = [step, *(result.get("steps") or [])]
    return {**result, "steps": steps, "capability": capability}


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

    organization = ensure_current_organization(request.user)
    role = executor.execution_role if executor else _business_role(request.user)
    requested_trace_id = str(request.data.get("trace_id") or "").strip()
    capability = (
        build_agent_capability_context(
            executor,
            request.user,
            text,
            record_usage=True,
        )
        if executor
        else None
    )
    run_payload = dict(payload) if isinstance(payload, dict) else {}
    if capability:
        run_payload["_agent_kb_ids"] = capability.get("configured_knowledge_base_ids") or []
    result = run_sop(
        text,
        run_payload,
        role,
        trace_id=requested_trace_id or None,
        user=request.user,
        organization=organization,
    )
    result = _with_capability_step(result, capability)

    if request.data.get("mode") == "task_create" and not result.get("action"):
        fallback_steps = [
            {
                **step,
                "status": "skipped" if step.get("status") == "block" else step.get("status"),
                "detail": "未匹配自动化 SOP，转为普通人工任务。" if step.get("status") == "block" else step.get("detail"),
            }
            for step in (result.get("steps") or [])
        ]
        result = {
            **result,
            "decision": "allow",
            "action": "task.manual",
            "result": {
                "ok": True,
                "execution_mode": "manual_task",
                "task_created": True,
                "external_write_performed": False,
                "user_message": "任务已创建并分配，等待负责人处理。",
            },
            "steps": [
                *fallback_steps,
                {
                    "node": "人工任务兜底",
                    "status": "done",
                    "detail": "未匹配自动化 SOP，已按普通人工任务创建，不视为执行失败。",
                    "data": {"mode": "manual_task"},
                },
            ],
        }

    if executor:
        result["executor"] = AgentProfileSerializer(
            executor,
            context={"request": request},
        ).data
    return Response(result)


@api_view(["GET"])
def actions_catalog(request):
    return Response(catalog(user=request.user if request.user.is_authenticated else None))


@api_view(["POST"])
def resume(request):
    """审批通过后续跑: body { approval_id, approve, approver, comment }。"""
    approval_id = request.data.get("approval_id")
    if not approval_id:
        return Response({"ok": False, "error": "缺少 approval_id"}, status=400)
    return Response(resume_approval(
        int(approval_id),
        approve=bool(request.data.get("approve", True)),
        approver=request.user.get_username(),
        comment=request.data.get("comment") or "",
    ))
