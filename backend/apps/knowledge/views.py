from io import BytesIO
from urllib.parse import quote, urlencode

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.models import Team, TeamMembership
from apps.core.organizations import is_organization_admin

from .models import (
    KnowledgeAuditLog,
    KnowledgeBase,
    KnowledgeChunkRef,
    KnowledgeFile,
    KnowledgeEmbedding,
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
from .access import (
    can_manage_knowledge_base,
    sync_default_permissions,
    visible_knowledge_bases,
)
from .ingest_router import enqueue_knowledge_ingest
from .module_http import ModuleIngestError, get_json, module_user_context
from .traditional_rag import (
    TraditionalRagError,
    enqueue_file_reingest,
    hybrid_search,
    keyword_search,
    read_stored_file,
    semantic_search,
    write_bytes_content,
)



def _purge_knowledge_base_vectors(kb: KnowledgeBase) -> dict:
    file_ids = list(kb.files.values_list("id", flat=True))
    embedding_count, _ = KnowledgeEmbedding.objects.filter(chunk__file_id__in=file_ids).delete()
    chunk_count, _ = KnowledgeChunkRef.objects.filter(file_id__in=file_ids).delete()
    return {"file_ids": file_ids, "embedding_rows": embedding_count, "chunk_rows": chunk_count}


def _purge_knowledge_file_vectors(file: KnowledgeFile) -> dict:
    embedding_count, _ = KnowledgeEmbedding.objects.filter(chunk__file=file).delete()
    chunk_count, _ = KnowledgeChunkRef.objects.filter(file=file).delete()
    return {"embedding_rows": embedding_count, "chunk_rows": chunk_count}
def _log(user, knowledge_base, action: str, target_type: str = "", target_id: str = "", payload: dict | None = None):
    KnowledgeAuditLog.objects.create(
        actor=None,
        knowledge_base=knowledge_base,
        action=action,
        target_type=target_type,
        target_id=str(target_id or ""),
        payload=payload or {},
    )


def _team_ids_from_request(request) -> list[int] | None:
    raw = request.data.get("teamIds", request.data.get("team_ids", request.data.get("teamId")))
    if raw in (None, ""):
        return None
    if not isinstance(raw, list):
        raw = [raw]
    team_ids: list[int] = []
    for value in raw:
        try:
            team_ids.append(int(value))
        except (TypeError, ValueError):
            continue
    return list(dict.fromkeys(team_ids))


def _can_assign_team(user, team: Team) -> bool:
    if not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return True
    if TeamMembership.objects.filter(team=team, user=user).exists():
        return True
    if team.kind == Team.Kind.ENTERPRISE and team.organization_id:
        return is_organization_admin(user, team.organization_id)
    return False


def _validated_team_ids_from_request(request, *, required: bool = False) -> list[int] | None:
    team_ids = _team_ids_from_request(request)
    if not team_ids:
        if required:
            raise ValidationError({"teamIds": "Please select at least one team for a team knowledge base."})
        return team_ids
    teams = list(Team.objects.filter(id__in=team_ids, is_active=True))
    found_ids = {team.id for team in teams}
    invalid_ids = [team_id for team_id in team_ids if team_id not in found_ids]
    forbidden_ids = [team.id for team in teams if not _can_assign_team(request.user, team)]
    if invalid_ids or forbidden_ids:
        raise ValidationError({"teamIds": "One or more selected teams are unavailable or not assignable."})
    return team_ids


def _can_manage_knowledge_base(user, kb: KnowledgeBase) -> bool:
    return can_manage_knowledge_base(user, kb)


def _visible_knowledge_bases(user):
    return visible_knowledge_bases(user)


class KnowledgeTemplateViewSet(viewsets.ModelViewSet):
    queryset = KnowledgeTemplate.objects.all()
    serializer_class = KnowledgeTemplateSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = "template_id"


class KnowledgeBaseViewSet(viewsets.ModelViewSet):
    serializer_class = KnowledgeBaseSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = visible_knowledge_bases(self.request.user).select_related("template")
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
        visibility = serializer.validated_data.get("visibility", KnowledgeBase.Visibility.TEAM)
        team_ids = _validated_team_ids_from_request(self.request, required=visibility == KnowledgeBase.Visibility.TEAM)
        kb = serializer.save(owner_user_id=user.id if getattr(user, "is_authenticated", False) else None)
        sync_default_permissions(kb, user, team_ids=team_ids)
        _log(self.request.user, kb, "knowledge_base.created", "knowledge_base", kb.id)

    def perform_update(self, serializer):
        kb = self.get_object()
        if not _can_manage_knowledge_base(self.request.user, kb):
            raise PermissionDenied("You do not have permission to edit this knowledge base")
        permission_fields = {"visibility", "teamIds", "team_ids", "teamId"}
        should_sync_permissions = any(field in self.request.data for field in permission_fields)
        visibility = serializer.validated_data.get("visibility", kb.visibility)
        team_ids = None
        if should_sync_permissions:
            team_ids = _validated_team_ids_from_request(
                self.request,
                required=visibility == KnowledgeBase.Visibility.TEAM,
            )
        kb = serializer.save()
        if should_sync_permissions:
            sync_default_permissions(kb, self.request.user, team_ids=team_ids)
        _log(self.request.user, kb, "knowledge_base.updated", "knowledge_base", kb.id)

    def destroy(self, request, *args, **kwargs):
        kb = self.get_object()
        if not _can_manage_knowledge_base(request.user, kb):
            raise PermissionDenied("You do not have permission to delete this knowledge base")
        with transaction.atomic():
            purge = _purge_knowledge_base_vectors(kb)
            kb.status = KnowledgeBase.Status.ARCHIVED
            kb.archived_at = timezone.now()
            kb.save(update_fields=["status", "archived_at", "updated_at"])
            kb.files.filter(archived_at__isnull=True).update(
                status=KnowledgeFile.Status.ARCHIVED,
                archived_at=kb.archived_at,
                updated_at=kb.archived_at,
            )
            _log(request.user, kb, "knowledge_base.archived", "knowledge_base", kb.id, purge)
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
        if not _can_manage_knowledge_base(request.user, kb):
            raise PermissionDenied("You do not have permission to upload files")
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            chunk_size = request.data.get("chunk_size")
            chunk_overlap = request.data.get("chunk_overlap")
            asset_role = (request.data.get("asset_role") or "upload").strip()
            result = enqueue_knowledge_ingest(
                knowledge_base=kb,
                upload=upload,
                user=request.user,
                segment_mode=request.data.get("segment_mode") or "general",
                chunk_size=int(chunk_size) if chunk_size not in (None, "") else None,
                chunk_overlap=int(chunk_overlap) if chunk_overlap not in (None, "") else None,
                asset_role=asset_role,
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
            "file.ingest_queued",
            "knowledge_file",
            result.file.id,
            {
                "filename": result.file.original_filename,
                "job_id": result.job.id,
                "retrieval_mode": kb.retrieval_mode,
                "routes": result.routes,
            },
        )
        return Response(
            {
                "file": KnowledgeFileSerializer(result.file).data,
                "job": KnowledgeIngestJobSerializer(result.job).data,
                "chunk_count": len(result.chunks),
                "job_id": result.job.id,
                "routes": result.routes,
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
            mode = (request.query_params.get("mode") or "hybrid").strip().lower()
            if mode == "semantic":
                rows = semantic_search(query=query, knowledge_base_id=kb.id, limit=limit)
            elif mode == "keyword":
                rows = keyword_search(query=query, knowledge_base_id=kb.id, limit=limit)
            else:
                mode = "hybrid"
                rows = hybrid_search(query=query, knowledge_base_id=kb.id, limit=limit)
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
        kb = serializer.validated_data.get("knowledge_base")
        if kb and not _can_manage_knowledge_base(self.request.user, kb):
            raise PermissionDenied("You do not have permission to add files to this knowledge base")
        file = serializer.save(uploaded_by=None)
        KnowledgeBase.objects.filter(id=file.knowledge_base_id).update(file_count=file.knowledge_base.files.filter(archived_at__isnull=True).count())
        _log(self.request.user, file.knowledge_base, "file.created", "knowledge_file", file.id, {"filename": file.original_filename})

    def destroy(self, request, *args, **kwargs):
        file = self.get_object()
        if not _can_manage_knowledge_base(request.user, file.knowledge_base):
            raise PermissionDenied("You do not have permission to delete this file")
        with transaction.atomic():
            purge = _purge_knowledge_file_vectors(file)
            file.status = KnowledgeFile.Status.ARCHIVED
            file.archived_at = timezone.now()
            file.save(update_fields=["status", "archived_at", "updated_at"])
            KnowledgeBase.objects.filter(id=file.knowledge_base_id).update(file_count=file.knowledge_base.files.filter(archived_at__isnull=True).count())
            _log(request.user, file.knowledge_base, "file.archived", "knowledge_file", file.id, {"filename": file.original_filename, **purge})
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def download(self, request, pk=None):
        file = self.get_object()
        if not file.storage_path:
            return Response({"error": "file_not_stored", "message": "File storage path is missing."}, status=status.HTTP_404_NOT_FOUND)
        try:
            content = read_stored_file(file.storage_path)
        except Exception as error:
            return Response({"error": "download_failed", "message": str(error)}, status=status.HTTP_404_NOT_FOUND)
        response = FileResponse(BytesIO(content), as_attachment=True, filename=file.original_filename)
        content_type = file.metadata.get("content_type") if isinstance(file.metadata, dict) else None
        if content_type:
            response["Content-Type"] = content_type
        return response

    @action(detail=True, methods=["get", "put", "patch"])
    def content(self, request, pk=None):
        """Read/write plain-text document body (Markdown docs in knowledge workspace)."""
        file = self.get_object()
        # Reads require visibility; writes require knowledge-base management permission.
        if request.method == "GET":
            if not file.storage_path:
                return Response({"content": "", "file": KnowledgeFileSerializer(file).data})
            try:
                raw = read_stored_file(file.storage_path)
            except Exception as error:
                return Response({"error": "read_failed", "message": str(error)}, status=status.HTTP_404_NOT_FOUND)
            text = raw.decode("utf-8", errors="replace")
            return Response({
                "content": text,
                "encoding": "utf-8",
                "file": KnowledgeFileSerializer(file).data,
            })

        if not _can_manage_knowledge_base(request.user, file.knowledge_base):
            raise PermissionDenied("You do not have permission to edit this file")

        body = request.data if isinstance(request.data, dict) else {}
        content = body.get("content")
        if content is None:
            return Response({"error": "invalid_input", "message": "content is required"}, status=400)
        text = str(content)
        data = text.encode("utf-8")

        title = str(body.get("title") or "").strip()
        filename = file.original_filename
        if title:
            # Strip known compound / simple extensions from the incoming title.
            stem = title
            for ext in (".mind.json", ".xmind.md", ".markdown", ".md", ".txt", ".json"):
                if stem.lower().endswith(ext):
                    stem = stem[: -len(ext)]
                    break
            stem = (
                stem.replace("\\", "_")
                .replace("/", "_")
                .replace(":", "_")
                .replace("*", "_")
                .replace("?", "_")
                .replace('"', "_")
                .replace("<", "_")
                .replace(">", "_")
                .replace("|", "_")
                .strip()
                or "Untitled document"
            )
            original = file.original_filename or ""
            lower_original = original.lower()
            if lower_original.endswith(".mind.json"):
                filename = f"{stem}.mind.json"
            elif lower_original.endswith(".xmind.md"):
                filename = f"{stem}.xmind.md"
            elif "." in original:
                ext = original.rsplit(".", 1)[-1]
                filename = f"{stem}.{ext}"
            else:
                filename = f"{stem}.md"

        try:
            storage_path, raw, storage_metadata = write_bytes_content(
                data,
                knowledge_base_id=file.knowledge_base_id,
                file_id=file.id,
                filename=filename,
                content_type="text/markdown;charset=utf-8",
                existing_storage_path=file.storage_path or None,
            )
        except TraditionalRagError as error:
            return Response({"error": error.code, "message": error.message}, status=400)

        import hashlib

        digest = hashlib.sha256(raw).hexdigest()
        file.storage_path = storage_path
        file.original_filename = filename
        file.file_type = file.file_type or "md"
        file.content_hash = digest
        file.char_count = len(text)
        file.metadata = {
            **(file.metadata or {}),
            **storage_metadata,
            "content_hash": digest,
            "content_type": "text/markdown;charset=utf-8",
            "file_size": len(raw),
            "editor": "markdown",
        }
        file.save(update_fields=[
            "storage_path",
            "original_filename",
            "file_type",
            "content_hash",
            "char_count",
            "metadata",
            "updated_at",
        ])

        reingest = bool(body.get("reingest", True))
        job = None
        if reingest:
            job = enqueue_file_reingest(file=file)

        _log(
            request.user,
            file.knowledge_base,
            "file.content_updated",
            "knowledge_file",
            file.id,
            {"filename": filename, "chars": len(text), "job_id": getattr(job, "id", None)},
        )
        payload = {
            "ok": True,
            "file": KnowledgeFileSerializer(file).data,
            "content": text,
        }
        if job is not None:
            payload["job"] = KnowledgeIngestJobSerializer(job).data
            payload["job_id"] = job.id
        return Response(payload)

    @action(detail=True, methods=["get"])
    def chunks(self, request, pk=None):
        file = self.get_object()
        rows = file.chunk_refs.all().order_by("chunk_index", "id")
        try:
            page = max(1, int(request.query_params.get("page", "1")))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.query_params.get("page_size", "20"))
        except (TypeError, ValueError):
            page_size = 20
        page_size = min(max(page_size, 1), 100)
        total = rows.count()
        offset = (page - 1) * page_size
        page_rows = rows[offset : offset + page_size]
        return Response({
            "file": KnowledgeFileSerializer(file).data,
            "count": total,
            "page": page,
            "page_size": page_size,
            "results": KnowledgeChunkRefSerializer(page_rows, many=True).data,
        })
    @action(detail=True, methods=["delete"], url_path=r"chunks/(?P<chunk_id>[^/.]+)")
    def delete_chunk(self, request, pk=None, chunk_id=None):
        file = self.get_object()
        if not _can_manage_knowledge_base(request.user, file.knowledge_base):
            raise PermissionDenied("You do not have permission to delete this chunk")
        deleted, _ = file.chunk_refs.filter(id=chunk_id).delete()
        if deleted:
            file.chunk_count = file.chunk_refs.count()
            file.save(update_fields=["chunk_count", "updated_at"])
            _log(request.user, file.knowledge_base, "chunk.deleted", "knowledge_chunk", chunk_id, {"file_id": file.id})
        return Response({"deleted": bool(deleted), "chunk_id": chunk_id})

    @action(detail=True, methods=["get"], url_path="graph-detail")
    def graph_detail(self, request, pk=None):
        file = self.get_object()
        metadata = file.metadata or {}
        external = metadata.get("external_ingest") if isinstance(metadata, dict) else None
        routes = external.get("routes", {}) if isinstance(external, dict) else {}
        graph_route = routes.get("graph_rag", {}) if isinstance(routes, dict) else {}
        source_id = str(graph_route.get("source_id") or "")
        document_id = str(graph_route.get("document_id") or "")
        if not source_id:
            binding = file.knowledge_base.source_bindings.filter(
                source_type=KnowledgeSourceBinding.SourceType.GRAPH,
                enabled=True,
            ).first()
            source_id = str(getattr(binding, "source_id", "") or "")
        if not source_id and not document_id:
            return Response({
                "configured": bool(getattr(settings, "GRAPH_RAG_BASE_URL", "") and getattr(settings, "GRAPH_RAG_INTERNAL_TOKEN", "")),
                "file": KnowledgeFileSerializer(file).data,
                "route": graph_route,
                "message": "This file has no GraphRAG route metadata yet.",
                "source": None,
                "document": None,
                "graph": None,
                "runs": [],
                "selected_run": None,
                "edges": [],
                "extractions": [],
            })
        if not getattr(settings, "GRAPH_RAG_BASE_URL", "") or not getattr(settings, "GRAPH_RAG_INTERNAL_TOKEN", ""):
            return Response({"error": "not_configured", "message": "GraphRAG is not configured."}, status=400)

        user = module_user_context(request.user)
        timeout = float(getattr(settings, "GRAPH_RAG_QUERY_TIMEOUT_SECONDS", 45))

        def fetch(path: str, params: dict | None = None) -> tuple[dict | None, dict | None]:
            url = f"{settings.GRAPH_RAG_BASE_URL}{path}"
            if params:
                url = f"{url}?{urlencode(params)}"
            try:
                return get_json(url, token=settings.GRAPH_RAG_INTERNAL_TOKEN, user=user, timeout=timeout), None
            except ModuleIngestError as error:
                return None, {"error": error.code, "message": error.message, "details": error.details}

        source_payload = None
        document_payload = None
        graph_payload = None
        errors: dict[str, dict] = {}
        if source_id:
            source_payload, error = fetch(f"/graph/sources/{quote(source_id)}")
            if error:
                errors["source"] = error
            graph_payload, error = fetch("/graph/curation/detail", {"source_id": source_id, "max_nodes": 160, "include_metrics": "true"})
            if error:
                errors["graph"] = error
        if document_id:
            document_payload, error = fetch(f"/graph/documents/{quote(document_id)}")
            if error:
                errors["document"] = error

        runs: list[dict] = []
        if source_id:
            runs_payload, error = fetch("/graph/assets/runs", {"source_id": source_id})
            if error:
                errors["runs"] = error
            else:
                runs = runs_payload.get("runs", []) if isinstance(runs_payload, dict) else []
        selected_run = None
        if runs:
            selected_run = next((run for run in runs if document_id and str(run.get("document_id") or "") == document_id), None)
            if selected_run is None and file.content_hash:
                selected_run = next((run for run in runs if str(run.get("content_hash") or "") == file.content_hash), None)
            if selected_run is None:
                selected_run = runs[0]

        edges: list[dict] = []
        extractions: list[dict] = []
        if selected_run and selected_run.get("id"):
            run_id = str(selected_run["id"])
            edge_payload, error = fetch(f"/graph/assets/runs/{quote(run_id)}/edges", {"include_all": "true"})
            if error:
                errors["edges"] = error
            else:
                edges = edge_payload.get("edges", []) if isinstance(edge_payload, dict) else []
            extraction_payload, error = fetch(f"/graph/assets/runs/{quote(run_id)}/extractions")
            if error:
                errors["extractions"] = error
            else:
                extractions = extraction_payload.get("extractions", []) if isinstance(extraction_payload, dict) else []

        return Response({
            "configured": True,
            "file": KnowledgeFileSerializer(file).data,
            "route": graph_route,
            "source": source_payload.get("source", source_payload) if isinstance(source_payload, dict) else None,
            "document": document_payload.get("document", document_payload) if isinstance(document_payload, dict) else None,
            "graph": graph_payload,
            "runs": runs,
            "selected_run": selected_run,
            "edges": edges,
            "extractions": extractions,
            "errors": errors,
        })

    @action(detail=True, methods=["post"])
    def start_ingest(self, request, pk=None):
        file = self.get_object()
        if not _can_manage_knowledge_base(request.user, file.knowledge_base):
            raise PermissionDenied("You do not have permission to ingest this file")
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
            visible_ids = set(_visible_knowledge_bases(request.user).values_list("id", flat=True))
            selected_kb_id = int(knowledge_base_id) if knowledge_base_id else None
            if selected_kb_id and selected_kb_id not in visible_ids:
                raise PermissionDenied("You do not have permission to search this knowledge base")
            limit = int(request.query_params.get("limit") or 10)
            mode = (request.query_params.get("mode") or "hybrid").strip().lower()
            if mode == "semantic":
                rows = semantic_search(
                    query=query,
                    knowledge_base_id=selected_kb_id,
                    limit=limit,
                )
            elif mode == "keyword":
                rows = keyword_search(
                    query=query,
                    knowledge_base_id=selected_kb_id,
                    limit=limit,
                )
            else:
                mode = "hybrid"
                rows = hybrid_search(
                    query=query,
                    knowledge_base_id=selected_kb_id,
                    limit=limit,
                )
            if selected_kb_id is None:
                rows = [row for row in rows if row.file.knowledge_base_id in visible_ids]
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

    def perform_create(self, serializer):
        kb = serializer.validated_data.get("knowledge_base")
        if kb and not _can_manage_knowledge_base(self.request.user, kb):
            raise PermissionDenied("You do not have permission to update this knowledge base")
        serializer.save()

    def perform_update(self, serializer):
        if not _can_manage_knowledge_base(self.request.user, self.get_object().knowledge_base):
            raise PermissionDenied("You do not have permission to update this knowledge base")
        serializer.save()

    def perform_destroy(self, instance):
        if not _can_manage_knowledge_base(self.request.user, instance.knowledge_base):
            raise PermissionDenied("You do not have permission to update this knowledge base")
        instance.delete()


class KnowledgePermissionViewSet(viewsets.ModelViewSet):
    serializer_class = KnowledgePermissionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return KnowledgePermission.objects.select_related("knowledge_base").filter(
            knowledge_base__in=_visible_knowledge_bases(self.request.user)
        )

    def perform_create(self, serializer):
        kb = serializer.validated_data.get("knowledge_base")
        if kb and not _can_manage_knowledge_base(self.request.user, kb):
            raise PermissionDenied("You do not have permission to update permissions")
        serializer.save()

    def perform_update(self, serializer):
        if not _can_manage_knowledge_base(self.request.user, self.get_object().knowledge_base):
            raise PermissionDenied("You do not have permission to update permissions")
        serializer.save()

    def perform_destroy(self, instance):
        if not _can_manage_knowledge_base(self.request.user, instance.knowledge_base):
            raise PermissionDenied("You do not have permission to update permissions")
        instance.delete()


class KnowledgeAuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = KnowledgeAuditLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = KnowledgeAuditLog.objects.select_related("knowledge_base").all()
        kb_id = self.request.query_params.get("knowledge_base")
        if kb_id:
            qs = qs.filter(knowledge_base_id=kb_id)
        return qs
