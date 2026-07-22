from django.conf import settings
from django.db import models


class AgentProfile(models.Model):
    class ExecutionRole(models.TextChoices):
        OPERATOR = "operator", "操作员"
        MANAGER = "manager", "主管"
        DIRECTOR = "director", "总监"

    """对象 Agent:一个有人设/专长的参会角色。"""

    name = models.CharField("名称", max_length=64)
    emoji = models.CharField("头像 emoji", max_length=8, default="🤖")
    group = models.CharField("分类", max_length=64, blank=True, default="未分类")
    role = models.CharField("角色/人设", max_length=128, blank=True)
    expertise = models.CharField("专长", max_length=200, blank=True)
    persona = models.TextField("人设描述(系统提示)", blank=True)
    execution_role = models.CharField(
        "执行权限角色",
        max_length=16,
        choices=ExecutionRole.choices,
        default=ExecutionRole.OPERATOR,
    )
    is_active = models.BooleanField("可用于任务执行", default=True)
    quota_limit = models.PositiveBigIntegerField("任务额度上限", default=10000)
    quota_used = models.PositiveBigIntegerField("已使用额度", default=0)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    @property
    def quota_remaining(self) -> int:
        return max(0, self.quota_limit - self.quota_used)

    class Meta:
        verbose_name = "对象 Agent"
        verbose_name_plural = "对象 Agent"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.emoji} {self.name}"


class Meeting(models.Model):
    """一场围绕核心问题的圆桌会议。"""

    class Status(models.TextChoices):
        DRAFT = "draft", "草稿/待开始"
        ACTIVE = "active", "进行中"
        PAUSED = "paused", "已暂停"
        STOPPED = "stopped", "已结束"

    title = models.CharField("会议标题", max_length=200)
    question = models.TextField("核心问题(全程围绕它)")
    intro = models.TextField("会议简介", blank=True, default="")
    scheduled_at = models.DateTimeField("计划开始时间", null=True, blank=True)
    duration_minutes = models.PositiveIntegerField("预计时长(分钟)", default=60)
    status = models.CharField("状态", max_length=16, choices=Status.choices, default=Status.DRAFT)
    participants = models.ManyToManyField(AgentProfile, verbose_name="参会 Agent", related_name="meetings")
    human_participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        verbose_name="参会同事",
        related_name="council_meetings",
        blank=True,
    )
    context_summary = models.TextField("压缩后的上下文", blank=True)
    round = models.IntegerField("当前轮次", default=0)
    next_speaker_idx = models.IntegerField("下一位发言者下标", default=0)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    started_at = models.DateTimeField("实际开始时间", null=True, blank=True)

    class Meta:
        verbose_name = "会议"
        verbose_name_plural = "会议"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class Message(models.Model):
    """会议中的一条发言(Agent / 用户 / 系统)。"""

    class Speaker(models.TextChoices):
        AGENT = "agent", "Agent"
        USER = "user", "我"
        SYSTEM = "system", "系统"

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="messages")
    speaker_type = models.CharField("发言方", max_length=8, choices=Speaker.choices)
    speaker_name = models.CharField("发言者名", max_length=64)
    emoji = models.CharField("头像", max_length=8, default="🙂")
    agent = models.ForeignKey(AgentProfile, null=True, blank=True, on_delete=models.SET_NULL)
    content = models.TextField("内容")
    round = models.IntegerField("轮次", default=0)
    created_at = models.DateTimeField("时间", auto_now_add=True)

    class Meta:
        verbose_name = "发言"
        verbose_name_plural = "发言"
        ordering = ["id"]

    def __str__(self):
        return f"[{self.speaker_name}] {self.content[:20]}"


class Deliverable(models.Model):
    """会议产出物:方案(Markdown)、分析报告(HTML)、指标表(Excel)等。"""

    class Kind(models.TextChoices):
        MARKDOWN = "md", "Markdown 方案"
        HTML = "html", "HTML 分析报告"
        XLSX = "xlsx", "Excel 指标"

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="deliverables")
    kind = models.CharField("类型", max_length=16, choices=Kind.choices, default=Kind.MARKDOWN)
    title = models.CharField("标题", max_length=200)
    filename = models.CharField("文件名", max_length=255, blank=True, default="")
    content = models.TextField("内容(文本或 base64)")
    version = models.IntegerField("版本", default=1)
    created_at = models.DateTimeField("时间", auto_now_add=True)

    class Meta:
        verbose_name = "方案文件"
        verbose_name_plural = "方案文件"
        ordering = ["-version"]

    def __str__(self):
        return f"{self.title} v{self.version}"


class MeetingInvite(models.Model):
    """拉同事进会时的待处理邀请（用于对方醒目提醒）。"""

    class Status(models.TextChoices):
        PENDING = "pending", "待处理"
        SEEN = "seen", "已查看"
        JOINED = "joined", "已进入"
        DISMISSED = "dismissed", "稍后再说"

    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE, related_name="invites")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="council_invites",
    )
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="council_invites_sent",
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "会议邀请"
        verbose_name_plural = "会议邀请"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["user", "status", "-created_at"],
                name="council_mee_user_id_7f9a1c_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(fields=["meeting", "user"], name="uniq_council_invite_meeting_user"),
        ]

    def __str__(self):
        return f"invite#{self.id} meeting={self.meeting_id} → user={self.user_id}"
