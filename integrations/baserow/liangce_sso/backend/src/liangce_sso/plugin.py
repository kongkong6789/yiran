from django.urls import path

from baserow.core.registries import Plugin, plugin_registry

from .views import embedded_bootstrap, exchange_ticket, login_redirect


class LiangceSsoPlugin(Plugin):
    type = "liangce_sso"

    def get_api_urls(self):
        return [
            path(
                "liangce-embedded/bootstrap/",
                embedded_bootstrap,
                name="liangce_embedded_bootstrap",
            ),
            path(
                "liangce-sso/",
                exchange_ticket,
                name="liangce_sso_exchange",
            ),
            path(
                "liangce-sso/login/",
                login_redirect,
                name="liangce_sso_login",
            ),
        ]


plugin_registry.register(LiangceSsoPlugin())
