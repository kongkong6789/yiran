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
from urllib.parse import urlparse

from django.conf import settings

from .base import BaseConnector, MockConnector
from .credentials import cfg_value


def _cfg(name: str, default: str = "") -> str:
    return cfg_value(name, default)


def jackyun_configured() -> bool:
    return bool(_cfg("JACKYUN_APP_KEY") and _cfg("JACKYUN_APP_SECRET"))


# 仅允许已核验的只读方法；库存校准等写操作一律拒绝。
READONLY_METHODS = frozenset({
    "erp.stockquantity.get",
    "erp.stock.get",
    "erp.stock.batch.get",
    "erp.batchstockquantity.get",
    "erp-stock.stock.skulist",
    "erp.warehouse.get",
    "erp-goods.goods.sku.search",
    "erp.goods.listget",
    "erp.storage.goodslist",
    "oms.trade.fullinfoget",
    "oms.trade.listget",
})


class JackyunError(RuntimeError):
    """吉客云开放平台调用失败（不包含凭据内容）。"""


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
    """官方签名：排除保留字段，排序拼接，整体小写后计算 MD5 小写摘要。"""
    excluded = {"sign", "contextid", "token"}
    items = sorted(
        (k, v) for k, v in params.items()
        if k not in excluded and v is not None
    )
    raw = secret + "".join(f"{k}{v}" for k, v in items) + secret
    return hashlib.md5(raw.lower().encode("utf-8")).hexdigest()


def _validated_api_url() -> str:
    base = _cfg("JACKYUN_BASE_URL", "https://open.jackyun.com/open/openapi/do")
    parsed = urlparse(base)
    if (
        parsed.scheme.lower() != "https"
        or (parsed.hostname or "").lower() != "open.jackyun.com"
        or parsed.path.rstrip("/") != "/open/openapi/do"
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.port not in (None, 443)
    ):
        raise JackyunError("JACKYUN_BASE_URL 必须是吉客云官方 HTTPS OpenAPI 地址")
    return base


def _api_call(method: str, biz: dict[str, Any]) -> dict:
    if not jackyun_configured():
        raise JackyunError("未配置 JACKYUN_APP_KEY / JACKYUN_APP_SECRET")
    normalized = str(method or "").strip()
    if normalized.casefold() not in {m.casefold() for m in READONLY_METHODS}:
        raise JackyunError(f"拒绝非认证只读方法：{normalized or '<empty>'}")
    app_key = _cfg("JACKYUN_APP_KEY")
    secret = _cfg("JACKYUN_APP_SECRET")
    base = _validated_api_url()
    params = {
        "method": normalized,
        "appkey": app_key,
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "version": "v1.0",
        "contenttype": "json",
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
    retries = max(1, int(getattr(settings, "JACKYUN_MAX_RETRIES", 2)))
    timeout = max(5, int(getattr(settings, "JACKYUN_API_TIMEOUT", 30)))
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            code = str(result.get("code", ""))
            if code not in ("10000", "200"):
                raise JackyunError(
                    f"{method} 返回失败：{result.get('msg') or '未知错误'} (code={code})"
                )
            return result
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt + 1 < retries:
                time.sleep(0.5 * (2 ** attempt))
    raise JackyunError(f"{method} 网络请求失败：{last_error}")


def _extract_inventory_rows(raw: dict) -> list[dict]:
    data = raw.get("result", {}).get("data", {})
    if not isinstance(data, dict):
        return []
    rows = data.get("goodsStockQuantity", [])
    if isinstance(rows, dict):
        return [rows] if rows else []
    return rows if isinstance(rows, list) else []


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _norm_inventory(row: dict) -> dict:
    """稳定库存字段，屏蔽吉客云历史拼写差异。"""
    return {
        "warehouse_code": str(row.get("warehouseCode") or ""),
        "warehouse_name": str(row.get("warehouseName") or ""),
        "goods_no": str(row.get("goodsNo") or ""),
        "goods_name": str(row.get("goodsName") or ""),
        "sku_name": str(row.get("skuName") or ""),
        "sku_barcode": str(row.get("skuBarcode") or ""),
        "unit_name": str(row.get("unitName") or ""),
        "current_quantity": _number(row.get("currentQuantity")),
        "available_quantity": _number(
            row.get("useQuantity", row.get(
                "availableQuantity", row.get("currentQuantity")
            ))
        ),
        "locked_quantity": _number(
            row.get("lockedQuantity", row.get("lockingQuantity"))
        ),
        "reserve_quantity": _number(row.get("reserveQuantity")),
        "allocate_quantity": _number(row.get("allocateQuantity")),
        "purchasing_quantity": _number(row.get("purchasingQuantity")),
        "ordering_quantity": _number(
            row.get("orderingQuantity", row.get("orderAbleQuantity"))
        ),
        "stock_in_quantity": _number(row.get("stockInQuantity")),
        "stock_out_quantity": _number(
            row.get("stockOutQuantity", row.get("stockOutuantity"))
        ),
        "defective_quantity": _number(row.get("defectiveQuanity")),
        "cost_price": _number(row.get("costPrice")),
    }


_mapping_schema_ready = False


def _cache_inventory_mappings(rows: list[dict], requested_key: str = "") -> None:
    """把库存响应中的货号/条码缓存为可复用的 SKU 映射，不影响主查询。"""
    if not rows:
        return
    try:
        from apps.datalake.pg import pglake

        global _mapping_schema_ready
        if not _mapping_schema_ready:
            pglake.init_schema()
            _mapping_schema_ready = True
        mappings: list[dict] = []
        seen: set[str] = set()
        for row in rows:
            goods_no = str(row.get("goods_no") or "").strip()
            barcode = str(row.get("sku_barcode") or "").strip()
            if not goods_no:
                continue
            base = {
                "goods_no": goods_no,
                "sku_barcode": barcode,
                "goods_name": row.get("goods_name") or "",
            }
            for alias in (goods_no, barcode):
                if alias and alias not in seen:
                    seen.add(alias)
                    mappings.append({"sales_sku": alias, **base})
        # 查询键与返回货号明确一一对应时，也缓存该别名。
        canonical = {str(r.get("goods_no") or "").strip() for r in rows}
        canonical.discard("")
        key = str(requested_key or "").strip()
        if key and len(canonical) == 1 and key not in seen:
            first = rows[0]
            mappings.append({
                "sales_sku": key,
                "goods_no": next(iter(canonical)),
                "sku_barcode": first.get("sku_barcode") or "",
                "goods_name": first.get("goods_name") or "",
            })
        pglake.upsert_sku_inventory_mappings(mappings)
    except Exception:
        # 映射缓存失败不能影响实时库存只读查询。
        return


def query_inventory(
    *,
    goods_no: str = "",
    goods_name: str = "",
    warehouse_code: str = "",
    sku_barcode: str = "",
    page_index: int = 0,
    page_size: int = 50,
) -> dict:
    """只读查询实时库存，不执行库存校准或任何写操作。"""
    return query_by_plan(
        "inventory",
        {
            "goodsNo": goods_no,
            "goodsName": goods_name,
            "warehouseCode": warehouse_code,
            "skuBarcode": sku_barcode,
            "pageIndex": page_index,
            "pageSize": page_size,
            "isChannelReserve": 0,
        },
    )


def _coerce_param(name: str, value: Any, spec: dict) -> Any:
    if value is None or value == "":
        if "default" in spec:
            return spec["default"]
        return None
    ptype = (spec.get("type") or "string").lower()
    if ptype == "int":
        return int(value)
    if ptype == "float":
        return float(value)
    return str(value).strip()


def _truncate_payload(value: Any, *, max_rows: int = 30, max_chars: int = 12_000) -> Any:
    """限制写入 prompt 的体积。"""
    if isinstance(value, list):
        clipped = value[:max_rows]
        return [_truncate_payload(item, max_rows=max_rows, max_chars=max_chars) for item in clipped]
    if isinstance(value, dict):
        out = {}
        for idx, (k, v) in enumerate(value.items()):
            if idx >= 40:
                out["…"] = f"另有 {len(value) - 40} 个字段已省略"
                break
            out[str(k)] = _truncate_payload(v, max_rows=max_rows, max_chars=max_chars)
        return out
    if isinstance(value, str) and len(value) > 500:
        return value[:500] + "…"
    return value


def _extract_listish(raw: dict) -> list:
    data = raw.get("result") or raw.get("data") or raw
    if isinstance(data, dict):
        data = data.get("data") or data
    if not isinstance(data, dict):
        return []
    for key in (
        "goodsStockQuantity",
        "goods",
        "trades",
        "warehouses",
        "warehouse",
        "list",
        "rows",
    ):
        rows = data.get(key)
        if isinstance(rows, list):
            return rows
        if isinstance(rows, dict):
            nested = rows.get("list") or rows.get("rows") or []
            if isinstance(nested, list) and nested:
                return nested
    return []


def query_by_plan(capability_id: str, params: dict | None = None) -> dict:
    """按能力目录执行只读查询；非法能力/参数拒绝。"""
    from .jackyun_catalog import CAPABILITIES, allowed_param_names

    cid = (capability_id or "").strip()
    meta = CAPABILITIES.get(cid)
    if not meta:
        raise JackyunError(f"未知吉客云能力：{cid or '<empty>'}")

    allowed = allowed_param_names(cid)
    raw_params = dict(params or {})
    unknown = [k for k in raw_params if k not in allowed]
    if unknown:
        raise JackyunError(f"能力 {cid} 不支持参数：{', '.join(sorted(unknown))}")

    biz: dict[str, Any] = {}
    for name, spec in meta["params"].items():
        if name in raw_params:
            coerced = _coerce_param(name, raw_params[name], spec)
        elif "default" in spec:
            coerced = spec["default"]
        else:
            continue
        if coerced is None or coerced == "":
            continue
        biz[name] = coerced

    if "pageIndex" in meta["params"] and "pageIndex" not in biz:
        biz["pageIndex"] = 0
    if "pageSize" in meta["params"]:
        size = int(biz.get("pageSize") or meta["params"]["pageSize"].get("default") or 50)
        biz["pageSize"] = min(100, max(1, size))

    setting_name = (meta.get("method_setting") or "").strip()
    method = _cfg(setting_name, meta["method"]) if setting_name else meta["method"]

    # 库存走专用规范化，便于 restock / 单测复用字段名。
    if cid == "inventory":
        if "isChannelReserve" not in biz:
            biz["isChannelReserve"] = 0
        rows = [_norm_inventory(row) for row in _extract_inventory_rows(_api_call(method, biz))]
        _cache_inventory_mappings(
            rows,
            str(biz.get("goodsNo") or biz.get("skuBarcode") or ""),
        )
        return {
            "ok": True,
            "connector": "jackyun",
            "mode": "live",
            "capability": cid,
            "method": method,
            "page_index": biz.get("pageIndex", 0),
            "page_size": biz.get("pageSize", 50),
            "count": len(rows),
            "summary": {
                "current_quantity": sum(r["current_quantity"] for r in rows),
                "available_quantity": sum(r["available_quantity"] for r in rows),
                "locked_quantity": sum(r["locked_quantity"] for r in rows),
                "purchasing_quantity": sum(r["purchasing_quantity"] for r in rows),
                "allocate_quantity": sum(r["allocate_quantity"] for r in rows),
            },
            "results": rows,
            "params": biz,
        }

    raw = _api_call(method, biz)
    rows = _extract_listish(raw)
    truncated_rows = _truncate_payload(rows, max_rows=30)
    return {
        "ok": True,
        "connector": "jackyun",
        "mode": "live",
        "capability": cid,
        "method": method,
        "count": len(rows) if isinstance(rows, list) else 0,
        "results": truncated_rows,
        "raw_preview": _truncate_payload(raw, max_rows=20, max_chars=8_000),
        "params": biz,
    }


def jackyun_status(*, probe: bool = False) -> dict:
    configured = jackyun_configured()
    result = {
        "configured": configured,
        "auth_type": "openapi_signature",
        "read_only": True,
        "reachable": None,
    }
    if probe and configured:
        try:
            query_inventory(page_size=1)
            result["reachable"] = True
        except Exception as exc:
            result["reachable"] = False
            result["error"] = str(exc)
    return result


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


def pull_goods() -> tuple[list[dict], str, str]:
    """返回 (商品列表, source_mode, error)；已配置时绝不静默伪造样例。"""
    if not jackyun_configured():
        return _fixture_goods(), "fixture", ""
    method = _cfg("JACKYUN_METHOD_GOODS", "erp.goods.listget")
    try:
        raw = _api_call(method, {"pageIndex": 0, "pageSize": 100})
        # 兼容常见字段路径
        data = raw.get("result") or raw.get("data") or raw
        goods = data.get("goods") or data.get("data") or data.get("list") or []
        if isinstance(goods, dict):
            goods = goods.get("list") or goods.get("rows") or []
        if not goods:
            return [], "live_empty", ""
        return list(goods), "live", ""
    except (JackyunError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, TypeError) as exc:
        return [], "live_error", str(exc)


def pull_trades() -> tuple[list[dict], str, str]:
    if not jackyun_configured():
        return _fixture_trades(), "fixture", ""
    method = _cfg("JACKYUN_METHOD_TRADE", "oms.trade.listget")
    try:
        raw = _api_call(method, {"pageIndex": 0, "pageSize": 100})
        data = raw.get("result") or raw.get("data") or raw
        trades = data.get("trades") or data.get("data") or data.get("list") or []
        if isinstance(trades, dict):
            trades = trades.get("list") or trades.get("rows") or []
        if not trades:
            return [], "live_empty", ""
        return list(trades), "live", ""
    except (JackyunError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, TypeError) as exc:
        return [], "live_error", str(exc)


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
    goods_raw, goods_mode, goods_error = pull_goods()
    trades_raw, trades_mode, trades_error = pull_trades()
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

    has_live_error = goods_mode == "live_error" or trades_mode == "live_error"
    return {
        "ok": not has_live_error,
        "connector": "jackyun",
        "external_id": f"JACKYUN-SYNC-{uuid.uuid4().hex[:8]}",
        "status": "partial" if has_live_error else "synced",
        "goods_mode": goods_mode,
        "trades_mode": trades_mode,
        "configured": jackyun_configured(),
        "errors": {
            "goods": goods_error,
            "trades": trades_error,
        },
        "written": written,
    }
