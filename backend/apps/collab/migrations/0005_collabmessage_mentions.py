from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("collab", "0004_collabmessage_attachments"),
    ]

    operations = [
        migrations.AddField(
            model_name="collabmessage",
            name="mentions",
            field=models.JSONField(blank=True, default=list, verbose_name="提及"),
        ),
        migrations.AddField(
            model_name="collabmessage",
            name="msg_type",
            field=models.CharField(
                choices=[("user", "用户"), ("system", "系统"), ("ai", "AI")],
                db_index=True,
                default="user",
                max_length=16,
                verbose_name="消息类型",
            ),
        ),
    ]
