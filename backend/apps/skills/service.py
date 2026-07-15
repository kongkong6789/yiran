"""Skill 匹配与注入。"""
from __future__ import annotations

import re
from typing import Any

from .models import UserSkill

MENTION_RE = re.compile(r"@([a-zA-Z0-9_\-\u4e00-\u9fff]+)")


def list_user_skills(user, *, enabled_only: bool = False) -> list[UserSkill]:
    qs = UserSkill.objects.filter(user=user).select_related("source_asset")
    if enabled_only:
        qs = qs.filter(enabled=True)
    return list(qs.order_by("-updated_at"))


def resolve_skills(
    message: str,
    user,
    *,
    skill_ids: list[str] | None = None,
) -> list[UserSkill]:
    """根据 @mention、显式 skill_ids 解析要加载的 Skill。"""
    if user is None or not getattr(user, "is_authenticated", False):
        return []

    explicit = {str(s).strip() for s in (skill_ids or []) if str(s).strip()}
    for token in MENTION_RE.findall(message or ""):
        explicit.add(token.strip())

    if not explicit:
        return []

    skills = list_user_skills(user, enabled_only=True)
    by_id = {s.skill_id: s for s in skills}
    by_name = {s.name: s for s in skills}

    picked: list[UserSkill] = []
    seen: set[int] = set()
    for key in explicit:
        row = by_id.get(key) or by_name.get(key)
        if row and row.id not in seen:
            picked.append(row)
            seen.add(row.id)
    return picked


def build_skill_system_block(skills: list[UserSkill]) -> str:
    if not skills:
        return ""
    parts = [
        "\n\n---",
        "以下 Skill 已加载,请严格按其中流程与约束执行(优先级高于通用回答风格):",
    ]
    for skill in skills:
        parts.append(f"\n## Skill: {skill.name} (`{skill.skill_id}`)")
        if skill.description:
            parts.append(f"描述: {skill.description}")
        parts.append(skill.instructions or skill.raw_content)
    return "\n".join(parts)


def skills_payload(skills: list[UserSkill]) -> list[dict[str, Any]]:
    return [
        {
            "skill_id": s.skill_id,
            "name": s.name,
            "description": s.description,
        }
        for s in skills
    ]
