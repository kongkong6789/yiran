import django.db.models.deletion
from django.db import migrations, models


def scope_legacy(apps, schema_editor):
    Organization = apps.get_model("core", "Organization")
    OntObject = apps.get_model("ontology", "OntObject")
    OntRelation = apps.get_model("ontology", "OntRelation")
    CausalLink = apps.get_model("ontology", "CausalLink")
    organization = Organization.objects.order_by("id").first()
    if organization is None:
        organization = Organization.objects.create(name="默认企业")
    for obj in OntObject.objects.filter(organization__isnull=True):
        obj.organization = organization
        obj.object_key = f"legacy:obj:{obj.id}"
        obj.source_system = "local_legacy"
        obj.save(update_fields=["organization", "object_key", "source_system"])
    for relation in OntRelation.objects.filter(organization__isnull=True):
        relation.organization = organization
        relation.relation_key = f"legacy:rel:{relation.id}"
        relation.source_system = "local_legacy"
        relation.save(update_fields=["organization", "relation_key", "source_system"])
    for relation in OntRelation.objects.exclude(polarity=""):
        CausalLink.objects.get_or_create(
            relation=relation,
            defaults={
                "organization": relation.organization,
                "polarity": relation.polarity,
                "delay_days": relation.delay_days,
                "evidence_score": relation.evidence_score,
                "status": "candidate",
                "maturity": "hypothesis",
            },
        )


class Migration(migrations.Migration):
    atomic = False
    dependencies = [("ontology", "0003_causallink_ontalias_ontassertion_ontevidence_and_more")]

    operations = [
        migrations.RunPython(scope_legacy, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="ontobject",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="ontology_objects",
                to="core.organization",
                verbose_name="企业",
            ),
        ),
        migrations.AlterField(
            model_name="ontrelation",
            name="organization",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="ontology_relations",
                to="core.organization",
                verbose_name="企业",
            ),
        ),
    ]
