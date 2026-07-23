def _prepare_trial_graph(request, sop, row):
    text = str(request.data.get("text") or request.data.get("instruction") or "试跑当前流程").strip()[:500]
    payload_in = request.data.get("payload") if isinstance(request.data.get("payload"), dict) else {}
    graph = row.graph
    if isinstance(request.data.get("graph"), dict):
        graph = validate_graph(request.data.get("graph"))
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
            graph = row.graph
    return text, payload_in, graph


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_version_trial(request, sop_key: str, version: str):
    """Dry-run the selected SOP version inside the editor (draft or published)."""
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    row = sop.versions.filter(version=version).first() if sop else None
    if not row:
        return Response({"error": "SOP 版本不存在。"}, status=404)
    try:
        text, payload_in, graph = _prepare_trial_graph(request, sop, row)
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
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    except Exception as exc:
        return Response({"error": f"试跑失败：{exc}"}, status=500)
    return Response(_trial_response_body(sop, row, result))


@api_view(["POST"])
@renderer_classes([EventStreamRenderer, JSONRenderer])
@permission_classes([IsAuthenticated])
def sop_version_trial_stream(request, sop_key: str, version: str):
    """SSE dry-run: push step progress, heartbeats, then final artifacts."""
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    row = sop.versions.filter(version=version).first() if sop else None
    if not row:
        return Response({"error": "SOP 版本不存在。"}, status=404)
    try:
        text, payload_in, graph = _prepare_trial_graph(request, sop, row)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)

    node_titles = [
        str(node.get("title") or node.get("key") or f"步骤{index + 1}")
        for index, node in enumerate(graph.get("nodes") or [])
        if isinstance(node, dict)
    ]
    total_nodes = max(len(node_titles), 1)
    trial_payload = build_trial_payload(graph, payload_in, text)
    role = _business_role(request.user)
    trace_id = f"sop-trial-{uuid.uuid4().hex[:16]}"
    user = request.user
    events: queue.Queue = queue.Queue()

    def on_progress(event: dict):
        events.put(("progress", event))

    def worker():
        close_old_connections()
        try:
            result = execute_sop_version(
                version=row,
                text=text,
                payload=trial_payload,
                role=role,
                trace_id=trace_id,
                user=user,
                organization=organization,
                on_progress=on_progress,
            )
            events.put(("done", _trial_response_body(sop, row, result)))
        except Exception as exc:  # noqa: BLE001
            events.put(("error", {"error": f"试跑失败：{exc}"}))
        finally:
            close_old_connections()

    threading.Thread(target=worker, daemon=True).start()

    def event_stream():
        yield _sse("hello", {
            "trace_id": trace_id,
            "total": total_nodes,
            "titles": node_titles[:40],
            "name": sop.name,
            "version": row.version,
        })
        idle_ticks = 0
        while True:
            try:
                kind, payload = events.get(timeout=1.2)
            except queue.Empty:
                idle_ticks += 1
                yield _sse("heartbeat", {
                    "message": "正在生成结果，请稍候…",
                    "tick": idle_ticks,
                })
                continue
            idle_ticks = 0
            if kind == "progress":
                yield _sse("progress", payload if isinstance(payload, dict) else {})
                continue
            if kind == "done":
                body = payload if isinstance(payload, dict) else {}
                # Stream report markdown in chunks so UI can typewriter-render.
                artifacts = body.get("artifacts") if isinstance(body.get("artifacts"), list) else []
                for artifact in artifacts:
                    if not isinstance(artifact, dict):
                        continue
                    if str(artifact.get("kind") or "") not in {"markdown", "notify_preview"}:
                        continue
                    content = str(artifact.get("content") or "")
                    if not content:
                        continue
                    chunk_size = 48
                    for index in range(0, len(content), chunk_size):
                        yield _sse("artifact_delta", {
                            "id": str(artifact.get("id") or "report_markdown"),
                            "kind": str(artifact.get("kind") or "markdown"),
                            "title": str(artifact.get("title") or "产物"),
                            "summary": str(artifact.get("summary") or ""),
                            "delta": content[index:index + chunk_size],
                            "done": False,
                        })
                    yield _sse("artifact_delta", {
                        "id": str(artifact.get("id") or "report_markdown"),
                        "kind": str(artifact.get("kind") or "markdown"),
                        "title": str(artifact.get("title") or "产物"),
                        "summary": str(artifact.get("summary") or ""),
                        "delta": "",
                        "done": True,
                    })
                yield _sse("done", body)
                break
            if kind == "error":
                yield _sse("error", payload if isinstance(payload, dict) else {"error": "试跑失败"})
                break

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_publish(request, sop_key: str, version: str):