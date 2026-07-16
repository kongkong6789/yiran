"""四期：经营委员会只读复核（对齐知行 council_tools 语义）。"""
from __future__ import annotations


PANEL = [
    {"id": "ops", "name": "运营委员", "focus": "转化/流量/履约"},
    {"id": "finance", "name": "财务委员", "focus": "毛利/费用/现金"},
    {"id": "supply", "name": "供应链委员", "focus": "库存/交期/缺货"},
    {"id": "risk", "name": "风控委员", "focus": "体验分/违规/集中度"},
    {"id": "strategy", "name": "战略委员", "focus": "品牌矩阵/增长约束"},
]


def suggest_panel(domain: str = "") -> dict:
    return {
        "schema": "liangce_commerce_council_panel_v1",
        "domain": domain or "ecommerce",
        "mode": "quick",
        "panel": PANEL,
    }


def run_council_review(decision_context: str, domain: str = "", evidence: str = "") -> dict:
    """无 LLM 依赖的规则化示范复核；有 council.llm 时尝试增强。"""
    ctx = (decision_context or "").strip()
    votes = []
    kill = []
    lower = ctx.lower()

    for member in PANEL:
        stance = "支持（有条件）"
        reason = f"从{member['focus']}看，需补充量化基线。"
        if any(k in ctx for k in ("亏损", "断货", "投诉", "违规")):
            stance = "反对/慎行"
            reason = f"{member['name']}提示：上下文含风险信号，建议先止血。"
        elif any(k in ctx for k in ("增长", "投放", "扩品", "开店")):
            stance = "支持（观察）"
            reason = f"{member['name']}：增长动作需匹配产能与现金。"
        votes.append({
            "member_id": member["id"],
            "member": member["name"],
            "stance": stance,
            "reason": reason,
            "focus": member["focus"],
        })

    if any(k in ctx for k in ("无确认写回", "直接改价", "自动下单")):
        kill.append("禁止无审批的外部写回")
    if "断货" in ctx:
        kill.append("库存未回补前不加大投流")
    if not kill:
        kill.append("保留人工确认闸机")

    summary = "委员会完成只读复核（示范规则）。" if ctx else "未提供决策上下文。"

    # 可选：尝试 LLM 摘要（失败则忽略）
    try:
        if ctx and len(ctx) > 8:
            from apps.council import llm
            if hasattr(llm, "chat") or hasattr(llm, "complete"):
                pass  # 保持规则结果为真源，避免拖慢
    except Exception:
        pass

    return {
        "schema": "liangce_commerce_council_review_v1",
        "domain": domain or "ecommerce",
        "decision_context": ctx[:2000],
        "evidence_excerpt": (evidence or "")[:1000],
        "panel": PANEL,
        "votes": votes,
        "kill_criteria": kill,
        "summary": summary,
        "readonly": True,
    }
