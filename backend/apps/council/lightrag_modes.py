"""LightRAG mode bridge for Liangce agents.

The GraphRAG service owns LightRAG storage and query semantics. This module keeps
Liangce agent code decoupled by calling the module HTTP API and formatting the
returned evidence as prompt-ready context.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from django.conf import settings

SUPPORTED_LIGHTRAG_MODES = {"local", "global", "hybrid", "mix", "naive", "bypass"}
GRAPH_QUERY_MODES = SUPPORTED_LIGHTRAG_MODES - {"bypass"}


@dataclass(frozen=True)
class LightRagEvidence:
    mode: str
    block: str
    refs: list[dict[str, Any]]
    degraded_sources: list[str]
    error: str = ""


def normalize_lightrag_mode(mode: str | None = None) -> str:
    candidate = (mode or getattr(settings, "LIGHTRAG_QUERY_MODE", "mix") or "mix").strip().lower()
    return candidate if candidate in SUPPORTED_LIGHTRAG_MODES else "mix"


def query_lightrag(
    query: str,
    *,
    mode: str | None = None,
    limit: int = 8,
    source_id: str | None = None,
    user=None,
) -> LightRagEvidence:
    normalized_mode = normalize_lightrag_mode(mode)
    if normalized_mode == "bypass":
        return LightRagEvidence(mode=normalized_mode, block="", refs=[], degraded_sources=[])

    question = (query or "").strip()
    if not question:
        return LightRagEvidence(mode=normalized_mode, block="", refs=[], degraded_sources=[])

    base_url = (getattr(settings, "GRAPH_RAG_BASE_URL", "") or "").strip().rstrip("/")
    token = (getattr(settings, "GRAPH_RAG_INTERNAL_TOKEN", "") or "").strip()
    if not base_url or not token:
        return LightRagEvidence(
            mode=normalized_mode,
            block="",
            refs=[],
            degraded_sources=[],
            error="graph_rag_not_configured",
        )

    payload = {
        "query": question,
        "mode": normalized_mode,
        "limit": max(1, min(int(limit or 8), 30)),
    }
    sid = (source_id or getattr(settings, "LIGHTRAG_SOURCE_ID", "") or "").strip()
    if sid:
        payload["source_id"] = sid

    headers = {
        "Content-Type": "application/json",
        "x-ff-internal-token": token,
        "x-ff-user-id": str(getattr(user, "id", "") or getattr(user, "username", "") or "yiran-agent"),
        "x-ff-username": str(getattr(user, "username", "") or "yiran-agent"),
        "x-ff-is-admin": "true" if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False) else "false",
    }
    request = urllib.request.Request(
        f"{base_url}/graph/search",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    timeout = float(getattr(settings, "GRAPH_RAG_QUERY_TIMEOUT_SECONDS", 45) or 45)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return LightRagEvidence(normalized_mode, "", [], [], f"http_{exc.code}")
    except Exception as exc:
        return LightRagEvidence(normalized_mode, "", [], [], exc.__class__.__name__)

    results = data.get("results") or []
    refs: list[dict[str, Any]] = []
    lines: list[str] = []
    for idx, item in enumerate(results, start=1):
        context = str(item.get("context") or "").strip()
        if not context:
            continue
        source_name = str(item.get("source_name") or item.get("source_id") or "GraphRAG")
        workspace = str(item.get("workspace") or "")
        clipped = context[:4000] + ("\n...[LightRAG context clipped]" if len(context) > 4000 else "")
        lines.append(
            f"[LightRAG {normalized_mode} #{idx}] source={source_name} workspace={workspace}\n{clipped}"
        )
        refs.append({
            "source_id": item.get("source_id"),
            "source_name": item.get("source_name"),
            "source_kind": item.get("source_kind"),
            "workspace": item.get("workspace"),
            "mode": normalized_mode,
        })

    if not lines:
        return LightRagEvidence(
            mode=normalized_mode,
            block="",
            refs=refs,
            degraded_sources=list(data.get("degraded_sources") or []),
        )
    return LightRagEvidence(
        mode=normalized_mode,
        block="【LightRAG 图谱检索】\n" + "\n\n".join(lines),
        refs=refs,
        degraded_sources=list(data.get("degraded_sources") or []),
    )
