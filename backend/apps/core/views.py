from rest_framework.decorators import api_view
from rest_framework.response import Response

from .architecture import ARCHITECTURE
from .models import AuditLog


@api_view(["GET"])
def health(request):
    return Response({"status": "ok", "service": "agent-saas-backend"})


@api_view(["GET"])
def architecture(request):
    """返回 7 层架构定义,供前端可视化渲染。"""
    return Response(ARCHITECTURE)


@api_view(["GET"])
def audit_logs(request):
    """审计日志列表(第6层闸机产生的记录)。"""
    limit = int(request.query_params.get("limit", 50))
    logs = AuditLog.objects.all()[:limit]
    data = [
        {
            "id": log.id,
            "trace_id": log.trace_id,
            "actor": log.actor,
            "intent": log.intent,
            "action": log.action,
            "payload": log.payload,
            "decision": log.decision,
            "checks": log.checks,
            "result": log.result,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]
    return Response({"count": len(data), "results": data})
