from django.urls import path

from . import views

urlpatterns = [
    path("", views.connectors, name="connectors-list"),
    path("jackyun/sync/", views.jackyun_sync, name="connectors-jackyun-sync"),
    path("jackyun/status/", views.jackyun_connection_status, name="connectors-jackyun-status"),
    path("jackyun/inventory/", views.jackyun_inventory, name="connectors-jackyun-inventory"),
    path("jackyun/query/", views.jackyun_query, name="connectors-jackyun-query"),
    path("jackyun/sku-mappings/", views.jackyun_sku_mappings, name="connectors-jackyun-sku-mappings"),
    path("kingdee/status/", views.kingdee_connection_status, name="connectors-kingdee-status"),
]
