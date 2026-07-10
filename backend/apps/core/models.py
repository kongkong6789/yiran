from django.db import models


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
