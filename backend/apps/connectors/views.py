from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .base import list_connectors
from .jackyun import sync_to_datalake, jackyun_configured


@api_view(["GET"])
def connectors(request):
    data = list_connectors()
    return Response({
        "count": len(data),
        "results": data,
        "jackyun_configured": jackyun_configured(),
    })


@api_view(["POST"])
def jackyun_sync(request):
    """只读同步吉客云商品/订单到 DataLake,并重跑指标管道。"""
    try:
        result = sync_to_datalake()
        return Response(result)
    except Exception as exc:
        return Response(
            {"ok": False, "error": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
