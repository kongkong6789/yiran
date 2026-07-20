from django.contrib import admin

from .models import AgentMemoryItem, AgentSessionSummary


@admin.register(AgentMemoryItem)
class AgentMemoryItemAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "scope", "kind", "importance", "updated_at")
    list_filter = ("scope", "kind")
    search_fields = ("content", "source", "user__username")


@admin.register(AgentSessionSummary)
class AgentSessionSummaryAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "session_key", "message_count", "updated_at")
    search_fields = ("session_key", "summary", "user__username")
