from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("collab", "0003_collabpresence"),
    ]

    operations = [
        migrations.AddField(
            model_name="collabmessage",
            name="attachments",
            field=models.JSONField(blank=True, default=list, verbose_name="附件"),
        ),
        migrations.AlterField(
            model_name="collabmessage",
            name="content",
            field=models.TextField(blank=True, default="", verbose_name="内容"),
        ),
    ]
