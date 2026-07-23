        if node.get("type") == "execute_action" and any(word in text for word in ("周报", "报告", "分析", "HTML", "html", "网页")):
            action_name = str(config.get("action_name") or result.get("actionName") or "report.generate")
            if not get_action(action_name):
                action_name = "report.generate" if get_action("report.generate") else action_name
            config["action_name"] = action_name
            if "周报" in text:
                node["title"] = node.get("title") if "周报" in str(node.get("title") or "") else "生成销售周报"
                config["instruction"] = text[:800] or config.get("instruction") or "生成销售周报"
            if any(word in text for word in ("HTML", "html", "网页")):
                config["output_format"] = "html"
                instruction_text = str(config.get("instruction") or "")
                if "HTML" not in instruction_text and "html" not in instruction_text:
                    config["instruction"] = (instruction_text + "\n报告格式为 HTML。").strip()
            node["config"] = config
    graph["nodes"], graph["edges"] = nodes, edges
    result["graph"] = _ensure_connected(_sync_report_output_format(
        _normalize_node_actions(graph, str(result.get("actionName") or "")),
        instruction,
    ))