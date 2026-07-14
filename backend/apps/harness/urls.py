from django.urls import path

from . import views

urlpatterns = [
    path("check/", views.check, name="harness-check"),
    path("approvals/", views.approvals, name="harness-approvals"),
    path("approvals/<int:pk>/decide/", views.decide, name="harness-decide"),
]
