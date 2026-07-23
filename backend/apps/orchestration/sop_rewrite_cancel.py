"""Cooperative cancel flags for SOP AI rewrite jobs."""

from __future__ import annotations

from django.core.cache import cache

_TTL_SECONDS = 15 * 60


def _key(rewrite_id: str) -> str:
    return f"sop_rewrite_cancel:{rewrite_id}"


def mark_rewrite_cancelled(rewrite_id: str) -> None:
    rid = str(rewrite_id or "").strip()
    if not rid:
        return
    cache.set(_key(rid), 1, _TTL_SECONDS)


def is_rewrite_cancelled(rewrite_id: str) -> bool:
    rid = str(rewrite_id or "").strip()
    if not rid:
        return False
    return bool(cache.get(_key(rid)))


def clear_rewrite_cancel(rewrite_id: str) -> None:
    rid = str(rewrite_id or "").strip()
    if not rid:
        return
    cache.delete(_key(rid))
