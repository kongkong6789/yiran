import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi_app = get_asgi_application()

from apps.collab.routing import websocket_urlpatterns as collab_ws  # noqa: E402
from apps.council.routing import websocket_urlpatterns as council_ws  # noqa: E402
from apps.council.ws_auth import TokenAuthMiddlewareStack  # noqa: E402

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": TokenAuthMiddlewareStack(URLRouter([
        *council_ws,
        *collab_ws,
    ])),
})
