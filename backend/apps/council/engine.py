"""
会议编排引擎。

推进机制:前端周期性调用 tick,每次让"下一位" Agent 发言一次;
发言始终围绕会议核心问题,并基于压缩后的上下文(而非全量历史)。
用户可随时 interject(插嘴),其内容并入上下文,后续发言据此调整。
stop 时产出最终方案文件。
"""
from concurrent.futures import ThreadPoolExecutor
import re

from .models import Meeting, Message, AgentProfile, Deliverable
from . import llm
from . import knowledge
from . import deliverables_gen
from . import realtime as ws
from .capabilities import build_agent_capability_context

# 每场会议的知识资料在会中不变,缓存避免每轮重复查 DuckDB/RAG
_KB_CACHE: dict[int, str] = {}


def _kb_cached_only(m: Meeting) -> str:
    """仅用已缓存知识，不阻塞拉图谱/数仓（@ 回复提速）。"""
    return _KB_CACHE.get(m.id, "")


def _kb_for(m: Meeting) -> str:
    if m.id not in _KB_CACHE:
        try:
            _KB_CACHE[m.id] = knowledge.gather_knowledge(m.question)
        except Exception:
            _KB_CACHE[m.id] = ""
    return _KB_CACHE[m.id]


def _agent_system_prompt(agent: AgentProfile, question: str, skill_prompt: str = "") -> str:
    capability_rules = (
        f"\n能力调用规则：{agent.capability_instructions.strip()}\n"
        if agent.capability_instructions.strip()
        else ""
    )
    prompt = (
        f"你叫{agent.name},角色是{agent.role or '通用顾问'},专长:{agent.expertise or '综合'}。"
        f"{agent.persona}\n"
        f"{capability_rules}"
        f"你正在参加一场圆桌会议,核心问题始终是:「{question}」。\n"
        "发言要求:像开会一样直接给出观点或具体方案,简短(2-4句),"
        "紧扣核心问题,可以回应/反驳其他人。"
        "尽量引用下方提供的『参考资料』中的具体制度/SOP/规则或业务数据(指标、异常)来支撑你的观点,"
        "不要脱离资料凭空空谈。不要输出任何分析过程或思考步骤,只给结论与建议。"
    )
    if skill_prompt:
        prompt += f"\n{skill_prompt}"
    return prompt


def _agent_runtime_contexts(parts: list[AgentProfile], user, query: str) -> dict[int, dict]:
    """Resolve DB-backed capabilities before entering concurrent LLM workers."""
    return {
        agent.id: build_agent_capability_context(
            agent,
            user,
            query,
            record_usage=True,
        )
        for agent in parts
    }


def start_meeting(
    title: str,
    question: str,
    agent_ids: list[int],
    user_ids: list[int] | None = None,
    *,
    intro: str = "",
    scheduled_at=None,
    duration_minutes: int = 60,
    start_now: bool = True,
) -> Meeting:
    from django.contrib.auth import get_user_model
    from django.utils import timezone

    User = get_user_model()
    q = (question or "").strip() or (intro or "").strip() or (title or "").strip() or "圆桌讨论"
    status = Meeting.Status.ACTIVE if start_now else Meeting.Status.DRAFT
    m = Meeting.objects.create(
        title=(title or q[:30]).strip() or "圆桌会议",
        question=q,
        intro=(intro or "").strip(),
        scheduled_at=scheduled_at,
        duration_minutes=max(15, int(duration_minutes or 60)),
        status=status,
        started_at=timezone.now() if start_now else None,
    )
    m.participants.set(AgentProfile.objects.filter(id__in=agent_ids))
    users = list(User.objects.filter(id__in=(user_ids or [])))
    if users:
        m.human_participants.set(users)

    agent_names = "、".join(f"{a.emoji}{a.name}" for a in m.participants.all()) or "无"
    human_names = "、".join(_display_name(u) for u in users) or "无"
    if start_now:
        sys_msg = Message.objects.create(
            meeting=m, speaker_type=Message.Speaker.SYSTEM, speaker_name="系统", emoji="📌",
            content=(
                f"会议开始，核心问题：{q}\n"
                f"AI 对象：{agent_names}\n"
                f"参会同事：{human_names}"
            ),
            round=0,
        )
        ws.publish_messages(m, [_msg_dict(sys_msg)])
        ws.publish_status(m)
    else:
        sys_msg = Message.objects.create(
            meeting=m, speaker_type=Message.Speaker.SYSTEM, speaker_name="系统", emoji="📝",
            content=(
                f"会议草稿已保存：{m.title}\n"
                f"AI 对象：{agent_names}\n"
                f"参会同事：{human_names}\n"
                "待主持人点击「开始会议」后正式讨论。"
            ),
            round=0,
        )
        ws.publish_messages(m, [_msg_dict(sys_msg)])
        ws.publish_status(m)
    return m


def activate_meeting(m: Meeting) -> Meeting:
    """草稿/暂停 → 进行中。"""
    from django.utils import timezone

    if m.status == Meeting.Status.ACTIVE:
        return m
    if m.status == Meeting.Status.STOPPED:
        raise ValueError("会议已结束，无法再次开始")

    was_paused = m.status == Meeting.Status.PAUSED
    m.status = Meeting.Status.ACTIVE
    if not m.started_at:
        m.started_at = timezone.now()
    m.save(update_fields=["status", "started_at"])

    if was_paused:
        sys_msg = Message.objects.create(
            meeting=m,
            speaker_type=Message.Speaker.SYSTEM,
            speaker_name="系统",
            emoji="▶️",
            content="会议已恢复，继续讨论。",
            round=m.round,
        )
        ws.publish_messages(m, [_msg_dict(sys_msg)])
        ws.publish_status(m)
        return m

    agent_names = "、".join(f"{a.emoji}{a.name}" for a in m.participants.all()) or "无"
    human_names = "、".join(_display_name(u) for u in m.human_participants.all()) or "无"
    sys_msg = Message.objects.create(
        meeting=m,
        speaker_type=Message.Speaker.SYSTEM,
        speaker_name="系统",
        emoji="▶️",
        content=(
            f"会议正式开始，核心问题：{m.question}\n"
            f"AI 对象：{agent_names}\n"
            f"参会同事：{human_names}"
        ),
        round=m.round,
    )
    ws.publish_messages(m, [_msg_dict(sys_msg)])
    ws.publish_status(m)
    return m


def pause_meeting(m: Meeting) -> Meeting:
    """进行中 → 已暂停（可稍后恢复，不生成结束产物）。"""
    if m.status == Meeting.Status.PAUSED:
        return m
    if m.status == Meeting.Status.STOPPED:
        raise ValueError("会议已结束，无法暂停")
    if m.status == Meeting.Status.DRAFT:
        raise ValueError("待开始的会议无需暂停，可直接保留在列表")

    m.status = Meeting.Status.PAUSED
    m.save(update_fields=["status"])
    sys_msg = Message.objects.create(
        meeting=m,
        speaker_type=Message.Speaker.SYSTEM,
        speaker_name="系统",
        emoji="⏸",
        content="会议已暂停，可稍后从列表恢复。",
        round=m.round,
    )
    ws.publish_messages(m, [_msg_dict(sys_msg)])
    ws.publish_status(m)
    return m


def pause_active_meetings(*, meeting_ids: list[int] | None = None) -> list[Meeting]:
    """批量暂停进行中的会议。meeting_ids 为空则暂停全部 active。"""
    qs = Meeting.objects.filter(status=Meeting.Status.ACTIVE)
    if meeting_ids:
        qs = qs.filter(id__in=meeting_ids)
    paused = []
    for m in qs:
        pause_meeting(m)
        paused.append(m)
    return paused


def _display_name(user) -> str:
    try:
        settings = user.settings  # OneToOne UserSettings
        name = (getattr(settings, "display_name", None) or "").strip()
        if name:
            return name
    except Exception:
        pass
    return user.get_username()


def invite_participants(
    m: Meeting,
    agent_ids: list[int] | None = None,
    user_ids: list[int] | None = None,
) -> tuple[Meeting, list]:
    """会中继续拉 Agent / 同事入会。返回 (meeting, 新加入的同事列表)。"""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    added_agents = []
    added_users = []

    if agent_ids:
        qs = AgentProfile.objects.filter(id__in=agent_ids).exclude(
            id__in=m.participants.values_list("id", flat=True)
        )
        for a in qs:
            m.participants.add(a)
            added_agents.append(a)

    if user_ids:
        qs = User.objects.filter(id__in=user_ids).exclude(
            id__in=m.human_participants.values_list("id", flat=True)
        )
        for u in qs:
            m.human_participants.add(u)
            added_users.append(u)

    bits = []
    if added_agents:
        bits.append("AI：" + "、".join(f"{a.emoji}{a.name}" for a in added_agents))
    if added_users:
        bits.append("同事：" + "、".join(_display_name(u) for u in added_users))
    if bits:
        sys_msg = Message.objects.create(
            meeting=m,
            speaker_type=Message.Speaker.SYSTEM,
            speaker_name="系统",
            emoji="➕",
            content="新成员加入：" + "；".join(bits),
            round=m.round,
        )
        ws.publish_messages(m, [_msg_dict(sys_msg)])
    return m, added_users


def interject(m: Meeting, text: str, speaker_name: str | None = None, *, user=None) -> dict:
    """用户插话。仅当文中 @ 了参会 Agent（或 @所有人）时，才触发对应 Agent 回复。"""
    name = (speaker_name or "").strip() or "我"
    msg = Message.objects.create(
        meeting=m, speaker_type=Message.Speaker.USER, speaker_name=name, emoji="🧑",
        content=text, round=m.round,
    )
    # 立刻推送给会议室其他人（不必等 Agent 回复）
    ws.publish_messages(m, [_msg_dict(msg)])

    # 普通发送：本地启发式压缩纪要，不调 LLM，保证秒回
    m.context_summary = llm.compress_context(
        m.question, m.context_summary, _recent_contents(m), allow_llm=False,
    )
    m.save(update_fields=["context_summary"])

    replies: list[dict] = []
    if m.status == Meeting.Status.ACTIVE:
        parts = list(m.participants.all())
        mentioned = _mentioned_agents(text, parts)
        if mentioned:
            # 不阻塞查图谱；有缓存才带资料。多 Agent 并发回复。
            kb = _kb_cached_only(m)
            recent = _recent_contents(m)
            summary = m.context_summary
            runtime_contexts = _agent_runtime_contexts(mentioned, user, text)
            m.round += 1
            round_no = m.round

            def _gen(agent: AgentProfile) -> tuple[AgentProfile, str]:
                capability = runtime_contexts.get(agent.id) or {}
                agent_kb = "\n\n".join(
                    item for item in [kb, capability.get("knowledge_prompt", "")] if item
                )
                return agent, _reply_to_mention(
                    agent,
                    m.question,
                    summary,
                    recent,
                    text,
                    agent_kb,
                    round_no,
                    skill_prompt=capability.get("skill_prompt", ""),
                )

            with ThreadPoolExecutor(max_workers=min(6, len(mentioned))) as pool:
                generated = list(pool.map(_gen, mentioned))

            for agent, content in generated:
                agent_msg = Message.objects.create(
                    meeting=m,
                    speaker_type=Message.Speaker.AGENT,
                    speaker_name=agent.name,
                    emoji=agent.emoji,
                    agent=agent,
                    content=content,
                    round=round_no,
                )
                replies.append(_msg_dict(agent_msg))

            m.context_summary = llm.compress_context(
                m.question, m.context_summary, _recent_contents(m), allow_llm=False,
            )
            m.save(update_fields=["round", "context_summary"])
            if replies:
                ws.publish_messages(m, replies)

    return {"message": _msg_dict(msg), "replies": replies}


def _recent_contents(m: Meeting, limit: int = 8) -> list[str]:
    msgs = m.messages.exclude(speaker_type=Message.Speaker.SYSTEM).order_by("-id")[:limit]
    return [f"{x.speaker_name}:{x.content}" for x in reversed(list(msgs))]


def _mentioned_agents(text: str | None, parts: list[AgentProfile]) -> list[AgentProfile]:
    """解析 @Agent名 / @所有人，返回需要回复的 Agent 列表（去重保序）。"""
    if not text or not parts:
        return []
    if re.search(r"@(?:所有人|全体|全体成员|everyone|all)\b", text, flags=re.IGNORECASE):
        return list(parts)
    found: list[AgentProfile] = []
    seen: set[int] = set()
    for agent in parts:
        name = (agent.name or "").strip()
        if not name:
            continue
        if re.search(rf"@{re.escape(name)}(?:\s|$|[，,。.!！？?])", text) or f"@{name}" in text:
            if agent.id not in seen:
                seen.add(agent.id)
                found.append(agent)
    return found


def _mentioned_agent_index(text: str | None, parts: list[AgentProfile]) -> int | None:
    """兼容旧逻辑：返回第一个被 @ 的 Agent 下标。"""
    mentioned = _mentioned_agents(text, parts)
    if not mentioned:
        return None
    target_id = mentioned[0].id
    for i, agent in enumerate(parts):
        if agent.id == target_id:
            return i
    return None


def _reply_to_mention(
    agent: AgentProfile,
    question: str,
    context_summary: str,
    recent: list[str],
    user_text: str,
    kb: str,
    round_no: int,
    skill_prompt: str = "",
) -> str:
    """被 @ 后针对用户这句话作答（不主动空转发言）。"""
    system = _agent_system_prompt(agent, question, skill_prompt) + "\n用户 @ 了你，直接回答，2～3 句。"
    # 控制 prompt 体积，降低延迟
    recent_tail = "\n".join(recent[-4:])
    summary_tail = (context_summary or "")[-400:]
    user = (
        (f"参考资料(节选):\n{kb[:600]}\n\n" if kb else "")
        + (f"纪要:\n{summary_tail}\n\n" if summary_tail else "")
        + (f"最近发言:\n{recent_tail}\n\n" if recent_tail else "")
        + f"用户说:\n{user_text}\n\n请回复。"
    )
    content = llm.chat(
        system, user, temperature=0.5, max_tokens=180, model=llm.fast_model(), timeout=12,
    )
    if not content:
        content = llm.mock_speak(question, agent.name, agent.role, round_no, None, user_text)
    return content


def tick(m: Meeting, *, user=None) -> dict:
    """推进一轮:让下一位 Agent 发言一次。返回新消息。"""
    if m.status != Meeting.Status.ACTIVE:
        return {"stopped": True, "message": None}

    parts = list(m.participants.all())
    if not parts:
        return {"stopped": True, "message": None}

    # 最近一条用户插嘴(作为提示)；若刚点名 @Agent 且对方尚未接话，优先让其发言
    last_user = (
        m.messages.filter(speaker_type=Message.Speaker.USER).order_by("-id").first()
    )
    user_hint = last_user.content if last_user else None
    last_any = m.messages.exclude(speaker_type=Message.Speaker.SYSTEM).order_by("-id").first()
    mentioned_idx = None
    if last_user and last_any and last_any.id == last_user.id:
        mentioned_idx = _mentioned_agent_index(user_hint, parts)
    idx = mentioned_idx if mentioned_idx is not None else (m.next_speaker_idx % len(parts))
    agent = parts[idx]
    m.round += 1

    # 最近一位非系统发言者(用于"接话/反驳")
    last = last_any
    prev_name = last.speaker_name if last and last.agent_id != agent.id else None

    # 汇聚知识:RAG 文档 + DuckDB 业务数据
    kb = knowledge.gather_knowledge(m.question)

    # 生成发言:优先真实 LLM
    capability = build_agent_capability_context(
        agent,
        user,
        m.question,
        record_usage=True,
    )
    system = _agent_system_prompt(agent, m.question, capability.get("skill_prompt", ""))
    selected_kb = capability.get("knowledge_prompt", "")
    kb = "\n\n".join(item for item in [kb, selected_kb] if item)
    user_prompt = (
        (f"参考资料(请据此发言):\n{kb}\n\n" if kb else "")
        + f"当前会议纪要(压缩上下文):\n{m.context_summary or '(暂无)'}\n\n"
        + f"最近发言:\n" + "\n".join(_recent_contents(m)) + "\n\n"
        + (f"我(用户)刚插话:{user_hint}\n" if user_hint else "")
        + f"请围绕「{m.question}」发表你的下一轮观点,并尽量引用上面的资料。"
    )
    content = llm.chat(system, user_prompt)
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

    ws.publish_messages(m, [_msg_dict(msg)])
    return {"stopped": False, "message": _msg_dict(msg)}


def _speak_once(agent: AgentProfile, question: str, context_summary: str,
                recent: list[str], user_hint: str | None, kb: str, round_no: int,
                skill_prompt: str = "") -> str:
    """单个 Agent 基于共享上下文生成一次发言(供并发调用,内部不碰 DB)。"""
    system = _agent_system_prompt(agent, question, skill_prompt)
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


def tick_round(m: Meeting, *, user=None) -> dict:
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
    runtime_contexts = _agent_runtime_contexts(parts, user, m.question)

    # 并发生成本轮所有发言
    with ThreadPoolExecutor(max_workers=min(8, len(parts))) as pool:
        contents = list(
            pool.map(
                lambda a: _speak_once(
                    a,
                    m.question,
                    context_summary,
                    recent,
                    user_hint,
                    "\n\n".join(
                        item for item in [kb, (runtime_contexts.get(a.id) or {}).get("knowledge_prompt", "")]
                        if item
                    ),
                    round_no,
                    skill_prompt=(runtime_contexts.get(a.id) or {}).get("skill_prompt", ""),
                ),
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

    payload = [_msg_dict(x) for x in created]
    ws.publish_messages(m, payload)
    return {"stopped": False, "messages": payload}


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
    sys_msg = Message.objects.create(
        meeting=m, speaker_type=Message.Speaker.SYSTEM, speaker_name="系统", emoji="✅",
        content="会议结束,正在生成方案(Markdown)、HTML 分析报告与 Excel 指标表…", round=m.round,
    )
    ws.publish_messages(m, [_msg_dict(sys_msg)])
    ws.publish_status(m)
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
