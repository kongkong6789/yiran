from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("collab", "0010_message_risk_flag"),
    ]

    operations = [
        migrations.AlterField(
            model_name="collabmessage",
            name="ai_kind",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "无"),
                    ("reply", "应答"),
                    ("interject", "插嘴"),
                    ("suggest", "建议"),
                ],
                db_index=True,
                default="",
                max_length=16,
                verbose_name="AI角色",
            ),
        ),
    ]
