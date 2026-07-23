    def _finalize_graph(graph: dict) -> dict:
        filled = _autofill_graph_bindings(
            graph,
            assets=available_assets,
            actions=available_actions,
            instruction=instruction,
            draft_action=str(draft.get("actionName") or ""),
        )
        return _ensure_connected(_sync_report_output_format(filled, instruction))