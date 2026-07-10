from django.db import models


class OntObject(models.Model):
    """本体对象(ER 中的实体)。分物理 / 虚拟两大类。"""

    class Category(models.TextChoices):
        PHYSICAL = "physical", "物理"
        VIRTUAL = "virtual", "虚拟"

    # 预设类型(草图):物理:时间/空间/物体(人/电脑/工位);虚拟:岗位/流程/客户
    category = models.CharField("大类", max_length=16, choices=Category.choices, default=Category.PHYSICAL)
    otype = models.CharField("类型", max_length=32, default="物体")
    name = models.CharField("名称", max_length=128)
    attributes = models.JSONField("属性", default=dict, blank=True)
    x = models.FloatField("画布 X", default=0)
    y = models.FloatField("画布 Y", default=0)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        verbose_name = "本体对象"
        verbose_name_plural = "本体对象"
        ordering = ["id"]

    def __str__(self):
        return f"{self.name}({self.otype})"


class OntRelation(models.Model):
    """本体关系(ER 中的关系)。有向:source -> target。
    Loops 扩展:可标记为 CausalLink 候选并附极性/延迟/证据分。"""

    class Polarity(models.TextChoices):
        POSITIVE = "+", "正(+)"
        NEGATIVE = "-", "负(-)"

    source = models.ForeignKey(
        OntObject, on_delete=models.CASCADE, related_name="out_relations", verbose_name="起点"
    )
    target = models.ForeignKey(
        OntObject, on_delete=models.CASCADE, related_name="in_relations", verbose_name="终点"
    )
    label = models.CharField("关系", max_length=64, default="关联")
    polarity = models.CharField(
        "因果极性", max_length=1, choices=Polarity.choices, blank=True, default="",
    )
    delay_days = models.FloatField("延迟(天)", null=True, blank=True)
    evidence_score = models.PositiveSmallIntegerField("证据分", null=True, blank=True)
    is_causal_candidate = models.BooleanField("CausalLink候选", default=False)
    created_at = models.DateTimeField("创建时间", auto_now_add=True)

    class Meta:
        verbose_name = "本体关系"
        verbose_name_plural = "本体关系"
        ordering = ["id"]

    def __str__(self):
        return f"{self.source_id} -[{self.label}]-> {self.target_id}"
