from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("collab", "0016_xiaoce_run_and_message_meta"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        "ALTER TABLE collab_xiaocerun "
                        "ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL "
                        "DEFAULT '{}'::jsonb"
                    ),
                    reverse_sql=migrations.RunSQL.noop,
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="xiaocerun",
                    name="meta",
                    field=models.JSONField(blank=True, default=dict),
                ),
            ],
        ),
    ]
