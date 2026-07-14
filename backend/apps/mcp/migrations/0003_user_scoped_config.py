from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("mcp", "0002_mcpserverconfig_env"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("core", "0003_user_auth"),
    ]

    operations = [
        migrations.AddField(
            model_name="mcpserverconfig",
            name="user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="mcp_configs",
                to=settings.AUTH_USER_MODEL,
                verbose_name="用户",
            ),
        ),
        migrations.AlterField(
            model_name="mcpserverconfig",
            name="server_id",
            field=models.CharField(db_index=True, max_length=64, verbose_name="服务 ID"),
        ),
        migrations.AddConstraint(
            model_name="mcpserverconfig",
            constraint=models.UniqueConstraint(fields=("user", "server_id"), name="uniq_user_mcp_server"),
        ),
    ]
