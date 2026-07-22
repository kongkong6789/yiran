from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


def new_snapshot_key() -> str:
    return f"snap:{uuid.uuid4().hex}"


def new_raw_import_key() -> str:
    return f"raw:{uuid.uuid4().hex}"


class SourceSnapshot(models.Model):
    class SourceMode(models.TextChoices):
        LIVE = "live", "真实来源"
        FIXTURE = "fixture", "样例"
        MOCK = "mock", "模拟"

    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="source_snapshots")
    snapshot_key = models.CharField(max_length=96, default=new_snapshot_key)
    source_system = models.CharField(max_length=64)
    source_mode = models.CharField(max_length=16, choices=SourceMode.choices, default=SourceMode.LIVE)
    scope = models.JSONField(default=dict)
    as_of = models.DateTimeField()
    complete = models.BooleanField(default=False)
    completeness = models.JSONField(default=dict, blank=True)
    schema_version = models.CharField(max_length=32)
    row_count = models.PositiveIntegerField(default=0)
    content_hash = models.CharField(max_length=80)
    payload = models.JSONField(default=dict, blank=True)
    governance_status = models.CharField(max_length=24, default="legacy_accepted")
    reconciliation_status = models.CharField(max_length=24, default="not_required")
    manifest_hash = models.CharField(max_length=80, blank=True, default="")
    boundary_covered = models.BooleanField(default=True)
    source_complete = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-as_of", "-id"]
        constraints = [models.UniqueConstraint(fields=["organization", "snapshot_key"], name="uniq_org_snapshot_key")]


class MetricContract(models.Model):
    organization = models.ForeignKey(
        "core.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="metric_contracts",
        help_text="为空表示平台内置契约。",
    )
    metric_id = models.CharField(max_length=64)
    version = models.CharField(max_length=32, default="v1")
    name = models.CharField(max_length=128)
    formula = models.TextField()
    unit = models.CharField(max_length=32)
    dimensions = models.JSONField(default=list)
    time_window = models.JSONField(default=dict)
    missing_policy = models.CharField(max_length=32, default="block")
    contract_hash = models.CharField(max_length=80)
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["organization", "metric_id", "version"], name="uniq_org_metric_contract")]


class MetricResult(models.Model):
    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="metric_results")
    contract = models.ForeignKey(MetricContract, on_delete=models.PROTECT, related_name="results")
    snapshot = models.ForeignKey(SourceSnapshot, on_delete=models.PROTECT, related_name="metric_results")
    value = models.DecimalField(max_digits=30, decimal_places=8)
    unit = models.CharField(max_length=32)
    dimensions = models.JSONField(default=dict)
    as_of = models.DateTimeField()
    query_fingerprint = models.CharField(max_length=80)
    result_fingerprint = models.CharField(max_length=80)
    warnings = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "contract", "snapshot", "query_fingerprint"],
                name="uniq_metric_result_fingerprint",
            )
        ]


class ImportContract(models.Model):
    class SignoffStatus(models.TextChoices):
        CANDIDATE = "candidate", "候选"
        CONFIRMED = "confirmed", "已确认"
        ARCHIVED = "archived", "已归档"

    organization = models.ForeignKey(
        "core.Organization", null=True, blank=True, on_delete=models.CASCADE, related_name="datalake_import_contracts",
    )
    contract_key = models.CharField(max_length=96)
    version = models.CharField(max_length=32, default="v1")
    dataset_type = models.CharField(max_length=64, default="sales_ledger")
    schema = models.JSONField(default=dict)
    contract_hash = models.CharField(max_length=80)
    signoff_status = models.CharField(max_length=16, choices=SignoffStatus.choices, default=SignoffStatus.CANDIDATE)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="confirmed_import_contracts",
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "contract_key", "version"], name="uniq_org_import_contract_version",
            )
        ]


class ReferenceMappingSet(models.Model):
    class MappingKind(models.TextChoices):
        CHANNEL = "channel", "渠道"
        PRODUCT = "product", "商品"
        WAREHOUSE = "warehouse", "仓库"

    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="reference_mapping_sets")
    mapping_key = models.CharField(max_length=96)
    kind = models.CharField(max_length=16, choices=MappingKind.choices)
    version = models.CharField(max_length=32, default="v1")
    mappings = models.JSONField(default=dict)
    content_hash = models.CharField(max_length=80)
    status = models.CharField(
        max_length=16, choices=ImportContract.SignoffStatus.choices, default=ImportContract.SignoffStatus.CANDIDATE,
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="confirmed_mapping_sets",
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "mapping_key", "version"], name="uniq_org_mapping_version",
            )
        ]


class RawImportBatch(models.Model):
    class Status(models.TextChoices):
        PROCESSING = "processing", "处理中"
        QUARANTINED = "quarantined", "待对账"
        READY = "ready", "可生成快照"
        REJECTED = "rejected", "已拒绝"

    class ReconciliationStatus(models.TextChoices):
        PENDING = "pending", "待对账"
        PASSED = "passed", "已通过"
        REJECTED = "rejected", "已拒绝"

    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="raw_import_batches")
    import_key = models.CharField(max_length=96, default=new_raw_import_key)
    dataset_type = models.CharField(max_length=64, default="sales_ledger")
    source_system = models.CharField(max_length=64)
    contract = models.ForeignKey(ImportContract, on_delete=models.PROTECT, related_name="import_batches")
    channel_mapping = models.ForeignKey(
        ReferenceMappingSet, null=True, blank=True, on_delete=models.PROTECT, related_name="channel_import_batches",
    )
    product_mapping = models.ForeignKey(
        ReferenceMappingSet, null=True, blank=True, on_delete=models.PROTECT, related_name="product_import_batches",
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PROCESSING)
    reconciliation_status = models.CharField(
        max_length=16, choices=ReconciliationStatus.choices, default=ReconciliationStatus.PENDING,
    )
    manifest_hash = models.CharField(max_length=80)
    content_hash = models.CharField(max_length=80)
    schema_version = models.CharField(max_length=32)
    window_start = models.DateField(null=True, blank=True)
    window_end = models.DateField(null=True, blank=True)
    actual_start = models.DateField(null=True, blank=True)
    actual_end = models.DateField(null=True, blank=True)
    boundary_covered = models.BooleanField(default=False)
    source_complete = models.BooleanField(default=False)
    row_count = models.PositiveIntegerField(default=0)
    accepted_row_count = models.PositiveIntegerField(default=0)
    quarantine_summary = models.JSONField(default=dict, blank=True)
    quality_signals = models.JSONField(default=dict, blank=True)
    aggregate_receipt = models.JSONField(default=dict, blank=True)
    snapshot = models.OneToOneField(
        SourceSnapshot, null=True, blank=True, on_delete=models.PROTECT, related_name="raw_import_batch",
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    reconciled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="reconciled_raw_imports",
    )
    reconciled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "import_key"], name="uniq_org_raw_import_key")
        ]
