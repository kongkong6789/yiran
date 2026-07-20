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

    class Meta:
        model = SmartSheet
        fields = (
            "id",
            "name",
            "description",
            "column_count",
            "row_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")


class SmartSheetDetailSerializer(serializers.ModelSerializer):
    columns = SmartColumnSerializer(many=True, read_only=True)
    rows = SmartRowSerializer(many=True, read_only=True)
    views = SmartViewSerializer(many=True, read_only=True)
    automations = SmartAutomationSerializer(many=True, read_only=True)

    class Meta:
        model = SmartSheet
        fields = (
            "id",
            "name",
            "description",
            "columns",
            "rows",
            "views",
            "automations",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")
