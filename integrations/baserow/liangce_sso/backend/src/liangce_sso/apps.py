from django.apps import AppConfig


class LiangceSsoConfig(AppConfig):
    name = "liangce_sso"
    verbose_name = "Liangce Baserow SSO"

    def ready(self):
        from . import plugin  # noqa: F401
