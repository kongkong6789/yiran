import hashlib
import json

from django.db import migrations


def relax_report_inputs_after_merge(apps, schema_editor):
    del schema_editor
    Definition = apps.get_model("orchestration", "SopDefinition")
    definition = Definition.objects.filter(
        organization=None,
        sop_key="business.report.generate",
    ).first()
    if definition is None:
        return
    version = definition.versions.filter(version=definition.current_version).first()
    if version is None:
        return

    graph = dict(version.graph or {})
    nodes = []
    for raw_node in graph.get("nodes") or []:
        node = dict(raw_node)
        if node.get("key") == "collect.scope":
            config = dict(node.get("config") or {})
            config["expected_user_info"] = []
            config["required_fields"] = []
            node["config"] = config
        nodes.append(node)
    graph["nodes"] = nodes
    meta = dict(graph.get("meta") or {})
    meta["required_info"] = []
    graph["meta"] = meta

    input_schema = dict(version.input_schema or {})
    input_schema["required"] = []
    payload = {
        "graph": graph,
        "input": input_schema,
        "output": version.output_schema or {},
        "triggers": version.trigger_intents or [],
        "examples": version.utterance_examples or [],
    }
    version.graph = graph
    version.input_schema = input_schema
    version.content_hash = hashlib.sha256(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    version.change_summary = "合并 SkillCard 升级并保留经营报告自然语言推断"
    version.save(
        update_fields=[
            "graph",
            "input_schema",
            "content_hash",
            "change_summary",
            "updated_at",
        ],
    )


def noop_reverse(apps, schema_editor):
    del apps, schema_editor


class Migration(migrations.Migration):

    dependencies = [
        ("orchestration", "0003_relax_system_report_inputs"),
        ("orchestration", "0004_sopversion_editor_chat"),
    ]

    operations = [
        migrations.RunPython(relax_report_inputs_after_merge, noop_reverse),
    ]
