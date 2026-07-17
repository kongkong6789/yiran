"""回路「基础数据」F1–F8 与物理表映射。"""
from __future__ import annotations

from typing import Any

# 期望表名（不区分大小写匹配）；任一命中且有行即 present，命中但 0 行 empty，未命中 missing
FACT_CATALOG: list[dict[str, Any]] = [
    {
        "id": "f1",
        "code": "F1",
        "name": "订单明细",
        "source": "吉客云/平台",
        "grain": "日×店铺×SKU",
        "tables": ["dwd_sales_detail", "daily_sales"],
        "note": "销售明细 / 日销汇总",
    },
    {
        "id": "f2",
        "code": "F2",
        "name": "退款明细",
        "source": "售后单",
        "grain": "退款单",
        "tables": ["dwd_refund_detail", "refund_detail", "售后单"],
        # 订单表明细含退款字段时可降级为 partial
        "partial_tables": ["dwd_sales_detail"],
        "partial_note": "仅订单表含退款字段，无独立退款明细表",
        "note": "仅退款 / 退货退款",
    },
    {
        "id": "f3",
        "code": "F3",
        "name": "推广花费",
        "source": "投放后台",
        "grain": "日×店铺×计划",
        "tables": ["dwd_ad_spend", "ad_spend", "ads_campaign_daily"],
        "note": "直通车 / 万相台 / 站外",
    },
    {
        "id": "f4",
        "code": "F4",
        "name": "流量数据",
        "source": "生意参谋等",
        "grain": "日×链接",
        "tables": ["dwd_traffic", "traffic_daily", "sycm_traffic"],
        "note": "曝光 / UV / 转化率",
    },
    {
        "id": "f5",
        "code": "F5",
        "name": "库存快照",
        "source": "吉客云库存",
        "grain": "日×仓×SKU",
        "tables": ["dwd_inventory_snapshot", "inventory_snapshot", "stock_snapshot"],
        "note": "在库 / 在途 / 成本",
    },
    {
        "id": "f6",
        "code": "F6",
        "name": "商品主数据",
        "source": "档案/价盘",
        "grain": "SKU",
        "tables": ["dim_product"],
        "note": "采购成本 / 挂牌价 / 链接映射",
    },
    {
        "id": "f7",
        "code": "F7",
        "name": "费用台账",
        "source": "金蝶/账单",
        "grain": "日×费用类型",
        "tables": ["dwd_expense", "finance_ledger", "费用台账"],
        "note": "佣金 / 物流 / 仓储 / 工资",
    },
    {
        "id": "f8",
        "code": "F8",
        "name": "组织主数据",
        "source": "映射/合同",
        "grain": "组织/店铺映射",
        "tables": ["dim_org", "org_mapping", "brand_contract"],
        "partial_tables": ["dim_shop"],
        "partial_note": "仅有店铺维表，缺完整六层映射/合同",
        "note": "六层映射 / 品牌合同",
    },
]


def _norm(name: str) -> str:
    return str(name or "").strip().lower().split(".")[-1]


def _index_tables(duck_tables: list[dict], pg_tables: list[dict]) -> dict[str, dict[str, Any]]:
    """name_norm → {engines, rows?, raw_names}"""
    idx: dict[str, dict[str, Any]] = {}
    for t in duck_tables:
        n = _norm(t.get("name") or "")
        if not n:
            continue
        slot = idx.setdefault(n, {"engines": set(), "raw": [], "rows": None})
        slot["engines"].add("duckdb")
        slot["raw"].append(f"duck:{t.get('schema') or 'main'}.{t.get('name')}")
    for t in pg_tables:
        n = _norm(t.get("table") or t.get("name") or "")
        if not n:
            continue
        slot = idx.setdefault(n, {"engines": set(), "raw": [], "rows": None})
        slot["engines"].add("postgres")
        raw = t.get("table") or t.get("name")
        slot["raw"].append(f"pg:{raw}")
        if "rows" in t and t["rows"] is not None:
            try:
                slot["rows"] = int(t["rows"])
            except (TypeError, ValueError):
                pass
    return idx


def _match_status(
    expected: list[str],
    idx: dict[str, dict[str, Any]],
) -> tuple[list[dict], int | None]:
    hits: list[dict] = []
    rows_total: int | None = 0
    any_rows = False
    for name in expected:
        key = _norm(name)
        info = idx.get(key)
        if not info:
            continue
        r = info.get("rows")
        hits.append({
            "table": key,
            "engines": sorted(info["engines"]),
            "refs": info["raw"],
            "rows": r,
        })
        if r is not None:
            any_rows = True
            rows_total = (rows_total or 0) + r
    if not any_rows:
        rows_total = None if not hits else rows_total
    return hits, rows_total


def resolve_fact_availability(duck_tables: list[dict], pg_tables: list[dict]) -> list[dict]:
    idx = _index_tables(duck_tables, pg_tables)
    out: list[dict] = []
    for spec in FACT_CATALOG:
        hits, rows = _match_status(spec["tables"], idx)
        status = "missing"
        note = spec.get("note") or ""
        matched = hits
        if hits:
            # 有表：有行 ok；未知行数或 0 行 empty
            if rows is None:
                status = "ok"  # 表存在但未取到行数，视为已接入
            elif rows > 0:
                status = "ok"
            else:
                status = "empty"
                note = f"表已存在但无数据行 · {note}".strip(" ·")
        else:
            partial_hits, _ = _match_status(spec.get("partial_tables") or [], idx)
            if partial_hits:
                status = "partial"
                matched = partial_hits
                note = spec.get("partial_note") or "仅部分字段/近似表可用"
            else:
                status = "missing"
                note = f"数据缺失 · {note}".strip(" ·")

        out.append({
            "id": spec["id"],
            "code": spec["code"],
            "name": spec["name"],
            "source": spec.get("source") or "",
            "grain": spec.get("grain") or "",
            "status": status,  # ok | empty | partial | missing
            "available": status in ("ok", "partial"),
            "missing": status in ("missing", "empty"),
            "rows": rows,
            "matched_tables": matched,
            "expected_tables": list(spec["tables"]),
            "note": note,
        })
    return out
