import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="WeComApiConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("corp_id", models.CharField(blank=True, default="", max_length=128, verbose_name="企业 ID")),
                ("agent_id", models.CharField(blank=True, default="", max_length=64, verbose_name="应用 AgentID")),
                ("secret_encrypted", models.TextField(blank=True, default="", verbose_name="应用 Secret（密文）")),
                ("callback_url", models.URLField(blank=True, default="", max_length=500, verbose_name="回调地址")),
                ("token_encrypted", models.TextField(blank=True, default="", verbose_name="Token（密文）")),
                ("encoding_aes_key_encrypted", models.TextField(blank=True, default="", verbose_name="EncodingAESKey（密文）")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="创建时间")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新时间")),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="wecom_api_config", to=settings.AUTH_USER_MODEL, verbose_name="用户")),
            ],
            options={"verbose_name": "企业微信 API 配置", "verbose_name_plural": "企业微信 API 配置"},
        ),
    ]
