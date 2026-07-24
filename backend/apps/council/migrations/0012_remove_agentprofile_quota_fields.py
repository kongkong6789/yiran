from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0011_agentprofile_sop_keys"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="agentprofile",
            name="quota_limit",
        ),
        migrations.RemoveField(
            model_name="agentprofile",
            name="quota_used",
        ),
    ]
