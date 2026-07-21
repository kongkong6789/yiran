from django.conf import settings
from django.db import models


class UserSkill(models.Model):
    """用户个人启用的 Skill(用于 @ 调用),内容可来自 COS 仓库或本地缓存。"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="skills",
        on_delete=models.CASCADE,
        verbose_name="用户",
    )
    skill_id = models.CharField("Skill ID", max_length=64, db_index=True)
    name = models.CharField("名称", max_length=128)
    description = models.TextField("描述", blank=True, default="")
    raw_content = models.TextField("原始 SKILL.md", blank=True, default="")
    instructions = models.TextField("指令正文(不含 frontmatter)", blank=True, default="")
    source_asset = models.ForeignKey(
        "SkillAsset",
        related_name="adoptions",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="来源仓库",
    )
    enabled = models.BooleanField("启用", default=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "用户 Skill"
        verbose_name_plural = "用户 Skill"
        constraints = [
            models.UniqueConstraint(fields=["user", "skill_id"], name="uniq_user_skill"),
        ]
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.user_id}:{self.skill_id}"


class SkillAsset(models.Model):
    """COS Skill 仓库中的上传文件(与个人启用列表分离)。"""

    class Visibility(models.TextChoices):
        SHARED = "shared", "全员共享"
        PRIVATE = "private", "仅上传者"

    uploader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="skill_assets",
        on_delete=models.CASCADE,
        verbose_name="上传者",
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="owned_skill_assets",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="责任人",
    )
    skill_id = models.CharField("Skill ID", max_length=64, db_index=True)
    visibility = models.CharField(
        "可见范围",
        max_length=16,
        choices=Visibility.choices,
        default=Visibility.PRIVATE,
        db_index=True,
    )
    name = models.CharField("名称", max_length=128)
    description = models.TextField("描述", blank=True, default="")
    original_filename = models.CharField("原始文件名", max_length=255, default="SKILL.md")
    cos_bucket = models.CharField("COS 桶", max_length=128)
    cos_key = models.CharField("COS Key", max_length=512)
    cos_url = models.URLField("COS URL", max_length=1024)
    file_size = models.PositiveIntegerField("文件大小", default=0)
    instructions_preview = models.TextField("指令预览", blank=True, default="")
    package_kind = models.CharField(
        "包类型",
        max_length=16,
        choices=[("single", "单文件"), ("package", "完整包")],
        default="single",
    )
    package_manifest = models.JSONField("包文件清单", default=list, blank=True)
    skill_md_key = models.CharField("SKILL.md COS Key", max_length=512, blank=True, default="")
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "Skill 仓库"
        verbose_name_plural = "Skill 仓库"
        constraints = [
            models.UniqueConstraint(fields=["uploader", "skill_id"], name="uniq_uploader_skill_asset"),
        ]
        ordering = ["-updated_at"]

    def __str__(self):
        return f"asset:{self.uploader_id}:{self.skill_id}"


class SkillUsageEvent(models.Model):
    """Skill 被实际加载执行时写入的轻量审计事件。"""

    class Source(models.TextChoices):
        AGENT = "agent", "Agent 对话"
        COLLAB = "collab", "协作会话"
        DIRECT = "direct", "直接调用"

    skill_id = models.CharField("Skill ID", max_length=64, db_index=True)
    skill_name = models.CharField("技能名称", max_length=128, blank=True, default="")
    asset = models.ForeignKey(
        SkillAsset,
        related_name="usage_events",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="来源技能",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="skill_usage_events",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="调用人",
    )
    source = models.CharField("调用方式", max_length=16, choices=Source.choices, default=Source.AGENT)
    used_at = models.DateTimeField("调用时间", auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "Skill 使用事件"
        verbose_name_plural = "Skill 使用事件"
        ordering = ["-used_at", "-id"]
        indexes = [
            models.Index(fields=["skill_id", "used_at"], name="skill_usage_skill_time"),
            models.Index(fields=["user", "used_at"], name="skill_usage_user_time"),
        ]

    def __str__(self):
        return f"{self.skill_id}:{self.user_id}:{self.used_at.isoformat()}"
