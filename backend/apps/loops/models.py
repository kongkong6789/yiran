from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models

from apps.ontology.models import OntRelation


def new_loop_key() -> str:
    return f"loop:{uuid.uuid4().hex}"


def new_simulation_key() -> str:
    return f"sim:{uuid.uuid4().hex}"


class FeedbackLoop(models.Model):
    class LoopType(models.TextChoices):
        R = "R", "增强回路"
        B = "B", "调节回路"
        COMP = "comp", "复合回路"

    class Status(models.TextChoices):
        CANDIDATE = "candidate", "候选"
        CONFIRMED = "confirmed", "已确认"
        ARCHIVED = "archived", "已归档"

    class CausalMaturity(models.TextChoices):
        HYPOTHESIS = "hypothesis", "假设"
        SUPPORTED = "supported", "有证据支持"
        VALIDATED = "validated", "已验证"

    class ModelLevel(models.TextChoices):
        L0 = "L0", "定性解释"
        L1 = "L1", "启发式情景"
        L2 = "L2", "校准情景"
        L3 = "L3", "回测验证"
        L4 = "L4", "受控预测"

    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="feedback_loops")
    loop_key = models.CharField("稳定回路标识", max_length=96, default=new_loop_key)
    code = models.CharField("编号", max_length=64, blank=True, default="")
    name = models.CharField("名称", max_length=128)
    loop_type = models.CharField("类型", max_length=8, choices=LoopType.choices, default=LoopType.R)
    description = models.TextField("描述", blank=True, default="")
    confidence = models.PositiveSmallIntegerField("置信度", default=0)
    status = models.CharField("状态", max_length=16, choices=Status.choices, default=Status.CANDIDATE)
    causal_maturity = models.CharField(max_length=16, choices=CausalMaturity.choices, default=CausalMaturity.HYPOTHESIS)
    model_level = models.CharField(max_length=2, choices=ModelLevel.choices, default=ModelLevel.L0)
    current_version_number = models.PositiveIntegerField(default=0)
    confirmed_by = models.CharField("兼容确认人", max_length=64, blank=True, default="")
    confirmed_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="confirmed_loops"
    )
    confirmed_at = models.DateTimeField("确认时间", null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_loops"
    )
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["-updated_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["organization", "loop_key"], name="uniq_org_loop_key")]

    def __str__(self):
        return f"{self.code or self.id}:{self.name}({self.loop_type})"


class LoopMember(models.Model):
    loop = models.ForeignKey(FeedbackLoop, on_delete=models.CASCADE, related_name="members")
    relation = models.ForeignKey(OntRelation, on_delete=models.CASCADE, related_name="loop_memberships")
    sequence = models.PositiveIntegerField(default=0)
    note = models.CharField(max_length=256, blank=True, default="")

    class Meta:
        ordering = ["sequence", "id"]
        constraints = [models.UniqueConstraint(fields=["loop", "relation"], name="uniq_loop_relation")]


class LoopVersion(models.Model):
    loop = models.ForeignKey(FeedbackLoop, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=FeedbackLoop.Status.choices, default=FeedbackLoop.Status.CANDIDATE)
    definition = models.JSONField(default=dict)
    parameter_hash = models.CharField(max_length=80)
    engine_version = models.CharField(max_length=32, default="inventory-balance-v1")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]
        constraints = [models.UniqueConstraint(fields=["loop", "version"], name="uniq_loop_version")]


class Stock(models.Model):
    version = models.ForeignKey(LoopVersion, on_delete=models.CASCADE, related_name="stocks")
    key = models.CharField(max_length=64)
    name = models.CharField(max_length=128)
    unit = models.CharField(max_length=32)
    lower_bound = models.FloatField(null=True, blank=True)
    upper_bound = models.FloatField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["version", "key"], name="uniq_version_stock_key")]


class Flow(models.Model):
    version = models.ForeignKey(LoopVersion, on_delete=models.CASCADE, related_name="flows")
    key = models.CharField(max_length=64)
    name = models.CharField(max_length=128)
    unit = models.CharField(max_length=32)
    source_stock = models.ForeignKey(Stock, null=True, blank=True, on_delete=models.CASCADE, related_name="outflows")
    target_stock = models.ForeignKey(Stock, null=True, blank=True, on_delete=models.CASCADE, related_name="inflows")
    equation = models.TextField(blank=True, default="")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["version", "key"], name="uniq_version_flow_key")]


class Delay(models.Model):
    version = models.ForeignKey(LoopVersion, on_delete=models.CASCADE, related_name="delays")
    flow = models.ForeignKey(Flow, null=True, blank=True, on_delete=models.CASCADE, related_name="delays")
    key = models.CharField(max_length=64)
    days = models.FloatField()


class Intervention(models.Model):
    version = models.ForeignKey(LoopVersion, on_delete=models.CASCADE, related_name="interventions")
    key = models.CharField(max_length=64)
    name = models.CharField(max_length=128)
    unit = models.CharField(max_length=32)
    parameters = models.JSONField(default=dict)


class MetricBinding(models.Model):
    version = models.ForeignKey(LoopVersion, on_delete=models.CASCADE, related_name="metric_bindings")
    variable_key = models.CharField(max_length=64)
    contract = models.ForeignKey("datalake.MetricContract", on_delete=models.PROTECT, related_name="loop_bindings")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["version", "variable_key"], name="uniq_version_metric_binding")]


class EvidenceBinding(models.Model):
    version = models.ForeignKey(LoopVersion, on_delete=models.CASCADE, related_name="evidence_bindings")
    evidence = models.ForeignKey("ontology.OntEvidence", on_delete=models.PROTECT, related_name="loop_bindings")
    purpose = models.CharField(max_length=128, default="model_definition")


class SimulationRun(models.Model):
    class Status(models.TextChoices):
        COMPLETED = "completed", "完成"
        BLOCKED = "blocked", "阻断"
        FAILED = "failed", "失败"

    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="simulation_runs")
    run_key = models.CharField(max_length=96, default=new_simulation_key)
    idempotency_key = models.CharField(max_length=96)
    version = models.ForeignKey(LoopVersion, on_delete=models.PROTECT, related_name="simulation_runs")
    snapshot = models.ForeignKey("datalake.SourceSnapshot", on_delete=models.PROTECT, related_name="simulation_runs")
    metric_results = models.ManyToManyField("datalake.MetricResult", related_name="simulation_runs")
    parameters = models.JSONField(default=dict)
    input_hash = models.CharField(max_length=80)
    result = models.JSONField(default=dict)
    result_hash = models.CharField(max_length=80)
    engine_version = models.CharField(max_length=32)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.COMPLETED)
    warnings = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["organization", "idempotency_key"], name="uniq_org_sim_idempotency")]
