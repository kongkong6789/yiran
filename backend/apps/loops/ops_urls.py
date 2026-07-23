from django.urls import path

from . import ops_views

urlpatterns = [
    path("", ops_views.ops_loops, name="ops-loops-list"),
    path("discover/", ops_views.ops_discover, name="ops-loops-discover"),
    path("from-candidate/", ops_views.ops_from_candidate, name="ops-loops-from-candidate"),
    path("<int:loop_id>/", ops_views.ops_loop_detail, name="ops-loops-detail"),
    path("<int:loop_id>/publish/", ops_views.ops_loop_publish, name="ops-loops-publish"),
    path("<int:loop_id>/pause/", ops_views.ops_loop_pause, name="ops-loops-pause"),
    path("<int:loop_id>/runs/", ops_views.ops_loop_runs, name="ops-loops-runs"),
    path("runs/<int:run_id>/", ops_views.ops_run_detail, name="ops-loops-run-detail"),
    path("runs/<int:run_id>/confirm-act/", ops_views.ops_run_confirm_act, name="ops-loops-run-confirm"),
]
