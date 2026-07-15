from .auth import register_auth_routes
from .chat import register_chat_routes
from .mcp import register_mcp_routes

__all__ = ["register_auth_routes", "register_chat_routes", "register_mcp_routes"]
