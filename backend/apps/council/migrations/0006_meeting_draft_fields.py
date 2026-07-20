# Generated manually for draft/lobby meeting fields

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0005_meeting_human_participants"),
    ]

    operations = [
        migrations.AddField(
            model_name="meeting",
            name="intro",
            field=models.TextField(blank=True, default="", verbose_name="会议简介"),
        ),
        migrations.AddField(
            model_name="meeting",
            name="scheduled_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="计划开始时间"),
        ),
        migrations.AddField(
            model_name="meeting",
            name="duration_minutes",
            field=models.PositiveIntegerField(default=60, verbose_name="预计时长(分钟)"),
        ),
        migrations.AddField(
            model_name="meeting",
            name="started_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="实际开始时间"),
        ),
        migrations.AlterField(
            model_name="meeting",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "草稿/待开始"),
                    ("active", "进行中"),
                    ("paused", "已暂停"),
                    ("stopped", "已结束"),
                ],
                default="draft",
                max_length=16,
                verbose_name="状态",
            ),
        ),
    ]
