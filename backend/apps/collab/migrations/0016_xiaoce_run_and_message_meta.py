from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("collab", "0015_merge_20260717_1531"),
    ]

    operations = [
        migrations.AddField(
            model_name="xiaocerun",
            name="current_stage",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="xiaocerun",
            name="progress_steps",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="xiaocerun",
            name="error_code",
            field=models.CharField(blank=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="xiaocerun",
            name="result_message",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="result_xiaoce_run",
                to="collab.collabmessage",
            ),
        ),
    ]
