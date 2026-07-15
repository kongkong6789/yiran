"""
吉客云只读连接器:拉取商品/订单并灌入 DataLake(dwd/dim)。

有 JACKYUN_APP_KEY + JACKYUN_APP_SECRET 时走开放平台 HTTP;
否则用内置样例响应(src=jackyun),保证链路可演示。
"""
from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, timedelta
from typing import Any

from django.conf import settings

from .base import BaseConnector, MockConnector


def _cfg(name: str, default: str = "") -> str:
    return (getattr(settings, name, None) or default or "").strip()


def jackyun_configured() -> bool:
    return bool(_cfg("JACKYUN_APP_KEY") and _cfg("JACKYUN_APP_SECRET"))


class JackyunConnector(BaseConnector):
    """只读为主;写动作在无真实凭证时降级为 Mock 回执。"""

    key = "jackyun"
    name = "吉客云"

    def execute(self, action: str, payload: dict) -> dict:
        if action in ("jackyun.sync", "jackyun.pull"):
            return sync_to_datalake()
        # 写动作:有凭证时仍先 Mock(真实写单需单独对接),无凭证同 Mock
        mock = MockConnector(self.key, self.name)
        result = mock.execute(action, payload)
        result["note"] = "吉客云写动作暂用受理回执;只读同步请调 /api/connectors/jackyun/sync/"
        return result


def _sign(params: dict[str, str], secret: str) -> str:
    """吉客云常见签名:按 key 排序后 secret + k1v1k2v2... + secret 再 MD5 大写。"""
    items = sorted((k, v) for k, v in params.items() if k != "sign" and v is not None)
    raw = secret + "".join(f"{k}{v}" for k, v in items) + secret
    return hashlib.md5(raw.encode("utf-8")).hexdigest().upper()


def _api_call(method: str, biz: dict[str, Any]) -> dict:
    app_key = _cfg("JACKYUN_APP_KEY")
    secret = _cfg("JACKYUN_APP_SECRET")
    base = _cfg("JACKYUN_BASE_URL", "https://open.jackyun.com/open/openapi/do")
    params = {
        "method": method,
        "appkey": app_key,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "version": "v1.0",
        "format": "json",
        "bizcontent": json.dumps(biz, ensure_ascii=False),
    }
    params["sign"] = _sign(params, secret)
    data = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(
        base,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _fixture_goods() -> list[dict]:
    return [
        {
            "goodsNo": "JK-SKU-1001",
            "goodsName": "连衣裙-经典款",
            "spuCode": "JK-SPU-100",
            "cateName": "服饰",
            "brandName": "品牌A",
            "costPrice": 80,
            "salePrice": 200,
        },
        {
            "goodsNo": "JK-SKU-1002",
            "goodsName": "连衣裙-新色",
            "spuCode": "JK-SPU-100",
            "cateName": "服饰",
            "brandName": "品牌A",
            "costPrice": 85,
            "salePrice": 210,
        },
        {
            "goodsNo": "JK-SKU-2001",
            "goodsName": "防晒霜 50ml",
            "spuCode": "JK-SPU-200",
            "cateName": "美妆",
            "brandName": "品牌B",
            "costPrice": 60,
            "salePrice": 199,
        },
    ]


def _fixture_trades() -> list[dict]:
    today = date.today()
    rows = []
    samples = [
        ("JK-S001", "JK-SKU-1001", 152000, 760, 780, 2900, 15),
        ("JK-S002", "JK-SKU-2001", 198000, 990, 1050, 7600, 40),
        ("JK-S001", "JK-SKU-1001", 128000, 640, 655, 3200, 17),
        ("JK-S001", "JK-SKU-1002", 86000, 430, 440, 1500, 8),
        ("JK-S002", "JK-SKU-2001", 204000, 1020, 1090, 8800, 46),
    ]
    for i, (shop, sku, gmv, orders, units, refund, r_orders) in enumerate(samples):
        dt = today - timedelta(days=(1 if i < 2 else 0))
        rows.append(
            {
                "tradeDate": dt.isoformat(),
                "shopCode": shop,
                "shopName": "天猫旗舰店" if shop.endswith("001") else "抖音小店",
                "platform": "tmall" if shop.endswith("001") else "douyin",
                "goodsNo": sku,
                "gmv": gmv,
                "orders": orders,
                "units": units,
                "refundAmt": refund,
                "refundOrders": r_orders,
            }
        )
    return rows


def pull_goods() -> tuple[list[dict], str]:
    """返回 (商品列表, source_mode: live|fixture)。"""
    if not jackyun_configured():
        return _fixture_goods(), "fixture"
    method = _cfg("JACKYUN_METHOD_GOODS", "erp.goods.listget")
    try:
        raw = _api_call(method, {"pageIndex": 0, "pageSize": 100})
        # 兼容常见字段路径
        data = raw.get("result") or raw.get("data") or raw
        goods = data.get("goods") or data.get("data") or data.get("list") or []
        if isinstance(goods, dict):
            goods = goods.get("list") or goods.get("rows") or []
        if not goods:
            return _fixture_goods(), "fixture_fallback"
        return list(goods), "live"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, TypeError):
        return _fixture_goods(), "fixture_fallback"


def pull_trades() -> tuple[list[dict], str]:
    if not jackyun_configured():
        return _fixture_trades(), "fixture"
    method = _cfg("JACKYUN_METHOD_TRADE", "oms.trade.listget")
    try:
        raw = _api_call(method, {"pageIndex": 0, "pageSize": 100})
        data = raw.get("result") or raw.get("data") or raw
        trades = data.get("trades") or data.get("data") or data.get("list") or []
        if isinstance(trades, dict):
            trades = trades.get("list") or trades.get("rows") or []
        if not trades:
            return _fixture_trades(), "fixture_fallback"
        return list(trades), "live"
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, TypeError):
        return _fixture_trades(), "fixture_fallback"


def _norm_goods(row: dict) -> dict:
    return {
        "sku": str(row.get("goodsNo") or row.get("sku") or row.get("goods_no") or ""),
        "spu": str(row.get("spuCode") or row.get("spu") or ""),
        "product_name": str(row.get("goodsName") or row.get("product_name") or row.get("name") or ""),
        "category": str(row.get("cateName") or row.get("category") or ""),
        "brand": str(row.get("brandName") or row.get("brand") or ""),
        "cost_price": float(row.get("costPrice") or row.get("cost_price") or 0),
        "list_price": float(row.get("salePrice") or row.get("list_price") or 0),
    }


def _norm_trade(row: dict) -> dict:
    shop_id = str(row.get("shopCode") or row.get("shop_id") or "JK-S000")
    return {
        "dt": str(row.get("tradeDate") or row.get("dt") or date.today().isoformat())[:10],
        "shop_id": shop_id,
        "shop_name": str(row.get("shopName") or row.get("shop_name") or shop_id),
        "platform": str(row.get("platform") or "jackyun"),
        "sku": str(row.get("goodsNo") or row.get("sku") or ""),
        "gmv": float(row.get("gmv") or row.get("amount") or 0),
        "orders": int(row.get("orders") or row.get("order_count") or 1),
        "units": int(row.get("units") or row.get("qty") or 1),
        "refund_amt": float(row.get("refundAmt") or row.get("refund_amt") or 0),
        "refund_orders": int(row.get("refundOrders") or row.get("refund_orders") or 0),
    }


def sync_to_datalake() -> dict:
    """拉取商品+订单汇总,写入 PG(优先)或 DuckDB,并重跑管道。"""
    goods_raw, goods_mode = pull_goods()
    trades_raw, trades_mode = pull_trades()
    goods = [_norm_goods(g) for g in goods_raw if _norm_goods(g)["sku"]]
    trades = [_norm_trade(t) for t in trades_raw if _norm_trade(t)["sku"]]

    from apps.datalake.pg import pglake

    written = {"products": 0, "shops": 0, "sales": 0, "backend": "none"}

    if pglake.available(force=True):
        pglake.ensure_ready()
        written.update(pglake.ingest_jackyun(goods, trades))
        written["backend"] = "postgres"
        pglake.run_pipeline()
    else:
        from apps.datalake import service as duck

        written.update(duck.ingest_jackyun(goods, trades))
        written["backend"] = "duckdb"

    return {
        "ok": True,
        "connector": "jackyun",
        "external_id": f"JACKYUN-SYNC-{uuid.uuid4().hex[:8]}",
        "status": "synced",
        "goods_mode": goods_mode,
        "trades_mode": trades_mode,
        "configured": jackyun_configured(),
        "written": written,
    }
