from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0017_worktodo_operation_claim"),
    ]

    operations = [
        migrations.AddField(
            model_name="usersettings",
            name="deleted_at",
            field=models.DateTimeField(
                blank=True,
                db_index=True,
                null=True,
                verbose_name="账号删除时间",
            ),
        ),
    ]
