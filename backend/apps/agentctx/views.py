"""Agent Context / Memory REST API。"""
from __future__ import annotations

from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .assembler import build_debug_pack
from .models import AgentMemoryItem, AgentSessionSummary


def _mem_payload(item: AgentMemoryItem) -> dict:
    return {
        "id": item.id,
        "scope": item.scope,
        "session_id": str(item.session_id) if item.session_id else None,
        "kind": item.kind,
        "content": item.content,
        "source": item.source,
        "importance": item.importance,
        "expires_at": item.expires_at.isoformat() if item.expires_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def _summary_payload(row: AgentSessionSummary) -> dict:
    return {
        "id": row.id,
        "session_key": row.session_key,
        "summary": row.summary,
        "message_count": row.message_count,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def memory_list(request):
    if request.method == "GET":
        qs = AgentMemoryItem.objects.filter(user=request.user)
        scope = (request.query_params.get("scope") or "").strip()
        kind = (request.query_params.get("kind") or "").strip()
        if scope:
            qs = qs.filter(scope=scope)
        if kind:
            qs = qs.filter(kind=kind)
        rows = [_mem_payload(i) for i in qs[:100]]
        return Response({"count": len(rows), "results": rows})

    data = request.data or {}
    content = str(data.get("content") or "").strip()
    if not content:
        return Response({"ok": False, "error": "content 不能为空"}, status=400)
    kind = str(data.get("kind") or AgentMemoryItem.Kind.FACT).strip()
    if kind not in {c.value for c in AgentMemoryItem.Kind}:
        kind = AgentMemoryItem.Kind.FACT
    scope = str(data.get("scope") or AgentMemoryItem.Scope.USER).strip()
    if scope not in {c.value for c in AgentMemoryItem.Scope}:
        scope = AgentMemoryItem.Scope.USER
    session_id = data.get("session_id") or None
    item = AgentMemoryItem.objects.create(
        user=request.user,
        scope=scope,
        session_id=session_id,
        kind=kind,
        content=content[:2000],
        source=str(data.get("source") or "manual")[:64],
        importance=int(data.get("importance") or 5),
        expires_at=parse_datetime(str(data["expires_at"])) if data.get("expires_at") else None,
    )
    return Response({"ok": True, "item": _mem_payload(item)}, status=201)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def memory_detail(request, pk: int):
    item = get_object_or_404(AgentMemoryItem, id=pk, user=request.user)
    if request.method == "GET":
        return Response(_mem_payload(item))
    if request.method == "DELETE":
        item.delete()
        return Response({"ok": True})
    data = request.data or {}
    if "content" in data:
        content = str(data.get("content") or "").strip()
        if not content:
            return Response({"ok": False, "error": "content 不能为空"}, status=400)
        item.content = content[:2000]
    if "kind" in data and str(data["kind"]) in {c.value for c in AgentMemoryItem.Kind}:
        item.kind = str(data["kind"])
    if "scope" in data and str(data["scope"]) in {c.value for c in AgentMemoryItem.Scope}:
        item.scope = str(data["scope"])
    if "importance" in data:
        try:
            item.importance = max(0, min(10, int(data["importance"])))
        except (TypeError, ValueError):
            pass
    if "source" in data:
        item.source = str(data.get("source") or "")[:64]
    if "expires_at" in data:
        raw = data.get("expires_at")
        item.expires_at = parse_datetime(str(raw)) if raw else None
    item.save()
    return Response({"ok": True, "item": _mem_payload(item)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def summary_list(request):
    qs = AgentSessionSummary.objects.filter(user=request.user)
    session_key = (request.query_params.get("session_key") or "").strip()
    if session_key:
        qs = qs.filter(session_key=session_key)
    rows = [_summary_payload(r) for r in qs[:100]]
    return Response({"count": len(rows), "results": rows})


@api_view(["GET", "DELETE"])
@permission_classes([IsAuthenticated])
def summary_detail(request, pk: int):
    row = get_object_or_404(AgentSessionSummary, id=pk, user=request.user)
    if request.method == "DELETE":
        row.delete()
        return Response({"ok": True})
    return Response(_summary_payload(row))


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def summary_by_key(request):
    session_key = (
        request.query_params.get("session_key")
        or (request.data.get("session_key") if hasattr(request, "data") else None)
        or ""
    ).strip()
    if not session_key:
        return Response({"ok": False, "error": "session_key 必填"}, status=400)
    deleted, _ = AgentSessionSummary.objects.filter(
        user=request.user, session_key=session_key
    ).delete()
    return Response({"ok": True, "deleted": deleted})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def debug_pack(request):
    q = (request.query_params.get("q") or "").strip()
    session_key = (request.query_params.get("session_key") or "").strip() or None
    return Response(build_debug_pack(request.user, query=q, session_key=session_key))
