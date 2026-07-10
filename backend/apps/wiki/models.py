from django.db import models


class WikiPage(models.Model):
    """LLM Wiki 页面:按业务实体组织的知识页(品牌/店铺/SKU/流程/系统/指标)。"""

    class Kind(models.TextChoices):
        BRAND = "brand", "品牌页"
        SHOP = "shop", "店铺页"
        SKU = "sku", "SKU页"
        FLOW = "flow", "流程页"
        SYSTEM = "system", "系统页"
        METRIC = "metric", "指标页"

    kind = models.CharField("类型", max_length=16, choices=Kind.choices)
    key = models.CharField("实体标识", max_length=128, db_index=True)
    title = models.CharField("标题", max_length=200)
    content = models.TextField("内容(Markdown)", blank=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        verbose_name = "Wiki 页面"
        verbose_name_plural = "Wiki 页面"
        unique_together = ("kind", "key")
        ordering = ["kind", "key"]

    def __str__(self):
        return f"[{self.get_kind_display()}] {self.title}"
