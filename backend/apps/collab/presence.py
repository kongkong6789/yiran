"""在线心跳与判定。"""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone

from .models import CollabPresence

# 超过该秒数未心跳视为离线
ONLINE_WINDOW_SECONDS = 75


def touch_presence(user) -> CollabPresence:
    row, _ = CollabPresence.objects.get_or_create(user=user)
    # auto_now 需显式 save 才会刷新
    row.save(update_fields=["last_seen"])
    return row


def is_online(last_seen) -> bool:
    if not last_seen:
        return False
    return last_seen >= timezone.now() - timedelta(seconds=ONLINE_WINDOW_SECONDS)


def presence_map(user_ids: list[int]) -> dict[int, dict]:
    if not user_ids:
        return {}
    rows = CollabPresence.objects.filter(user_id__in=user_ids)
    by_id = {r.user_id: r.last_seen for r in rows}
    out: dict[int, dict] = {}
    for uid in user_ids:
        seen = by_id.get(uid)
        out[uid] = {
            "online": is_online(seen),
            "last_seen": seen.isoformat() if seen else None,
        }
    return out
