from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class SopDefinition(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "草稿"
        PUBLISHED = "published", "已发布"
        ARCHIVED = "archived", "已归档"

    sop_key = models.CharField(max_length=96)
    organization = models.ForeignKey(
        "core.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="sop_definitions"
    )
    name = models.CharField(max_length=128)
    business_domain = models.CharField(max_length=64, blank=True, default="")
    description = models.CharField(max_length=500, blank=True, default="")
    action_name = models.CharField(max_length=96, blank=True, default="", db_index=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)
    current_version = models.CharField(max_length=32, blank=True, default="")
    call_count = models.PositiveIntegerField(default=0)
    success_count = models.PositiveIntegerField(default=0)
    failure_count = models.PositiveIntegerField(default=0)
    trial_count = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_sops"
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="updated_sops"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["business_domain", "name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "sop_key"], name="orchestration_sop_org_key_uniq"),
            models.UniqueConstraint(
                fields=["sop_key"], condition=models.Q(organization__isnull=True), name="orchestration_sop_system_key_uniq"
            ),
        ]

    @property
    def is_system(self) -> bool:
        return self.organization_id is None


class SopVersion(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "草稿"
        PUBLISHED = "published", "已发布"
        RETIRED = "retired", "已停用"

    definition = models.ForeignKey(SopDefinition, on_delete=models.CASCADE, related_name="versions")
    version = models.CharField(max_length=32)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)
    graph = models.JSONField(default=dict)
    input_schema = models.JSONField(default=dict, blank=True)
    output_schema = models.JSONField(default=dict, blank=True)
    trigger_intents = models.JSONField(default=list, blank=True)
    utterance_examples = models.JSONField(default=list, blank=True)
    content_hash = models.CharField(max_length=64, db_index=True)
    change_summary = models.CharField(max_length=300, blank=True, default="")
    editor_chat = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="created_sop_versions"
    )
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="published_sop_versions"
    )
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["definition", "version"], name="orchestration_sop_version_uniq")]


class SopRun(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "运行中"
        NEED_INPUT = "need_input", "等待补充"
        COMPLETED = "completed", "已完成"
        FAILED = "failed", "失败"
        HANDOFF = "handoff", "转人工"

    class Source(models.TextChoices):
        LIVE = "live", "正式"
        TRIAL = "trial", "试跑"
        RESUME = "resume", "续跑"

    run_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    trace_id = models.CharField(max_length=64, unique=True)
    version = models.ForeignKey(SopVersion, on_delete=models.PROTECT, related_name="runs")
    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="sop_runs")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sop_runs")
    work_task = models.ForeignKey(
        "core.WorkTask", null=True, blank=True, on_delete=models.SET_NULL, related_name="sop_runs"
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RUNNING, db_index=True)
    source = models.CharField(max_length=16, choices=Source.choices, default=Source.LIVE, db_index=True)
    is_trial = models.BooleanField(default=False, db_index=True)
    current_node = models.CharField(max_length=96, blank=True, default="")
    input_data = models.JSONField(default=dict, blank=True)
    state_data = models.JSONField(default=dict, blank=True)
    output_data = models.JSONField(default=dict, blank=True)
    missing_fields = models.JSONField(default=list, blank=True)
    error = models.TextField(blank=True, default="")
    outcome_tags = models.JSONField(default=list, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["organization", "-started_at"], name="orch_soprun_org_started_idx"),
        ]


class SopNodeRun(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "运行中"
        COMPLETED = "completed", "完成"
        SKIPPED = "skipped", "跳过"
        NEED_INPUT = "need_input", "等待补充"
        FAILED = "failed", "失败"

    run = models.ForeignKey(SopRun, on_delete=models.CASCADE, related_name="node_runs")
    sequence = models.PositiveIntegerField()
    node_key = models.CharField(max_length=96)
    node_type = models.CharField(max_length=32)
    title = models.CharField(max_length=128)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RUNNING)
    input_data = models.JSONField(default=dict, blank=True)
    output_data = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True, default="")
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["sequence", "id"]
        constraints = [models.UniqueConstraint(fields=["run", "sequence"], name="orchestration_sop_node_seq_uniq")]


class SopEvolutionSignal(models.Model):
    """Aggregated learning signals from production (non-trial) SOP runs."""

    class SignalType(models.TextChoices):
        NEED_INPUT_LOOP = "need_input_loop", "反复等待输入"
        CHECKPOINT_REJECT = "checkpoint_reject", "确认驳回"
        ACTION_FAIL = "action_fail", "动作失败"
        HANDOFF = "handoff", "转人工"
        SLOW_NODE = "slow_node", "节点耗时过长"
        UNUSED_BRANCH = "unused_branch", "分支很少走到"
        MISSING_FIELD_REPEAT = "missing_field_repeat", "字段反复缺失"

    definition = models.ForeignKey(SopDefinition, on_delete=models.CASCADE, related_name="evolution_signals")
    version = models.ForeignKey(
        SopVersion, null=True, blank=True, on_delete=models.SET_NULL, related_name="evolution_signals"
    )
    organization = models.ForeignKey(
        "core.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="sop_evolution_signals"
    )
    node_key = models.CharField(max_length=96, blank=True, default="", db_index=True)
    signal_type = models.CharField(max_length=32, choices=SignalType.choices, db_index=True)
    count = models.PositiveIntegerField(default=0)
    last_seen_at = models.DateTimeField(auto_now=True)
    sample_run_ids = models.JSONField(default=list, blank=True)
    payload_summary = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-last_seen_at", "-count"]
        constraints = [
            models.UniqueConstraint(
                fields=["definition", "node_key", "signal_type"],
                name="orchestration_sop_evolution_signal_uniq",
            ),
        ]


class SopEvolutionProposal(models.Model):
    class Status(models.TextChoices):
        PROPOSED = "proposed", "已提出"
        VALIDATED = "validated", "已校验"
        TRIAL_PASSED = "trial_passed", "试跑通过"
        TRIAL_FAILED = "trial_failed", "试跑失败"
        DRAFTED = "drafted", "已生成草稿"
        ACCEPTED = "accepted", "已采纳"
        REJECTED = "rejected", "已拒绝"
        EXPIRED = "expired", "已过期"

    class Category(models.TextChoices):
        GRAPH = "graph", "流程"
        SKILL = "skill", "技能"
        POLICY = "policy", "策略"

    class RiskLevel(models.TextChoices):
        LOW = "low", "低"
        MEDIUM = "medium", "中"
        HIGH = "high", "高"

    definition = models.ForeignKey(SopDefinition, on_delete=models.CASCADE, related_name="evolution_proposals")
    base_version = models.ForeignKey(
        SopVersion, null=True, blank=True, on_delete=models.SET_NULL, related_name="evolution_proposals_base"
    )
    draft_version = models.ForeignKey(
        SopVersion, null=True, blank=True, on_delete=models.SET_NULL, related_name="evolution_proposals_draft"
    )
    organization = models.ForeignKey(
        "core.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="sop_evolution_proposals"
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PROPOSED, db_index=True)
    category = models.CharField(max_length=16, choices=Category.choices, default=Category.GRAPH, db_index=True)
    risk_level = models.CharField(max_length=16, choices=RiskLevel.choices, default=RiskLevel.LOW, db_index=True)
    title = models.CharField(max_length=160)
    rationale = models.TextField(blank=True, default="")
    evidence = models.JSONField(default=dict, blank=True)
    patch = models.JSONField(default=dict, blank=True)
    proposed_graph = models.JSONField(default=dict, blank=True)
    trial_result = models.JSONField(default=dict, blank=True)
    created_by_system = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sop_evolution_proposals",
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_sop_evolution_proposals",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
