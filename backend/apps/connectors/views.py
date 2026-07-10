from rest_framework.decorators import api_view
from rest_framework.response import Response

from .base import list_connectors


@api_view(["GET"])
def connectors(request):
    data = list_connectors()
    return Response({"count": len(data), "results": data})
