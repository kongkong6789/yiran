from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("ontology", "0002_ontrelation_causal_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="FeedbackLoop",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(blank=True, default="", max_length=32, verbose_name="编号")),
                ("name", models.CharField(max_length=128, verbose_name="名称")),
                (
                    "loop_type",
                    models.CharField(
                        choices=[("R", "增强回路"), ("B", "调节回路"), ("comp", "复合回路")],
                        default="R",
                        max_length=8,
                        verbose_name="类型",
                    ),
                ),
                ("description", models.TextField(blank=True, default="", verbose_name="描述")),
                ("confidence", models.PositiveSmallIntegerField(default=0, verbose_name="置信度")),
                (
                    "status",
                    models.CharField(
                        choices=[("candidate", "候选"), ("confirmed", "已确认"), ("archived", "已归档")],
                        default="candidate",
                        max_length=16,
                        verbose_name="状态",
                    ),
                ),
                ("confirmed_by", models.CharField(blank=True, default="", max_length=64, verbose_name="确认人")),
                ("confirmed_at", models.DateTimeField(blank=True, null=True, verbose_name="确认时间")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="创建时间")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新时间")),
            ],
            options={
                "verbose_name": "反馈回路",
                "verbose_name_plural": "反馈回路",
                "ordering": ["-updated_at", "-id"],
            },
        ),
        migrations.CreateModel(
            name="LoopMember",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("sequence", models.PositiveIntegerField(default=0, verbose_name="顺序")),
                ("note", models.CharField(blank=True, default="", max_length=256, verbose_name="备注")),
                (
                    "loop",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="members",
                        to="loops.feedbackloop",
                        verbose_name="回路",
                    ),
                ),
                (
                    "relation",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="loop_memberships",
                        to="ontology.ontrelation",
                        verbose_name="因果链",
                    ),
                ),
            ],
            options={
                "verbose_name": "回路成员",
                "verbose_name_plural": "回路成员",
                "ordering": ["sequence", "id"],
            },
        ),
        migrations.AddConstraint(
            model_name="loopmember",
            constraint=models.UniqueConstraint(fields=("loop", "relation"), name="uniq_loop_relation"),
        ),
    ]
