"""SOP AI rewrite SSE endpoint."""
from __future__ import annotations

import json
import queue
import re
import threading

from django.db import close_old_connections
from django.http import StreamingHttpResponse
from rest_framework.decorators import api_view, permission_classes, renderer_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.organizations import ensure_current_organization
from apps.council import llm

from .sop_api import (
    _available_catalog,
    _autofill_graph_bindings,
    _consult_sop_response,
    _ensure_connected,
    _extract_json_object,
    _fallback_rewrite,
)
from .sop_api import (
    _looks_like_consult,
    _merge_flow_graph,
    _merge_targeted_nodes,
    _normalize_images,
    _pick_action_name,
    _resolve_target_keys,
    _tool_step,
    _user_message_content,
    _known_action,
)
from .sop_schema import validate_graph
from .sop_trial import EventStreamRenderer, _sse


def _stream_status(events: queue.Queue, *, message: str, tools: list[dict] | None = None):
    events.put(("status", {"message": message[:500], "tools": tools or []}))


def _finalize_graph_for_stream(graph: dict, *, available_assets: list[dict], available_actions: list[dict], instruction: str, draft_action: str) -> dict:
    filled = _autofill_graph_bindings(
        graph,
        assets=available_assets,
        actions=available_actions,
        instruction=instruction,
        draft_action=draft_action,
    )
    return _ensure_connected(filled)


def _run_rewrite_stream(data: dict, *, user, organization, events: queue.Queue):
    instruction = str(data.get("instruction") or "").strip()
    draft = data.get("draft") or {}
    history = data.get("history") or []
    images = _normalize_images(data.get("images") or [])
    if not instruction and not images:
        raise ValueError("请输入你希望 AI 如何创建或修改 SOP。")
    if not instruction and images:
        instruction = "请根据附图理解业务意图，并据此修改当前选中范围的 SOP。"
    if not isinstance(draft, dict) or not isinstance(history, list):
        raise ValueError("SOP 草稿或对话历史格式错误。")
    current_graph = draft.get("graph") or {}
    validate_graph(current_graph)
    target_keys = _resolve_target_keys(data if isinstance(data, dict) else {}, current_graph)
    edit_scope = "flow" if not target_keys else ("node" if len(target_keys) == 1 else "nodes")
    node_count = len((current_graph.get("nodes") or []))
    catalog = _available_catalog(organization, user=user)
    available_actions = catalog["availableActions"]
    available_assets = catalog["availableAssets"]
    mode = str(data.get("mode") or "").strip().lower()

    if mode == "consult" or (mode != "edit" and not images and _looks_like_consult(instruction)):
        _stream_status(
            events,
            message="正在查阅当前流程和可用能力…",
            tools=[
                _tool_step("read_graph", f"读取当前流程（{node_count} 步）", "ok"),
                _tool_step("list_actions", f"查阅可用能力（{len(available_actions)} 项）", "running"),
            ],
        )
        response = _consult_sop_response(
            instruction=instruction,
            draft=draft,
            graph=current_graph if isinstance(current_graph, dict) else {},
            catalog=catalog,
            user=user,
        )
        body = response.data if hasattr(response, "data") else {}
        assistant = str((body or {}).get("assistant") or "")
        for index in range(0, len(assistant), 48):
            events.put(("assistant_delta", {"delta": assistant[index:index + 48]}))
        events.put(("done", body))
        return

    def on_delta(chunk: str):
        if chunk:
            events.put(("assistant_delta", {"delta": chunk}))

    def soft_fallback(reason: str = ""):
        payload = _fallback_rewrite(instruction, draft, target_node_keys=target_keys)
        tools = list(payload.get("tools") or [])
        tools.insert(0, _tool_step("read_graph", f"读取当前流程（{node_count} 步）"))
        if reason:
            tools.insert(1, _tool_step("llm_rewrite", reason, "failed"))
        draft_out = payload.get("draft") if isinstance(payload.get("draft"), dict) else draft
        graph = _finalize_graph_for_stream(
            draft_out.get("graph") or current_graph,
            available_assets=available_assets,
            available_actions=available_actions,
            instruction=instruction,
            draft_action=str(draft.get("actionName") or ""),
        )
        draft_out = {**draft_out, "graph": graph}
        if not draft_out.get("actionName"):
            draft_out["actionName"] = _pick_action_name(instruction, fallback=str(draft.get("actionName") or ""), actions=available_actions)
        payload["draft"] = draft_out
        payload["tools"] = [
            *tools,
            _tool_step("bind_assets", f"绑定企业数据 {len(available_assets)} 项可选"),
            _tool_step("bind_actions", f"绑定业务能力 {len(available_actions)} 项可选"),
        ]
        payload["scope"] = edit_scope
        if target_keys:
            payload["targetNodeKeys"] = target_keys
        return payload

    if not llm.llm_available(user):
        events.put(("done", soft_fallback("模型未配置，改用本地编排工具")))
        return

    if edit_scope in {"node", "nodes"}:
        target_nodes = [
            node for node in (current_graph.get("nodes") or [])
            if str(node.get("key") or "") in set(target_keys)
        ]
        tools = [
            _tool_step("read_graph", f"读取选中步骤（{len(target_keys)}）", "ok"),
            _tool_step("rewrite_nodes", "调用模型修改选中步骤", "running"),
        ]
        _stream_status(events, message="正在读取选中步骤并调用模型…", tools=tools)
        system = """你是企业 SOP 步骤编辑器。用户已选中一个或多个流程步骤，你只能修改这些步骤，禁止改动未选中步骤或整图结构。
只返回一个 JSON 对象，禁止 Markdown。字段：
- assistant：简短中文，说明改了哪些步骤
- nodes：数组，每项 { key, type, title, config }，key 必须属于选中步骤
- 若只改一步，也可返回 node：{ key, type, title, config }
- edgesFromNode（仅单步时可选）：该步骤出边 [{target, condition, priority}]
节点 type 仅允许 collect_info、data_bind、knowledge_query、checkpoint、execute_action、gate、handoff、end。"""
        payload_text = json.dumps({
            "instruction": instruction,
            "targetNodeKeys": target_keys,
            "targetNodes": target_nodes,
            "sopName": draft.get("name"),
            "actionName": draft.get("actionName"),
            "availableActions": available_actions,
            "availableAssets": available_assets[:40],
        }, ensure_ascii=False)
        result = llm.chat_messages_result(
            system,
            [{"role": "user", "content": _user_message_content(payload_text, images)}],
            temperature=0.15,
            max_tokens=2200,
            timeout=120,
            llm_user=user,
            allow_images=bool(images),
            on_delta=on_delta,
        )
        if not result.get("content"):
            events.put(("done", soft_fallback(str(result.get("error") or "模型未返回内容，改用本地工具"))))
            return
        try:
            generated = _extract_json_object(str(result["content"]))
            graph = _finalize_graph_for_stream(
                _merge_targeted_nodes(draft, generated, target_keys),
                available_assets=available_assets,
                available_actions=available_actions,
                instruction=instruction,
                draft_action=str(draft.get("actionName") or ""),
            )
            tools.append(_tool_step("validate_graph", "合并并校验选中步骤"))
            tools.append(_tool_step("bind_assets", "补齐企业数据与业务能力绑定"))
        except (ValueError, json.JSONDecodeError):
            events.put(("done", soft_fallback("模型返回无法合并，改用本地工具")))
            return
        revised = {
            "key": str(draft.get("key") or ""),
            "version": str(draft.get("version") or "1.0.0"),
            "name": str(draft.get("name") or "新建 SOP")[:128],
            "businessDomain": str(draft.get("businessDomain") or "")[:64],
            "description": str(draft.get("description") or "")[:500],
            "actionName": str(draft.get("actionName") or "")[:96],
            "triggerIntents": list(draft.get("triggerIntents") or [])[:30],
            "utteranceExamples": list(draft.get("utteranceExamples") or [])[:30],
            "graph": graph,
        }
        body = {
            "assistant": str(generated.get("assistant") or "已更新所选步骤。")[:1200],
            "draft": revised,
            "model": result.get("model") or "",
            "scope": edit_scope,
            "targetNodeKeys": target_keys,
            "tools": tools,
        }
        events.put(("done", body))
        return

    tools = [
        _tool_step("read_graph", f"读取当前流程（{node_count} 步）", "ok"),
        _tool_step("rewrite_flow", "调用模型生成/修改整条流程", "running"),
    ]
    _stream_status(events, message="正在读取当前流程并准备整条改写…", tools=tools)
    system = """你是企业 SOP 流程设计师（流程型技能 / SkillCard）。根据用户指令修改当前 SOP 草稿，只返回一个 JSON 对象，禁止 Markdown。
返回字段必须为 assistant、key、name、businessDomain、description、actionName、triggerIntents、utteranceExamples、graph。
若用户要求删除/移除/跳过/精简某节点（尤其人工确认），必须从 graph.nodes 与 edges 中真正删除，禁止只改连线却保留旧节点；assistant 描述必须与最终 graph 一致。"""
    compact_history = [
        {"role": str(item.get("role") or "user"), "content": str(item.get("content") or "")[:1000]}
        for item in history[-8:] if isinstance(item, dict)
    ]
    messages = [
        *compact_history,
        {
            "role": "user",
            "content": _user_message_content(
                json.dumps({
                    "instruction": instruction,
                    "currentDraft": draft,
                    "availableActions": available_actions,
                    "availableAssets": available_assets[:40],
                }, ensure_ascii=False),
                images,
            ),
        },
    ]
    _stream_status(events, message="模型正在改写整条流程…", tools=tools)
    result = llm.chat_messages_result(
        system,
        messages,
        temperature=0.15,
        max_tokens=3000,
        timeout=150,
        llm_user=user,
        allow_images=bool(images),
        on_delta=on_delta,
    )
    if not result.get("content"):
        events.put(("done", soft_fallback(str(result.get("error") or "模型未返回内容，改用本地编排工具"))))
        return
    try:
        generated = _extract_json_object(str(result["content"]))
        if generated.get("changed") is False:
            body = {
                "assistant": str(generated.get("assistant") or "这是说明，未修改流程。")[:1200],
                "draft": draft,
                "model": result.get("model") or "",
                "scope": "consult",
                "changed": False,
                "tools": [
                    _tool_step("read_graph", f"读取当前流程（{node_count} 步）"),
                    _tool_step("answer", "回答咨询，不修改流程"),
                ],
            }
            events.put(("done", body))
            return
        _stream_status(
            events,
            message="模型已返回草稿，正在校验结构并补齐绑定…",
            tools=[
                _tool_step("read_graph", f"读取当前流程（{node_count} 步）", "ok"),
                _tool_step("rewrite_flow", "调用模型生成/修改整条流程", "ok"),
                _tool_step("validate_graph", "合并节点并补齐连线", "running"),
            ],
        )
        graph = _finalize_graph_for_stream(
            _merge_flow_graph(
                current_graph,
                generated.get("graph") or current_graph,
                instruction,
                fallback_action=str(draft.get("actionName") or ""),
            ),
            available_assets=available_assets,
            available_actions=available_actions,
            instruction=instruction,
            draft_action=str(draft.get("actionName") or ""),
        )
        tools.append(_tool_step("validate_graph", "合并节点并补齐连线"))
        tools.append(_tool_step("bind_assets", "补齐企业数据与业务能力绑定"))
    except (ValueError, json.JSONDecodeError):
        tools.append(_tool_step("repair_json", "修复模型返回的流程 JSON"))
        _stream_status(events, message="模型返回结构不完整，正在自动修复…", tools=tools)
        repair = llm.chat_messages_result(
            "修复下面的 SOP JSON。只返回语法正确的完整 JSON 对象，不要 Markdown，不要解释，不要改变业务含义。",
            [{"role": "user", "content": str(result["content"])[:12000]}],
            temperature=0,
            max_tokens=3500,
            timeout=60,
            llm_user=user,
            allow_images=False,
        )
        try:
            generated = _extract_json_object(str(repair.get("content") or ""))
            graph = _finalize_graph_for_stream(
                _merge_flow_graph(
                    current_graph,
                    generated.get("graph") or current_graph,
                    instruction,
                    fallback_action=str(draft.get("actionName") or ""),
                ),
                available_assets=available_assets,
                available_actions=available_actions,
                instruction=instruction,
                draft_action=str(draft.get("actionName") or ""),
            )
            tools.append(_tool_step("validate_graph", "合并修复后的流程并补齐连线"))
            tools.append(_tool_step("bind_assets", "补齐企业数据与业务能力绑定"))
        except (ValueError, json.JSONDecodeError):
            events.put(("done", soft_fallback("模型返回结构不完整，改用本地编排工具")))
            return
    action_name = str(generated.get("actionName") or draft.get("actionName") or "").strip()
    if action_name and not _known_action(action_name):
        action_name = str(draft.get("actionName") or "")
    if not action_name:
        action_name = _pick_action_name(instruction, fallback="", actions=available_actions)
    proposed_key = str(draft.get("key") or generated.get("key") or "").strip()
    if proposed_key and not re.fullmatch(r"[a-z][a-z0-9_.-]{1,95}", proposed_key):
        proposed_key = ""
    revised = {
        "key": proposed_key,
        "version": str(draft.get("version") or "1.0.0"),
        "name": str(generated.get("name") or draft.get("name") or "新建 SOP")[:128],
        "businessDomain": str(generated.get("businessDomain") or draft.get("businessDomain") or "")[:64],
        "description": str(generated.get("description") or draft.get("description") or "")[:500],
        "actionName": action_name[:96],
        "triggerIntents": list(generated.get("triggerIntents") or draft.get("triggerIntents") or [])[:30],
        "utteranceExamples": list(generated.get("utteranceExamples") or draft.get("utteranceExamples") or [])[:30],
        "graph": graph,
    }
    tools.append(_tool_step("apply_draft", f"写入流程（{len(graph.get('nodes') or [])} 步）"))
    body = {
        "assistant": str(generated.get("assistant") or "已更新 SOP 流程草稿，并尽量绑定企业数据与业务能力。")[:1200],
        "draft": revised,
        "model": result.get("model") or "",
        "scope": "flow",
        "changed": True,
        "tools": tools,
    }
    events.put(("done", body))


@api_view(["POST"])
@renderer_classes([EventStreamRenderer])
@permission_classes([IsAuthenticated])
def sop_ai_rewrite_stream(request):
    organization = ensure_current_organization(request.user)
    if not isinstance(request.data, dict):
        return Response({"error": "请求体格式错误。"}, status=400)
    payload = dict(request.data)
    events: queue.Queue = queue.Queue()
    user_id = request.user.id
    org_id = organization.id

    def worker():
        close_old_connections()
        try:
            from django.contrib.auth import get_user_model
            from apps.core.models import Organization

            user = get_user_model().objects.get(id=user_id)
            org = Organization.objects.get(id=org_id)
            _run_rewrite_stream(payload, user=user, organization=org, events=events)
        except Exception as exc:  # noqa: BLE001
            events.put(("error", {"error": str(exc) or "SOP 改写失败"}))
        finally:
            close_old_connections()

    threading.Thread(target=worker, daemon=True).start()

    def event_stream():
        yield _sse("hello", {"message": "rewrite_stream_ready"})
        idle_ticks = 0
        while True:
            try:
                kind, payload = events.get(timeout=1.2)
            except queue.Empty:
                idle_ticks += 1
                yield _sse("heartbeat", {"message": "正在处理，请稍候…", "tick": idle_ticks})
                continue
            idle_ticks = 0
            if kind == "status":
                yield _sse("status", payload if isinstance(payload, dict) else {})
            elif kind == "assistant_delta":
                yield _sse("assistant_delta", payload if isinstance(payload, dict) else {})
            elif kind == "done":
                yield _sse("done", payload if isinstance(payload, dict) else {})
                break
            elif kind == "error":
                yield _sse("error", payload if isinstance(payload, dict) else {"error": "SOP 改写失败"})
                break

    response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
    response["Cache-Control"] = "no-cache"
    response["X-Accel-Buffering"] = "no"
    return response
