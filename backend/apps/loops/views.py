"""Loops API:回路 CRUD、闭环检测、人工确认。"""
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.db.models import Count, Prefetch
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.ontology.models import OntRelation
from apps.core.organizations import ensure_current_organization, is_organization_admin

from .loop_detect import detect_from_queryset, diagnose_loop_detection
from .models import FeedbackLoop, LoopMember
from .simulation import ensure_inventory_pilot_loop, run_inventory_simulation, simulation_payload


def _rel_brief(r: OntRelation) -> dict:
    return {
        "id": r.id,
        "source": r.source_id,
        "target": r.target_id,
        "source_name": r.source.name,
        "target_name": r.target.name,
        "label": r.label,
        "polarity": r.polarity or "",
        "delay_days": r.delay_days,
        "evidence_score": r.evidence_score,
        "is_causal_candidate": r.is_causal_candidate,
    }


def _loop_dict(loop: FeedbackLoop, *, detail: bool = False) -> dict:
    prefetched_members = getattr(loop, "_api_members", None)
    if prefetched_members is not None:
        members = prefetched_members
        member_count = len(members)
    elif detail:
        members = list(loop.members.select_related("relation__source", "relation__target").order_by("sequence"))
        member_count = len(members)
    else:
        members = []
        member_count = (
            loop._api_member_count
            if hasattr(loop, "_api_member_count")
            else loop.members.count()
        )
    data = {
        "id": loop.id,
        "code": loop.code,
        "name": loop.name,
        "loop_type": loop.loop_type,
        "description": loop.description,
        "confidence": loop.confidence,
        "status": loop.status,
        "loop_key": loop.loop_key,
        "causal_maturity": loop.causal_maturity,
        "model_level": loop.model_level,
        "current_version": loop.current_version_number,
        "confirmed_by": loop.confirmed_by,
        "confirmed_at": loop.confirmed_at.isoformat() if loop.confirmed_at else None,
        "member_count": member_count,
        "created_at": loop.created_at.isoformat(),
        "updated_at": loop.updated_at.isoformat(),
    }
    if detail:
        data["members"] = [
            {
                "id": m.id,
                "sequence": m.sequence,
                "note": m.note,
                "relation": _rel_brief(m.relation),
            }
            for m in members
        ]
    return data


def _apply_members(loop: FeedbackLoop, relation_ids: list[int]) -> None:
    loop.members.all().delete()
    for i, rid in enumerate(relation_ids):
        rel = get_object_or_404(OntRelation, id=rid, organization=loop.organization)
        LoopMember.objects.create(loop=loop, relation=rel, sequence=i)


@api_view(["GET", "POST"])
def loops(request):
    organization = ensure_current_organization(request.user)
    ensure_inventory_pilot_loop(organization, request.user)
    if request.method == "GET":
        status_filter = request.query_params.get("status")
        include_members = request.query_params.get("include_members") in {"1", "true", "yes"}
        qs = FeedbackLoop.objects.filter(organization=organization).annotate(_api_member_count=Count("members"))
        if status_filter:
            qs = qs.filter(status=status_filter)
        if include_members:
            qs = qs.prefetch_related(Prefetch(
                "members",
                queryset=LoopMember.objects.select_related(
                    "relation__source", "relation__target"
                ).order_by("sequence"),
                to_attr="_api_members",
            ))
        rows = list(qs[:200])
        return Response({"results": [_loop_dict(x, detail=include_members) for x in rows]})

    d = request.data
    name = (d.get("name") or "").strip()
    if not name:
        return Response({"error": "name 必填"}, status=status.HTTP_400_BAD_REQUEST)
    relation_ids = d.get("relation_ids") or []
    loop = FeedbackLoop.objects.create(
        organization=organization,
        code=(d.get("code") or "").strip(),
        name=name,
        loop_type=d.get("loop_type", FeedbackLoop.LoopType.R),
        description=(d.get("description") or "").strip(),
        confidence=int(d.get("confidence") or 0),
        status=d.get("status", FeedbackLoop.Status.CANDIDATE),
        created_by=request.user,
    )
    if relation_ids:
        _apply_members(loop, [int(x) for x in relation_ids])
    return Response(_loop_dict(loop, detail=True), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
def loop_detail(request, loop_id: int):
    organization = ensure_current_organization(request.user)
    loop = get_object_or_404(FeedbackLoop, id=loop_id, organization=organization)
    if request.method == "DELETE":
        loop.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    if request.method == "GET":
        return Response(_loop_dict(loop, detail=True))

    d = request.data
    if d.get("status") == FeedbackLoop.Status.CONFIRMED and not is_organization_admin(request.user, organization):
        return Response({"error": "仅企业管理员可以确认回路"}, status=status.HTTP_403_FORBIDDEN)
    for f in ("code", "name", "loop_type", "description", "confidence", "status"):
        if f in d:
            setattr(loop, f, d[f])
    loop.save()
    if "relation_ids" in d:
        _apply_members(loop, [int(x) for x in d["relation_ids"]])
    return Response(_loop_dict(loop, detail=True))


@api_view(["POST"])
def loop_confirm(request, loop_id: int):
    organization = ensure_current_organization(request.user)
    if not is_organization_admin(request.user, organization):
        return Response({"error": "仅企业管理员可以确认回路"}, status=status.HTTP_403_FORBIDDEN)
    loop = get_object_or_404(FeedbackLoop, id=loop_id, organization=organization)
    loop.status = FeedbackLoop.Status.CONFIRMED
    loop.confirmed_by = request.user.get_username()
    loop.confirmed_by_user = request.user
    loop.confirmed_at = timezone.now()
    if request.data.get("confidence") is not None:
        loop.confidence = int(request.data["confidence"])
    loop.save()
    return Response(_loop_dict(loop, detail=True))


@api_view(["POST"])
def loop_detect(request):
    """在 CausalLink 候选(或指定 relation_ids)上运行闭环检测。"""
    organization = ensure_current_organization(request.user)
    rel_ids = request.data.get("relation_ids")
    if rel_ids:
        qs = OntRelation.objects.filter(organization=organization, id__in=rel_ids)
        candidates_only = False
    elif request.data.get("candidates_only", True):
        qs = OntRelation.objects.filter(organization=organization, is_causal_candidate=True)
        candidates_only = True
    else:
        qs = OntRelation.objects.filter(organization=organization)
        candidates_only = False
    max_len = min(int(request.data.get("max_len") or 8), 12)
    all_relations = list(OntRelation.objects.filter(organization=organization).select_related("source", "target")[:800])
    candidates = detect_from_queryset(
        qs,
        max_len=max_len,
        max_cycles=40,
        candidates_only=candidates_only,
    )
    diagnostics = diagnose_loop_detection(
        all_relations,
        candidates_only=candidates_only,
        max_len=max_len,
    )
    return Response({
        "candidates": candidates,
        "count": len(candidates),
        "diagnostics": diagnostics,
    })


@api_view(["POST"])
def loop_from_candidate(request):
    """将检测结果保存为候选 Loop。"""
    d = request.data
    organization = ensure_current_organization(request.user)
    relation_ids = d.get("relation_ids") or []
    if len(relation_ids) < 2:
        return Response({"error": "relation_ids 至少 2 条"}, status=status.HTTP_400_BAD_REQUEST)
    loop = FeedbackLoop.objects.create(
        organization=organization,
        code=(d.get("code") or "").strip(),
        name=(d.get("name") or "未命名回路").strip(),
        loop_type=d.get("loop_type", "R"),
        description=(d.get("description") or "").strip(),
        confidence=int(d.get("confidence") or 30),
        status=FeedbackLoop.Status.CANDIDATE,
        created_by=request.user,
    )
    _apply_members(loop, [int(x) for x in relation_ids])
    return Response(_loop_dict(loop, detail=True), status=status.HTTP_201_CREATED)


@api_view(["GET"])
def causal_candidates(request):
    organization = ensure_current_organization(request.user)
    qs = OntRelation.objects.filter(organization=organization, is_causal_candidate=True).select_related("source", "target")
    return Response({"results": [_rel_brief(r) for r in qs[:500]]})


@api_view(["GET"])
def loop_versions(request, loop_id: int):
    organization = ensure_current_organization(request.user)
    loop = get_object_or_404(FeedbackLoop, id=loop_id, organization=organization)
    return Response({"results": [{
        "id": version.id,
        "version": version.version,
        "status": version.status,
        "definition": version.definition,
        "parameter_hash": version.parameter_hash,
        "engine_version": version.engine_version,
        "stocks": list(version.stocks.values("key", "name", "unit", "lower_bound", "upper_bound")),
        "flows": list(version.flows.values("key", "name", "unit", "equation")),
        "metric_bindings": list(version.metric_bindings.values("variable_key", "contract__metric_id", "contract__version")),
        "evidence_count": version.evidence_bindings.count(),
        "created_at": version.created_at.isoformat(),
    } for version in loop.versions.all()]})


@api_view(["POST"])
def loop_simulate(request, loop_id: int):
    organization = ensure_current_organization(request.user)
    loop = get_object_or_404(FeedbackLoop, id=loop_id, organization=organization)
    key = str(request.headers.get("Idempotency-Key") or request.data.get("idempotency_key") or "").strip()
    if not key:
        return Response({"error": "缺少 Idempotency-Key"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        run = run_inventory_simulation(
            organization=organization,
            user=request.user,
            loop=loop,
            metric_result_ids=request.data.get("metric_result_ids") or [],
            parameters=request.data.get("parameters") or {},
            idempotency_key=key[:96],
        )
    except (ValueError, PermissionError) as exc:
        return Response({"error": str(exc), "code": "simulation_gate_blocked"}, status=status.HTTP_409_CONFLICT)
    return Response(simulation_payload(run), status=status.HTTP_201_CREATED)


@api_view(["GET"])
def simulation_run_detail(request, run_id: int):
    from .models import SimulationRun

    organization = ensure_current_organization(request.user)
    run = get_object_or_404(
        SimulationRun.objects.select_related("version__loop", "snapshot"),
        id=run_id,
        organization=organization,
    )
    return Response(simulation_payload(run))
