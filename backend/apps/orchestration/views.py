from rest_framework.decorators import api_view
from rest_framework.response import Response

from .graph import run_sop, catalog, resume_approval


@api_view(["POST"])
def run(request):
    """执行一次 Agent SOP 编排。

    body: { "text": "帮我生成昨天的日报", "payload": {...}, "role": "operator" }
    """
    text = request.data.get("text", "")
    payload = request.data.get("payload", {}) or {}
    role = request.data.get("role", "operator")
    return Response(run_sop(text, payload, role))


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
