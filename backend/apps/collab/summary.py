"""单聊/群聊智能纪要：选取上下文、判断提醒时机、生成结构化总结。"""
from __future__ import annotations

import json
import re
from datetime import timedelta

from django.utils import timezone

from apps.council import llm

from .models import CollabMessage, CollabRoom, CollabSummary


SUMMARY_MIN_MESSAGES = 4
SUMMARY_REMIND_MESSAGES = 8
SUMMARY_MAX_MESSAGES = 80
TOPIC_GAP = timedelta(minutes=30)


def _normal_messages(room: CollabRoom):
    return (
        room.messages.select_related("sender", "reply_to", "reply_to__sender")
        .exclude(status__in=["deleted", "recalled"])
        .exclude(msg_type="system")
        .order_by("id")
    )


def summary_payload(row: CollabSummary | None) -> dict | None:
    if row is None:
        return None
    start = row.start_message
    end = row.end_message
    return {
        "id": row.id,
        "room_id": str(row.room_id),
        "range_mode": row.range_mode,
        "start_message_id": row.start_message_id,
        "end_message_id": row.end_message_id,
        "start_at": start.created_at.isoformat() if start else None,
        "end_at": end.created_at.isoformat() if end else None,
        "message_count": row.message_count,
        "selection_reason": row.selection_reason,
        "content": row.content,
        "key_points": row.key_points or [],
        "decisions": row.decisions or [],
        "action_items": row.action_items or [],
        "participants": row.participants or [],
        "generated_by": row.generated_by,
        "model_name": row.model_name,
        "model_source": row.model_source,
        "created_by": row.created_by.username,
        "created_at": row.created_at.isoformat(),
    }


def summary_model_status(user=None) -> dict:
    """供聊天侧边栏展示当前总结会使用的有效模型。"""
    return llm.credential_status(user)


def summary_suggestion(room: CollabRoom) -> dict:
    latest = room.summaries.select_related("end_message").order_by("-id").first()
    qs = _normal_messages(room)
    if latest and latest.end_message_id:
        qs = qs.filter(id__gt=latest.end_message_id)
    pending = list(qs.values("id", "created_at")[: SUMMARY_MAX_MESSAGES + 1])
    pending_count = len(pending)
    total_count = _normal_messages(room).count()
    span_minutes = 0
    if len(pending) >= 2:
        span_minutes = max(
            0,
            int(
                (
                    pending[-1]["created_at"] - pending[0]["created_at"]
                ).total_seconds() // 60
            ),
        )

    should = (
        pending_count >= SUMMARY_REMIND_MESSAGES
        or (pending_count >= SUMMARY_MIN_MESSAGES and span_minutes >= 15)
        or (latest is None and total_count >= 12)
    )
    if pending_count < SUMMARY_MIN_MESSAGES:
        reason = "再聊几条后，我会自动判断是否需要收拢要点"
    elif should and latest:
        reason = f"上次总结后新增 {pending_count} 条消息，建议更新纪要"
    elif should:
        reason = f"当前讨论已有 {total_count} 条有效消息，建议生成首份纪要"
    else:
        reason = f"已有 {pending_count} 条新消息，可随时手动总结"

    return {
        "should_summarize": should,
        "reason": reason,
        "pending_message_count": pending_count,
        "span_minutes": span_minutes,
        "suggested_range": "auto",
        "last_summary_message_id": latest.end_message_id if latest else None,
    }


def select_summary_messages(
    room: CollabRoom,
    *,
    range_mode: str = "auto",
    message_count: int = 20,
    minutes: int = 60,
    start_message_id: int | None = None,
    end_message_id: int | None = None,
) -> tuple[list[CollabMessage], str, str]:
    range_mode = range_mode if range_mode in {"auto", "latest", "time", "custom"} else "auto"
    qs = _normal_messages(room)

    if range_mode == "custom":
        if start_message_id:
            qs = qs.filter(id__gte=start_message_id)
        if end_message_id:
            qs = qs.filter(id__lte=end_message_id)
        rows = list(qs[:SUMMARY_MAX_MESSAGES])
        reason = "按你指定的起止消息总结"
        return rows, reason, range_mode

    if range_mode == "time":
        minutes = max(5, min(int(minutes or 60), 24 * 60))
        rows = list(qs.filter(created_at__gte=timezone.now() - timedelta(minutes=minutes)))
        rows = rows[-SUMMARY_MAX_MESSAGES:]
        reason = f"选取最近 {minutes} 分钟的有效对话"
        return rows, reason, range_mode

    if range_mode == "latest":
        message_count = max(5, min(int(message_count or 20), SUMMARY_MAX_MESSAGES))
        rows = list(qs.order_by("-id")[:message_count])
        rows.reverse()
        reason = f"选取最近 {len(rows)} 条有效对话"
        return rows, reason, range_mode

    latest = room.summaries.select_related("end_message").order_by("-id").first()
    candidates = list(qs.order_by("-id")[:SUMMARY_MAX_MESSAGES])
    candidates.reverse()
    if latest and latest.end_message_id:
        new_rows = [row for row in candidates if row.id > latest.end_message_id]
        if len(new_rows) >= SUMMARY_MIN_MESSAGES:
            candidates = new_rows

    # 长时间间隔通常意味着话题已切换；优先总结最新连续讨论段。
    segment: list[CollabMessage] = []
    for row in candidates:
        if segment and row.created_at - segment[-1].created_at >= TOPIC_GAP:
            segment = []
        segment.append(row)
    if len(segment) >= SUMMARY_MIN_MESSAGES:
        rows = segment[-SUMMARY_MAX_MESSAGES:]
        reason = f"智能识别最近一段连续讨论，共 {len(rows)} 条消息"
    else:
        rows = candidates[-20:]
        reason = f"当前连续讨论较短，向前补足上下文至 {len(rows)} 条消息"
    return rows, reason, "auto"


def _unique(items: list[str], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        text = re.sub(r"\s+", " ", str(item or "").strip()).strip("·- ")
        key = text.lower()
        if not text or key in seen:
            continue
        seen.add(key)
        out.append(text[:160])
        if len(out) >= limit:
            break
    return out


def _participants(rows: list[CollabMessage]) -> list[str]:
    participants: list[str] = []
    for row in rows:
        name = getattr(row.sender, "username", "") or "成员"
        if name not in participants:
            participants.append(name)
    return participants


def _parse_llm_json(raw: str) -> dict | None:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        # 兼容部分模型在 JSON 前后附带一句说明。
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    return data if isinstance(data, dict) else None


class SummaryLLMError(RuntimeError):
    """已配置模型调用失败或返回不可用结果。"""


class SummaryLLMConfigurationError(SummaryLLMError):
    """当前用户和平台都没有完整的模型配置。"""


def generate_summary(rows: list[CollabMessage], *, llm_user=None) -> dict:
    transcript = "\n".join(
        f"[#{row.id}] {row.sender.username}：{(row.content or '[附件]').strip()[:800]}"
        for row in rows
    )
    system = (
        "你是企业聊天纪要助手。只总结给定发言，不补造事实。"
        "输出严格 JSON：content(120字内总览)、key_points(最多6条)、"
        "decisions(最多4条)、action_items(最多5条)。中文简洁；没有明确结论时要直说。"
    )
    result = llm.chat_messages_result(
        system,
        [{"role": "user", "content": transcript}],
        temperature=0.2,
        max_tokens=700,
        timeout=30,
        llm_user=llm_user,
    )
    if not result.get("configured"):
        raise SummaryLLMConfigurationError(
            "未配置可用的 LLM。请在右上角头像 → 个人信息 → 模型密钥中配置 API Key、Base URL 和模型。"
        )
    if result.get("error") or not result.get("content"):
        detail = str(result.get("error") or "模型返回空内容").strip()[:320]
        raise SummaryLLMError(f"LLM 总结失败：{detail}")

    parsed = _parse_llm_json(result.get("content") or "")
    if not parsed:
        raise SummaryLLMError("LLM 返回格式异常，未生成纪要。请重试或检查当前模型是否支持 JSON 输出。")
    content = str(parsed.get("content") or "").strip()[:1200]
    key_points = _unique(parsed.get("key_points") or [], 6)
    decisions = _unique(parsed.get("decisions") or [], 4)
    actions = _unique(parsed.get("action_items") or [], 5)
    if not content or not key_points:
        raise SummaryLLMError("LLM 返回的纪要缺少总览或关键要点，请重试。")

    status = summary_model_status(llm_user)
    source = (
        "platform_fallback"
        if result.get("credential_fallback") == "global"
        else status["source"]
    )
    return {
        "content": content,
        "key_points": key_points,
        "decisions": decisions,
        "action_items": actions,
        "participants": _participants(rows),
        "generated_by": "llm",
        "model_name": str(result.get("model") or status["model"] or "").strip()[:128],
        "model_source": source,
    }


def create_summary(
    room: CollabRoom,
    *,
    user,
    range_mode: str = "auto",
    message_count: int = 20,
    minutes: int = 60,
    start_message_id: int | None = None,
    end_message_id: int | None = None,
) -> CollabSummary:
    rows, reason, normalized_mode = select_summary_messages(
        room,
        range_mode=range_mode,
        message_count=message_count,
        minutes=minutes,
        start_message_id=start_message_id,
        end_message_id=end_message_id,
    )
    if len(rows) < 1:
        raise ValueError("当前没有可总结的有效消息")
    generated = generate_summary(rows, llm_user=user)
    row = CollabSummary.objects.create(
        room=room,
        created_by=user,
        range_mode=normalized_mode,
        start_message=rows[0],
        end_message=rows[-1],
        message_count=len(rows),
        selection_reason=reason,
        content=generated["content"],
        key_points=generated["key_points"],
        decisions=generated["decisions"],
        action_items=generated["action_items"],
        participants=generated["participants"],
        generated_by=generated["generated_by"],
        model_name=generated["model_name"],
        model_source=generated["model_source"],
    )
    room.summary = row.content
    room.save(update_fields=["summary", "updated_at"])
    return row
