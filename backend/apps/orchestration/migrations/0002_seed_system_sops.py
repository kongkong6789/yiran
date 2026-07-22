import hashlib
import json

from django.db import migrations


def _hash(graph, input_schema, output_schema, triggers, examples):
    payload = {"graph": graph, "input": input_schema, "output": output_schema, "triggers": triggers, "examples": examples}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def seed_system_sops(apps, schema_editor):
    Definition = apps.get_model("orchestration", "SopDefinition")
    Version = apps.get_model("orchestration", "SopVersion")
    specs = [
        {
            "key": "business.report.generate",
            "name": "经营报告生成流程",
            "domain": "经营分析",
            "description": "从企业可信数据获取指标，完成分析、报告生成和证据留存。",
            "action": "report.generate",
            "required": ["dt", "scope"],
            "triggers": ["运营日报", "销售周报", "经营月报", "经营分析报告"],
            "examples": ["帮我生成本周销售周报", "生成昨天的运营日报"],
        },
        {
            "key": "inventory.reorder.shadow",
            "name": "库存风险与补货影子分析",
            "domain": "库存经营",
            "description": "绑定可信快照和指标，执行只读库存风险与补货情景分析。",
            "action": "inventory.reorder.shadow",
            "required": ["snapshot_id"],
            "triggers": ["库存风险", "补货分析", "库存诊断"],
            "examples": ["分析当前库存风险并给出补货建议"],
        },
    ]
    for spec in specs:
        graph = {
            "start": "collect.scope",
            "terminals": ["finish"],
            "nodes": [
                {"key": "collect.scope", "type": "collect_info", "title": "确认任务范围", "config": {"required_fields": spec["required"]}},
                {"key": "execute", "type": "execute_action", "title": "执行可信业务流程", "config": {"action_name": spec["action"]}},
                {"key": "finish", "type": "end", "title": "完成并留存结果", "config": {"detail": "SOP 运行结果已写入任务和审计链路"}},
            ],
            "edges": [
                {"source": "collect.scope", "target": "execute", "condition": "always", "priority": 1},
                {"source": "execute", "target": "finish", "condition": "decision:allow", "priority": 1},
                {"source": "execute", "target": "finish", "condition": "decision:block", "priority": 2},
            ],
        }
        input_schema = {"type": "object", "required": spec["required"]}
        output_schema = {"type": "object", "required": ["ok"]}
        definition, _ = Definition.objects.get_or_create(
            organization=None,
            sop_key=spec["key"],
            defaults={
                "name": spec["name"], "business_domain": spec["domain"], "description": spec["description"],
                "action_name": spec["action"], "status": "published", "current_version": "1.0.0",
            },
        )
        Version.objects.get_or_create(
            definition=definition,
            version="1.0.0",
            defaults={
                "status": "published", "graph": graph, "input_schema": input_schema,
                "output_schema": output_schema, "trigger_intents": spec["triggers"],
                "utterance_examples": spec["examples"],
                "content_hash": _hash(graph, input_schema, output_schema, spec["triggers"], spec["examples"]),
                "change_summary": "系统初始版本",
            },
        )


def remove_system_sops(apps, schema_editor):
    Definition = apps.get_model("orchestration", "SopDefinition")
    Definition.objects.filter(organization=None, sop_key__in=["business.report.generate", "inventory.reorder.shadow"]).delete()


class Migration(migrations.Migration):
    dependencies = [("orchestration", "0001_initial")]
    operations = [migrations.RunPython(seed_system_sops, remove_system_sops)]
