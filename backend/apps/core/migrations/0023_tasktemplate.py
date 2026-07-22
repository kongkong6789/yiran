import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0022_platform_team_creator_membership"),
    ]

    operations = [
        migrations.CreateModel(
            name="TaskTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("template_key", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("name", models.CharField(max_length=128)),
                ("description", models.CharField(blank=True, default="", max_length=300)),
                ("category", models.CharField(choices=[("report", "经营报告"), ("operation", "日常运营"), ("analysis", "数据分析"), ("collab", "协作跟进")], db_index=True, default="report", max_length=20)),
                ("action_name", models.CharField(db_index=True, max_length=96)),
                ("prompt", models.TextField()),
                ("defaults", models.JSONField(blank=True, default=dict)),
                ("output_config", models.JSONField(blank=True, default=dict)),
                ("assignment_config", models.JSONField(blank=True, default=dict)),
                ("tags", models.JSONField(blank=True, default=list)),
                ("estimated_minutes", models.PositiveSmallIntegerField(default=10)),
                ("visibility", models.CharField(choices=[("personal", "仅自己"), ("workspace", "当前工作空间")], db_index=True, default="personal", max_length=16)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="created_task_templates", to=settings.AUTH_USER_MODEL)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="task_templates", to="core.organization")),
                ("updated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="updated_task_templates", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["category", "name", "id"]},
        ),
        migrations.AddIndex(
            model_name="tasktemplate",
            index=models.Index(fields=["organization", "visibility", "is_active"], name="core_tasktpl_scope_idx"),
        ),
    ]
