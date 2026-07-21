from django.db import migrations, models
import django.db.models.deletion


def backfill_organizations(apps, schema_editor):
    McpServerConfig = apps.get_model("mcp", "McpServerConfig")
    OrganizationMembership = apps.get_model("core", "OrganizationMembership")
    seen = set()
    for row in McpServerConfig.objects.order_by("-updated_at", "-id"):
        membership = (
            OrganizationMembership.objects.filter(user_id=row.user_id, is_active=True)
            .order_by("-is_primary", "id")
            .first()
        )
        if not membership:
            continue
        key = (membership.organization_id, row.server_id)
        if key in seen:
            row.delete()
            continue
        seen.add(key)
        row.organization_id = membership.organization_id
        row.save(update_fields=["organization"])


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0021_workautomation_scheduler"),
        ("mcp", "0003_user_scoped_config"),
    ]

    operations = [
        migrations.AddField(
            model_name="mcpserverconfig",
            name="organization",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="mcp_server_configs",
                to="core.organization",
                verbose_name="所属企业",
            ),
        ),
        migrations.RunPython(backfill_organizations, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="mcpserverconfig",
            name="uniq_user_mcp_server",
        ),
        migrations.AddConstraint(
            model_name="mcpserverconfig",
            constraint=models.UniqueConstraint(
                fields=("organization", "server_id"),
                name="uniq_org_mcp_server",
            ),
        ),
    ]
