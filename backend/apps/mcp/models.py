from django.conf import settings
from django.db import models


class McpServerConfig(models.Model):
    """用户个人的 MCP Server 连接配置(每人独立,不共享)。"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="mcp_configs",
        on_delete=models.CASCADE,
        verbose_name="用户",
        null=True,
        blank=True,
    )
    server_id = models.CharField("服务 ID", max_length=64, db_index=True)
    url = models.CharField("MCP URL", max_length=500, blank=True, default="")
    command = models.CharField("stdio command", max_length=255, blank=True, default="")
    args = models.JSONField("stdio args", default=list, blank=True)
    env = models.JSONField("环境变量", default=dict, blank=True)
    enabled = models.BooleanField("启用", default=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "MCP 服务配置"
        verbose_name_plural = "MCP 服务配置"
        constraints = [
            models.UniqueConstraint(fields=["user", "server_id"], name="uniq_user_mcp_server"),
        ]

    def __str__(self):
        return f"{self.user_id}:{self.server_id}"