from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("trace_id", "action", "decision", "actor", "created_at")
    list_filter = ("decision", "actor")
    search_fields = ("trace_id", "action", "intent")
