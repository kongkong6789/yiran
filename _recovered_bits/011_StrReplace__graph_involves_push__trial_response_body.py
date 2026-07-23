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
    steps = result.get("steps") or []
    tools = []
    for step in steps[:30]:
        if not isinstance(step, dict):
            continue
        status_raw = str(step.get("status") or "").lower()
        tool_status = "failed" if status_raw in {"failed", "error", "block"} else "ok"
        tools.append({
            "name": str(step.get("node") or "step")[:64],
            "summary": str(step.get("detail") or status_raw or "完成")[:240],
            "status": tool_status,
        })
    decision = str(result.get("decision") or "")
    decision_label = {
        "allow": "执行完成",
        "need_input": "等待补充信息",
        "handoff": "已转人工",
        "block": "执行中断",
    }.get(decision, decision or "已结束")
    error = str(result.get("error") or "").strip()
    payload_result = result.get("result") if isinstance(result.get("result"), dict) else {}
    report_markdown = str(payload_result.get("report_markdown") or "").strip()
    report_html = str(payload_result.get("report_html") or "").strip()
    user_message = str(payload_result.get("user_message") or "").strip()
    evidence = payload_result.get("evidence") if isinstance(payload_result.get("evidence"), dict) else {}
    external_write = bool(payload_result.get("external_write_performed"))
    resolved_graph = graph if isinstance(graph, dict) else (row.graph if isinstance(row.graph, dict) else {})
    involves_push = _graph_involves_push(resolved_graph, result)
    canvas_node_count = len([node for node in (resolved_graph.get("nodes") or []) if isinstance(node, dict)])
    artifacts = []
    if report_html:
        artifacts.append({
            "id": "report_html",
            "kind": "html",
            "title": "经营分析报告（HTML）",
            "summary": user_message or f"共 {len(report_html)} 字",
            "content": report_html[:120000],
        })
    if report_markdown:
        artifacts.append({
            "id": "report_markdown",
            "kind": "markdown",
            "title": "经营分析报告" if not report_html else "经营分析报告（Markdown）",
            "summary": user_message or f"共 {len(report_markdown)} 字",
            "content": report_markdown[:20000],
        })
    preview = payload_result.get("preview") if isinstance(payload_result.get("preview"), dict) else None
    if preview or str(payload_result.get("destination") or ""):
        dest_label = str(
            payload_result.get("destination_label")
            or (preview.get("destination_label") if preview else "")
            or "推送预览"
        )
        if preview:
            push_body = (
                f"渠道：{dest_label}\n"
                f"内容：\n{preview.get('content') or ''}\n"
            )
        else:
            push_body = user_message or "推送试跑预览"
        artifacts.append({
            "id": "notify_preview",
            "kind": "notify_preview",
            "title": f"推送预览 · {dest_label}",
            "summary": "试跑未真实发送" if not payload_result.get("pushed_to_user") else "已推送",
            "content": push_body[:12000],
        })
    if evidence:
        snapshot_ids = evidence.get("snapshot_ids") or []
        artifacts.append({
            "id": "evidence",
            "kind": "evidence",
            "title": "数据证据",
            "summary": f"绑定快照 {len(snapshot_ids)} 个" if snapshot_ids else "已记录执行证据",
            "content": json.dumps(evidence, ensure_ascii=False, indent=2)[:8000],
        })
    assistant = f"已试跑「{sop.name}」v{row.version}：{decision_label}。"
    if error:
        assistant += f"\n原因：{error[:400]}"
    elif decision == "allow":
        assistant += " 这是编辑器试跑：已按当前画布 SOP 用演示参数走完全流程。"
        if involves_push:
            assistant += " 流程含推送节点，试跑不会真实发给外部用户。"
        if artifacts:
            assistant += f" 已生成 {len(artifacts)} 个可查看产物，请点「查看结果」。"
        else:
            assistant += " 本次未产出可下载报告（可能该流程未调用报告生成能力）。"
    elif decision == "need_input":
        missing = result.get("missing") or []
        if missing:
            assistant += f" 还需：{', '.join(str(item) for item in missing[:8])}。"
    note = (
        "本流程含推送节点；试跑只做预览，不会真实推送到企业微信或其他用户。"
        if involves_push
        else "试跑已按当前画布节点执行（缺失信息用演示参数自动填入），不会改动外部系统。"
    )
    return {
        "assistant": assistant[:1200],
        "tools": tools,
        "result": result,
        "artifacts": artifacts,
        "trialMeta": {
            "mode": "dry_run",
            "externalWritePerformed": external_write,
            "involvesPush": involves_push,
            "pushedToUser": False if involves_push else None,
            "canvasNodeCount": canvas_node_count,
            "note": note,
        },
        "model": "trial-runtime",
    }