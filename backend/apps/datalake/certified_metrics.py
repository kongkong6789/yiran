from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Q

from .models import MetricContract, MetricResult, SourceSnapshot


METRIC_IDS = (
    "available_stock_qty",
    "in_transit_inventory_qty",
    "avg_daily_sales_qty",
    "inventory_cover_days",
)


def canonical_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return f"sha256:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"


def contracts_for(organization):
    return MetricContract.objects.filter(
        Q(organization=organization) | Q(organization__isnull=True), active=True
    ).order_by("metric_id", "-organization_id", "-version")


def get_contract(organization, metric_id: str, version: str = "v1") -> MetricContract:
    contract = contracts_for(organization).filter(metric_id=metric_id, version=version).first()
    if contract is None:
        raise ValueError(f"未知或未启用的 Metric Contract：{metric_id}@{version}")
    return contract


def validate_certified_snapshot(snapshot: SourceSnapshot) -> None:
    if snapshot.source_mode != SourceSnapshot.SourceMode.LIVE and not settings.YIRAN_ALLOW_FIXTURE_DATA:
        raise ValueError("fixture/mock 数据不能进入认证指标")
    if not snapshot.complete:
        raise ValueError("Snapshot 分页或范围不完整，不能计算认证指标")
    if not snapshot.as_of:
        raise ValueError("Snapshot 缺少 as_of")
    if snapshot.content_hash != canonical_hash(snapshot.payload):
        raise ValueError("Snapshot 内容 hash 校验失败")
    if snapshot.governance_status == "governed":
        if snapshot.reconciliation_status != "passed":
            raise ValueError("受治理 Snapshot 尚未完成外部对账")
        if not snapshot.manifest_hash or not snapshot.boundary_covered or not snapshot.source_complete:
            raise ValueError("受治理 Snapshot 的 Manifest、窗口覆盖或来源完整度不满足认证要求")
    skus = snapshot.scope.get("sku_ids") or snapshot.scope.get("skus") or []
    if skus and not 1 <= len(skus) <= 20:
        raise ValueError("Pilot SKU 白名单必须为 1–20 个")


def _rows(snapshot: SourceSnapshot) -> list[dict]:
    payload = snapshot.payload or {}
    rows = payload.get("rows", payload if isinstance(payload, list) else [])
    if not isinstance(rows, list) or not rows:
        raise ValueError("Snapshot payload.rows 不能为空")
    return [row for row in rows if isinstance(row, dict)]


def _number(row: dict, *keys: str) -> Decimal:
    for key in keys:
        if key in row and row[key] is not None:
            try:
                value = Decimal(str(row[key]))
                if not value.is_finite():
                    raise InvalidOperation
                return value
            except (TypeError, ValueError, InvalidOperation) as exc:
                raise ValueError(f"字段 {key} 不是有效数字") from exc
    raise ValueError(f"缺少必要字段：{'/'.join(keys)}")


def calculate_metric(snapshot: SourceSnapshot, contract: MetricContract) -> Decimal:
    rows = _rows(snapshot)
    if contract.metric_id == "available_stock_qty":
        return sum((_number(row, "available_quantity", "available_stock_qty") for row in rows), Decimal("0"))
    if contract.metric_id == "in_transit_inventory_qty":
        return sum((_number(row, "in_transit_quantity", "purchasing_quantity") for row in rows), Decimal("0"))
    if contract.metric_id == "avg_daily_sales_qty":
        days = int((contract.time_window or {}).get("days") or 30)
        if days <= 0:
            raise ValueError("Metric Contract 时间窗口必须大于 0")
        return sum((_number(row, "sales_qty", "sales_quantity") for row in rows), Decimal("0")) / Decimal(days)
    if contract.metric_id == "inventory_cover_days":
        available = calculate_metric(snapshot, get_contract(snapshot.organization, "available_stock_qty"))
        daily_sales = calculate_metric(snapshot, get_contract(snapshot.organization, "avg_daily_sales_qty"))
        if daily_sales <= 0:
            raise ValueError("日均销售量必须大于 0，不能计算库存覆盖天数")
        return available / daily_sales
    raise ValueError(f"Metric Contract 尚无确定性计算器：{contract.metric_id}")


@transaction.atomic
def compose_inventory_sales_snapshot(*, organization, user, inventory_snapshot, sales_snapshot):
    if inventory_snapshot.organization_id != organization.id or sales_snapshot.organization_id != organization.id:
        raise PermissionError("组合 Snapshot 的来源不属于当前企业")
    validate_certified_snapshot(inventory_snapshot)
    validate_certified_snapshot(sales_snapshot)
    if sales_snapshot.source_system != "jackyun_sales_ledger_export":
        raise ValueError("sales_snapshot_id 必须指向已对账的销售账 Snapshot")

    inventory_by_sku: dict[str, dict[str, Decimal]] = {}
    for row in _rows(inventory_snapshot):
        sku = str(row.get("sku") or row.get("sku_id") or "").strip()
        if not sku:
            raise ValueError("库存 Snapshot 行缺少 SKU")
        values = inventory_by_sku.setdefault(
            sku, {"available_quantity": Decimal("0"), "in_transit_quantity": Decimal("0")},
        )
        values["available_quantity"] += _number(row, "available_quantity", "available_stock_qty")
        values["in_transit_quantity"] += _number(row, "in_transit_quantity", "purchasing_quantity")

    sales_by_sku: dict[str, Decimal] = {}
    for row in _rows(sales_snapshot):
        sku = str(row.get("sku") or row.get("sku_id") or "").strip()
        if not sku:
            raise ValueError("销售 Snapshot 行缺少 SKU")
        sales_by_sku[sku] = sales_by_sku.get(sku, Decimal("0")) + _number(row, "sales_qty", "sales_quantity")

    missing_sales = sorted(set(inventory_by_sku) - set(sales_by_sku))
    if missing_sales:
        raise ValueError(f"库存 SKU 缺少完整销售窗口：{', '.join(missing_sales[:20])}")
    if not 1 <= len(inventory_by_sku) <= 20:
        raise ValueError("组合 Snapshot 的 Pilot SKU 必须为 1–20 个")
    rows = [{
        "sku": sku,
        "available_quantity": str(values["available_quantity"]),
        "in_transit_quantity": str(values["in_transit_quantity"]),
        "sales_qty": str(sales_by_sku[sku]),
    } for sku, values in sorted(inventory_by_sku.items())]
    payload = {
        "rows": rows,
        "lineage": {
            "inventory_snapshot_id": inventory_snapshot.id,
            "inventory_snapshot_hash": inventory_snapshot.content_hash,
            "sales_snapshot_id": sales_snapshot.id,
            "sales_snapshot_hash": sales_snapshot.content_hash,
        },
    }
    composite_hash = canonical_hash(payload)
    snapshot_key = f"snap:inventory-sales:{composite_hash.split(':', 1)[-1][:32]}"
    snapshot, _ = SourceSnapshot.objects.get_or_create(
        organization=organization, snapshot_key=snapshot_key,
        defaults={
            "source_system": "composite_inventory_sales", "source_mode": SourceSnapshot.SourceMode.LIVE,
            "scope": {
                **(inventory_snapshot.scope or {}), "sku_ids": sorted(inventory_by_sku),
                "sales_window_start": (sales_snapshot.scope or {}).get("window_start"),
                "sales_window_end": (sales_snapshot.scope or {}).get("window_end"),
            },
            "as_of": inventory_snapshot.as_of, "complete": True,
            "completeness": {"inventory": True, "sales_window": True, "lineage_bound": True},
            "schema_version": "inventory-sales-composite-v1", "row_count": len(rows),
            "content_hash": composite_hash, "payload": payload, "governance_status": "governed",
            "reconciliation_status": "passed",
            "manifest_hash": canonical_hash({
                "inventory": inventory_snapshot.content_hash, "sales": sales_snapshot.manifest_hash,
            }),
            "boundary_covered": True, "source_complete": True, "created_by": user,
        },
    )
    return snapshot


@transaction.atomic
def resolve_metric(*, organization, user, snapshot: SourceSnapshot, metric_id: str, version: str, dimensions: dict):
    if snapshot.organization_id != organization.id:
        raise PermissionError("Snapshot 不属于当前企业")
    validate_certified_snapshot(snapshot)
    contract = get_contract(organization, metric_id, version)
    value = calculate_metric(snapshot, contract).quantize(Decimal("0.00000001"))
    query_fingerprint = canonical_hash({
        "contract_hash": contract.contract_hash,
        "snapshot_hash": snapshot.content_hash,
        "dimensions": dimensions,
    })
    result_fingerprint = canonical_hash({"query": query_fingerprint, "value": value, "unit": contract.unit})
    result, _ = MetricResult.objects.get_or_create(
        organization=organization,
        contract=contract,
        snapshot=snapshot,
        query_fingerprint=query_fingerprint,
        defaults={
            "value": value,
            "unit": contract.unit,
            "dimensions": dimensions,
            "as_of": snapshot.as_of,
            "result_fingerprint": result_fingerprint,
            "warnings": [],
            "created_by": user,
        },
    )
    return result
