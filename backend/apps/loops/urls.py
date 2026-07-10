from django.urls import path

from . import views

urlpatterns = [
    path("", views.loops, name="loops-list"),
    path("detect/", views.loop_detect, name="loops-detect"),
    path("from-candidate/", views.loop_from_candidate, name="loops-from-candidate"),
    path("causal-candidates/", views.causal_candidates, name="loops-causal-candidates"),
    path("<int:loop_id>/", views.loop_detail, name="loops-detail"),
    path("<int:loop_id>/confirm/", views.loop_confirm, name="loops-confirm"),
]
