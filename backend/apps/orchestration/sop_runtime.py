from __future__ import annotations

from functools import lru_cache
from typing import Any, TypedDict

from django.db.models import F, Max, Q
from django.utils import timezone
from langgraph.graph import END, START, StateGraph

from apps.core.models import WorkTask
from apps.harness.gate import evaluate

from .models import SopDefinition, SopNodeRun, SopRun, SopVersion
from .sop_schema import validate_graph


class SopState(TypedDict, total=False):
    text: str
    payload: dict
    role: str
    trace_id: str
    user: Any
    organization: Any
    run: SopRun
    sequence: int
    steps: list[dict]
    decision: str
    action: str
    result: dict
    error: str
    missing: list[str]


def _published_version(definition: SopDefinition) -> SopVersion | None:
    if not definition.current_version:
        return None
    return definition.versions.filter(version=definition.current_version, status=SopVersion.Status.PUBLISHED).first()


def match_sop(*, text: str, payload: dict, organization, user) -> SopVersion | None:
    explicit = str(payload.get("_sop_key") or payload.get("sop_key") or "").strip()
    allowed_sop_keys = payload.get("_allowed_sop_keys")
    qs = SopDefinition.objects.filter(
        Q(organization=organization) | Q(organization__isnull=True), status=SopDefinition.Status.PUBLISHED
    )
    if isinstance(allowed_sop_keys, list):
        allowed = [str(key).strip() for key in allowed_sop_keys if str(key).strip()]
        qs = qs.filter(sop_key__in=allowed)
    definition = None
    if explicit:
        definition = qs.filter(sop_key=explicit).order_by("organization_id").last()
    else:
        from .graph import recognize_intent

        _, action_name = recognize_intent(text, user=user)
        if action_name:
            definition = qs.filter(action_name=action_name).order_by("organization_id").last()
    return _published_version(definition) if definition else None


def _serializable_state(state: SopState) -> dict:
    return {
        "decision": state.get("decision", ""),
        "action": state.get("action", ""),
        "missing": state.get("missing") or [],
        "error": state.get("error", ""),
        "result": state.get("result") or {},
    }


def _record_node(state: SopState, node: dict, status: str, detail: str, output: dict | None = None) -> dict:
    sequence = int(state.get("sequence") or 0) + 1
    SopNodeRun.objects.create(
        run=state["run"], sequence=sequence, node_key=node["key"], node_type=node["type"],
        title=node["title"], status=status, input_data={"payload": state.get("payload") or {}},
        output_data=output or {}, finished_at=timezone.now(), error=detail if status == SopNodeRun.Status.FAILED else "",
    )
    state["run"].current_node = node["key"]
    state["run"].save(update_fields=["current_node"])
    return {
        "sequence": sequence,
        "steps": [*(state.get("steps") or []), {"node": node["title"], "status": status, "detail": detail, "data": output or {}}],
    }


def _node_handler(node: dict):
    def handler(state: SopState) -> dict:
        config = node.get("config") or {}
        node_type = node["type"]
        if node_type == "collect_info":
            required = [str(item) for item in config.get("required_fields") or []]
            missing = [key for key in required if (state.get("payload") or {}).get(key) in (None, "", [])]
            if missing:
                update = {"decision": "need_input", "missing": missing}
                update.update(_record_node(state, node, SopNodeRun.Status.NEED_INPUT, f"还需要补充：{'、'.join(missing)}", {"missing": missing}))
                return update
            return _record_node(state, node, SopNodeRun.Status.COMPLETED, "任务所需信息已齐全")
        if node_type == "gate":
            action_name = str(config.get("action_name") or state.get("action") or "")
            outcome = evaluate(action_name, state.get("payload") or {}, state.get("role") or "operator")
            decision = outcome.decision if outcome.decision == "allow" else "block"
            update = {"decision": decision, "action": action_name}
            update.update(_record_node(
                state, node, SopNodeRun.Status.COMPLETED if decision == "allow" else SopNodeRun.Status.FAILED,
                "安全闸机通过" if decision == "allow" else "安全闸机阻断执行", outcome.as_dict(),
            ))
            return update
        if node_type == "execute_action":
            action_name = str(config.get("action_name") or state.get("action") or "")
            from .runtime_graph import run_fixed_pipeline

            result = run_fixed_pipeline(
                text=state["text"], payload=state.get("payload") or {}, role=state.get("role") or "operator",
                trace_id=state["trace_id"], user=state["user"], organization=state["organization"],
                forced_action=action_name,
            )
            decision = str(result.get("decision") or "block")
            update = {
                "action": result.get("action") or action_name,
                "decision": decision,
                "result": result.get("result") or {},
                "error": result.get("error") or "",
            }
            update.update(_record_node(
                state, node, SopNodeRun.Status.COMPLETED if decision == "allow" else SopNodeRun.Status.FAILED,
                "业务动作执行完成" if decision == "allow" else (result.get("error") or "业务动作执行失败"),
                {"action": action_name, "decision": decision},
            ))
            update["steps"] = [*(state.get("steps") or []), *(result.get("steps") or []), *update["steps"][-1:]]
            return update
        if node_type == "handoff":
            update = {"decision": "handoff", "error": str(config.get("message") or "需要人工接管")}
            update.update(_record_node(state, node, SopNodeRun.Status.NEED_INPUT, update["error"]))
            return update
        return _record_node(state, node, SopNodeRun.Status.COMPLETED, str(config.get("detail") or "流程节点完成"))

    return handler


def _condition_matches(condition: str, state: SopState) -> bool:
    if condition == "always":
        return True
    if condition == "result_ok":
        return bool((state.get("result") or {}).get("ok"))
    if condition == "result_failed":
        return not bool((state.get("result") or {}).get("ok"))
    if condition.startswith("decision:"):
        return state.get("decision") == condition.split(":", 1)[1]
    if condition.startswith("field_present:"):
        return (state.get("payload") or {}).get(condition.split(":", 1)[1]) not in (None, "", [])
    if condition.startswith("field_missing:"):
        return (state.get("payload") or {}).get(condition.split(":", 1)[1]) in (None, "", [])
    return False


@lru_cache(maxsize=128)
def _compile(version_id: int, content_hash: str):
    version = SopVersion.objects.get(id=version_id)
    graph = validate_graph(version.graph)
    builder = StateGraph(SopState)
    nodes = {node["key"]: node for node in graph["nodes"]}
    edges_by_source: dict[str, list[dict]] = {}
    for edge in graph["edges"]:
        edges_by_source.setdefault(edge["source"], []).append(edge)
    for source_edges in edges_by_source.values():
        source_edges.sort(key=lambda item: item.get("priority", 0))
    for key, node in nodes.items():
        builder.add_node(key, _node_handler(node))
    builder.add_edge(START, graph["start"])
    terminals = set(graph["terminals"])
    for key in nodes:
        if key in terminals:
            builder.add_edge(key, END)
            continue
        outgoing = edges_by_source.get(key) or []

        def route(state: SopState, choices=outgoing):
            if state.get("decision") in {"need_input", "handoff"}:
                return "__end__"
            for edge in choices:
                if _condition_matches(edge["condition"], state):
                    return edge["target"]
            return "__end__"

        mapping = {edge["target"]: edge["target"] for edge in outgoing}
        mapping["__end__"] = END
        builder.add_conditional_edges(key, route, mapping)
    return builder.compile()


def execute_matching_sop(*, text: str, payload: dict, role: str, trace_id: str, user, organization) -> dict | None:
    version = match_sop(text=text, payload=payload, organization=organization, user=user)
    if not version:
        return None
    existing = SopRun.objects.filter(trace_id=trace_id).first()
    if existing and existing.status == SopRun.Status.COMPLETED:
        return existing.output_data
    work_task = WorkTask.objects.filter(sender=user, trace_id=trace_id).first()
    run = existing or SopRun.objects.create(
        trace_id=trace_id, version=version, organization=organization, user=user, work_task=work_task,
        input_data={"text": text, "payload": payload},
    )
    last_sequence = run.node_runs.aggregate(value=Max("sequence"))["value"] or 0
    state: SopState = {
        "text": text, "payload": payload, "role": role, "trace_id": trace_id, "user": user,
        "organization": organization, "run": run, "sequence": last_sequence, "steps": [], "action": version.definition.action_name,
    }
    final = _compile(version.id, version.content_hash).invoke(state)
    decision = final.get("decision") or "block"
    if decision == "allow":
        run_status = SopRun.Status.COMPLETED
    elif decision == "need_input":
        run_status = SopRun.Status.NEED_INPUT
    elif decision == "handoff":
        run_status = SopRun.Status.HANDOFF
    else:
        run_status = SopRun.Status.FAILED
    result = {
        "trace_id": trace_id,
        "decision": decision,
        "action": final.get("action") or version.definition.action_name,
        "result": final.get("result") or {},
        "error": final.get("error") or None,
        "missing": final.get("missing") or [],
        "steps": final.get("steps") or [],
        "sop": {"key": version.definition.sop_key, "version": version.version, "run_id": str(run.run_key)},
        "principal": {"organization_id": organization.id, "user_id": user.id, "role": role},
    }
    run.status = run_status
    run.state_data = _serializable_state(final)
    run.output_data = result
    run.missing_fields = final.get("missing") or []
    run.error = final.get("error") or ""
    run.finished_at = timezone.now() if run_status in {SopRun.Status.COMPLETED, SopRun.Status.FAILED} else None
    run.save()
    SopDefinition.objects.filter(id=version.definition_id).update(
        call_count=F("call_count") + 1,
        success_count=F("success_count") + (1 if run_status == SopRun.Status.COMPLETED else 0),
        failure_count=F("failure_count") + (1 if run_status == SopRun.Status.FAILED else 0),
    )
    return result
