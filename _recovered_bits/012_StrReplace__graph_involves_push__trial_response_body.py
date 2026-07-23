def _graph_involves_push(graph: dict | None, result: dict | None = None) -> bool:
    """True only when the SOP graph / result actually involves notify.push."""
    for node in (graph or {}).get("nodes") or []:
        if not isinstance(node, dict):
            continue
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        allowed = config.get("allowed_actions") or []
        blob = " ".join(
            [
                str(node.get("key") or ""),
                str(node.get("title") or ""),
                str(node.get("type") or ""),
                str(config.get("action_name") or ""),
                str(config.get("instruction") or ""),
                " ".join(str(item) for item in allowed),
            ]
        ).lower()
        if "notify.push" in blob or "推送给用户" in str(node.get("title") or ""):
            return True
    payload_result = result.get("result") if isinstance((result or {}).get("result"), dict) else {}
    if not isinstance(payload_result, dict):
        payload_result = {}
    if payload_result.get("preview") or str(payload_result.get("destination") or "").strip():
        return True
    if str((result or {}).get("action") or "") == "notify.push":
        return True
    return False


def _trial_response_body(sop: SopDefinition, row: SopVersion, result: dict, graph: dict | None = None) -> dict: