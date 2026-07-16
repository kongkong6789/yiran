from django.urls import path

from . import auth_views, views

urlpatterns = [
    path("health/", views.health, name="health"),
    path("auth/register/", auth_views.register, name="auth-register"),
    path("auth/login/", auth_views.login, name="auth-login"),
    path("auth/logout/", auth_views.logout, name="auth-logout"),
    path("auth/me/", auth_views.me, name="auth-me"),
    path("auth/settings/", auth_views.user_settings, name="auth-settings"),
    path("auth/password/", auth_views.change_password, name="auth-change-password"),
    path("auth/admin/users/", auth_views.admin_users, name="auth-admin-users"),
    path("auth/admin/users/<int:user_id>/", auth_views.admin_user_detail, name="auth-admin-user-detail"),
    path("auth/avatar/", auth_views.upload_avatar, name="auth-avatar-upload"),
    path("auth/avatars/<str:stored_id>/", auth_views.serve_avatar, name="auth-avatar-serve"),
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
    path("task-results/", views.task_results, name="task-results"),
    path("task-results/<str:trace_id>/", views.task_result_detail, name="task-result-detail"),
    path("task-results/<str:trace_id>/export/", views.task_result_export, name="task-result-export"),
    path("task-results/<str:trace_id>/follow-ups/", views.task_result_follow_up, name="task-result-follow-up"),
    path("task-results/<str:trace_id>/attention/<str:item_id>/resolve/", views.task_attention_resolve, name="task-attention-resolve"),
    path("tasks/", views.work_tasks, name="work-tasks"),
    path("tasks/<str:trace_id>/", views.work_task_detail, name="work-task-detail"),
    path("tasks/<str:trace_id>/artifacts/<int:artifact_id>/preview/", views.work_task_artifact_preview, name="work-task-artifact-preview"),
    path("tasks/<str:trace_id>/artifacts/<int:artifact_id>/download/", views.work_task_artifact_download, name="work-task-artifact-download"),
]
