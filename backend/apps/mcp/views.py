"""MCP 服务 API:列表 / 保存配置 / 探测 / Cursor 片段。"""
from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.http import FileResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .registry import REGISTRY, cursor_snippet, get_def, resolve_config, save_config
from .client import probe_streamable_http
from .nas_files import (
    NasFileError,
    list_directory,
    preview_file,
    read_access_ticket,
    resolve_nas_path,
)


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
    except PermissionError as exc:
        return Response({"ok": False, "error": str(exc)}, status=status.HTTP_403_FORBIDDEN)
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
        except PermissionError as exc:
            return Response({"ok": False, "error": str(exc)}, status=status.HTTP_403_FORBIDDEN)
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
    if not cfg["configured"] and server_id not in ("jackyun", "kingdee", "nas"):
        return Response({
            "ok": False,
            "status": "unconfigured",
            "message": "当前企业尚未配置该 MCP 服务，请联系企业管理员完成配置",
        })

    transport = cfg.get("transport") or defn.transport
    if server_id == "nas":
        try:
            payload = list_directory(request.user, "/")
        except NasFileError as exc:
            return Response({
                "ok": False,
                "status": "unreachable",
                "message": str(exc),
            })
        return Response({
            "ok": True,
            "status": "reachable",
            "message": f"NAS 已连接，可访问 {payload['count']} 个项目",
            "transport": transport,
        })

    if server_id == "jackyun":
        from apps.connectors.credentials import use_connector_secrets
        from apps.connectors.jackyun import jackyun_status

        with use_connector_secrets("jackyun", user=request.user):
            result = jackyun_status(probe=True)
        if result.get("reachable"):
            return Response({
                "ok": True,
                "status": "reachable",
                "message": "吉客云 OpenAPI 连通正常",
                "transport": "openapi",
                "detail": result,
            })
        return Response({
            "ok": False,
            "status": "unreachable" if result.get("configured") else "unconfigured",
            "message": result.get("error") or "吉客云探测失败",
            "transport": "openapi",
            "detail": result,
        })

    if server_id == "kingdee":
        from apps.connectors.credentials import use_connector_secrets
        from apps.connectors.kingdee import kingdee_status

        with use_connector_secrets("kingdee", user=request.user):
            result = kingdee_status(probe=True)
        if result.get("reachable"):
            return Response({
                "ok": True,
                "status": "reachable",
                "message": "金蝶 K3Cloud 登录探测成功",
                "transport": "openapi",
                "detail": result,
            })
        return Response({
            "ok": False,
            "status": "unreachable" if result.get("configured") else "unconfigured",
            "message": result.get("error") or "金蝶探测失败",
            "transport": "openapi",
            "detail": result,
        })

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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def server_files(request, server_id: str):
    if server_id != "nas" or not get_def(server_id):
        return Response({"error": "该连接器不支持文件浏览"}, status=status.HTTP_404_NOT_FOUND)
    try:
        payload = list_directory(request.user, request.query_params.get("path") or "/")
    except NasFileError as exc:
        return Response({"error": str(exc)}, status=exc.status_code)
    return Response(payload)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def server_file_preview(request, server_id: str):
    if server_id != "nas" or not get_def(server_id):
        return Response({"error": "该连接器不支持文件预览"}, status=status.HTTP_404_NOT_FOUND)
    virtual_path = request.query_params.get("path") or ""
    if not virtual_path:
        return Response({"error": "缺少 path 参数"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        payload = preview_file(request.user, virtual_path)
    except NasFileError as exc:
        return Response({"error": str(exc)}, status=exc.status_code)
    return Response(payload)


@api_view(["GET"])
@permission_classes([AllowAny])
def server_file_download(request, server_id: str):
    if server_id != "nas" or not get_def(server_id):
        return Response({"error": "该连接器不支持文件下载"}, status=status.HTTP_404_NOT_FOUND)
    ticket = request.query_params.get("ticket") or ""
    try:
        payload = read_access_ticket(ticket)
        user = get_user_model().objects.filter(id=payload["user_id"], is_active=True).first()
        if not user:
            raise NasFileError("文件链接对应的账号不存在", 403)
        target, _ = resolve_nas_path(user, payload["path"])
        if not target.is_file():
            raise NasFileError("目标路径不是文件", 400)
        as_attachment = request.query_params.get("download", "1") != "0"
        return FileResponse(
            target.open("rb"),
            as_attachment=as_attachment,
            filename=target.name,
            content_type=None,
        )
    except NasFileError as exc:
        return Response({"error": str(exc)}, status=exc.status_code)
    except OSError as exc:
        return Response({"error": f"读取 NAS 文件失败：{exc}"}, status=status.HTTP_502_BAD_GATEWAY)
