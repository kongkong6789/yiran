from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0023_tasktemplate"),
    ]

    operations = [
        migrations.AddField(
            model_name="tasktemplate",
            name="builtin_key",
            field=models.CharField(blank=True, db_index=True, max_length=64, null=True),
        ),
        migrations.AddConstraint(
            model_name="tasktemplate",
            constraint=models.UniqueConstraint(
                condition=models.Q(("builtin_key__isnull", False)),
                fields=("organization", "builtin_key"),
                name="core_tasktpl_builtin_org_uniq",
            ),
        ),
    ]
