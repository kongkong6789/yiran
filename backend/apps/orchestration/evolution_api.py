"""APIs for SOP run history, evolution signals, and proposals."""
from __future__ import annotations

import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.organizations import ensure_current_organization, is_organization_admin

from .evolution_analyzer import analyze_sop_evolution, next_evolution_version_number
from .models import SopEvolutionProposal, SopEvolutionSignal, SopNodeRun, SopRun, SopVersion
from .sop_api import _can_edit, _find_sop, _version_payload
from .sop_runtime import build_trial_payload, execute_sop_version
from .sop_schema import graph_hash, validate_graph
from .sop_trial import _business_role


def _run_list_item(run: SopRun) -> dict:
    return {
        "runKey": str(run.run_key),
        "traceId": run.trace_id,
        "status": run.status,
        "source": run.source,
        "isTrial": bool(run.is_trial),
        "currentNode": run.current_node,
        "version": run.version.version,
        "sopKey": run.version.definition.sop_key,
        "error": (run.error or "")[:300],
        "missingFields": run.missing_fields or [],
        "outcomeTags": run.outcome_tags or [],
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
        "userId": run.user_id,
    }


def _node_run_item(node: SopNodeRun) -> dict:
    return {
        "sequence": node.sequence,
        "nodeKey": node.node_key,
        "nodeType": node.node_type,
        "title": node.title,
        "status": node.status,
        "error": (node.error or "")[:300],
        "startedAt": node.started_at.isoformat() if node.started_at else None,
        "finishedAt": node.finished_at.isoformat() if node.finished_at else None,
        "outputPreview": _preview_json(node.output_data),
    }


def _preview_json(value, *, limit: int = 240) -> dict | list | str | None:
    if value in (None, "", [], {}):
        return None
    if isinstance(value, (dict, list)):
        text = str(value)
        if len(text) > limit:
            return {"_truncated": True, "preview": text[:limit]}
        return value
    return str(value)[:limit]


def _signal_item(row: SopEvolutionSignal) -> dict:
    return {
        "id": row.id,
        "sopKey": row.definition.sop_key,
        "version": row.version.version if row.version_id else None,
        "nodeKey": row.node_key,
        "signalType": row.signal_type,
        "count": row.count,
        "lastSeenAt": row.last_seen_at.isoformat() if row.last_seen_at else None,
        "sampleRunIds": row.sample_run_ids or [],
        "payloadSummary": row.payload_summary or {},
    }


def _proposal_item(row: SopEvolutionProposal, *, include_graph: bool = False) -> dict:
    payload = {
        "id": row.id,
        "sopKey": row.definition.sop_key,
        "status": row.status,
        "category": row.category,
        "riskLevel": row.risk_level,
        "title": row.title,
        "rationale": row.rationale,
        "evidence": row.evidence or {},
        "patch": row.patch or {},
        "baseVersion": row.base_version.version if row.base_version_id else None,
        "draftVersion": row.draft_version.version if row.draft_version_id else None,
        "trialResult": row.trial_result or {},
        "createdBySystem": bool(row.created_by_system),
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
        "reviewedAt": row.reviewed_at.isoformat() if row.reviewed_at else None,
    }
    if include_graph:
        payload["proposedGraph"] = row.proposed_graph or {}
    return payload


def _get_proposal(organization, sop_key: str, proposal_id: int):
    sop = _find_sop(organization, sop_key)
    if not sop:
        return None, None, Response({"error": "SOP 不存在。"}, status=404)
    proposal = (
        SopEvolutionProposal.objects.filter(id=proposal_id, definition=sop)
        .select_related("base_version", "draft_version", "definition")
        .first()
    )
    if not proposal:
        return sop, None, Response({"error": "进化提案不存在。"}, status=404)
    return sop, proposal, None


def _create_draft_from_proposal(*, sop, proposal: SopEvolutionProposal, user) -> SopVersion:
    graph = validate_graph(proposal.proposed_graph or {})
    base = proposal.base_version or sop.versions.order_by("-created_at").first()
    version_number = next_evolution_version_number(sop)
    row = SopVersion.objects.create(
        definition=sop,
        version=version_number,
        status=SopVersion.Status.DRAFT,
        graph=graph,
        input_schema=(base.input_schema if base else {}) or {},
        output_schema=(base.output_schema if base else {}) or {},
        trigger_intents=(base.trigger_intents if base else []) or [],
        utterance_examples=(base.utterance_examples if base else []) or [],
        change_summary=f"进化提案：{proposal.title}"[:300],
        content_hash=graph_hash(
            graph=graph,
            input_schema=(base.input_schema if base else {}) or {},
            output_schema=(base.output_schema if base else {}) or {},
            trigger_intents=(base.trigger_intents if base else []) or [],
            examples=(base.utterance_examples if base else []) or [],
        ),
        created_by=user,
    )
    proposal.draft_version = row
    proposal.status = SopEvolutionProposal.Status.DRAFTED
    proposal.save(update_fields=["draft_version", "status", "updated_at"])
    return row


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def sop_runs(request, sop_key: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    if not sop:
        return Response({"error": "SOP 不存在。"}, status=404)

    qs = (
        SopRun.objects.filter(version__definition=sop)
        .select_related("version", "version__definition")
        .order_by("-started_at")
    )
    source = str(request.query_params.get("source") or "").strip().lower()
    if source in {SopRun.Source.LIVE, SopRun.Source.TRIAL, SopRun.Source.RESUME}:
        qs = qs.filter(source=source)
    trial = str(request.query_params.get("trial") or "").strip().lower()
    if trial in {"1", "true", "yes"}:
        qs = qs.filter(is_trial=True)
    elif trial in {"0", "false", "no"}:
        qs = qs.filter(is_trial=False)
    status = str(request.query_params.get("status") or "").strip().lower()
    if status:
        qs = qs.filter(status=status)

    try:
        limit = min(max(int(request.query_params.get("limit") or 30), 1), 100)
    except (TypeError, ValueError):
        limit = 30

    rows = list(qs[:limit])
    return Response({"results": [_run_list_item(row) for row in rows], "count": len(rows)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def sop_run_detail(request, run_key: str):
    organization = ensure_current_organization(request.user)
    run = (
        SopRun.objects.filter(run_key=run_key, organization=organization)
        .select_related("version", "version__definition")
        .first()
    )
    if not run:
        return Response({"error": "运行记录不存在。"}, status=404)

    nodes = list(run.node_runs.order_by("sequence")[:200])
    payload = _run_list_item(run)
    payload.update(
        {
            "inputData": run.input_data or {},
            "stateData": run.state_data or {},
            "outputData": run.output_data or {},
            "nodes": [_node_run_item(node) for node in nodes],
        }
    )
    return Response(payload)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def sop_evolution_signals(request, sop_key: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    if not sop:
        return Response({"error": "SOP 不存在。"}, status=404)

    qs = SopEvolutionSignal.objects.filter(definition=sop).select_related("version", "definition")
    signal_type = str(request.query_params.get("type") or "").strip()
    if signal_type:
        qs = qs.filter(signal_type=signal_type)

    try:
        limit = min(max(int(request.query_params.get("limit") or 50), 1), 200)
    except (TypeError, ValueError):
        limit = 50

    rows = list(qs.order_by("-count", "-last_seen_at")[:limit])
    return Response({"results": [_signal_item(row) for row in rows], "count": len(rows)})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def sop_evolution_proposals(request, sop_key: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    if not sop:
        return Response({"error": "SOP 不存在。"}, status=404)

    if request.method == "GET":
        qs = SopEvolutionProposal.objects.filter(definition=sop).select_related(
            "base_version", "draft_version", "definition"
        )
        status = str(request.query_params.get("status") or "").strip()
        if status:
            qs = qs.filter(status=status)
        try:
            limit = min(max(int(request.query_params.get("limit") or 40), 1), 100)
        except (TypeError, ValueError):
            limit = 40
        rows = list(qs.order_by("-created_at")[:limit])
        return Response({"results": [_proposal_item(row) for row in rows], "count": len(rows)})

    if sop.is_system:
        return Response({"error": "系统 SOP 不支持写入进化提案，请先复制到工作区。"}, status=403)
    if not _can_edit(sop, request.user) and not is_organization_admin(request.user, organization):
        return Response({"error": "没有权限分析该 SOP。"}, status=403)
    created = analyze_sop_evolution(definition=sop, user=request.user, enrich_with_llm=True)
    drafted = []
    for proposal in created:
        if (
            proposal.risk_level == SopEvolutionProposal.RiskLevel.LOW
            and proposal.status == SopEvolutionProposal.Status.VALIDATED
            and proposal.proposed_graph
        ):
            try:
                with transaction.atomic():
                    _create_draft_from_proposal(sop=sop, proposal=proposal, user=request.user)
                drafted.append(proposal.id)
            except Exception:
                continue
    return Response(
        {
            "created": [_proposal_item(row, include_graph=True) for row in created],
            "autoDraftedIds": drafted,
            "count": len(created),
        },
        status=201,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def sop_evolution_proposal_detail(request, sop_key: str, proposal_id: int):
    organization = ensure_current_organization(request.user)
    _sop, proposal, error = _get_proposal(organization, sop_key, proposal_id)
    if error:
        return error
    return Response(_proposal_item(proposal, include_graph=True))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_evolution_proposal_trial(request, sop_key: str, proposal_id: int):
    organization = ensure_current_organization(request.user)
    sop, proposal, error = _get_proposal(organization, sop_key, proposal_id)
    if error:
        return error
    if sop.is_system:
        return Response({"error": "系统 SOP 请先复制后再试跑进化提案。"}, status=403)
    base = proposal.base_version or sop.versions.order_by("-created_at").first()
    if not base:
        return Response({"error": "缺少可试跑的基础版本。"}, status=400)
    try:
        graph = validate_graph(proposal.proposed_graph or {})
        text = str(request.data.get("text") or "试跑进化提案").strip()[:500]
        payload_in = request.data.get("payload") if isinstance(request.data.get("payload"), dict) else {}
        trial_payload = build_trial_payload(graph, payload_in, text)
        result = execute_sop_version(
            version=base,
            text=text,
            payload=trial_payload,
            role=_business_role(request.user),
            trace_id=f"sop-evo-trial-{uuid.uuid4().hex[:16]}",
            user=request.user,
            organization=organization,
            graph_override=graph,
        )
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    except Exception as exc:
        return Response({"error": f"提案试跑失败：{exc}"}, status=500)

    decision = str(result.get("decision") or "")
    ok = decision in {"allow", "need_input"}
    proposal.trial_result = {
        "decision": decision,
        "error": result.get("error"),
        "missing": result.get("missing") or [],
        "traceId": result.get("trace_id"),
        "runId": ((result.get("sop") or {}) if isinstance(result.get("sop"), dict) else {}).get("run_id"),
    }
    proposal.status = (
        SopEvolutionProposal.Status.TRIAL_PASSED if ok else SopEvolutionProposal.Status.TRIAL_FAILED
    )
    proposal.save(update_fields=["trial_result", "status", "updated_at"])
    return Response({"proposal": _proposal_item(proposal, include_graph=True), "result": result})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_evolution_proposal_draft(request, sop_key: str, proposal_id: int):
    organization = ensure_current_organization(request.user)
    sop, proposal, error = _get_proposal(organization, sop_key, proposal_id)
    if error:
        return error
    if sop.is_system or not _can_edit(sop, request.user):
        return Response({"error": "没有权限从提案生成草稿。"}, status=403)
    if not proposal.proposed_graph:
        return Response({"error": "该提案没有可应用的流程图。"}, status=400)
    if proposal.draft_version_id:
        return Response(
            {
                "proposal": _proposal_item(proposal, include_graph=True),
                "version": _version_payload(proposal.draft_version),
            }
        )
    try:
        with transaction.atomic():
            row = _create_draft_from_proposal(sop=sop, proposal=proposal, user=request.user)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    return Response(
        {"proposal": _proposal_item(proposal, include_graph=True), "version": _version_payload(row)},
        status=201,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_evolution_proposal_accept(request, sop_key: str, proposal_id: int):
    organization = ensure_current_organization(request.user)
    sop, proposal, error = _get_proposal(organization, sop_key, proposal_id)
    if error:
        return error
    if sop.is_system or not _can_edit(sop, request.user):
        return Response({"error": "没有权限采纳该提案。"}, status=403)
    if not proposal.draft_version_id:
        try:
            with transaction.atomic():
                _create_draft_from_proposal(sop=sop, proposal=proposal, user=request.user)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)
    proposal.status = SopEvolutionProposal.Status.ACCEPTED
    proposal.reviewed_by = request.user
    proposal.reviewed_at = timezone.now()
    proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    return Response(
        {
            "proposal": _proposal_item(proposal, include_graph=True),
            "version": _version_payload(proposal.draft_version) if proposal.draft_version_id else None,
            "note": "已采纳为草稿版本，请人工发布后才会影响正式执行。",
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_evolution_proposal_reject(request, sop_key: str, proposal_id: int):
    organization = ensure_current_organization(request.user)
    sop, proposal, error = _get_proposal(organization, sop_key, proposal_id)
    if error:
        return error
    if sop.is_system or not _can_edit(sop, request.user):
        return Response({"error": "没有权限拒绝该提案。"}, status=403)
    proposal.status = SopEvolutionProposal.Status.REJECTED
    proposal.reviewed_by = request.user
    proposal.reviewed_at = timezone.now()
    proposal.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])
    return Response({"proposal": _proposal_item(proposal)})
