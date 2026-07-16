from django.db import models
import uuid


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


class ChatRun(models.Model):
    """一次可取消的 Agent 对话执行。"""

    class Status(models.TextChoices):
        RUNNING = "running", "运行中"
        CANCELLED = "cancelled", "已暂停"
        COMPLETED = "completed", "已完成"
        FAILED = "failed", "失败"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        "auth.User",
        related_name="chat_runs",
        on_delete=models.CASCADE,
        verbose_name="用户",
    )
    session = models.ForeignKey(
        ChatSession,
        related_name="runs",
        on_delete=models.CASCADE,
        verbose_name="会话",
    )
    status = models.CharField(
        "状态",
        max_length=16,
        choices=Status.choices,
        default=Status.RUNNING,
        db_index=True,
    )
    cancel_message = models.OneToOneField(
        ChatMessage,
        related_name="cancelled_run",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="暂停消息",
    )
    error = models.TextField("错误", blank=True, default="")
    cancelled_at = models.DateTimeField("暂停时间", null=True, blank=True)
    finished_at = models.DateTimeField("结束时间", null=True, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "对话执行"
        verbose_name_plural = "对话执行"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.id}:{self.status}"


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
    llm_api_key = models.CharField("LLM API Key", max_length=255, blank=True, default="")
    llm_base_url = models.CharField("LLM Base URL", max_length=255, blank=True, default="")
    llm_model = models.CharField("LLM Model", max_length=128, blank=True, default="")
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
