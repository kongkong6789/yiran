# Duplicate of 0009_agentprofile_enterprise_capabilities after merge; no-op to avoid DuplicateColumn.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0024_tasktemplate_builtin_override"),
        ("council", "0008_merge_0006_seed_execution_agents_0007_meetinginvite"),
    ]

    operations = []
