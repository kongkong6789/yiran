from django.urls import path

from . import views

urlpatterns = [
    path("servers/", views.servers, name="mcp-servers"),
    path("servers/<str:server_id>/", views.server_detail, name="mcp-server-detail"),
    path("servers/<str:server_id>/config/", views.server_config, name="mcp-server-config"),
    path("servers/<str:server_id>/probe/", views.server_probe, name="mcp-server-probe"),
    path("servers/<str:server_id>/import/", views.server_import, name="mcp-server-import"),
]
