from rest_framework.routers import DefaultRouter

from .views import (
    KnowledgeAuditLogViewSet,
    KnowledgeBaseViewSet,
    KnowledgeChunkRefViewSet,
    KnowledgeFileViewSet,
    KnowledgeIngestJobViewSet,
    KnowledgePermissionViewSet,
    KnowledgeSourceBindingViewSet,
    KnowledgeTemplateViewSet,
    TraditionalRagSearchViewSet,
)

router = DefaultRouter()
router.register("templates", KnowledgeTemplateViewSet, basename="knowledge-template")
router.register("bases", KnowledgeBaseViewSet, basename="knowledge-base")
router.register("files", KnowledgeFileViewSet, basename="knowledge-file")
router.register("jobs", KnowledgeIngestJobViewSet, basename="knowledge-job")
router.register("chunks", KnowledgeChunkRefViewSet, basename="knowledge-chunk")
router.register("bindings", KnowledgeSourceBindingViewSet, basename="knowledge-binding")
router.register("permissions", KnowledgePermissionViewSet, basename="knowledge-permission")
router.register("audit-logs", KnowledgeAuditLogViewSet, basename="knowledge-audit-log")
router.register("traditional-search", TraditionalRagSearchViewSet, basename="knowledge-traditional-search")

urlpatterns = router.urls
