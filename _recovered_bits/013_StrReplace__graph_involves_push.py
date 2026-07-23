    external_write = bool(payload_result.get("external_write_performed"))
    resolved_graph = graph if isinstance(graph, dict) else (row.graph if isinstance(row.graph, dict) else {})
    involves_push = _graph_involves_push(resolved_graph, result)
    canvas_node_count = len([node for node in (resolved_graph.get("nodes") or []) if isinstance(node, dict)])
    artifacts = []