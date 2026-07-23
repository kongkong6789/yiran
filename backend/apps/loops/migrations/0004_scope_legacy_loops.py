import django.db.models.deletion
from django.db import migrations, models


def scope_legacy(apps, schema_editor):
    Organization = apps.get_model("core", "Organization")
    FeedbackLoop = apps.get_model("loops", "FeedbackLoop")
    organization = Organization.objects.order_by("id").first()
    if organization is None:
        organization = Organization.objects.create(name="默认企业")
    for loop in FeedbackLoop.objects.filter(organization__isnull=True):
        relation_org = (
            loop.members.select_related("relation__organization")
            .values_list("relation__organization_id", flat=True)
            .first()
        )
        loop.organization_id = relation_org or organization.id
        loop.loop_key = f"legacy:loop:{loop.id}"
        loop.save(update_fields=["organization", "loop_key"])


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("loops", "0003_evidencebinding_evidence_delay_flow_and_more")]

    operations = [
        migrations.RunPython(scope_legacy, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="feedbackloop",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="feedback_loops",
                to="core.organization",
            ),
        ),
    ]
