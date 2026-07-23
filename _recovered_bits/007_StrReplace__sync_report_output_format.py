        node["config"] = config
    return _sync_report_output_format(_normalize_node_actions(next_graph, draft_action), instruction)


def _extract_json_object(text: str) -> dict: