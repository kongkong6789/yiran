"""
会议编排引擎。

推进机制:前端周期性调用 tick,每次让"下一位" Agent 发言一次;
发言始终围绕会议核心问题,并基于压缩后的上下文(而非全量历史)。
用户可随时 interject(插嘴),其内容并入上下文,后续发言据此调整。
stop 时产出最终方案文件。
"""
from concurrent.futures import ThreadPoolExecutor

from .models import Meeting, Message, AgentProfile, Deliverable
from . import llm
from . import knowledge
from . import deliverables_gen

# 每场会议的知识资料在会中不变,缓存避免每轮重复查 DuckDB/RAG
_KB_CACHE: dict[int, str] = {}


def _kb_for(m: Meeting) -> str:
    if m.id not in _KB_CACHE:
        _KB_CACHE[m.id] = knowledge.gather_knowledge(m.question)
    return _KB_CACHE[m.id]


def _agent_system_prompt(agent: AgentProfile, question: str) -> str:
    return (
        f"你叫{agent.name},角色是{agent.role or '通用顾问'},专长:{agent.expertise or '综合'}。"
        f"{agent.persona}\n"
        f"你正在参加一场圆桌会议,核心问题始终是:「{question}」。\n"
        "发言要求:像开会一样直接给出观点或具体方案,简短(2-4句),"
        "紧扣核心问题,可以回应/反驳其他人。"
        "尽量引用下方提供的『参考资料』中的具体制度/SOP/规则或业务数据(指标、异常)来支撑你的观点,"
        "不要脱离资料凭空空谈。不要输出任何分析过程或思考步骤,只给结论与建议。"
    )


def start_meeting(title: str, question: str, agent_ids: list[int]) -> Meeting:
    m = Meeting.objects.create(
        title=title or question[:30],
        question=question,
        status=Meeting.Status.ACTIVE,
    )
    m.participants.set(AgentProfile.objects.filter(id__in=agent_ids))
    Message.objects.create(
        meeting=m, speaker_type=Message.Speaker.SYSTEM, speaker_name="系统", emoji="📌",
        content=f"会议开始,核心问题:{question}", round=0,
    )
    return m


def _recent_contents(m: Meeting, limit: int = 8) -> list[str]:
    msgs = m.messages.exclude(speaker_type=Message.Speaker.SYSTEM).order_by("-id")[:limit]
    return [f"{x.speaker_name}:{x.content}" for x in reversed(list(msgs))]


def tick(m: Meeting) -> dict:
    """推进一轮:让下一位 Agent 发言一次。返回新消息。"""
    if m.status != Meeting.Status.ACTIVE:
        return {"stopped": True, "message": None}

    parts = list(m.participants.all())
    if not parts:
        return {"stopped": True, "message": None}

    idx = m.next_speaker_idx % len(parts)
    agent = parts[idx]
    m.round += 1

    # 最近一位非系统发言者(用于"接话/反驳")
    last = m.messages.exclude(speaker_type=Message.Speaker.SYSTEM).order_by("-id").first()
    prev_name = last.speaker_name if last and last.agent_id != agent.id else None

    # 最近一条用户插嘴(作为提示)
    last_user = (
        m.messages.filter(speaker_type=Message.Speaker.USER).order_by("-id").first()
    )
    user_hint = last_user.content if last_user else None

    # 汇聚知识:RAG 文档 + DuckDB 业务数据
    kb = knowledge.gather_knowledge(m.question)

    # 生成发言:优先真实 LLM
    system = _agent_system_prompt(agent, m.question)
    user = (
        (f"参考资料(请据此发言):\n{kb}\n\n" if kb else "")
        + f"当前会议纪要(压缩上下文):\n{m.context_summary or '(暂无)'}\n\n"
        + f"最近发言:\n" + "\n".join(_recent_contents(m)) + "\n\n"
        + (f"我(用户)刚插话:{user_hint}\n" if user_hint else "")
        + f"请围绕「{m.question}」发表你的下一轮观点,并尽量引用上面的资料。"
    )
    content = llm.chat(system, user)
    if not content:
        content = llm.mock_speak(
            m.question, agent.name, agent.role, m.round, prev_name, user_hint
        )

    msg = Message.objects.create(
        meeting=m, speaker_type=Message.Speaker.AGENT, speaker_name=agent.name,
        emoji=agent.emoji, agent=agent, content=content, round=m.round,
    )

    # 更新压缩上下文
    m.context_summary = llm.compress_context(
        m.question, m.context_summary, _recent_contents(m)
    )
    m.next_speaker_idx = (idx + 1) % len(parts)
    m.save(update_fields=["round", "next_speaker_idx", "context_summary"])

    # 每完成一整轮(所有人发言一次)迭代一次方案草稿
    if m.next_speaker_idx == 0:
        _refresh_deliverable(m, draft=True)

    return {"stopped": False, "message": _msg_dict(msg)}


def _speak_once(agent: AgentProfile, question: str, context_summary: str,
                recent: list[str], user_hint: str | None, kb: str, round_no: int) -> str:
    """单个 Agent 基于共享上下文生成一次发言(供并发调用,内部不碰 DB)。"""
    system = _agent_system_prompt(agent, question)
    user = (
        (f"参考资料(请据此发言):\n{kb}\n\n" if kb else "")
        + f"当前会议纪要(压缩上下文):\n{context_summary or '(暂无)'}\n\n"
        + f"最近发言:\n" + "\n".join(recent) + "\n\n"
        + (f"我(用户)刚插话:{user_hint}\n" if user_hint else "")
        + f"请围绕「{question}」发表你的下一轮观点,并尽量引用上面的资料。"
    )
    content = llm.chat(system, user, max_tokens=260, model=llm.fast_model(), timeout=25)
    if not content:
        content = llm.mock_speak(question, agent.name, agent.role, round_no, None, user_hint)
    return content


def tick_round(m: Meeting) -> dict:
    """并发推进一整轮:所有参会 Agent 基于同一份上下文同时发言。

    上下文关联保持不变:本轮所有人共享「上一轮压缩纪要 + 最近发言」,
    发言全部产生后再统一压缩进纪要,供下一轮使用。
    """
    if m.status != Meeting.Status.ACTIVE:
        return {"stopped": True, "messages": []}

    parts = list(m.participants.all())
    if not parts:
        return {"stopped": True, "messages": []}

    m.round += 1
    round_no = m.round

    # 共享上下文(所有人一致):压缩纪要 + 最近发言 + 最近一条用户插话
    kb = _kb_for(m)
    context_summary = m.context_summary
    recent = _recent_contents(m)
    last_user = m.messages.filter(speaker_type=Message.Speaker.USER).order_by("-id").first()
    user_hint = last_user.content if last_user else None

    # 并发生成本轮所有发言
    with ThreadPoolExecutor(max_workers=min(8, len(parts))) as pool:
        contents = list(
            pool.map(
                lambda a: _speak_once(a, m.question, context_summary, recent, user_hint, kb, round_no),
                parts,
            )
        )

    # 统一落库(串行写,避免 SQLite 并发写冲突)
    created: list[Message] = []
    for agent, content in zip(parts, contents):
        created.append(
            Message.objects.create(
                meeting=m, speaker_type=Message.Speaker.AGENT, speaker_name=agent.name,
                emoji=agent.emoji, agent=agent, content=content, round=round_no,
            )
        )

    # 本轮结束后更新压缩上下文:讨论中用本地启发式压缩(不发网络请求)以提速
    m.context_summary = llm.compress_context(
        m.question, m.context_summary, _recent_contents(m), allow_llm=False
    )
    m.next_speaker_idx = 0
    m.save(update_fields=["round", "next_speaker_idx", "context_summary"])

    # 方案草稿较重(长文本 LLM),不必每轮生成:每 3 轮迭代一次
    if round_no % 3 == 0:
        _refresh_deliverable(m, draft=True)

    return {"stopped": False, "messages": [_msg_dict(x) for x in created]}


def interject(m: Meeting, text: str) -> dict:
    msg = Message.objects.create(
        meeting=m, speaker_type=Message.Speaker.USER, speaker_name="我", emoji="🧑",
        content=text, round=m.round,
    )
    m.context_summary = llm.compress_context(
        m.question, m.context_summary, _recent_contents(m)
    )
    m.save(update_fields=["context_summary"])
    return _msg_dict(msg)


def _all_points(m: Meeting) -> list[str]:
    return [
        f"{x.speaker_name}:{x.content}"
        for x in m.messages.filter(speaker_type=Message.Speaker.AGENT)
    ]


def _refresh_deliverable(m: Meeting, draft: bool) -> Deliverable:
    """会中草稿:仅更新 Markdown 方案。"""
    kb = _kb_for(m)
    content = llm.synthesize_plan(m.question, m.context_summary, _all_points(m), knowledge=kb)
    last = m.deliverables.filter(kind=Deliverable.Kind.MARKDOWN).first()
    version = (last.version + 1) if last else 1
    title = ("[草稿] " if draft else "") + f"{m.question[:24]} 方案"
    return Deliverable.objects.create(
        meeting=m,
        kind=Deliverable.Kind.MARKDOWN,
        title=title,
        filename=deliverables_gen._safe_filename(title.replace("[草稿] ", ""), "md"),
        content=content,
        version=version,
    )


def _generate_final_deliverables(m: Meeting) -> list[Deliverable]:
    """会议结束:生成 Markdown 方案 + HTML 分析报告 + Excel 指标表。"""
    kb = _kb_for(m)
    points = _all_points(m)
    md_content = llm.synthesize_plan(m.question, m.context_summary, points, knowledge=kb)
    last = m.deliverables.filter(kind=Deliverable.Kind.MARKDOWN).exclude(title__startswith="[草稿]").first()
    version = (last.version + 1) if last else 1
    base_title = m.question[:24]

    md = Deliverable.objects.create(
        meeting=m,
        kind=Deliverable.Kind.MARKDOWN,
        title=f"{base_title} 方案",
        filename=deliverables_gen._safe_filename(base_title + "_方案", "md"),
        content=md_content,
        version=version,
    )

    html_content = deliverables_gen.build_html_report(m, md_content, points)
    html = Deliverable.objects.create(
        meeting=m,
        kind=Deliverable.Kind.HTML,
        title=f"{base_title} 分析报告",
        filename=deliverables_gen._safe_filename(base_title + "_分析报告", "html"),
        content=html_content,
        version=version,
    )

    xlsx_bytes = deliverables_gen.build_xlsx_bytes(
        m, list(m.messages.exclude(speaker_type=Message.Speaker.SYSTEM).order_by("id"))
    )
    xlsx = Deliverable.objects.create(
        meeting=m,
        kind=Deliverable.Kind.XLSX,
        title=f"{base_title} 指标表",
        filename=deliverables_gen._safe_filename(base_title + "_指标", "xlsx"),
        content=__import__("base64").b64encode(xlsx_bytes).decode("ascii"),
        version=version,
    )
    return [md, html, xlsx]


def stop(m: Meeting) -> dict:
    """结束会议并生成最终方案;已结束的会议直接返回已有方案(幂等)。"""
    if m.status == Meeting.Status.STOPPED:
        finals = _final_deliverables(m)
        if finals:
            return {
                "deliverables": [_deliverable_dict(d) for d in finals],
                "deliverable": _deliverable_dict(finals[0]),
                "graph": {"already_stopped": True},
            }
        return {"error": "会议已结束但无方案记录"}

    m.status = Meeting.Status.STOPPED
    m.save(update_fields=["status"])
    Message.objects.create(
        meeting=m, speaker_type=Message.Speaker.SYSTEM, speaker_name="系统", emoji="✅",
        content="会议结束,正在生成方案(Markdown)、HTML 分析报告与 Excel 指标表…", round=m.round,
    )
    items = _generate_final_deliverables(m)
    _KB_CACHE.pop(m.id, None)

    from . import writeback
    graph = writeback.writeback_meeting(m, items[0])

    return {
        "deliverables": [_deliverable_dict(d) for d in items],
        "deliverable": _deliverable_dict(items[0]),
        "graph": graph,
    }


def _final_deliverables(m: Meeting) -> list[Deliverable]:
    """取最新一轮的最终产物(md/html/xlsx),排除草稿。"""
    latest_ver = (
        m.deliverables.exclude(title__startswith="[草稿]")
        .order_by("-version")
        .values_list("version", flat=True)
        .first()
    )
    if not latest_ver:
        return []
    return list(
        m.deliverables.filter(version=latest_ver)
        .exclude(title__startswith="[草稿]")
        .order_by("kind")
    )


def _msg_dict(x: Message) -> dict:
    return {
        "id": x.id,
        "speaker_type": x.speaker_type,
        "speaker_name": x.speaker_name,
        "emoji": x.emoji,
        "agent_id": x.agent_id,
        "content": x.content,
        "round": x.round,
        "created_at": x.created_at.isoformat(),
    }


def _deliverable_dict(x: Deliverable) -> dict:
    return {
        "id": x.id,
        "kind": x.kind,
        "title": x.title,
        "filename": x.filename or f"deliverable.{x.kind}",
        "content": x.content if x.kind != Deliverable.Kind.XLSX else "",
        "has_binary": x.kind == Deliverable.Kind.XLSX,
        "version": x.version,
        "created_at": x.created_at.isoformat(),
    }
