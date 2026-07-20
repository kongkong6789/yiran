"""紧急补货判定：把「销量速度」和「实时库存」拼起来算「可售天数」。

数据来源：
  - 销量速度：dwd_sales_detail（近 WINDOW_DAYS 天日均件数）+ dim_product 命名
  - 实时库存：吉客云 OpenAPI（只读）按货号聚合可用量 / 采购在途

判定口径：
  可售天数 = 可用库存 / 日均销量
    - 可用 ≤ 0 且仍在动销      → 断货（最高优先）
    - 可售天数 < 采购周期 且在途=0 → 紧急补货
    - 可售天数 < 采购周期        → 补货中（在途已有货在路上）
    - 可售天数 < 预警天数        → 库存偏低
    - 其余                        → 充足

编码对齐：销售明细的 sku 需要能对上吉客云的货号/条码。对不上的 SKU
不会被编造成补货结论，而是明确标注「未对齐」，说明还差一步映射。
"""
from __future__ import annotations

from apps.datalake.pg import pglake

# 可配置口径
WINDOW_DAYS = 30          # 计算日均销量的回看窗口
LEAD_TIME_DAYS = 7        # 采购/到货周期：可售天数低于它即紧急
WARN_DAYS = 14            # 库存偏低预警阈值
MAX_SKUS = 12             # 单次分析的动销 SKU 上限，控制吉客云调用量

_TRIGGERS = (
    "补货", "缺货", "断货", "备货", "安全库存", "可售天数", "库存预警",
    "restock", "replenish", "out of stock", "stockout", "低库存",
)


def _pg_ready() -> bool:
    if not pglake.available():
        return False
    try:
        pglake.ensure_ready()
        return True
    except Exception:
        return False


def _fmt(value) -> str:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if v == int(v):
        return f"{int(v):,}"
    return f"{v:,.1f}"


def _velocity_rows() -> list[dict]:
    """近 WINDOW_DAYS 天各 SKU 的日均销量（件/天）。"""
    return pglake.query(
        """
        WITH span AS (
            SELECT MAX(dt) AS max_dt FROM dwd_sales_detail
        )
        SELECT d.sku,
               COALESCE(p.product_name, d.sku) AS product,
               p.brand AS brand,
               SUM(d.units) AS units,
               COUNT(DISTINCT d.dt) AS sell_days,
               %s::int AS window_days
        FROM dwd_sales_detail d
        CROSS JOIN span
        LEFT JOIN dim_product p ON p.sku = d.sku
        WHERE d.dt > span.max_dt - %s::int
        GROUP BY d.sku, p.product_name, p.brand
        HAVING SUM(d.units) > 0
        ORDER BY SUM(d.units) DESC
        LIMIT %s
        """,
        [WINDOW_DAYS, WINDOW_DAYS, MAX_SKUS],
    )


def _saved_mapping(sales_sku: str) -> dict | None:
    try:
        rows = pglake.query(
            """
            SELECT goods_no, sku_barcode, goods_name, source, confidence
            FROM dim_sku_inventory_map
            WHERE sales_sku = %s
            LIMIT 1
            """,
            [sales_sku],
        )
        return rows[0] if rows else None
    except Exception:
        return None


def _inventory_for(sales_sku: str, product_name: str = "") -> dict | None:
    """通过映射、货号、条码、精确商品名依次对齐吉客云实时库存。"""
    from apps.connectors.jackyun import query_inventory

    saved = _saved_mapping(sales_sku)
    candidates: list[tuple[str, str, str]] = []
    if saved:
        if saved.get("goods_no"):
            candidates.append(("goods_no", str(saved["goods_no"]), "mapping"))
        if saved.get("sku_barcode"):
            candidates.append(("sku_barcode", str(saved["sku_barcode"]), "mapping"))
    candidates.extend([
        ("goods_no", sales_sku, "direct"),
        ("sku_barcode", sales_sku, "direct"),
    ])
    seen: set[tuple[str, str]] = set()
    for field, value, via in candidates:
        if not value or (field, value) in seen:
            continue
        seen.add((field, value))
        try:
            res = query_inventory(**{field: value}, page_size=50)
        except Exception:
            continue
        rows = res.get("results") or []
        if not rows:
            continue
        summary = res.get("summary") or {}
        return {
            "available": float(summary.get("available_quantity") or 0),
            "current": float(summary.get("current_quantity") or 0),
            "locked": float(summary.get("locked_quantity") or 0),
            "purchasing": float(summary.get("purchasing_quantity") or 0),
            "matched_field": field,
            "matched_via": via,
            "goods_no": rows[0].get("goods_no") or value,
            "goods_name": rows[0].get("goods_name") or "",
        }

    # 编码不一致时，最后尝试商品名精确匹配；仅唯一货号且名称完全一致才自动落表。
    name = str(product_name or "").strip()
    if name and name != sales_sku:
        try:
            res = query_inventory(goods_name=name, page_size=50)
            rows = res.get("results") or []
        except Exception:
            rows = []
        exact = [r for r in rows if str(r.get("goods_name") or "").strip() == name]
        goods_nos = {str(r.get("goods_no") or "").strip() for r in exact}
        goods_nos.discard("")
        if exact and len(goods_nos) == 1:
            goods_no = next(iter(goods_nos))
            first = exact[0]
            pglake.upsert_sku_inventory_mappings(
                [{
                    "sales_sku": sales_sku,
                    "goods_no": goods_no,
                    "sku_barcode": first.get("sku_barcode") or "",
                    "goods_name": name,
                    "confidence": 0.9,
                }],
                source="product_name_exact",
                confidence=0.9,
            )
            # 用精确货号重查，避免商品名接口可能混入相似商品。
            return _inventory_for(sales_sku, "")
    return None


def _classify(available: float, daily: float, purchasing: float) -> tuple[str, float, int]:
    """返回 (等级, 可售天数, 优先级序号：越小越紧急)。"""
    cover = available / daily if daily > 0 else float("inf")
    if daily > 0 and available <= 0:
        return "断货", 0.0, 0
    if daily > 0 and cover < LEAD_TIME_DAYS and purchasing <= 0:
        return "紧急补货", cover, 1
    if daily > 0 and cover < LEAD_TIME_DAYS:
        return "补货中(在途)", cover, 2
    if daily > 0 and cover < WARN_DAYS:
        return "库存偏低", cover, 3
    return "充足", cover, 4


def restock_block(question: str) -> str:
    """命中补货意图时，返回可审计的紧急补货分析卡；否则返回空串。"""
    q = (question or "").lower()
    if not any(k.lower() in q for k in _TRIGGERS):
        return ""
    if not _pg_ready():
        return "【紧急补货】业务库不可用，暂时无法计算销量速度。"

    try:
        vel = _velocity_rows()
    except Exception as exc:
        return f"【紧急补货】销量速度查询失败：{exc}"
    if not vel:
        return (
            "【紧急补货】近 %d 天没有动销记录，无法计算可售天数。" % WINDOW_DAYS
        )

    try:
        from apps.connectors.jackyun import jackyun_configured
    except Exception:
        jackyun_configured = lambda: False  # noqa: E731
    live = jackyun_configured()

    analyzed: list[dict] = []
    unaligned: list[dict] = []
    for r in vel:
        sku = r["sku"]
        units = float(r.get("units") or 0)
        daily = units / WINDOW_DAYS
        item = {
            "sku": sku,
            "product": r.get("product") or sku,
            "brand": r.get("brand") or "",
            "daily": daily,
        }
        inv = _inventory_for(sku, item["product"]) if live else None
        if inv is None:
            unaligned.append(item)
            continue
        grade, cover, rank = _classify(inv["available"], daily, inv["purchasing"])
        analyzed.append({**item, **inv, "grade": grade, "cover": cover, "rank": rank})

    analyzed.sort(key=lambda x: (x["rank"], x["cover"]))

    lines = [
        "【紧急补货分析(dwd_sales_detail 日均销量 × 吉客云实时可用库存)】",
        f"- 口径：日均销量=近{WINDOW_DAYS}天件数/{WINDOW_DAYS}；"
        f"可售天数=可用库存/日均销量；紧急阈值={LEAD_TIME_DAYS}天、偏低阈值={WARN_DAYS}天",
    ]

    if analyzed:
        urgent = [a for a in analyzed if a["rank"] <= 1]
        lines.append(
            f"- 命中 {len(analyzed)} 个动销SKU；其中断货/紧急 {len(urgent)} 个"
        )
        for a in analyzed:
            cover_txt = "∞" if a["cover"] == float("inf") else f"{a['cover']:.1f}天"
            lines.append(
                f"  - [{a['grade']}] {a['product']}({a['sku']})："
                + (
                    f"映射货号={a['goods_no']}，"
                    if a.get("goods_no") and a["goods_no"] != a["sku"]
                    else ""
                )
                + f"日均{_fmt(a['daily'])}件，可用{_fmt(a['available'])}，"
                + f"在途{_fmt(a['purchasing'])}，可售≈{cover_txt}"
            )

    if unaligned:
        names = "、".join(
            f"{u['product']}({u['sku']})" for u in unaligned[:6]
        )
        lines.append(
            f"- 未对齐 {len(unaligned)} 个：{names}"
            + ("…" if len(unaligned) > 6 else "")
        )
        lines.append(
            "  说明：这些SKU有销量速度，但用其编码在吉客云查不到库存"
            "（销售sku与货号/条码未建立映射）。补一张 sku→货号 对照后即可纳入判定。"
        )

    if not live:
        lines.append(
            "- 吉客云未配置：只能给出销量速度，缺实时可用库存，无法算可售天数。"
        )

    if len(lines) <= 2:
        return "\n".join(lines) + "\n- 暂无可判定的补货项。"
    return "\n".join(lines)
