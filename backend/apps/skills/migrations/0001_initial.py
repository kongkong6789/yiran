from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="UserSkill",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("skill_id", models.CharField(db_index=True, max_length=64, verbose_name="Skill ID")),
                ("name", models.CharField(max_length=128, verbose_name="名称")),
                ("description", models.TextField(blank=True, default="", verbose_name="描述")),
                ("raw_content", models.TextField(verbose_name="原始 SKILL.md")),
                ("instructions", models.TextField(verbose_name="指令正文(不含 frontmatter)")),
                ("enabled", models.BooleanField(default=True, verbose_name="启用")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="创建时间")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新时间")),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="skills",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="用户",
                    ),
                ),
            ],
            options={
                "verbose_name": "用户 Skill",
                "verbose_name_plural": "用户 Skill",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.AddConstraint(
            model_name="userskill",
            constraint=models.UniqueConstraint(fields=("user", "skill_id"), name="uniq_user_skill"),
        ),
    ]
