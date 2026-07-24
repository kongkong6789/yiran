from django.contrib import admin

from .models import AgentProfile, Meeting, Message, Deliverable


@admin.register(AgentProfile)
class AgentProfileAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "employee_code",
        "organization",
        "owner",
        "lifecycle_status",
        "role",
        "created_at",
    )
    list_filter = ("organization", "lifecycle_status", "execution_role")
    search_fields = ("name", "employee_code", "role", "expertise", "owner__username")
    fields = (
        "organization",
        "name",
        "emoji",
        "employee_code",
        "group",
        "role",
        "expertise",
        "persona",
        "execution_role",
        "is_active",
        "lifecycle_status",
        "skill_ids",
        "sop_keys",
        "knowledge_base_ids",
        "capability_instructions",
        "owner",
        "created_by",
        "archived_at",
        "created_at",
    )
    readonly_fields = ("employee_code", "created_by", "archived_at", "created_at")


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
