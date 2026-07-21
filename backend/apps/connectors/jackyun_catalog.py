"""吉客云只读能力目录：扩能力只加条目，不改 agent 主流程。"""
from __future__ import annotations

from typing import Any

# method 必须属于 jackyun.READONLY_METHODS
CAPABILITIES: dict[str, dict[str, Any]] = {
    "inventory": {
        "method": "erp.stockquantity.get",
        "method_setting": "JACKYUN_METHOD_INVENTORY",
        "description": "实时库存：可用量、锁定、采购在途、调拨在途（按仓）",
        "when": "库存、在库、在途、可用、补货、缺货、断货、备货、安全库存",
        "params": {
            "goodsNo": {"type": "string", "description": "货号"},
            "goodsName": {"type": "string", "description": "商品名称（模糊）"},
            "skuBarcode": {"type": "string", "description": "条码"},
            "warehouseCode": {"type": "string", "description": "仓库编码"},
            "pageIndex": {"type": "int", "description": "页码，从 0 起", "default": 0},
            "pageSize": {"type": "int", "description": "每页条数，最大 100", "default": 50},
            "isChannelReserve": {"type": "int", "description": "是否查渠道预留，默认 0", "default": 0},
        },
        "result_hint": "goodsStockQuantity",
    },
    "goods": {
        "method": "erp.goods.listget",
        "method_setting": "JACKYUN_METHOD_GOODS",
        "description": "商品主数据：货号、名称、品牌、分类、价格",
        "when": "商品信息、货号资料、SKU 档案、条码对应商品、价格成本",
        "params": {
            "goodsNo": {"type": "string", "description": "货号"},
            "goodsName": {"type": "string", "description": "商品名称"},
            "pageIndex": {"type": "int", "description": "页码，从 0 起", "default": 0},
            "pageSize": {"type": "int", "description": "每页条数，最大 100", "default": 50},
        },
        "result_hint": "goods/list",
    },
    "trades": {
        "method": "oms.trade.listget",
        "method_setting": "JACKYUN_METHOD_TRADE",
        "description": "订单/交易列表：店铺、货号、数量、金额、退款",
        "when": "订单、交易、发货、销售单、退款单、出库单查询",
        "params": {
            "goodsNo": {"type": "string", "description": "货号"},
            "pageIndex": {"type": "int", "description": "页码，从 0 起", "default": 0},
            "pageSize": {"type": "int", "description": "每页条数，最大 100", "default": 50},
        },
        "result_hint": "trades/list",
    },
    "warehouse": {
        "method": "erp.warehouse.get",
        "method_setting": "",
        "description": "仓库列表与基础信息",
        "when": "仓库、仓编码、仓名称、有哪些仓",
        "params": {
            "pageIndex": {"type": "int", "description": "页码，从 0 起", "default": 0},
            "pageSize": {"type": "int", "description": "每页条数，最大 100", "default": 50},
        },
        "result_hint": "warehouse/list",
    },
}


def list_capabilities() -> list[dict[str, Any]]:
    return [
        {
            "id": cid,
            "method": meta["method"],
            "description": meta["description"],
            "when": meta["when"],
            "params": meta["params"],
        }
        for cid, meta in CAPABILITIES.items()
    ]


def get_capability(capability_id: str) -> dict[str, Any] | None:
    meta = CAPABILITIES.get((capability_id or "").strip())
    if not meta:
        return None
    return {"id": capability_id.strip(), **meta}


def catalog_prompt_text() -> str:
    """给规划 LLM 的紧凑目录说明。"""
    lines = []
    for cid, meta in CAPABILITIES.items():
        param_names = ", ".join(meta["params"].keys())
        lines.append(
            f"- id={cid} method={meta['method']}: {meta['description']}；"
            f"触发：{meta['when']}；可选参数：{param_names}"
        )
    return "\n".join(lines)


def allowed_param_names(capability_id: str) -> set[str]:
    meta = CAPABILITIES.get(capability_id)
    if not meta:
        return set()
    return set(meta["params"].keys())
