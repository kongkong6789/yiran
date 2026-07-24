from django.conf import settings
from django.db import models
import uuid


class CollabRoom(models.Model):
    """人对人协作会话,AI 旁路分析风险。"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField("标题", max_length=120, default="协作会话")
    room_kind = models.CharField(
        "类型",
        max_length=16,
        choices=[("dm", "单聊"), ("group", "群聊")],
        default="dm",
        db_index=True,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="collab_rooms_created",
        on_delete=models.CASCADE,
    )
    status = models.CharField(
        "状态",
        max_length=16,
        choices=[("open", "进行中"), ("closed", "已结束")],
        default="open",
        db_index=True,
    )
    risk_level = models.CharField(
        "当前风险",
        max_length=16,
        choices=[("green", "正常"), ("yellow", "注意"), ("red", "高风险")],
        default="green",
        db_index=True,
    )
    summary = models.TextField("会话摘要", blank=True, default="")
    interject_enabled = models.BooleanField("允许AI插嘴", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "协作会话"
        verbose_name_plural = "协作会话"

    def __str__(self):
        return self.title


class CollabParticipant(models.Model):
    room = models.ForeignKey(CollabRoom, related_name="participants", on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="collab_participations",
        on_delete=models.CASCADE,
    )
    nickname = models.CharField("群内名称", max_length=64, blank=True, default="")
    last_read_message_id = models.BigIntegerField("已读到消息ID", default=0, db_index=True)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["room", "user"], name="uniq_collab_room_user"),
        ]
        verbose_name = "协作参与者"
        verbose_name_plural = "协作参与者"


class CollabMessage(models.Model):
    room = models.ForeignKey(CollabRoom, related_name="messages", on_delete=models.CASCADE)
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="collab_messages",
        on_delete=models.CASCADE,
    )
    reply_to = models.ForeignKey(
        "self",
        verbose_name="引用消息",
        related_name="replies",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    content = models.TextField("内容", blank=True, default="")
    attachments = models.JSONField("附件", default=list, blank=True)
    mentions = models.JSONField("提及", default=list, blank=True)
    meta = models.JSONField("元数据", default=dict, blank=True)
    msg_type = models.CharField(
        "消息类型",
        max_length=16,
        choices=[("user", "用户"), ("system", "系统"), ("ai", "AI")],
        default="user",
        db_index=True,
    )
    ai_kind = models.CharField(
        "AI角色",
        max_length=16,
        blank=True,
        default="",
        choices=[
            ("", "无"),
            ("reply", "应答"),
            ("interject", "插嘴"),
            ("suggest", "建议"),
            ("xiaoce", "小策bot"),
        ],
        db_index=True,
    )
    status = models.CharField(
        "状态",
        max_length=16,
        choices=[
            ("normal", "正常"),
            ("recalled", "已撤回"),
            ("deleted", "已删除"),
        ],
        default="normal",
        db_index=True,
    )
    risk_flag = models.CharField("风险标签", max_length=40, blank=True, default="")
    risk_flag_level = models.CharField(
        "风险标签等级",
        max_length=16,
        blank=True,
        default="",
        choices=[("", "无"), ("yellow", "注意"), ("red", "高风险")],
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "协作消息"
        verbose_name_plural = "协作消息"


class CollabSummary(models.Model):
    """单聊/群聊的版本化智能纪要。"""

    room = models.ForeignKey(CollabRoom, related_name="summaries", on_delete=models.CASCADE)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="collab_summaries_created",
        on_delete=models.CASCADE,
    )
    range_mode = models.CharField(
        "选取方式",
        max_length=16,
        choices=[
            ("auto", "智能选取"),
            ("latest", "最近消息"),
            ("time", "时间范围"),
            ("custom", "自定义范围"),
        ],
        default="auto",
    )
    start_message = models.ForeignKey(
        CollabMessage,
        related_name="+",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    end_message = models.ForeignKey(
        CollabMessage,
        related_name="+",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    message_count = models.PositiveIntegerField("纳入消息数", default=0)
    selection_reason = models.CharField("选取说明", max_length=240, blank=True, default="")
    content = models.TextField("总结正文", blank=True, default="")
    key_points = models.JSONField("关键要点", default=list, blank=True)
    decisions = models.JSONField("结论/共识", default=list, blank=True)
    action_items = models.JSONField("待办事项", default=list, blank=True)
    participants = models.JSONField("发言成员", default=list, blank=True)
    generated_by = models.CharField(
        "生成方式",
        max_length=16,
        choices=[("llm", "模型"), ("local", "本地规则")],
        default="local",
    )
    model_name = models.CharField("模型名称", max_length=128, blank=True, default="")
    model_source = models.CharField(
        "模型配置来源",
        max_length=24,
        choices=[
            ("personal", "个人配置"),
            ("platform", "平台配置"),
            ("platform_fallback", "平台回退"),
        ],
        blank=True,
        default="",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-id"]
        verbose_name = "协作纪要"
        verbose_name_plural = "协作纪要"


class CollabMessageRead(models.Model):
    """消息级已读回执，用于精确统计读取延迟。"""

    room = models.ForeignKey(CollabRoom, related_name="message_reads", on_delete=models.CASCADE)
    message = models.ForeignKey(CollabMessage, related_name="read_receipts", on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="collab_message_reads",
        on_delete=models.CASCADE,
    )
    latency_ms = models.PositiveBigIntegerField("从发送到已读耗时(ms)", default=0)
    read_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["message", "user"],
                name="uniq_collab_message_reader",
            ),
        ]
        indexes = [
            models.Index(fields=["room", "read_at"], name="collab_read_room_time"),
        ]
        verbose_name = "协作消息已读"
        verbose_name_plural = "协作消息已读"


class CollabReadSession(models.Model):
    """一次打开会话的活跃阅读时长，前端分段上报并在同一会话内累加。"""

    room = models.ForeignKey(CollabRoom, related_name="read_sessions", on_delete=models.CASCADE)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="collab_read_sessions",
        on_delete=models.CASCADE,
    )
    session_key = models.CharField("前端会话标识", max_length=64)
    up_to_message_id = models.BigIntegerField("阅读到消息ID", default=0)
    active_duration_ms = models.PositiveBigIntegerField("活跃阅读时长(ms)", default=0)
    started_at = models.DateTimeField(auto_now_add=True)
    last_active_at = models.DateTimeField(auto_now=True, db_index=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["room", "user", "session_key"],
                name="uniq_collab_read_session",
            ),
        ]
        indexes = [
            models.Index(fields=["room", "last_active_at"], name="collab_session_room_time"),
        ]
        verbose_name = "协作阅读会话"
        verbose_name_plural = "协作阅读会话"


class XiaoceRun(models.Model):
    """一次可取消的小策bot回答执行。"""

    class Status(models.TextChoices):
        RUNNING = "running", "运行中"
        CANCELLED = "cancelled", "已暂停"
        COMPLETED = "completed", "已完成"
        FAILED = "failed", "失败"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    room = models.ForeignKey(
        CollabRoom,
        related_name="xiaoce_runs",
        on_delete=models.CASCADE,
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="xiaoce_runs",
        on_delete=models.CASCADE,
    )
    trigger_message = models.OneToOneField(
        CollabMessage,
        related_name="xiaoce_run",
        on_delete=models.CASCADE,
    )
    cancel_message = models.OneToOneField(
        CollabMessage,
        related_name="cancelled_xiaoce_run",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    result_message = models.OneToOneField(
        CollabMessage,
        related_name="result_xiaoce_run",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.RUNNING,
        db_index=True,
    )
    current_stage = models.CharField(max_length=64, blank=True, default="")
    progress_steps = models.JSONField(default=list, blank=True)
    meta = models.JSONField(default=dict, blank=True)
    error_code = models.CharField(max_length=64, blank=True, default="")
    error = models.TextField(blank=True, default="")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["room", "user"],
                condition=models.Q(status="running"),
                name="uniq_running_xiaoce_per_user_room",
            ),
        ]


class CollabInsight(models.Model):
    """AI 旁路分析结果。"""

    room = models.ForeignKey(CollabRoom, related_name="insights", on_delete=models.CASCADE)
    risk_level = models.CharField(
        "风险等级",
        max_length=16,
        choices=[("green", "正常"), ("yellow", "注意"), ("red", "高风险")],
        default="green",
    )
    title = models.CharField("标题", max_length=200)
    analysis = models.TextField("异常分析", blank=True, default="")
    advice = models.TextField("建议", blank=True, default="")
    control = models.TextField("风险管控", blank=True, default="")
    tags = models.JSONField("标签", default=list, blank=True)
    evidence_message_ids = models.JSONField("证据消息 ID", default=list, blank=True)
    draft_reply = models.TextField("合规回复草稿", blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-id"]
        verbose_name = "协作洞察"
        verbose_name_plural = "协作洞察"


class CollabPresence(models.Model):
    """用户在线心跳。最近活跃则视为在线。"""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        related_name="collab_presence",
        on_delete=models.CASCADE,
    )
    last_seen = models.DateTimeField("最后心跳", auto_now=True, db_index=True)

    class Meta:
        verbose_name = "协作在线状态"
        verbose_name_plural = "协作在线状态"
