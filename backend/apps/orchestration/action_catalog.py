"""Unified SOP / orchestration action catalog: builtin contracts + skill center."""
from __future__ import annotations

from apps.ontology.registry import list_actions

from .skill_actions import list_skill_catalog_actions


def list_catalog_actions(*, user=None, sop_ready_only: bool = True) -> list[dict]:
    """Actions selectable in SOP editor / AI rewrite / catalog API."""
    builtins = list_actions(sop_ready_only=sop_ready_only)
    out: list[dict] = []
    for item in builtins:
        row = dict(item)
        row.setdefault("group", "system")
        row.setdefault("source", "builtin")
        row.setdefault("description", "")
        out.append(row)
    if user is not None:
        out.extend(list_skill_catalog_actions(user=user))
    return out
