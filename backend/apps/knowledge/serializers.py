from rest_framework import serializers

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


class KnowledgeTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = KnowledgeTemplate
        fields = "__all__"


class KnowledgeBaseSerializer(serializers.ModelSerializer):
    owner_username = serializers.SerializerMethodField()

    def get_owner_username(self, obj):
        return None

    class Meta:
        model = KnowledgeBase
        fields = "__all__"
        read_only_fields = ["file_count", "app_count", "recall_count", "created_at", "updated_at", "archived_at"]


class KnowledgeFileSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()

    def get_uploaded_by_username(self, obj):
        return None

    def get_download_url(self, obj):
        return f"/api/knowledge/files/{obj.id}/download/"

    class Meta:
        model = KnowledgeFile
        fields = "__all__"
        read_only_fields = ["uploaded_by", "uploaded_at", "updated_at", "archived_at"]


class KnowledgeIngestJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = KnowledgeIngestJob
        fields = "__all__"
        read_only_fields = ["created_by", "created_at", "updated_at"]


class KnowledgeChunkRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = KnowledgeChunkRef
        fields = "__all__"


class KnowledgeSourceBindingSerializer(serializers.ModelSerializer):
    class Meta:
        model = KnowledgeSourceBinding
        fields = "__all__"


class KnowledgePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = KnowledgePermission
        fields = "__all__"


class KnowledgeAuditLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.SerializerMethodField()

    def get_actor_username(self, obj):
        return None

    class Meta:
        model = KnowledgeAuditLog
        fields = "__all__"
        read_only_fields = ["actor", "created_at"]

