"""SOP editor dry-run (one-shot + SSE stream)."""
from __future__ import annotations

import json
import queue
import threading
import uuid

from django.db import close_old_connections
from django.http import StreamingHttpResponse
from rest_framework.decorators import api_view, permission_classes, renderer_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response

from apps.core.organizations import ensure_current_organization, primary_membership

from .models import SopDefinition, SopVersion
from .sop_api import _can_edit, _find_sop
from .sop_runtime import build_trial_payload, execute_sop_version
from .sop_schema import graph_hash, validate_graph


class EventStreamRenderer(BaseRenderer):
    media_type = "text/event-stream"
    format = "event-stream"
    charset = None

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


def _business_role(user) -> str:
    membership = primary_membership(user)
    if not membership:
        return "operator"
    return {"owner": "director", "admin": "manager", "member": "operator"}.get(membership.role, "operator")


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


def _awaiting_confirm_meta(result: dict) -> dict | None:
    """Extract checkpoint pause info for trial UI (confirm → continue)."""
    if str(result.get("decision") or "") != "need_input":
        return None
    missing = [str(item) for item in (result.get("missing") or []) if str(item).strip()]
    confirm_keys = [item[len("_confirm_"):] for item in missing if item.startswith("_confirm_")]
    title = ""
    instruction = ""
    node_key = confirm_keys[0] if confirm_keys else ""
    for step in reversed(result.get("steps") or []):
        if not isinstance(step, dict):
            continue
        data = step.get("data") if isinstance(step.get("data"), dict) else {}
        status_raw = str(step.get("status") or "").lower()
        checkpoint = str(data.get("checkpoint") or "").strip()
        if checkpoint and status_raw in {"need_input", "waiting"}:
            node_key = checkpoint
            title = str(step.get("node") or "")
            instruction = str(data.get("instruction") or step.get("detail") or "")
            break
        if status_raw in {"need_input", "waiting"} and not title:
            title = str(step.get("node") or "")
            instruction = str(step.get("detail") or "")
    if not node_key and not title:
        # Generic need_input (missing collect fields) — not a confirm gate.
        if missing and not any(item.startswith("_confirm_") for item in missing):
            return None
        return None
    return {
        "kind": "checkpoint",
        "nodeKey": node_key,
        "title": title or "人工确认",
        "instruction": instruction or "请确认后继续执行后续步骤",
        "missing": missing[:12],
    }


def _trial_response_body(sop: SopDefinition, row: SopVersion, result: dict, graph: dict | None = None) -> dict:
    steps = result.get("steps") or []
    tools = []
    for step in steps[:30]:
        if not isinstance(step, dict):
            continue
        status_raw = str(step.get("status") or "").lower()
        if status_raw in {"failed", "error", "block"}:
            tool_status = "failed"
        elif status_raw in {"need_input", "waiting"}:
            tool_status = "waiting"
        else:
            tool_status = "ok"
        tools.append({
            "name": str(step.get("node") or "step")[:64],
            "summary": str(step.get("detail") or status_raw or "完成")[:240],
            "status": tool_status,
        })
    decision = str(result.get("decision") or "")
    decision_label = {
        "allow": "执行完成",
        "need_input": "等待确认",
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
    awaiting_confirm = _awaiting_confirm_meta(result)
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
    if error and decision not in {"need_input"}:
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
        if awaiting_confirm:
            assistant += (
                f" 已停在「{awaiting_confirm.get('title') or '人工确认'}」，"
                "请在试跑卡片中确认后继续执行后续步骤。"
            )
        else:
            missing = result.get("missing") or []
            if missing:
                assistant += f" 还需：{', '.join(str(item) for item in missing[:8])}。"
    note = (
        "本流程含推送节点；试跑只做预览，不会真实推送到企业微信或其他用户。"
        if involves_push
        else "试跑已按当前画布节点执行（缺失信息用演示参数自动填入），不会改动外部系统。"
    )
    if awaiting_confirm:
        note = "流程含人工确认：会真实暂停。收集信息在试跑中用演示参数自动填入；确认后会真实执行报告生成等业务能力。"
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
            "awaitingConfirm": awaiting_confirm,
        },
        "model": "trial-runtime",
    }


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
    return Response(_trial_response_body(sop, row, result, graph=graph))


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
            events.put(("done", _trial_response_body(sop_row, version_row, result, graph=graph)))
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
                    if str(artifact.get("kind") or "") not in {"markdown", "notify_preview", "html"}:
                        continue
                    content = str(artifact.get("content") or "")
                    if not content:
                        continue
                    chunk_size = 180 if str(artifact.get("kind") or "") == "html" else 48
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
