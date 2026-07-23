from .sop_runtime import build_trial_payload, execute_sop_version
from django.db import close_old_connections
from django.http import StreamingHttpResponse
from rest_framework.decorators import renderer_classes
from rest_framework.renderers import BaseRenderer, JSONRenderer

import queue
import threading


class EventStreamRenderer(BaseRenderer):
    media_type = "text/event-stream"
    format = "event-stream"
    charset = None

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n".encode("utf-8")


def _trial_response_body(sop: SopDefinition, row: SopVersion, result: dict) -> dict:
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
    user_message = str(payload_result.get("user_message") or "").strip()
    evidence = payload_result.get("evidence") if isinstance(payload_result.get("evidence"), dict) else {}
    external_write = bool(payload_result.get("external_write_performed"))
    artifacts = []
    if report_markdown:
        artifacts.append({
            "id": "report_markdown",
            "kind": "markdown",
            "title": "经营分析报告",
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
        push_body = ""
        if preview:
            push_body = (
                f"渠道：{preview.get('destination_label') or preview.get('destination')}\n"
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
        assistant += " 这是编辑器试跑：使用演示参数走完全流程，不会真实推送给外部用户。"
        if artifacts:
            assistant += f" 已生成 {len(artifacts)} 个可查看产物，请点「查看结果」。"
        else:
            assistant += " 本次未产出可下载报告（可能该流程未调用报告生成能力）。"
    elif decision == "need_input":
        missing = result.get("missing") or []
        if missing:
            assistant += f" 还需：{', '.join(str(item) for item in missing[:8])}。"
    return {
        "assistant": assistant[:1200],
        "tools": tools,
        "result": result,
        "artifacts": artifacts,
        "trialMeta": {
            "mode": "dry_run",
            "externalWritePerformed": external_write,
            "pushedToUser": False,
            "note": "试跑不会真实推送企业微信或其他用户；节点文案里的「推送给用户」仅表示正式运行时的业务意图。",
        },
        "model": "trial-runtime",
    }