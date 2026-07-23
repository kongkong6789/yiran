from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from django.conf import settings

from .models import KnowledgeBase, KnowledgeFile, KnowledgeSourceBinding
from .module_http import ModuleIngestError, ModuleUserContext, post_json


@dataclass(frozen=True)
class GbrainIngestResult:
    source_id: str
    page_id: str
    slug: str
    status: str
    payload: dict


def gbrain_enabled() -> bool:
    return bool(
        getattr(settings, "NANO_BRAIN_BASE_URL", "")
        and getattr(settings, "NANO_BRAIN_INTERNAL_TOKEN", "")
    )


def ingest_gbrain_page(
    *,
    knowledge_base: KnowledgeBase,
    file: KnowledgeFile,
    body: str,
    user: ModuleUserContext,
) -> GbrainIngestResult:
    if not gbrain_enabled():
        raise ModuleIngestError("nano-brain is not configured.", code="not_configured")
    normalized = (body or "").strip()
    if not normalized:
        raise ModuleIngestError("No text was extracted for nano-brain.", code="empty_text")

    binding = ensure_gbrain_source(knowledge_base=knowledge_base, user=user)
    slug = _page_slug(file)
    response = post_json(
        f"{settings.NANO_BRAIN_BASE_URL}/nano/pages",
        {
            "source_id": binding.source_id,
            "slug": slug,
            "title": file.original_filename,
            "body": normalized,
            "content_type": "text/markdown",
        },
        token=settings.NANO_BRAIN_INTERNAL_TOKEN,
        user=user,
        timeout=float(getattr(settings, "NANO_BRAIN_INGEST_TIMEOUT_SECONDS", 120)),
    )
    page = response.get("page") if isinstance(response.get("page"), dict) else {}
    page_id = str(page.get("id") or "")
    if not page_id:
        raise ModuleIngestError("nano-brain did not return a page id.", code="invalid_response", details=response)
    return GbrainIngestResult(
        source_id=binding.source_id,
        page_id=page_id,
        slug=str(page.get("slug") or slug),
        status=str(page.get("compile_status") or "ready"),
        payload=response,
    )


def ensure_gbrain_source(*, knowledge_base: KnowledgeBase, user: ModuleUserContext) -> KnowledgeSourceBinding:
    binding = knowledge_base.source_bindings.filter(
        source_type=KnowledgeSourceBinding.SourceType.WIKI,
        enabled=True,
    ).first()
    if binding and binding.source_id:
        return binding

    source_name = f"kb-{knowledge_base.id}-{_nano_safe_name(knowledge_base.name)}"[:96]
    if len(source_name) < 3:
        source_name = f"kb-{knowledge_base.id}"
    response = post_json(
        f"{settings.NANO_BRAIN_BASE_URL}/nano/sources",
        {"name": source_name},
        token=settings.NANO_BRAIN_INTERNAL_TOKEN,
        user=user,
        timeout=float(getattr(settings, "NANO_BRAIN_INGEST_TIMEOUT_SECONDS", 120)),
    )
    source = response.get("source") if isinstance(response.get("source"), dict) else {}
    source_id = str(source.get("id") or "")
    if not source_id:
        raise ModuleIngestError("nano-brain did not return a source id.", code="invalid_response", details=response)

    return KnowledgeSourceBinding.objects.create(
        knowledge_base=knowledge_base,
        source_type=KnowledgeSourceBinding.SourceType.WIKI,
        source_id=source_id,
        source_name=str(source.get("name") or source_name),
        workspace=source_name,
        config={"base_url": settings.NANO_BRAIN_BASE_URL, "engine": "nano-brain"},
        enabled=True,
    )


def _nano_safe_name(value: str) -> str:
    label = re.sub(r"[^a-z0-9_./-]+", "-", (value or "knowledge").strip().lower())
    label = re.sub(r"-+", "-", label).strip("-./_")
    return label or "knowledge"


def _page_slug(file: KnowledgeFile) -> str:
    stem = re.sub(r"\.[a-z0-9]+$", "", file.original_filename.lower())
    slug = re.sub(r"[^a-z0-9_-]+", "-", stem).strip("-_")
    if not slug:
        slug = f"file-{file.id}"
    digest = hashlib.sha256(f"{file.id}:{file.content_hash}".encode("utf-8")).hexdigest()[:10]
    return f"{slug[:80]}-{digest}"
