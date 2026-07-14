from django.urls import path

from . import auth_views, views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("auth/register/", auth_views.register, name="auth-register"),
    path("auth/login/", auth_views.login, name="auth-login"),
    path("auth/logout/", auth_views.logout, name="auth-logout"),
    path("auth/me/", auth_views.me, name="auth-me"),
    path("auth/settings/", auth_views.user_settings, name="auth-settings"),
    path("agent/chat/", views.agent_chat, name="agent-chat"),
    path("agent/models/", views.agent_models, name="agent-models"),
    path("agent/attachments/<str:stored_id>/", views.agent_attachment, name="agent-attachment"),
    path("agent/sessions/", views.chat_sessions, name="agent-chat-sessions"),
    path(
        "agent/sessions/<uuid:session_id>/",
        views.chat_session_detail,
        name="agent-chat-session-detail",
    ),
    path("audit-logs/", views.audit_logs, name="audit-logs"),
]
