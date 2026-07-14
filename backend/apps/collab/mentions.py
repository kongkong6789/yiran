"""协作聊天 @提及 解析与 @AI 应答。"""
from __future__ import annotations

import logging
import re
from typing import Any

from django.contrib.auth import get_user_model

from apps.council import llm

User = get_user_model()
logger = logging.getLogger(__name__)

AI_USERNAMES = ("良策AI", "AI助手")
AI_ALIASES = {"ai", "AI", "Ai", "良策ai", "良策AI", "助手"}
ALL_ALIASES = {"所有人", "全体", "全体成员", "everyone", "all", "ALL"}

_TOKEN_RE = re.compile(r"@([^\s@]+)")
_MENTION_TARGET_RE = re.compile(
    r"@(?:AI|ai|良策AI|良策ai)\s*.*?@([^\s@]+)|@([^\s@]+)\s*.*?@(?:AI|ai|良策AI|良策ai)"
)


def get_collab_ai_user():
    """专用 AI 发言账号（不加入群成员列表）。"""
    user, created = User.objects.get_or_create(
        username="良策AI",
        defaults={
            "is_active": True,
            "is_staff": False,
            "is_superuser": False,
        },
    )
    if created:
        user.set_unusable_password()
        user.save(update_fields=["password"])
    return user


def parse_mentions(content: str, member_usernames: list[str] | None = None) -> list[dict[str, Any]]:
    """从文本解析 @提及。返回 [{type, key, label}]。"""
    text = content or ""
    if "@" not in text:
        return []

    members = sorted({*(member_usernames or [])}, key=len, reverse=True)
    member_lower = {m.lower(): m for m in members}
    found: list[dict[str, Any]] = []
    seen: set[str] = set()

    for match in _TOKEN_RE.finditer(text):
        raw = match.group(1)
        key = None
        label = raw
        mtype = "user"

        if raw in ALL_ALIASES or raw.lower() in {a.lower() for a in ALL_ALIASES}:
            key = "all"
            label = "所有人"
            mtype = "all"
        elif raw in AI_ALIASES or raw.lower() in {a.lower() for a in AI_ALIASES}:
            key = "ai"
            label = "AI"
            mtype = "ai"
        else:
            hit = member_lower.get(raw.lower())
            if not hit:
                for name in members:
                    if name.lower() == raw.lower() or name == raw:
                        hit = name
                        break
            if hit:
                key = hit
                label = hit
                mtype = "user"
            else:
                continue

        sid = f"{mtype}:{key}"
        if sid in seen:
            continue
        seen.add(sid)
        found.append({"type": mtype, "key": key, "label": label})

    return found


def has_ai_mention(mentions: list[dict] | None) -> bool:
    return any((m or {}).get("type") == "ai" for m in (mentions or []))


def has_all_mention(mentions: list[dict] | None) -> bool:
    return any((m or {}).get("type") == "all" for m in (mentions or []))


def _mentioned_users(mentions: list[dict] | None, trigger_content: str) -> list[str]:
    names = [m["label"] for m in (mentions or []) if m.get("type") == "user"]
    if names:
        return names
    m = _MENTION_TARGET_RE.search(trigger_content or "")
    if m:
        return [m.group(1) or m.group(2)]
    return []


def _local_person_analysis(target: str, transcript: list[dict], question: str) -> str:
    """无可用模型时，基于会话原文做可读分析，避免空话。"""
    quotes = []
    for m in transcript:
        who = m.get("username") or ""
        text = (m.get("content") or "").strip()
        if not text or m.get("msg_type") in ("ai", "system"):
            continue
        if who == target or target in text:
            quotes.append(f"「{who}：{text[:120]}」")
    quotes = quotes[-5:]
    q = question or f"分析 {target}"
    parts = [
        f"针对 @{target} 的临时分析（基于当前会话记录）：",
        f"1. 问题理解：{q[:100]}",
    ]
    if quotes:
        parts.append("2. 相关发言：\n- " + "\n- ".join(quotes))
        parts.append(
            "3. 初步判断：从现有聊天看，该成员已在群内互动；"
            "建议结合其表述意图、承诺口径与是否涉及敏感商务条款继续核实。"
        )
        parts.append("4. 建议：如需更深画像，请补充背景；模型通道恢复后可再次 @AI 做完整剖析。")
    else:
        parts.append(
            f"2. 当前会话里暂未找到 @{target} 的有效发言，信息不足以做人格/意图剖析。"
            "可让对方先发几句，或补充你掌握的背景后再 @AI。"
        )
    return "\n".join(parts)


def _local_fallback(trigger_content: str, transcript: list[dict], mentions: list[dict] | None, err: str) -> str:
    q = re.sub(r"@(AI|ai|良策AI|良策ai)\s*", "", trigger_content or "").strip()
    targets = _mentioned_users(mentions, trigger_content)
    analyze_intent = bool(re.search(r"剖析|分析|评价|看看|怎么样|何许人|画像", q or trigger_content or ""))

    if targets and analyze_intent:
        base = _local_person_analysis(targets[0], transcript, q)
        if err:
            base += f"\n\n（说明：模型调用未成功：{err[:120]}。以上为基于会话记录的降级分析。）"
        return base

    if q:
        tip = f"我已收到召唤。关于「{q[:80]}」："
    else:
        tip = "我在。"
    if err:
        return f"{tip}模型调用未成功（{err[:120]}）。请稍后重试，或把问题写得更具体一些。"
    return f"{tip}当前模型通道暂不可用，请稍后重试，或把问题写得更具体一些。"


def _call_llm(system: str, user: str, llm_user=None) -> dict:
    return llm.chat_messages_result(
        system,
        [{"role": "user", "content": user}],
        temperature=0.4,
        max_tokens=1000,
        timeout=90,
        llm_user=llm_user,
        allow_images=False,
    )


def reply_ai_mention(
    *,
    room_title: str,
    transcript: list[dict],
    trigger_content: str,
    llm_user=None,
    mentions: list[dict] | None = None,
) -> str:
    """被 @AI 时生成进群回复（进入聊天流，不是旁路洞察）。"""
    lines = []
    for m in transcript[-16:]:
        who = m.get("username") or "用户"
        if m.get("msg_type") == "ai":
            who = "良策AI"
        lines.append(f"{who}: {m.get('content') or ''}")
    history = "\n".join(lines) or "(暂无历史)"
    targets = _mentioned_users(mentions, trigger_content)
    focus = f"重点关注被点名的成员：{', '.join(targets)}。\n" if targets else ""

    system = (
        "你是「良策AI」，在企业协作会话中被成员 @ 召唤。"
        "请直接用中文回复聊天中的问题或请求，简洁专业、可执行。"
        "若被要求剖析/分析某人，请根据会话内容给出人物特征、表达意图、风险点与建议，"
        "不要拒绝，不要说自己只能做风控旁白。"
        "不要输出 JSON，不要说自己是旁路分析。"
    )
    user = (
        f"会话：{room_title or '协作会话'}\n"
        f"{focus}"
        f"最近对话：\n{history}\n\n"
        f"刚被 @AI 的消息：{trigger_content}\n"
        "请给出你的回复："
    )

    result = _call_llm(system, user, llm_user=llm_user)
    text = (result.get("content") or "").strip()
    err = (result.get("error") or "").strip()

    # 个人 Key 失败时回退全局 .env
    if not text and llm_user is not None:
        logger.warning("collab @AI personal llm failed: %s; retry global", err or "empty")
        result2 = _call_llm(system, user, llm_user=None)
        text = (result2.get("content") or "").strip()
        err = (result2.get("error") or err or "").strip()

    if text:
        return text[:4000]

    logger.warning("collab @AI llm unavailable: %s", err or "empty")
    return _local_fallback(trigger_content, transcript, mentions, err)[:4000]
