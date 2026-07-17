from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0016_alter_worktodo_creator")]

    operations = [
        migrations.AddField(
            model_name="worktodo",
            name="operation_claim_token",
            field=models.UUIDField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="operation_claim_kind",
            field=models.CharField(blank=True, default="", max_length=16),
        ),
        migrations.AddField(
            model_name="worktodo",
            name="operation_claimed_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
    ]
