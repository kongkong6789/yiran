"""
回路「上卷计算」：顺着回路链路对销售额/订单做分层汇总。

链路（自上而下）：
    公司 → 品牌(dim_product.brand) → 平台(dim_shop.platform)
         → 店铺/渠道(dim_shop.shop_name) → 链接/SPU(dim_product.spu) → SKU

数据源：dwd_sales_detail（事实）+ dim_shop / dim_product（维度）。
当用户问「按渠道/平台/品牌算销售额」这类聚合问题时，本模块把结果注入小策的资料卡，
让回答从「只读单店指标」升级为「顺着回路逐层汇总」。
"""
from __future__ import annotations

from apps.datalake.pg import pglake


PLATFORM_LABEL = {
    "tmall": "天猫",
    "taobao": "淘宝",
    "douyin": "抖音",
    "jd": "京东",
    "pdd": "拼多多",
    "ks": "快手",
}


def _fmt_num(value, unit: str = "元") -> str:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return f"{value}{unit}"
    av = abs(v)
    if av >= 1_0000_0000:
        return f"{v / 1_0000_0000:.2f}".rstrip("0").rstrip(".") + "亿" + unit
    if av >= 1_0000:
        return f"{v / 1_0000:.2f}".rstrip("0").rstrip(".") + "万" + unit
    if v == int(v):
        return f"{int(v):,}{unit}"
    return f"{v:,.2f}{unit}"


def _pg_ready() -> bool:
    if not pglake.available():
        return False
    try:
        pglake.ensure_ready()
        return True
    except Exception:
        return False


# 回路层级定义：level_key -> (展示名, 分组表达式, 是否需要维表 join)
_LEVELS: dict[str, dict] = {
    "brand": {
        "label": "品牌",
        "expr": "COALESCE(NULLIF(p.brand,''), NULLIF(s.brand,''), '(未标注品牌)')",
    },
    "platform": {
        "label": "平台",
        "expr": "COALESCE(NULLIF(s.platform,''), '(未知平台)')",
    },
    "shop": {
        "label": "店铺/渠道",
        "expr": "COALESCE(s.shop_name, d.shop_id)",
    },
    "spu": {
        "label": "链接/SPU",
        "expr": "COALESCE(p.spu, '(未知SPU)')",
    },
    "sku": {
        "label": "SKU",
        "expr": "COALESCE(p.product_name, d.sku)",
    },
}

# 关键词 -> 目标层级
_INTENT = [
    (("渠道", "店铺", "门店", "分店"), "shop"),
    (("平台", "天猫", "淘宝", "抖音", "京东", "拼多多", "快手", "tmall", "douyin", "jd"), "platform"),
    (("品牌",), "brand"),
    (("spu", "链接", "款式"), "spu"),
    (("sku", "单品", "商品"), "sku"),
]

# 触发上卷计算的意图词（需带聚合含义）
_TRIGGER = (
    "销售额", "销售金额", "gmv", "营业额", "成交额",
    "按渠道", "按平台", "按品牌", "按店铺", "分渠道", "分平台", "分品牌",
    "各渠道", "各平台", "各品牌", "各店铺", "汇总", "上卷", "占比", "排名",
)


def _label_row(level_key: str, dim_value: str) -> str:
    if level_key == "platform":
        return PLATFORM_LABEL.get((dim_value or "").lower(), dim_value)
    return dim_value


def _rollup(level_key: str) -> list[dict]:
    lv = _LEVELS[level_key]
    sql = f"""
        SELECT {lv['expr']} AS dim_value,
               SUM(d.gmv) AS gmv,
               SUM(d.orders) AS orders,
               SUM(d.units) AS units,
               SUM(d.refund_amt) AS refund_amt
        FROM dwd_sales_detail d
        LEFT JOIN dim_shop s ON s.shop_id = d.shop_id
        LEFT JOIN dim_product p ON p.sku = d.sku
        GROUP BY 1
        ORDER BY gmv DESC
    """
    return pglake.query(sql)


def _total() -> dict:
    rows = pglake.query(
        """
        SELECT SUM(gmv) AS gmv, SUM(orders) AS orders, SUM(units) AS units,
               MIN(dt) AS dt_min, MAX(dt) AS dt_max
        FROM dwd_sales_detail
        """
    )
    return rows[0] if rows else {}


def _pick_levels(question: str) -> list[str]:
    q = (question or "").lower()
    hits: list[str] = []
    for kws, lvl in _INTENT:
        if any(k.lower() in q for k in kws) and lvl not in hits:
            hits.append(lvl)
    return hits


def rollup_block(question: str) -> str:
    """按回路链路做上卷汇总；无聚合意图或无数据时返回空串。"""
    q = (question or "").lower()
    if not any(k.lower() in q for k in _TRIGGER):
        return ""
    if not _pg_ready():
        return ""

    try:
        total = _total()
    except Exception:
        return ""
    if not total or total.get("gmv") is None:
        return ""

    total_gmv = float(total.get("gmv") or 0)
    dt_min, dt_max = total.get("dt_min"), total.get("dt_max")
    period = f"{dt_min}~{dt_max}" if dt_min and dt_max else "全部区间"

    # 目标层级：命中意图则用之；否则默认给「平台+品牌」两级，展示回路上卷。
    levels = _pick_levels(question) or ["platform", "brand"]

    parts: list[str] = [
        "【回路上卷计算(dwd_sales_detail→dim_shop/dim_product·SUM(gmv))】",
        f"- 口径：SUM(gmv)，区间：{period}",
        f"- 公司总销售额：{_fmt_num(total_gmv)}（订单 {int(total.get('orders') or 0):,} 笔）",
    ]

    for lvl in levels:
        try:
            rows = _rollup(lvl)
        except Exception:
            continue
        if not rows:
            continue
        label = _LEVELS[lvl]["label"]
        parts.append(f"· 按{label}上卷：")
        for r in rows:
            gmv = float(r.get("gmv") or 0)
            share = (gmv / total_gmv * 100) if total_gmv else 0
            name = _label_row(lvl, r.get("dim_value") or "")
            parts.append(
                f"  - {name}：{_fmt_num(gmv)}（占比 {share:.1f}%，"
                f"订单 {int(r.get('orders') or 0):,} 笔）"
            )

    if len(parts) <= 3:
        return ""
    return "\n".join(parts)
