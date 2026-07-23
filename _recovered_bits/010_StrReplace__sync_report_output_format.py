def _sync_structured_node_config(graph: dict, instruction: str = "") -> dict:
    """Normalize structured config fields after AI rewrite.

    Models often only change instruction prose ("报告格式为 HTML" / "推企业微信").
    This maps those intents onto real config fields so the editor and runtime agree.
    """
    from .report_html import resolve_report_output_format

    next_graph = deepcopy(graph) if isinstance(graph, dict) else {"nodes": [], "edges": [], "start": "", "terminals": []}
    nodes = next_graph.get("nodes") or []
    for node in nodes:
        if not isinstance(node, dict) or node.get("type") not in {"execute_action", "gate"}:
            continue
        config = dict(node.get("config") or {}) if isinstance(node.get("config"), dict) else {}
        action_name = str(config.get("action_name") or "").strip()
        node_instruction = str(config.get("instruction") or "")
        blob = f"{instruction}\n{node_instruction}\n{node.get('title') or ''}"

        if not action_name and any(word in blob for word in ("报告", "周报", "分析", "HTML", "html")):
            action_name = "report.generate"
            config["action_name"] = action_name
        if not action_name and any(word in blob for word in ("推送", "通知", "企业微信", "企微", "站内")):
            action_name = "notify.push"
            config["action_name"] = action_name

        if action_name == "report.generate":
            inferred = resolve_report_output_format(config, text=instruction, instruction=blob)
            current = str(config.get("output_format") or "").strip().lower()
            if inferred == "html" and current != "html":
                config["output_format"] = "html"
            elif not current:
                config["output_format"] = inferred or "markdown"

        if action_name == "notify.push":
            destination = str(config.get("destination") or "").strip().lower()
            if any(word in blob for word in ("企业微信", "企微", "wecom")):
                config["destination"] = "wecom"
            elif any(word in blob for word in ("站内", "平台")) and destination != "wecom":
                config["destination"] = "platform"
            elif not destination:
                config["destination"] = "platform"
            if node_instruction and not str(config.get("push_content") or "").strip():
                config["push_content"] = node_instruction[:800]

        node["config"] = config
    next_graph["nodes"] = nodes
    return next_graph


def _sync_report_output_format(graph: dict, instruction: str = "") -> dict:
    """Backward-compatible alias. """
    return _sync_structured_node_config(graph, instruction)