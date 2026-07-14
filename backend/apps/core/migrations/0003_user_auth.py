from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_chat_history"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("llm_api_key", models.CharField(blank=True, default="", max_length=255, verbose_name="LLM API Key")),
                ("llm_base_url", models.CharField(blank=True, default="", max_length=255, verbose_name="LLM Base URL")),
                ("llm_model", models.CharField(blank=True, default="", max_length=128, verbose_name="LLM Model")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新时间")),
                (
                    "user",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="settings",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="用户",
                    ),
                ),
            ],
            options={
                "verbose_name": "用户设置",
                "verbose_name_plural": "用户设置",
            },
        ),
        migrations.AddField(
            model_name="chatsession",
            name="user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="chat_sessions",
                to=settings.AUTH_USER_MODEL,
                verbose_name="用户",
            ),
        ),
    ]
