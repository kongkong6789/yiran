"""Loops API:回路 CRUD、闭环检测、人工确认。"""
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.ontology.models import OntRelation

from .loop_detect import detect_from_queryset, diagnose_loop_detection
from .models import FeedbackLoop, LoopMember


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
    members = list(loop.members.select_related("relation__source", "relation__target").order_by("sequence"))
    data = {
        "id": loop.id,
        "code": loop.code,
        "name": loop.name,
        "loop_type": loop.loop_type,
        "description": loop.description,
        "confidence": loop.confidence,
        "status": loop.status,
        "confirmed_by": loop.confirmed_by,
        "confirmed_at": loop.confirmed_at.isoformat() if loop.confirmed_at else None,
        "member_count": len(members),
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
        rel = get_object_or_404(OntRelation, id=rid)
        LoopMember.objects.create(loop=loop, relation=rel, sequence=i)


@api_view(["GET", "POST"])
def loops(request):
    if request.method == "GET":
        status_filter = request.query_params.get("status")
        qs = FeedbackLoop.objects.all()
        if status_filter:
            qs = qs.filter(status=status_filter)
        return Response({"results": [_loop_dict(x) for x in qs[:200]]})

    d = request.data
    name = (d.get("name") or "").strip()
    if not name:
        return Response({"error": "name 必填"}, status=status.HTTP_400_BAD_REQUEST)
    relation_ids = d.get("relation_ids") or []
    loop = FeedbackLoop.objects.create(
        code=(d.get("code") or "").strip(),
        name=name,
        loop_type=d.get("loop_type", FeedbackLoop.LoopType.R),
        description=(d.get("description") or "").strip(),
        confidence=int(d.get("confidence") or 0),
        status=d.get("status", FeedbackLoop.Status.CANDIDATE),
    )
    if relation_ids:
        _apply_members(loop, [int(x) for x in relation_ids])
    return Response(_loop_dict(loop, detail=True), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
def loop_detail(request, loop_id: int):
    loop = get_object_or_404(FeedbackLoop, id=loop_id)
    if request.method == "DELETE":
        loop.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    if request.method == "GET":
        return Response(_loop_dict(loop, detail=True))

    d = request.data
    for f in ("code", "name", "loop_type", "description", "confidence", "status"):
        if f in d:
            setattr(loop, f, d[f])
    loop.save()
    if "relation_ids" in d:
        _apply_members(loop, [int(x) for x in d["relation_ids"]])
    return Response(_loop_dict(loop, detail=True))


@api_view(["POST"])
def loop_confirm(request, loop_id: int):
    loop = get_object_or_404(FeedbackLoop, id=loop_id)
    loop.status = FeedbackLoop.Status.CONFIRMED
    loop.confirmed_by = (request.data.get("confirmed_by") or "业务负责人").strip()
    loop.confirmed_at = timezone.now()
    if request.data.get("confidence") is not None:
        loop.confidence = int(request.data["confidence"])
    loop.save()
    return Response(_loop_dict(loop, detail=True))


@api_view(["POST"])
def loop_detect(request):
    """在 CausalLink 候选(或指定 relation_ids)上运行闭环检测。"""
    rel_ids = request.data.get("relation_ids")
    if rel_ids:
        qs = OntRelation.objects.filter(id__in=rel_ids)
        candidates_only = False
    elif request.data.get("candidates_only", True):
        qs = OntRelation.objects.filter(is_causal_candidate=True)
        candidates_only = True
    else:
        qs = OntRelation.objects.all()
        candidates_only = False
    max_len = min(int(request.data.get("max_len") or 8), 12)
    all_relations = list(OntRelation.objects.select_related("source", "target")[:800])
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
    relation_ids = d.get("relation_ids") or []
    if len(relation_ids) < 2:
        return Response({"error": "relation_ids 至少 2 条"}, status=status.HTTP_400_BAD_REQUEST)
    loop = FeedbackLoop.objects.create(
        code=(d.get("code") or "").strip(),
        name=(d.get("name") or "未命名回路").strip(),
        loop_type=d.get("loop_type", "R"),
        description=(d.get("description") or "").strip(),
        confidence=int(d.get("confidence") or 30),
        status=FeedbackLoop.Status.CANDIDATE,
    )
    _apply_members(loop, [int(x) for x in relation_ids])
    return Response(_loop_dict(loop, detail=True), status=status.HTTP_201_CREATED)


@api_view(["GET"])
def causal_candidates(request):
    qs = OntRelation.objects.filter(is_causal_candidate=True).select_related("source", "target")
    return Response({"results": [_rel_brief(r) for r in qs[:500]]})
