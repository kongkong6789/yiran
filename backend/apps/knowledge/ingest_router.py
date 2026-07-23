from __future__ import annotations

import hashlib
import threading
from dataclasses import dataclass

from django.db import close_old_connections, transaction
from django.utils import timezone

from .gbrain_ingest import ingest_gbrain_page
from .graph_rag_ingest import ingest_graph_document
from .models import KnowledgeBase, KnowledgeFile, KnowledgeIngestJob, KnowledgeSourceBinding
from .module_http import ModuleIngestError, module_user_context
from .traditional_rag import (
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_CHUNK_SIZE,
    TraditionalIngestResult,
    detect_file_type,
    enqueue_ingest_upload,
    parse_document,
    prepare_content_for_parsing,
    read_stored_file,
    write_uploaded_file,
)


@dataclass(frozen=True)
class KnowledgeIngestDispatchResult:
    file: KnowledgeFile
    job: KnowledgeIngestJob
    chunks: list
    routes: dict


def enqueue_knowledge_ingest(
    *,
    knowledge_base: KnowledgeBase,
    upload,
    user,
    segment_mode: str = "general",
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
    asset_role: str | None = None,
) -> KnowledgeIngestDispatchResult:
    mode = knowledge_base.retrieval_mode or KnowledgeBase.RetrievalMode.HYBRID
    if mode == KnowledgeBase.RetrievalMode.NAIVE:
        result = enqueue_ingest_upload(
            knowledge_base=knowledge_base,
            upload=upload,
            user=user,
            segment_mode=segment_mode,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            asset_role=asset_role,
        )
        _ensure_traditional_binding(knowledge_base)
        return KnowledgeIngestDispatchResult(
            file=result.file,
            job=result.job,
            chunks=result.chunks,
            routes={"traditional": {"status": "queued", "job_id": result.job.id}},
        )

    enable_graph = mode in {KnowledgeBase.RetrievalMode.GRAPH, KnowledgeBase.RetrievalMode.HYBRID}
    enable_gbrain = mode == KnowledgeBase.RetrievalMode.HYBRID
    external = _enqueue_external_ingest_upload(
        knowledge_base=knowledge_base,
        upload=upload,
        user=user,
        segment_mode=segment_mode,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        asset_role=asset_role,
        enable_graph=enable_graph,
        enable_gbrain=enable_gbrain,
    )
    return external


def _enqueue_external_ingest_upload(
    *,
    knowledge_base: KnowledgeBase,
    upload,
    user,
    segment_mode: str,
    chunk_size: int | None,
    chunk_overlap: int | None,
    asset_role: str | None,
    enable_graph: bool,
    enable_gbrain: bool,
) -> KnowledgeIngestDispatchResult:
    from .traditional_rag import safe_original_filename

    original_filename = safe_original_filename(getattr(upload, "name", "") or "upload.bin")
    role = (asset_role or "upload").strip().lower() or "upload"
    if role not in {"upload", "smart_doc", "mindmap"}:
        role = "upload"

    file = KnowledgeFile.objects.create(
        knowledge_base=knowledge_base,
        original_filename=original_filename,
        segment_mode=segment_mode or "general",
        status=KnowledgeFile.Status.PROCESSING,
        uploaded_by=None,
        metadata={
            "ingest_mode": knowledge_base.retrieval_mode,
            "async": True,
            "asset_role": role,
            "routes": {
                "graph_rag": {"enabled": enable_graph, "status": "queued" if enable_graph else "disabled"},
                "gbrain": {"enabled": enable_gbrain, "status": "queued" if enable_gbrain else "disabled"},
            },
        },
    )
    job = KnowledgeIngestJob.objects.create(
        file=file,
        status=KnowledgeIngestJob.Status.PENDING,
        stage="queued",
        progress=5,
        created_by=None,
    )
    try:
        storage_path, content, storage_metadata = write_uploaded_file(
            upload,
            knowledge_base.id,
            file.id,
            original_filename,
            use_cos=False,
        )
        file_type = detect_file_type(original_filename, content)
        digest = hashlib.sha256(content).hexdigest()
        file.storage_path = storage_path
        file.file_type = file_type
        file.content_hash = digest
        file.metadata = {
            **(file.metadata or {}),
            "content_hash": digest,
            **storage_metadata,
            "content_type": getattr(upload, "content_type", ""),
            "file_size": getattr(upload, "size", len(content)),
            "chunk_config": {
                "max_chars": chunk_size or DEFAULT_CHUNK_SIZE,
                "overlap_chars": chunk_overlap if chunk_overlap is not None else DEFAULT_CHUNK_OVERLAP,
            },
        }
        file.save(update_fields=["storage_path", "file_type", "content_hash", "metadata", "updated_at"])
    except Exception as error:
        _mark_external_failed(file, job, error)
        raise

    thread = threading.Thread(
        target=_run_external_ingest_job,
        kwargs={
            "job_id": job.id,
            "user_id": str(getattr(user, "id", "") or "0"),
            "username": str(getattr(user, "username", "") or ""),
            "enable_graph": enable_graph,
            "enable_gbrain": enable_gbrain,
        },
        name=f"knowledge-external-ingest-{job.id}",
        daemon=True,
    )
    thread.start()
    return KnowledgeIngestDispatchResult(
        file=file,
        job=job,
        chunks=[],
        routes={
            "graph_rag": {"status": "queued" if enable_graph else "disabled"},
            "gbrain": {"status": "queued" if enable_gbrain else "disabled"},
        },
    )


def _run_external_ingest_job(
    *,
    job_id: int,
    user_id: str,
    username: str,
    enable_graph: bool,
    enable_gbrain: bool,
) -> None:
    close_old_connections()
    try:
        job = KnowledgeIngestJob.objects.select_related("file", "file__knowledge_base").get(id=job_id)
        file = job.file
        kb = file.knowledge_base
        user = module_user_context(type("ModuleUser", (), {"id": user_id, "username": username})())

        job.status = KnowledgeIngestJob.Status.PARSING
        job.stage = "parsing"
        job.progress = 20
        job.started_at = job.started_at or timezone.now()
        job.save(update_fields=["status", "stage", "progress", "started_at", "updated_at"])

        text, parser_metadata = _extract_external_text(file)
        routes: dict[str, dict] = {}

        if enable_gbrain:
            job.status = KnowledgeIngestJob.Status.GRAPHING
            job.stage = "gbrain"
            job.progress = 45
            job.save(update_fields=["status", "stage", "progress", "updated_at"])
            routes["gbrain"] = _run_route(
                lambda: ingest_gbrain_page(knowledge_base=kb, file=file, body=text, user=user),
                lambda result: {
                    "status": "ready",
                    "source_id": result.source_id,
                    "page_id": result.page_id,
                    "slug": result.slug,
                    "engine_status": result.status,
                },
            )

        if enable_graph:
            job.status = KnowledgeIngestJob.Status.GRAPHING
            job.stage = "graph_rag"
            job.progress = 70
            job.save(update_fields=["status", "stage", "progress", "updated_at"])
            routes["graph_rag"] = _run_route(
                lambda: ingest_graph_document(knowledge_base=kb, file=file, text=text, user=user),
                lambda result: {
                    "status": "submitted" if result.status == "processing" else "ready",
                    "source_id": result.source_id,
                    "document_id": result.document_id,
                    "workspace": result.workspace,
                    "engine_status": result.status,
                },
            )

        _mark_external_complete(file, job, routes, parser_metadata)
    except Exception as error:
        try:
            if "job" not in locals():
                job = KnowledgeIngestJob.objects.select_related("file").get(id=job_id)
                file = job.file
            _mark_external_failed(file, job, error)
        except Exception:
            pass
    finally:
        close_old_connections()


def _extract_external_text(file: KnowledgeFile) -> tuple[str, dict]:
    content = read_stored_file(file.storage_path)
    file_type = file.file_type or detect_file_type(file.original_filename, content)
    content_metadata = {
        "content_type": (file.metadata or {}).get("content_type", ""),
        "file_size": (file.metadata or {}).get("file_size", len(content)),
        "ingest_mode": file.knowledge_base.retrieval_mode,
    }
    content, parser_file_type, content_metadata = prepare_content_for_parsing(
        filename=file.original_filename,
        content=content,
        file_type=file_type,
        content_metadata=content_metadata,
        document_id=f"knowledge-file-{file.id}",
    )
    parsed = parse_document(content, parser_file_type)
    return parsed.text, {"parser": parsed.metadata, "content": content_metadata, "char_count": len(parsed.text)}


def _run_route(call, serialize) -> dict:
    try:
        return serialize(call())
    except ModuleIngestError as error:
        return {"status": "failed", "error": error.code, "message": error.message, "details": error.details}
    except Exception as error:
        return {"status": "failed", "error": "unexpected_error", "message": str(error)}


def _mark_external_complete(file: KnowledgeFile, job: KnowledgeIngestJob, routes: dict, parser_metadata: dict) -> None:
    route_values = list(routes.values())
    ready_count = sum(1 for route in route_values if route.get("status") in {"ready", "submitted"})
    failed_count = sum(1 for route in route_values if route.get("status") == "failed")
    overall_status = "ready" if failed_count == 0 else "partial_failed" if ready_count else "failed"

    with transaction.atomic():
        file.status = KnowledgeFile.Status.READY if ready_count else KnowledgeFile.Status.FAILED
        file.char_count = int(parser_metadata.get("char_count") or 0)
        file.metadata = {
            **(file.metadata or {}),
            "external_ingest": {
                "overall_status": overall_status,
                "routes": routes,
                **parser_metadata,
            },
        }
        file.save(update_fields=["status", "char_count", "metadata", "updated_at"])
        job.status = KnowledgeIngestJob.Status.READY if ready_count else KnowledgeIngestJob.Status.FAILED
        job.stage = overall_status
        job.progress = 100
        job.error = None if ready_count else {"error": "all_routes_failed", "routes": routes}
        job.metrics = {
            "overall_status": overall_status,
            "routes": routes,
            **parser_metadata,
        }
        job.finished_at = timezone.now()
        job.save(update_fields=["status", "stage", "progress", "error", "metrics", "finished_at", "updated_at"])
        KnowledgeBase.objects.filter(id=file.knowledge_base_id).update(
            file_count=file.knowledge_base.files.filter(archived_at__isnull=True).count(),
            status=KnowledgeBase.Status.READY if ready_count else KnowledgeBase.Status.REVIEW,
        )


def _mark_external_failed(file: KnowledgeFile, job: KnowledgeIngestJob, error: Exception) -> None:
    payload = {
        "error": getattr(error, "code", "processing_error"),
        "message": getattr(error, "message", str(error)),
    }
    file.status = KnowledgeFile.Status.FAILED
    file.metadata = {**(file.metadata or {}), "external_ingest": {"overall_status": "failed", "error": payload}}
    file.save(update_fields=["status", "metadata", "updated_at"])
    job.status = KnowledgeIngestJob.Status.FAILED
    job.stage = "failed"
    job.progress = 100
    job.error = payload
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "stage", "progress", "error", "finished_at", "updated_at"])


def _ensure_traditional_binding(knowledge_base: KnowledgeBase) -> None:
    KnowledgeSourceBinding.objects.get_or_create(
        knowledge_base=knowledge_base,
        source_type=KnowledgeSourceBinding.SourceType.TRADITIONAL,
        source_id=str(knowledge_base.id),
        defaults={
            "source_name": knowledge_base.name,
            "workspace": "yiran-knowledge",
            "config": {"engine": "traditional-rag", "storage": "KnowledgeChunkRef/KnowledgeEmbedding"},
            "enabled": True,
        },
    )
