from __future__ import annotations

from typing import Any

from apps.datalake.models import MetricContract, SourceSnapshot
from apps.knowledge.access import visible_knowledge_bases

from .sop_schema import normalize_data_bindings, normalize_knowledge_scope


def _snapshot_summary(row: SourceSnapshot) -> dict[str, Any]:
    scope = row.scope or {}
    return {
        "snapshot_id": row.id,
        "snapshot_key": row.snapshot_key,
        "asset_key": str(scope.get("asset_key") or row.source_system),
        "source_system": row.source_system,
        "source_mode": row.source_mode,
        "as_of": row.as_of.isoformat() if row.as_of else None,
        "row_count": row.row_count,
        "content_hash": row.content_hash,
        "governance_status": row.governance_status,
        "complete": row.complete,
    }


def resolve_data_bindings(
    *,
    organization,
    bindings: dict | None,
    payload: dict | None = None,
    text: str = "",
    allow_fallback: bool = True,
) -> dict[str, Any]:
    """Resolve node/SOP data bindings into concrete snapshots and payload patches.

    When bindings specify snapshot_ids / asset_keys, those win.
    Otherwise optionally fall back to trusted LIVE selection.
    """
    data = normalize_data_bindings(bindings)
    payload = dict(payload or {})
    selected: list[SourceSnapshot] = []
    errors: list[str] = []

    if data["snapshot_ids"]:
        rows = list(SourceSnapshot.objects.filter(organization=organization, id__in=data["snapshot_ids"]))
        by_id = {row.id: row for row in rows}
        for snapshot_id in data["snapshot_ids"]:
            row = by_id.get(snapshot_id)
            if not row:
                errors.append(f"snapshot_id={snapshot_id} 不存在或不属于当前企业")
                continue
            selected.append(row)

    if data["asset_keys"] and not selected:
        for asset_key in data["asset_keys"]:
            row = (
                SourceSnapshot.objects.filter(
                    organization=organization,
                    governance_status="governed",
                    complete=True,
                )
                .filter(scope__asset_key=asset_key)
                .order_by("-as_of", "-id")
                .first()
            )
            if row is None:
                row = (
                    SourceSnapshot.objects.filter(organization=organization, source_system=asset_key)
                    .order_by("-as_of", "-id")
                    .first()
                )
            if row is None:
                errors.append(f"asset_key={asset_key} 未找到可用 Snapshot")
                continue
            selected.append(row)

    used_fallback = False
    if not selected and allow_fallback and not data["snapshot_ids"] and not data["asset_keys"]:
        from .business_analysis import select_trusted_snapshots

        selected = select_trusted_snapshots(organization=organization, text=text or "经营分析")
        used_fallback = bool(selected)

    metrics: list[dict[str, Any]] = []
    if data["metric_ids"]:
        from django.db.models import Q

        contracts = MetricContract.objects.filter(
            Q(organization=organization) | Q(organization__isnull=True),
            metric_id__in=data["metric_ids"],
            active=True,
        ).order_by("metric_id", "version")
        seen: set[str] = set()
        for contract in contracts:
            if contract.metric_id in seen:
                continue
            seen.add(contract.metric_id)
            metrics.append({
                "metric_id": contract.metric_id,
                "version": contract.version,
                "name": contract.name,
                "unit": contract.unit,
            })
        missing_metrics = [item for item in data["metric_ids"] if item not in seen]
        for item in missing_metrics:
            errors.append(f"metric_id={item} 未找到有效指标契约")

    payload_patch: dict[str, Any] = {}
    snapshot_ids = [row.id for row in selected]
    if snapshot_ids:
        payload_patch["snapshot_ids"] = snapshot_ids
        # Inventory / single-snapshot actions still read snapshot_id.
        if "snapshot_id" not in payload or payload.get("snapshot_id") in (None, "", []):
            payload_patch["snapshot_id"] = snapshot_ids[0]
    if data["scope"]:
        payload_patch["scope"] = data["scope"]
    if data["brand_ids"]:
        payload_patch["brand_ids"] = data["brand_ids"]
    if data["metric_ids"]:
        payload_patch["metric_ids"] = data["metric_ids"]
    if data["asset_keys"]:
        payload_patch["asset_keys"] = data["asset_keys"]

    return {
        "ok": not errors or bool(selected),
        "used_fallback": used_fallback,
        "bindings": data,
        "snapshots": [_snapshot_summary(row) for row in selected],
        "metrics": metrics,
        "payload_patch": payload_patch,
        "errors": errors,
        "context_text": _format_data_context(selected, metrics, data),
    }


def _format_data_context(snapshots: list[SourceSnapshot], metrics: list[dict], bindings: dict) -> str:
    lines = ["企业数据绑定："]
    if snapshots:
        for row in snapshots:
            scope = row.scope or {}
            asset = scope.get("asset_key") or row.source_system
            lines.append(
                f"- snapshot#{row.id} {asset} as_of={row.as_of.isoformat() if row.as_of else '-'} "
                f"rows={row.row_count} hash={row.content_hash[:16]}"
            )
    else:
        lines.append("- （未绑定具体 Snapshot）")
    if metrics:
        lines.append("指标契约：")
        for metric in metrics:
            lines.append(f"- {metric['metric_id']} {metric['name']} ({metric.get('unit') or ''})")
    if bindings.get("scope"):
        lines.append(f"范围：{bindings['scope']}")
    if bindings.get("brand_ids"):
        lines.append(f"品牌：{', '.join(bindings['brand_ids'])}")
    return "\n".join(lines)


def resolve_knowledge_scope(
    *,
    user,
    scope: dict | None,
    agent_kb_ids: list[int] | None = None,
    query: str = "",
    limit_per_kb: int = 2,
) -> dict[str, Any]:
    """Resolve knowledge_scope to visible KB excerpts for the current user."""
    knowledge = normalize_knowledge_scope(scope)
    kb_ids = knowledge["knowledge_base_ids"] or list(agent_kb_ids or [])
    if not kb_ids:
        return {
            "ok": True,
            "knowledge_base_ids": [],
            "knowledge_bases": [],
            "excerpts": [],
            "context_text": "",
            "retrieval_hint": knowledge["retrieval_hint"],
        }

    qs = visible_knowledge_bases(user).filter(id__in=kb_ids)
    knowledge_bases = [{"id": kb.id, "name": kb.name, "visibility": kb.visibility} for kb in qs]
    visible_ids = {kb["id"] for kb in knowledge_bases}
    missing = [kid for kid in kb_ids if kid not in visible_ids]

    excerpts: list[str] = []
    search_query = (knowledge["retrieval_hint"] or query or "").strip()
    if search_query and knowledge_bases:
        try:
            from apps.knowledge.traditional_rag import keyword_search, semantic_search
        except Exception:
            keyword_search = semantic_search = None  # type: ignore

        for kb in knowledge_bases[:6]:
            hits = []
            if semantic_search:
                try:
                    hits = semantic_search(query=search_query, knowledge_base_id=kb["id"], limit=limit_per_kb) or []
                except Exception:
                    hits = []
            if not hits and keyword_search:
                try:
                    hits = keyword_search(query=search_query, knowledge_base_id=kb["id"], limit=limit_per_kb) or []
                except Exception:
                    hits = []
            for hit in hits[:limit_per_kb]:
                text = ""
                if isinstance(hit, dict):
                    text = str(hit.get("text") or hit.get("content") or hit.get("chunk") or "")
                else:
                    text = str(
                        getattr(hit, "text_preview", "")
                        or getattr(hit, "text", "")
                        or getattr(hit, "content", "")
                        or ""
                    )
                if text.strip():
                    excerpts.append(f"[{kb['name']}] {text.strip()[:1200]}")

    context_parts = []
    if knowledge_bases:
        context_parts.append("知识库：" + "、".join(kb["name"] for kb in knowledge_bases))
    if excerpts:
        context_parts.append("知识摘录：\n" + "\n\n".join(excerpts))
    elif knowledge_bases and search_query:
        context_parts.append(f"已绑定知识库，但未检索到与「{search_query[:80]}」相关的片段。")

    return {
        "ok": not missing,
        "knowledge_base_ids": [kb["id"] for kb in knowledge_bases],
        "knowledge_bases": knowledge_bases,
        "excerpts": excerpts,
        "context_text": "\n".join(context_parts),
        "retrieval_hint": knowledge["retrieval_hint"],
        "errors": [f"knowledge_base_id={kid} 不可见或不存在" for kid in missing],
    }


def merge_payload_with_bindings(payload: dict, *resolved_bindings: dict) -> dict:
    merged = dict(payload or {})
    for resolved in resolved_bindings:
        patch = (resolved or {}).get("payload_patch") or {}
        for key, value in patch.items():
            if key in {"snapshot_ids", "brand_ids", "metric_ids", "asset_keys"}:
                existing = merged.get(key)
                if isinstance(existing, list) and isinstance(value, list):
                    merged[key] = list(dict.fromkeys([*existing, *value]))
                else:
                    merged[key] = value
            elif key == "snapshot_id":
                if merged.get("snapshot_id") in (None, "", []):
                    merged[key] = value
            elif key not in merged or merged.get(key) in (None, "", []):
                merged[key] = value
    return merged


def action_allowed(allowed_actions: list[str] | None, *, action_name: str = "", need_knowledge: bool = False) -> bool:
    allowed = [str(item) for item in (allowed_actions or [])]
    if not allowed:
        return True
    if need_knowledge:
        return "query_knowledge" in allowed
    if action_name:
        return f"call_action:{action_name}" in allowed or "continue_flow" in allowed
    return True
