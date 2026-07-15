"""MCP 服务 API:列表 / 保存配置 / 探测 / Cursor 片段。"""
from __future__ import annotations

import json

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .registry import REGISTRY, cursor_snippet, get_def, resolve_config, save_config
from .client import probe_streamable_http


def _status_from_cfg(cfg: dict) -> str:
    if not cfg.get("enabled", True):
        return "disabled"
    return "configured" if cfg.get("configured") else "unconfigured"


def _detail_payload(defn, cfg: dict) -> dict:
    snippet = cursor_snippet(defn, cfg)
    st = _status_from_cfg(cfg)
    return {
        **cfg,
        "status": st,
        "cursor_config": {"mcpServers": snippet},
        "cursor_json": json.dumps({"mcpServers": snippet}, ensure_ascii=False, indent=2),
    }


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def server_import(request, server_id: str):
    defn = get_def(server_id)
    if not defn:
        return Response({"error": f"未知 MCP Server: {server_id}"}, status=status.HTTP_404_NOT_FOUND)
    raw = request.data.get("cursor_json") or request.data.get("json") or request.data.get("text") or ""
    try:
        cfg = save_config(
            server_id,
            {"import_json": raw, "enabled": request.data.get("enabled", True)},
            user=request.user,
        )
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"ok": True, **_detail_payload(defn, cfg)})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def servers(request):
    from .registry import list_servers
    rows = list_servers(user=request.user)
    results = [{**row, "status": _status_from_cfg(row)} for row in rows]
    return Response({"count": len(results), "results": results})


@api_view(["GET", "PUT", "PATCH"])
@permission_classes([IsAuthenticated])
def server_detail(request, server_id: str):
    defn = get_def(server_id)
    if not defn:
        return Response({"error": f"未知 MCP Server: {server_id}"}, status=status.HTTP_404_NOT_FOUND)

    if request.method in ("PUT", "PATCH"):
        try:
            cfg = save_config(server_id, request.data, user=request.user)
        except ValueError as exc:
            return Response({"ok": False, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"ok": True, **_detail_payload(defn, cfg)})

    cfg = resolve_config(defn, user=request.user)
    return Response(_detail_payload(defn, cfg))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def server_config(request, server_id: str):
    defn = get_def(server_id)
    if not defn:
        return Response({"error": f"未知 MCP Server: {server_id}"}, status=status.HTTP_404_NOT_FOUND)
    cfg = resolve_config(defn, user=request.user)
    snippet = cursor_snippet(defn, cfg)
    return Response({
        "id": server_id,
        "configured": cfg["configured"],
        "mcpServers": snippet,
        "json": json.dumps({"mcpServers": snippet}, ensure_ascii=False, indent=2),
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def server_probe(request, server_id: str):
    defn = get_def(server_id)
    if not defn:
        return Response({"error": f"未知 MCP Server: {server_id}"}, status=status.HTTP_404_NOT_FOUND)

    cfg = resolve_config(defn, user=request.user)
    if not cfg["enabled"]:
        return Response({"ok": False, "status": "disabled", "message": "该 MCP 服务已在界面禁用"})
    if not cfg["configured"]:
        return Response({
            "ok": False,
            "status": "unconfigured",
            "message": "未配置,请填写个人 MCP 配置后保存",
        })

    transport = cfg.get("transport") or defn.transport
    if transport == "stdio":
        env_hint = ""
        if cfg.get("env"):
            keys = ", ".join(cfg["env"].keys())
            env_hint = f"; env: {keys}"
        return Response({
            "ok": True,
            "status": "configured",
            "message": f"stdio 已配置: {cfg['command']} {' '.join(cfg['args'])}{env_hint}",
            "note": "stdio 由本机进程拉起",
            "transport": "stdio",
        })

    if transport in ("streamable_http", "sse"):
        probe = probe_streamable_http(cfg["url"])
        probe["url"] = cfg["url"]
        probe["transport"] = transport
        return Response(probe)

    return Response({"ok": False, "status": "error", "message": "未知传输类型"})
