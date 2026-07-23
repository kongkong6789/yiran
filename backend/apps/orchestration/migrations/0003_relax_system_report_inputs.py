import hashlib
import json

from django.db import migrations


SOP_KEY = "business.report.generate"


def _content_hash(graph, input_schema, output_schema, triggers, examples):
    payload = {
        "graph": graph,
        "input": input_schema,
        "output": output_schema,
        "triggers": triggers,
        "examples": examples,
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _set_required_fields(apps, required_fields):
    Definition = apps.get_model("orchestration", "SopDefinition")
    definition = Definition.objects.filter(
        organization=None,
        sop_key=SOP_KEY,
    ).first()
    if not definition:
        return

    version = definition.versions.filter(version=definition.current_version).first()
    if not version:
        return

    graph = dict(version.graph or {})
    nodes = []
    for raw_node in graph.get("nodes") or []:
        node = dict(raw_node)
        if node.get("key") == "collect.scope":
            config = dict(node.get("config") or {})
            config["required_fields"] = list(required_fields)
            node["config"] = config
        nodes.append(node)
    graph["nodes"] = nodes

    input_schema = dict(version.input_schema or {})
    input_schema["required"] = list(required_fields)
    version.graph = graph
    version.input_schema = input_schema
    version.content_hash = _content_hash(
        graph,
        input_schema,
        version.output_schema or {},
        version.trigger_intents or [],
        version.utterance_examples or [],
    )
    version.change_summary = "允许经营报告从自然语言和可信快照推断时间及范围"
    version.save(update_fields=["graph", "input_schema", "content_hash", "change_summary", "updated_at"])


def relax_report_inputs(apps, schema_editor):
    _set_required_fields(apps, [])


def restore_report_inputs(apps, schema_editor):
    _set_required_fields(apps, ["dt", "scope"])


class Migration(migrations.Migration):
    dependencies = [("orchestration", "0002_seed_system_sops")]
    operations = [migrations.RunPython(relax_report_inputs, restore_report_inputs)]
