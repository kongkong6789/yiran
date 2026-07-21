from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("smarttable", "0007_smartsheet_knowledge_base"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="smartsheet",
            name="knowledge_base",
        ),
        migrations.AddField(
            model_name="smartsheet",
            name="knowledge_base_id",
            field=models.PositiveIntegerField(
                blank=True,
                db_index=True,
                help_text="跨库软关联 knowledge.KnowledgeBase.id（knowledge 库与账号库分离）",
                null=True,
                verbose_name="所属知识库ID",
            ),
        ),
    ]
