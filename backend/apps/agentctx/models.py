from __future__ import annotations

from django.conf import settings
from django.db import models


class AgentMemoryItem(models.Model):
    """跨会话 / 会话级记忆条目。"""

    class Scope(models.TextChoices):
        USER = "user", "用户级"
        SESSION = "session", "会话级"

    class Kind(models.TextChoices):
        FACT = "fact", "事实"
        PREFERENCE = "preference", "偏好"
        SUMMARY = "summary", "摘要"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="agent_memory_items",
        on_delete=models.CASCADE,
        verbose_name="用户",
    )
    scope = models.CharField(
        "范围",
        max_length=16,
        choices=Scope.choices,
        default=Scope.USER,
        db_index=True,
    )
    session_id = models.UUIDField("会话 UUID", null=True, blank=True, db_index=True)
    kind = models.CharField(
        "类型",
        max_length=16,
        choices=Kind.choices,
        default=Kind.FACT,
        db_index=True,
    )
    content = models.TextField("内容")
    source = models.CharField("来源", max_length=64, blank=True, default="")
    importance = models.PositiveSmallIntegerField("重要度", default=5)
    expires_at = models.DateTimeField("过期时间", null=True, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["-importance", "-updated_at"]
        verbose_name = "Agent 记忆"
        verbose_name_plural = "Agent 记忆"
        indexes = [
            models.Index(fields=["user", "scope"], name="agentctx_mem_user_scope"),
            models.Index(fields=["user", "kind"], name="agentctx_mem_user_kind"),
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.content[:40]}"


class AgentSessionSummary(models.Model):
    """会话滚动摘要（Agent ChatSession 或 collab:room:{id}）。"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="agent_session_summaries",
        on_delete=models.CASCADE,
        verbose_name="用户",
    )
    session_key = models.CharField("会话键", max_length=128, db_index=True)
    summary = models.TextField("摘要", blank=True, default="")
    message_count = models.PositiveIntegerField("消息计数", default=0)
    updated_at = models.DateTimeField("更新时间", auto_now=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "会话摘要"
        verbose_name_plural = "会话摘要"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "session_key"],
                name="agentctx_summary_user_session_uniq",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "session_key"], name="agentctx_sum_user_sess"),
        ]

    def __str__(self) -> str:
        return f"{self.session_key}:{self.summary[:40]}"
