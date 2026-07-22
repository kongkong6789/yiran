from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


def new_object_key() -> str:
    return f"obj:{uuid.uuid4().hex}"


def new_relation_key() -> str:
    return f"rel:{uuid.uuid4().hex}"


class OntologyStatus(models.TextChoices):
    CANDIDATE = "candidate", "候选"
    CONFIRMED = "confirmed", "已确认"
    ARCHIVED = "archived", "已归档"


class OntObject(models.Model):
    """企业内稳定身份的本体对象。画布字段保留以兼容现有前端。"""

    class Category(models.TextChoices):
        PHYSICAL = "physical", "物理"
        VIRTUAL = "virtual", "虚拟"

    organization = models.ForeignKey(
        "core.Organization", on_delete=models.CASCADE, related_name="ontology_objects", verbose_name="企业"
    )
    object_key = models.CharField("稳定对象标识", max_length=96, default=new_object_key)
    status = models.CharField(
        "状态", max_length=16, choices=OntologyStatus.choices, default=OntologyStatus.CANDIDATE, db_index=True
    )
    version = models.PositiveIntegerField("版本", default=1)
    source_system = models.CharField("来源系统", max_length=48, default="local", db_index=True)
    category = models.CharField("大类", max_length=16, choices=Category.choices, default=Category.PHYSICAL)
    otype = models.CharField("类型", max_length=32, default="物体")
    name = models.CharField("名称", max_length=128)
    attributes = models.JSONField("属性", default=dict, blank=True)
    x = models.FloatField("画布 X", default=0)
    y = models.FloatField("画布 Y", default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="created_ontology_objects", verbose_name="创建人",
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="confirmed_ontology_objects", verbose_name="确认人",
    )
    confirmed_at = models.DateTimeField("确认时间", null=True, blank=True)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "object_key"], name="uniq_org_ontology_object_key"),
        ]

    def __str__(self):
        return f"{self.name}({self.otype})"


class OntRelation(models.Model):
    """结构关系。旧因果字段保留一版兼容，权威因果数据位于 CausalLink。"""

    class Polarity(models.TextChoices):
        POSITIVE = "+", "正(+)"
        NEGATIVE = "-", "负(-)"

    organization = models.ForeignKey(
        "core.Organization", on_delete=models.CASCADE, related_name="ontology_relations", verbose_name="企业"
    )
    relation_key = models.CharField("稳定关系标识", max_length=96, default=new_relation_key)
    status = models.CharField(
        "状态", max_length=16, choices=OntologyStatus.choices, default=OntologyStatus.CANDIDATE, db_index=True
    )
    version = models.PositiveIntegerField("版本", default=1)
    source_system = models.CharField("来源系统", max_length=48, default="local", db_index=True)
    source = models.ForeignKey(OntObject, on_delete=models.CASCADE, related_name="out_relations", verbose_name="起点")
    target = models.ForeignKey(OntObject, on_delete=models.CASCADE, related_name="in_relations", verbose_name="终点")
    label = models.CharField("关系", max_length=64, default="关联")
    polarity = models.CharField("兼容因果极性", max_length=1, choices=Polarity.choices, blank=True, default="")
    delay_days = models.FloatField("兼容延迟(天)", null=True, blank=True)
    evidence_score = models.PositiveSmallIntegerField("兼容证据分", null=True, blank=True)
    is_causal_candidate = models.BooleanField("兼容因果候选", default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="created_ontology_relations", verbose_name="创建人",
    )
    created_at = models.DateTimeField("创建时间", auto_now_add=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(fields=["organization", "relation_key"], name="uniq_org_ontology_relation_key"),
        ]

    def __str__(self):
        return f"{self.source_id} -[{self.label}]-> {self.target_id}"


class OntAlias(models.Model):
    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="ontology_aliases")
    object = models.ForeignKey(OntObject, on_delete=models.CASCADE, related_name="aliases")
    alias = models.CharField(max_length=160)
    source_system = models.CharField(max_length=48, default="local")
    status = models.CharField(max_length=16, choices=OntologyStatus.choices, default=OntologyStatus.CANDIDATE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["organization", "alias", "source_system"], name="uniq_org_alias_source")]


class OntEvidence(models.Model):
    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="ontology_evidence")
    evidence_key = models.CharField(max_length=96)
    source_type = models.CharField(max_length=32, default="snapshot")
    source_ref = models.CharField(max_length=255)
    content_hash = models.CharField(max_length=80)
    summary = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["organization", "evidence_key"], name="uniq_org_evidence_key")]


class OntAssertion(models.Model):
    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="ontology_assertions")
    object = models.ForeignKey(OntObject, on_delete=models.CASCADE, related_name="assertions")
    predicate = models.CharField(max_length=96)
    value = models.JSONField()
    evidence = models.ForeignKey(OntEvidence, null=True, blank=True, on_delete=models.PROTECT, related_name="assertions")
    valid_from = models.DateTimeField()
    valid_to = models.DateTimeField(null=True, blank=True)
    recorded_from = models.DateTimeField(auto_now_add=True)
    recorded_to = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=16, choices=OntologyStatus.choices, default=OntologyStatus.CANDIDATE)


class OntologyVersion(models.Model):
    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="ontology_versions")
    version = models.PositiveIntegerField()
    content_hash = models.CharField(max_length=80)
    change_summary = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["organization", "version"], name="uniq_org_ontology_version")]


class CausalLink(models.Model):
    class Maturity(models.TextChoices):
        HYPOTHESIS = "hypothesis", "假设"
        SUPPORTED = "supported", "有证据支持"
        VALIDATED = "validated", "已验证"

    organization = models.ForeignKey("core.Organization", on_delete=models.CASCADE, related_name="causal_links")
    relation = models.OneToOneField(OntRelation, on_delete=models.CASCADE, related_name="causal_link")
    polarity = models.CharField(max_length=1, choices=OntRelation.Polarity.choices)
    delay_days = models.FloatField(null=True, blank=True)
    evidence_score = models.PositiveSmallIntegerField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=OntologyStatus.choices, default=OntologyStatus.CANDIDATE)
    maturity = models.CharField(max_length=16, choices=Maturity.choices, default=Maturity.HYPOTHESIS)
    evidence = models.ManyToManyField(OntEvidence, blank=True, related_name="causal_links")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
