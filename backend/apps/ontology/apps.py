from django.apps import AppConfig


class OntologyConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.ontology"
    verbose_name = "第5层 Ontology 业务对象层"

    def ready(self):
        from . import signals  # noqa: F401  注册图谱->PG 镜像同步信号
