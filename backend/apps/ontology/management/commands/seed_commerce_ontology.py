"""
播种电商经营 Ontology 样例包含链（一期）。

用法:
  python manage.py seed_commerce_ontology
  python manage.py seed_commerce_ontology --reset
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.ontology.commerce_schema import (
    COMMERCE_OBJECT_TYPES,
    CONTAINMENT_CHAIN,
    LOOP_LEVEL_OBJECT,
    category_for,
)
from apps.ontology.models import OntObject, OntRelation
from apps.ontology.signals import suppress_ontology_sync
from apps.core.models import Organization

SEED_ATTR = {"commerce_seed": True, "source": "seed_commerce_ontology"}


def _ensure_obj(*, organization, otype: str, name: str, type_key: str, x: float, y: float) -> OntObject:
    qs = OntObject.objects.filter(organization=organization, otype=otype, name=name)
    obj = qs.order_by("id").first()
    attrs = {
        **SEED_ATTR,
        "type_key": type_key,
        "loop_level": COMMERCE_OBJECT_TYPES.get(type_key, {}).get("loop_level"),
    }
    if obj is None:
        return OntObject.objects.create(
            organization=organization,
            category=category_for(type_key),
            otype=otype,
            name=name,
            attributes=attrs,
            x=x,
            y=y,
        )
    obj.category = category_for(type_key)
    obj.attributes = {**(obj.attributes or {}), **attrs}
    obj.x = x
    obj.y = y
    obj.save(update_fields=["category", "attributes", "x", "y"])
    return obj


def _ensure_rel(source: OntObject, target: OntObject, label: str) -> OntRelation:
    existing = (
        OntRelation.objects.filter(source=source, target=target, label=label)
        .order_by("id")
        .first()
    )
    if existing:
        return existing
    return OntRelation.objects.create(organization=source.organization, source=source, target=target, label=label)


class Command(BaseCommand):
    help = "播种电商包含链：公司→品牌→平台→店铺→链接→SKU，并对齐回路层级。"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="删除此前 commerce_seed 样例对象后重建",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        organization = Organization.objects.order_by("id").first()
        if organization is None:
            organization = Organization.objects.create(name="默认企业")
        with suppress_ontology_sync():
            if options["reset"]:
                doomed = OntObject.objects.filter(organization=organization, attributes__commerce_seed=True)
                n = doomed.count()
                doomed.delete()
                self.stdout.write(self.style.WARNING(f"已删除旧样例对象 {n} 个"))

            # 样例实体树（与前端 loops 样例语义对齐）
            company = _ensure_obj(organization=organization,
                otype=COMMERCE_OBJECT_TYPES["Organization"]["label"],
                name="良策代理公司（样例）",
                type_key="Organization",
                x=40,
                y=200,
            )
            brand = _ensure_obj(organization=organization,
                otype=COMMERCE_OBJECT_TYPES["Brand"]["label"],
                name="示例品牌 · 花语",
                type_key="Brand",
                x=220,
                y=200,
            )
            platform = _ensure_obj(organization=organization,
                otype=COMMERCE_OBJECT_TYPES["Channel"]["label"],
                name="天猫",
                type_key="Channel",
                x=400,
                y=200,
            )
            shop = _ensure_obj(organization=organization,
                otype=COMMERCE_OBJECT_TYPES["Shop"]["label"],
                name="花语旗舰店",
                type_key="Shop",
                x=580,
                y=200,
            )
            link = _ensure_obj(organization=organization,
                otype=COMMERCE_OBJECT_TYPES["Product"]["label"],
                name="精华液链接 · 多规格",
                type_key="Product",
                x=760,
                y=200,
            )
            sku_a = _ensure_obj(organization=organization,
                otype=COMMERCE_OBJECT_TYPES["SKU"]["label"],
                name="精华 30ml",
                type_key="SKU",
                x=940,
                y=140,
            )
            sku_b = _ensure_obj(organization=organization,
                otype=COMMERCE_OBJECT_TYPES["SKU"]["label"],
                name="精华 50ml",
                type_key="SKU",
                x=940,
                y=260,
            )

            chain_objs = {
                "Organization": company,
                "Brand": brand,
                "Channel": platform,
                "Shop": shop,
                "Product": link,
            }
            for parent_key, child_key, label in CONTAINMENT_CHAIN:
                if child_key == "SKU":
                    _ensure_rel(chain_objs[parent_key], sku_a, label)
                    _ensure_rel(chain_objs[parent_key], sku_b, label)
                else:
                    _ensure_rel(chain_objs[parent_key], chain_objs[child_key], label)
                # 同时写归属边（反向语义便于查询）
                if child_key == "SKU":
                    _ensure_rel(sku_a, chain_objs[parent_key], "归属")
                    _ensure_rel(sku_b, chain_objs[parent_key], "归属")
                else:
                    _ensure_rel(chain_objs[child_key], chain_objs[parent_key], "归属")

            # 第二品牌枝，证明公司可含多品牌
            brand2 = _ensure_obj(organization=organization,
                otype=COMMERCE_OBJECT_TYPES["Brand"]["label"],
                name="示例品牌 · 澄光",
                type_key="Brand",
                x=220,
                y=360,
            )
            _ensure_rel(company, brand2, "包含品牌")
            _ensure_rel(brand2, company, "归属")

            self.stdout.write(self.style.SUCCESS(
                "电商 Ontology 样例包含链已就绪："
                "公司→品牌→平台→店铺→链接→SKU"
            ))
            self.stdout.write(
                "回路层级映射: "
                + ", ".join(f"{lv}={key}" for lv, key in LOOP_LEVEL_OBJECT.items())
            )
