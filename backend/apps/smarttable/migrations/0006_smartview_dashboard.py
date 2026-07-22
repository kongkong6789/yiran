from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("smarttable", "0005_smartsheet_organization"),
    ]

    operations = [
        migrations.AlterField(
            model_name="smartview",
            name="view_type",
            field=models.CharField(
                choices=[
                    ("grid", "表格"),
                    ("kanban", "看板"),
                    ("form", "表单"),
                    ("dashboard", "仪表盘"),
                ],
                default="grid",
                max_length=16,
                verbose_name="类型",
            ),
        ),
    ]
