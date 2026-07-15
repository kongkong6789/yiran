from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("collab", "0007_collabparticipant_last_read"),
    ]

    operations = [
        migrations.AddField(
            model_name="collabroom",
            name="interject_enabled",
            field=models.BooleanField(default=True, verbose_name="允许AI插嘴"),
        ),
        migrations.AddField(
            model_name="collabmessage",
            name="ai_kind",
            field=models.CharField(
                blank=True,
                choices=[("", "无"), ("reply", "应答"), ("interject", "插嘴")],
                db_index=True,
                default="",
                max_length=16,
                verbose_name="AI角色",
            ),
        ),
    ]
