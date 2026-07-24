from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0001_initial"),
        ("skills", "0009_skillasset_sop_callable"),
    ]

    operations = [
        migrations.AddField(
            model_name="skillusageevent",
            name="agent",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="skill_usage_events",
                to="council.agentprofile",
                verbose_name="调用智能体",
            ),
        ),
        migrations.AddIndex(
            model_name="skillusageevent",
            index=models.Index(
                fields=["agent", "used_at"],
                name="skill_usage_agent_time",
            ),
        ),
    ]
