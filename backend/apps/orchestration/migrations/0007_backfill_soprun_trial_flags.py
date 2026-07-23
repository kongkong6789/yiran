from django.db import migrations


def backfill_trial_flags(apps, schema_editor):
    SopRun = apps.get_model("orchestration", "SopRun")
    for run in SopRun.objects.all().iterator(chunk_size=200):
        payload = {}
        input_data = run.input_data if isinstance(run.input_data, dict) else {}
        raw = input_data.get("payload")
        if isinstance(raw, dict):
            payload = raw
        if payload.get("_sop_trial"):
            run.is_trial = True
            run.source = "trial"
            run.save(update_fields=["is_trial", "source"])


class Migration(migrations.Migration):

    dependencies = [
        ("orchestration", "0006_sop_evolution_observability"),
    ]

    operations = [
        migrations.RunPython(backfill_trial_flags, migrations.RunPython.noop),
    ]
