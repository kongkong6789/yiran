import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0019_team_teammembership"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="WorkAutomation",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=128)),
                ("trigger_type", models.CharField(choices=[("schedule", "定时触发"), ("data", "数据变化"), ("manual", "手动触发")], default="schedule", max_length=16)),
                ("trigger_rule", models.CharField(max_length=255)),
                ("action", models.TextField()),
                ("notification_channel", models.CharField(choices=[("none", "不通知"), ("in_app", "站内通知"), ("wecom", "企业微信")], default="none", max_length=16)),
                ("recipient_contact_ids", models.JSONField(blank=True, default=list)),
                ("enabled", models.BooleanField(db_index=True, default=False)),
                ("last_tested_at", models.DateTimeField(blank=True, null=True)),
                ("last_test_status", models.CharField(blank=True, default="", max_length=20)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("creator", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="work_automations", to=settings.AUTH_USER_MODEL)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="work_automations", to="core.organization")),
            ],
            options={
                "ordering": ["-updated_at", "-id"],
                "indexes": [models.Index(fields=["organization", "creator", "enabled"], name="automation_org_user_on")],
            },
        ),
    ]
