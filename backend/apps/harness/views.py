from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .gate import evaluate
from .models import ApprovalRequest


def _ser(a: ApprovalRequest) -> dict:
    return {
        "id": a.id,
        "trace_id": a.trace_id,
        "action": a.action,
        "intent": a.intent,
        "payload": a.payload,
        "role": a.role,
        "status": a.status,
        "checks": a.checks,
        "dry_run": a.dry_run,
        "approver": a.approver,
        "comment": a.comment,
        "result": a.result,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "decided_at": a.decided_at.isoformat() if a.decided_at else None,
    }


@api_view(["POST"])
def check(request):
    """对单个动作运行闸机校验(不执行,仅评估)。"""
    action = request.data.get("action", "")
    payload = request.data.get("payload", {}) or {}
    role = request.data.get("role", "operator")
    outcome = evaluate(action, payload, role)
    return Response(outcome.as_dict())


@api_view(["GET"])
def approvals(request):
    status_q = request.query_params.get("status", "")
    qs = ApprovalRequest.objects.all()
    if status_q:
        qs = qs.filter(status=status_q)
    rows = [_ser(a) for a in qs[:50]]
    return Response({"count": len(rows), "results": rows})


@api_view(["POST"])
def decide(request, pk: int):
    """批准或驳回审批单;批准后自动续跑执行。"""
    from apps.orchestration.graph import resume_approval

    approve = bool(request.data.get("approve", True))
    approver = request.data.get("approver") or request.data.get("role") or "manager"
    comment = request.data.get("comment") or ""
    result = resume_approval(pk, approve=approve, approver=approver, comment=comment)
    code = status.HTTP_200_OK if result.get("ok") else status.HTTP_400_BAD_REQUEST
    return Response(result, status=code)
