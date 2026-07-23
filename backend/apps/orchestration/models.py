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

    run_key = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    trace_id = models.CharField(max_length=64, unique=True)
    version = models.ForeignKey(SopVersion, on_delete=models.PROTECT, related_name="runs")
    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="sop_runs")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="sop_runs")
    work_task = models.ForeignKey(
        "core.WorkTask", null=True, blank=True, on_delete=models.SET_NULL, related_name="sop_runs"
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.RUNNING, db_index=True)
    current_node = models.CharField(max_length=96, blank=True, default="")
    input_data = models.JSONField(default=dict, blank=True)
    state_data = models.JSONField(default=dict, blank=True)
    output_data = models.JSONField(default=dict, blank=True)
    missing_fields = models.JSONField(default=list, blank=True)
    error = models.TextField(blank=True, default="")
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)


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
