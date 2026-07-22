"""在线心跳与判定。"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from .models import CollabPresence

# 超过该秒数未心跳视为离线
ONLINE_WINDOW_SECONDS = 75


# 心跳写入节流：远程库上每次 UPDATE 很贵，短时间内重复 touch 直接复用
TOUCH_MIN_INTERVAL_SECONDS = 20


def touch_presence(user) -> CollabPresence:
    row, created = CollabPresence.objects.get_or_create(user=user)
    if created:
        return row
    # auto_now 需显式 save 才会刷新；未过节流窗口则跳过写库
    if row.last_seen and row.last_seen >= timezone.now() - timedelta(seconds=TOUCH_MIN_INTERVAL_SECONDS):
        return row
    row.save(update_fields=["last_seen"])
    return row


def is_online(last_seen) -> bool:
    if not last_seen:
        return False
    return last_seen >= timezone.now() - timedelta(seconds=ONLINE_WINDOW_SECONDS)


def presence_map(user_ids: list[int]) -> dict[int, dict]:
    if not user_ids:
        return {}
    # Presence is a product-level concept, not just a heartbeat-table lookup.
    # Service bots do not emit browser heartbeats, but they are available while
    # the service is running.  Resolve users and heartbeats in one LEFT JOIN so
    # every caller (room detail, lightweight payloads, SSE and batch queries)
    # receives the same answer.
    from .mentions import XIAOCE_BOT_USERNAME

    normalized_ids = list(dict.fromkeys(int(uid) for uid in user_ids))
    rows = get_user_model().objects.filter(id__in=normalized_ids).values_list(
        "id",
        "username",
        "collab_presence__last_seen",
    )
    by_id = {
        user_id: (username, last_seen)
        for user_id, username, last_seen in rows
    }
    out: dict[int, dict] = {}
    for uid in normalized_ids:
        username, seen = by_id.get(uid, ("", None))
        out[uid] = {
            "online": username == XIAOCE_BOT_USERNAME or is_online(seen),
            "last_seen": seen.isoformat() if seen else None,
        }
    return out
