from django.urls import path

from . import realtime, views

urlpatterns = [
    path("rooms/", views.room_list, name="collab-rooms"),
    path("rooms/<uuid:room_id>/", views.room_detail, name="collab-room-detail"),
    path("rooms/<uuid:room_id>/messages/", views.room_messages, name="collab-room-messages"),
    path("rooms/<uuid:room_id>/events/", realtime.room_events, name="collab-room-events"),
    path("rooms/<uuid:room_id>/presence/", realtime.room_presence, name="collab-room-presence"),
    path("rooms/<uuid:room_id>/insights/", views.room_insights, name="collab-room-insights"),
    path("rooms/<uuid:room_id>/draft-check/", views.room_draft_check, name="collab-room-draft-check"),
    path("rooms/<uuid:room_id>/members/", views.room_members, name="collab-room-members"),
    path("rooms/<uuid:room_id>/stats/", views.room_stats, name="collab-room-stats"),
    path("rooms/<uuid:room_id>/summaries/", views.room_summaries, name="collab-room-summaries"),
    path("rooms/<uuid:room_id>/read/", views.room_mark_read, name="collab-room-read"),
    path("unread/", views.unread_summary, name="collab-unread"),
    path("users/", views.list_users, name="collab-users"),
    path("presence/", views.presence_heartbeat, name="collab-presence"),
    path("rooms/<uuid:room_id>/messages/<int:message_id>/", views.room_message_detail, name="collab-room-message"),
    path("attachments/<str:stored_id>/", views.collab_attachment, name="collab-attachment"),
]
