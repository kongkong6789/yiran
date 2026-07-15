"""风控洞察满足条件时，节流插入聊天：警告（interject）或协作建议（suggest）。"""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from .mentions import get_collab_ai_user
from .models import CollabInsight, CollabMessage, CollabRoom


def _should_interject(insight: CollabInsight) -> bool:
    """仅黄/红风险主动插嘴；普通问答必须 @AI，不因「怎么做/建议」进群。"""
    level = (insight.risk_level or "green").lower()
    return level in ("yellow", "red")


def _is_collab_suggest(insight: CollabInsight) -> bool:
    # 已取消绿色「协作建议」主动发言；保留函数兼容旧消息展示
    return False


def _cooldown_ok(room: CollabRoom, *, risk_level: str = "yellow", suggest: bool = False) -> bool:
    """
    相对上次主动发言冷却（含 suggest / interject），不受 @AI 应答影响。
    红：约 45 秒；绿协作建议：约 55 秒；其余：约 90 秒。
    """
    last = (
        CollabMessage.objects.filter(room=room, msg_type="ai", ai_kind__in=["interject", "suggest"])
        .order_by("-id")
        .first()
    )
    if not last:
        return True
    level = (risk_level or "yellow").lower()
    if level == "red":
        need_sec = 45
    elif suggest or level == "green":
        need_sec = 55
    else:
        need_sec = 90
    if last.created_at > timezone.now() - timedelta(seconds=need_sec):
        return False
    user_after = CollabMessage.objects.filter(
        room=room, msg_type="user", id__gt=last.id,
    ).count()
    return user_after >= 1


def build_interject_text(insight: CollabInsight) -> str:
    level = (insight.risk_level or "green").lower()
    if _is_collab_suggest(insight):
        head = "【协作建议】"
        title = (insight.title or "").strip()
        if title and any(
            k in title for k in ("警告", "风险", "监控", "暴力", "伤害", "威胁", "恐吓", "违规")
        ):
            title = "结合当前讨论"
        parts = [f"{head}{title or '结合当前讨论'}"]
        body = (insight.advice or insight.analysis or "").strip()
        # 流程图 mermaid 需要更长，勿截断成半截
        limit = 2200 if "```mermaid" in body.lower() else 700
        if body:
            parts.append(body[:limit])
        return "\n".join(p for p in parts if p.strip())[:2800]

    if level == "red":
        head = "【风险警告】"
    elif level == "yellow":
        head = "【监控提醒】"
    else:
        head = "【监控建议】"
    title = (insight.title or "").strip()
    parts = [f"{head}{title}"] if title else [head]
    if insight.advice:
        parts.append(insight.advice.strip()[:400])
    elif insight.analysis:
        parts.append(insight.analysis.strip()[:320])
    if insight.control and level in ("yellow", "red"):
        parts.append(f"管控：{insight.control.strip()[:160]}")
    if insight.draft_reply:
        parts.append(f"可参考口径：{insight.draft_reply.strip()[:200]}")
    return "\n".join(parts)[:1800]


def maybe_interject(room: CollabRoom, insight: CollabInsight | None) -> CollabMessage | None:
    if not insight or not getattr(room, "interject_enabled", True):
        return None
    if not _should_interject(insight):
        return None
    suggest = _is_collab_suggest(insight)
    if not _cooldown_ok(
        room,
        risk_level=insight.risk_level or "yellow",
        suggest=suggest,
    ):
        return None
    text = build_interject_text(insight)
    if not text.strip():
        return None
    ai_user = get_collab_ai_user()
    msg = CollabMessage.objects.create(
        room=room,
        sender=ai_user,
        content=text,
        attachments=[],
        mentions=[],
        msg_type="ai",
        ai_kind="suggest" if suggest else "interject",
    )
    room.save(update_fields=["updated_at"])
    return msg
