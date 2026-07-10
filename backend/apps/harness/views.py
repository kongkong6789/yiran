from rest_framework.decorators import api_view
from rest_framework.response import Response

from .gate import evaluate


@api_view(["POST"])
def check(request):
    """对单个动作运行闸机校验(不执行,仅评估)。"""
    action = request.data.get("action", "")
    payload = request.data.get("payload", {}) or {}
    role = request.data.get("role", "operator")
    outcome = evaluate(action, payload, role)
    return Response(outcome.as_dict())
