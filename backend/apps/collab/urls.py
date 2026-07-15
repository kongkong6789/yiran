from django.urls import path

from . import views

urlpatterns = [
    path("rooms/", views.room_list, name="collab-rooms"),
    path("rooms/<uuid:room_id>/", views.room_detail, name="collab-room-detail"),
    path("rooms/<uuid:room_id>/messages/", views.room_messages, name="collab-room-messages"),
    path("rooms/<uuid:room_id>/insights/", views.room_insights, name="collab-room-insights"),
    path("rooms/<uuid:room_id>/members/", views.room_members, name="collab-room-members"),
    path("rooms/<uuid:room_id>/read/", views.room_mark_read, name="collab-room-read"),
    path("unread/", views.unread_summary, name="collab-unread"),
    path("users/", views.list_users, name="collab-users"),
    path("presence/", views.presence_heartbeat, name="collab-presence"),
    path("attachments/<str:stored_id>/", views.collab_attachment, name="collab-attachment"),
]
