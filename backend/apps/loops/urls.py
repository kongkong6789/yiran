from django.urls import path

from . import views

urlpatterns = [
    path("", views.loops, name="loops-list"),
    path("detect/", views.loop_detect, name="loops-detect"),
    path("from-candidate/", views.loop_from_candidate, name="loops-from-candidate"),
    path("causal-candidates/", views.causal_candidates, name="loops-causal-candidates"),
    path("<int:loop_id>/", views.loop_detail, name="loops-detail"),
    path("<int:loop_id>/confirm/", views.loop_confirm, name="loops-confirm"),
    path("<int:loop_id>/versions/", views.loop_versions, name="loops-versions"),
    path("<int:loop_id>/simulate/", views.loop_simulate, name="loops-simulate"),
    path("simulation-runs/<int:run_id>/", views.simulation_run_detail, name="simulation-run-detail"),
]
