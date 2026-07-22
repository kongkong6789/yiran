from django.contrib.auth import get_user_model
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
    can_edit = serializers.SerializerMethodField()

    def get_owner_username(self, obj):
        if not obj.owner_user_id:
            return None
        user = get_user_model().objects.filter(id=obj.owner_user_id).only("username").first()
        return user.username if user else None

    def get_can_edit(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not getattr(user, "is_authenticated", False):
            return False
        return bool(user.is_staff or user.is_superuser or obj.owner_user_id == user.id)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        instance = self.instance
        name = (attrs.get("name", getattr(instance, "name", "")) or "").strip()
        visibility = attrs.get("visibility", getattr(instance, "visibility", KnowledgeBase.Visibility.TEAM))
        owner_user_id = getattr(instance, "owner_user_id", None)
        if instance is None and getattr(user, "is_authenticated", False):
            owner_user_id = user.id

        if not name:
            raise serializers.ValidationError({"name": "请填写知识库名称。"})

        duplicates = KnowledgeBase.objects.filter(
            archived_at__isnull=True,
            name__iexact=name,
            visibility=visibility,
        )
        if instance is not None:
            duplicates = duplicates.exclude(pk=instance.pk)
        if visibility == KnowledgeBase.Visibility.PRIVATE:
            duplicates = duplicates.filter(owner_user_id=owner_user_id)

        if duplicates.exists():
            if visibility == KnowledgeBase.Visibility.PRIVATE:
                message = "你的个人知识库中已存在同名知识库。"
            elif visibility == KnowledgeBase.Visibility.TEAM:
                message = "团队知识库中已存在同名知识库。"
            else:
                message = "公司知识库中已存在同名知识库。"
            raise serializers.ValidationError({"name": message})

        attrs["name"] = name
        return attrs

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
