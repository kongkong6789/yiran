from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy


NODE_TYPES = {"collect_info", "checkpoint", "execute_action", "gate", "handoff", "end"}
CONDITION_PREFIXES = {"always", "result_ok", "result_failed", "decision:", "field_present:", "field_missing:"}


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
        node["config"] = node.get("config") if isinstance(node.get("config"), dict) else {}
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
        edge.update({"source": source, "target": target, "condition": condition, "priority": int(edge.get("priority") or 0)})
        outgoing[source] += 1
    for terminal in terminals:
        if outgoing[terminal]:
            raise ValueError(f"终止节点不能继续流转：{terminal}")
    return graph


def graph_hash(*, graph: dict, input_schema: dict, output_schema: dict, trigger_intents: list, examples: list) -> str:
    payload = {"graph": graph, "input": input_schema, "output": output_schema, "triggers": trigger_intents, "examples": examples}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
