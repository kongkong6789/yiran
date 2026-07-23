from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0009_agentprofile_archived_at_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="agentprofile",
            name="sop_keys",
            field=models.JSONField(blank=True, default=list, verbose_name="绑定已发布 SOP key"),
        ),
    ]
