import uuid

from django.db import migrations, models


def mark_existing_as_wecom_synced(apps, schema_editor):
    WorkTodo = apps.get_model("core", "WorkTodo")
    WorkTodo.objects.update(sync_requested=True)


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0011_worktodo"),
    ]

    operations = [
        migrations.AddField(
            model_name="worktodo",
            name="sync_group_id",
            field=models.UUIDField(db_index=True, default=uuid.uuid4, editable=False),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="sync_requested",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="sync_retry_count",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="sync_next_retry_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="last_synced_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="last_sync_source",
            field=models.CharField(
                choices=[("platform", "平台"), ("wecom", "企业微信")],
                default="platform",
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="worktodo",
            name="sync_status",
            field=models.CharField(
                choices=[
                    ("not_requested", "仅平台"),
                    ("pending", "待同步"),
                    ("synced", "已同步"),
                    ("failed", "同步失败"),
                ],
                db_index=True,
                default="not_requested",
                max_length=20,
            ),
        ),
        migrations.RunPython(mark_existing_as_wecom_synced, migrations.RunPython.noop),
    ]
