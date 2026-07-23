from django.apps import AppConfig


class OrchestrationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.orchestration"
    verbose_name = "第4层 LangGraph SOP 编排层"

    def ready(self):
        # Autostart SOP evolution analyzer with the web process.
        try:
            from .evolution_scheduler import start_evolution_scheduler

            start_evolution_scheduler()
        except Exception:
            # Never block app boot on scheduler failures.
            import logging

            logging.getLogger(__name__).exception("Failed to autostart SOP evolution scheduler")
