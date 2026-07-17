from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .overview import fusion_overview
from .fact_health import fact_health
from .simulation import (
    get_demo_model,
    list_demo_models,
    simulate_discrete_stock_flow,
)
from .evidence import build_evidence_graph
from .governance import governance_state
from .council_lab import run_council_review, suggest_panel
from .agents_catalog import agents_catalog


@api_view(["GET"])
def overview(request):
    return Response(fusion_overview())


@api_view(["GET"])
def facts_health(request):
    return Response(fact_health())


@api_view(["GET"])
def loops_models(request):
    return Response({"results": list_demo_models()})


@api_view(["GET", "POST"])
def loops_simulate(request):
    if request.method == "GET":
        model = get_demo_model(request.query_params.get("model_id", "company_8_stock"))
        if not model:
            return Response({"error": "unknown model"}, status=status.HTTP_404_NOT_FOUND)
        periods = int(request.query_params.get("periods") or 12)
        return Response(simulate_discrete_stock_flow(model, periods=periods))

    body = request.data if isinstance(request.data, dict) else {}
    model_id = body.get("model_id") or "company_8_stock"
    model = body.get("model") or get_demo_model(model_id)
    if not model:
        return Response({"error": "unknown model"}, status=status.HTTP_400_BAD_REQUEST)
    periods = int(body.get("periods") or 12)
    initial = body.get("initial_values") or None
    interventions = body.get("interventions") or None
    return Response(
        simulate_discrete_stock_flow(
            model,
            initial_values=initial,
            interventions=interventions,
            periods=periods,
        )
    )


@api_view(["GET"])
def evidence_graph(request):
    limit = int(request.query_params.get("limit") or 200)
    return Response(build_evidence_graph(limit=limit))


@api_view(["GET"])
def governance(request):
    return Response(governance_state())


@api_view(["GET", "POST"])
def council(request):
    if request.method == "GET":
        return Response(suggest_panel(request.query_params.get("domain") or ""))
    body = request.data if isinstance(request.data, dict) else {}
    return Response(
        run_council_review(
            decision_context=str(body.get("decision_context") or body.get("context") or ""),
            domain=str(body.get("domain") or ""),
            evidence=str(body.get("evidence") or ""),
        )
    )


@api_view(["GET"])
def agents(request):
    return Response(agents_catalog())
