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
    update_fields = kwargs.get("update_fields")
    # 头像、昵称等局部保存不涉及手机号，不能因为哈希密钥变化而误触发绑定重验。
    if update_fields is not None and "phone" not in update_fields:
        instance._wecom_phone_changed = False
        return

    normalized = normalize_phone(instance.phone)
    next_hash = hash_phone(normalized)
    previous_normalized = ""
    if instance.pk:
        previous_phone = sender.objects.filter(pk=instance.pk).values_list("phone", flat=True).first() or ""
        previous_normalized = normalize_phone(previous_phone)
    instance.phone_hash = next_hash
    # 比较真实号码而不是 HMAC。SECRET_KEY/哈希密钥轮换不等于用户修改了手机号。
    instance._wecom_phone_changed = previous_normalized != normalized
    if instance._wecom_phone_changed:
        instance.phone_updated_at = timezone.now()


@receiver(post_save, sender=UserSettings)
def schedule_user_binding_match(sender, instance: UserSettings, created: bool, **kwargs):
    if not instance.user.is_active:
        return
    changed = bool(getattr(instance, "_wecom_phone_changed", False))
    if not created and not changed:
        # 资料正常保存时允许刷新哈希算法/密钥，但保持已验证绑定，不创建重匹配任务。
        if instance.phone_hash:
            UserWeComBinding.objects.filter(
                platform_user_id=instance.user_id,
                status=UserWeComBinding.Status.MATCHED,
            ).exclude(normalized_phone_hash=instance.phone_hash).update(
                normalized_phone_hash=instance.phone_hash,
            )
        return
    source = UserWeComBinding.Source.USER_CREATED if created else UserWeComBinding.Source.PHONE_UPDATED

    def enqueue():
        from .binding_service import mark_pending_and_dispatch
        mark_pending_and_dispatch(instance.user_id, source=source)

    transaction.on_commit(enqueue)
