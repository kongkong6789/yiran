# Duplicate of enterprise+0011 sop_keys path after merge; keep as no-op leaf for history.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0009_agentprofile_archived_at_and_more"),
    ]

    operations = []
