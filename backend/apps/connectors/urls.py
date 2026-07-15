from django.urls import path

from . import views

urlpatterns = [
    path("", views.connectors, name="connectors-list"),
    path("jackyun/sync/", views.jackyun_sync, name="connectors-jackyun-sync"),
]
