from __future__ import annotations

from flask import Flask, jsonify

from . import config
from .routes import register_auth_routes, register_chat_routes, register_mcp_routes
from .routes.pages import pages


def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder=str(config.STATIC_DIR),
        template_folder=str(config.TEMPLATES_DIR),
    )
    app.secret_key = config.SECRET_KEY
    app.config["SESSION_COOKIE_HTTPONLY"] = True

    app.register_blueprint(pages)
    register_auth_routes(app)
    register_chat_routes(app)
    register_mcp_routes(app)

    @app.get("/api/health")
    def health():
        return jsonify({
            "status": "ok",
            "service": "liangce-local-agent",
            "data_dir": str(config.DATA_DIR),
        })

    return app
