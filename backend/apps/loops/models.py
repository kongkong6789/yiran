from django.db import models

from apps.ontology.models import OntRelation


class FeedbackLoop(models.Model):
    """反馈回路实例(L3)。由 CausalLink 闭合路径 + 人工确认生成。"""

    class LoopType(models.TextChoices):
        R = "R", "增强回路"
        B = "B", "调节回路"
        COMP = "comp", "复合回路"

    class Status(models.TextChoices):
        CANDIDATE = "candidate", "候选"
        CONFIRMED = "confirmed", "已确认"
        ARCHIVED = "archived", "已归档"

    code = models.CharField("编号", max_length=32, blank=True, default="")
    name = models.CharField("名称", max_length=128)
    loop_type = models.CharField("类型", max_length=8, choices=LoopType.choices, default=LoopType.R)
    description = models.TextField("描述", blank=True, default="")
    confidence = models.PositiveSmallIntegerField("置信度", default=0)
    status = models.CharField(
        "状态", max_length=16, choices=Status.choices, default=Status.CANDIDATE,
    )
    confirmed_by = models.CharField("确认人", max_length=64, blank=True, default="")
    confirmed_at = models.DateTimeField("确认时间", null=True, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "反馈回路"
        verbose_name_plural = "反馈回路"
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        return f"{self.code or self.id}:{self.name}({self.loop_type})"


class LoopMember(models.Model):
    """回路成员:有序 CausalLink(OntRelation) 链。"""

    loop = models.ForeignKey(
        FeedbackLoop, on_delete=models.CASCADE, related_name="members", verbose_name="回路",
    )
    relation = models.ForeignKey(
        OntRelation, on_delete=models.CASCADE, related_name="loop_memberships", verbose_name="因果链",
    )
    sequence = models.PositiveIntegerField("顺序", default=0)
    note = models.CharField("备注", max_length=256, blank=True, default="")

    class Meta:
        verbose_name = "回路成员"
        verbose_name_plural = "回路成员"
        ordering = ["sequence", "id"]
        constraints = [
            models.UniqueConstraint(fields=["loop", "relation"], name="uniq_loop_relation"),
        ]

    def __str__(self):
        return f"loop={self.loop_id} rel={self.relation_id} seq={self.sequence}"
