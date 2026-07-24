from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0010_agentprofile_emoji_64"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentprofile",
            name="sop_keys",
            field=models.JSONField(blank=True, default=list, verbose_name="绑定 SOP Key"),
        ),
    ]
