from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy


NODE_TYPES = {
    "collect_info",
    "checkpoint",
    "execute_action",
    "gate",
    "handoff",
    "end",
    "knowledge_query",
    "data_bind",
}
CONDITION_PREFIXES = {"always", "result_ok", "result_failed", "decision:", "field_present:", "field_missing:"}

BASE_ALLOWED_ACTIONS = {
    "ask_user",
    "query_knowledge",
    "handoff_human",
    "continue_flow",
    "confirm",
}

DEFAULT_ALLOWED_BY_TYPE = {
    "collect_info": ["ask_user", "continue_flow"],
    "checkpoint": ["confirm", "ask_user", "continue_flow"],
    "knowledge_query": ["query_knowledge", "continue_flow"],
    "data_bind": ["continue_flow"],
    "gate": ["continue_flow"],
    "execute_action": ["continue_flow"],
    "handoff": ["handoff_human"],
    "end": ["continue_flow"],
}


def _string_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _int_list(value) -> list[int]:
    result: list[int] = []
    if not isinstance(value, list):
        return result
    for item in value:
        try:
            result.append(int(item))
        except (TypeError, ValueError):
            continue
    return result


def normalize_data_bindings(raw) -> dict:
    data = raw if isinstance(raw, dict) else {}
    brand_ids = data.get("brand_ids")
    if not isinstance(brand_ids, list):
        brand_ids = []
    return {
        "snapshot_ids": _int_list(data.get("snapshot_ids")),
        "metric_ids": _string_list(data.get("metric_ids")),
        "asset_keys": _string_list(data.get("asset_keys")),
        "scope": str(data.get("scope") or "").strip()[:64],
        "brand_ids": [str(item).strip() for item in brand_ids if str(item).strip()][:50],
    }


def normalize_knowledge_scope(raw) -> dict:
    data = raw if isinstance(raw, dict) else {}
    return {
        "knowledge_base_ids": _int_list(data.get("knowledge_base_ids")),
        "retrieval_hint": str(data.get("retrieval_hint") or "").strip()[:300],
    }


def default_allowed_actions(node_type: str, action_name: str = "") -> list[str]:
    actions = list(DEFAULT_ALLOWED_BY_TYPE.get(node_type) or ["continue_flow"])
    if action_name and node_type in {"execute_action", "gate"}:
        token = f"call_action:{action_name}"
        if token not in actions:
            actions.append(token)
    return actions


def normalize_node_config(node_type: str, raw_config: dict | None) -> dict:
    """Normalize StaffDeck-like node config; keep backward compatible aliases."""
    config = deepcopy(raw_config) if isinstance(raw_config, dict) else {}

    instruction = str(
        config.get("instruction")
        or config.get("detail")
        or config.get("message")
        or ""
    ).strip()[:2000]

    expected = _string_list(config.get("expected_user_info"))
    if not expected:
        expected = _string_list(config.get("required_fields"))

    action_name = str(config.get("action_name") or "").strip()[:96]
    allowed = _string_list(config.get("allowed_actions"))
    if not allowed:
        allowed = default_allowed_actions(node_type, action_name)
    else:
        normalized_allowed: list[str] = []
        for item in allowed:
            if item in BASE_ALLOWED_ACTIONS or item.startswith("call_action:"):
                normalized_allowed.append(item[:120])
        allowed = normalized_allowed or default_allowed_actions(node_type, action_name)

    if action_name and node_type in {"execute_action", "gate"}:
        token = f"call_action:{action_name}"
        if token not in allowed:
            allowed.append(token)

    knowledge_scope = normalize_knowledge_scope(config.get("knowledge_scope"))
    data_bindings = normalize_data_bindings(config.get("data_bindings"))

    normalized = {
        "instruction": instruction,
        "expected_user_info": expected,
        "required_fields": expected,  # legacy alias for older readers
        "allowed_actions": allowed,
        "knowledge_scope": knowledge_scope,
        "data_bindings": data_bindings,
        "action_name": action_name,
        "detail": instruction,
        "message": str(config.get("message") or instruction)[:500],
        "optional": bool(config.get("optional")),
    }
    # Preserve unknown keys so future fields are not stripped silently.
    for key, value in config.items():
        if key not in normalized:
            normalized[key] = value
    return normalized


def project_node_context(graph: dict, node_key: str) -> dict:
    """Compact projection: current node + direct next steps (StaffDeck-style)."""
    nodes = {node["key"]: node for node in graph.get("nodes") or []}
    current = nodes.get(node_key)
    if not current:
        return {"current_step": None, "next_steps": []}
    outgoing = [
        edge for edge in (graph.get("edges") or [])
        if edge.get("source") == node_key
    ]
    outgoing.sort(key=lambda item: int(item.get("priority") or 0))
    next_steps = []
    for edge in outgoing:
        target = nodes.get(edge.get("target"))
        if not target:
            continue
        next_steps.append({
            "key": target["key"],
            "type": target["type"],
            "title": target["title"],
            "instruction": (target.get("config") or {}).get("instruction") or "",
            "transition": edge.get("condition") or "always",
            "label": edge.get("label") or "",
        })
    return {
        "current_step": {
            "key": current["key"],
            "type": current["type"],
            "title": current["title"],
            "instruction": (current.get("config") or {}).get("instruction") or "",
            "expected_user_info": (current.get("config") or {}).get("expected_user_info") or [],
            "allowed_actions": (current.get("config") or {}).get("allowed_actions") or [],
            "knowledge_scope": (current.get("config") or {}).get("knowledge_scope") or {},
            "data_bindings": (current.get("config") or {}).get("data_bindings") or {},
            "action_name": (current.get("config") or {}).get("action_name") or "",
        },
        "next_steps": next_steps,
    }


def validate_graph(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("SOP 流程必须是 JSON 对象。")
    graph = deepcopy(raw)
    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("SOP 至少需要一个节点。")
    if not isinstance(edges, list):
        raise ValueError("SOP 流转规则必须是数组。")

    meta = graph.get("meta") if isinstance(graph.get("meta"), dict) else {}
    goals = _string_list(meta.get("goal"))
    required_info = _string_list(meta.get("required_info"))
    graph["meta"] = {
        "goal": goals,
        "required_info": required_info,
        "slot_filling_policy": meta.get("slot_filling_policy") if isinstance(meta.get("slot_filling_policy"), dict) else {},
        "layout": meta.get("layout") if isinstance(meta.get("layout"), dict) else {},
    }

    keys: list[str] = []
    for index, node in enumerate(nodes):
        if not isinstance(node, dict):
            raise ValueError(f"第 {index + 1} 个节点格式无效。")
        key = str(node.get("key") or "").strip()
        if not re.fullmatch(r"[a-z][a-z0-9_.-]{1,95}", key):
            raise ValueError(f"节点 key 无效：{key or index + 1}")
        if key in keys:
            raise ValueError(f"节点 key 重复：{key}")
        node_type = str(node.get("type") or "checkpoint")
        if node_type not in NODE_TYPES:
            raise ValueError(f"不支持的节点类型：{node_type}")
        node["key"] = key
        node["type"] = node_type
        node["title"] = str(node.get("title") or key)[:128]
        node["config"] = normalize_node_config(node_type, node.get("config") if isinstance(node.get("config"), dict) else {})
        keys.append(key)

    start = str(graph.get("start") or "")
    if start not in keys:
        raise ValueError("SOP 起始节点不存在。")
    terminals = graph.get("terminals")
    if not isinstance(terminals, list) or not terminals or any(item not in keys for item in terminals):
        raise ValueError("SOP 必须配置有效的终止节点。")

    outgoing = {key: 0 for key in keys}
    for edge in edges:
        if not isinstance(edge, dict):
            raise ValueError("SOP 流转规则格式无效。")
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        condition = str(edge.get("condition") or "always")
        if source not in keys or target not in keys:
            raise ValueError(f"流转规则引用了不存在的节点：{source} → {target}")
        if not any(condition == prefix or condition.startswith(prefix) for prefix in CONDITION_PREFIXES):
            raise ValueError(f"不支持的流转条件：{condition}")
        edge.update({
            "source": source,
            "target": target,
            "condition": condition,
            "priority": int(edge.get("priority") or 0),
            "label": str(edge.get("label") or "")[:64],
        })
        outgoing[source] += 1
    for terminal in terminals:
        if outgoing[terminal]:
            raise ValueError(f"终止节点不能继续流转：{terminal}")
    return graph


def graph_hash(*, graph: dict, input_schema: dict, output_schema: dict, trigger_intents: list, examples: list) -> str:
    payload = {"graph": graph, "input": input_schema, "output": output_schema, "triggers": trigger_intents, "examples": examples}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
