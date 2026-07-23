# -*- coding: utf-8 -*-
"""Operational Loops API: CRUD, discover, publish, runs."""
from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.core.organizations import ensure_current_organization

from .models import OperationalLoop, OperationalLoopRun, default_ooda_definition
from . import ops_engine


def _loop_payload(loop: OperationalLoop, *, detail: bool = False) -> dict:
    latest_run = None
    if detail:
        latest = loop.runs.order_by("-id").first()
        if latest:
            latest_run = _run_payload(latest)
    else:
        latest = loop.runs.order_by("-id").only(
            "id", "run_key", "status", "phase", "progress", "round", "updated_at"
        ).first()
        if latest:
            latest_run = {
                "id": latest.id,
                "run_key": latest.run_key,
                "status": latest.status,
                "phase": latest.phase,
                "progress": latest.progress,
                "round": latest.round,
                "updated_at": latest.updated_at.isoformat(),
            }
    return {
        "id": loop.id,
        "loop_key": loop.loop_key,
        "name": loop.name,
        "description": loop.description,
        "status": loop.status,
        "source": loop.source,
        "confidence": loop.confidence,
        "definition": loop.definition,
        "knowledge_refs": loop.knowledge_refs,
        "metrics_snapshot": loop.metrics_snapshot,
        "ooda_phase": loop.ooda_phase,
        "last_result": loop.last_result if detail else {},
        "current_run_key": loop.current_run_key,
        "linked_feedback_loop_id": loop.linked_feedback_loop_id,
        "latest_run": latest_run,
        "created_at": loop.created_at.isoformat(),
        "updated_at": loop.updated_at.isoformat(),
    }


def _run_payload(run: OperationalLoopRun) -> dict:
    return {
        "id": run.id,
        "run_key": run.run_key,
        "loop_id": run.loop_id,
        "round": run.round,
        "status": run.status,
        "phase": run.phase,
        "progress": run.progress,
        "trace_id": run.trace_id,
        "logs": run.logs,
        "phase_results": run.phase_results,
        "metrics": run.metrics,
        "error": run.error,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "created_at": run.created_at.isoformat(),
        "updated_at": run.updated_at.isoformat(),
    }


@api_view(["GET", "POST"])
def ops_loops(request):
    organization = ensure_current_organization(request.user)
    if request.method == "GET":
        status_filter = (request.query_params.get("status") or "").strip()
        qs = OperationalLoop.objects.filter(organization=organization)
        if status_filter:
            qs = qs.filter(status=status_filter)
        rows = list(qs[:200])
        return Response({"results": [_loop_payload(x) for x in rows]})

    data = request.data or {}
    name = (data.get("name") or "").strip()
    if not name:
        return Response({"error": "name 必填"}, status=status.HTTP_400_BAD_REQUEST)
    definition = data.get("definition") if isinstance(data.get("definition"), dict) else default_ooda_definition()
    loop = OperationalLoop.objects.create(
        organization=organization,
        name=name,
        description=(data.get("description") or "").strip(),
        status=data.get("status") or OperationalLoop.Status.DRAFT,
        source=data.get("source") or OperationalLoop.Source.MANUAL,
        confidence=int(data.get("confidence") or 0),
        definition=definition,
        knowledge_refs=data.get("knowledge_refs") if isinstance(data.get("knowledge_refs"), list) else [],
        created_by=request.user,
    )
    return Response(_loop_payload(loop, detail=True), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
def ops_loop_detail(request, loop_id: int):
    organization = ensure_current_organization(request.user)
    loop = get_object_or_404(OperationalLoop, id=loop_id, organization=organization)
    if request.method == "GET":
        return Response(_loop_payload(loop, detail=True))
    if request.method == "DELETE":
        loop.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    data = request.data or {}
    if "name" in data:
        loop.name = (data.get("name") or "").strip() or loop.name
    if "description" in data:
        loop.description = (data.get("description") or "").strip()
    if "confidence" in data:
        loop.confidence = int(data.get("confidence") or 0)
    if isinstance(data.get("definition"), dict):
        loop.definition = data["definition"]
    if isinstance(data.get("knowledge_refs"), list):
        loop.knowledge_refs = data["knowledge_refs"]
    if data.get("status") in {c.value for c in OperationalLoop.Status}:
        loop.status = data["status"]
    loop.save()
    return Response(_loop_payload(loop, detail=True))


@api_view(["POST"])
def ops_loop_publish(request, loop_id: int):
    organization = ensure_current_organization(request.user)
    loop = get_object_or_404(OperationalLoop, id=loop_id, organization=organization)
    loop.status = OperationalLoop.Status.ACTIVE
    loop.ooda_phase = OperationalLoop.Phase.IDLE
    loop.save(update_fields=["status", "ooda_phase", "updated_at"])
    return Response(_loop_payload(loop, detail=True))


@api_view(["POST"])
def ops_loop_pause(request, loop_id: int):
    organization = ensure_current_organization(request.user)
    loop = get_object_or_404(OperationalLoop, id=loop_id, organization=organization)
    loop.status = OperationalLoop.Status.PAUSED
    loop.save(update_fields=["status", "updated_at"])
    return Response(_loop_payload(loop, detail=True))


@api_view(["POST"])
def ops_discover(request):
    organization = ensure_current_organization(request.user)
    query = (request.data.get("query") or "").strip()
    result = ops_engine.discover_loop_candidates(user=request.user, query=query)
    result["organization_id"] = organization.id
    return Response(result)


@api_view(["POST"])
def ops_from_candidate(request):
    organization = ensure_current_organization(request.user)
    if organization is None:
        return Response({"error": "未找到当前企业，请先加入或创建企业"}, status=status.HTTP_400_BAD_REQUEST)
    data = request.data or {}
    title = (data.get("title") or data.get("name") or "").strip()
    if not title:
        return Response({"error": "title 必填"}, status=status.HTTP_400_BAD_REQUEST)
    title = title[:160]
    definition = data.get("suggested_definition") or data.get("definition")
    if not isinstance(definition, dict):
        definition = default_ooda_definition()
    try:
        confidence = int(float(str(data.get("score") or data.get("confidence") or 0).replace("%", "").strip() or 0))
    except (TypeError, ValueError):
        confidence = 0
    confidence = max(0, min(100, confidence))
    refs = data.get("evidence_refs")
    if not isinstance(refs, list):
        refs = []
    try:
        loop = OperationalLoop.objects.create(
            organization=organization,
            name=title,
            description=(data.get("rationale") or data.get("description") or "").strip()[:4000],
            status=OperationalLoop.Status.DRAFT,
            source=OperationalLoop.Source.AI,
            confidence=confidence,
            definition=definition,
            knowledge_refs=refs,
            created_by=request.user,
        )
    except Exception as exc:
        return Response(
            {"error": "create_failed", "message": f"创建草案失败：{exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    return Response(_loop_payload(loop, detail=True), status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
def ops_loop_runs(request, loop_id: int):
    organization = ensure_current_organization(request.user)
    loop = get_object_or_404(OperationalLoop, id=loop_id, organization=organization)
    if request.method == "GET":
        rows = list(loop.runs.order_by("-id")[:50])
        return Response({"results": [_run_payload(x) for x in rows]})

    latest = loop.runs.order_by("-id").first()
    round_no = (latest.round + 1) if latest else 1
    run = OperationalLoopRun.objects.create(
        organization=organization,
        loop=loop,
        round=round_no,
        status=OperationalLoopRun.Status.PENDING,
        created_by=request.user,
    )
    loop.current_run_key = run.run_key
    loop.status = OperationalLoop.Status.ACTIVE
    loop.save(update_fields=["current_run_key", "status", "updated_at"])
    ops_engine.start_run_async(run.id)
    return Response(_run_payload(run), status=status.HTTP_202_ACCEPTED)


@api_view(["GET"])
def ops_run_detail(request, run_id: int):
    organization = ensure_current_organization(request.user)
    run = get_object_or_404(OperationalLoopRun, id=run_id, organization=organization)
    return Response(_run_payload(run))


@api_view(["POST"])
def ops_run_confirm_act(request, run_id: int):
    organization = ensure_current_organization(request.user)
    run = get_object_or_404(OperationalLoopRun, id=run_id, organization=organization)
    if run.status != OperationalLoopRun.Status.AWAITING_CONFIRM:
        return Response({"error": "当前运行不在待确认状态"}, status=status.HTTP_400_BAD_REQUEST)
    ops_engine.confirm_act_and_finish(run.id)
    run.refresh_from_db()
    return Response(_run_payload(run))
