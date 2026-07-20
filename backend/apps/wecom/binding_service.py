from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.core.models import UserSettings
from apps.core.organizations import current_organization, organization_user_ids

from .models import (
    UserWeComBinding,
    WeComApiConfig,
    WeComBindingAuditLog,
    WeComBindingSyncJob,
    WeComContact,
)
from .phone import hash_phone, mask_phone, normalize_phone
from .services import WeComApiError, WeComClient


User = get_user_model()
RETRY_DELAYS = [timedelta(minutes=5), timedelta(minutes=30), timedelta(hours=2), timedelta(days=1)]


def _cache_wecom_member(config: WeComApiConfig, member: dict, *, wecom_userid: str = "") -> WeComContact:
    user_id = str(member.get("userid") or wecom_userid or "").strip()
    existing = WeComContact.objects.filter(config=config, wecom_userid=user_id).first()
    defaults = {
        "name": str(member.get("name") or user_id),
        "department_ids": list(member.get("department") or []),
        "position": str(member.get("position") or ""),
        "available": int(member.get("status", 1) or 1) == 1,
        "synced_at": timezone.now(),
        "department": existing.department if existing else "",
        "avatar_url": str(member.get("avatar") or "") or (existing.avatar_url if existing else ""),
    }
    contact, _ = WeComContact.objects.update_or_create(
        config=config,
        wecom_userid=user_id,
        defaults=defaults,
    )
    return contact


def resolve_binding_config(actor=None, config_user_id: int | None = None) -> WeComApiConfig | None:
    if config_user_id:
        return WeComApiConfig.objects.filter(user_id=config_user_id).first()
    if actor and getattr(actor, "is_authenticated", False):
        from .access import resolve_accessible_config
        config = resolve_accessible_config(actor)
        if config and config.configured:
            return config
    configured_id = int(getattr(settings, "WECOM_BINDING_CONFIG_USER_ID", 0) or 0)
    if configured_id:
        return WeComApiConfig.objects.filter(user_id=configured_id).first()
    configs = [item for item in WeComApiConfig.objects.all()[:2] if item.configured]
    return configs[0] if len(configs) == 1 else None


def _audit(binding: UserWeComBinding, *, actor, action: str, message: str, metadata: dict | None = None, deduplicate=False):
    if deduplicate:
        latest = binding.audit_logs.first()
        if latest and latest.action == action and latest.status == binding.status and latest.message == message:
            return
    WeComBindingAuditLog.objects.create(
        binding=binding,
        platform_user=binding.platform_user,
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        action=action,
        status=binding.status,
        message=message,
        metadata=metadata or {},
    )


def _save_failure(binding: UserWeComBinding, *, status: str, code: str, reason: str, source: str, actor=None, retryable=False):
    previous = (binding.status, binding.failure_code, binding.failure_reason)
    binding.status = status
    binding.source = source
    binding.failure_code = code
    binding.failure_reason = reason
    if retryable:
        binding.retry_count += 1
        delay = RETRY_DELAYS[min(binding.retry_count - 1, len(RETRY_DELAYS) - 1)]
        binding.next_retry_at = timezone.now() + delay
    else:
        binding.next_retry_at = None
    binding.save()
    _audit(binding, actor=actor, action="match_failed", message=reason, metadata={"failure_code": code}, deduplicate=previous == (status, code, reason))
    return binding


def mark_pending_and_dispatch(user_id: int, *, source: str):
    user = User.objects.filter(id=user_id, is_active=True).first()
    if not user:
        return None
    binding, _ = UserWeComBinding.objects.get_or_create(platform_user=user, defaults={"source": source})
    profile = UserSettings.objects.filter(user=user).first()
    current_hash = profile.phone_hash if profile else ""
    if binding.status == UserWeComBinding.Status.MATCHED and binding.normalized_phone_hash == current_hash:
        return binding
    binding.status = UserWeComBinding.Status.PENDING
    binding.source = source
    binding.failure_code = ""
    binding.failure_reason = ""
    binding.next_retry_at = None
    binding.save()
    config = resolve_binding_config(actor=user)
    if config and config.configured:
        if getattr(settings, "WECOM_BINDING_ASYNC_ENABLED", True):
            create_sync_job(config=config, source=source, batch_size=1)
        else:
            match_user(user_id, source=source, config=config)
    return binding


def dispatch_match(user_id: int, *, source: str, config_id: int, actor_id: int | None = None):
    config = WeComApiConfig.objects.get(id=config_id)
    actor = User.objects.filter(id=actor_id).first() if actor_id else None
    return create_sync_job(config=config, actor=actor, source=source, batch_size=1)


def match_user(user_id: int, *, source: str, config: WeComApiConfig, actor=None, force=False) -> UserWeComBinding:
    user = User.objects.select_related("settings").filter(id=user_id).first()
    if not user:
        raise ValueError("平台用户不存在")
    binding, _ = UserWeComBinding.objects.get_or_create(platform_user=user, defaults={"source": source})
    if not user.is_active:
        return _save_failure(binding, status=UserWeComBinding.Status.DISABLED, code="USER_DISABLED", reason="平台用户已停用。", source=source, actor=actor)

    profile = getattr(user, "settings", None)
    raw_phone = profile.phone if profile else ""
    normalized = normalize_phone(raw_phone)
    if not raw_phone:
        return _save_failure(binding, status=UserWeComBinding.Status.PENDING, code="PHONE_MISSING", reason="平台用户尚未填写手机号。", source=source, actor=actor)
    if not normalized:
        return _save_failure(binding, status=UserWeComBinding.Status.INVALID_PHONE, code="INVALID_PHONE", reason="手机号格式无效，请先修改用户资料。", source=source, actor=actor)
    phone_hash = hash_phone(normalized)

    if binding.status == UserWeComBinding.Status.MATCHED and binding.normalized_phone_hash == phone_hash and not force:
        return binding
    duplicate = UserSettings.objects.filter(user__is_active=True, phone_hash=phone_hash).exclude(user_id=user.id).exists()
    if duplicate:
        return _save_failure(binding, status=UserWeComBinding.Status.DUPLICATE_PHONE, code="DUPLICATE_PHONE", reason="多个平台用户使用了相同手机号，需要管理员确认。", source=source, actor=actor)

    client = WeComClient(config)
    try:
        wecom_userid = client.get_wecom_userid_by_mobile(normalized)
        member = client.get_wecom_user(wecom_userid)
        _cache_wecom_member(config, member, wecom_userid=wecom_userid)
    except WeComApiError as exc:
        if exc.code == "WEWORK_USER_NOT_FOUND":
            status = UserWeComBinding.Status.NOT_FOUND
        elif exc.code == "WEWORK_NO_PERMISSION":
            status = UserWeComBinding.Status.PERMISSION_DENIED
        elif exc.retryable:
            status = UserWeComBinding.Status.RETRY_WAITING
        else:
            status = UserWeComBinding.Status.PERMISSION_DENIED
        return _save_failure(binding, status=status, code=exc.code, reason=exc.detail, source=source, actor=actor, retryable=exc.retryable)

    if int(member.get("status", 1) or 1) != 1:
        return _save_failure(binding, status=UserWeComBinding.Status.DISABLED, code="WECOM_USER_DISABLED", reason="对应企业微信成员已停用。", source=source, actor=actor)

    with transaction.atomic():
        binding = UserWeComBinding.objects.select_for_update().get(pk=binding.pk)
        conflict = UserWeComBinding.objects.select_for_update().filter(
            wecom_config=config,
            wecom_userid=wecom_userid,
        ).exclude(pk=binding.pk).first()
        if conflict:
            return _save_failure(binding, status=UserWeComBinding.Status.CONFLICT, code="WECOM_USER_ALREADY_BOUND", reason="该企业微信成员已绑定其他平台用户，需要管理员确认。", source=source, actor=actor)
        if binding.wecom_userid and binding.wecom_userid != wecom_userid:
            return _save_failure(binding, status=UserWeComBinding.Status.CONFLICT, code="PHONE_MATCH_CHANGED", reason="新手机号匹配到不同的企业微信成员，原绑定未被覆盖。", source=source, actor=actor)

        now = timezone.now()
        binding.wecom_config = config
        binding.wecom_userid = wecom_userid
        binding.normalized_phone_hash = phone_hash
        binding.status = UserWeComBinding.Status.MATCHED
        binding.source = source
        binding.failure_code = ""
        binding.failure_reason = ""
        binding.matched_at = binding.matched_at or now
        binding.verified_at = now
        binding.retry_count = 0
        binding.next_retry_at = None
        try:
            with transaction.atomic():
                binding.save()
        except IntegrityError:
            return _save_failure(binding, status=UserWeComBinding.Status.CONFLICT, code="WECOM_USER_ALREADY_BOUND", reason="该企业微信成员已绑定其他平台用户，需要管理员确认。", source=source, actor=actor)
        _audit(binding, actor=actor, action="matched", message="平台用户已自动绑定企业微信成员。", metadata={"wecom_userid": wecom_userid, "masked_phone": mask_phone(normalized)})
        return binding


def candidate_user_ids(*, config: WeComApiConfig | None = None, limit: int | None = None):
    stale_before = timezone.now() - timedelta(days=30)
    qs = User.objects.filter(is_active=True, settings__phone__gt="")
    if config and config.organization_id:
        qs = qs.filter(id__in=organization_user_ids(config.organization))
    qs = qs.filter(
        Q(wecom_binding__isnull=True)
        | (
            Q(wecom_binding__status__in=[
                UserWeComBinding.Status.PENDING,
                UserWeComBinding.Status.RETRY_WAITING,
            ])
            & (Q(wecom_binding__next_retry_at__lte=timezone.now()) | Q(wecom_binding__next_retry_at__isnull=True))
        )
        | ~Q(wecom_binding__normalized_phone_hash=F("settings__phone_hash"))
        | Q(wecom_binding__status=UserWeComBinding.Status.MATCHED, wecom_binding__verified_at__lt=stale_before)
    ).distinct().order_by("id").values_list("id", flat=True)
    return list(qs[:limit] if limit else qs)


def run_sync_job(job: WeComBindingSyncJob) -> WeComBindingSyncJob:
    if job.status == WeComBindingSyncJob.Status.PENDING:
        job.status = WeComBindingSyncJob.Status.RUNNING
        job.started_at = timezone.now()
        job.save(update_fields=["status", "started_at"])
    counts = {field: 0 for field in [
        "scanned_count", "skipped_count", "matched_count", "not_found_count",
        "invalid_phone_count", "duplicate_phone_count", "conflict_count",
        "permission_denied_count", "retry_waiting_count",
    ]}
    try:
        user_ids = candidate_user_ids(config=job.config)
        for offset in range(0, len(user_ids), job.batch_size):
            for user_id in user_ids[offset:offset + job.batch_size]:
                counts["scanned_count"] += 1
                binding = match_user(user_id, source=job.source, config=job.config, actor=job.actor)
                mapping = {
                    UserWeComBinding.Status.MATCHED: "matched_count",
                    UserWeComBinding.Status.NOT_FOUND: "not_found_count",
                    UserWeComBinding.Status.INVALID_PHONE: "invalid_phone_count",
                    UserWeComBinding.Status.DUPLICATE_PHONE: "duplicate_phone_count",
                    UserWeComBinding.Status.CONFLICT: "conflict_count",
                    UserWeComBinding.Status.PERMISSION_DENIED: "permission_denied_count",
                    UserWeComBinding.Status.RETRY_WAITING: "retry_waiting_count",
                }
                key = mapping.get(binding.status, "skipped_count")
                counts[key] += 1
        for field, value in counts.items():
            setattr(job, field, value)
        job.status = WeComBindingSyncJob.Status.COMPLETED
    except Exception:
        job.status = WeComBindingSyncJob.Status.FAILED
        job.failure_reason = "批量同步执行异常，请查看服务端技术日志。"
        raise
    finally:
        job.finished_at = timezone.now()
        job.save()
    return job


def claim_sync_job(job_id: int) -> WeComBindingSyncJob | None:
    """Atomically claim one pending job so multiple workers cannot run it twice."""
    with transaction.atomic():
        job = (
            WeComBindingSyncJob.objects.select_for_update(skip_locked=True)
            .filter(id=job_id, status=WeComBindingSyncJob.Status.PENDING)
            .first()
        )
        if not job:
            return None
        job.status = WeComBindingSyncJob.Status.RUNNING
        job.started_at = timezone.now()
        job.save(update_fields=["status", "started_at"])
        return job


def create_sync_job(*, config: WeComApiConfig, actor=None, source=UserWeComBinding.Source.MANUAL, batch_size=100):
    return WeComBindingSyncJob.objects.create(config=config, actor=actor, source=source, batch_size=min(max(int(batch_size), 1), 500))


def requeue_not_configured_bindings(*, config: WeComApiConfig, actor=None) -> WeComBindingSyncJob | None:
    """Requeue stale failures after the organization's API becomes available."""
    if not config.configured:
        return None
    organization_ids = (
        organization_user_ids(config.organization)
        if config.organization_id
        else [config.user_id]
    )
    stale = list(UserWeComBinding.objects.filter(
        platform_user_id__in=organization_ids,
        status=UserWeComBinding.Status.PERMISSION_DENIED,
        failure_code="WECOM_NOT_CONFIGURED",
    ).filter(
        Q(wecom_config__isnull=True) | Q(wecom_config__organization=config.organization)
    ))
    if not stale:
        return None

    with transaction.atomic():
        for binding in stale:
            binding.wecom_config = config
            binding.status = UserWeComBinding.Status.PENDING
            binding.source = UserWeComBinding.Source.MANUAL
            binding.failure_code = ""
            binding.failure_reason = ""
            binding.next_retry_at = None
            binding.save(update_fields=[
                "wecom_config", "status", "source", "failure_code",
                "failure_reason", "next_retry_at", "updated_at",
            ])
            _audit(
                binding,
                actor=actor,
                action="config_available_retry",
                message="企业微信 API 已配置，系统已重新安排成员匹配。",
            )
        return create_sync_job(
            config=config,
            actor=actor,
            source=UserWeComBinding.Source.MANUAL,
            batch_size=min(len(stale), 100),
        )


def dispatch_sync_job(job_id: int):
    # 任务已经持久化为 pending，由 process_wecom_queue 工作进程领取。
    return WeComBindingSyncJob.objects.get(id=job_id)


def manual_bind(*, platform_user, wecom_userid: str, config: WeComApiConfig, actor) -> UserWeComBinding:
    try:
        member = dict(WeComClient(config).get_wecom_user(wecom_userid))
    except WeComApiError as exc:
        raise ValueError(exc.detail) from exc
    member.setdefault("userid", wecom_userid)
    if int(member.get("status", 1) or 1) != 1:
        raise ValueError("该企业微信成员已停用，不能建立绑定。")
    _cache_wecom_member(config, member, wecom_userid=wecom_userid)
    with transaction.atomic():
        existing = UserWeComBinding.objects.select_for_update().filter(
            wecom_config=config,
            wecom_userid=wecom_userid,
        ).exclude(platform_user=platform_user).first()
        if existing:
            raise ValueError("该企业微信 UserID 已绑定其他平台用户")
        binding, _ = UserWeComBinding.objects.select_for_update().get_or_create(platform_user=platform_user)
        binding.wecom_config = config
        binding.wecom_userid = wecom_userid
        binding.normalized_phone_hash = UserSettings.objects.filter(user=platform_user).values_list("phone_hash", flat=True).first() or ""
        binding.status = UserWeComBinding.Status.MATCHED
        binding.source = UserWeComBinding.Source.ADMIN_CONFIRMED
        binding.failure_code = ""
        binding.failure_reason = ""
        binding.matched_at = binding.matched_at or timezone.now()
        binding.verified_at = timezone.now()
        binding.retry_count = 0
        binding.next_retry_at = None
        binding.save()
        _audit(binding, actor=actor, action="manual_bind", message="管理员已人工确认企业微信绑定。", metadata={"wecom_userid": wecom_userid})
        return binding
