from django.urls import path

from . import evolution_api, sop_api, sop_trial, views

urlpatterns = [
    path("run/", views.run, name="orchestration-run"),
    path("catalog/", views.actions_catalog, name="orchestration-catalog"),
    path("resume/", views.resume, name="orchestration-resume"),
    path("sops/ai/rewrite/", sop_api.sop_ai_rewrite, name="orchestration-sop-ai-rewrite"),
    path("sops/", sop_api.sops, name="orchestration-sops"),
    path("runs/<str:run_key>/", evolution_api.sop_run_detail, name="orchestration-sop-run-detail"),
    path("sops/<str:sop_key>/", sop_api.sop_detail, name="orchestration-sop-detail"),
    path("sops/<str:sop_key>/duplicate/", sop_api.sop_duplicate, name="orchestration-sop-duplicate"),
    path("sops/<str:sop_key>/runs/", evolution_api.sop_runs, name="orchestration-sop-runs"),
    path("sops/<str:sop_key>/evolution/signals/", evolution_api.sop_evolution_signals, name="orchestration-sop-evolution-signals"),
    path("sops/<str:sop_key>/evolution/proposals/", evolution_api.sop_evolution_proposals, name="orchestration-sop-evolution-proposals"),
    path("sops/<str:sop_key>/evolution/proposals/<int:proposal_id>/", evolution_api.sop_evolution_proposal_detail, name="orchestration-sop-evolution-proposal-detail"),
    path("sops/<str:sop_key>/evolution/proposals/<int:proposal_id>/trial/", evolution_api.sop_evolution_proposal_trial, name="orchestration-sop-evolution-proposal-trial"),
    path("sops/<str:sop_key>/evolution/proposals/<int:proposal_id>/draft/", evolution_api.sop_evolution_proposal_draft, name="orchestration-sop-evolution-proposal-draft"),
    path("sops/<str:sop_key>/evolution/proposals/<int:proposal_id>/accept/", evolution_api.sop_evolution_proposal_accept, name="orchestration-sop-evolution-proposal-accept"),
    path("sops/<str:sop_key>/evolution/proposals/<int:proposal_id>/reject/", evolution_api.sop_evolution_proposal_reject, name="orchestration-sop-evolution-proposal-reject"),
    path("sops/<str:sop_key>/versions/", sop_api.sop_versions, name="orchestration-sop-versions"),
    path("sops/<str:sop_key>/versions/<str:version>/", sop_api.sop_version_detail, name="orchestration-sop-version-detail"),
    path("sops/<str:sop_key>/versions/<str:version>/trial/", sop_trial.sop_version_trial, name="orchestration-sop-version-trial"),
    path("sops/<str:sop_key>/versions/<str:version>/trial/stream/", sop_trial.sop_version_trial_stream, name="orchestration-sop-version-trial-stream"),
    path("sops/<str:sop_key>/versions/<str:version>/publish/", sop_api.sop_publish, name="orchestration-sop-publish"),
]
