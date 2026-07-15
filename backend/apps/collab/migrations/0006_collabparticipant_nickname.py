from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("collab", "0005_collabmessage_mentions"),
    ]

    operations = [
        migrations.AddField(
            model_name="collabparticipant",
            name="nickname",
            field=models.CharField(blank=True, default="", max_length=64, verbose_name="群内名称"),
        ),
    ]
