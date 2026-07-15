from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("skills", "0002_skill_asset_cos"),
    ]

    operations = [
        migrations.AddField(
            model_name="skillasset",
            name="package_kind",
            field=models.CharField(
                choices=[("single", "单文件"), ("package", "完整包")],
                default="single",
                max_length=16,
                verbose_name="包类型",
            ),
        ),
        migrations.AddField(
            model_name="skillasset",
            name="package_manifest",
            field=models.JSONField(blank=True, default=list, verbose_name="包文件清单"),
        ),
        migrations.AddField(
            model_name="skillasset",
            name="skill_md_key",
            field=models.CharField(blank=True, default="", max_length=512, verbose_name="SKILL.md COS Key"),
        ),
    ]
