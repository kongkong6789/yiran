from django.contrib import admin

from .models import (
    KnowledgeAuditLog,
    KnowledgeBase,
    KnowledgeChunkRef,
    KnowledgeFile,
    KnowledgeIngestJob,
    KnowledgePermission,
    KnowledgeSourceBinding,
    KnowledgeTemplate,
)


@admin.register(KnowledgeTemplate)
class KnowledgeTemplateAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "kind", "state", "updated_at")
    search_fields = ("name", "category", "template_id")
    list_filter = ("kind", "state", "category")


@admin.register(KnowledgeBase)
class KnowledgeBaseAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "visibility", "retrieval_mode", "status", "file_count", "updated_at")
    search_fields = ("name", "description", "category")
    list_filter = ("visibility", "retrieval_mode", "status", "category")


@admin.register(KnowledgeFile)
class KnowledgeFileAdmin(admin.ModelAdmin):
    list_display = ("original_filename", "knowledge_base", "file_type", "status", "char_count", "chunk_count", "uploaded_at")
    search_fields = ("original_filename", "knowledge_base__name", "content_hash")
    list_filter = ("file_type", "status", "segment_mode")


@admin.register(KnowledgeIngestJob)
class KnowledgeIngestJobAdmin(admin.ModelAdmin):
    list_display = ("file", "status", "stage", "progress", "created_at", "finished_at")
    search_fields = ("file__original_filename", "stage")
    list_filter = ("status", "stage")


admin.site.register(KnowledgeChunkRef)
admin.site.register(KnowledgeSourceBinding)
admin.site.register(KnowledgePermission)
admin.site.register(KnowledgeAuditLog)
