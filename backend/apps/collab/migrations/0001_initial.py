# Generated manually for collab app
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CollabRoom",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(default="协作会话", max_length=120, verbose_name="标题")),
                ("status", models.CharField(choices=[("open", "进行中"), ("closed", "已结束")], db_index=True, default="open", max_length=16, verbose_name="状态")),
                ("risk_level", models.CharField(choices=[("green", "正常"), ("yellow", "注意"), ("red", "高风险")], db_index=True, default="green", max_length=16, verbose_name="当前风险")),
                ("summary", models.TextField(blank=True, default="", verbose_name="会话摘要")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="collab_rooms_created", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "协作会话",
                "verbose_name_plural": "协作会话",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.CreateModel(
            name="CollabInsight",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("risk_level", models.CharField(choices=[("green", "正常"), ("yellow", "注意"), ("red", "高风险")], default="green", max_length=16, verbose_name="风险等级")),
                ("title", models.CharField(max_length=200, verbose_name="标题")),
                ("analysis", models.TextField(blank=True, default="", verbose_name="异常分析")),
                ("advice", models.TextField(blank=True, default="", verbose_name="建议")),
                ("control", models.TextField(blank=True, default="", verbose_name="风险管控")),
                ("tags", models.JSONField(blank=True, default=list, verbose_name="标签")),
                ("evidence_message_ids", models.JSONField(blank=True, default=list, verbose_name="证据消息 ID")),
                ("draft_reply", models.TextField(blank=True, default="", verbose_name="合规回复草稿")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("room", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="insights", to="collab.collabroom")),
            ],
            options={
                "verbose_name": "协作洞察",
                "verbose_name_plural": "协作洞察",
                "ordering": ["-id"],
            },
        ),
        migrations.CreateModel(
            name="CollabMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("content", models.TextField(verbose_name="内容")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("room", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="collab.collabroom")),
                ("sender", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="collab_messages", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "协作消息",
                "verbose_name_plural": "协作消息",
                "ordering": ["id"],
            },
        ),
        migrations.CreateModel(
            name="CollabParticipant",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("joined_at", models.DateTimeField(auto_now_add=True)),
                ("room", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="participants", to="collab.collabroom")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="collab_participations", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "协作参与者",
                "verbose_name_plural": "协作参与者",
            },
        ),
        migrations.AddConstraint(
            model_name="collabparticipant",
            constraint=models.UniqueConstraint(fields=("room", "user"), name="uniq_collab_room_user"),
        ),
    ]
