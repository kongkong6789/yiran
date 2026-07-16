"""五期：经营 Agent 目录（自知行 supervisor 角色迁入）。"""
from __future__ import annotations

AGENTS = [
    {"id": "friendly_router_agent", "team": "routing", "title": "友好路由", "desc": "意图分流与说明"},
    {"id": "market_research_agent", "team": "strategy", "title": "市场研究", "desc": "品类/竞品洞察"},
    {"id": "data_agent", "team": "data", "title": "数据探查", "desc": "事实层查询与口径"},
    {"id": "knowledge_agent", "team": "data", "title": "知识检索", "desc": "Wiki / RAG"},
    {"id": "wiki_ingest_agent", "team": "data", "title": "Wiki 入库", "desc": "文档沉淀"},
    {"id": "data_cleaning_agent", "team": "data", "title": "数据清洗", "desc": "导出文件结构化"},
    {"id": "quality_gate_agent", "team": "data", "title": "质量闸机", "desc": "数据可用性检查"},
    {"id": "inventory_agent", "team": "decision", "title": "库存", "desc": "库存与调拨复核"},
    {"id": "finance_agent", "team": "decision", "title": "财务", "desc": "毛利/费用/现金"},
    {"id": "financial_planning_agent", "team": "decision", "title": "财务规划", "desc": "预算与节奏"},
    {"id": "risk_agent", "team": "decision", "title": "风控", "desc": "体验/违规/集中度"},
    {"id": "listing_agent", "team": "decision", "title": "链接运营", "desc": "商品页与规格"},
    {"id": "ads_agent", "team": "decision", "title": "投放", "desc": "广告 ROI"},
    {"id": "system_loops_agent", "team": "strategy", "title": "系统回路", "desc": "Stock–Flow / What-if"},
    {"id": "company_strategy_agent", "team": "strategy", "title": "公司战略", "desc": "品牌矩阵与增长约束"},
    {"id": "decision_agent", "team": "decision", "title": "决策综合", "desc": "方案对比"},
    {"id": "auto_workflow_agent", "team": "workflow", "title": "自动工作流", "desc": "多步编排"},
    {"id": "lightrag_agent", "team": "data", "title": "LightRAG", "desc": "图谱检索"},
    {"id": "agent_factory_agent", "team": "meta", "title": "Agent 工厂", "desc": "受控动态 Agent"},
]

SUPERVISORS = [
    {"id": "data_pipeline_supervisor", "title": "数据管线主管"},
    {"id": "decision_team_supervisor", "title": "决策团队主管"},
    {"id": "strategy_team_supervisor", "title": "战略团队主管"},
    {"id": "top_company_brain_supervisor", "title": "公司大脑总管"},
]


def agents_catalog() -> dict:
    return {
        "schema": "liangce_commerce_agents_v1",
        "source": "a2a supervisor_app roles",
        "integration": {
            "mode": "catalog + redirect",
            "chat_path": "/agent",
            "hint": "在对话中 @AI 并说明角色诉求；完整 LangGraph 旁路可后续挂到 orchestration",
        },
        "supervisors": SUPERVISORS,
        "agents": AGENTS,
        "counts": {"agents": len(AGENTS), "supervisors": len(SUPERVISORS)},
    }
