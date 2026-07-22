from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("smarttable", "0008_smartsheet_knowledge_base_id"),
    ]

    operations = [
        migrations.AlterField(
            model_name="smartsheet",
            name="knowledge_base_id",
            field=models.PositiveIntegerField(
                blank=True,
                db_index=True,
                help_text="跨库软关联 knowledge.KnowledgeBase.id（knowledge 与 default 分库，不能用外键）",
                null=True,
                verbose_name="所属知识库ID",
            ),
        ),
    ]
