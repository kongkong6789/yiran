from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
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
from .traditional_rag import TraditionalRagError, enqueue_ingest_upload, keyword_search, semantic_search


def _log(user, knowledge_base, action: str, target_type: str = "", target_id: str = "", payload: dict | None = None):
    KnowledgeAuditLog.objects.create(
        actor=None,
        knowledge_base=knowledge_base,
        action=action,
        target_type=target_type,
        target_id=str(target_id or ""),
        payload=payload or {},
    )


def _visible_knowledge_bases(user):
    qs = KnowledgeBase.objects.filter(archived_at__isnull=True)
    if not getattr(user, "is_authenticated", False):
        return qs.none()
    return qs.filter(
        Q(visibility__in=[KnowledgeBase.Visibility.TEAM, KnowledgeBase.Visibility.COMPANY])
        | Q(visibility=KnowledgeBase.Visibility.PRIVATE, owner_user_id=user.id)
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
        user = self.request.user
        qs = KnowledgeBase.objects.select_related("template").filter(archived_at__isnull=True)
        if getattr(user, "is_authenticated", False):
            qs = qs.filter(
                Q(visibility__in=[KnowledgeBase.Visibility.TEAM, KnowledgeBase.Visibility.COMPANY])
                | Q(visibility=KnowledgeBase.Visibility.PRIVATE, owner_user_id=user.id)
            )
        else:
            qs = qs.none()
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
        user = self.request.user
        kb = serializer.save(owner_user_id=user.id if getattr(user, "is_authenticated", False) else None)
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

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload(self, request, pk=None):
        kb = self.get_object()
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            chunk_size = request.data.get("chunk_size")
            chunk_overlap = request.data.get("chunk_overlap")
            result = enqueue_ingest_upload(
                knowledge_base=kb,
                upload=upload,
                user=None,
                segment_mode=request.data.get("segment_mode") or "general",
                chunk_size=int(chunk_size) if chunk_size not in (None, "") else None,
                chunk_overlap=int(chunk_overlap) if chunk_overlap not in (None, "") else None,
            )
        except TraditionalRagError as error:
            return Response({"error": error.code, "message": error.message}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError:
            return Response(
                {"error": "invalid_input", "message": "chunk_size and chunk_overlap must be integers"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        _log(
            request.user,
            result.file.knowledge_base,
            "file.traditional_rag_queued",
            "knowledge_file",
            result.file.id,
            {"filename": result.file.original_filename, "job_id": result.job.id},
        )
        return Response(
            {
                "file": KnowledgeFileSerializer(result.file).data,
                "job": KnowledgeIngestJobSerializer(result.job).data,
                "chunk_count": len(result.chunks),
                "job_id": result.job.id,
                "chunks_preview": KnowledgeChunkRefSerializer(result.chunks[:20], many=True).data,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=["get"], url_path="traditional-search")
    def traditional_search(self, request, pk=None):
        kb = self.get_object()
        query = (request.query_params.get("q") or "").strip()
        try:
            limit = int(request.query_params.get("limit") or 10)
            mode = (request.query_params.get("mode") or "keyword").strip().lower()
            if mode == "semantic":
                rows = semantic_search(query=query, knowledge_base_id=kb.id, limit=limit)
            else:
                rows = keyword_search(query=query, knowledge_base_id=kb.id, limit=limit)
        except TraditionalRagError as error:
            return Response({"error": error.code, "message": error.message}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError:
            return Response({"error": "invalid_input", "message": "limit must be a valid integer"}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            "knowledge_base": KnowledgeBaseSerializer(kb).data,
            "query": query,
            "count": len(rows),
            "results": KnowledgeChunkRefSerializer(rows, many=True).data,
        })


class KnowledgeFileViewSet(viewsets.ModelViewSet):
    serializer_class = KnowledgeFileSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        visible_bases = _visible_knowledge_bases(self.request.user)
        qs = KnowledgeFile.objects.select_related("knowledge_base").filter(
            archived_at__isnull=True,
            knowledge_base__in=visible_bases,
        )
        kb_id = self.request.query_params.get("knowledge_base")
        if kb_id:
            qs = qs.filter(knowledge_base_id=kb_id)
        return qs

    def perform_create(self, serializer):
        file = serializer.save(uploaded_by=None)
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

    @action(detail=True, methods=["delete"], url_path=r"chunks/(?P<chunk_id>[^/.]+)")
    def delete_chunk(self, request, pk=None, chunk_id=None):
        file = self.get_object()
        deleted, _ = file.chunk_refs.filter(id=chunk_id).delete()
        if deleted:
            file.chunk_count = file.chunk_refs.count()
            file.save(update_fields=["chunk_count", "updated_at"])
            _log(request.user, file.knowledge_base, "chunk.deleted", "knowledge_chunk", chunk_id, {"file_id": file.id})
        return Response({"deleted": bool(deleted), "chunk_id": chunk_id})

    @action(detail=True, methods=["post"])
    def start_ingest(self, request, pk=None):
        file = self.get_object()
        job = KnowledgeIngestJob.objects.create(
            file=file,
            status=KnowledgeIngestJob.Status.PENDING,
            stage="pending",
            progress=0,
            created_by=None,
        )
        file.status = KnowledgeFile.Status.PROCESSING
        file.save(update_fields=["status", "updated_at"])
        _log(request.user, file.knowledge_base, "file.ingest_started", "knowledge_file", file.id, {"job_id": job.id})
        return Response(KnowledgeIngestJobSerializer(job).data, status=status.HTTP_201_CREATED)


class TraditionalRagSearchViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        query = (request.query_params.get("q") or "").strip()
        knowledge_base_id = request.query_params.get("knowledge_base")
        try:
            limit = int(request.query_params.get("limit") or 10)
            mode = (request.query_params.get("mode") or "keyword").strip().lower()
            if mode == "semantic":
                rows = semantic_search(
                    query=query,
                    knowledge_base_id=int(knowledge_base_id) if knowledge_base_id else None,
                    limit=limit,
                )
            else:
                rows = keyword_search(
                    query=query,
                    knowledge_base_id=int(knowledge_base_id) if knowledge_base_id else None,
                    limit=limit,
                )
        except TraditionalRagError as error:
            return Response({"error": error.code, "message": error.message}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError:
            return Response(
                {"error": "invalid_input", "message": "knowledge_base and limit must be valid integers"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({
            "query": query,
            "mode": mode,
            "count": len(rows),
            "results": KnowledgeChunkRefSerializer(rows, many=True).data,
        })

class KnowledgeIngestJobViewSet(viewsets.ModelViewSet):
    serializer_class = KnowledgeIngestJobSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return KnowledgeIngestJob.objects.select_related("file", "file__knowledge_base").filter(
            file__knowledge_base__in=_visible_knowledge_bases(self.request.user)
        )


class KnowledgeChunkRefViewSet(viewsets.ModelViewSet):
    serializer_class = KnowledgeChunkRefSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return KnowledgeChunkRef.objects.select_related("file", "file__knowledge_base").filter(
            file__knowledge_base__in=_visible_knowledge_bases(self.request.user)
        )


class KnowledgeSourceBindingViewSet(viewsets.ModelViewSet):
    serializer_class = KnowledgeSourceBindingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return KnowledgeSourceBinding.objects.select_related("knowledge_base").filter(
            knowledge_base__in=_visible_knowledge_bases(self.request.user)
        )


class KnowledgePermissionViewSet(viewsets.ModelViewSet):
    serializer_class = KnowledgePermissionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return KnowledgePermission.objects.select_related("knowledge_base").filter(
            knowledge_base__in=_visible_knowledge_bases(self.request.user)
        )


class KnowledgeAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = KnowledgeAuditLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = KnowledgeAuditLog.objects.select_related("knowledge_base").all()
        kb_id = self.request.query_params.get("knowledge_base")
        if kb_id:
            qs = qs.filter(knowledge_base_id=kb_id)
        return qs
