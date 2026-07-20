from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from .models import WeComApiConfig, WeComContact
from .services import WeComApiError, WeComClient


def _as_api_contact(row: WeComContact) -> dict:
    return {
        "contactId": row.id,
        "key": f"contact:{row.id}",
        "name": row.name,
        "department": row.department,
        "departmentIds": row.department_ids,
        "weComUserId": row.wecom_userid,
        "position": row.position,
        "avatar": row.avatar_url,
        "available": row.available,
        "source": "wecom",
    }


def get_cached_contacts(config: WeComApiConfig) -> list[dict]:
    return [_as_api_contact(row) for row in config.contacts.all()]


def sync_contacts(config: WeComApiConfig) -> list[dict]:
    """Fetch once from WeCom and atomically replace the current user's contact snapshot."""
    try:
        remote = WeComClient(config).get_visible_contacts()
    except WeComApiError as exc:
        WeComApiConfig.objects.filter(pk=config.pk).update(contacts_sync_error=exc.detail[:500])
        raise

    now = timezone.now()
    seen: list[str] = []
    with transaction.atomic():
        locked = WeComApiConfig.objects.select_for_update().get(pk=config.pk)
        for item in remote:
            user_id = str(item["weComUserId"])
            seen.append(user_id)
            WeComContact.objects.update_or_create(
                config=locked,
                wecom_userid=user_id,
                defaults={
                    "name": str(item.get("name") or user_id),
                    "department": str(item.get("department") or ""),
                    "department_ids": list(item.get("departmentIds") or []),
                    "position": str(item.get("position") or ""),
                    "avatar_url": str(item.get("avatar") or ""),
                    "available": bool(item.get("available", True)),
                    "synced_at": now,
                },
            )
        stale = WeComContact.objects.filter(config=locked)
        if seen:
            stale = stale.exclude(wecom_userid__in=seen)
        stale.update(available=False, synced_at=now)
        locked.contacts_synced_at = now
        locked.contacts_sync_error = ""
        locked.save(update_fields=["contacts_synced_at", "contacts_sync_error", "updated_at"])
    config.refresh_from_db(fields=["contacts_synced_at", "contacts_sync_error"])
    return get_cached_contacts(config)
