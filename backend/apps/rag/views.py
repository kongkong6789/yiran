from rest_framework.decorators import api_view
from rest_framework.response import Response

from .service import retrieve, CORPUS


@api_view(["GET"])
def docs(request):
    data = [{"doc_id": d.doc_id, "kind": d.kind, "title": d.title} for d in CORPUS]
    return Response({"count": len(data), "results": data})


@api_view(["GET"])
def search(request):
    q = request.query_params.get("q", "")
    return Response({"query": q, "results": retrieve(q)})
