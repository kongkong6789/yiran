"""记忆加载与轻量更新。"""
from __future__ import annotations

import re
from dataclasses import dataclass

from django.db.models import Q
from django.utils import timezone

from .models import AgentMemoryItem, AgentSessionSummary

MAX_USER_MEMORIES = 12
MAX_SESSION_MEMORIES = 6
SUMMARY_MSG_THRESHOLD = 20
FACT_MAX_LEN = 120
SUMMARY_MAX_LEN = 800

_PREF_RE = re.compile(
    r"(?:请|希望|想要|偏好|以后|总是|不要|别)(.{2,40}?)(?:[。！？\n]|$)",
    re.UNICODE,
)
_FACT_RE = re.compile(
    r"(?:我是|我叫|我们是|公司是|品牌是|负责)(.{2,40}?)(?:[。！？\n]|$)",
    re.UNICODE,
)


@dataclass
class MemoryBundle:
    memory_block: str
    summary_block: str
    items: list[AgentMemoryItem]
    summary: AgentSessionSummary | None


def load_memory(user, session_key: str | None = None) -> MemoryBundle:
    if user is None:
        return MemoryBundle("", "", [], None)

    now = timezone.now()
    qs = AgentMemoryItem.objects.filter(user=user).filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=now)
    )
    user_items = list(
        qs.filter(scope=AgentMemoryItem.Scope.USER)
        .exclude(kind=AgentMemoryItem.Kind.SUMMARY)
        .order_by("-importance", "-updated_at")[:MAX_USER_MEMORIES]
    )
    session_items: list[AgentMemoryItem] = []
    summary_obj: AgentSessionSummary | None = None
    if session_key:
        sess_qs = qs.filter(scope=AgentMemoryItem.Scope.SESSION).exclude(
            kind=AgentMemoryItem.Kind.SUMMARY
        )
        if _looks_uuid(session_key):
            sess_qs = sess_qs.filter(Q(session_id=session_key) | Q(source=session_key))
        else:
            sess_qs = sess_qs.filter(source=session_key)
        session_items = list(
            sess_qs.order_by("-importance", "-updated_at")[:MAX_SESSION_MEMORIES]
        )
        summary_obj = AgentSessionSummary.objects.filter(
            user=user, session_key=session_key
        ).first()

    lines: list[str] = []
    for item in user_items:
        lines.append(f"- [{item.kind}] {item.content.strip()}")
    for item in session_items:
        lines.append(f"- [session/{item.kind}] {item.content.strip()}")
    memory_block = ""
    if lines:
        memory_block = "【用户记忆】\n" + "\n".join(lines[:MAX_USER_MEMORIES + MAX_SESSION_MEMORIES])

    summary_block = ""
    if summary_obj and (summary_obj.summary or "").strip():
        summary_block = f"【会话摘要】\n{summary_obj.summary.strip()}"

    return MemoryBundle(memory_block, summary_block, user_items + session_items, summary_obj)


def _looks_uuid(value: str) -> bool:
    if not value or len(value) < 32:
        return False
    try:
        import uuid

        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def _heuristic_compress(previous: str, recent_msgs: list[str]) -> str:
    points: list[str] = []
    for m in recent_msgs[-6:]:
        first = (m or "").split("。")[0].strip()
        if first:
            points.append("· " + first[:40])
    merged = ((previous + "\n") if previous else "") + "\n".join(points)
    return merged[-SUMMARY_MAX_LEN:]


def _extract_facts(user_msg: str, reply: str) -> list[tuple[str, str]]:
    """返回 (kind, content) 列表，最多 2 条。"""
    text = f"{user_msg or ''}\n{reply or ''}"
    out: list[tuple[str, str]] = []
    for m in _PREF_RE.finditer(user_msg or ""):
        chunk = m.group(0).strip()[:FACT_MAX_LEN]
        if len(chunk) >= 4:
            out.append((AgentMemoryItem.Kind.PREFERENCE, chunk))
        if len(out) >= 2:
            return out
    for m in _FACT_RE.finditer(text):
        chunk = m.group(0).strip()[:FACT_MAX_LEN]
        if len(chunk) >= 4:
            out.append((AgentMemoryItem.Kind.FACT, chunk))
        if len(out) >= 2:
            break
    return out[:2]


def maybe_update_memory(
    user,
    *,
    session_key: str | None,
    message: str,
    reply: str,
    history: list[dict] | None = None,
) -> None:
    if user is None:
        return
    history = history or []

    # 抽取短事实 / 偏好
    for kind, content in _extract_facts(message, reply):
        exists = AgentMemoryItem.objects.filter(
            user=user,
            scope=AgentMemoryItem.Scope.USER,
            content=content,
        ).exists()
        if exists:
            continue
        AgentMemoryItem.objects.create(
            user=user,
            scope=AgentMemoryItem.Scope.USER,
            kind=kind,
            content=content,
            source=session_key or "chat",
            importance=6 if kind == AgentMemoryItem.Kind.PREFERENCE else 5,
        )

    # 裁剪用户级记忆
    ids = list(
        AgentMemoryItem.objects.filter(
            user=user, scope=AgentMemoryItem.Scope.USER
        )
        .order_by("-importance", "-updated_at")
        .values_list("id", flat=True)[MAX_USER_MEMORIES * 2 :]
    )
    if ids:
        AgentMemoryItem.objects.filter(id__in=ids).delete()

    if not session_key:
        return

    msg_count = len(history) + 2  # 本轮 user + assistant
    summary_obj, _ = AgentSessionSummary.objects.get_or_create(
        user=user,
        session_key=session_key,
        defaults={"summary": "", "message_count": 0},
    )
    summary_obj.message_count = max(summary_obj.message_count, msg_count)
    if summary_obj.message_count >= SUMMARY_MSG_THRESHOLD or msg_count >= 8:
        recent = [
            str(item.get("content") or "")
            for item in history[-8:]
            if isinstance(item, dict) and item.get("content")
        ]
        recent.append(f"用户: {(message or '')[:200]}")
        recent.append(f"助手: {(reply or '')[:200]}")
        summary_obj.summary = _heuristic_compress(summary_obj.summary, recent)
    summary_obj.save(update_fields=["summary", "message_count", "updated_at"])
