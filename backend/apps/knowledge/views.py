from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    KnowledgeAuditLog,
    KnowledgeBase,
    KnowledgeChunkRef,
    KnowledgeFile,
    KnowledgeIngestJob,
    KnowledgePermission,
    KnowledgeSourceBinding,
    KnowledgeTemplate,
)
from .serializers import (
    KnowledgeAuditLogSerializer,
    KnowledgeBaseSerializer,
    KnowledgeChunkRefSerializer,
    KnowledgeFileSerializer,
    KnowledgeIngestJobSerializer,
    KnowledgePermissionSerializer,
    KnowledgeSourceBindingSerializer,
    KnowledgeTemplateSerializer,
)


def _log(user, knowledge_base, action: str, target_type: str = "", target_id: str = "", payload: dict | None = None):
    KnowledgeAuditLog.objects.create(
        actor=user if getattr(user, "is_authenticated", False) else None,
        knowledge_base=knowledge_base,
        action=action,
        target_type=target_type,
        target_id=str(target_id or ""),
        payload=payload or {},
    )


class KnowledgeTemplateViewSet(viewsets.ModelViewSet):
    queryset = KnowledgeTemplate.objects.all()
    serializer_class = KnowledgeTemplateSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "template_id"


class KnowledgeBaseViewSet(viewsets.ModelViewSet):
    serializer_class = KnowledgeBaseSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = KnowledgeBase.objects.select_related("template", "owner").filter(archived_at__isnull=True)
        query = (self.request.query_params.get("q") or "").strip()
        category = (self.request.query_params.get("category") or "").strip()
        visibility = (self.request.query_params.get("visibility") or "").strip()
        if query:
            qs = qs.filter(Q(name__icontains=query) | Q(description__icontains=query) | Q(category__icontains=query))
        if category and category != "全部":
            qs = qs.filter(category=category)
        if visibility:
            qs = qs.filter(visibility=visibility)
        return qs

    def perform_create(self, serializer):
        kb = serializer.save(owner=self.request.user if self.request.user.is_authenticated else None)
        _log(self.request.user, kb, "knowledge_base.created", "knowledge_base", kb.id)

    def perform_update(self, serializer):
        kb = serializer.save()
        _log(self.request.user, kb, "knowledge_base.updated", "knowledge_base", kb.id)

    def destroy(self, request, *args, **kwargs):
        kb = self.get_object()
        kb.status = KnowledgeBase.Status.ARCHIVED
        kb.archived_at = timezone.now()
        kb.save(update_fields=["status", "archived_at", "updated_at"])
        _log(request.user, kb, "knowledge_base.archived", "knowledge_base", kb.id)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def files(self, request, pk=None):
        kb = self.get_object()
        rows = kb.files.filter(archived_at__isnull=True)
        query = (request.query_params.get("q") or "").strip()
        file_type = (request.query_params.get("file_type") or "").strip()
        if query:
            rows = rows.filter(Q(original_filename__icontains=query) | Q(file_type__icontains=query))
        if file_type and file_type != "全部":
            rows = rows.filter(file_type=file_type)
        return Response({
            "knowledge_base": KnowledgeBaseSerializer(kb).data,
            "count": rows.count(),
            "results": KnowledgeFileSerializer(rows, many=True).data,
        })


class KnowledgeFileViewSet(viewsets.ModelViewSet):
    serializer_class = KnowledgeFileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = KnowledgeFile.objects.select_related("knowledge_base", "uploaded_by").filter(archived_at__isnull=True)
        kb_id = self.request.query_params.get("knowledge_base")
        if kb_id:
            qs = qs.filter(knowledge_base_id=kb_id)
        return qs

    def perform_create(self, serializer):
        file = serializer.save(uploaded_by=self.request.user if self.request.user.is_authenticated else None)
        KnowledgeBase.objects.filter(id=file.knowledge_base_id).update(file_count=file.knowledge_base.files.filter(archived_at__isnull=True).count())
        _log(self.request.user, file.knowledge_base, "file.created", "knowledge_file", file.id, {"filename": file.original_filename})

    def destroy(self, request, *args, **kwargs):
        file = self.get_object()
        file.status = KnowledgeFile.Status.ARCHIVED
        file.archived_at = timezone.now()
        file.save(update_fields=["status", "archived_at", "updated_at"])
        KnowledgeBase.objects.filter(id=file.knowledge_base_id).update(file_count=file.knowledge_base.files.filter(archived_at__isnull=True).count())
        _log(request.user, file.knowledge_base, "file.archived", "knowledge_file", file.id, {"filename": file.original_filename})
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def chunks(self, request, pk=None):
        file = self.get_object()
        rows = file.chunk_refs.all()
        return Response({
            "file": KnowledgeFileSerializer(file).data,
            "count": rows.count(),
            "results": KnowledgeChunkRefSerializer(rows, many=True).data,
        })

    @action(detail=True, methods=["post"])
    def start_ingest(self, request, pk=None):
        file = self.get_object()
        job = KnowledgeIngestJob.objects.create(
            file=file,
            status=KnowledgeIngestJob.Status.PENDING,
            stage="pending",
            progress=0,
            created_by=request.user if request.user.is_authenticated else None,
        )
        file.status = KnowledgeFile.Status.PROCESSING
        file.save(update_fields=["status", "updated_at"])
        _log(request.user, file.knowledge_base, "file.ingest_started", "knowledge_file", file.id, {"job_id": job.id})
        return Response(KnowledgeIngestJobSerializer(job).data, status=status.HTTP_201_CREATED)


class KnowledgeIngestJobViewSet(viewsets.ModelViewSet):
    queryset = KnowledgeIngestJob.objects.select_related("file", "created_by").all()
    serializer_class = KnowledgeIngestJobSerializer
    permission_classes = [IsAuthenticated]


class KnowledgeChunkRefViewSet(viewsets.ModelViewSet):
    queryset = KnowledgeChunkRef.objects.select_related("file").all()
    serializer_class = KnowledgeChunkRefSerializer
    permission_classes = [IsAuthenticated]


class KnowledgeSourceBindingViewSet(viewsets.ModelViewSet):
    queryset = KnowledgeSourceBinding.objects.select_related("knowledge_base").all()
    serializer_class = KnowledgeSourceBindingSerializer
    permission_classes = [IsAuthenticated]


class KnowledgePermissionViewSet(viewsets.ModelViewSet):
    queryset = KnowledgePermission.objects.select_related("knowledge_base").all()
    serializer_class = KnowledgePermissionSerializer
    permission_classes = [IsAuthenticated]


class KnowledgeAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = KnowledgeAuditLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = KnowledgeAuditLog.objects.select_related("knowledge_base", "actor").all()
        kb_id = self.request.query_params.get("knowledge_base")
        if kb_id:
            qs = qs.filter(knowledge_base_id=kb_id)
        return qs
