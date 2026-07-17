import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def backfill_platform_recipient_names(apps, schema_editor):
    WorkTodo = apps.get_model("core", "WorkTodo")
    for row in WorkTodo.objects.select_related("assignee").filter(assignee__isnull=False).iterator():
        row.recipient_name = row.assignee.username
        row.save(update_fields=["recipient_name"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0012_worktodo_wecom_sync_queue"),
        ("wecom", "0011_wecomcliconfig_access_scope_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="worktodo",
            name="assignee",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="assigned_work_todos",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="recipient_type",
            field=models.CharField(
                choices=[("platform", "平台成员"), ("wecom", "企业微信成员")],
                db_index=True,
                default="platform",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="recipient_name",
            field=models.CharField(blank=True, default="", max_length=128),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="wecom_contact",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="work_todos",
                to="wecom.wecomcontact",
            ),
        ),
        migrations.RunPython(backfill_platform_recipient_names, migrations.RunPython.noop),
    ]
