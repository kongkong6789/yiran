@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def sop_version_detail(request, sop_key: str, version: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    row = sop.versions.filter(version=version).first() if sop else None
    if not row:
        return Response({"error": "SOP 版本不存在。"}, status=404)
    if request.method == "GET":
        return Response(_version_payload(row))
    if not _can_edit(sop, request.user):
        return Response({"error": "没有权限修改该 SOP。"}, status=403)
    chat_keys = {"editorChat", "editor_chat"}
    data_keys = {str(key) for key in request.data.keys()}
    chat_only = bool(data_keys) and data_keys <= chat_keys
    if chat_only:
        row.editor_chat = _normalize_editor_chat(
            request.data.get("editorChat", request.data.get("editor_chat"))
        )
        row.save(update_fields=["editor_chat", "updated_at"])
        return Response(_version_payload(row))
    if row.status != SopVersion.Status.DRAFT:
        return Response({"error": "只有当前工作区的草稿版本可以修改。"}, status=403)
    try:
        values = _version_values(request.data, fallback=row)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    for field, value in values.items():
        setattr(row, field, value)
    if "editorChat" in request.data or "editor_chat" in request.data:
        row.editor_chat = _normalize_editor_chat(
            request.data.get("editorChat", request.data.get("editor_chat"))
        )
    row.save()
    return Response(_version_payload(row))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_version_trial(request, sop_key: str, version: str):
    """Dry-run the selected SOP version inside the editor (draft or published)."""
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    row = sop.versions.filter(version=version).first() if sop else None
    if not row:
        return Response({"error": "SOP 版本不存在。"}, status=404)
    text = str(request.data.get("text") or request.data.get("instruction") or "试跑当前流程").strip()[:500]
    payload_in = request.data.get("payload") if isinstance(request.data.get("payload"), dict) else {}
    graph = row.graph
    if isinstance(request.data.get("graph"), dict):
        try:
            graph = validate_graph(request.data.get("graph"))
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)
        # Prefer editor draft graph for trial without forcing a separate save.
        if row.status == SopVersion.Status.DRAFT and _can_edit(sop, request.user):
            row.graph = graph
            row.content_hash = graph_hash(
                graph=graph,
                input_schema=row.input_schema,
                output_schema=row.output_schema,
                trigger_intents=row.trigger_intents,
                examples=row.utterance_examples,
            )
            row.save(update_fields=["graph", "content_hash", "updated_at"])
        elif row.status != SopVersion.Status.DRAFT:
            # Published: run against persisted graph only.
            graph = row.graph
    try:
        trial_payload = build_trial_payload(graph, payload_in, text)
        result = execute_sop_version(
            version=row,
            text=text,
            payload=trial_payload,
            role=_business_role(request.user),
            trace_id=f"sop-trial-{uuid.uuid4().hex[:16]}",
            user=request.user,
            organization=organization,
        )
    except Exception as exc:
        return Response({"error": f"试跑失败：{exc}"}, status=500)
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
    assistant = f"已试跑「{sop.name}」v{row.version}：{decision_label}。"
    if error:
        assistant += f"\n原因：{error[:400]}"
    elif decision == "allow":
        assistant += " 各步骤已按试跑模式自动填入演示数据并走完。"
    elif decision == "need_input":
        missing = result.get("missing") or []
        if missing:
            assistant += f" 还需：{', '.join(str(item) for item in missing[:8])}。"
    return Response({
        "assistant": assistant[:1200],
        "tools": tools,
        "result": result,
        "model": "trial-runtime",
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_publish(request, sop_key: str, version: str):