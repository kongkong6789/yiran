from __future__ import annotations

from django.db import transaction

from apps.datalake.certified_metrics import METRIC_IDS, canonical_hash, contracts_for, validate_certified_snapshot
from apps.datalake.models import MetricResult, SourceSnapshot
from apps.ontology.models import OntEvidence

from .models import (
    EvidenceBinding, FeedbackLoop, Flow, Intervention, LoopVersion,
    MetricBinding, SimulationRun, Stock,
)


PILOT_LOOP_KEY = "inventory.reorder.balance"
ENGINE_VERSION = "inventory-balance-v1"


def _definition() -> dict:
    return {
        "type": "B",
        "stocks": ["available_inventory", "in_transit_inventory"],
        "flows": ["sales_out", "order_placed", "goods_received"],
        "auxiliaries": ["cover_days", "inventory_gap", "reorder_signal"],
        "interventions": ["hypothetical_order_qty"],
        "note": "只读情景分析，不创建采购单。",
    }


@transaction.atomic
def ensure_inventory_pilot_loop(organization, user=None) -> FeedbackLoop:
    loop, _ = FeedbackLoop.objects.get_or_create(
        organization=organization,
        loop_key=PILOT_LOOP_KEY,
        defaults={
            "code": "INV-REORDER-B",
            "name": "库存补货调节回路",
            "loop_type": FeedbackLoop.LoopType.B,
            "description": "可用库存—补货信号—在途库存—到货的只读调节回路",
            "status": FeedbackLoop.Status.CONFIRMED,
            "causal_maturity": FeedbackLoop.CausalMaturity.HYPOTHESIS,
            "model_level": FeedbackLoop.ModelLevel.L1,
            "current_version_number": 1,
            "created_by": user,
        },
    )
    definition = _definition()
    version, _ = LoopVersion.objects.get_or_create(
        loop=loop,
        version=1,
        defaults={
            "status": FeedbackLoop.Status.CONFIRMED,
            "definition": definition,
            "parameter_hash": canonical_hash({"lead_time_days": 7, "reorder_cover_days": 14}),
            "engine_version": ENGINE_VERSION,
            "created_by": user,
        },
    )
    available, _ = Stock.objects.get_or_create(
        version=version, key="available_inventory",
        defaults={"name": "可用库存", "unit": "qty", "lower_bound": 0},
    )
    transit, _ = Stock.objects.get_or_create(
        version=version, key="in_transit_inventory",
        defaults={"name": "在途库存", "unit": "qty", "lower_bound": 0},
    )
    Flow.objects.get_or_create(version=version, key="sales_out", defaults={
        "name": "销售出库", "unit": "qty/day", "source_stock": available, "equation": "avg_daily_sales_qty",
    })
    Flow.objects.get_or_create(version=version, key="order_placed", defaults={
        "name": "假设采购下单", "unit": "qty/day", "target_stock": transit, "equation": "scenario_only",
    })
    Flow.objects.get_or_create(version=version, key="goods_received", defaults={
        "name": "采购入库", "unit": "qty/day", "source_stock": transit, "target_stock": available,
        "equation": "arrives_after_lead_time",
    })
    Intervention.objects.get_or_create(version=version, key="hypothetical_order_qty", defaults={
        "name": "假设补货量", "unit": "qty", "parameters": {"minimum": 0},
    })
    for contract in contracts_for(organization).filter(metric_id__in=METRIC_IDS):
        MetricBinding.objects.get_or_create(version=version, variable_key=contract.metric_id, defaults={"contract": contract})
    evidence, _ = OntEvidence.objects.get_or_create(
        organization=organization,
        evidence_key="pilot:inventory-reorder:model-definition:v1",
        defaults={
            "source_type": "model_spec",
            "source_ref": PILOT_LOOP_KEY,
            "content_hash": canonical_hash(definition),
            "summary": "库存补货只读影子试点模型定义。",
            "metadata": {"maturity": "hypothesis", "model_level": "L1"},
            "created_by": user,
        },
    )
    EvidenceBinding.objects.get_or_create(version=version, evidence=evidence)
    return loop


def _metric_map(results) -> dict[str, MetricResult]:
    return {result.contract.metric_id: result for result in results}


def _trajectory(*, available: float, transit: float, daily_sales: float, order_qty: float, lead_days: int, periods: int):
    rows = []
    for day in range(1, periods + 1):
        received = 0.0
        if day == lead_days:
            received = transit + order_qty
            transit = 0.0
        sold = min(max(available + received, 0.0), daily_sales)
        available = max(0.0, available + received - sold)
        rows.append({
            "period": day,
            "available_inventory": round(available, 4),
            "in_transit_inventory": round(transit, 4),
            "goods_received": round(received, 4),
            "sales_out": round(sold, 4),
            "cover_days": round(available / daily_sales, 4) if daily_sales > 0 else None,
        })
    return rows


@transaction.atomic
def run_inventory_simulation(*, organization, user, loop, metric_result_ids, parameters, idempotency_key):
    existing = SimulationRun.objects.filter(organization=organization, idempotency_key=idempotency_key).first()
    if existing:
        return existing
    if loop.organization_id != organization.id:
        raise PermissionError("Loop 不属于当前企业")
    version = loop.versions.filter(version=loop.current_version_number).first()
    if version is None:
        raise ValueError("Loop 缺少当前版本")
    required_bindings = set(METRIC_IDS)
    if set(version.metric_bindings.values_list("variable_key", flat=True)) != required_bindings:
        raise ValueError("Loop 缺少完整 MetricBinding，Simulation gate 已关闭")
    if not version.evidence_bindings.exists() or version.stocks.count() < 2 or version.flows.count() < 3:
        raise ValueError("Loop 缺少 Stock/Flow/EvidenceBinding，Simulation gate 已关闭")
    results = list(
        MetricResult.objects.select_related("contract", "snapshot")
        .filter(id__in=metric_result_ids, organization=organization)
    )
    metrics = _metric_map(results)
    missing = sorted(required_bindings - set(metrics))
    if missing:
        raise ValueError(f"缺少认证指标：{', '.join(missing)}")
    snapshot_ids = {result.snapshot_id for result in results}
    if len(snapshot_ids) != 1:
        raise ValueError("一次 Simulation 的指标必须来自同一 Snapshot")
    snapshot = SourceSnapshot.objects.get(id=next(iter(snapshot_ids)), organization=organization)
    validate_certified_snapshot(snapshot)
    available = float(metrics["available_stock_qty"].value)
    transit = float(metrics["in_transit_inventory_qty"].value)
    daily_sales = float(metrics["avg_daily_sales_qty"].value)
    if daily_sales <= 0:
        raise ValueError("日均销售量必须大于 0")
    lead_days = max(1, int(parameters.get("lead_time_days") or 7))
    threshold = max(1.0, float(parameters.get("reorder_cover_days") or 14))
    periods = min(90, max(1, int(parameters.get("periods") or 30)))
    suggested = max(0.0, threshold * daily_sales - available - transit)
    requested_order = max(0.0, float(parameters.get("hypothetical_order_qty") or suggested))
    scenarios = [
        {"key": "status_quo", "name": "维持现状", "order_qty": 0.0},
        {"key": "early_order", "name": "假设提前补货", "order_qty": requested_order},
        {"key": "adjust_threshold", "name": "调整补货阈值", "order_qty": suggested},
    ]
    for scenario in scenarios:
        scenario["trajectory"] = _trajectory(
            available=available, transit=transit, daily_sales=daily_sales,
            order_qty=scenario["order_qty"], lead_days=lead_days, periods=periods,
        )
    input_payload = {
        "loop_version": version.id,
        "snapshot_hash": snapshot.content_hash,
        "metric_fingerprints": sorted(result.result_fingerprint for result in results),
        "parameters": parameters,
        "engine_version": version.engine_version,
    }
    result_payload = {
        "schema": "inventory_reorder_shadow_sim_v1",
        "classification": "scenario_analysis_not_prediction",
        "external_write_performed": False,
        "loop_key": loop.loop_key,
        "loop_version": version.version,
        "snapshot_id": snapshot.id,
        "as_of": snapshot.as_of.isoformat(),
        "baseline": {
            "available_stock_qty": available,
            "in_transit_inventory_qty": transit,
            "avg_daily_sales_qty": daily_sales,
            "inventory_cover_days": float(metrics["inventory_cover_days"].value),
        },
        "scenarios": scenarios,
    }
    run = SimulationRun.objects.create(
        organization=organization,
        idempotency_key=idempotency_key,
        version=version,
        snapshot=snapshot,
        parameters=parameters,
        input_hash=canonical_hash(input_payload),
        result=result_payload,
        result_hash=canonical_hash(result_payload),
        engine_version=version.engine_version,
        status=SimulationRun.Status.COMPLETED,
        warnings=["情景分析，非校准预测；未执行任何外部写入。"],
        created_by=user,
    )
    run.metric_results.set(results)
    return run


def simulation_payload(run: SimulationRun) -> dict:
    return {
        "id": run.id,
        "run_key": run.run_key,
        "status": run.status,
        "loop_id": run.version.loop_id,
        "loop_version": run.version.version,
        "snapshot_id": run.snapshot_id,
        "input_hash": run.input_hash,
        "result_hash": run.result_hash,
        "engine_version": run.engine_version,
        "warnings": run.warnings,
        "result": run.result,
        "created_at": run.created_at.isoformat(),
    }
