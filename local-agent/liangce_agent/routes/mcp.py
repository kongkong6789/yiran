from __future__ import annotations

from flask import jsonify, request

from ..services.mcp_client import probe_streamable_http
from ..services.mcp_registry import REGISTRY, detail_payload, get_def, parse_cursor_json, resolve_config, save_config
from .auth import current_store, login_required


def register_mcp_routes(app):
    @app.get("/api/mcp/servers")
    @login_required
    def mcp_servers():
        store = current_store()
        rows = [resolve_config(store, item) for item in REGISTRY]
        return jsonify({"count": len(rows), "results": rows})

    @app.get("/api/mcp/servers/<server_id>")
    @login_required
    def mcp_server_detail(server_id: str):
        store = current_store()
        defn = get_def(server_id)
        if not defn:
            return jsonify({"error": f"未知 MCP Server: {server_id}"}), 404
        return jsonify(detail_payload(store, defn))

    @app.put("/api/mcp/servers/<server_id>")
    @login_required
    def mcp_server_save(server_id: str):
        store = current_store()
        defn = get_def(server_id)
        if not defn:
            return jsonify({"error": f"未知 MCP Server: {server_id}"}), 404
        try:
            cfg = save_config(store, server_id, request.get_json(silent=True) or {})
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400
        return jsonify({"ok": True, **detail_payload(store, defn)})

    @app.post("/api/mcp/servers/<server_id>/import")
    @login_required
    def mcp_server_import(server_id: str):
        store = current_store()
        defn = get_def(server_id)
        if not defn:
            return jsonify({"error": f"未知 MCP Server: {server_id}"}), 404
        body = request.get_json(silent=True) or {}
        raw = body.get("cursor_json") or body.get("json") or ""
        try:
            save_config(store, server_id, {"import_json": raw, "enabled": True})
        except ValueError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 400
        return jsonify({"ok": True, **detail_payload(store, defn)})

    @app.post("/api/mcp/servers/<server_id>/probe")
    @login_required
    def mcp_server_probe(server_id: str):
        store = current_store()
        defn = get_def(server_id)
        if not defn:
            return jsonify({"error": f"未知 MCP Server: {server_id}"}), 404
        cfg = resolve_config(store, defn)
        if not cfg.get("configured"):
            return jsonify({"ok": False, "status": "unconfigured", "message": "请先保存 MCP 配置"})
        if cfg.get("transport") == "stdio":
            return jsonify({
                "ok": True,
                "status": "configured",
                "message": f"stdio 已配置: {cfg['command']}",
                "note": "stdio 由本机进程拉起",
            })
        probe = probe_streamable_http(cfg["url"])
        probe["url"] = cfg["url"]
        probe["local_path"] = cfg.get("local_path")
        return jsonify(probe)

    @app.put("/api/settings/llm")
    @login_required
    def save_llm_settings():
        store = current_store()
        body = request.get_json(silent=True) or {}
        store.save_llm({
            "api_key": str(body.get("api_key") or "").strip(),
            "base_url": str(body.get("base_url") or "").strip(),
            "model": str(body.get("model") or "").strip(),
        })
        return jsonify({"ok": True})

    @app.get("/api/settings/llm")
    @login_required
    def get_llm_settings():
        store = current_store()
        data = store.read_llm()
        return jsonify({
            "api_key": "***" if data.get("api_key") else "",
            "base_url": data.get("base_url") or "",
            "model": data.get("model") or "",
            "configured": bool(data.get("api_key")),
        })
