# Merge parallel council leaves after Fancy/test-agent combine.

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0010_agentprofile_sop_keys"),
        ("council", "0010_rename_council_mee_user_id_1b3639_idx_council_mee_user_id_7f9a1c_idx_and_more"),
        ("council", "0012_remove_agentprofile_quota_fields"),
    ]

    operations = []
