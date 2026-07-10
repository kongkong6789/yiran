from django.contrib import admin

from .models import AgentProfile, Meeting, Message, Deliverable


@admin.register(AgentProfile)
class AgentProfileAdmin(admin.ModelAdmin):
    list_display = ("name", "emoji", "role", "expertise", "created_at")
    search_fields = ("name", "role", "expertise")


@admin.register(Meeting)
class MeetingAdmin(admin.ModelAdmin):
    list_display = ("title", "status", "round", "created_at")
    list_filter = ("status",)


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("meeting", "speaker_name", "round", "created_at")


@admin.register(Deliverable)
class DeliverableAdmin(admin.ModelAdmin):
    list_display = ("meeting", "title", "version", "created_at")
