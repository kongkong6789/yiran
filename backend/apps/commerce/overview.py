"""经营融合总览：一二期～五期状态。"""
from __future__ import annotations

from django.conf import settings

from apps.ontology.commerce_schema import schema_payload
from apps.ontology.models import OntObject


def fusion_overview() -> dict:
    sample_n = OntObject.objects.filter(attributes__commerce_seed=True).count()
    schema = schema_payload()
    return {
        "name": "知行经营中枢 → 良策",
        "source_path": r"D:\test\a2a-ecommerce-workbench",
        "phases": [
            {
                "id": 1,
                "title": "电商 Ontology 契约与包含链",
                "status": "done",
                "items": [
                    f"对象类型 {len(schema['object_types'])} 个",
                    f"样例实体 {sample_n} 个",
                    "包含链：公司→品牌→平台→店铺→链接→SKU",
                    "API：/api/ontology/commerce-schema/",
                ],
            },
            {
                "id": 2,
                "title": "事实层健康 + 连接器对齐",
                "status": "done",
                "items": [
                    "DuckDB / PG 数据湖健康检查",
                    "数据集/表清单（复用 datalake）",
                    "吉客云/金蝶/MCP 连接状态摘要",
                    "API：/api/commerce/facts/health/",
                ],
            },
            {
                "id": 3,
                "title": "Loops Stock–Flow 仿真 / What-if",
                "status": "done",
                "items": [
                    "离散 Stock–Flow 情景实验",
                    "公司层 8 Stock 示范模型",
                    "API：/api/commerce/loops/simulate/",
                ],
            },
            {
                "id": 4,
                "title": "证据图 + 治理审批 + 经营评审",
                "status": "done",
                "items": [
                    "经营证据图谱（本体样例+回路）",
                    "MCP/审批/工具策略摘要",
                    "经营委员会只读复核",
                    "API：/api/commerce/evidence/ /governance/ /council/",
                ],
            },
            {
                "id": 5,
                "title": "经营 Agent 目录（旁路接入对话）",
                "status": "done",
                "items": [
                    "知行 Supervisor 角色目录迁入",
                    "引导跳转良策对话 @AI",
                    "API：/api/commerce/agents/",
                ],
            },
        ],
        "runtime": {
            "duckdb_path": getattr(settings, "DUCKDB_PATH", ""),
            "debug": settings.DEBUG,
        },
    }
