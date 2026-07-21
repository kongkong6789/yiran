from django.db import migrations, models
import django.db.models.deletion


def backfill_organization(apps, schema_editor):
    SmartSheet = apps.get_model("smarttable", "SmartSheet")
    OrganizationMembership = apps.get_model("core", "OrganizationMembership")
    for sheet in SmartSheet.objects.filter(organization__isnull=True).iterator():
        membership = (
            OrganizationMembership.objects.filter(
                user_id=sheet.owner_id,
                is_active=True,
                organization__is_active=True,
            )
            .order_by("-is_primary", "id")
            .first()
        )
        if membership:
            SmartSheet.objects.filter(pk=sheet.pk).update(
                organization_id=membership.organization_id
            )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0021_workautomation_scheduler"),
        ("smarttable", "0004_smartautomation_smartview_delete_baserowssoticket"),
    ]

    operations = [
        migrations.AddField(
            model_name="smartsheet",
            name="organization",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="smart_sheets",
                to="core.organization",
                verbose_name="所属组织",
            ),
        ),
        migrations.AddIndex(
            model_name="smartsheet",
            index=models.Index(
                fields=["organization", "-updated_at"],
                name="smartsheet_org_updated",
            ),
        ),
        migrations.RunPython(backfill_organization, migrations.RunPython.noop),
    ]
