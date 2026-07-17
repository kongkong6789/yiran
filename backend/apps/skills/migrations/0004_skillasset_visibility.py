from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skills", "0003_skillasset_package"),
    ]

    operations = [
        migrations.AddField(
            model_name="skillasset",
            name="visibility",
            field=models.CharField(
                choices=[("shared", "全员共享"), ("private", "仅上传者")],
                db_index=True,
                default="shared",
                max_length=16,
                verbose_name="可见范围",
            ),
        ),
    ]
