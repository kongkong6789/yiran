from django.apps import AppConfig


class WeComConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.wecom"
    verbose_name = "企业微信配置"

    def ready(self):
        from . import signals  # noqa: F401
        from .queue_scheduler import start_wecom_queue_scheduler

        start_wecom_queue_scheduler()
