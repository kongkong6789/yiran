"""协作会话 AI 旁路风险分析。"""
from __future__ import annotations

import json
import re
from typing import Any

from django.utils import timezone

from apps.council import llm


RISK_RANK = {"green": 0, "yellow": 1, "red": 2}

# 寻求/讨论方案、办法、落地思路 → 无需 @ 也可主动给建议
SOLVE_INTENT_RE = re.compile(
    r"(怎么做|如何做|怎样做|怎么办|怎么弄|如何落地|如何推进|"
    r"怎么处理|如何处理|怎么解决|如何解决|咋办|怎么破|"
    r"有什么建议|给点建议|给个建议|有没有建议|求建议|征求建议|"
    r"有没有.{0,8}办法|什么办法|啥办法|有啥办法|有没有.{0,6}招|啥招|"
    r"什么方案|有没有.{0,8}方案|出个方案|做个方案|定个方案|哪个方案|"
    r"有何对策|什么对策|什么思路|有没有思路|"
    r"(方案|办法|对策)(呢|啊|吗|嘛)?$)"
)
SOLVE_DISCUSSION_RE = re.compile(
    r"(方案|办法|对策|思路|建议).{0,16}(怎么样|如何|可行|行不行|哪个好|怎么选|好不好)|"
    r"讨论(一下|下)?.{0,10}(方案|办法|对策)|"
    r"(先|再)?(想想|看看|聊聊).{0,8}(方案|办法)"
)
DIAGRAM_INTENT_RE = re.compile(
    r"(流程图|画(个|一|张)?流程|出个流程|来个流程|流程.?图|"
    r"画一下|画张图|画个图|回路图|因果图|mermaid)"
)
FAKE_WARN_TITLE_RE = re.compile(
    r"(暴力|伤害|威胁|恐吓|高风险|风险警告|监控提醒|违规|危险言论|需警告)"
)


def _recent_user_blob(messages: list[dict], n: int = 4) -> str:
    texts = [
        str(m.get("content") or "")
        for m in messages[-n:]
        if (m.get("msg_type") or "user") == "user"
    ]
    if not texts:
        texts = [str(m.get("content") or "") for m in messages[-n:]]
    return "\n".join(texts)


def detect_solve_intent(messages: list[dict]) -> bool:
    """最近几条用户话是否在问/议方案、办法、建议，或要求画流程图。"""
    blob = _recent_user_blob(messages)
    if not blob.strip():
        return False
    return bool(
        SOLVE_INTENT_RE.search(blob)
        or SOLVE_DISCUSSION_RE.search(blob)
        or DIAGRAM_INTENT_RE.search(blob)
    )


def detect_diagram_intent(messages: list[dict]) -> bool:
    return bool(DIAGRAM_INTENT_RE.search(_recent_user_blob(messages)))


_HARD_RISK_RE = re.compile(
    r"(保证回本|一定赚钱|最低价|内部价|绕过审批|私下转账|"
    r"威胁|恐吓|勒索|报复|自杀|爆炸|枪支|毒品|赌博|"
    r"洗钱|刷单赚钱|假合同|伪造|色情交易|暴力|"
    r"打死|饿死|弄死|抽死|掐死|砍死|捅死|揍死|杀死|杀害|"
    r"弄死你|杀了你|弄你|打你|揍你|抽你|弄残|搞死)"
)


def _has_hard_risk(messages: list[dict]) -> bool:
    """真实红线表述，才允许升级成警告；「怎么做」本身不算。只看用户消息。"""
    blob = "\n".join(
        str(m.get("content") or "")
        for m in messages[-12:]
        if (m.get("msg_type") or "user") == "user"
    )
    return bool(_HARD_RISK_RE.search(blob))


_YELLOW_HINT_RE = re.compile(
    r"(打折|折扣|特价|返点|佣金|内部价|不要告诉|别汇报|私下说|别录音|删聊天|"
    r"擦边|灰色地带|绕过审批|私下转账|保证回本|一定赚钱)"
)


def _user_text_has_risk_hint(content: str) -> bool:
    """用户原文是否真有风险线索（排除 AI 复述带来的误标）。"""
    text = (content or "").strip()
    if not text or len(text) <= 2:
        return False
    return bool(_YELLOW_HINT_RE.search(text) or _HARD_RISK_RE.search(text))


def _fallback_agency_mermaid() -> str:
    return (
        "```mermaid\n"
        "flowchart LR\n"
        "  S1[S1 代理品牌数] -->|+| S2[S2 渠道覆盖]\n"
        "  S2 -->|+| S3[S3 市场认知]\n"
        "  S3 -->|+| S4[S4 终端销售]\n"
        "  S4 -->|+| S5[S5 品牌方满意]\n"
        "  S5 -->|+| S1\n"
        "  S1 -.->|-| S6[S6 团队产能]\n"
        "  S6 -->|+| S7[S7 运营能力]\n"
        "  S7 -->|+| S5\n"
        "  S8[S8 资源健康] -->|+| S7\n"
        "  S4 -.->|- //| S8\n"
        "```"
    )


def _enrich_solve_advice(messages: list[dict], advice: str, *, llm_user=None) -> str:
    """把「可给建议」收敛成可执行短步骤，供无需 @ 的插嘴使用。"""
    transcript = "\n".join(
        f"{m.get('username')}: {m.get('content')}" for m in messages[-12:]
    )
    from .loops_method import LOOPS_METHOD_BRIEF, topic_matches_agency

    agency = topic_matches_agency(transcript)
    want_diagram = detect_diagram_intent(messages)
    frame = f"\n若话题涉及品牌代理业务，请用下列框架点名 S#/回路来组织建议：\n{LOOPS_METHOD_BRIEF}\n" if agency else ""
    diagram_rule = ""
    if want_diagram:
        diagram_rule = (
            "\n成员明确要求看「流程图」。你必须在回复中直接给出一个可渲染的 mermaid 代码块"
            "（以 ```mermaid 开头、``` 结束），用 flowchart TD 或 LR；节点中文短标签；"
            "禁止只说「去画流程图」而不给图。品牌代理话题优先画 S1–S8 与增长/约束链。\n"
        )
    system = (
        "你是企业协作顾问「良策AI」。成员在讨论怎么做/方案/办法，但没有 @ 你。"
        "这是「协作建议」不是风险警告：禁止出现暴力、伤害、威胁、监控警告等字样（除非对话里真有）。"
        "请先给 2～4 条可执行短建议（编号列表），贴合对话上下文。"
        "不要寒暄、不要 JSON、不要说「作为 AI」。"
        f"{frame}{diagram_rule}"
        f"中文，建议文字控制在 {'200' if want_diagram else '320'} 字以内"
        f"{'；mermaid 图另计' if want_diagram else ''}。"
    )
    user = (
        f"最近对话：\n{transcript}\n\n"
        f"分析侧已有要点（可吸收改写，勿照抄空话）：{(advice or '').strip() or '（无）'}\n"
        "请输出建议正文"
        + ("（含 mermaid 流程图）：" if want_diagram else "：")
    )

    text = ""
    if llm.llm_available(llm_user):
        try:
            raw = llm.chat(
                system,
                user,
                temperature=0.35,
                max_tokens=900 if want_diagram else 420,
                timeout=45,
                llm_user=llm_user,
            ) or ""
        except Exception:
            raw = ""
        text = (raw or "").strip()

    if want_diagram and "```mermaid" not in text.lower():
        base = text or (advice or "").strip() or "结合当前讨论，先用流程图对齐路径，再分步落地。"
        if agency:
            text = f"{base.rstrip()}\n\n{_fallback_agency_mermaid()}"
        else:
            text = (
                f"{base.rstrip()}\n\n"
                "```mermaid\n"
                "flowchart TD\n"
                "  A[明确目标] --> B[拆解步骤]\n"
                "  B --> C[分配责任]\n"
                "  C --> D[执行与复盘]\n"
                "  D -->|调整| B\n"
                "```"
            )
    if not text:
        return (advice or "").strip()
    return text[:2400]


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
    """无 LLM 时的规则降级。只扫用户消息，避免把 AI 复述里的「警告/风险」误判成黄线。"""
    user_msgs = [m for m in messages if (m.get("msg_type") or "user") == "user"]
    scan_msgs = user_msgs or messages
    text = "\n".join(str(m.get("content") or "") for m in scan_msgs)
    lower = text.lower()
    red_keys = [
        "保证回本", "一定赚钱", "最低价", "内部价", "先发货后付款且不签合同", "绕过审批", "私下转账",
        "威胁", "恐吓", "勒索", "报复", "弄死", "自杀", "爆炸", "枪支", "毒品", "赌博平台",
        "洗钱", "刷单赚钱", "假合同", "伪造", "色情交易",
    ]
    # 不再用孤立「警告」「保证」——极易被讨论风险的上下文误伤
    yellow_keys = [
        "打折", "折扣", "特价", "返点", "佣金", "内部价", "不要告诉", "先这样定", "口头答应",
        "别汇报", "私下说", "别录音", "删聊天", "擦边", "灰色地带",
    ]
    hits_red = [k for k in red_keys if k in text or k.lower() in lower]
    hits_yellow = [k for k in yellow_keys if k in text or k.lower() in lower]

    def _flag_hits(keys: list[str], level: str) -> list[dict]:
        out = []
        for m in scan_msgs[-8:]:
            body = str(m.get("content") or "")
            if not any(k in body for k in keys):
                continue
            mid = m.get("id")
            if not mid:
                continue
            out.append({
                "message_id": mid,
                "label": infer_risk_label(body, tags=[], title="", level=level),
                "level": level,
            })
        return out

    last_content = (messages[-1].get("content") or "") if messages else ""
    ask_how = detect_solve_intent(messages)

    if hits_red:
        flags = _flag_hits(hits_red, "red")
        return {
            "risk_level": "red",
            "title": "检测到高风险话术/危险内容",
            "analysis": f"对话中出现高风险表述: {', '.join(hits_red[:4])}。可能形成合规、安全或不可撤销承诺风险。",
            "advice": "立即收敛相关话题：暂停承诺或危险言论，改用合规口径；必要时升级主管或风控介入。",
            "control": "标记高风险；关键表述需确认后再继续；可提醒对方停止危险表达。",
            "tags": ["高风险", "监控介入", "需警告"],
            "draft_reply": "这类表述涉及合规/安全风险，我这边不能按该口径继续。请换正规流程沟通，需要的话我帮你对接合规同事。",
            "should_speak": True,
            "message_flags": flags,
            "evidence_message_ids": [f["message_id"] for f in flags][:12],
        }
    if hits_yellow:
        flags = _flag_hits(hits_yellow, "yellow")
        return {
            "risk_level": "yellow",
            "title": "出现需警告关注的口径",
            "analysis": f"对话涉及可能需要管控的表述: {', '.join(hits_yellow[:4])}。",
            "advice": "及时提醒边界：价格/承诺/保密类表述需权限与可追溯记录；口头约定不要当作最终结论。",
            "control": "建议补充审批或书面确认后再推进。",
            "tags": ["注意", "监控介入", "需警告"],
            "draft_reply": "这个点需要按公司规则确认后才能定，我先帮你核对权限/流程，确认后同步方案。",
            "should_speak": True,
            "message_flags": flags,
            "evidence_message_ids": [f["message_id"] for f in flags][:12],
        }
    if ask_how:
        return {
            "risk_level": "green",
            "title": "会话讨论进行中",
            "analysis": f"成员在讨论做法/方案：{last_content[:80]}。需要 AI 回复时可 @AI。",
            "advice": "业务讨论可继续；若要 AI 给步骤或画流程图，请 @AI。",
            "control": "旁路更新看板即可，不主动进群发言。",
            "tags": ["正常"],
            "draft_reply": "",
            "should_speak": False,
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
        "should_speak": False,
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
            "should_speak": False,
        }

    evidence_ids = [m["id"] for m in messages[-6:]]
    transcript = "\n".join(
        f"[#{m['id']}] {m.get('username')}: {m.get('content')}" for m in messages[-20:]
    )

    system = (
        "你是企业协作会话的风控旁路助手。只做风险分析与看板更新；"
        "普通问答/怎么做/方案讨论一律不要主动进群发言（成员需自己 @AI 才会得到对话回复）。"
        "只输出 JSON，不要 markdown。字段："
        "risk_level(green|yellow|red), title, analysis, advice, control, tags(数组),"
        "draft_reply(可选合规回复草稿), evidence_message_ids(消息 id 数组),"
        "should_speak(布尔：是否因风险主动插入聊天气泡),"
        "message_flags(数组，可选：[{message_id, label, level}]，label 如「存在暴力」「违规承诺」)。\n"
        "风险判定：\n"
        "- red：违规承诺、绕过审批、利益输送、泄露敏感、威胁恐吓、暴力伤害言语、违法危险内容；\n"
        "- yellow：价格/折扣口径不清、需审批、敏感商务、明显不当但未达红线、需要口头警告；\n"
        "- green：正常沟通（含怎么做、方案、流程图等讨论）。\n"
        "should_speak=true 仅当 risk_level 为 yellow 或 red，且需要即时警告/纠偏时。"
        "问办法、出方案、闲聊：should_speak=false，不要加「协作建议」「监控介入」。\n"
        "yellow/red 必须填写可读的 advice，尽量给 draft_reply，"
        "并尽量在 message_flags 标出对应证据消息的短标签；tags 加入「监控介入」。中文简洁。"
    )
    user = f"请分析以下协作聊天：\n{transcript}"

    raw = ""
    if llm.llm_available(llm_user):
        raw = llm.chat(
            system,
            user,
            temperature=0.2,
            max_tokens=800,
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
    tags = [str(t)[:40] for t in tags][:8]

    should_speak = data.get("should_speak")
    if isinstance(should_speak, str):
        should_speak = should_speak.strip().lower() in ("1", "true", "yes", "y")
    else:
        should_speak = bool(should_speak)

    hard_risk = _has_hard_risk(messages)
    solve_intent = detect_solve_intent(messages)
    latest_user_text = next((
        str(message.get("content") or "")
        for message in reversed(messages)
        if (message.get("msg_type") or "user") == "user"
    ), "")
    latest_user_has_risk = _user_text_has_risk_hint(latest_user_text)
    # 风险主动提醒必须由「本轮最新用户消息」触发。
    # 旧风险仍保留在历史洞察/告警中，但后续普通消息不会反复触发同一条提醒。
    if level in ("yellow", "red") and not latest_user_has_risk:
        level = "green"
        should_speak = False
        data["message_flags"] = []
        tags = [t for t in tags if t not in ("监控介入", "应插嘴", "需警告", "注意")]
        data["title"] = "会话讨论进行中"
    # 普通问答/方案讨论：绝不因「怎么做」主动进群；只 @AI 才对话应答
    if solve_intent and not hard_risk and level == "green":
        should_speak = False
        tags = [t for t in tags if t not in ("协作建议", "建议", "监控介入", "需警告", "应插嘴")]
        data["message_flags"] = []
        title_now = str(data.get("title") or "").strip()
        if (not title_now) or FAKE_WARN_TITLE_RE.search(title_now) or title_now in (
            "会话分析", "针对讨论给出落地建议", "流程图与落地建议",
        ):
            data["title"] = "会话讨论进行中"
    # 仅黄红风险才允许主动插嘴
    if level in ("yellow", "red"):
        should_speak = True
        if "监控介入" not in tags:
            tags.append("监控介入")
    else:
        should_speak = False
        tags = [t for t in tags if t not in ("监控介入", "应插嘴", "需警告", "协作建议")]

    ev = data.get("evidence_message_ids") or evidence_ids
    if not isinstance(ev, list):
        ev = evidence_ids

    advice = str(data.get("advice") or "")[:2000]
    # 黄红若没建议，给兜底，便于插嘴文案
    if level in ("yellow", "red") and not advice.strip():
        advice = "请留意当前表述的合规与安全边界，必要时改用标准口径或升级确认。"

    return {
        "risk_level": level,
        "title": str(data.get("title") or "会话分析")[:200],
        "analysis": str(data.get("analysis") or "")[:2000],
        "advice": advice[:2000],
        "control": str(data.get("control") or "")[:2000],
        "tags": tags[:8],
        "draft_reply": str(data.get("draft_reply") or "")[:1000],
        "evidence_message_ids": [int(x) for x in ev if str(x).isdigit() or isinstance(x, int)][:12],
        "should_speak": should_speak,
        "message_flags": data.get("message_flags") if isinstance(data.get("message_flags"), list) else [],
        "speak_kind": "interject" if should_speak else "",
    }


def max_risk(a: str, b: str) -> str:
    return a if RISK_RANK.get(a, 0) >= RISK_RANK.get(b, 0) else b


def infer_risk_label(content: str, *, tags: list | None = None, title: str = "", level: str = "yellow") -> str:
    """根据内容/标签推断短标签，如「存在暴力」。"""
    text = f"{content or ''} {title or ''} {' '.join(str(t) for t in (tags or []))}"
    rules = [
        (r"暴力|打死|饿死|弄死|抽死|掐死|砍死|捅死|揍死|杀死|杀害|虐待|虐猫|虐狗|肢解|搞死|弄残", "存在暴力"),
        (r"威胁|恐吓|勒索|报复|喊人|弄你|打你|揍你|抽你|弄死你|杀了你", "存在威胁"),
        (r"自杀|自残|结束生命", "自伤风险"),
        (r"色情|裸聊|一夜情|约炮", "内容不当"),
        (r"毒品|冰毒|吸毒|制毒", "违法风险"),
        (r"赌博|博彩|洗钱", "违法风险"),
        (r"保证回本|一定赚钱|内部价|绕过审批|私下转账", "违规承诺"),
        (r"泄密|不要告诉|别汇报|删聊天", "敏感口径"),
    ]
    for pat, label in rules:
        if re.search(pat, text):
            return label
    if level == "red":
        return "危险发言"
    if level == "yellow":
        return "风险提醒"
    return "需关注"


def apply_message_risk_flags(room, data: dict[str, Any], *, fallback_messages: list | None = None) -> None:
    """把分析结论挂到证据消息上，供前端画连线标签。"""
    from .models import CollabMessage

    level = str(data.get("risk_level") or "green").lower()
    tags = data.get("tags") or []
    title = str(data.get("title") or "")
    recent_user_ids = [
        m.id for m in (fallback_messages or [])
        if getattr(m, "msg_type", "user") == "user"
        and (getattr(m, "status", "normal") or "normal") == "normal"
    ][-16:]

    # 本轮判定正常：清掉近期黄旗误标，避免「1 / 出来」一直挂「警告关注」
    if level == "green":
        if recent_user_ids:
            CollabMessage.objects.filter(
                room=room, id__in=recent_user_ids, msg_type="user", risk_flag_level="yellow",
            ).update(risk_flag="", risk_flag_level="", updated_at=timezone.now())
        return

    should_speak = bool(data.get("should_speak")) or level in ("yellow", "red")
    if not should_speak:
        return

    flags = data.get("message_flags") or []
    applied: dict[int, tuple[str, str]] = {}
    if isinstance(flags, list):
        for item in flags:
            if not isinstance(item, dict):
                continue
            mid = item.get("message_id") or item.get("id")
            try:
                mid = int(mid)
            except (TypeError, ValueError):
                continue
            lab = str(item.get("label") or "").strip()[:40]
            lv = str(item.get("level") or level).lower()
            if lv not in ("yellow", "red"):
                lv = level if level in ("yellow", "red") else "yellow"
            if not lab:
                lab = infer_risk_label("", tags=tags, title=title, level=lv)
            # 勿把空泛标题刷到无风险字眼的消息上：校验正文
            content = ""
            if fallback_messages:
                for m in fallback_messages:
                    if getattr(m, "id", None) == mid:
                        content = getattr(m, "content", "") or ""
                        break
            if level == "yellow" and content and not _user_text_has_risk_hint(content):
                continue
            if RISK_RANK.get(lv, 0) >= RISK_RANK.get(applied.get(mid, ("", ""))[1], 0):
                applied[mid] = (lab, lv)

    evidence = data.get("evidence_message_ids") or []
    if not applied and evidence and level in ("yellow", "red"):
        for mid in evidence[:6]:
            try:
                mid_i = int(mid)
            except (TypeError, ValueError):
                continue
            content = ""
            if fallback_messages:
                for m in fallback_messages:
                    if getattr(m, "id", None) == mid_i:
                        content = getattr(m, "content", "") or ""
                        break
            if getattr(
                next((m for m in (fallback_messages or []) if getattr(m, "id", None) == mid_i), None),
                "msg_type",
                "user",
            ) == "ai":
                continue
            if level == "yellow" and content and not _user_text_has_risk_hint(content):
                continue
            title_lab = title.strip()[:40]
            lab = infer_risk_label(content, tags=tags, title=title, level=level) or title_lab
            if lab:
                applied[mid_i] = (lab, level)

    # 兜底：只标「正文确有风险线索」的最近用户消息，禁止无脑标最新一条
    if not applied and level in ("yellow", "red") and fallback_messages:
        for m in reversed(fallback_messages):
            if getattr(m, "msg_type", "user") != "user":
                continue
            if (getattr(m, "status", "normal") or "normal") != "normal":
                continue
            content = getattr(m, "content", "") or ""
            if level == "yellow" and not _user_text_has_risk_hint(content):
                continue
            if level == "red" and not (_user_text_has_risk_hint(content) or _HARD_RISK_RE.search(content)):
                continue
            lab = infer_risk_label(content, tags=tags, title=title, level=level) or title.strip()[:40]
            applied[m.id] = (lab, level)
            break

    if not applied:
        return

    for mid, (lab, lv) in applied.items():
        CollabMessage.objects.filter(room=room, id=mid, msg_type="user").exclude(
            status__in=["deleted", "recalled"],
        ).update(risk_flag=lab, risk_flag_level=lv, updated_at=timezone.now())
