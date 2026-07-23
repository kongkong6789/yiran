import hashlib
import json

from django.db import migrations


def _hash(graph, input_schema, output_schema, triggers, examples):
    payload = {"graph": graph, "input": input_schema, "output": output_schema, "triggers": triggers, "examples": examples}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _empty_bindings():
    return {"snapshot_ids": [], "metric_ids": [], "asset_keys": [], "scope": "", "brand_ids": []}


def _empty_knowledge():
    return {"knowledge_base_ids": [], "retrieval_hint": ""}


def _node(key, node_type, title, *, instruction="", expected=None, action="", allowed=None):
    expected = expected or []
    allowed = allowed or []
    return {
        "key": key,
        "type": node_type,
        "title": title,
        "config": {
            "instruction": instruction,
            "expected_user_info": expected,
            "required_fields": expected,
            "allowed_actions": allowed,
            "knowledge_scope": _empty_knowledge(),
            "data_bindings": _empty_bindings(),
            "action_name": action,
            "detail": instruction,
            "message": instruction,
        },
    }


def upgrade_system_sops(apps, schema_editor):
    Definition = apps.get_model("orchestration", "SopDefinition")
    Version = apps.get_model("orchestration", "SopVersion")
    specs = [
        {
            "key": "business.report.generate",
            "action": "report.generate",
            "required": ["dt", "scope"],
            "graph": {
                "start": "collect.scope",
                "terminals": ["finish"],
                "meta": {
                    "goal": ["基于企业可信数据生成经营分析报告"],
                    "required_info": ["dt", "scope"],
                    "slot_filling_policy": {},
                },
                "nodes": [
                    _node(
                        "collect.scope", "collect_info", "确认任务范围",
                        instruction="确认报告日期、数据范围等必要参数",
                        expected=["dt", "scope"],
                        allowed=["ask_user", "continue_flow"],
                    ),
                    _node(
                        "data.bind", "data_bind", "绑定企业可信数据",
                        instruction="绑定本报告要使用的企业可信 Snapshot；未指定时回退到已发布 LIVE 数据",
                        allowed=["continue_flow"],
                    ),
                    _node(
                        "execute", "execute_action", "生成经营报告",
                        instruction="调用 report.generate，使用已绑定企业数据生成报告并留存证据",
                        action="report.generate",
                        allowed=["continue_flow", "call_action:report.generate"],
                    ),
                    _node(
                        "finish", "end", "完成并留存结果",
                        instruction="SOP 运行结果已写入任务和审计链路",
                        allowed=["continue_flow"],
                    ),
                ],
                "edges": [
                    {"source": "collect.scope", "target": "data.bind", "condition": "always", "priority": 1, "label": ""},
                    {"source": "data.bind", "target": "execute", "condition": "always", "priority": 1, "label": ""},
                    {"source": "execute", "target": "finish", "condition": "decision:allow", "priority": 1, "label": ""},
                    {"source": "execute", "target": "finish", "condition": "decision:block", "priority": 2, "label": ""},
                ],
            },
        },
        {
            "key": "inventory.reorder.shadow",
            "action": "inventory.reorder.shadow",
            "required": ["snapshot_id"],
            "graph": {
                "start": "collect.scope",
                "terminals": ["finish"],
                "meta": {
                    "goal": ["基于可信库存快照输出补货影子分析"],
                    "required_info": ["snapshot_id"],
                    "slot_filling_policy": {},
                },
                "nodes": [
                    _node(
                        "collect.scope", "collect_info", "确认任务范围",
                        instruction="确认库存 Snapshot 等必要参数",
                        expected=["snapshot_id"],
                        allowed=["ask_user", "continue_flow"],
                    ),
                    _node(
                        "data.bind", "data_bind", "绑定库存可信数据",
                        instruction="绑定库存分析使用的 Snapshot / 指标契约",
                        allowed=["continue_flow"],
                    ),
                    _node(
                        "execute", "execute_action", "执行库存风险分析",
                        instruction="调用 inventory.reorder.shadow 做只读风险与补货情景分析",
                        action="inventory.reorder.shadow",
                        allowed=["continue_flow", "call_action:inventory.reorder.shadow"],
                    ),
                    _node(
                        "finish", "end", "完成并留存结果",
                        instruction="SOP 运行结果已写入任务和审计链路",
                        allowed=["continue_flow"],
                    ),
                ],
                "edges": [
                    {"source": "collect.scope", "target": "data.bind", "condition": "always", "priority": 1, "label": ""},
                    {"source": "data.bind", "target": "execute", "condition": "always", "priority": 1, "label": ""},
                    {"source": "execute", "target": "finish", "condition": "decision:allow", "priority": 1, "label": ""},
                    {"source": "execute", "target": "finish", "condition": "decision:block", "priority": 2, "label": ""},
                ],
            },
        },
    ]
    for spec in specs:
        definition = Definition.objects.filter(organization=None, sop_key=spec["key"]).first()
        if not definition:
            continue
        version = Version.objects.filter(definition=definition, version=definition.current_version or "1.0.0").first()
        if not version:
            continue
        graph = spec["graph"]
        version.graph = graph
        version.input_schema = {"type": "object", "required": spec["required"]}
        version.content_hash = _hash(
            graph,
            version.input_schema,
            version.output_schema or {"type": "object", "required": ["ok"]},
            version.trigger_intents or [],
            version.utterance_examples or [],
        )
        version.change_summary = "升级为 SkillCard 节点配置（instruction / data_bind / allowed_actions）"
        version.save(update_fields=["graph", "input_schema", "content_hash", "change_summary"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [("orchestration", "0002_seed_system_sops")]
    operations = [migrations.RunPython(upgrade_system_sops, noop_reverse)]
