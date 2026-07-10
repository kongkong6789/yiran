from rest_framework.decorators import api_view
from rest_framework.response import Response

from .graph import run_sop, catalog


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
