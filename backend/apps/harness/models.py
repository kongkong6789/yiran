from django.db import models


class ApprovalRequest(models.Model):
    """高风险动作挂起后的审批单。"""

    class Status(models.TextChoices):
        PENDING = "pending", "待审批"
        APPROVED = "approved", "已批准"
        REJECTED = "rejected", "已驳回"
        EXECUTED = "executed", "已执行"

    trace_id = models.CharField("链路ID", max_length=64, db_index=True)
    action = models.CharField("动作", max_length=128)
    intent = models.CharField("意图", max_length=256, blank=True)
    payload = models.JSONField("动作参数", default=dict, blank=True)
    role = models.CharField("发起角色", max_length=64, default="operator")
    status = models.CharField(
        "状态", max_length=16, choices=Status.choices, default=Status.PENDING
    )
    checks = models.JSONField("闸机明细", default=list, blank=True)
    dry_run = models.JSONField("预执行", default=dict, blank=True)
    approver = models.CharField("审批人", max_length=128, blank=True, default="")
    comment = models.TextField("审批意见", blank=True, default="")
    result = models.JSONField("执行结果", default=dict, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    decided_at = models.DateTimeField("审批时间", null=True, blank=True)

    class Meta:
        verbose_name = "审批单"
        verbose_name_plural = "审批单"
        ordering = ["-created_at"]

    def __str__(self):
        return f"[{self.trace_id}] {self.action} ({self.status})"
