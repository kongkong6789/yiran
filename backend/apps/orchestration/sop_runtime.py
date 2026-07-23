from __future__ import annotations

import contextvars
from functools import lru_cache
from typing import Any, TypedDict

from django.db.models import F, Max, Q
from django.utils import timezone
from langgraph.graph import END, START, StateGraph

from apps.core.models import WorkTask
from apps.harness.gate import evaluate

from .models import SopDefinition, SopNodeRun, SopRun, SopVersion
from .evolution_signals import record_run_signals
from .sop_bindings import (
    action_allowed,
    merge_payload_with_bindings,
    resolve_data_bindings,
    resolve_knowledge_scope,
)
from .sop_schema import normalize_node_config, project_node_context, validate_graph

_sop_progress_cb: contextvars.ContextVar[Any] = contextvars.ContextVar("sop_progress_cb", default=None)


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
    agent_kb_ids: list[int]
    bound_contexts: list[str]
    graph: dict


def _published_version(definition: SopDefinition) -> SopVersion | None:
    if not definition.current_version:
        return None
    return definition.versions.filter(version=definition.current_version, status=SopVersion.Status.PUBLISHED).first()


def match_sop(*, text: str, payload: dict, organization, user) -> SopVersion | None:
    explicit = str(payload.get("_sop_key") or payload.get("sop_key") or "").strip()
    qs = SopDefinition.objects.filter(
        Q(organization=organization) | Q(organization__isnull=True), status=SopDefinition.Status.PUBLISHED
    )
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
        "bound_contexts": state.get("bound_contexts") or [],
    }


def _graph_node_index(graph: dict | None, node_key: str) -> int:
    nodes = (graph or {}).get("nodes") or []
    for index, item in enumerate(nodes):
        if isinstance(item, dict) and str(item.get("key") or "") == str(node_key or ""):
            return index + 1
    return 0


def _record_node(state: SopState, node: dict, status: str, detail: str, output: dict | None = None) -> dict:
    sequence = int(state.get("sequence") or 0) + 1
    projection = project_node_context(state.get("graph") or {}, node["key"]) if state.get("graph") else {}
    graph_index = _graph_node_index(state.get("graph"), node["key"]) or sequence
    SopNodeRun.objects.create(
        run=state["run"], sequence=sequence, node_key=node["key"], node_type=node["type"],
        title=node["title"], status=status,
        input_data={"payload": state.get("payload") or {}, "projection": projection},
        output_data=output or {}, finished_at=timezone.now(),
        error=detail if status == SopNodeRun.Status.FAILED else "",
    )
    state["run"].current_node = node["key"]
    state["run"].save(update_fields=["current_node"])
    return {
        "sequence": sequence,
        "steps": [*(state.get("steps") or []), {
            "node": node["title"],
            "node_key": node["key"],
            "node_type": node["type"],
            "graph_index": graph_index,
            "status": status,
            "detail": detail,
            "data": output or {},
            "projection": projection.get("current_step") if projection else None,
        }],
    }


def _confirmed_checkpoint(payload: dict, node_key: str) -> bool:
    if payload.get("_checkpoint_confirm") in (True, "true", "1", 1, "yes"):
        return True
    confirmed = payload.get("_confirmed_nodes") or []
    if isinstance(confirmed, list) and node_key in {str(item) for item in confirmed}:
        return True
    return bool(payload.get(f"_confirm_{node_key}"))


def _emit_node_progress(state: SopState, node: dict, *, status: str = "running", detail: str = "") -> None:
    """Push step progress as soon as a node starts (before slow ontology/LLM work)."""
    emit = _sop_progress_cb.get()
    if not callable(emit):
        return
    graph = state.get("graph") or {}
    total = max(len(graph.get("nodes") or []), 1)
    index = _graph_node_index(graph, node.get("key") or "") or min(int(state.get("sequence") or 0) + 1, total)
    title = str(node.get("title") or node.get("key") or f"步骤 {index}")
    try:
        emit({
            "kind": "step",
            "title": title,
            "detail": detail or f"正在执行：{title}",
            "status": status,
            "index": index,
            "total": total,
            "node_key": str(node.get("key") or ""),
            "node_type": str(node.get("type") or ""),
        })
    except Exception:
        pass


def _parse_retry_policy(config: dict) -> tuple[int, str]:
    retry = config.get("retry") if isinstance(config.get("retry"), dict) else {}
    max_attempts = max(1, min(int(retry.get("max_attempts") or 1), 5))
    on_failure = str(retry.get("on_failure") or "fail").strip().lower()
    return max_attempts, on_failure


def _node_handler(node: dict):
    def handler(state: SopState) -> dict:
        config = normalize_node_config(node["type"], node.get("config") or {})
        node_type = node["type"]
        instruction = config.get("instruction") or ""
        _emit_node_progress(state, node)

        if node_type == "collect_info":
            required = [str(item) for item in config.get("expected_user_info") or []]
            missing = [key for key in required if (state.get("payload") or {}).get(key) in (None, "", [])]
            if missing:
                update = {"decision": "need_input", "missing": missing}
                update.update(_record_node(
                    state, node, SopNodeRun.Status.NEED_INPUT,
                    instruction or f"还需要补充：{'、'.join(missing)}",
                    {"missing": missing, "instruction": instruction},
                ))
                return update
            trial_mode = bool((state.get("payload") or {}).get("_sop_trial"))
            filled = []
            if trial_mode and required:
                for key in required:
                    value = (state.get("payload") or {}).get(key)
                    if value not in (None, "", []):
                        filled.append(f"{key}={value}")
            detail = instruction or "任务所需信息已齐全"
            if trial_mode and filled:
                detail = f"试跑已用演示参数自动填入（{'、'.join(filled[:4])}），正式运行时会向用户采集"
            return _record_node(state, node, SopNodeRun.Status.COMPLETED, detail)

        if node_type == "checkpoint":
            if not _confirmed_checkpoint(state.get("payload") or {}, node["key"]):
                update = {"decision": "need_input", "missing": [f"_confirm_{node['key']}"]}
                update.update(_record_node(
                    state, node, SopNodeRun.Status.NEED_INPUT,
                    instruction or "等待人工确认后继续",
                    {"checkpoint": node["key"], "instruction": instruction},
                ))
                return update
            # AI graphs often wire confirm → next with condition decision:confirmed
            update = {"decision": "confirmed"}
            update.update(_record_node(
                state, node, SopNodeRun.Status.COMPLETED, instruction or "人工确认已完成",
                {"checkpoint": node["key"], "confirmed": True},
            ))
            return update

        if node_type == "data_bind":
            resolved = resolve_data_bindings(
                organization=state["organization"],
                bindings=config.get("data_bindings"),
                payload=state.get("payload") or {},
                text=state.get("text") or "",
                allow_fallback=True,
            )
            if config.get("data_bindings", {}).get("snapshot_ids") or config.get("data_bindings", {}).get("asset_keys"):
                if not resolved.get("snapshots"):
                    update = {
                        "decision": "block",
                        "error": "；".join(resolved.get("errors") or ["企业数据绑定失败"]),
                    }
                    update.update(_record_node(
                        state, node, SopNodeRun.Status.FAILED, update["error"], resolved,
                    ))
                    return update
            merged = merge_payload_with_bindings(state.get("payload") or {}, resolved)
            contexts = [*(state.get("bound_contexts") or [])]
            if resolved.get("context_text"):
                contexts.append(resolved["context_text"])
            update = {"payload": merged, "bound_contexts": contexts, "decision": state.get("decision") or ""}
            trial_mode = bool((state.get("payload") or {}).get("_sop_trial"))
            bind_detail = instruction or f"已绑定 {len(resolved.get('snapshots') or [])} 个企业数据版本"
            if trial_mode and not (resolved.get("snapshots") or []):
                bind_detail = "试跑已放宽数据绑定（未命中快照时继续），正式运行需绑定真实企业数据"
            elif trial_mode:
                bind_detail = f"已绑定 {len(resolved.get('snapshots') or [])} 个可信数据版本（试跑真实读取）"
            update.update(_record_node(
                state, node, SopNodeRun.Status.COMPLETED,
                bind_detail,
                resolved,
            ))
            return update

        if node_type == "knowledge_query":
            if not action_allowed(config.get("allowed_actions"), need_knowledge=True):
                update = {"decision": "block", "error": "当前节点未允许 query_knowledge"}
                update.update(_record_node(state, node, SopNodeRun.Status.FAILED, update["error"]))
                return update
            resolved = resolve_knowledge_scope(
                user=state["user"],
                scope=config.get("knowledge_scope"),
                agent_kb_ids=state.get("agent_kb_ids") or [],
                query=instruction or state.get("text") or "",
            )
            contexts = [*(state.get("bound_contexts") or [])]
            if resolved.get("context_text"):
                contexts.append(resolved["context_text"])
            payload = dict(state.get("payload") or {})
            payload["_knowledge_excerpts"] = resolved.get("excerpts") or []
            payload["_knowledge_base_ids"] = resolved.get("knowledge_base_ids") or []
            update = {"payload": payload, "bound_contexts": contexts}
            update.update(_record_node(
                state, node, SopNodeRun.Status.COMPLETED,
                instruction or f"已检索 {len(resolved.get('knowledge_bases') or [])} 个知识库",
                resolved,
            ))
            return update

        if node_type == "gate":
            action_name = str(config.get("action_name") or state.get("action") or "")
            if not action_allowed(config.get("allowed_actions"), action_name=action_name):
                update = {"decision": "block", "error": f"当前节点未允许动作 {action_name}"}
                update.update(_record_node(state, node, SopNodeRun.Status.FAILED, update["error"]))
                return update
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
            from apps.ontology.registry import get_action
            from .skill_actions import is_skill_action, run_skill_sop_action

            if action_name and not get_action(action_name) and not is_skill_action(action_name):
                # AI 常会发明不存在的动作名；回退到已注册动作，避免产物空洞。
                fallback = str(state.get("action") or "")
                if fallback and get_action(fallback):
                    action_name = fallback
                elif get_action("report.generate"):
                    action_name = "report.generate"
            if not action_allowed(config.get("allowed_actions"), action_name=action_name):
                # 试跑时放宽 call_action 校验，避免因 AI 生成的 allowed_actions 不完整而失败
                if not (state.get("payload") or {}).get("_sop_trial"):
                    update = {"decision": "block", "error": f"当前节点未允许动作 {action_name}"}
                    update.update(_record_node(state, node, SopNodeRun.Status.FAILED, update["error"]))
                    return update

            trial_mode = bool((state.get("payload") or {}).get("_sop_trial"))
            node_data = resolve_data_bindings(
                organization=state["organization"],
                bindings=config.get("data_bindings"),
                payload=state.get("payload") or {},
                text=state.get("text") or "",
                allow_fallback=trial_mode,
            )
            payload = merge_payload_with_bindings(state.get("payload") or {}, node_data)
            if action_name == "notify.push":
                destination = str(
                    config.get("destination")
                    or payload.get("destination")
                    or "platform"
                ).strip()
                content = str(
                    config.get("push_content")
                    or config.get("content")
                    or payload.get("content")
                    or instruction
                    or state.get("text")
                    or ""
                ).strip()
                payload = {
                    **payload,
                    "destination": destination,
                    "content": content,
                    "current_state": payload.get("current_state") or "confirmed",
                }
            contexts = [*(state.get("bound_contexts") or [])]
            if node_data.get("context_text") and node_data.get("snapshots"):
                contexts.append(node_data["context_text"])
            if contexts and "_sop_context" not in payload:
                payload = {**payload, "_sop_context": "\n\n".join(contexts)}
            # Prefer the node instruction as the real task brief (charts, structure, tone),
            # while keeping the chat/trial utterance as a secondary user request.
            task_text = str(state.get("text") or "").strip()
            if instruction:
                if not task_text or task_text in {"跑一遍流程", "试跑当前流程", "试跑", "运行流程"}:
                    task_text = instruction
                elif instruction not in task_text:
                    task_text = f"{instruction}\n\n用户请求：{task_text}"
            payload = {
                **payload,
                "_node_instruction": instruction,
                "_node_title": str(node.get("title") or ""),
            }
            output_format = str(config.get("output_format") or payload.get("output_format") or "").strip()
            if output_format:
                payload["output_format"] = output_format

            max_attempts, on_failure = _parse_retry_policy(config)
            result: dict = {}
            decision = "block"
            retry_notes: list[str] = []
            for attempt in range(1, max_attempts + 1):
                if is_skill_action(action_name):
                    result = run_skill_sop_action(
                        action_name=action_name,
                        text=task_text or state["text"],
                        payload=payload,
                        user=state["user"],
                        organization=state["organization"],
                        trace_id=state["trace_id"],
                        initial_steps=list(state.get("steps") or []),
                    )
                else:
                    from .runtime_graph import run_fixed_pipeline

                    result = run_fixed_pipeline(
                        text=task_text or state["text"], payload=payload, role=state.get("role") or "operator",
                        trace_id=state["trace_id"], user=state["user"], organization=state["organization"],
                        forced_action=action_name,
                    )
                decision = str(result.get("decision") or "block")
                if decision == "allow":
                    break
                if attempt < max_attempts:
                    retry_notes.append(
                        f"第 {attempt} 次执行失败，准备重试（{result.get('error') or '未知原因'}）"[:240]
                    )

            if decision != "allow" and on_failure == "checkpoint" and max_attempts > 1:
                update = {
                    "payload": payload,
                    "bound_contexts": contexts,
                    "decision": "need_input",
                    "missing": [f"_confirm_{node['key']}"],
                    "error": str(result.get("error") or "动作多次失败后等待人工确认"),
                }
                detail = instruction or (
                    f"动作已重试 {max_attempts} 次仍失败，请确认是否继续：{update['error']}"
                )
                update.update(_record_node(
                    state, node, SopNodeRun.Status.NEED_INPUT,
                    detail,
                    {
                        "action": action_name,
                        "decision": "need_input",
                        "retries": max_attempts,
                        "retry_notes": retry_notes,
                    },
                ))
                return update

            update = {
                "payload": payload,
                "bound_contexts": contexts,
                "action": result.get("action") or action_name,
                "decision": decision,
                "result": result.get("result") or {},
                "error": result.get("error") or "",
            }
            detail = instruction or (
                "业务动作执行完成"
                if decision == "allow"
                else (result.get("error") or "业务动作执行失败")
            )
            if retry_notes and decision == "allow":
                detail = f"{detail}（第 {len(retry_notes) + 1} 次尝试成功）"
            update.update(_record_node(
                state, node, SopNodeRun.Status.COMPLETED if decision == "allow" else SopNodeRun.Status.FAILED,
                detail,
                {
                    "action": action_name,
                    "decision": decision,
                    "data_bindings": node_data.get("bindings"),
                    "user_message": (result.get("result") or {}).get("user_message"),
                    "has_report": bool((result.get("result") or {}).get("report_markdown")),
                    "retries": len(retry_notes),
                    "retry_notes": retry_notes,
                },
            ))
            parent_index = _graph_node_index(state.get("graph"), node["key"]) or 1
            nested = []
            for step in (result.get("steps") or []):
                if not isinstance(step, dict):
                    continue
                nested.append({
                    **step,
                    "graph_index": parent_index,
                    "node_key": node["key"],
                    "node_type": node["type"],
                    "parent_node": node.get("title") or node["key"],
                })
            # Keep canvas progress on the execute node while nested AI substeps stream.
            update["steps"] = [*(state.get("steps") or []), *nested, *update["steps"][-1:]]
            return update

        if node_type == "handoff":
            update = {"decision": "handoff", "error": instruction or str(config.get("message") or "需要人工接管")}
            update.update(_record_node(state, node, SopNodeRun.Status.NEED_INPUT, update["error"]))
            return update

        return _record_node(
            state, node, SopNodeRun.Status.COMPLETED,
            instruction or str(config.get("detail") or "流程节点完成"),
        )

    return handler


def _condition_matches(condition: str, state: SopState) -> bool:
    if condition == "always":
        return True
    if condition == "result_ok":
        result = state.get("result") if isinstance(state.get("result"), dict) else {}
        if "ok" in result:
            return bool(result.get("ok"))
        # No execute result yet (e.g. after collect/checkpoint) — not a failure path.
        return state.get("decision") == "allow"
    if condition == "result_failed":
        result = state.get("result") if isinstance(state.get("result"), dict) else {}
        if "ok" in result:
            return not bool(result.get("ok"))
        return state.get("decision") == "block"
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
    return _compile_graph(validate_graph(version.graph))


def _compile_graph(graph: dict):
    graph = validate_graph(graph)
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
            if state.get("decision") in {"need_input", "handoff", "block"}:
                return "__end__"
            for edge in choices:
                if _condition_matches(edge["condition"], state):
                    return edge["target"]
            # Soft recovery for mis-labeled AI edges (e.g. only result_failed after checkpoint).
            if len(choices) == 1:
                return choices[0]["target"]
            for edge in choices:
                if str(edge.get("condition") or "") == "always":
                    return edge["target"]
            # Prefer continue paths over cancel/fail when nothing matched.
            for edge in choices:
                cond = str(edge.get("condition") or "")
                if cond in {"result_failed", "decision:cancel", "decision:block", "decision:reject"}:
                    continue
                return edge["target"]
            return "__end__"

        mapping = {edge["target"]: edge["target"] for edge in outgoing}
        mapping["__end__"] = END
        builder.add_conditional_edges(key, route, mapping)
    return builder.compile(), graph


def build_trial_payload(graph: dict, payload: dict | None = None, text: str = "") -> dict:
    """Fill collect slots for dry-run; leave checkpoints for interactive confirm in the editor."""
    next_payload = dict(payload or {})
    next_payload["_sop_trial"] = True
    # Do not auto-confirm human checkpoints — trial UI must pause and resume after confirm.
    # Callers may pass _checkpoint_confirm / _confirmed_nodes / _confirm_<key> to continue.
    confirmed = [str(item) for item in (next_payload.get("_confirmed_nodes") or []) if str(item).strip()]
    demo_values = {
        "日期": "本周",
        "品牌": "演示品牌",
        "店铺": "演示店铺",
        "周期": "本周",
        "范围": "天猫销售",
    }
    for node in (graph.get("nodes") or []):
        if not isinstance(node, dict):
            continue
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        for field in config.get("expected_user_info") or config.get("required_fields") or []:
            name = str(field)
            if next_payload.get(name) in (None, "", []):
                next_payload[name] = demo_values.get(name, f"演示{name}")
    next_payload["_confirmed_nodes"] = confirmed
    return next_payload


def execute_sop_version(
    *,
    version: SopVersion,
    text: str,
    payload: dict,
    role: str,
    trace_id: str,
    user,
    organization,
    on_progress=None,
    graph_override: dict | None = None,
) -> dict:
    existing = SopRun.objects.filter(trace_id=trace_id).first()
    if existing and existing.status == SopRun.Status.COMPLETED:
        return existing.output_data
    work_task = WorkTask.objects.filter(sender=user, trace_id=trace_id).first()
    is_trial = bool((payload or {}).get("_sop_trial"))
    if existing:
        run = existing
        # Continuing a paused run counts as resume for observability.
        if run.status == SopRun.Status.NEED_INPUT and run.source != SopRun.Source.TRIAL:
            run.source = SopRun.Source.RESUME
            run.save(update_fields=["source"])
        # Keep trial flag stable for the whole trace.
        if is_trial and not run.is_trial:
            run.is_trial = True
            run.source = SopRun.Source.TRIAL
            run.save(update_fields=["is_trial", "source"])
    else:
        source = SopRun.Source.TRIAL if is_trial else SopRun.Source.LIVE
        run = SopRun.objects.create(
            trace_id=trace_id,
            version=version,
            organization=organization,
            user=user,
            work_task=work_task,
            input_data={"text": text, "payload": payload},
            is_trial=is_trial,
            source=source,
        )
    last_sequence = run.node_runs.aggregate(value=Max("sequence"))["value"] or 0

    agent_kb_ids: list[int] = []
    raw_agent = payload.get("_agent_kb_ids") or payload.get("agent_kb_ids")
    if isinstance(raw_agent, list):
        for item in raw_agent:
            try:
                agent_kb_ids.append(int(item))
            except (TypeError, ValueError):
                continue

    if graph_override is not None:
        compiled, graph = _compile_graph(validate_graph(graph_override))
    else:
        compiled, graph = _compile(version.id, version.content_hash)
    state: SopState = {
        "text": text, "payload": payload, "role": role, "trace_id": trace_id, "user": user,
        "organization": organization, "run": run, "sequence": last_sequence, "steps": [],
        "action": version.definition.action_name, "agent_kb_ids": agent_kb_ids,
        "bound_contexts": [], "graph": graph,
    }
    graph_total = max(len(graph.get("nodes") or []), 1)
    seen_steps = 0

    def _emit_progress(kind: str, *, title: str = "", detail: str = "", status: str = "running", index: int = 0, total: int = 0):
        if not callable(on_progress):
            return
        try:
            on_progress({
                "kind": kind,
                "title": title,
                "detail": detail,
                "status": status,
                "index": index,
                "total": total or graph_total,
            })
        except Exception:
            pass

    progress_token = _sop_progress_cb.set(on_progress)
    try:
        _emit_progress("start", title="开始执行流程", detail="试跑已启动", status="ok", index=0, total=graph_total)

        final = None
        for values in compiled.stream(state, stream_mode="values"):
            if not isinstance(values, dict):
                continue
            final = values
            steps = list(values.get("steps") or [])
            while seen_steps < len(steps):
                step = steps[seen_steps]
                seen_steps += 1
                if not isinstance(step, dict):
                    continue
                status_raw = str(step.get("status") or "done").lower()
                mapped = "failed" if status_raw in {"failed", "error", "block"} else (
                    "waiting" if status_raw in {"need_input", "waiting"} else (
                        "running" if status_raw in {"running"} else "ok"
                    )
                )
                graph_index = int(step.get("graph_index") or 0)
                # Progress bar follows canvas nodes; nested AI substeps share parent index.
                index = graph_index if graph_index > 0 else min(seen_steps, graph_total)
                _emit_progress(
                    "step",
                    title=str(step.get("node") or f"步骤 {index}"),
                    detail=str(step.get("detail") or status_raw or "完成"),
                    status=mapped,
                    index=index,
                    total=graph_total,
                )

        if final is None:
            final = compiled.invoke(state)

        decision = str(final.get("decision") or "").strip()
        # Flows that only collect/confirm/end never set decision=allow; empty/confirmed means natural completion.
        if not decision or decision == "confirmed":
            decision = "allow"
            final = {**final, "decision": decision}
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
        steps = final.get("steps") or []
        current_node = ""
        for step in reversed(steps):
            if isinstance(step, dict) and step.get("node_key"):
                current_node = str(step.get("node_key") or "")
                break
        run.current_node = current_node[:96]
        run.finished_at = timezone.now() if run_status in {SopRun.Status.COMPLETED, SopRun.Status.FAILED, SopRun.Status.NEED_INPUT, SopRun.Status.HANDOFF} else None
        run.save()
        if run.is_trial:
            SopDefinition.objects.filter(id=version.definition_id).update(
                trial_count=F("trial_count") + 1,
            )
            tags = record_run_signals(run)
            if tags:
                run.outcome_tags = tags
                run.save(update_fields=["outcome_tags"])
        else:
            SopDefinition.objects.filter(id=version.definition_id).update(
                call_count=F("call_count") + 1,
                success_count=F("success_count") + (1 if run_status == SopRun.Status.COMPLETED else 0),
                failure_count=F("failure_count") + (1 if run_status == SopRun.Status.FAILED else 0),
            )
            tags = record_run_signals(run)
            if tags:
                run.outcome_tags = tags
                run.save(update_fields=["outcome_tags"])
        finish_status = "ok" if decision == "allow" else ("waiting" if decision == "need_input" else "failed")
        paused_index = 0
        for step in reversed(result.get("steps") or []):
            if isinstance(step, dict) and str(step.get("status") or "").lower() in {"need_input", "waiting"}:
                paused_index = int(step.get("graph_index") or 0)
                break
        _emit_progress(
            "finish",
            title="等待人工确认" if decision == "need_input" else "流程结束",
            detail=str(decision),
            status=finish_status,
            index=paused_index or (graph_total if decision == "allow" else max(seen_steps, 1)),
            total=graph_total,
        )
        return result
    finally:
        _sop_progress_cb.reset(progress_token)


def execute_matching_sop(*, text: str, payload: dict, role: str, trace_id: str, user, organization) -> dict | None:
    version = match_sop(text=text, payload=payload, organization=organization, user=user)
    if not version:
        return None
    return execute_sop_version(
        version=version, text=text, payload=payload, role=role, trace_id=trace_id,
        user=user, organization=organization,
    )
