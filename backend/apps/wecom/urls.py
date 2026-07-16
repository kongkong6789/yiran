from django.urls import path

from . import views


urlpatterns = [
    path("callback/<uuid:callback_key>/", views.callback, name="wecom-callback"),
    path("config/", views.api_config, name="wecom-api-config"),
    path("config/test/", views.test_api_config, name="wecom-api-config-test"),
    path("contacts/", views.contacts, name="wecom-contacts"),
    path("callback-events/", views.callback_events, name="wecom-callback-events"),
    path("group-webhooks/", views.group_webhooks, name="wecom-group-webhooks"),
    path("group-webhooks/<int:webhook_id>/", views.group_webhook_detail, name="wecom-group-webhook-detail"),
    path("group-webhooks/<int:webhook_id>/test/", views.group_webhook_test, name="wecom-group-webhook-test"),
    path("notifications/", views.notifications, name="wecom-notifications"),
    path("notifications/<int:notification_id>/retry/", views.retry_notification_view, name="wecom-notifications-retry"),
    path("bindings/", views.bindings, name="wecom-bindings"),
    path("bindings/sync/", views.sync_bindings, name="wecom-bindings-sync"),
    path("bindings/manual/", views.manual_binding, name="wecom-bindings-manual"),
    path("bindings/sync-jobs/", views.sync_jobs, name="wecom-bindings-sync-jobs"),
    path("bindings/conflicts/", views.conflicts, name="wecom-bindings-conflicts"),
    path("bindings/<int:user_id>/match/", views.match_binding, name="wecom-bindings-match"),
    path("bindings/<int:binding_id>/logs/", views.binding_logs, name="wecom-bindings-logs"),
    path("bindings/<int:binding_id>/", views.delete_binding, name="wecom-bindings-delete"),
]
