"""Collect and aggregate SOP evolution signals from production runs."""
from __future__ import annotations

from datetime import timedelta

from django.db.models import F
from django.utils import timezone

from .models import SopEvolutionSignal, SopNodeRun, SopRun

_SLOW_NODE_SECONDS = 45
_SAMPLE_LIMIT = 12


def _bump_signal(
    *,
    run: SopRun,
    signal_type: str,
    node_key: str = "",
    summary: dict | None = None,
) -> None:
    definition = run.version.definition
    defaults = {
        "version": run.version,
        "organization_id": run.organization_id,
        "count": 0,
        "sample_run_ids": [],
        "payload_summary": summary or {},
    }
    signal, _created = SopEvolutionSignal.objects.get_or_create(
        definition=definition,
        node_key=(node_key or "")[:96],
        signal_type=signal_type,
        defaults=defaults,
    )
    sample_ids = list(signal.sample_run_ids or [])
    run_id = str(run.run_key)
    if run_id not in sample_ids:
        sample_ids = ([run_id] + sample_ids)[:_SAMPLE_LIMIT]
    SopEvolutionSignal.objects.filter(id=signal.id).update(
        count=F("count") + 1,
        version_id=run.version_id,
        organization_id=run.organization_id,
        sample_run_ids=sample_ids,
        payload_summary=summary or signal.payload_summary or {},
        last_seen_at=timezone.now(),
    )


def record_run_signals(run: SopRun) -> list[str]:
    """Record learning signals for a finished non-trial run. Returns outcome tags."""
    tags: list[str] = []
    if run.is_trial:
        return tags

    if run.status == SopRun.Status.NEED_INPUT:
        tags.append("need_input")
        node_key = (run.current_node or "").strip()
        missing = [str(item) for item in (run.missing_fields or []) if str(item).strip()][:8]
        if any(str(item).startswith("_confirm_") for item in missing):
            tags.append("checkpoint_wait")
            _bump_signal(
                run=run,
                signal_type=SopEvolutionSignal.SignalType.NEED_INPUT_LOOP,
                node_key=node_key,
                summary={"kind": "checkpoint", "missing": missing},
            )
        else:
            _bump_signal(
                run=run,
                signal_type=SopEvolutionSignal.SignalType.NEED_INPUT_LOOP,
                node_key=node_key,
                summary={"kind": "collect", "missing": missing},
            )
            if missing:
                _bump_signal(
                    run=run,
                    signal_type=SopEvolutionSignal.SignalType.MISSING_FIELD_REPEAT,
                    node_key=node_key,
                    summary={"missing": missing},
                )

    if run.status == SopRun.Status.HANDOFF:
        tags.append("handoff")
        _bump_signal(
            run=run,
            signal_type=SopEvolutionSignal.SignalType.HANDOFF,
            node_key=(run.current_node or "").strip(),
            summary={"error": (run.error or "")[:240]},
        )

    if run.status == SopRun.Status.FAILED:
        tags.append("failed")
        failed_nodes = list(
            run.node_runs.filter(status=SopNodeRun.Status.FAILED).order_by("sequence")[:8]
        )
        if failed_nodes:
            for node in failed_nodes:
                _bump_signal(
                    run=run,
                    signal_type=SopEvolutionSignal.SignalType.ACTION_FAIL,
                    node_key=node.node_key,
                    summary={
                        "node_type": node.node_type,
                        "title": node.title,
                        "error": (node.error or run.error or "")[:240],
                    },
                )
        else:
            _bump_signal(
                run=run,
                signal_type=SopEvolutionSignal.SignalType.ACTION_FAIL,
                node_key=(run.current_node or "").strip(),
                summary={"error": (run.error or "")[:240]},
            )

    decision = str((run.state_data or {}).get("decision") or "").strip().lower()
    if decision in {"reject", "cancel", "block"} or "reject" in decision:
        tags.append("checkpoint_reject")
        _bump_signal(
            run=run,
            signal_type=SopEvolutionSignal.SignalType.CHECKPOINT_REJECT,
            node_key=(run.current_node or "").strip(),
            summary={"decision": decision},
        )

    slow_cutoff = timedelta(seconds=_SLOW_NODE_SECONDS)
    for node in run.node_runs.exclude(finished_at=None).exclude(started_at=None)[:40]:
        duration = node.finished_at - node.started_at
        if duration >= slow_cutoff:
            tags.append("slow_node")
            _bump_signal(
                run=run,
                signal_type=SopEvolutionSignal.SignalType.SLOW_NODE,
                node_key=node.node_key,
                summary={
                    "seconds": int(duration.total_seconds()),
                    "node_type": node.node_type,
                    "title": node.title,
                },
            )

    # Deduplicate tags while preserving order
    seen: set[str] = set()
    ordered: list[str] = []
    for tag in tags:
        if tag not in seen:
            seen.add(tag)
            ordered.append(tag)
    return ordered
