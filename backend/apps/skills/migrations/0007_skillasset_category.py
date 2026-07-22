from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skills", "0006_alter_skillasset_visibility"),
    ]

    operations = [
        migrations.AddField(
            model_name="skillasset",
            name="category",
            field=models.CharField(
                choices=[
                    ("business", "经营运营"),
                    ("analysis", "数据分析"),
                    ("content", "内容生产"),
                    ("automation", "自动化工具"),
                    ("general", "通用能力"),
                ],
                db_index=True,
                default="general",
                max_length=16,
                verbose_name="能力分类",
            ),
        ),
    ]
