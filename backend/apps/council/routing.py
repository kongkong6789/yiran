from django.urls import path

from . import consumers
from . import notify_consumers

websocket_urlpatterns = [
    path("ws/council/meetings/<int:meeting_id>/", consumers.MeetingConsumer.as_asgi()),
    path("ws/notify/", notify_consumers.UserNotifyConsumer.as_asgi()),
]
