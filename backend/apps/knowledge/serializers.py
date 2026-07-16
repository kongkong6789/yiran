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
    owner_username = serializers.CharField(source="owner.username", read_only=True)

    class Meta:
        model = KnowledgeBase
        fields = "__all__"
        read_only_fields = ["file_count", "app_count", "recall_count", "created_at", "updated_at", "archived_at"]


class KnowledgeFileSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.CharField(source="uploaded_by.username", read_only=True)

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
    actor_username = serializers.CharField(source="actor.username", read_only=True)

    class Meta:
        model = KnowledgeAuditLog
        fields = "__all__"
        read_only_fields = ["actor", "created_at"]
