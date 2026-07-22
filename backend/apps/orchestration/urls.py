from django.urls import path

from . import sop_api, views

urlpatterns = [
    path("run/", views.run, name="orchestration-run"),
    path("catalog/", views.actions_catalog, name="orchestration-catalog"),
    path("resume/", views.resume, name="orchestration-resume"),
    path("sops/ai/rewrite/", sop_api.sop_ai_rewrite, name="orchestration-sop-ai-rewrite"),
    path("sops/", sop_api.sops, name="orchestration-sops"),
    path("sops/<str:sop_key>/", sop_api.sop_detail, name="orchestration-sop-detail"),
    path("sops/<str:sop_key>/duplicate/", sop_api.sop_duplicate, name="orchestration-sop-duplicate"),
    path("sops/<str:sop_key>/versions/", sop_api.sop_versions, name="orchestration-sop-versions"),
    path("sops/<str:sop_key>/versions/<str:version>/", sop_api.sop_version_detail, name="orchestration-sop-version-detail"),
    path("sops/<str:sop_key>/versions/<str:version>/publish/", sop_api.sop_publish, name="orchestration-sop-publish"),
]
