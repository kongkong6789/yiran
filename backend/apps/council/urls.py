from django.urls import path

from . import views

urlpatterns = [
    path("agents/", views.agents, name="council-agents"),
    path("agents/<int:agent_id>/", views.agent_detail, name="council-agent-detail"),
    path("meetings/", views.meetings, name="council-meetings"),
    path("meetings/pause-active/", views.meetings_pause_active, name="council-meetings-pause-active"),
    path("meetings/<int:meeting_id>/", views.meeting_detail, name="council-meeting-detail"),
    path("meetings/<int:meeting_id>/start/", views.meeting_start, name="council-meeting-start"),
    path("meetings/<int:meeting_id>/pause/", views.meeting_pause, name="council-meeting-pause"),
    path("meetings/<int:meeting_id>/messages/", views.meeting_messages, name="council-messages"),
    path("meetings/<int:meeting_id>/tick/", views.meeting_tick, name="council-tick"),
    path("meetings/<int:meeting_id>/interject/", views.meeting_interject, name="council-interject"),
    path("meetings/<int:meeting_id>/invite/", views.meeting_invite, name="council-invite"),
    path("invites/pending/", views.meeting_invites_pending, name="council-invites-pending"),
    path("invites/<int:invite_id>/ack/", views.meeting_invite_ack, name="council-invite-ack"),
    path("meetings/<int:meeting_id>/stop/", views.meeting_stop, name="council-stop"),
    path(
        "meetings/<int:meeting_id>/deliverables/<int:deliverable_id>/download/",
        views.deliverable_download,
        name="council-deliverable-download",
    ),
    path("graph-preview/", views.graph_preview, name="council-graph-preview"),
]
