from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0009_agentprofile_enterprise_capabilities"),
    ]

    operations = [
        migrations.AlterField(
            model_name="agentprofile",
            name="emoji",
            field=models.CharField(default="🤖", max_length=64, verbose_name="头像 emoji"),
        ),
    ]
