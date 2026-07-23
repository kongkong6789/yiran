from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("orchestration", "0003_upgrade_system_sop_skillcard"),
    ]

    operations = [
        migrations.AddField(
            model_name="sopversion",
            name="editor_chat",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
