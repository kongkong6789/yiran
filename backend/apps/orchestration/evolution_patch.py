"""Apply structured SOP evolution patches onto a graph."""
from __future__ import annotations

from copy import deepcopy

from .sop_schema import validate_graph


def empty_patch() -> dict:
    return {
        "graph": {
            "upsertNodes": [],
            "removeNodeKeys": [],
            "upsertEdges": [],
            "removeEdgeKeys": [],
        },
        "skill": {
            "suggestCallableSkillId": None,
            "scaffoldFromPattern": None,
            "bindActionOnNode": None,
        },
        "policy": {
            "addCheckpointBefore": None,
            "retry": None,
            "notifyTargets": None,
            "confirmThreshold": None,
        },
    }


def apply_evolution_patch(graph: dict, patch: dict | None) -> dict:
    """Return a validated graph after applying patch. Raises ValueError on invalid result."""
    next_graph = deepcopy(graph if isinstance(graph, dict) else {})
    patch = patch if isinstance(patch, dict) else {}
    graph_patch = patch.get("graph") if isinstance(patch.get("graph"), dict) else {}
    skill_patch = patch.get("skill") if isinstance(patch.get("skill"), dict) else {}
    policy_patch = patch.get("policy") if isinstance(patch.get("policy"), dict) else {}

    nodes = [deepcopy(node) for node in (next_graph.get("nodes") or []) if isinstance(node, dict)]
    edges = [deepcopy(edge) for edge in (next_graph.get("edges") or []) if isinstance(edge, dict)]
    by_key = {str(node.get("key") or ""): node for node in nodes if node.get("key")}

    for key in graph_patch.get("removeNodeKeys") or []:
        node_key = str(key or "").strip()
        if not node_key:
            continue
        by_key.pop(node_key, None)
        edges = [edge for edge in edges if edge.get("source") != node_key and edge.get("target") != node_key]

    for raw in graph_patch.get("upsertNodes") or []:
        if not isinstance(raw, dict):
            continue
        node_key = str(raw.get("key") or "").strip()
        if not node_key:
            continue
        existing = by_key.get(node_key)
        if existing:
            merged = deepcopy(existing)
            for field in ("type", "title"):
                if raw.get(field):
                    merged[field] = raw[field]
            if isinstance(raw.get("config"), dict):
                config = dict(merged.get("config") or {})
                config.update(raw["config"])
                merged["config"] = config
            by_key[node_key] = merged
        else:
            by_key[node_key] = deepcopy(raw)

    remove_edge_keys = {
        str(item).strip()
        for item in (graph_patch.get("removeEdgeKeys") or [])
        if str(item).strip()
    }
    if remove_edge_keys:
        edges = [
            edge
            for edge in edges
            if f"{edge.get('source')}->{edge.get('target')}:{edge.get('condition') or 'always'}" not in remove_edge_keys
        ]

    for raw in graph_patch.get("upsertEdges") or []:
        if not isinstance(raw, dict):
            continue
        source = str(raw.get("source") or "").strip()
        target = str(raw.get("target") or "").strip()
        if not source or not target:
            continue
        condition = str(raw.get("condition") or "always").strip() or "always"
        priority = int(raw.get("priority") or 1)
        edges = [
            edge
            for edge in edges
            if not (edge.get("source") == source and edge.get("target") == target and (edge.get("condition") or "always") == condition)
        ]
        edges.append({"source": source, "target": target, "condition": condition, "priority": priority})

    # Policy: insert checkpoint before a target node
    checkpoint_before = policy_patch.get("addCheckpointBefore")
    if isinstance(checkpoint_before, dict):
        target_key = str(checkpoint_before.get("targetNode") or "").strip()
        checkpoint_key = str(checkpoint_before.get("key") or f"checkpoint.before.{target_key}").strip()[:96]
        title = str(checkpoint_before.get("title") or "人工确认后继续").strip()[:128]
        instruction = str(checkpoint_before.get("instruction") or "请确认无误后再继续执行。").strip()[:300]
        if target_key and target_key in by_key and checkpoint_key not in by_key:
            by_key[checkpoint_key] = {
                "key": checkpoint_key,
                "type": "checkpoint",
                "title": title,
                "config": {
                    "instruction": instruction,
                    "allowed_actions": ["confirm", "ask_user", "continue_flow"],
                },
            }
            rewritten: list[dict] = []
            for edge in edges:
                if edge.get("target") == target_key and edge.get("source") != checkpoint_key:
                    rewritten.append({**edge, "target": checkpoint_key})
                else:
                    rewritten.append(edge)
            rewritten.append(
                {"source": checkpoint_key, "target": target_key, "condition": "decision:confirmed", "priority": 1}
            )
            rewritten.append(
                {"source": checkpoint_key, "target": target_key, "condition": "always", "priority": 2}
            )
            edges = rewritten

    # Policy: retry hint on execute_action
    retry = policy_patch.get("retry")
    if isinstance(retry, dict):
        node_key = str(retry.get("nodeKey") or "").strip()
        attempts = max(1, min(int(retry.get("maxAttempts") or 2), 5))
        if node_key in by_key:
            node = deepcopy(by_key[node_key])
            config = dict(node.get("config") or {})
            config["retry"] = {"max_attempts": attempts, "on_failure": "checkpoint"}
            node["config"] = config
            by_key[node_key] = node

    # Skill bind onto execute_action node
    bind = skill_patch.get("bindActionOnNode")
    if isinstance(bind, dict):
        node_key = str(bind.get("nodeKey") or "").strip()
        action_name = str(bind.get("actionName") or "").strip()
        if node_key in by_key and action_name:
            node = deepcopy(by_key[node_key])
            config = dict(node.get("config") or {})
            config["action_name"] = action_name
            node["config"] = config
            if node.get("type") != "execute_action":
                node["type"] = "execute_action"
            by_key[node_key] = node

    nodes = list(by_key.values())
    start = str(next_graph.get("start") or (nodes[0]["key"] if nodes else "")).strip()
    terminals = list(next_graph.get("terminals") or [])
    if not terminals:
        terminals = [str(node.get("key")) for node in nodes if node.get("type") == "end"]
    result = {
        "start": start,
        "terminals": terminals,
        "nodes": nodes,
        "edges": edges,
        "meta": deepcopy(next_graph.get("meta") or {}),
    }
    return validate_graph(result)


def estimate_risk(patch: dict | None, *, high_risk_actions: set[str] | None = None) -> str:
    patch = patch if isinstance(patch, dict) else {}
    skill = patch.get("skill") if isinstance(patch.get("skill"), dict) else {}
    policy = patch.get("policy") if isinstance(patch.get("policy"), dict) else {}
    graph = patch.get("graph") if isinstance(patch.get("graph"), dict) else {}
    high_risk_actions = high_risk_actions or set()

    bind = skill.get("bindActionOnNode") if isinstance(skill.get("bindActionOnNode"), dict) else {}
    action_name = str(bind.get("actionName") or "")
    if action_name.startswith("notify.") or action_name in high_risk_actions or "high_risk" in action_name:
        return "high"
    if skill.get("scaffoldFromPattern") or skill.get("suggestCallableSkillId"):
        return "medium"
    if policy.get("addCheckpointBefore") or policy.get("notifyTargets"):
        return "medium"
    if graph.get("removeNodeKeys") or graph.get("removeEdgeKeys") or len(graph.get("upsertNodes") or []) > 2:
        return "medium"
    return "low"
