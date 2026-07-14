from __future__ import annotations

from flask import jsonify, request

from ..services import agent_chat
from .auth import current_store, login_required


def register_chat_routes(app):
    @app.get("/api/agent/sessions")
    @login_required
    def chat_sessions():
        store = current_store()
        return jsonify({"count": 0, "results": store.list_chats() if store else []})

    @app.get("/api/agent/sessions/<session_id>")
    @login_required
    def chat_session_detail(session_id: str):
        store = current_store()
        data = store.read_chat(session_id)
        if not data:
            return jsonify({"error": "对话不存在"}), 404
        return jsonify(data)

    @app.delete("/api/agent/sessions/<session_id>")
    @login_required
    def chat_session_delete(session_id: str):
        store = current_store()
        store.delete_chat(session_id)
        return ("", 204)

    @app.post("/api/agent/chat")
    @login_required
    def agent_chat():
        store = current_store()
        body = request.get_json(silent=True) or {}
        message = str(body.get("message") or "").strip()
        if not message:
            return jsonify({"ok": False, "error": "消息不能为空"}), 400

        session_id = body.get("conversation_id")
        if session_id:
            chat = store.read_chat(session_id)
            if not chat:
                chat = store.create_chat(message[:40])
                session_id = chat["id"]
        else:
            chat = store.create_chat(message[:40])
            session_id = chat["id"]

        history = chat.get("messages") or []
        chat["messages"] = [*history, {"role": "user", "content": message}]
        store.save_chat(session_id, chat)

        result = agent_chat.run_chat(store, message, history)
        if result.get("ok") and result.get("reply"):
            chat = store.read_chat(session_id)
            chat["messages"] = [
                *(chat.get("messages") or []),
                {"role": "assistant", "content": result["reply"], "meta": result},
            ]
            if chat.get("title") == "新对话":
                chat["title"] = message[:40]
            store.save_chat(session_id, chat)

        result["conversation_id"] = session_id
        result["conversation_title"] = store.read_chat(session_id).get("title")
        code = 200 if result.get("ok") else 400
        return jsonify(result), code
