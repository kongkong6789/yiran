# Generated manually for MeetingInvite

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("council", "0006_meeting_draft_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="MeetingInvite",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("status", models.CharField(choices=[("pending", "待处理"), ("seen", "已查看"), ("joined", "已进入"), ("dismissed", "稍后再说")], default="pending", max_length=16)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("invited_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="council_invites_sent", to=settings.AUTH_USER_MODEL)),
                ("meeting", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="invites", to="council.meeting")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="council_invites", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "会议邀请",
                "verbose_name_plural": "会议邀请",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="meetinginvite",
            index=models.Index(fields=["user", "status", "-created_at"], name="council_mee_user_id_7f9a1c_idx"),
        ),
        migrations.AddConstraint(
            model_name="meetinginvite",
            constraint=models.UniqueConstraint(fields=("meeting", "user"), name="uniq_council_invite_meeting_user"),
        ),
    ]
