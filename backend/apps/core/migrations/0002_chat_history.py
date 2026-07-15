from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="ChatSession",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(default="新对话", max_length=120, verbose_name="标题")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="创建时间")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新时间")),
            ],
            options={
                "verbose_name": "Agent 对话",
                "verbose_name_plural": "Agent 对话",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.CreateModel(
            name="ChatMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(max_length=16, verbose_name="角色")),
                ("content", models.TextField(verbose_name="内容")),
                ("meta", models.JSONField(blank=True, default=dict, verbose_name="元数据")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="创建时间")),
                (
                    "session",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="messages",
                        to="core.chatsession",
                    ),
                ),
            ],
            options={
                "verbose_name": "Agent 消息",
                "verbose_name_plural": "Agent 消息",
                "ordering": ["created_at", "id"],
            },
        ),
    ]
