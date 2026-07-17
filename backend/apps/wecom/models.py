from django.conf import settings
from django.db import models
import base64
import os
import secrets
import uuid

from .crypto import decrypt_secret, encrypt_secret


class WeComCliConfig(models.Model):
    """企业级 wecom-cli 智能机器人配置，用于企业微信原生待办。"""

    class AccessScope(models.TextChoices):
        ORGANIZATION = "organization", "企业全员"
        SELECTED = "selected", "指定成员"
        OWNER = "owner", "仅管理员"

    organization = models.OneToOneField(
        "core.Organization", related_name="wecom_cli_config", on_delete=models.CASCADE
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="wecom_cli_configs", on_delete=models.CASCADE
    )
    bot_id = models.CharField(max_length=128, blank=True, default="")
    bot_secret_encrypted = models.TextField(blank=True, default="")
    enabled = models.BooleanField(default=True, db_index=True)
    access_scope = models.CharField(
        max_length=20, choices=AccessScope.choices, default=AccessScope.ORGANIZATION, db_index=True
    )
    allowed_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL, related_name="allowed_wecom_cli_configs", blank=True
    )
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_error_code = models.CharField(max_length=64, blank=True, default="")
    last_error_reason = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def bot_secret(self) -> str:
        return decrypt_secret(self.bot_secret_encrypted)

    @bot_secret.setter
    def bot_secret(self, value: str) -> None:
        self.bot_secret_encrypted = encrypt_secret(value)

    @property
    def configured(self) -> bool:
        return bool(self.enabled and self.bot_id and self.bot_secret_encrypted)

    def can_manage(self, user) -> bool:
        from apps.core.organizations import is_organization_admin
        return bool(user and getattr(user, "is_authenticated", False) and is_organization_admin(user, self.organization))

    def can_use(self, user) -> bool:
        if not user or not getattr(user, "is_authenticated", False) or not self.configured:
            return False
        if self.can_manage(user):
            return True
        from apps.core.models import OrganizationMembership
        if not OrganizationMembership.objects.filter(
            organization=self.organization, user=user, is_active=True, user__is_active=True
        ).exists():
            return False
        if self.access_scope == self.AccessScope.ORGANIZATION:
            return True
        if self.access_scope == self.AccessScope.SELECTED:
            return self.allowed_users.filter(id=user.id, is_active=True).exists()
        return False


class WeComApiConfig(models.Model):
    """企业级企业微信自建应用配置，由管理员控制成员使用范围。"""

    class AccessScope(models.TextChoices):
        ORGANIZATION = "organization", "企业全员"
        SELECTED = "selected", "指定成员"
        OWNER = "owner", "仅配置者"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        related_name="wecom_api_config",
        on_delete=models.CASCADE,
        verbose_name="用户",
    )
    organization = models.ForeignKey(
        "core.Organization",
        related_name="wecom_api_configs",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="所属企业",
    )
    access_scope = models.CharField(
        "可用范围",
        max_length=20,
        choices=AccessScope.choices,
        default=AccessScope.ORGANIZATION,
        db_index=True,
    )
    allowed_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="allowed_wecom_api_configs",
        blank=True,
        verbose_name="指定可用成员",
    )
    enabled = models.BooleanField("是否启用", default=True, db_index=True)
    corp_id = models.CharField("企业 ID", max_length=128, blank=True, default="")
    agent_id = models.CharField("应用 AgentID", max_length=64, blank=True, default="")
    secret_encrypted = models.TextField("应用 Secret（密文）", blank=True, default="")
    callback_url = models.URLField("回调地址", max_length=500, blank=True, default="")
    token_encrypted = models.TextField("Token（密文）", blank=True, default="")
    encoding_aes_key_encrypted = models.TextField("EncodingAESKey（密文）", blank=True, default="")
    callback_key = models.UUIDField("回调标识", default=uuid.uuid4, unique=True, editable=False)
    callback_verified_at = models.DateTimeField("回调验证时间", null=True, blank=True)
    last_event_at = models.DateTimeField("最后事件时间", null=True, blank=True)
    contacts_synced_at = models.DateTimeField("通讯录同步时间", null=True, blank=True, db_index=True)
    contacts_sync_error = models.CharField("通讯录同步错误", max_length=500, blank=True, default="")
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "企业微信 API 配置"
        verbose_name_plural = "企业微信 API 配置"

    @property
    def secret(self) -> str:
        return decrypt_secret(self.secret_encrypted)

    @secret.setter
    def secret(self, value: str) -> None:
        self.secret_encrypted = encrypt_secret(value)

    @property
    def token(self) -> str:
        return decrypt_secret(self.token_encrypted)

    @token.setter
    def token(self, value: str) -> None:
        self.token_encrypted = encrypt_secret(value)

    @property
    def encoding_aes_key(self) -> str:
        return decrypt_secret(self.encoding_aes_key_encrypted)

    @encoding_aes_key.setter
    def encoding_aes_key(self, value: str) -> None:
        self.encoding_aes_key_encrypted = encrypt_secret(value)

    @property
    def configured(self) -> bool:
        return bool(self.enabled and self.corp_id and self.agent_id and self.secret_encrypted)

    def can_manage(self, user) -> bool:
        from apps.core.organizations import is_organization_admin

        return bool(
            user
            and getattr(user, "is_authenticated", False)
            and (user.id == self.user_id or is_organization_admin(user, self.organization))
        )

    def can_use(self, user) -> bool:
        if not user or not getattr(user, "is_authenticated", False) or not self.enabled:
            return False
        if self.can_manage(user):
            return True
        if not self.organization_id:
            return user.id == self.user_id
        from apps.core.models import OrganizationMembership

        is_member = OrganizationMembership.objects.filter(
            organization_id=self.organization_id,
            user=user,
            is_active=True,
        ).exists()
        if not is_member:
            return False
        if self.access_scope == self.AccessScope.ORGANIZATION:
            return True
        if self.access_scope == self.AccessScope.SELECTED:
            return self.allowed_users.filter(id=user.id).exists()
        return user.id == self.user_id

    def ensure_callback_credentials(self) -> bool:
        """首次访问时生成回调凭据，之后保持稳定，便于企微后台长期配置。"""
        changed = False
        if not self.token_encrypted:
            self.token = secrets.token_urlsafe(24)
            changed = True
        if not self.encoding_aes_key_encrypted:
            self.encoding_aes_key = base64.b64encode(os.urandom(32)).decode("ascii").rstrip("=")
            changed = True
        if changed:
            self.save(update_fields=["token_encrypted", "encoding_aes_key_encrypted", "updated_at"])
        return changed

    def __str__(self) -> str:
        return f"wecom:{self.user_id}:{self.corp_id or 'unconfigured'}"


class WeComContact(models.Model):
    """按企业微信配置隔离保存的可见通讯录快照。"""

    config = models.ForeignKey(
        WeComApiConfig,
        related_name="contacts",
        on_delete=models.CASCADE,
        verbose_name="企业微信配置",
    )
    wecom_userid = models.CharField("企业微信 UserID", max_length=128)
    name = models.CharField("成员姓名", max_length=128)
    department = models.CharField("部门", max_length=500, blank=True, default="")
    department_ids = models.JSONField("部门 ID", default=list, blank=True)
    position = models.CharField("职务", max_length=128, blank=True, default="")
    avatar_url = models.URLField("头像地址", max_length=1000, blank=True, default="")
    available = models.BooleanField("成员可用", default=True, db_index=True)
    synced_at = models.DateTimeField("同步时间", db_index=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["department", "name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["config", "wecom_userid"], name="uniq_wecom_contact_config_userid"),
        ]
        indexes = [models.Index(fields=["config", "available"], name="wecom_contact_cfg_available")]

    def __str__(self) -> str:
        return f"{self.config_id}:{self.wecom_userid}:{self.name}"


class UserWeComBinding(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "待匹配"
        MATCHED = "matched", "已绑定"
        NOT_FOUND = "not_found", "未查询到成员"
        INVALID_PHONE = "invalid_phone", "手机号无效"
        DUPLICATE_PHONE = "duplicate_phone", "手机号重复"
        CONFLICT = "conflict", "绑定冲突"
        PERMISSION_DENIED = "permission_denied", "权限不足"
        RETRY_WAITING = "retry_waiting", "等待重试"
        DISABLED = "disabled", "已停用"

    class Source(models.TextChoices):
        USER_CREATED = "user_created", "用户创建"
        PHONE_UPDATED = "phone_updated", "手机号更新"
        SCHEDULED_SYNC = "scheduled_sync", "定时同步"
        MANUAL = "manual", "立即匹配"
        ADMIN_CONFIRMED = "admin_confirmed", "管理员确认"

    platform_user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        related_name="wecom_binding",
        on_delete=models.CASCADE,
        verbose_name="平台用户",
    )
    wecom_config = models.ForeignKey(
        WeComApiConfig,
        related_name="user_bindings",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        verbose_name="企业微信配置",
    )
    wecom_userid = models.CharField("企业微信 UserID", max_length=128, null=True, blank=True)
    normalized_phone_hash = models.CharField("标准化手机号哈希", max_length=64, blank=True, default="", db_index=True)
    status = models.CharField("绑定状态", max_length=32, choices=Status.choices, default=Status.PENDING, db_index=True)
    source = models.CharField("匹配来源", max_length=32, choices=Source.choices, default=Source.USER_CREATED)
    failure_code = models.CharField("失败代码", max_length=64, blank=True, default="")
    failure_reason = models.CharField("失败原因", max_length=500, blank=True, default="")
    matched_at = models.DateTimeField("匹配时间", null=True, blank=True)
    verified_at = models.DateTimeField("验证时间", null=True, blank=True)
    retry_count = models.PositiveSmallIntegerField("重试次数", default=0)
    next_retry_at = models.DateTimeField("下次重试时间", null=True, blank=True, db_index=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["-updated_at", "id"]
        verbose_name = "平台用户企业微信绑定"
        verbose_name_plural = "平台用户企业微信绑定"
        constraints = [
            models.UniqueConstraint(
                fields=["wecom_config", "wecom_userid"],
                condition=models.Q(wecom_config__isnull=False, wecom_userid__isnull=False),
                name="uniq_wecom_userid_per_config",
            ),
        ]


class WeComBindingSyncJob(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "等待执行"
        RUNNING = "running", "执行中"
        COMPLETED = "completed", "已完成"
        FAILED = "failed", "执行失败"

    status = models.CharField("任务状态", max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    source = models.CharField("触发来源", max_length=32, choices=UserWeComBinding.Source.choices, default=UserWeComBinding.Source.SCHEDULED_SYNC)
    config = models.ForeignKey(WeComApiConfig, on_delete=models.PROTECT, related_name="binding_sync_jobs", verbose_name="企业微信配置")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="wecom_binding_jobs", verbose_name="操作者")
    batch_size = models.PositiveSmallIntegerField("批大小", default=100)
    scanned_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    matched_count = models.PositiveIntegerField(default=0)
    not_found_count = models.PositiveIntegerField(default=0)
    invalid_phone_count = models.PositiveIntegerField(default=0)
    duplicate_phone_count = models.PositiveIntegerField(default=0)
    conflict_count = models.PositiveIntegerField(default=0)
    permission_denied_count = models.PositiveIntegerField(default=0)
    retry_waiting_count = models.PositiveIntegerField(default=0)
    failure_reason = models.CharField(max_length=500, blank=True, default="")
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "id"]


class WeComBindingAuditLog(models.Model):
    binding = models.ForeignKey(UserWeComBinding, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_logs")
    platform_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wecom_binding_audit_logs")
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="wecom_binding_actions")
    action = models.CharField(max_length=64)
    status = models.CharField(max_length=32, choices=UserWeComBinding.Status.choices)
    message = models.CharField(max_length=500)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "id"]


class WeComCallbackEvent(models.Model):
    class ProcessingStatus(models.TextChoices):
        PENDING = "pending", "待处理"
        PROCESSING = "processing", "处理中"
        COMPLETED = "completed", "已完成"
        RETRY_WAITING = "retry_waiting", "等待重试"
        FAILED = "failed", "处理失败"

    config = models.ForeignKey(WeComApiConfig, on_delete=models.CASCADE, related_name="callback_events")
    dedup_key = models.CharField("幂等键", max_length=64, unique=True)
    msg_type = models.CharField("消息类型", max_length=32, blank=True, default="")
    event_type = models.CharField("事件类型", max_length=64, blank=True, default="", db_index=True)
    change_type = models.CharField("变更类型", max_length=64, blank=True, default="")
    from_user_id = models.CharField("发送成员 UserID", max_length=128, blank=True, default="")
    to_user_name = models.CharField("接收企业", max_length=128, blank=True, default="")
    event_key = models.CharField("事件 Key", max_length=255, blank=True, default="")
    payload = models.JSONField("解密后的事件数据", default=dict)
    received_at = models.DateTimeField("接收时间", auto_now_add=True)

    processing_status = models.CharField(max_length=20, choices=ProcessingStatus.choices, default=ProcessingStatus.PENDING, db_index=True)
    processing_result = models.JSONField(default=dict, blank=True)
    attempt_count = models.PositiveSmallIntegerField(default=0)
    next_retry_at = models.DateTimeField(null=True, blank=True, db_index=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    failure_reason = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        ordering = ["-received_at", "id"]
        verbose_name = "企业微信回调事件"
        verbose_name_plural = "企业微信回调事件"


class WeComGroupWebhook(models.Model):
    class AccessScope(models.TextChoices):
        ORGANIZATION = "organization", "企业全员"
        SELECTED = "selected", "指定成员"
        OWNER = "owner", "仅配置者"

    last_success_at = models.DateTimeField(null=True, blank=True)
    last_failure_at = models.DateTimeField(null=True, blank=True)
    last_error_code = models.CharField(max_length=64, blank=True, default="")
    last_error_reason = models.CharField(max_length=500, blank=True, default="")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wecom_group_webhooks")
    organization = models.ForeignKey(
        "core.Organization",
        related_name="wecom_group_webhooks",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
    )
    access_scope = models.CharField(
        max_length=20,
        choices=AccessScope.choices,
        default=AccessScope.ORGANIZATION,
        db_index=True,
    )
    allowed_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="allowed_wecom_group_webhooks",
        blank=True,
    )
    name = models.CharField("群聊名称", max_length=100)
    webhook_key_encrypted = models.TextField("群机器人 Webhook Key（密文）")
    enabled = models.BooleanField("是否启用", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [models.UniqueConstraint(fields=["organization", "name"], name="uniq_wecom_group_name_per_org")]

    @property
    def webhook_key(self) -> str:
        return decrypt_secret(self.webhook_key_encrypted)

    @webhook_key.setter
    def webhook_key(self, value: str) -> None:
        self.webhook_key_encrypted = encrypt_secret(value)

    def can_manage(self, user) -> bool:
        from apps.core.organizations import is_organization_admin

        return bool(
            user
            and getattr(user, "is_authenticated", False)
            and (user.id == self.user_id or is_organization_admin(user, self.organization))
        )

    def can_use(self, user) -> bool:
        if not user or not getattr(user, "is_authenticated", False) or not self.enabled:
            return False
        if self.can_manage(user):
            return True
        if not self.organization_id:
            return user.id == self.user_id
        from apps.core.models import OrganizationMembership

        if not OrganizationMembership.objects.filter(
            organization_id=self.organization_id,
            user=user,
            is_active=True,
        ).exists():
            return False
        if self.access_scope == self.AccessScope.ORGANIZATION:
            return True
        if self.access_scope == self.AccessScope.SELECTED:
            return self.allowed_users.filter(id=user.id).exists()
        return user.id == self.user_id


class WeComNotificationRecord(models.Model):
    class Channel(models.TextChoices):
        PERSON = "person", "应用消息"
        GROUP = "group", "群机器人"

    class Status(models.TextChoices):
        PENDING = "pending", "等待发送"
        RETRY_WAITING = "retry_waiting", "等待重试"
        ACCEPTED = "accepted", "企业微信已受理"
        PARTIAL = "partial", "部分接收人失败"
        FAILED = "failed", "发送失败"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wecom_notification_records")
    content = models.TextField(blank=True, default="")
    task_trace_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    idempotency_key = models.CharField(max_length=64, null=True, blank=True, unique=True)
    retry_count = models.PositiveSmallIntegerField(default=0)
    max_retries = models.PositiveSmallIntegerField(default=4)
    next_retry_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    config = models.ForeignKey(WeComApiConfig, null=True, blank=True, on_delete=models.SET_NULL, related_name="notification_records")
    group_webhook = models.ForeignKey(WeComGroupWebhook, null=True, blank=True, on_delete=models.SET_NULL, related_name="notification_records")
    channel = models.CharField(max_length=16, choices=Channel.choices)
    target_ids = models.JSONField(default=list)
    target_label = models.CharField(max_length=255, blank=True, default="")
    content_preview = models.CharField(max_length=500, blank=True, default="")
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.FAILED, db_index=True)
    wecom_msgid = models.CharField(max_length=128, blank=True, default="")
    invalid_users = models.JSONField(default=list)
    error_code = models.CharField(max_length=64, blank=True, default="")
    error_reason = models.CharField(max_length=500, blank=True, default="")
    accepted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "id"]
