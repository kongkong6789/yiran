from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("collab", "0009_message_recall_delete"),
    ]

    operations = [
        migrations.AddField(
            model_name="collabmessage",
            name="risk_flag",
            field=models.CharField(blank=True, default="", max_length=40, verbose_name="风险标签"),
        ),
        migrations.AddField(
            model_name="collabmessage",
            name="risk_flag_level",
            field=models.CharField(
                blank=True,
                choices=[("", "无"), ("yellow", "注意"), ("red", "高风险")],
                default="",
                max_length=16,
                verbose_name="风险标签等级",
            ),
        ),
    ]
