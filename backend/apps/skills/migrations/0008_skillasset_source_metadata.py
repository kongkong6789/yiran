from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("skills", "0007_skillasset_category"),
    ]

    operations = [
        migrations.AddField(
            model_name="skillasset",
            name="content_hash",
            field=models.CharField(blank=True, default="", max_length=64, verbose_name="内容指纹"),
        ),
        migrations.AddField(
            model_name="skillasset",
            name="source",
            field=models.CharField(
                choices=[("upload", "本地上传"), ("skillhub", "SkillHub")],
                db_index=True,
                default="upload",
                max_length=16,
                verbose_name="来源",
            ),
        ),
        migrations.AddField(
            model_name="skillasset",
            name="source_metadata",
            field=models.JSONField(blank=True, default=dict, verbose_name="来源元数据"),
        ),
        migrations.AddField(
            model_name="skillasset",
            name="source_url",
            field=models.URLField(blank=True, default="", max_length=1024, verbose_name="来源地址"),
        ),
        migrations.AddField(
            model_name="skillasset",
            name="source_verified",
            field=models.BooleanField(default=False, verbose_name="来源内容已验证"),
        ),
        migrations.AddField(
            model_name="skillasset",
            name="source_version",
            field=models.CharField(blank=True, default="", max_length=64, verbose_name="来源版本"),
        ),
    ]
