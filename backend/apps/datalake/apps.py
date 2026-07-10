from django.apps import AppConfig


class DatalakeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.datalake"
    verbose_name = "第1层 DuckDB 数据底座"
