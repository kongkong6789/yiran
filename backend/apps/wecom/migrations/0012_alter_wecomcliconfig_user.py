from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("wecom", "0011_wecomcliconfig_access_scope_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="wecomcliconfig",
            name="user",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="wecom_cli_configs",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
