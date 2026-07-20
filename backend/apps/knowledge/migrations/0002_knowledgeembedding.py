from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("knowledge", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="KnowledgeEmbedding",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("model", models.CharField(max_length=128, verbose_name="向量模型")),
                ("dimensions", models.PositiveIntegerField(verbose_name="向量维度")),
                ("vector", models.JSONField(default=list, verbose_name="向量")),
                ("provider", models.CharField(blank=True, default="openai-compatible", max_length=64, verbose_name="向量服务")),
                ("created_at", models.DateTimeField(auto_now_add=True, verbose_name="创建时间")),
                ("updated_at", models.DateTimeField(auto_now=True, verbose_name="更新时间")),
                (
                    "chunk",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="embedding",
                        to="knowledge.knowledgechunkref",
                        verbose_name="知识切片",
                    ),
                ),
            ],
            options={
                "verbose_name": "知识切片向量",
                "verbose_name_plural": "知识切片向量",
            },
        ),
        migrations.AddIndex(
            model_name="knowledgeembedding",
            index=models.Index(fields=["model", "dimensions"], name="knowledge_k_model_b0f9b9_idx"),
        ),
    ]
