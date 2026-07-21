from rest_framework import serializers
from django.contrib.auth import get_user_model

from apps.core.models import OrganizationMembership
from apps.core.organizations import current_organization
from .models import (
    UserWeComBinding, WeComApiConfig, WeComBindingAuditLog, WeComBindingSyncJob,
    WeComCallbackEvent, WeComGroupWebhook, WeComNotificationRecord,
)
from .phone import mask_phone
from .services import user_friendly_wecom_error
from .callback_service import callback_url
from urllib.parse import parse_qs, urlparse


MASK = "***"
User = get_user_model()


class WeComApiConfigSerializer(serializers.Serializer):
    corpId = serializers.CharField(max_length=128, allow_blank=False)
    agentId = serializers.CharField(max_length=64, allow_blank=False)
    secret = serializers.CharField(max_length=512, allow_blank=False, trim_whitespace=False)
    accessScope = serializers.ChoiceField(choices=WeComApiConfig.AccessScope.choices, required=False)
    allowedUserIds = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False)

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        if attrs.get("secret") == MASK and not getattr(instance, "secret_encrypted", ""):
            raise serializers.ValidationError({"secret": "请填写应用 Secret。"})
        request = self.context.get("request")
        organization = getattr(instance, "organization", None) or (current_organization(request.user) if request else None)
        allowed_ids = attrs.get("allowedUserIds")
        if allowed_ids is not None and organization:
            valid_ids = set(OrganizationMembership.objects.filter(
                organization=organization,
                user_id__in=allowed_ids,
                is_active=True,
            ).values_list("user_id", flat=True))
            if valid_ids != set(allowed_ids):
                raise serializers.ValidationError({"allowedUserIds": "指定成员必须属于当前企业。"})
        return attrs

    def to_representation(self, instance: WeComApiConfig):
        instance.ensure_callback_credentials()
        request = self.context.get("request")
        can_manage = instance.can_manage(request.user) if request else False
        return {
            "corpId": instance.corp_id,
            "agentId": instance.agent_id,
            "secret": MASK if can_manage and instance.secret_encrypted else "",
            "callbackUrl": callback_url(instance, request) if can_manage else "",
            "token": instance.token if can_manage else "",
            "encodingAesKey": instance.encoding_aes_key if can_manage else "",
            "organization": {
                "id": instance.organization_id,
                "name": instance.organization.name,
            } if instance.organization_id else None,
            "accessScope": instance.access_scope,
            "allowedUserIds": list(instance.allowed_users.values_list("id", flat=True)) if can_manage else [],
            "canManage": can_manage,
            "ownerName": instance.user.username,
            "callbackVerified": bool(instance.callback_verified_at),
            "callbackVerifiedAt": instance.callback_verified_at.isoformat() if instance.callback_verified_at else None,
            "lastEventAt": instance.last_event_at.isoformat() if instance.last_event_at else None,
            "contactsSyncedAt": instance.contacts_synced_at.isoformat() if instance.contacts_synced_at else None,
            "contactsSyncError": instance.contacts_sync_error,
            "configured": instance.configured,
            "updatedAt": instance.updated_at.isoformat() if instance.updated_at else None,
        }

    def update(self, instance: WeComApiConfig, validated_data: dict):
        cache_identity_changed = any(
            api_name in validated_data and validated_data[api_name] != getattr(instance, model_name)
            for api_name, model_name in {"corpId": "corp_id", "agentId": "agent_id"}.items()
        ) or ("secret" in validated_data and validated_data["secret"] != MASK)
        scalar_fields = {
            "corpId": "corp_id",
            "agentId": "agent_id",
            "accessScope": "access_scope",
        }
        for api_name, model_name in scalar_fields.items():
            if api_name in validated_data:
                setattr(instance, model_name, validated_data[api_name])

        secret_fields = {
            "secret": "secret",
        }
        for api_name, model_name in secret_fields.items():
            if api_name in validated_data and validated_data[api_name] != MASK:
                setattr(instance, model_name, validated_data[api_name])
        instance.save()
        if "allowedUserIds" in validated_data:
            instance.allowed_users.set(User.objects.filter(id__in=validated_data["allowedUserIds"]))
        if cache_identity_changed:
            instance.contacts.all().delete()
            instance.contacts_synced_at = None
            instance.contacts_sync_error = ""
            instance.save(update_fields=["contacts_synced_at", "contacts_sync_error", "updated_at"])
        return instance

    def create(self, validated_data: dict):
        user = self.context["request"].user
        instance = WeComApiConfig(user=user, organization=current_organization(user))
        return self.update(instance, validated_data)


class WeComContactSerializer(serializers.Serializer):
    contactId = serializers.IntegerField()
    key = serializers.CharField()
    name = serializers.CharField()
    department = serializers.CharField(allow_blank=True)
    departmentIds = serializers.ListField(child=serializers.IntegerField())
    position = serializers.CharField(allow_blank=True)
    avatar = serializers.URLField(allow_blank=True)
    available = serializers.BooleanField()
    source = serializers.ChoiceField(choices=["wecom"])


class WeComManagedContactSerializer(WeComContactSerializer):
    """Manage-only contact shape used by account binding tools."""
    weComUserId = serializers.CharField()


class UserWeComBindingSerializer(serializers.ModelSerializer):
    platformUserId = serializers.IntegerField(source="platform_user_id", read_only=True)
    platformUser = serializers.SerializerMethodField()
    platformAvatar = serializers.SerializerMethodField()
    phoneMasked = serializers.SerializerMethodField()
    weComUserId = serializers.CharField(source="wecom_userid", read_only=True)
    weComMember = serializers.SerializerMethodField()
    weComAvatar = serializers.SerializerMethodField()
    weComDepartment = serializers.SerializerMethodField()
    weComPosition = serializers.SerializerMethodField()
    weComAvailable = serializers.SerializerMethodField()
    statusLabel = serializers.CharField(source="get_status_display", read_only=True)
    sourceLabel = serializers.CharField(source="get_source_display", read_only=True)
    matchedAt = serializers.DateTimeField(source="matched_at", read_only=True)
    verifiedAt = serializers.DateTimeField(source="verified_at", read_only=True)
    nextRetryAt = serializers.DateTimeField(source="next_retry_at", read_only=True)
    failureReason = serializers.SerializerMethodField()

    class Meta:
        model = UserWeComBinding
        fields = [
            "id", "platformUserId", "platformUser", "platformAvatar", "phoneMasked", "weComUserId",
            "weComMember", "weComAvatar", "weComDepartment", "weComPosition", "weComAvailable",
            "status", "statusLabel", "source", "sourceLabel",
            "matchedAt", "verifiedAt", "nextRetryAt", "failureReason", "retry_count",
        ]

    def get_platformUser(self, obj):
        profile = getattr(obj.platform_user, "settings", None)
        return (getattr(profile, "display_name", "") or obj.platform_user.username).strip()

    def get_platformAvatar(self, obj):
        profile = getattr(obj.platform_user, "settings", None)
        return getattr(profile, "avatar_url", "") or ""

    def get_phoneMasked(self, obj):
        profile = getattr(obj.platform_user, "settings", None)
        return mask_phone(getattr(profile, "phone", ""))

    def get_failureReason(self, obj):
        return user_friendly_wecom_error(obj.failure_code, obj.failure_reason) if obj.failure_reason else ""

    def get_weComMember(self, obj):
        contact = self._contact(obj)
        return contact.name if contact else (obj.wecom_userid or "")

    def get_weComAvatar(self, obj):
        contact = self._contact(obj)
        return contact.avatar_url if contact else ""

    def get_weComDepartment(self, obj):
        contact = self._contact(obj)
        return contact.department if contact else ""

    def get_weComPosition(self, obj):
        contact = self._contact(obj)
        return contact.position if contact else ""

    def get_weComAvailable(self, obj):
        contact = self._contact(obj)
        return contact.available if contact else None

    def _contact(self, obj):
        if not obj.wecom_config_id or not obj.wecom_userid:
            return None
        contact_map = self.context.get("contact_map", {})
        cached = contact_map.get((obj.wecom_config_id, obj.wecom_userid))
        if cached:
            return cached
        return obj.wecom_config.contacts.filter(wecom_userid=obj.wecom_userid).first()


class ManualBindingSerializer(serializers.Serializer):
    platformUserId = serializers.IntegerField(min_value=1)
    weComUserId = serializers.CharField(max_length=128, allow_blank=False)


class BindingSyncJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeComBindingSyncJob
        fields = "__all__"


class BindingAuditLogSerializer(serializers.ModelSerializer):
    actorName = serializers.CharField(source="actor.username", read_only=True, default="系统")
    message = serializers.SerializerMethodField()

    class Meta:
        model = WeComBindingAuditLog
        fields = ["id", "action", "status", "message", "metadata", "actorName", "created_at"]

    def get_message(self, obj):
        code = str((obj.metadata or {}).get("failure_code") or "")
        return user_friendly_wecom_error(code, obj.message)


class WeComCallbackEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeComCallbackEvent
        fields = ["id", "msg_type", "event_type", "change_type", "from_user_id", "to_user_name", "event_key", "payload", "processing_status", "processing_result", "attempt_count", "next_retry_at", "processed_at", "failure_reason", "received_at"]


class WeComGroupWebhookSerializer(serializers.ModelSerializer):
    webhookUrl = serializers.CharField(write_only=True, required=False, allow_blank=False, max_length=1000)
    maskedWebhook = serializers.SerializerMethodField()
    accessScope = serializers.ChoiceField(source="access_scope", choices=WeComGroupWebhook.AccessScope.choices, required=False)
    allowedUserIds = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False, write_only=True)
    canManage = serializers.SerializerMethodField()

    class Meta:
        model = WeComGroupWebhook
        fields = ["id", "name", "webhookUrl", "maskedWebhook", "enabled", "accessScope", "allowedUserIds", "canManage", "last_success_at", "last_failure_at", "last_error_code", "last_error_reason", "created_at", "updated_at"]
        read_only_fields = ["id", "maskedWebhook", "canManage", "last_success_at", "last_failure_at", "last_error_code", "last_error_reason", "created_at", "updated_at"]

    def get_maskedWebhook(self, obj):
        key = obj.webhook_key
        return f"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***{key[-6:]}" if key else ""

    def get_canManage(self, obj):
        request = self.context.get("request")
        return obj.can_manage(request.user) if request else False

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        data["allowedUserIds"] = (
            list(instance.allowed_users.values_list("id", flat=True))
            if request and instance.can_manage(request.user)
            else []
        )
        return data

    def validate_webhookUrl(self, value):
        parsed = urlparse(value.strip())
        keys = parse_qs(parsed.query).get("key", [])
        if parsed.scheme != "https" or parsed.hostname != "qyapi.weixin.qq.com" or parsed.path.rstrip("/") != "/cgi-bin/webhook/send" or len(keys) != 1 or len(keys[0]) < 16:
            raise serializers.ValidationError("请输入企业微信群机器人生成的完整 Webhook 地址。")
        return keys[0]

    def validate(self, attrs):
        if self.instance is None and not attrs.get("webhookUrl"):
            raise serializers.ValidationError({"webhookUrl": "请填写完整 Webhook 地址。"})
        request = self.context.get("request")
        organization = getattr(self.instance, "organization", None) or (current_organization(request.user) if request else None)
        if request and "name" in attrs:
            duplicate = WeComGroupWebhook.objects.filter(organization=organization, name=attrs["name"])
            if self.instance:
                duplicate = duplicate.exclude(pk=self.instance.pk)
            if duplicate.exists():
                raise serializers.ValidationError({"name": "该群聊名称已经存在。"})
        allowed_ids = attrs.get("allowedUserIds")
        if allowed_ids is not None and organization:
            valid_ids = set(OrganizationMembership.objects.filter(
                organization=organization,
                user_id__in=allowed_ids,
                is_active=True,
            ).values_list("user_id", flat=True))
            if valid_ids != set(allowed_ids):
                raise serializers.ValidationError({"allowedUserIds": "指定成员必须属于当前企业。"})
        return attrs

    def create(self, validated_data):
        key = validated_data.pop("webhookUrl", "")
        allowed_ids = validated_data.pop("allowedUserIds", [])
        user = self.context["request"].user
        row = WeComGroupWebhook(user=user, organization=current_organization(user), **validated_data)
        row.webhook_key = key
        row.save()
        row.allowed_users.set(User.objects.filter(id__in=allowed_ids))
        return row

    def update(self, instance, validated_data):
        key = validated_data.pop("webhookUrl", "")
        allowed_ids = validated_data.pop("allowedUserIds", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if key:
            instance.webhook_key = key
        instance.save()
        if allowed_ids is not None:
            instance.allowed_users.set(User.objects.filter(id__in=allowed_ids))
        return instance


class TaskNotificationSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=["person", "group"])
    recipientContactIds = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False, max_length=1000)
    recipientUserIds = serializers.ListField(child=serializers.CharField(max_length=128), required=False, max_length=1000)
    groupWebhookId = serializers.IntegerField(required=False, min_value=1)
    task = serializers.CharField(max_length=2000)
    agentName = serializers.CharField(max_length=100, required=False, allow_blank=True)
    deadline = serializers.CharField(max_length=100, required=False, allow_blank=True)
    priority = serializers.ChoiceField(choices=["normal", "high", "urgent"], default="normal")
    targetLabel = serializers.CharField(max_length=255, required=False, allow_blank=True)
    taskTraceId = serializers.CharField(max_length=64, required=False, allow_blank=True)
    idempotencyKey = serializers.CharField(max_length=200, required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["mode"] == "person" and not (attrs.get("recipientContactIds") or attrs.get("recipientUserIds")):
            raise serializers.ValidationError({"recipientContactIds": "请选择至少一位企业微信成员。"})
        if attrs["mode"] == "group" and not attrs.get("groupWebhookId"):
            raise serializers.ValidationError({"groupWebhookId": "请选择群机器人 Webhook。"})
        return attrs


class WorkTodoCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, allow_blank=False)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="")
    assigneeIds = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list, max_length=100,
        help_text="旧版兼容字段，仅表示平台负责人；新接入请使用 platformAssigneeIds。",
    )
    platformAssigneeIds = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list, max_length=100,
        help_text="平台负责人 ID，仅创建平台待办，不会自动加入企业微信待办。",
    )
    wecomContactIds = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list, max_length=100,
        help_text="企业微信通讯录 contactId，精确决定企业微信待办参与人。",
    )
    dueAt = serializers.DateTimeField(required=False, allow_null=True)
    priority = serializers.ChoiceField(
        choices=["normal", "high", "urgent"], required=False, default="normal"
    )
    remindTypes = serializers.ListField(
        child=serializers.IntegerField(min_value=0), required=False, default=list, max_length=10
    )
    syncToWeCom = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        platform_ids = list(dict.fromkeys([*attrs.get("platformAssigneeIds", []), *attrs.get("assigneeIds", [])]))
        contact_ids = list(dict.fromkeys(attrs.get("wecomContactIds", [])))
        if not platform_ids and not contact_ids:
            raise serializers.ValidationError("请至少选择一位平台负责人或企业微信负责人。")
        if attrs.get("syncToWeCom") and not contact_ids:
            raise serializers.ValidationError({"wecomContactIds": "开启企业微信同步后，请至少选择一位企业微信负责人。"})
        if contact_ids and not attrs.get("syncToWeCom"):
            raise serializers.ValidationError({"wecomContactIds": "企业微信负责人必须开启企业微信待办同步。"})
        attrs["platformAssigneeIds"] = platform_ids
        attrs["wecomContactIds"] = contact_ids
        return attrs

    def validate_assigneeIds(self, value):
        return list(dict.fromkeys(value))


class WorkTodoStatusSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=["pending", "completed"])


class WorkTodoUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, allow_blank=False, required=False)
    description = serializers.CharField(max_length=1000, allow_blank=True, required=False)
    dueAt = serializers.DateTimeField(required=False, allow_null=True)
    priority = serializers.ChoiceField(choices=["normal", "high", "urgent"], required=False)
    remindTypes = serializers.ListField(
        child=serializers.ChoiceField(choices=[0, 1, 3, 5, 6, 7, 8, 9]),
        required=False,
        max_length=10,
    )


class WeComNotificationRecordSerializer(serializers.ModelSerializer):
    statusLabel = serializers.CharField(source="get_status_display", read_only=True)
    channelLabel = serializers.CharField(source="get_channel_display", read_only=True)
    userId = serializers.IntegerField(source="user_id", read_only=True)
    userName = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = WeComNotificationRecord
        fields = [
            "id", "userId", "userName", "channel", "channelLabel", "target_label", "status", "statusLabel",
            "wecom_msgid", "invalid_users", "error_code", "error_reason", "retry_count", "max_retries",
            "next_retry_at", "last_attempt_at", "task_trace_id", "accepted_at", "created_at",
        ]
