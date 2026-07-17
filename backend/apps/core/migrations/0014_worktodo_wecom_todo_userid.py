from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0013_worktodo_recipient_sources"),
    ]

    operations = [
        migrations.AddField(
            model_name="worktodo",
            name="wecom_todo_userid_encrypted",
            field=models.TextField(blank=True, default=""),
        ),
    ]
