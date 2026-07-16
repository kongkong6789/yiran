from __future__ import annotations

from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from apps.core.models import UserSettings

from .models import UserWeComBinding
from .phone import hash_phone, normalize_phone


@receiver(pre_save, sender=UserSettings)
def normalize_user_phone(sender, instance: UserSettings, **kwargs):
    normalized = normalize_phone(instance.phone)
    next_hash = hash_phone(normalized)
    previous_hash = ""
    if instance.pk:
        previous_hash = sender.objects.filter(pk=instance.pk).values_list("phone_hash", flat=True).first() or ""
    instance.phone_hash = next_hash
    instance._wecom_phone_changed = previous_hash != next_hash
    if instance._wecom_phone_changed:
        instance.phone_updated_at = timezone.now()


@receiver(post_save, sender=UserSettings)
def schedule_user_binding_match(sender, instance: UserSettings, created: bool, **kwargs):
    if not instance.user.is_active:
        return
    changed = bool(getattr(instance, "_wecom_phone_changed", False))
    if not created and not changed:
        return
    source = UserWeComBinding.Source.USER_CREATED if created else UserWeComBinding.Source.PHONE_UPDATED

    def enqueue():
        from .binding_service import mark_pending_and_dispatch
        mark_pending_and_dispatch(instance.user_id, source=source)

    transaction.on_commit(enqueue)
