# Generated manually for human participants on Meeting

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0004_alter_deliverable_content"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="meeting",
            name="human_participants",
            field=models.ManyToManyField(
                blank=True,
                related_name="council_meetings",
                to=settings.AUTH_USER_MODEL,
                verbose_name="参会同事",
            ),
        ),
    ]
