from django.urls import path

from . import views

urlpatterns = [
    path("run/", views.run, name="orchestration-run"),
    path("catalog/", views.actions_catalog, name="orchestration-catalog"),
    path("resume/", views.resume, name="orchestration-resume"),
]
