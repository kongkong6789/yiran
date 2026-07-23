"""Resolve an AgentProfile's bound skills / knowledge into prompt context."""
from __future__ import annotations

from typing import Any

from apps.skills.models import UserSkill
from apps.skills.service import build_skill_system_block, skills_payload

from .models import AgentProfile


def build_agent_capability_context(
    agent: AgentProfile | None,
    user,
    query: str = "",
) -> dict[str, Any]:
    """Build capability summary + prompt fragments for orchestration / meetings.

    Returns keys used by callers:
    - prompt: combined text injected into intent recognition / system context
    - skill_prompt: skill instructions block for meeting speakers
    - knowledge_prompt: selected knowledge excerpts
    - skills: list[{skill_id, name, description}]
    - knowledge_bases: list of visible KB summaries
    - configured_knowledge_base_ids: raw ids bound on the agent
    """
    empty = {
        "prompt": "",
        "skill_prompt": "",
        "knowledge_prompt": "",
        "skills": [],
        "knowledge_bases": [],
        "configured_knowledge_base_ids": [],
        "capability_instructions": "",
    }
    if agent is None:
        return empty

    skill_ids = [str(s).strip() for s in (agent.skill_ids or []) if str(s).strip()]
    skills: list[UserSkill] = []
    if skill_ids and user is not None and getattr(user, "is_authenticated", False):
        by_id = {
            row.skill_id: row
            for row in UserSkill.objects.filter(user=user, skill_id__in=skill_ids, enabled=True)
        }
        # Preserve agent binding order; fall back to any matching row for the id.
        missing = [sid for sid in skill_ids if sid not in by_id]
        if missing:
            for row in UserSkill.objects.filter(skill_id__in=missing, enabled=True).order_by("id"):
                by_id.setdefault(row.skill_id, row)
        skills = [by_id[sid] for sid in skill_ids if sid in by_id]

    skill_prompt = build_skill_system_block(skills).strip()
    instructions = (agent.capability_instructions or "").strip()

    kb_ids = [int(x) for x in (agent.knowledge_base_ids or []) if str(x).strip().isdigit()]
    knowledge_bases: list[dict[str, Any]] = []
    knowledge_prompt = ""
    if kb_ids:
        try:
            from apps.knowledge.access import visible_knowledge_bases
            from apps.knowledge.traditional_rag import keyword_search, semantic_search
        except Exception:
            visible_knowledge_bases = None  # type: ignore
            keyword_search = semantic_search = None  # type: ignore

        if visible_knowledge_bases is not None and user is not None:
            qs = visible_knowledge_bases(user).filter(id__in=kb_ids)
            knowledge_bases = [
                {"id": kb.id, "name": kb.name, "visibility": kb.visibility}
                for kb in qs
            ]
            if query and (keyword_search or semantic_search):
                chunks: list[str] = []
                for kb in qs[:6]:
                    hits = []
                    try:
                        if semantic_search:
                            hits = semantic_search(query, knowledge_base=kb, top_k=2) or []
                    except Exception:
                        hits = []
                    if not hits and keyword_search:
                        try:
                            hits = keyword_search(query, knowledge_base=kb, top_k=2) or []
                        except Exception:
                            hits = []
                    for hit in hits[:2]:
                        text = ""
                        if isinstance(hit, dict):
                            text = str(hit.get("text") or hit.get("content") or hit.get("chunk") or "")
                        else:
                            text = str(getattr(hit, "text", "") or getattr(hit, "content", "") or "")
                        if text.strip():
                            chunks.append(f"[{kb.name}] {text.strip()[:1200]}")
                if chunks:
                    knowledge_prompt = "指定知识库摘录:\n" + "\n\n".join(chunks)

    prompt_parts = []
    if instructions:
        prompt_parts.append(f"能力调用规则:\n{instructions}")
    if skill_prompt:
        prompt_parts.append(skill_prompt)
    if knowledge_prompt:
        prompt_parts.append(knowledge_prompt)
    if knowledge_bases and not knowledge_prompt:
        names = ", ".join(kb["name"] for kb in knowledge_bases)
        prompt_parts.append(f"已绑定知识库: {names}")

    return {
        "prompt": "\n\n".join(prompt_parts).strip(),
        "skill_prompt": skill_prompt,
        "knowledge_prompt": knowledge_prompt,
        "skills": skills_payload(skills),
        "knowledge_bases": knowledge_bases,
        "configured_knowledge_base_ids": kb_ids,
        "capability_instructions": instructions,
    }
