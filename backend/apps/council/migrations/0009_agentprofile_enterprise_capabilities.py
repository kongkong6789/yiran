import apps.council.models
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ("core", "0024_tasktemplate_builtin_override"),
        ("council", "0008_merge_0006_seed_execution_agents_0007_meetinginvite"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="agentprofile",
            name="organization",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="agent_profiles",
                to="core.organization",
                verbose_name="所属企业",
            ),
        ),
        migrations.AddField(
            model_name="agentprofile",
            name="created_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="created_agent_profiles",
                to=settings.AUTH_USER_MODEL,
                verbose_name="创建人",
            ),
        ),
        migrations.AddField(
            model_name="agentprofile",
            name="owner",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="owned_agent_profiles",
                to=settings.AUTH_USER_MODEL,
                verbose_name="负责人",
            ),
        ),
        migrations.AddField(
            model_name="agentprofile",
            name="employee_code",
            field=models.CharField(
                db_index=True,
                default=apps.council.models.generate_employee_code,
                max_length=24,
                verbose_name="员工编号",
            ),
        ),
        migrations.AddField(
            model_name="agentprofile",
            name="skill_ids",
            field=models.JSONField(blank=True, default=list, verbose_name="绑定 Skill ID"),
        ),
        migrations.AddField(
            model_name="agentprofile",
            name="knowledge_base_ids",
            field=models.JSONField(blank=True, default=list, verbose_name="绑定知识库 ID"),
        ),
        migrations.AddField(
            model_name="agentprofile",
            name="capability_instructions",
            field=models.TextField(blank=True, default="", verbose_name="能力调用规则"),
        ),
        migrations.AddField(
            model_name="agentprofile",
            name="lifecycle_status",
            field=models.CharField(
                choices=[
                    ("draft", "草稿"),
                    ("published", "已发布"),
                    ("disabled", "已停用"),
                    ("archived", "已归档"),
                ],
                db_index=True,
                default="published",
                max_length=16,
                verbose_name="生命周期",
            ),
        ),
        migrations.AddField(
            model_name="agentprofile",
            name="archived_at",
            field=models.DateTimeField(
                blank=True,
                db_index=True,
                null=True,
                verbose_name="归档时间",
            ),
        ),
        migrations.AddConstraint(
            model_name="agentprofile",
            constraint=models.UniqueConstraint(
                fields=("organization", "employee_code"),
                name="uniq_agent_employee_code_per_org",
            ),
        ),
    ]
