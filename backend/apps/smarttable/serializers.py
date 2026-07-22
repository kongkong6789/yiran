from rest_framework import serializers

from .models import SmartAutomation, SmartColumn, SmartRow, SmartSheet, SmartView


class SmartColumnSerializer(serializers.ModelSerializer):
    class Meta:
        model = SmartColumn
        fields = ("id", "key", "title", "field_type", "options", "position")


class SmartRowSerializer(serializers.ModelSerializer):
    class Meta:
        model = SmartRow
        fields = ("id", "values", "position", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class SmartViewSerializer(serializers.ModelSerializer):
    class Meta:
        model = SmartView
        fields = ("id", "name", "view_type", "config", "position", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class SmartAutomationSerializer(serializers.ModelSerializer):
    class Meta:
        model = SmartAutomation
        fields = (
            "id",
            "name",
            "enabled",
            "trigger",
            "action",
            "config",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")


class SmartSheetListSerializer(serializers.ModelSerializer):
    column_count = serializers.IntegerField(source="columns.count", read_only=True)
    row_count = serializers.IntegerField(source="rows.count", read_only=True)
    owner_name = serializers.SerializerMethodField()
    organization_id = serializers.IntegerField(read_only=True, allow_null=True)
    knowledge_base = serializers.IntegerField(source="knowledge_base_id", allow_null=True, required=False)
    can_manage = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = SmartSheet
        fields = (
            "id",
            "name",
            "description",
            "owner_name",
            "organization_id",
            "knowledge_base",
            "can_manage",
            "is_mine",
            "column_count",
            "row_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_owner_name(self, obj):
        owner = getattr(obj, "owner", None)
        if not owner:
            return ""
        return (getattr(owner, "username", "") or "").strip()

    def get_can_manage(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return False
        if obj.owner_id == user.id or getattr(user, "is_superuser", False):
            return True
        from apps.core.organizations import is_organization_admin

        return bool(obj.organization_id and is_organization_admin(user, obj.organization))

    def get_is_mine(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        return bool(user and obj.owner_id == getattr(user, "id", None))


class SmartSheetDetailSerializer(SmartSheetListSerializer):
    columns = SmartColumnSerializer(many=True, read_only=True)
    rows = SmartRowSerializer(many=True, read_only=True)
    views = SmartViewSerializer(many=True, read_only=True)
    automations = SmartAutomationSerializer(many=True, read_only=True)

    class Meta(SmartSheetListSerializer.Meta):
        fields = SmartSheetListSerializer.Meta.fields + (
            "columns",
            "rows",
            "views",
            "automations",
        )
