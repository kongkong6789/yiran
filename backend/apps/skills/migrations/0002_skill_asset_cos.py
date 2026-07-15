from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("skills", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="userskill",
            name="raw_content",
            field=models.TextField(blank=True, default="", verbose_name="原始 SKILL.md"),
        ),
        migrations.AlterField(
            model_name="userskill",
            name="instructions",
            field=models.TextField(blank=True, default="", verbose_name="指令正文(不含 frontmatter)"),
        ),
        migrations.CreateModel(
            name="SkillAsset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("skill_id", models.CharField(db_index=True, max_length=64, verbose_name="Skill ID")),
                ("name", models.CharField(max_length=128, verbose_name="名称")),
                ("description", models.TextField(blank=True, default="", verbose_name="描述")),
                ("original_filename", models.CharField(default="SKILL.md", max_length=255, verbose_name="原始文件名")),
                ("cos_bucket", models.CharField(max_length=128, verbose_name="COS 桶")),
                ("cos_key", models.CharField(max_length=512, verbose_name="COS Key")),
                ("cos_url", models.URLField(max_length=1024, verbose_name="COS URL")),
                ("file_size", models.PositiveIntegerField(default=0, verbose_name="文件大小")),
                ("instructions_preview", models.TextField(blank=True, default="", verbose_name="指令预览")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="创建时间")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新时间")),
                (
                    "uploader",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="skill_assets",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="上传者",
                    ),
                ),
            ],
            options={
                "verbose_name": "Skill 仓库",
                "verbose_name_plural": "Skill 仓库",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.AddField(
            model_name="userskill",
            name="source_asset",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="adoptions",
                to="skills.skillasset",
                verbose_name="来源仓库",
            ),
        ),
        migrations.AddConstraint(
            model_name="skillasset",
            constraint=models.UniqueConstraint(fields=("uploader", "skill_id"), name="uniq_uploader_skill_asset"),
        ),
    ]
