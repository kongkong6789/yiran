from rest_framework.decorators import api_view
from rest_framework.response import Response

from .registry import OBJECTS, ROLE_BUDGET, list_actions


@api_view(["GET"])
def objects(request):
    return Response({"objects": OBJECTS, "role_budget": ROLE_BUDGET})


@api_view(["GET"])
def actions(request):
    return Response({"count": len(list_actions()), "results": list_actions()})
