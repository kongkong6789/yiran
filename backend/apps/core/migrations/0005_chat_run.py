import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0004_user_profile"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChatRun",
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
                        verbose_name="状态",
                    ),
                ),
                ("error", models.TextField(blank=True, default="", verbose_name="错误")),
                ("cancelled_at", models.DateTimeField(blank=True, null=True, verbose_name="暂停时间")),
                ("finished_at", models.DateTimeField(blank=True, null=True, verbose_name="结束时间")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="创建时间")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新时间")),
                (
                    "cancel_message",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cancelled_run",
                        to="core.chatmessage",
                        verbose_name="暂停消息",
                    ),
                ),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="runs",
                        to="core.chatsession",
                        verbose_name="会话",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chat_runs",
                        to="auth.user",
                        verbose_name="用户",
                    ),
                ),
            ],
            options={
                "verbose_name": "对话执行",
                "verbose_name_plural": "对话执行",
                "ordering": ["-created_at"],
            },
        ),
    ]
