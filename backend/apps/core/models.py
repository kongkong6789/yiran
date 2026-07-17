from django.db import models
import uuid


class Organization(models.Model):
    """平台企业租户；业务数据和外部连接均通过企业成员关系隔离。"""

    name = models.CharField("企业名称", max_length=128)
    code = models.UUIDField("企业标识", default=uuid.uuid4, unique=True, editable=False)
    created_by = models.ForeignKey(
        "auth.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_organizations",
        verbose_name="创建人",
    )
    is_active = models.BooleanField("是否启用", default=True, db_index=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["name", "id"]
        verbose_name = "企业"
        verbose_name_plural = "企业"

    def __str__(self):
        return self.name


class OrganizationMembership(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "企业所有者"
        ADMIN = "admin", "企业管理员"
        MEMBER = "member", "企业成员"

    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        related_name="memberships",
        verbose_name="企业",
    )
    user = models.ForeignKey(
        "auth.User",
        on_delete=models.CASCADE,
        related_name="organization_memberships",
        verbose_name="用户",
    )
    role = models.CharField("企业角色", max_length=16, choices=Role.choices, default=Role.MEMBER, db_index=True)
    is_primary = models.BooleanField("当前企业", default=True, db_index=True)
    is_active = models.BooleanField("成员状态", default=True, db_index=True)
    joined_at = models.DateTimeField("加入时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["organization_id", "role", "user_id"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "user"], name="uniq_organization_user"),
            models.UniqueConstraint(
                fields=["user"],
                condition=models.Q(is_primary=True, is_active=True),
                name="uniq_primary_organization_per_user",
            ),
            models.UniqueConstraint(
                fields=["organization"],
                condition=models.Q(role="owner", is_active=True),
                name="uniq_active_owner_per_organization",
            ),
        ]

    def __str__(self):
        return f"{self.organization_id}:{self.user_id}:{self.role}"


class ChatSession(models.Model):
    """持久化的 Agent 对话。"""

    user = models.ForeignKey(
        "auth.User",
        related_name="chat_sessions",
        on_delete=models.CASCADE,
        verbose_name="用户",
        null=True,
        blank=True,
    )
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField("标题", max_length=120, default="新对话")
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "Agent 对话"
        verbose_name_plural = "Agent 对话"

    def __str__(self):
        return self.title


class ChatMessage(models.Model):
    """对话中的单条消息。"""

    session = models.ForeignKey(
        ChatSession,
        related_name="messages",
        on_delete=models.CASCADE,
    )
    role = models.CharField("角色", max_length=16)
    content = models.TextField("内容")
    meta = models.JSONField("元数据", default=dict, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "Agent 消息"
        verbose_name_plural = "Agent 消息"

    def __str__(self):
        return f"{self.role}: {self.content[:40]}"


class UserSettings(models.Model):
    """用户个人资料与 LLM 密钥,与账号绑定。"""

    user = models.OneToOneField(
        "auth.User",
        related_name="settings",
        on_delete=models.CASCADE,
        verbose_name="用户",
    )
    display_name = models.CharField("显示名称", max_length=64, blank=True, default="")
    bio = models.CharField("个性签名", max_length=200, blank=True, default="")
    methodology = models.TextField("方法论", blank=True, default="")
    avatar = models.CharField("头像文件", max_length=255, blank=True, default="")
    phone = models.CharField("手机号", max_length=32, blank=True, default="")
    phone_hash = models.CharField("标准化手机号哈希", max_length=64, blank=True, default="", db_index=True)
    phone_updated_at = models.DateTimeField("手机号更新时间", null=True, blank=True)
    llm_api_key = models.CharField("LLM API Key", max_length=255, blank=True, default="")
    llm_base_url = models.CharField("LLM Base URL", max_length=255, blank=True, default="")
    llm_model = models.CharField("LLM Model", max_length=128, blank=True, default="")
    deleted_at = models.DateTimeField("账号删除时间", null=True, blank=True, db_index=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "用户设置"
        verbose_name_plural = "用户设置"

    def __str__(self):
        return f"settings:{self.user_id}"

    @property
    def avatar_url(self) -> str:
        if not self.avatar:
            return ""
        return f"/api/auth/avatars/{self.avatar}/"


class AuditLog(models.Model):
    """审计日志 —— 记录 Agent 每一次动作意图、闸机结论与执行结果。"""

    class Decision(models.TextChoices):
        ALLOW = "allow", "放行"
        BLOCK = "block", "拦截"
        NEED_APPROVAL = "need_approval", "待人工审批"
        DRY_RUN = "dry_run", "预执行"

    trace_id = models.CharField("链路ID", max_length=64, db_index=True)
    actor = models.CharField("发起人", max_length=128, default="agent")
    intent = models.CharField("意图", max_length=128, blank=True)
    action = models.CharField("动作", max_length=128, blank=True)
    payload = models.JSONField("动作参数", default=dict, blank=True)
    decision = models.CharField(
        "闸机结论", max_length=20, choices=Decision.choices, default=Decision.DRY_RUN
    )
    checks = models.JSONField("校验明细", default=list, blank=True)
    result = models.JSONField("执行结果", default=dict, blank=True)
    created_at = models.DateTimeField("时间", auto_now_add=True)

    class Meta:
        verbose_name = "审计日志"
        verbose_name_plural = "审计日志"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.trace_id}] {self.action} -> {self.decision}"


class TaskResultRecord(models.Model):
    user = models.ForeignKey("auth.User", on_delete=models.CASCADE, related_name="task_result_records")
    trace_id = models.CharField(max_length=64)
    sop_id = models.CharField(max_length=128, blank=True, default="")
    status = models.CharField(max_length=32, db_index=True)
    title = models.CharField(max_length=255)
    snapshot = models.JSONField(default=dict)
    resolved_attention_ids = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "id"]
        constraints = [models.UniqueConstraint(fields=["user", "trace_id"], name="uniq_task_result_user_trace")]


class TaskFollowUp(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "待处理"
        COMPLETED = "completed", "已完成"

    result = models.ForeignKey(TaskResultRecord, on_delete=models.CASCADE, related_name="follow_ups")
    creator = models.ForeignKey("auth.User", on_delete=models.CASCADE, related_name="created_task_followups")
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    due_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class WorkTask(models.Model):
    class Priority(models.TextChoices):
        NORMAL = "normal", "普通"
        HIGH = "high", "高"
        URGENT = "urgent", "紧急"

    class Status(models.TextChoices):
        PENDING = "pending", "待处理"
        RUNNING = "running", "执行中"
        COMPLETED = "completed", "已完成"
        PARTIAL = "partial", "部分完成"
        FAILED = "failed", "执行失败"

    sender = models.ForeignKey("auth.User", on_delete=models.CASCADE, related_name="sent_work_tasks")
    assignees = models.ManyToManyField("auth.User", related_name="received_work_tasks", blank=True)
    trace_id = models.CharField(max_length=64)
    title = models.CharField(max_length=500)
    sop_id = models.CharField(max_length=128, blank=True, default="")
    agent_name = models.CharField(max_length=128, blank=True, default="")
    priority = models.CharField(max_length=16, choices=Priority.choices, default=Priority.NORMAL, db_index=True)
    deadline = models.DateTimeField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.RUNNING, db_index=True)
    progress = models.PositiveSmallIntegerField(default=0)
    assignee_wecom_userids = models.JSONField(default=list, blank=True)
    assignee_names = models.JSONField(default=list, blank=True)
    notification_mode = models.CharField(max_length=16, blank=True, default="")
    notification_target = models.CharField(max_length=500, blank=True, default="")
    notification_status = models.CharField(max_length=32, blank=True, default="pending")
    notification_record_id = models.PositiveBigIntegerField(null=True, blank=True)
    timeline = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["sender", "trace_id"], name="uniq_work_task_sender_trace")]
        indexes = [
            models.Index(fields=["sender", "status"], name="work_task_sender_status"),
            models.Index(fields=["priority", "deadline"], name="work_task_priority_deadline"),
        ]


class WorkTaskArtifact(models.Model):
    class Kind(models.TextChoices):
        MARKDOWN = "md", "Markdown 文档"
        JSON = "json", "JSON 数据"
        XLSX = "xlsx", "Excel 工作簿"

    task = models.ForeignKey(WorkTask, on_delete=models.CASCADE, related_name="artifacts")
    kind = models.CharField(max_length=16, choices=Kind.choices)
    name = models.CharField(max_length=255)
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=128)
    content = models.BinaryField()
    size = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [models.UniqueConstraint(fields=["task", "kind"], name="uniq_work_task_artifact_kind")]


class WorkTodo(models.Model):
    """平台待办主数据；企业微信负责通知触达。"""

    class Priority(models.TextChoices):
        NORMAL = "normal", "普通"
        HIGH = "high", "高"
        URGENT = "urgent", "紧急"

    class Status(models.TextChoices):
        PENDING = "pending", "待处理"
        COMPLETED = "completed", "已完成"
        CANCELLED = "cancelled", "已取消"

    class SyncStatus(models.TextChoices):
        NOT_REQUESTED = "not_requested", "仅平台"
        PENDING = "pending", "待同步"
        SYNCED = "synced", "已同步"
        FAILED = "failed", "同步失败"

    class SyncSource(models.TextChoices):
        PLATFORM = "platform", "平台"
        WECOM = "wecom", "企业微信"

    class RecipientType(models.TextChoices):
        PLATFORM = "platform", "平台成员"
        WECOM = "wecom", "企业微信成员"

    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="work_todos")
    creator = models.ForeignKey("auth.User", on_delete=models.PROTECT, related_name="created_work_todos")
    assignee = models.ForeignKey(
        "auth.User", null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_work_todos"
    )
    linked_platform_user = models.ForeignKey(
        "auth.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="linked_wecom_work_todos",
        help_text="企业微信负责人通过绑定关系对应的平台用户；不等同于平台负责人字段。",
    )
    recipient_type = models.CharField(
        max_length=16, choices=RecipientType.choices, default=RecipientType.PLATFORM, db_index=True
    )
    recipient_name = models.CharField(max_length=128, blank=True, default="")
    wecom_contact = models.ForeignKey(
        "wecom.WeComContact",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="work_todos",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    priority = models.CharField(max_length=16, choices=Priority.choices, default=Priority.NORMAL, db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    due_at = models.DateTimeField(null=True, blank=True, db_index=True)
    remind_types = models.JSONField(default=list, blank=True)
    sync_group_id = models.UUIDField(default=uuid.uuid4, db_index=True, editable=False)
    sync_requested = models.BooleanField(default=False, db_index=True)
    wecom_todo_id_encrypted = models.TextField(blank=True, default="")
    wecom_todo_userid_encrypted = models.TextField(blank=True, default="")
    sync_status = models.CharField(
        max_length=20, choices=SyncStatus.choices, default=SyncStatus.NOT_REQUESTED, db_index=True
    )
    sync_error_code = models.CharField(max_length=64, blank=True, default="")
    sync_error_reason = models.CharField(max_length=500, blank=True, default="")
    sync_retry_count = models.PositiveSmallIntegerField(default=0)
    sync_next_retry_at = models.DateTimeField(null=True, blank=True, db_index=True)
    operation_claim_token = models.UUIDField(null=True, blank=True, editable=False)
    operation_claim_kind = models.CharField(max_length=16, blank=True, default="")
    operation_claimed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_synced_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_sync_source = models.CharField(
        max_length=16, choices=SyncSource.choices, default=SyncSource.PLATFORM
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["status", "due_at", "-created_at", "id"]
        indexes = [
            models.Index(fields=["organization", "assignee", "status"], name="todo_org_assignee_status"),
            models.Index(fields=["organization", "creator", "status"], name="todo_org_creator_status"),
            models.Index(fields=["organization", "linked_platform_user", "status"], name="todo_org_linked_status"),
        ]

    def __str__(self):
        return f"{self.public_id}:{self.title}"

    @property
    def wecom_todo_id(self) -> str:
        from apps.wecom.crypto import decrypt_secret
        return decrypt_secret(self.wecom_todo_id_encrypted)

    @wecom_todo_id.setter
    def wecom_todo_id(self, value: str) -> None:
        from apps.wecom.crypto import encrypt_secret
        self.wecom_todo_id_encrypted = encrypt_secret(value)

    @property
    def wecom_todo_userid(self) -> str:
        from apps.wecom.crypto import decrypt_secret
        return decrypt_secret(self.wecom_todo_userid_encrypted)

    @wecom_todo_userid.setter
    def wecom_todo_userid(self, value: str) -> None:
        from apps.wecom.crypto import encrypt_secret
        self.wecom_todo_userid_encrypted = encrypt_secret(value)
