from rest_framework import serializers

from .models import AgentProfile


class AgentProfileSerializer(serializers.ModelSerializer):
    quota_remaining = serializers.IntegerField(read_only=True)
    status = serializers.SerializerMethodField()

    class Meta:
        model = AgentProfile
        fields = (
            "id",
            "name",
            "emoji",
            "group",
            "role",
            "expertise",
            "persona",
            "execution_role",
            "is_active",
            "quota_limit",
            "quota_used",
            "quota_remaining",
            "status",
            "created_at",
        )
        read_only_fields = ("id", "quota_used", "quota_remaining", "status", "created_at")

    def get_status(self, obj: AgentProfile) -> str:
        if not obj.is_active:
            return "disabled"
        if obj.quota_remaining <= 0:
            return "quota_exhausted"
        return "available"
