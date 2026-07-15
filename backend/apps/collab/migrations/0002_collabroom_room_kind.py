from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("collab", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="collabroom",
            name="room_kind",
            field=models.CharField(
                choices=[("dm", "单聊"), ("group", "群聊")],
                db_index=True,
                default="dm",
                max_length=16,
                verbose_name="类型",
            ),
        ),
    ]
