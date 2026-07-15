"""协作聊天 @提及 解析与 @AI 应答。"""
from __future__ import annotations

import logging
import re
from typing import Any

from django.contrib.auth import get_user_model

from apps.council import llm
from apps.skills.service import build_skill_system_block, resolve_skills
from apps.skills.runner import (
    diagnose_skill_execution,
    format_script_outputs,
    try_execute_skill_scripts,
)

User = get_user_model()
logger = logging.getLogger(__name__)

SKILL_EXEC_APPEND = """

Skill 脚本执行规则(必须遵守):
1. 若下方已注入【Skill 脚本执行结果】,表示平台已在后端执行过 python 脚本,禁止再让用户「自己去终端运行」相同命令。
2. 执行成功时,直接根据 stdout / json 内容给出结论、原因与建议。
3. 执行失败时,说明 stderr 错误及修复方式,不要假装已拿到数据。
4. 若仅有【Skill 执行状态】,按其中原因引导(重传 zip、补参数等),不要重复 Skill 原文的手工步骤清单。
"""

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


def _call_llm(system: str, user: str, llm_user=None, *, max_tokens: int = 1000) -> dict:
    return llm.chat_messages_result(
        system,
        [{"role": "user", "content": user}],
        temperature=0.4,
        max_tokens=max_tokens,
        timeout=120,
        llm_user=llm_user,
        allow_images=False,
    )


def collab_skill_hits(content: str, user) -> bool:
    """消息中是否 @ 了可用 Skill。"""
    if not user or not content:
        return False
    try:
        return bool(resolve_skills(content, user))
    except Exception:
        return False


def reply_ai_mention(
    *,
    room_title: str,
    transcript: list[dict],
    trigger_content: str,
    llm_user=None,
    mentions: list[dict] | None = None,
    interject_enabled: bool = True,
) -> str:
    """被 @AI 或 @skill 时生成进群回复（可执行 Skill 脚本）。"""
    lines = []
    for m in transcript[-16:]:
        who = m.get("username") or "用户"
        if m.get("msg_type") == "ai":
            who = "良策AI"
        lines.append(f"{who}: {m.get('content') or ''}")
    history = "\n".join(lines) or "(暂无历史)"
    targets = _mentioned_users(mentions, trigger_content)
    focus = f"重点关注被点名的成员：{', '.join(targets)}。\n" if targets else ""
    interject_state = "已开启" if interject_enabled else "已关闭（可在会话设置里打开）"

    # Skill：解析、执行脚本、注入上下文
    active_skills = []
    script_blocks: list = []
    script_output = ""
    skill_diag = ""
    if llm_user is not None:
        try:
            active_skills = resolve_skills(trigger_content, llm_user)
            if active_skills:
                history_for_skill = [
                    {
                        "role": "user" if (m.get("msg_type") or "user") == "user" else "assistant",
                        "content": m.get("content") or "",
                    }
                    for m in transcript[-20:]
                    if m.get("content")
                ]
                script_blocks = try_execute_skill_scripts(
                    active_skills,
                    trigger_content,
                    llm_user,
                    history=history_for_skill,
                )
                script_output = format_script_outputs(script_blocks) or ""
                skill_diag = diagnose_skill_execution(active_skills, trigger_content, script_blocks) or ""
        except Exception as exc:
            logger.exception("collab skill resolve/execute failed: %s", exc)
            skill_diag = f"Skill 执行异常：{exc}"

    skill_names = "、".join(s.name for s in active_skills) if active_skills else ""

    system = (
        "你是「良策AI」，在企业协作风控会话中被成员召唤。用中文直接回答，简洁专业、可执行。\n"
        "能力说明（必须按此回答，不要编造相反规则）：\n"
        "1) 召唤应答：有人 @AI，或消息中 @ 了 Skill 时，你会立刻在聊天里回复（本条就是）。\n"
        "2) Skill：用户可通过锤子按钮或 @skill-id 加载技能；平台可能已自动执行其中的 python 脚本，"
        "你必须按下方 Skill 说明与脚本结果处理任务，不要让用户去本地终端重跑。\n"
        "3) 监控插嘴：开关"
        f"为{interject_state}并过冷却时，仅黄/红风险会发【监控提醒/警告】；"
        "怎么做、方案、流程图等日常问答只在被 @AI 时回答，不会每条都插嘴。\n"
        "回答风格：怎么做要给步骤；剖析/分析某人给特征·意图·风险·建议；违法请求拒绝。\n"
        "若用户要「流程图/因果图/回路图」，必须直接输出 ```mermaid 流程图代码块，不要只口头说去画。"
        "若讨论品牌代理/渠道/品牌方/团队产能等，可引用 Loops Method（8 Stock："
        "S1 代理品牌数、S2 渠道覆盖、S3 市场认知、S4 终端销售、S5 品牌方满意度、"
        "S6 团队产能、S7 运营能力、S8 资源健康；A 增长链、B 管理约束、C 资源、D 人才、E 销资反馈；"
        "留意增长极限 C1＝飞轮遇上带宽封顶；画图时优先用 S1–S8）。\n"
        "不要输出 JSON。"
    )
    if active_skills:
        system += SKILL_EXEC_APPEND + build_skill_system_block(active_skills)

    # 召唤者个人信息：方法论可作为行事风格参考
    if llm_user is not None:
        try:
            from apps.core.models import UserSettings

            profile = UserSettings.objects.filter(user_id=llm_user.id).only(
                "methodology", "display_name", "bio",
            ).first()
            if profile:
                bits = []
                if (profile.display_name or "").strip():
                    bits.append(f"显示名：{profile.display_name.strip()}")
                if (profile.bio or "").strip():
                    bits.append(f"个性签名：{profile.bio.strip()}")
                if (profile.methodology or "").strip():
                    bits.append(f"方法论：\n{profile.methodology.strip()[:1500]}")
                if bits:
                    system += "\n\n当前召唤者的个人信息（回答时可酌情贴合其风格，勿生硬复述）：\n" + "\n".join(bits)
        except Exception:
            pass

    ref_parts: list[str] = []
    if script_output:
        ref_parts.append(script_output)
    elif skill_diag:
        ref_parts.append(f"【Skill 执行状态】\n{skill_diag}")
    if skill_names:
        ref_parts.append(f"已加载 Skill：{skill_names}")

    ref_block = ("\n\n".join(ref_parts) + "\n\n") if ref_parts else ""

    user = (
        f"会话：{room_title or '协作会话'}\n"
        f"本会话插嘴开关：{interject_state}\n"
        f"{focus}"
        f"最近对话：\n{history}\n\n"
        f"{ref_block}"
        f"当前用户消息：{trigger_content}\n"
        "请给出你的回复（若有 Skill 结果，请直接用来完成任务）："
    )

    # 插嘴相关问题：有 Skill 时走模型；否则确定性短答
    q = re.sub(r"@(AI|ai|良策AI|良策ai)\s*", "", trigger_content or "").strip()
    if not active_skills and re.search(r"插嘴|主动发言|主动介入|什么时候会?插", q):
        if not interject_enabled:
            return (
                "当前会话已关闭「允许 AI 插嘴」。"
                "平时我只在被 @AI 或调用 Skill 时回复；"
                "开启后仅在黄/红风险时可能发监控提醒。"
                "可在会话设置（齿轮）里重新开启。"
            )
        return (
            "我会在这些情况下出现：\n"
            "1) 被 @AI 召唤，或消息里 @ 了 Skill —— 立刻回答/办事。\n"
            "2) 监控插嘴 —— 仅黄/红风险且过冷却时发【监控提醒】；"
            "日常怎么做/方案讨论需要你 @AI，我不会每条都回。\n"
            "同一次消息里如果已经召唤了我，该轮一般不再额外插嘴。"
        )

    max_tokens = 2000 if active_skills else 1000
    result = _call_llm(system, user, llm_user=llm_user, max_tokens=max_tokens)
    text = (result.get("content") or "").strip()
    err = (result.get("error") or "").strip()

    if not text and llm_user is not None:
        logger.warning("collab @AI personal llm failed: %s; retry global", err or "empty")
        result2 = _call_llm(system, user, llm_user=None, max_tokens=max_tokens)
        text = (result2.get("content") or "").strip()
        err = (result2.get("error") or err or "").strip()

    if text:
        return text[:6000]

    # Skill 已跑出结果但模型挂了：至少把脚本输出露出来
    if script_output:
        return (
            f"Skill 已执行，但模型归纳失败（{err[:120] or '无响应'}）。"
            f"原始结果如下：\n\n{script_output[:3500]}"
        )[:6000]

    logger.warning("collab @AI llm unavailable: %s", err or "empty")
    return _local_fallback(trigger_content, transcript, mentions, err)[:4000]
