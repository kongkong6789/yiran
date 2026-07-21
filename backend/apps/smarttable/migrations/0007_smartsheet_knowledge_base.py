from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("knowledge", "0003_owner_user_id"),
        ("smarttable", "0006_smartview_dashboard"),
    ]

    operations = [
        migrations.AddField(
            model_name="smartsheet",
            name="knowledge_base",
            field=models.ForeignKey(
                blank=True,
                db_index=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="smart_sheets",
                to="knowledge.knowledgebase",
                verbose_name="所属知识库",
            ),
        ),
    ]
