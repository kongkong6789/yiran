"""
基于当前图谱里的店铺 / 商品 / 指标，补齐 2～3 条可演示的因果闭环，并写入回路库。

用法:
  python manage.py seed_graph_loops
  python manage.py seed_graph_loops --reset   # 删除本组预置回路后重建
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.loops.models import FeedbackLoop, LoopMember
from apps.ontology.models import OntObject, OntRelation
from apps.ontology.signals import suppress_ontology_sync

PREFIX = "GRAPH-DEMO"


def _pick_object(otype: str, name: str) -> OntObject | None:
    return (
        OntObject.objects.filter(otype=otype, name=name)
        .order_by("id")
        .first()
    )


def _ensure_edge(
    source: OntObject,
    target: OntObject,
    *,
    label: str,
    polarity: str,
    delay_days: int = 0,
    evidence_score: int = 70,
) -> OntRelation:
    existing = (
        OntRelation.objects.filter(source=source, target=target, label=label)
        .order_by("id")
        .first()
    )
    if existing:
        existing.polarity = polarity
        existing.delay_days = delay_days
        existing.evidence_score = evidence_score
        existing.is_causal_candidate = True
        existing.save(
            update_fields=[
                "polarity",
                "delay_days",
                "evidence_score",
                "is_causal_candidate",
            ]
        )
        return existing
    return OntRelation.objects.create(
        source=source,
        target=target,
        label=label,
        polarity=polarity,
        delay_days=delay_days,
        evidence_score=evidence_score,
        is_causal_candidate=True,
    )


def _upsert_loop(
    *,
    code: str,
    name: str,
    loop_type: str,
    description: str,
    confidence: int,
    relation_ids: list[int],
) -> FeedbackLoop:
    loop = FeedbackLoop.objects.filter(code=code).order_by("id").first()
    if loop is None:
        loop = FeedbackLoop.objects.create(
            code=code,
            name=name,
            loop_type=loop_type,
            description=description,
            confidence=confidence,
            status=FeedbackLoop.Status.CONFIRMED,
            confirmed_by="图谱数据预置",
            confirmed_at=timezone.now(),
        )
    else:
        loop.name = name
        loop.loop_type = loop_type
        loop.description = description
        loop.confidence = confidence
        loop.status = FeedbackLoop.Status.CONFIRMED
        loop.confirmed_by = "图谱数据预置"
        loop.confirmed_at = timezone.now()
        loop.save()
    loop.members.all().delete()
    for i, rid in enumerate(relation_ids):
        LoopMember.objects.create(loop=loop, relation_id=rid, sequence=i)
    return loop


class Command(BaseCommand):
    help = "用当前图谱业务节点生成 2～3 条回路链条并写入回路库"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="先删除 code 以 GRAPH-DEMO 开头的预置回路",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        with suppress_ontology_sync():
            self._seed(options)

    def _seed(self, options):
        if options["reset"]:
            deleted, _ = FeedbackLoop.objects.filter(code__startswith=PREFIX).delete()
            self.stdout.write(self.style.WARNING(f"已删除预置回路 {deleted} 条"))

        shop_tm = _pick_object("店铺", "天猫旗舰店")
        shop_dy = _pick_object("店铺", "抖音小店")
        sku_dress = _pick_object("商品", "连衣裙-经典款")
        sku_sun = _pick_object("商品", "防晒霜 50ml")
        metric_gmv = _pick_object("指标定义", "GMV")
        metric_refund = _pick_object("指标定义", "退款率")
        metric_aov = _pick_object("指标定义", "客单价")
        alert = _pick_object("异常预警", "refund_rate")

        missing = [
            n
            for n, o in [
                ("店铺:天猫旗舰店", shop_tm),
                ("店铺:抖音小店", shop_dy),
                ("商品:连衣裙-经典款", sku_dress),
                ("商品:防晒霜 50ml", sku_sun),
                ("指标定义:GMV", metric_gmv),
                ("指标定义:退款率", metric_refund),
                ("指标定义:客单价", metric_aov),
                ("异常预警:refund_rate", alert),
            ]
            if o is None
        ]
        if missing:
            self.stderr.write(self.style.ERROR("缺少节点: " + ", ".join(missing)))
            return

        assert shop_tm and shop_dy and sku_dress and sku_sun
        assert metric_gmv and metric_refund and metric_aov and alert

        # —— 链条 1：增强 R · 天猫主推款销售飞轮 ——
        e1 = _ensure_edge(shop_tm, sku_dress, label="主推曝光", polarity="+", evidence_score=82)
        e2 = _ensure_edge(sku_dress, metric_gmv, label="拉动成交", polarity="+", evidence_score=85)
        e3 = _ensure_edge(metric_gmv, metric_aov, label="客单抬升", polarity="+", evidence_score=70)
        e4 = _ensure_edge(
            metric_aov, shop_tm, label="利润反哺投放", polarity="+", evidence_score=68,
        )
        loop1 = _upsert_loop(
            code=f"{PREFIX}-R1",
            name="天猫主推飞轮（店铺→爆款→GMV→客单→再投放）",
            loop_type=FeedbackLoop.LoopType.R,
            description=(
                "基于图谱中的「天猫旗舰店」「连衣裙-经典款」「GMV」「客单价」闭合："
                "店铺主推提升爆款曝光 → 成交拉动 GMV → 客单抬升 → 利润反哺店铺投放。"
            ),
            confidence=86,
            relation_ids=[e1.id, e2.id, e3.id, e4.id],
        )

        # —— 链条 2：调节 B · 退款率刹车 ——
        e5 = _ensure_edge(
            metric_gmv, metric_refund, label="放量抬升退款压力", polarity="+",
            delay_days=3, evidence_score=75,
        )
        e6 = _ensure_edge(
            metric_refund, alert, label="触发退款预警", polarity="+", evidence_score=90,
        )
        e7 = _ensure_edge(
            alert, metric_gmv, label="收紧策略抑制放量", polarity="-",
            delay_days=2, evidence_score=72,
        )
        loop2 = _upsert_loop(
            code=f"{PREFIX}-B1",
            name="退款刹车环（GMV→退款率→预警→收紧→GMV）",
            loop_type=FeedbackLoop.LoopType.B,
            description=(
                "GMV 放量抬升退款压力 → 触发 refund_rate 异常预警 → 运营收紧抑制放量，"
                "形成对销售飞轮的调节回路（单负极性）。"
            ),
            confidence=84,
            relation_ids=[e5.id, e6.id, e7.id],
        )

        # —— 链条 3：调节 B · 双店抢流量 ——
        e8 = _ensure_edge(
            shop_tm, shop_dy, label="流量争夺", polarity="-", evidence_score=65,
        )
        e9 = _ensure_edge(shop_dy, sku_sun, label="在售种草", polarity="+", evidence_score=78)
        e10 = _ensure_edge(sku_sun, metric_gmv, label="贡献成交", polarity="+", evidence_score=80)
        e11 = _ensure_edge(
            metric_gmv, shop_tm, label="总盘预算再分配", polarity="+",
            delay_days=7, evidence_score=66,
        )
        loop3 = _upsert_loop(
            code=f"{PREFIX}-B2",
            name="双店抢流环（天猫⊖抖音→防晒→GMV→再分配天猫）",
            loop_type=FeedbackLoop.LoopType.B,
            description=(
                "天猫与抖音存在流量争夺（负向），抖音侧种草防晒霜贡献 GMV，"
                "总盘预算再回灌天猫；整体为调节结构，体现渠道竞争对增长的约束。"
            ),
            confidence=78,
            relation_ids=[e8.id, e9.id, e10.id, e11.id],
        )

        self.stdout.write(self.style.SUCCESS("已生成 3 条图谱回路链条："))
        for loop in (loop1, loop2, loop3):
            chain = " → ".join(
                f"{m.relation.source.name}-[{m.relation.polarity or '?'}{m.relation.label}]→"
                f"{m.relation.target.name}"
                for m in loop.members.select_related("relation__source", "relation__target").order_by("sequence")
            )
            self.stdout.write(f"  [{loop.loop_type}] {loop.code} {loop.name}")
            self.stdout.write(f"      {chain}")
            self.stdout.write(f"      members={loop.members.count()}  status={loop.status}")