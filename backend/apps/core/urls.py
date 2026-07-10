from django.urls import path

from . import views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("architecture/", views.architecture, name="architecture"),
    path("audit-logs/", views.audit_logs, name="audit-logs"),
]
