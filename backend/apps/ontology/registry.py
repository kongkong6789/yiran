"""
第5层 Ontology 业务对象层。

定义:业务对象、状态转换规则、权限、约束、可执行动作契约(Action Contract)。
上层(orchestration)据此路由动作;下层(harness)据此做闸机校验。
"""
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ActionContract:
    """可执行动作契约:一个动作能否被 Agent 执行的完整规格。"""

    name: str                       # 动作唯一标识,如 "purchase.create"
    title: str                      # 中文名
    object_type: str                # 作用的业务对象,如 "purchase_order"
    connector: str                  # 第7层执行器,如 "kingdee"
    required_fields: dict[str, str] # 参数 schema: 字段名 -> 类型(str/number/date/bool)
    required_roles: list[str] = field(default_factory=list)  # 权限校验所需角色
    from_states: list[str] = field(default_factory=list)     # 允许的前置状态(状态校验)
    to_state: str | None = None                              # 执行后状态
    budget_field: str | None = None    # 预算校验所看的金额字段
    high_risk: bool = False            # 是否高风险(触发人工审批)


# 业务对象定义:对象 -> 状态机
OBJECTS: dict[str, dict[str, Any]] = {
    "purchase_order": {
        "title": "采购单",
        "states": ["draft", "submitted", "approved", "rejected", "done"],
        "initial": "draft",
    },
    "price_change": {
        "title": "改价单",
        "states": ["draft", "submitted", "approved", "applied"],
        "initial": "draft",
    },
    "report": {
        "title": "日报/分析报告",
        "states": ["draft", "published"],
        "initial": "draft",
    },
    "simulation_run": {
        "title": "只读情景分析",
        "states": ["draft", "completed", "blocked"],
        "initial": "draft",
    },
}

# 角色与预算上限(权限继承 & 预算约束)
ROLE_BUDGET = {
    "operator": 10000,      # 运营:单笔 1 万以内
    "manager": 100000,      # 主管:10 万以内
    "director": 1000000,    # 总监:100 万以内
}

# 可执行动作契约注册表
ACTIONS: dict[str, ActionContract] = {
    "inventory.reorder.shadow": ActionContract(
        name="inventory.reorder.shadow",
        title="库存补货只读影子分析",
        object_type="simulation_run",
        connector="internal",
        required_fields={"snapshot_id": "number"},
        required_roles=["operator", "manager", "director"],
        from_states=["draft"],
        to_state="completed",
        high_risk=False,
    ),
    "report.generate": ActionContract(
        name="report.generate",
        title="生成经营分析报告",
        object_type="report",
        connector="internal",
        required_fields={"dt": "date", "scope": "str"},
        required_roles=["operator", "manager", "director"],
        from_states=["draft"],
        to_state="published",
        high_risk=False,
    ),
    "price_change.apply": ActionContract(
        name="price_change.apply",
        title="商品改价",
        object_type="price_change",
        connector="shop_backend",
        required_fields={"sku": "str", "new_price": "number", "shop": "str"},
        required_roles=["manager", "director"],
        from_states=["approved"],
        to_state="applied",
        budget_field=None,
        high_risk=True,
    ),
    "purchase.create": ActionContract(
        name="purchase.create",
        title="创建采购单",
        object_type="purchase_order",
        connector="kingdee",
        required_fields={"sku": "str", "qty": "number", "amount": "number", "supplier": "str"},
        required_roles=["operator", "manager", "director"],
        from_states=["draft"],
        to_state="submitted",
        budget_field="amount",
        high_risk=True,
    ),
    "jackyun.sync": ActionContract(
        name="jackyun.sync",
        title="同步吉客云数据",
        object_type="report",
        connector="jackyun",
        required_fields={},
        required_roles=["operator", "manager", "director"],
        from_states=[],
        to_state=None,
        high_risk=False,
    ),
}


def get_action(name: str) -> ActionContract | None:
    return ACTIONS.get(name)


def list_actions() -> list[dict]:
    out = []
    for a in ACTIONS.values():
        out.append(
            {
                "name": a.name,
                "title": a.title,
                "object_type": a.object_type,
                "connector": a.connector,
                "required_fields": a.required_fields,
                "required_roles": a.required_roles,
                "from_states": a.from_states,
                "to_state": a.to_state,
                "budget_field": a.budget_field,
                "high_risk": a.high_risk,
            }
        )
    return out
