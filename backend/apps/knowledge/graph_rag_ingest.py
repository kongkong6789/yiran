from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings

from .models import KnowledgeBase, KnowledgeFile, KnowledgeSourceBinding
from .module_http import ModuleIngestError, ModuleUserContext, post_json


@dataclass(frozen=True)
class GraphRagIngestResult:
    source_id: str
    document_id: str
    status: str
    workspace: str
    payload: dict


def graph_rag_enabled() -> bool:
    return bool(
        getattr(settings, "GRAPH_RAG_BASE_URL", "")
        and getattr(settings, "GRAPH_RAG_INTERNAL_TOKEN", "")
    )


def ingest_graph_document(
    *,
    knowledge_base: KnowledgeBase,
    file: KnowledgeFile,
    text: str,
    user: ModuleUserContext,
) -> GraphRagIngestResult:
    if not graph_rag_enabled():
        raise ModuleIngestError("GraphRAG is not configured.", code="not_configured")
    normalized = (text or "").strip()
    if not normalized:
        raise ModuleIngestError("No text was extracted for GraphRAG.", code="empty_text")

    binding = ensure_graph_source(knowledge_base=knowledge_base, user=user)
    body = {
        "source_id": binding.source_id,
        "title": file.original_filename,
        "text": normalized,
        "metadata": {
            "knowledge_base_id": knowledge_base.id,
            "knowledge_file_id": file.id,
            "content_hash": file.content_hash,
            "control_plane": "yiran",
        },
    }
    response = post_json(
        f"{settings.GRAPH_RAG_BASE_URL}/graph/documents/text",
        body,
        token=settings.GRAPH_RAG_INTERNAL_TOKEN,
        user=user,
        timeout=float(getattr(settings, "GRAPH_RAG_INGEST_TIMEOUT_SECONDS", 120)),
    )
    document = response.get("document") if isinstance(response.get("document"), dict) else {}
    document_id = str(document.get("id") or "")
    if not document_id:
        raise ModuleIngestError("GraphRAG did not return a document id.", code="invalid_response", details=response)
    status = str(document.get("status") or "submitted")
    workspace = str(binding.workspace or document.get("workspace") or "")
    return GraphRagIngestResult(
        source_id=binding.source_id,
        document_id=document_id,
        status=status,
        workspace=workspace,
        payload=response,
    )


def ensure_graph_source(*, knowledge_base: KnowledgeBase, user: ModuleUserContext) -> KnowledgeSourceBinding:
    binding = knowledge_base.source_bindings.filter(
        source_type=KnowledgeSourceBinding.SourceType.GRAPH,
        enabled=True,
    ).first()
    if binding and binding.source_id:
        return binding

    source_name = f"kb-{knowledge_base.id}-{_safe_label(knowledge_base.name)}"[:96]
    response = post_json(
        f"{settings.GRAPH_RAG_BASE_URL}/graph/sources",
        {
            "name": source_name if len(source_name) >= 3 else f"kb-{knowledge_base.id}",
            "kind": "public" if knowledge_base.visibility == KnowledgeBase.Visibility.COMPANY else "private",
            "description": (knowledge_base.description or knowledge_base.name or "")[:1000],
        },
        token=settings.GRAPH_RAG_INTERNAL_TOKEN,
        user=user,
        timeout=float(getattr(settings, "GRAPH_RAG_INGEST_TIMEOUT_SECONDS", 120)),
    )
    source = response.get("source") if isinstance(response.get("source"), dict) else {}
    source_id = str(source.get("id") or "")
    if not source_id:
        raise ModuleIngestError("GraphRAG did not return a source id.", code="invalid_response", details=response)

    return KnowledgeSourceBinding.objects.create(
        knowledge_base=knowledge_base,
        source_type=KnowledgeSourceBinding.SourceType.GRAPH,
        source_id=source_id,
        source_name=str(source.get("name") or source_name),
        workspace=str(source.get("workspace") or ""),
        config={"base_url": settings.GRAPH_RAG_BASE_URL, "visibility": knowledge_base.visibility},
        enabled=True,
    )


def _safe_label(value: str) -> str:
    label = "".join(ch.lower() if ch.isalnum() else "-" for ch in (value or "knowledge"))
    label = "-".join(part for part in label.split("-") if part)
    return label or "knowledge"
