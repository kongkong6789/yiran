from rest_framework import serializers

from .models import (
    UserWeComBinding, WeComApiConfig, WeComBindingAuditLog, WeComBindingSyncJob,
    WeComCallbackEvent, WeComGroupWebhook, WeComNotificationRecord,
)
from .phone import mask_phone
from .callback_service import callback_url
from urllib.parse import parse_qs, urlparse


MASK = "***"


class WeComApiConfigSerializer(serializers.Serializer):
    corpId = serializers.CharField(max_length=128, allow_blank=False)
    agentId = serializers.CharField(max_length=64, allow_blank=False)
    secret = serializers.CharField(max_length=512, allow_blank=False, trim_whitespace=False)

    def validate(self, attrs):
        instance = getattr(self, "instance", None)
        if attrs.get("secret") == MASK and not getattr(instance, "secret_encrypted", ""):
            raise serializers.ValidationError({"secret": "请填写应用 Secret。"})
        return attrs

    def to_representation(self, instance: WeComApiConfig):
        instance.ensure_callback_credentials()
        return {
            "corpId": instance.corp_id,
            "agentId": instance.agent_id,
            "secret": MASK if instance.secret_encrypted else "",
            "callbackUrl": callback_url(instance, self.context.get("request")),
            "token": instance.token,
            "encodingAesKey": instance.encoding_aes_key,
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
        if cache_identity_changed:
            instance.contacts.all().delete()
            instance.contacts_synced_at = None
            instance.contacts_sync_error = ""
            instance.save(update_fields=["contacts_synced_at", "contacts_sync_error", "updated_at"])
        return instance

    def create(self, validated_data: dict):
        user = self.context["request"].user
        instance = WeComApiConfig(user=user)
        return self.update(instance, validated_data)


class WeComContactSerializer(serializers.Serializer):
    key = serializers.CharField()
    name = serializers.CharField()
    department = serializers.CharField(allow_blank=True)
    departmentIds = serializers.ListField(child=serializers.IntegerField())
    weComUserId = serializers.CharField()
    position = serializers.CharField(allow_blank=True)
    avatar = serializers.URLField(allow_blank=True)
    available = serializers.BooleanField()
    source = serializers.ChoiceField(choices=["wecom"])


class UserWeComBindingSerializer(serializers.ModelSerializer):
    platformUserId = serializers.IntegerField(source="platform_user_id", read_only=True)
    platformUser = serializers.SerializerMethodField()
    phoneMasked = serializers.SerializerMethodField()
    weComUserId = serializers.CharField(source="wecom_userid", read_only=True)
    weComMember = serializers.SerializerMethodField()
    statusLabel = serializers.CharField(source="get_status_display", read_only=True)
    sourceLabel = serializers.CharField(source="get_source_display", read_only=True)
    matchedAt = serializers.DateTimeField(source="matched_at", read_only=True)
    verifiedAt = serializers.DateTimeField(source="verified_at", read_only=True)
    nextRetryAt = serializers.DateTimeField(source="next_retry_at", read_only=True)
    failureReason = serializers.CharField(source="failure_reason", read_only=True)

    class Meta:
        model = UserWeComBinding
        fields = [
            "id", "platformUserId", "platformUser", "phoneMasked", "weComUserId",
            "weComMember", "status", "statusLabel", "source", "sourceLabel",
            "matchedAt", "verifiedAt", "nextRetryAt", "failureReason", "retry_count",
        ]

    def get_platformUser(self, obj):
        profile = getattr(obj.platform_user, "settings", None)
        return (getattr(profile, "display_name", "") or obj.platform_user.username).strip()

    def get_phoneMasked(self, obj):
        profile = getattr(obj.platform_user, "settings", None)
        return mask_phone(getattr(profile, "phone", ""))

    def get_weComMember(self, obj):
        return obj.wecom_userid or ""


class ManualBindingSerializer(serializers.Serializer):
    platformUserId = serializers.IntegerField(min_value=1)
    weComUserId = serializers.CharField(max_length=128, allow_blank=False)


class BindingSyncJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeComBindingSyncJob
        fields = "__all__"


class BindingAuditLogSerializer(serializers.ModelSerializer):
    actorName = serializers.CharField(source="actor.username", read_only=True, default="系统")

    class Meta:
        model = WeComBindingAuditLog
        fields = ["id", "action", "status", "message", "metadata", "actorName", "created_at"]


class WeComCallbackEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeComCallbackEvent
        fields = ["id", "msg_type", "event_type", "change_type", "from_user_id", "to_user_name", "event_key", "payload", "processing_status", "processing_result", "attempt_count", "next_retry_at", "processed_at", "failure_reason", "received_at"]


class WeComGroupWebhookSerializer(serializers.ModelSerializer):
    webhookUrl = serializers.CharField(write_only=True, required=False, allow_blank=False, max_length=1000)
    maskedWebhook = serializers.SerializerMethodField()

    class Meta:
        model = WeComGroupWebhook
        fields = ["id", "name", "webhookUrl", "maskedWebhook", "enabled", "last_success_at", "last_failure_at", "last_error_code", "last_error_reason", "created_at", "updated_at"]
        read_only_fields = ["id", "maskedWebhook", "last_success_at", "last_failure_at", "last_error_code", "last_error_reason", "created_at", "updated_at"]

    def get_maskedWebhook(self, obj):
        key = obj.webhook_key
        return f"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=***{key[-6:]}" if key else ""

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
        if request and "name" in attrs:
            duplicate = WeComGroupWebhook.objects.filter(user=request.user, name=attrs["name"])
            if self.instance:
                duplicate = duplicate.exclude(pk=self.instance.pk)
            if duplicate.exists():
                raise serializers.ValidationError({"name": "该群聊名称已经存在。"})
        return attrs

    def create(self, validated_data):
        key = validated_data.pop("webhookUrl", "")
        row = WeComGroupWebhook(user=self.context["request"].user, **validated_data)
        row.webhook_key = key
        row.save()
        return row

    def update(self, instance, validated_data):
        key = validated_data.pop("webhookUrl", "")
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if key:
            instance.webhook_key = key
        instance.save()
        return instance


class TaskNotificationSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=["person", "group"])
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
        if attrs["mode"] == "person" and not attrs.get("recipientUserIds"):
            raise serializers.ValidationError({"recipientUserIds": "请选择至少一位企业微信成员。"})
        if attrs["mode"] == "group" and not attrs.get("groupWebhookId"):
            raise serializers.ValidationError({"groupWebhookId": "请选择群机器人 Webhook。"})
        return attrs


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
