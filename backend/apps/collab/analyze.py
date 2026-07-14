"""协作会话 AI 旁路风险分析。"""
from __future__ import annotations

import json
import re
from typing import Any

from apps.council import llm


RISK_RANK = {"green": 0, "yellow": 1, "red": 2}


def _parse_json_object(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:
        pass
    m = re.search(r"\{[\s\S]*\}", raw)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _rule_based_insight(messages: list[dict]) -> dict[str, Any]:
    """无 LLM 时的规则降级。"""
    text = "\n".join(f"{m.get('username')}: {m.get('content')}" for m in messages)
    lower = text.lower()
    red_keys = ["保证回本", "一定赚钱", "最低价", "内部价", "先发货后付款且不签合同", "绕过审批", "私下转账"]
    yellow_keys = ["打折", "折扣", "特价", "返点", "佣金", "保密", "不要告诉", "先这样定", "口头答应", "保证"]
    hits_red = [k for k in red_keys if k in text or k.lower() in lower]
    hits_yellow = [k for k in yellow_keys if k in text or k.lower() in lower]

    if hits_red:
        return {
            "risk_level": "red",
            "title": "检测到高风险话术/承诺",
            "analysis": f"对话中出现高风险表述: {', '.join(hits_red[:4])}。可能形成不可撤销承诺或合规风险。",
            "advice": "暂停对外承诺，改用标准口径，必要时发起审批后再答复。",
            "control": "建议标记会话为高风险，关键承诺类表述需主管确认后再发送。",
            "tags": ["高风险承诺", "话术合规"],
            "draft_reply": "这个口径需要先走内部审批确认后才能答复您，我先帮您登记需求，审批通过后第一时间反馈。",
        }
    if hits_yellow:
        return {
            "risk_level": "yellow",
            "title": "存在需关注的商务口径",
            "analysis": f"对话涉及可能需要管控的表述: {', '.join(hits_yellow[:4])}。",
            "advice": "确认折扣/返点权限边界，避免口头承诺；用可追溯的书面或系统单为准。",
            "control": "建议补充审批说明，或拉相关角色确认后再继续。",
            "tags": ["价格口径", "注意"],
            "draft_reply": "折扣与政策需要以系统审批结果为准，我帮您提交申请，通过后同步确认方案。",
        }
    last = messages[-1]["content"][:40] if messages else ""
    return {
        "risk_level": "green",
        "title": "会话运行正常",
        "analysis": f"暂未发现明显异常。最近讨论围绕：「{last}」。",
        "advice": "保持关键表达，重要结论建议落成纪要。",
        "control": "持续旁路监控即可。",
        "tags": ["正常"],
        "draft_reply": "",
    }


def analyze_room_messages(messages: list[dict], *, llm_user=None) -> dict[str, Any]:
    """分析最近消息，返回 insight 字典。"""
    if not messages:
        return {
            "risk_level": "green",
            "title": "等待对话开始",
            "analysis": "尚无消息，AI 将在双方开始聊天后进行旁路分析。",
            "advice": "",
            "control": "",
            "tags": [],
            "draft_reply": "",
            "evidence_message_ids": [],
        }

    evidence_ids = [m["id"] for m in messages[-6:]]
    transcript = "\n".join(
        f"[#{m['id']}] {m.get('username')}: {m.get('content')}" for m in messages[-20:]
    )

    system = (
        "你是企业协作会话的风控助手。根据双方聊天内容，做异常分析、建议与风险管控。"
        "只输出 JSON 对象，不要 markdown。字段："
        "risk_level(green|yellow|red), title, analysis, advice, control, tags(数组),"
        "draft_reply(可选合规回复草稿), evidence_message_ids(关联消息 id 数组)。"
        "判定标准："
        "red=违规承诺/绕过审批/疑似利益输送/泄露敏感数据；"
        "yellow=价格折扣口径不清、需审批、敏感商务表述；"
        "green=正常沟通。中文简洁。"
    )
    user = f"请分析以下协作聊天：\n{transcript}"

    raw = ""
    if llm.llm_available(llm_user):
        raw = llm.chat(
            system,
            user,
            temperature=0.2,
            max_tokens=700,
            timeout=45,
            llm_user=llm_user,
        ) or ""

    data = _parse_json_object(raw) if raw else None
    if not data:
        data = _rule_based_insight(messages)

    level = str(data.get("risk_level") or "green").lower()
    if level not in RISK_RANK:
        level = "green"

    tags = data.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    ev = data.get("evidence_message_ids") or evidence_ids
    if not isinstance(ev, list):
        ev = evidence_ids

    return {
        "risk_level": level,
        "title": str(data.get("title") or "会话分析")[:200],
        "analysis": str(data.get("analysis") or "")[:2000],
        "advice": str(data.get("advice") or "")[:2000],
        "control": str(data.get("control") or "")[:2000],
        "tags": [str(t)[:40] for t in tags][:8],
        "draft_reply": str(data.get("draft_reply") or "")[:1000],
        "evidence_message_ids": [int(x) for x in ev if str(x).isdigit() or isinstance(x, int)][:12],
    }


def max_risk(a: str, b: str) -> str:
    return a if RISK_RANK.get(a, 0) >= RISK_RANK.get(b, 0) else b
