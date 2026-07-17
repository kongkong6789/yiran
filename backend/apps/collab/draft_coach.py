"""输入框停手后的改写示例（可一键填入）。"""
from __future__ import annotations

import re
from typing import Any

from apps.council import llm

from .analyze import (
    _HARD_RISK_RE,
    _YELLOW_HINT_RE,
    _parse_json_object,
    _user_text_has_risk_hint,
    detect_solve_intent,
)

# 「风险=0 / 零风险 / 必定没风险」等绝对化表述：理论上不可靠，应提醒纠正，禁止原样润色
_ABSOLUTE_ZERO_RISK_RE = re.compile(
    r"("
    r"风险\s*(必|必定|一定|肯定|绝对)?\s*(是|为|等于|=|==)\s*0|"
    r"风险\s*(为零|等于零|必是0|一定是0|肯定是0)|"
    r"(零风险|无风险|没有风险|毫无风险|完全没风险|风险为0|风险是0)|"
    r"(必定|一定|肯定|绝对|必)\s*(没|无|零)\s*风险|"
    r"风险\s*(可以|能)?\s*(忽略|当作)\s*(为)?\s*0"
    r")"
)

# 纠正性否定：允许出现在改写示例中（如「不敢说风险为0」「不等于0」）
_ZERO_RISK_NEGATION_RE = re.compile(
    r"(不敢说|不能说|不等于|不是|别说成|不要写成|无法证明|很难证明|不能当作|而不是按)"
)


def _strip_absolute_zero_risk(text: str) -> str:
    """去掉绝对化零风险断言，保留其余语义碎片。"""
    cleaned = _ABSOLUTE_ZERO_RISK_RE.sub("", text or "")
    cleaned = re.sub(r"[，,、；;]{2,}", "，", cleaned)
    cleaned = re.sub(r"^\s*[，,、；;]+|[，,、；;]+\s*$", "", cleaned)
    return cleaned.strip()


def _has_absolute_zero_risk(text: str) -> bool:
    """是否在断言风险为 0；纠正性否定句不算。"""
    t = text or ""
    if not _ABSOLUTE_ZERO_RISK_RE.search(t):
        return False
    if _ZERO_RISK_NEGATION_RE.search(t):
        return False
    return True


def analyze_draft(text: str, recent_messages: list[dict], *, llm_user=None) -> dict[str, Any]:
    """返回可点击的改写示例，而不是空泛建议。"""
    draft = (text or "").strip()
    draft_core = re.sub(r"[。.!！？?\s]+$", "", draft)
    tips: list[dict[str, str]] = []

    if len(draft_core) < 2:
        return {"ok": True, "level": "green", "tips": [], "examples": [], "label": "", "advice": ""}

    def _add(*, kind: str, level: str, label: str, advice: str, example: str) -> None:
        ex = (example or "").strip()
        if not ex or ex == draft:
            return
        # 改写结果仍在断言「风险=0」则丢弃；纠正性否定句可保留
        if _has_absolute_zero_risk(ex):
            return
        if any(t.get("example") == ex for t in tips):
            return
        tips.append({
            "kind": kind,
            "level": level,
            "label": label[:16],
            "advice": advice[:80],
            "example": ex[:120],
        })

    if _has_absolute_zero_risk(draft):
        # 只提醒、给纠正口径，禁止再走「加一句目的」把「风险是0」原样润色出去
        _add(
            kind="warn",
            level="yellow",
            label="没有零风险",
            advice="没有什么风险必定是 0。建议改成残余风险与核验口径，不要原样发送。",
            example="这块我不敢说风险为零，想先对齐残余风险点和下一步核验项。",
        )
        rest = _strip_absolute_zero_risk(draft_core)
        if rest and rest != draft_core and len(rest) >= 2:
            _add(
                kind="optimize",
                level="info",
                label="改成可对齐",
                advice="去掉绝对化断言后再对齐。",
                example=f"{rest}；风险侧建议先列残余项再对齐，而不是按零风险拍板。",
            )
        else:
            _add(
                kind="optimize",
                level="info",
                label="改成可对齐",
                advice="用「可控但仍有残余风险」替代「必定是 0」。",
                example="目前看可控，但仍有残余风险；方便的话我们对齐一下核验清单？",
            )
        # 有明确风险口径提醒后，不再调 LLM 润色，避免又把错话包装回去
        level = "yellow"
        primary = tips[0] if tips else None
        examples = [t["example"] for t in tips if t.get("example")]
        return {
            "ok": True,
            "level": level,
            "tips": tips[:3],
            "examples": examples[:3],
            "label": (primary or {}).get("label") or "",
            "advice": (primary or {}).get("advice") or "",
        }
    elif _HARD_RISK_RE.search(draft):
        # 暴力/威胁等：只提醒纠正，禁止再「加一句目的」润色保留原话
        _add(
            kind="risk",
            level="red",
            label="危险表述",
            advice="这句话含暴力/威胁意味，请不要原样发送。",
            example="刚才那句说重了，我换个正常方式对齐一下这件事。",
        )
        _add(
            kind="optimize",
            level="info",
            label="改成正常沟通",
            advice="用业务对齐替代人身攻击。",
            example="想确认一下你这边是否方便现在对齐这件事。",
        )
        level = "red"
        primary = tips[0] if tips else None
        examples = [t["example"] for t in tips if t.get("example")]
        return {
            "ok": True,
            "level": level,
            "tips": tips[:3],
            "examples": examples[:3],
            "label": (primary or {}).get("label") or "",
            "advice": (primary or {}).get("advice") or "",
        }
    elif _YELLOW_HINT_RE.search(draft) or _user_text_has_risk_hint(draft):
        _add(
            kind="warn",
            level="yellow",
            label="口径改写",
            advice="价格/承诺类表述建议写清权限与书面确认。",
            example="折扣/口径需按权限确认，我先核对规则，书面确认后再答复你。",
        )

    vague = re.findall(r"(尽快|随便|大概|差不多|看看再说|先这样|随便定|到时候再说|保证|一定能)", draft)
    if vague and not any(t["kind"] == "risk" for t in tips):
        joined = "、".join(list(dict.fromkeys(vague))[:2])
        _add(
            kind="optimize",
            level="info",
            label="更具体一点",
            advice=f"把「{joined}」换成可执行说法。",
            example=f"{draft_core}，今天 18 点前我给到进度，负责人我来跟。",
        )

    if re.search(r"(怎么做|怎么办|如何|建议|方案|有没有办法)", draft) and len(draft_core) < 18:
        _add(
            kind="tip",
            level="info",
            label="把问题说清楚",
            advice="补上目标与约束，对方更好接。",
            example=f"{draft_core}？目标是____，约束是____，期望今天有个可执行步骤。",
        )

    if re.search(r"(在干嘛|干嘛|怎么样|如何|吗|呢|吧|啊)$", draft_core) and len(draft_core) <= 24:
        _add(
            kind="optimize",
            level="info",
            label="补上事项",
            advice="写清在问哪件事。",
            example="在忙吗？想确认一下刚才那个方案你那边推进得怎么样了。",
        )
        _add(
            kind="optimize",
            level="info",
            label="直接问进度",
            advice="改成可回复的业务问句。",
            example="那个事项现在到哪一步了？卡在哪里的话我帮你对齐一下。",
        )

    recent_user = [
        str(m.get("content") or "").strip()
        for m in (recent_messages or [])[-6:]
        if (m.get("msg_type") or "user") == "user" and str(m.get("content") or "").strip()
    ]
    recent_blob = "\n".join(recent_user[-4:])
    last_peer = ""
    for m in reversed(recent_messages or []):
        content = str(m.get("content") or "").strip()
        if content and (m.get("msg_type") or "user") != "ai":
            last_peer = content[:36]
            break

    if recent_blob and draft:
        if re.search(r"(审批|合规|风控|权限)", recent_blob) and re.search(r"(绕过|别管|先做了再说|私下)", draft):
            _add(
                kind="warn",
                level="yellow",
                label="对齐上文合规",
                advice="上文在谈审批，避免绕过说法。",
                example="按现有审批走，我先补齐材料，过完再推进。",
            )
        if detect_solve_intent(recent_messages or []) and re.fullmatch(
            r"(好的|嗯|行|ok|OK|可以|没问题)[。.!！]*", draft
        ):
            _add(
                kind="tip",
                level="info",
                label="接一句方案",
                advice="上文在讨论怎么办，直接给步骤。",
                example="好的。我建议分两步：先确认口径，再拉齐负责人，今晚前同步一版。",
            )
        if (
            len(recent_blob) >= 12
            and re.search(r"(方案|审批|数据|客户|订单|库存|费用|利润)", recent_blob)
            and re.search(r"(在干嘛|吃了吗|哈哈|嘿嘿)", draft_core)
        ):
            hook = last_peer or "刚才那件事"
            _add(
                kind="tip",
                level="info",
                label="先回上文",
                advice="业务上下文里先接一句再闲聊。",
                example=f"关于「{hook}」我这边先确认下进度；另外想问你现在方便聊吗？",
            )

    try:
        use_llm = llm.llm_available(llm_user)
    except Exception:
        use_llm = False
    if use_llm and len(draft_core) >= 2 and len(tips) < 2:
        try:
            transcript = "\n".join(
                f"{m.get('username')}: {m.get('content')}" for m in (recent_messages or [])[-8:]
            )
            system = (
                "你是协作输入框旁的改写助手。结合最近会话，把用户【尚未发送】的草稿改成更好的发送文案。"
                "只输出 JSON：{tips:[{kind,label,example}]}。"
                "kind 只能是 tip|optimize|warn|risk；label≤8字；example 必须是用户可直接发送的完整句子（≤40字）。"
                "给 1～2 条不同改写示例，不要只写建议，必须给 example。"
                "硬性约束：不得保留或改写成「风险是0/为零/零风险/必定没风险」等绝对化说法；"
                "若草稿含此类表述，必须纠正为残余风险、待核验、可控但不等于0等口径。"
                "不要客套，不要 markdown。"
            )
            user = f"最近会话：\n{transcript or '(暂无)'}\n\n用户草稿：\n{draft}"
            raw = llm.chat(
                system, user, temperature=0.3, max_tokens=260, timeout=8, llm_user=llm_user,
            ) or ""
            data = _parse_json_object(raw) if raw else None
            if data and isinstance(data.get("tips"), list):
                for item in data["tips"][:3]:
                    kind = str(item.get("kind") or "optimize").lower()
                    if kind not in ("tip", "optimize", "warn", "risk"):
                        kind = "optimize"
                    label = str(item.get("label") or "改写示例").strip()[:16]
                    example = str(item.get("example") or item.get("text") or "").strip()[:120]
                    advice = str(item.get("advice") or "点击采用该说法").strip()[:80]
                    tip_level = "red" if kind == "risk" else "yellow" if kind == "warn" else "info"
                    _add(kind=kind, level=tip_level, label=label, advice=advice or "点击采用", example=example)
        except Exception:
            pass

    if not tips and len(draft_core) >= 2:
        # 兜底润色绝不能把「风险是0」拼回去
        if _has_absolute_zero_risk(draft):
            _add(
                kind="warn",
                level="yellow",
                label="没有零风险",
                advice="没有什么风险必定是 0，请改成残余风险口径。",
                example="这块我不敢说风险为零，想先对齐残余风险点和下一步核验项。",
            )
        else:
            _add(
                kind="optimize",
                level="info",
                label="加一句目的",
                advice="补上你想达到的结果。",
                example=f"{draft_core}，想确认一下你这边是否方便现在对齐。",
            )

    level = "green"
    for t in tips:
        if t.get("level") == "red":
            level = "red"
            break
        if t.get("level") == "yellow":
            level = "yellow"
    if level == "green" and tips:
        level = "info"

    primary = tips[0] if tips else None
    examples = [t["example"] for t in tips if t.get("example")]
    return {
        "ok": True,
        "level": level,
        "tips": tips[:3],
        "examples": examples[:3],
        "label": (primary or {}).get("label") or "",
        "advice": (primary or {}).get("advice") or "",
    }
