import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("collab", "0012_alter_collabmessage_updated_at"),
    ]

    operations = [
        migrations.AddField(
            model_name="collabmessage",
            name="meta",
            field=models.JSONField(blank=True, default=dict, verbose_name="元数据"),
        ),
        migrations.AlterField(
            model_name="collabmessage",
            name="ai_kind",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "无"),
                    ("reply", "应答"),
                    ("interject", "插嘴"),
                    ("suggest", "建议"),
                    ("xiaoce", "小策bot"),
                ],
                db_index=True,
                default="",
                max_length=16,
                verbose_name="AI角色",
            ),
        ),
        migrations.CreateModel(
            name="XiaoceRun",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("running", "运行中"),
                            ("cancelled", "已暂停"),
                            ("completed", "已完成"),
                            ("failed", "失败"),
                        ],
                        db_index=True,
                        default="running",
                        max_length=16,
                    ),
                ),
                ("error", models.TextField(blank=True, default="")),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                ("finished_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "cancel_message",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cancelled_xiaoce_run",
                        to="collab.collabmessage",
                    ),
                ),
                (
                    "room",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="xiaoce_runs",
                        to="collab.collabroom",
                    ),
                ),
                (
                    "trigger_message",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="xiaoce_run",
                        to="collab.collabmessage",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="xiaoce_runs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddConstraint(
            model_name="xiaocerun",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status", "running")),
                fields=("room", "user"),
                name="uniq_running_xiaoce_per_user_room",
            ),
        ),
    ]
