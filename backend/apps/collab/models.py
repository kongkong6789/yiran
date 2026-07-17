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


class XiaoceRun(models.Model):
    """一次可暂停并可恢复公开进度的小策bot执行。"""

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
