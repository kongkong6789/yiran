"""
电商经营 Ontology 契约（自知行 a2a-ecommerce-workbench 一期迁入）。

- 对象类型 / 关系类型：图谱预设与回路层级对齐
- 层级包含：公司 → 品牌 → 平台(渠道) → 店铺 → 链接(商品) → SKU
说明：知行里 Channel≈平台渠道、Shop≈店；良策回路「channel」层对应店铺 Shop。
"""
from __future__ import annotations

from typing import Any

# 物理 / 虚拟 归类提示（OntObject.category）
PHYSICAL_KEYS = {
    "Brand", "SKU", "Product", "Warehouse", "Supplier", "Customer",
    "Counterparty", "Employee", "Organization", "Department",
}
VIRTUAL_KEYS = {
    "Channel", "Shop", "SalesOrder", "SettlementRecord", "StockMovement",
    "TransferReview", "SalesFact", "InventorySnapshot", "AdCampaign",
    "FinanceRecord", "DataSource", "Dataset", "Document", "Report",
    "ActionRequest", "Risk", "Agent", "KnowledgeAsset", "Capability",
    "Evidence", "CashFlow", "ToolContract", "PurchaseRequisition",
    "PurchaseOrder", "PurchaseReceiveBill", "PaymentApplication",
    "ExpenseRequest", "ExpenseReimbursement", "PayableBill", "ReceivableBill",
    "ReceiptBill", "FundsTransfer", "SalesInvoice", "SalesOutstock",
    "SalesReturn", "Claim", "Decision", "Stock", "Flow", "FeedbackLoop",
    "LeveragePoint", "Intervention", "SystemInspection",
}

# key -> 中文otype（写入 OntObject.otype，兼容现有图谱）
COMMERCE_OBJECT_TYPES: dict[str, dict[str, Any]] = {
    "Organization": {
        "label": "公司",
        "description": "代理经营公司 / ERP 组织。对应回路「公司」层。",
        "key_properties": ["number", "name", "source_system"],
        "sensitivity": "medium",
        "loop_level": "company",
    },
    "Brand": {
        "label": "品牌",
        "description": "经营分析中的品牌或产品线。对应回路「品牌」层。",
        "key_properties": ["name", "aliases"],
        "sensitivity": "low",
        "loop_level": "brand",
    },
    "Channel": {
        "label": "平台",
        "description": "天猫、抖音、京东等销售平台/大渠道。对应回路「平台」层。",
        "key_properties": ["name", "platform"],
        "sensitivity": "low",
        "loop_level": "platform",
    },
    "Shop": {
        "label": "店铺",
        "description": "平台内的具体店铺或销售账号。对应回路「渠道」层。",
        "key_properties": ["name", "channel"],
        "sensitivity": "low",
        "loop_level": "channel",
    },
    "Product": {
        "label": "链接",
        "description": "商品详情页 / 多 SKU 组合链接。对应回路「链接」层。",
        "key_properties": ["product_name", "sku", "brand", "category"],
        "sensitivity": "low",
        "loop_level": "link",
    },
    "SKU": {
        "label": "SKU",
        "description": "可销售或可库存管理的商品编码。对应回路「SKU」层。",
        "key_properties": ["sku", "product_name", "brand"],
        "sensitivity": "low",
        "loop_level": "sku",
    },
    "Warehouse": {
        "label": "仓库",
        "description": "库存、发货、调拨或售后仓储节点。",
        "key_properties": ["name", "business_scope"],
        "sensitivity": "medium",
    },
    "Supplier": {
        "label": "供应商",
        "description": "采购、交期、成本和供货风险相关主体。",
        "key_properties": ["name", "lead_time_days"],
        "sensitivity": "medium",
    },
    "Customer": {
        "label": "客户",
        "description": "销售、应收、收款相关的客户。",
        "key_properties": ["number", "name", "source_system"],
        "sensitivity": "medium",
    },
    "SalesOrder": {
        "label": "销售订单",
        "description": "销售订单、店铺订单或交易单据。",
        "key_properties": ["order_no", "date", "shop", "sku", "sales_qty", "amount", "status"],
        "sensitivity": "high",
    },
    "SettlementRecord": {
        "label": "销售结算单",
        "description": "结算状态、结算金额与关联销售订单。",
        "key_properties": ["settlement_no", "order_no", "settlement_status", "settlement_amount"],
        "sensitivity": "high",
    },
    "StockMovement": {
        "label": "库存流水",
        "description": "入库、出库、调拨等库存变动。",
        "key_properties": ["bill_no", "date", "warehouse", "sku", "quantity", "movement_type"],
        "sensitivity": "high",
    },
    "SalesFact": {
        "label": "销售事实",
        "description": "销量、销售额、GMV 等结构化事实。",
        "key_properties": ["dataset_slug", "date", "sku", "channel", "sales_qty", "revenue"],
        "sensitivity": "medium",
    },
    "InventorySnapshot": {
        "label": "库存快照",
        "description": "库存余额、在途等快照事实。",
        "key_properties": ["dataset_slug", "date", "sku", "warehouse", "ending_inventory"],
        "sensitivity": "medium",
    },
    "AdCampaign": {
        "label": "投放记录",
        "description": "广告花费、ACOS、ROAS。",
        "key_properties": ["dataset_slug", "date", "sku", "channel", "ad_spend", "acos", "roas"],
        "sensitivity": "medium",
    },
    "FinanceRecord": {
        "label": "财务记录",
        "description": "收入、成本、毛利、现金等财务事实。",
        "key_properties": ["dataset_slug", "date", "sku", "revenue", "cost", "gross_profit", "cash"],
        "sensitivity": "high",
    },
    "PurchaseOrder": {
        "label": "采购订单",
        "description": "供应商、SKU、采购价与交期。",
        "key_properties": ["purchase_order_no", "supplier", "sku", "delivery_date"],
        "sensitivity": "high",
    },
    "FeedbackLoop": {
        "label": "系统回路",
        "description": "System Dynamics 反馈回路（R/B），可挂参与指标。",
        "key_properties": ["loop_code", "loop_type", "name"],
        "sensitivity": "medium",
    },
}

COMMERCE_RELATION_TYPES: dict[str, dict[str, str]] = {
    "belongs_to": {"label": "归属", "description": "对象属于另一个业务对象。"},
    "contains": {"label": "包含", "description": "上层容器包含下层对象。"},
    "derived_from": {"label": "来源", "description": "对象或结论来自某个资料来源。"},
    "affects": {"label": "影响", "description": "决策、风险或动作影响业务对象。"},
    "observed_in": {"label": "出现于", "description": "业务对象出现在数据集或文档中。"},
    "supplied_by": {"label": "供货方", "description": "SKU 或采购单据关联供应商。"},
    "participates_in_loop": {"label": "参与回路", "description": "存量/指标参与反馈回路。"},
    "causes": {"label": "导致", "description": "因果促进（+）。"},
    "candidate_causes": {"label": "候选因果", "description": "待确认的因果边。"},
}

# 回路层 → 主对象类型 key
LOOP_LEVEL_OBJECT: dict[str, str] = {
    "company": "Organization",
    "brand": "Brand",
    "platform": "Channel",
    "channel": "Shop",
    "link": "Product",
    "sku": "SKU",
}

# 包含链（父类型 key → 子类型 key）
CONTAINMENT_CHAIN: list[tuple[str, str, str]] = [
    ("Organization", "Brand", "包含品牌"),
    ("Brand", "Channel", "包含平台"),
    ("Channel", "Shop", "包含店铺"),
    ("Shop", "Product", "包含链接"),
    ("Product", "SKU", "包含SKU"),
]


def category_for(type_key: str) -> str:
    if type_key in VIRTUAL_KEYS:
        return "virtual"
    return "physical"


def preset_types_for_ui() -> dict[str, list[str]]:
    """合并进图谱前端预设：物理 / 虚拟分组的中文 otype 列表。"""
    physical: list[str] = []
    virtual: list[str] = []
    for key, spec in COMMERCE_OBJECT_TYPES.items():
        label = spec["label"]
        if category_for(key) == "virtual":
            if label not in virtual:
                virtual.append(label)
        else:
            if label not in physical:
                physical.append(label)
    return {"physical": physical, "virtual": virtual}


def schema_payload() -> dict[str, Any]:
    return {
        "source": "a2a-ecommerce-workbench",
        "phase": 1,
        "object_types": [
            {
                "key": key,
                "label": spec["label"],
                "description": spec.get("description", ""),
                "key_properties": spec.get("key_properties", []),
                "sensitivity": spec.get("sensitivity", "medium"),
                "loop_level": spec.get("loop_level"),
                "category": category_for(key),
            }
            for key, spec in COMMERCE_OBJECT_TYPES.items()
        ],
        "relation_types": [
            {"key": k, **v} for k, v in COMMERCE_RELATION_TYPES.items()
        ],
        "loop_level_object": LOOP_LEVEL_OBJECT,
        "containment_chain": [
            {
                "parent_key": p,
                "child_key": c,
                "parent_label": COMMERCE_OBJECT_TYPES[p]["label"],
                "child_label": COMMERCE_OBJECT_TYPES[c]["label"],
                "label": lab,
            }
            for p, c, lab in CONTAINMENT_CHAIN
        ],
    }
