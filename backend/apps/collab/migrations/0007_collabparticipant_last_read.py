from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("collab", "0006_collabparticipant_nickname"),
    ]

    operations = [
        migrations.AddField(
            model_name="collabparticipant",
            name="last_read_message_id",
            field=models.BigIntegerField(db_index=True, default=0, verbose_name="已读到消息ID"),
        ),
    ]
