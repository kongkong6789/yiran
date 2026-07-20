from django.conf import settings
from django.db import models


class SmartSheet(models.Model):
    """一张多维表格（数据表）。"""

    name = models.CharField("名称", max_length=120)
    description = models.CharField("说明", max_length=500, blank=True, default="")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="smart_sheets",
        verbose_name="创建者",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "智能表格"
        verbose_name_plural = "智能表格"
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        return self.name


class SmartColumn(models.Model):
    class FieldType(models.TextChoices):
        TEXT = "text", "文本"
        NUMBER = "number", "数字"
        SELECT = "select", "单选"
        MULTI_SELECT = "multi_select", "多选"
        CHECKBOX = "checkbox", "勾选"
        DATE = "date", "日期"
        PERSON = "person", "人员"

    sheet = models.ForeignKey(
        SmartSheet,
        on_delete=models.CASCADE,
        related_name="columns",
        verbose_name="所属表格",
    )
    key = models.CharField("字段键", max_length=64)
    title = models.CharField("列名", max_length=120)
    field_type = models.CharField(
        "类型",
        max_length=16,
        choices=FieldType.choices,
        default=FieldType.TEXT,
    )
    options = models.JSONField("选项", default=list, blank=True)
    position = models.PositiveIntegerField("排序", default=0)

    class Meta:
        verbose_name = "表格列"
        verbose_name_plural = "表格列"
        ordering = ["position", "id"]
        unique_together = ("sheet", "key")

    def __str__(self):
        return f"{self.sheet_id}:{self.title}"


class SmartRow(models.Model):
    sheet = models.ForeignKey(
        SmartSheet,
        on_delete=models.CASCADE,
        related_name="rows",
        verbose_name="所属表格",
    )
    values = models.JSONField("单元格", default=dict, blank=True)
    position = models.PositiveIntegerField("排序", default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "表格行"
        verbose_name_plural = "表格行"
        ordering = ["position", "id"]

    def __str__(self):
        return f"row#{self.pk}@{self.sheet_id}"


class SmartView(models.Model):
    class ViewType(models.TextChoices):
        GRID = "grid", "表格"
        KANBAN = "kanban", "看板"
        FORM = "form", "表单"

    sheet = models.ForeignKey(
        SmartSheet,
        on_delete=models.CASCADE,
        related_name="views",
        verbose_name="所属表格",
    )
    name = models.CharField("视图名", max_length=120)
    view_type = models.CharField(
        "类型",
        max_length=16,
        choices=ViewType.choices,
        default=ViewType.GRID,
    )
    # filters / sorts / group_by / kanban_field / form_fields 等
    config = models.JSONField("配置", default=dict, blank=True)
    position = models.PositiveIntegerField("排序", default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "视图"
        verbose_name_plural = "视图"
        ordering = ["position", "id"]

    def __str__(self):
        return f"{self.sheet_id}:{self.name}"


class SmartAutomation(models.Model):
    class Trigger(models.TextChoices):
        ROW_CREATED = "row_created", "新增记录时"
        ROW_UPDATED = "row_updated", "更新记录时"

    class Action(models.TextChoices):
        SET_FIELD = "set_field", "设置字段值"

    sheet = models.ForeignKey(
        SmartSheet,
        on_delete=models.CASCADE,
        related_name="automations",
        verbose_name="所属表格",
    )
    name = models.CharField("名称", max_length=120)
    enabled = models.BooleanField("启用", default=True)
    trigger = models.CharField(max_length=32, choices=Trigger.choices)
    action = models.CharField(max_length=32, choices=Action.choices)
    config = models.JSONField("配置", default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "自动化"
        verbose_name_plural = "自动化"
        ordering = ["-updated_at", "-id"]

    def __str__(self):
        return self.name
