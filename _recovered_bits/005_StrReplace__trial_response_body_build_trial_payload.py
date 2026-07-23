    node_titles = [
        str(node.get("title") or node.get("key") or f"步骤{index + 1}")
        for index, node in enumerate(graph.get("nodes") or [])
        if isinstance(node, dict)
    ]
    total_nodes = max(len(node_titles), 1)
    trial_payload = build_trial_payload(graph, payload_in, text)
    role = _business_role(request.user)
    trace_id = f"sop-trial-{uuid.uuid4().hex[:16]}"
    version_id = row.id
    sop_id = sop.id
    user_id = request.user.id
    organization_id = organization.id
    events: queue.Queue = queue.Queue()

    def on_progress(event: dict):
        events.put(("progress", event))

    def worker():
        close_old_connections()
        try:
            from django.contrib.auth import get_user_model
            from apps.core.models import Organization

            User = get_user_model()
            version_row = SopVersion.objects.select_related("definition").get(id=version_id)
            sop_row = SopDefinition.objects.get(id=sop_id)
            user_row = User.objects.get(id=user_id)
            org_row = Organization.objects.get(id=organization_id)
            result = execute_sop_version(
                version=version_row,
                text=text,
                payload=trial_payload,
                role=role,
                trace_id=trace_id,
                user=user_row,
                organization=org_row,
                on_progress=on_progress,
            )
            events.put(("done", _trial_response_body(sop_row, version_row, result)))
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