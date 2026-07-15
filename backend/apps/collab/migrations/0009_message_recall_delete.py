from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("collab", "0008_interject_and_ai_kind"),
    ]

    operations = [
        migrations.AddField(
            model_name="collabmessage",
            name="status",
            field=models.CharField(
                choices=[
                    ("normal", "正常"),
                    ("recalled", "已撤回"),
                    ("deleted", "已删除"),
                ],
                db_index=True,
                default="normal",
                max_length=16,
                verbose_name="状态",
            ),
        ),
        migrations.AddField(
            model_name="collabmessage",
            name="updated_at",
            field=models.DateTimeField(
                auto_now=True,
                db_index=True,
                default=django.utils.timezone.now,
                verbose_name="更新时间",
            ),
            preserve_default=False,
        ),
    ]
