from __future__ import annotations

import uuid
from functools import lru_cache
from typing import Any, TypedDict

from django.db.models import Q

from langgraph.graph import END, START, StateGraph

from apps.core.models import WorkTask
from apps.datalake.certified_metrics import METRIC_IDS, resolve_metric
from apps.datalake.models import SourceSnapshot
from apps.harness.gate import evaluate
from apps.loops.simulation import ensure_inventory_pilot_loop, run_inventory_simulation, simulation_payload
from apps.ontology.models import OntObject, OntologyStatus


class RuntimeState(TypedDict, total=False):
    text: str
    payload: dict
    role: str
    trace_id: str
    user: Any
    organization: Any
    action: str
    intent: str
    steps: list[dict]
    snapshot: Any
    metric_results: list[Any]
    ontology_object_ids: list[int]
    loop: Any
    simulation: Any
    decision: str
    error: str
    legacy_result: dict


def _step(state: RuntimeState, node: str, status: str, detail: str, data: dict | None = None) -> RuntimeState:
    return {"steps": [*(state.get("steps") or []), {"node": node, "status": status, "detail": detail, "data": data or {}}]}


def _parse(state: RuntimeState) -> RuntimeState:
    from .graph import recognize_intent

    if state.get("action"):
        action = state["action"]
        intent = f"SOP 版本绑定动作：{action}"
    else:
        intent, action = recognize_intent(state["text"], user=state.get("user"))
    update = {"intent": intent, "action": action}
    update.update(_step(state, "解析请求", "done" if action else "block", intent, {"action": action}))
    return update


def _scope(state: RuntimeState) -> RuntimeState:
    if not state.get("organization") or not state.get("user"):
        update = {"decision": "block", "error": "缺少可信企业或用户身份"}
        update.update(_step(state, "确定企业和数据范围", "block", update["error"]))
        return update
    update = _step(
        state, "确定企业和数据范围", "done", "企业身份由平台登录会话解析",
        {"organization_id": state["organization"].id, "user_id": state["user"].id},
    )
    return update


def _snapshot(state: RuntimeState) -> RuntimeState:
    if state.get("decision") == "block":
        return {}
    if str(state.get("action") or "").startswith("skill:"):
        from .skill_actions import run_skill_sop_action

        return {"legacy_result": run_skill_sop_action(
            action_name=str(state.get("action") or ""),
            text=state["text"],
            organization=state["organization"],
            user=state["user"],
            trace_id=state["trace_id"],
            initial_steps=state.get("steps") or [],
            payload=state.get("payload") or {},
        )}
    if state.get("action") == "report.generate":
        from .business_analysis import run_business_analysis

        return {"legacy_result": run_business_analysis(
            text=state["text"],
            organization=state["organization"],
            user=state["user"],
            trace_id=state["trace_id"],
            initial_steps=state.get("steps") or [],
            payload=state.get("payload") or {},
        )}
    if state.get("action") == "notify.push":
        from .notify_push import run_notify_push

        return {"legacy_result": run_notify_push(
            text=state["text"],
            organization=state["organization"],
            user=state["user"],
            trace_id=state["trace_id"],
            initial_steps=state.get("steps") or [],
            payload=state.get("payload") or {},
        )}
    if state.get("action") != "inventory.reorder.shadow":
        from .graph import run_sop_legacy

        return {"legacy_result": run_sop_legacy(
            state["text"], state.get("payload") or {}, state["role"], state["trace_id"]
        )}
    try:
        snapshot = SourceSnapshot.objects.get(
            id=(state.get("payload") or {}).get("snapshot_id"),
            organization=state["organization"],
        )
    except SourceSnapshot.DoesNotExist:
        update = {"decision": "block", "error": "当前企业的 Snapshot 不存在"}
        update.update(_step(state, "获取不可变 Snapshot", "block", update["error"]))
        return update
    update = {"snapshot": snapshot}
    update.update(_step(state, "获取不可变 Snapshot", "done", "已绑定不可变 Snapshot", {
        "snapshot_id": snapshot.id, "hash": snapshot.content_hash, "as_of": snapshot.as_of.isoformat()
    }))
    return update


def _metrics(state: RuntimeState) -> RuntimeState:
    if state.get("legacy_result") or state.get("decision") == "block":
        return {}
    try:
        results = [resolve_metric(
            organization=state["organization"], user=state["user"], snapshot=state["snapshot"],
            metric_id=metric_id, version="v1", dimensions=state["snapshot"].scope,
        ) for metric_id in METRIC_IDS]
    except (ValueError, PermissionError) as exc:
        update = {"decision": "block", "error": str(exc)}
        update.update(_step(state, "计算认证指标", "block", str(exc)))
        return update
    update = {"metric_results": results}
    update.update(_step(state, "计算认证指标", "done", "四个认证指标计算完成", {
        result.contract.metric_id: {"value": str(result.value), "unit": result.unit} for result in results
    }))
    return update


def _ontology(state: RuntimeState) -> RuntimeState:
    if state.get("legacy_result") or state.get("decision") == "block":
        return {}
    scope = state["snapshot"].scope or {}
    object_keys = scope.get("ontology_object_keys") or []
    sku_ids = scope.get("sku_ids") or scope.get("skus") or []
    qs = OntObject.objects.filter(
        organization=state["organization"], status=OntologyStatus.CONFIRMED, otype__in=["SKU", "商品", "sku"]
    )
    if object_keys or sku_ids:
        qs = qs.filter(Q(object_key__in=object_keys) | Q(name__in=sku_ids))
    objects = list(qs[:20])
    if not objects:
        update = {"decision": "block", "error": "Snapshot 范围未匹配到已确认的 SKU Ontology 对象"}
        update.update(_step(state, "解析 Ontology 对象", "block", update["error"]))
        return update
    update = {"ontology_object_ids": [obj.id for obj in objects]}
    update.update(_step(state, "解析 Ontology 对象", "done", f"匹配 {len(objects)} 个已确认 SKU", {
        "object_ids": [obj.id for obj in objects]
    }))
    return update


def _loop(state: RuntimeState) -> RuntimeState:
    if state.get("legacy_result") or state.get("decision") == "block":
        return {}
    loop = ensure_inventory_pilot_loop(state["organization"], state["user"])
    update = {"loop": loop}
    update.update(_step(state, "加载 Loop 版本", "done", "已加载库存补货调节回路", {
        "loop_id": loop.id, "loop_key": loop.loop_key, "version": loop.current_version_number,
    }))
    return update


def _gate(state: RuntimeState) -> RuntimeState:
    if state.get("legacy_result") or state.get("decision") == "block":
        return {}
    outcome = evaluate(state["action"], state.get("payload") or {}, state["role"])
    if outcome.decision != "allow":
        update = {"decision": "block", "error": "Harness 门禁拒绝只读情景分析"}
        update.update(_step(state, "Harness 门禁", "block", update["error"], outcome.as_dict()))
        return update
    update = {"decision": "allow"}
    update.update(_step(state, "Harness 门禁", "allow", "只读分析门禁通过，外部写保持关闭", outcome.as_dict()))
    return update


def _simulation(state: RuntimeState) -> RuntimeState:
    if state.get("legacy_result") or state.get("decision") != "allow":
        return {}
    try:
        run = run_inventory_simulation(
            organization=state["organization"], user=state["user"], loop=state["loop"],
            metric_result_ids=[row.id for row in state["metric_results"]],
            parameters=(state.get("payload") or {}).get("parameters") or {},
            idempotency_key=state["trace_id"],
        )
    except (ValueError, PermissionError) as exc:
        update = {"decision": "block", "error": str(exc)}
        update.update(_step(state, "运行只读 Simulation", "block", str(exc)))
        return update
    update = {"simulation": run, "decision": "allow"}
    update.update(_step(state, "运行只读 Simulation", "done", "三个只读情景已生成，未执行外部写", {
        "simulation_run_id": run.id, "result_hash": run.result_hash,
    }))
    return update


def _report(state: RuntimeState) -> RuntimeState:
    if state.get("legacy_result"):
        return {}
    status = "done" if state.get("simulation") else "block"
    return _step(state, "生成报告和证据", status, "分析链路已写入可追溯结果" if status == "done" else state.get("error", "分析被阻断"))


@lru_cache(maxsize=1)
def _compiled_graph():
    builder = StateGraph(RuntimeState)
    builder.add_node("parse", _parse)
    builder.add_node("scope", _scope)
    builder.add_node("snapshot", _snapshot)
    builder.add_node("metrics", _metrics)
    builder.add_node("ontology", _ontology)
    builder.add_node("loop", _loop)
    builder.add_node("gate", _gate)
    builder.add_node("simulation", _simulation)
    builder.add_node("report", _report)
    builder.add_edge(START, "parse")
    builder.add_edge("parse", "scope")
    builder.add_edge("scope", "snapshot")
    builder.add_edge("snapshot", "metrics")
    builder.add_edge("metrics", "ontology")
    builder.add_edge("ontology", "loop")
    builder.add_edge("loop", "gate")
    builder.add_edge("gate", "simulation")
    builder.add_edge("simulation", "report")
    builder.add_edge("report", END)
    return builder.compile()


def _writeback_task(state: RuntimeState, result: dict) -> None:
    user = state.get("user")
    if not user:
        return
    task = WorkTask.objects.filter(sender=user, trace_id=state["trace_id"]).first()
    if not task:
        return
    task.timeline = [*(task.timeline or []), *(result.get("steps") or [])]
    task.progress = 100
    task.status = WorkTask.Status.COMPLETED if result.get("decision") == "allow" else WorkTask.Status.FAILED
    task.save(update_fields=["timeline", "progress", "status", "updated_at"])


def run_fixed_pipeline(*, text: str, payload: dict, role: str, trace_id: str, user, organization, forced_action: str = "") -> dict:
    state: RuntimeState = {
        "text": text,
        "payload": payload,
        "role": role,
        "trace_id": trace_id,
        "user": user,
        "organization": organization,
        "steps": [],
        "action": forced_action,
    }
    final = _compiled_graph().invoke(state)
    if final.get("legacy_result"):
        return final["legacy_result"]
    result = {
        "trace_id": final["trace_id"],
        "decision": "allow" if final.get("simulation") else "block",
        "action": final.get("action") or "",
        "result": simulation_payload(final["simulation"]) if final.get("simulation") else {},
        "error": final.get("error") or None,
        "steps": final.get("steps") or [],
        "principal": {
            "organization_id": organization.id if organization else None,
            "user_id": user.id if user else None,
            "role": role,
        },
    }
    _writeback_task(final, result)
    return result


def run_in_process_graph(*, text: str, payload: dict, role: str, trace_id: str | None, user, organization) -> dict:
    resolved_trace_id = (trace_id or uuid.uuid4().hex[:12]).strip()[:64]
    from .sop_runtime import execute_matching_sop

    sop_result = execute_matching_sop(
        text=text, payload=payload, role=role, trace_id=resolved_trace_id, user=user, organization=organization,
    )
    if sop_result is not None:
        return sop_result
    return run_fixed_pipeline(
        text=text, payload=payload, role=role, trace_id=resolved_trace_id, user=user, organization=organization,
    )
