def _sync_report_output_format(graph: dict, instruction: str = "") -> dict:
    """Ensure report.generate nodes set config.output_format when user/AI asks for HTML.

    LLMs often only rewrite instruction text ("报告格式为 HTML") and leave the
    structured field as markdown — this closes that gap.
    """
    from .report_html import resolve_report_output_format

    next_graph = deepcopy(graph) if isinstance(graph, dict) else {"nodes": [], "edges": [], "start": "", "terminals": []}
    nodes = next_graph.get("nodes") or []
    changed = False
    for node in nodes:
        if not isinstance(node, dict) or node.get("type") != "execute_action":
            continue
        config = dict(node.get("config") or {}) if isinstance(node.get("config"), dict) else {}
        action_name = str(config.get("action_name") or "").strip()
        if action_name and action_name != "report.generate":
            continue
        if not action_name:
            # Instruction-only execute nodes still often mean report generation.
            blob = f"{instruction}\n{config.get('instruction') or ''}\n{node.get('title') or ''}"
            if not any(word in blob for word in ("报告", "周报", "分析", "HTML", "html")):
                continue
            config["action_name"] = "report.generate"
            changed = True
        node_instruction = str(config.get("instruction") or "")
        inferred = resolve_report_output_format(
            config,
            text=instruction,
            instruction=f"{node_instruction}\n{node.get('title') or ''}",
        )
        current = str(config.get("output_format") or "").strip().lower()
        if inferred == "html" and current != "html":
            config["output_format"] = "html"
            changed = True
        elif not current:
            config["output_format"] = inferred or "markdown"
            changed = True
        if changed or config != (node.get("config") or {}):
            node["config"] = config
    next_graph["nodes"] = nodes
    return next_graph


def _autofill_graph_bindings(