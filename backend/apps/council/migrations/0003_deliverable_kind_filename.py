from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("council", "0002_agentprofile_group"),
    ]

    operations = [
        migrations.AddField(
            model_name="deliverable",
            name="kind",
            field=models.CharField(
                choices=[("md", "Markdown 方案"), ("html", "HTML 分析报告"), ("xlsx", "Excel 指标")],
                default="md",
                max_length=16,
                verbose_name="类型",
            ),
        ),
        migrations.AddField(
            model_name="deliverable",
            name="filename",
            field=models.CharField(blank=True, default="", max_length=255, verbose_name="文件名"),
        ),
    ]
