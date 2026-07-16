"""根路由:各层 App 的 API 挂载在 /api/ 下。"""
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.core.urls")),
    path("api/datalake/", include("apps.datalake.urls")),
    path("api/rag/", include("apps.rag.urls")),
    path("api/wiki/", include("apps.wiki.urls")),
    path("api/ontology/", include("apps.ontology.urls")),
    path("api/loops/", include("apps.loops.urls")),
    path("api/harness/", include("apps.harness.urls")),
    path("api/orchestration/", include("apps.orchestration.urls")),
    path("api/connectors/", include("apps.connectors.urls")),
    path("api/council/", include("apps.council.urls")),
    path("api/mcp/", include("apps.mcp.urls")),
    path("api/skills/", include("apps.skills.urls")),
    path("api/collab/", include("apps.collab.urls")),
    path("api/commerce/", include("apps.commerce.urls")),
    path("api/wecom/", include("apps.wecom.urls")),
]
