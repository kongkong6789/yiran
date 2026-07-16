"""三期：离散 Stock–Flow 仿真（自知行 system_loops 简化迁入）。"""
from __future__ import annotations

from copy import deepcopy
from typing import Any


# 公司层 8 Stock 示范模型（对齐回路公司层）
COMPANY_8_STOCK_MODEL: dict[str, Any] = {
    "id": "company_8_stock",
    "name": "公司层 8 Stock 示范",
    "stocks": [
        {"id": "s1", "name": "代理品牌数", "initial": 46},
        {"id": "s2", "name": "渠道覆盖密度", "initial": 44},
        {"id": "s3", "name": "市场认知", "initial": 48},
        {"id": "s4", "name": "终端销售额", "initial": 50},
        {"id": "s5", "name": "品牌方满意度", "initial": 52},
        {"id": "s6", "name": "团队服务产能", "initial": 42},
        {"id": "s7", "name": "代理运营能力", "initial": 47},
        {"id": "s8", "name": "运营资源健康", "initial": 45},
    ],
    "flows": [
        {"id": "f1", "from": "s1", "to": "s2", "rate": 0.08, "polarity": "+"},
        {"id": "f2", "from": "s2", "to": "s3", "rate": 0.10, "polarity": "+"},
        {"id": "f3", "from": "s3", "to": "s4", "rate": 0.12, "polarity": "+"},
        {"id": "f4", "from": "s4", "to": "s5", "rate": 0.10, "polarity": "+"},
        {"id": "f5", "from": "s5", "to": "s1", "rate": 0.06, "polarity": "+"},
        {"id": "f6", "from": "s1", "to": "s6", "rate": 0.08, "polarity": "-"},
        {"id": "f7", "from": "s6", "to": "s7", "rate": 0.12, "polarity": "+"},
        {"id": "f8", "from": "s7", "to": "s5", "rate": 0.09, "polarity": "+"},
        {"id": "f9", "from": "s8", "to": "s7", "rate": 0.10, "polarity": "+"},
        {"id": "f10", "from": "s4", "to": "s8", "rate": 0.07, "polarity": "-", "delay": True},
    ],
}


def list_demo_models() -> list[dict]:
    return [
        {
            "id": COMPANY_8_STOCK_MODEL["id"],
            "name": COMPANY_8_STOCK_MODEL["name"],
            "stock_count": len(COMPANY_8_STOCK_MODEL["stocks"]),
            "flow_count": len(COMPANY_8_STOCK_MODEL["flows"]),
        }
    ]


def get_demo_model(model_id: str = "company_8_stock") -> dict | None:
    if model_id == COMPANY_8_STOCK_MODEL["id"]:
        return deepcopy(COMPANY_8_STOCK_MODEL)
    return None


def _clamp(n: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, n))


def simulate_discrete_stock_flow(
    model: dict,
    *,
    initial_values: dict[str, float] | None = None,
    interventions: dict[str, list[float]] | None = None,
    periods: int = 12,
    time_step: float = 1.0,
) -> dict:
    """
    简化离散仿真：每个 period 按边 polarity/rate 更新 to 存量。
    interventions: {stock_id: [加性脉冲 per period...]}
    """
    stocks = {s["id"]: float(s.get("initial", 50)) for s in model.get("stocks", [])}
    if initial_values:
        for k, v in initial_values.items():
            if k in stocks:
                stocks[k] = float(v)

    name_of = {s["id"]: s.get("name", s["id"]) for s in model.get("stocks", [])}
    flows = model.get("flows", [])
    interventions = interventions or {}
    trajectory: list[dict] = []

    for t in range(periods):
        net = {sid: 0.0 for sid in stocks}
        equation_terms: list[dict] = []
        for f in flows:
            src, dst = f.get("from"), f.get("to")
            if src not in stocks or dst not in stocks:
                continue
            rate = float(f.get("rate", 0.1)) * time_step
            pol = f.get("polarity", "+")
            # 延迟流：用上一拍近似——示范里直接减半速率
            if f.get("delay"):
                rate *= 0.5
            delta = (stocks[src] - 50.0) * rate * 0.15
            if pol == "-":
                delta = -abs(delta) if stocks[src] > 50 else abs(delta) * 0.5
                # 品牌增多稀释产能：s1 高 → s6 降
                if src == "s1" and dst == "s6":
                    delta = -(stocks[src] - 40) * rate * 0.2
            net[dst] += delta
            equation_terms.append({
                "flow": f.get("id"),
                "from": src,
                "to": dst,
                "delta": round(delta, 4),
                "polarity": pol,
            })

        for sid, pulses in interventions.items():
            if sid not in stocks:
                continue
            if t < len(pulses):
                pulse = float(pulses[t])
                net[sid] += pulse
                equation_terms.append({"flow": "intervention", "to": sid, "delta": pulse})

        nxt = {sid: _clamp(stocks[sid] + net[sid]) for sid in stocks}
        stocks = nxt
        trajectory.append({
            "period": t + 1,
            "values": {sid: round(v, 2) for sid, v in stocks.items()},
            "labels": {sid: name_of.get(sid, sid) for sid in stocks},
            "net_rates": {sid: round(net[sid], 4) for sid in net},
            "equation_terms": equation_terms[:20],
        })

    return {
        "schema": "liangce_commerce_stock_flow_sim_v1",
        "model_id": model.get("id"),
        "model_name": model.get("name"),
        "periods": periods,
        "trajectory": trajectory,
        "final": trajectory[-1]["values"] if trajectory else {},
        "uncertainty_metadata": {
            "note": "示范仿真，非校准预测；参数来自知行 Loops 方法简化移植",
        },
    }
