from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.core.models import OrganizationMembership
from apps.core.organizations import is_organization_admin

from .access import can_manage_agent, organization_for_user
from .models import AgentProfile


class AgentProfileSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    organization_id = serializers.IntegerField(read_only=True)
    organization_name = serializers.CharField(source="organization.name", read_only=True)
    created_by = serializers.SerializerMethodField()
    owner = serializers.SerializerMethodField()
    owner_id = serializers.IntegerField(required=False, allow_null=True)
    can_manage = serializers.SerializerMethodField()
    skill_ids = serializers.ListField(
        child=serializers.CharField(max_length=64),
        required=False,
    )
    sop_keys = serializers.ListField(
        child=serializers.CharField(max_length=96),
        required=False,
    )
    knowledge_base_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
    )
    sop_keys = serializers.ListField(
        child=serializers.CharField(max_length=96),
        required=False,
    )
    sops = serializers.SerializerMethodField()

    class Meta:
        model = AgentProfile
        fields = (
            "id",
            "organization_id",
            "organization_name",
            "created_by",
            "owner",
            "owner_id",
            "employee_code",
            "name",
            "emoji",
            "group",
            "role",
            "expertise",
            "persona",
            "execution_role",
            "is_active",
            "status",
            "skill_ids",
            "sop_keys",
            "knowledge_base_ids",
            "sop_keys",
            "sops",
            "capability_instructions",
            "lifecycle_status",
            "can_manage",
            "archived_at",
            "created_at",
        )
        read_only_fields = (
            "id",
            "organization_id",
            "organization_name",
            "created_by",
            "owner",
            "employee_code",
            "status",
            "sops",
            "can_manage",
            "archived_at",
            "created_at",
        )

    def get_status(self, obj: AgentProfile) -> str:
        if obj.lifecycle_status == AgentProfile.LifecycleStatus.DRAFT:
            return "pending"
        if (
            not obj.is_active
            or obj.lifecycle_status != AgentProfile.LifecycleStatus.PUBLISHED
        ):
            return "disabled"
        return "available"

    def get_created_by(self, obj: AgentProfile) -> dict | None:
        return _user_summary(obj.created_by)

    def get_owner(self, obj: AgentProfile) -> dict | None:
        return _user_summary(obj.owner)

    def get_can_manage(self, obj: AgentProfile) -> bool:
        request = self.context.get("request")
        return can_manage_agent(getattr(request, "user", None), obj)

    def get_sops(self, obj: AgentProfile) -> list[dict]:
        keys = [str(key).strip() for key in (obj.sop_keys or []) if str(key).strip()]
        if not keys:
            return []

        from apps.orchestration.models import SopDefinition

        rows = SopDefinition.objects.filter(
            Q(organization=obj.organization) | Q(organization__isnull=True),
            sop_key__in=keys,
            status=SopDefinition.Status.PUBLISHED,
        )
        by_key = {
            row.sop_key: row
            for row in rows
            if row.organization_id is None
        }
        by_key.update({
            row.sop_key: row
            for row in rows
            if row.organization_id == obj.organization_id
        })
        return [
            {
                "key": key,
                "name": by_key[key].name,
                "business_domain": by_key[key].business_domain,
                "current_version": by_key[key].current_version,
            }
            for key in keys
            if key in by_key
        ]

    def validate_owner_id(self, value: int | None) -> int | None:
        if value is None:
            return None
        request = self.context.get("request")
        user = getattr(request, "user", None)
        organization = self.instance.organization if self.instance else organization_for_user(user)
        if organization is None:
            raise serializers.ValidationError("当前账号没有可用企业。")
        if self.instance and value != self.instance.owner_id and not is_organization_admin(
            user, organization
        ):
            raise serializers.ValidationError("只有企业管理员可以变更负责人。")
        exists = OrganizationMembership.objects.filter(
            organization=organization,
            user_id=value,
            is_active=True,
            user__is_active=True,
        ).exists()
        if not exists:
            raise serializers.ValidationError("负责人必须是当前企业的启用成员。")
        return value

    def validate(self, attrs: dict) -> dict:
        lifecycle = attrs.get(
            "lifecycle_status",
            self.instance.lifecycle_status if self.instance else AgentProfile.LifecycleStatus.PUBLISHED,
        )
        active_supplied = "is_active" in attrs
        if active_supplied and "lifecycle_status" not in attrs:
            lifecycle = (
                AgentProfile.LifecycleStatus.PUBLISHED
                if attrs["is_active"]
                else AgentProfile.LifecycleStatus.DISABLED
            )
            attrs["lifecycle_status"] = lifecycle
        if "lifecycle_status" in attrs or not active_supplied:
            attrs["is_active"] = lifecycle == AgentProfile.LifecycleStatus.PUBLISHED
        return super().validate(attrs)

    def update(self, instance: AgentProfile, validated_data: dict) -> AgentProfile:
        lifecycle = validated_data.get("lifecycle_status", instance.lifecycle_status)
        if lifecycle == AgentProfile.LifecycleStatus.ARCHIVED:
            validated_data["archived_at"] = instance.archived_at or timezone.now()
        elif lifecycle in {
            AgentProfile.LifecycleStatus.PUBLISHED,
            AgentProfile.LifecycleStatus.DISABLED,
            AgentProfile.LifecycleStatus.DRAFT,
        }:
            validated_data["archived_at"] = None
        return super().update(instance, validated_data)

    def validate_skill_ids(self, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(item.strip() for item in value if item.strip()))
        if not normalized:
            return []

        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not getattr(user, "is_authenticated", False):
            raise serializers.ValidationError("登录后才能绑定 Skill。")

        from apps.skills.models import SkillAsset, UserSkill

        available = set(
            UserSkill.objects.filter(user=user, skill_id__in=normalized)
            .values_list("skill_id", flat=True)
        )
        available.update(
            SkillAsset.objects.filter(skill_id__in=normalized)
            .filter(Q(visibility=SkillAsset.Visibility.SHARED) | Q(uploader=user))
            .values_list("skill_id", flat=True)
        )
        missing = [skill_id for skill_id in normalized if skill_id not in available]
        if missing:
            raise serializers.ValidationError(f"以下 Skill 不存在或无权访问：{', '.join(missing)}")
        return normalized

    def validate_sop_keys(self, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(item.strip() for item in value if item.strip()))
        if not normalized:
            return []

        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not getattr(user, "is_authenticated", False):
            raise serializers.ValidationError("登录后才能绑定 SOP。")

        organization = self.instance.organization if self.instance else organization_for_user(user)
        if organization is None:
            raise serializers.ValidationError("当前账号没有可用企业，无法绑定 SOP。")

        from apps.orchestration.models import SopDefinition

        available = set(
            SopDefinition.objects.filter(
                Q(organization=organization) | Q(organization__isnull=True),
                status=SopDefinition.Status.PUBLISHED,
                sop_key__in=normalized,
            ).values_list("sop_key", flat=True)
        )
        missing = [sop_key for sop_key in normalized if sop_key not in available]
        if missing:
            raise serializers.ValidationError(
                f"以下 SOP 不存在、未发布或无权访问：{', '.join(missing)}"
            )
        return normalized

    def validate_knowledge_base_ids(self, value: list[int]) -> list[int]:
        normalized = list(dict.fromkeys(value))
        if not normalized:
            return []

        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not getattr(user, "is_authenticated", False):
            raise serializers.ValidationError("登录后才能绑定知识库。")

        from apps.knowledge.models import KnowledgeBase

        available = set(
            KnowledgeBase.objects.filter(id__in=normalized, archived_at__isnull=True)
            .filter(
                Q(visibility__in=[KnowledgeBase.Visibility.TEAM, KnowledgeBase.Visibility.COMPANY])
                | Q(visibility=KnowledgeBase.Visibility.PRIVATE, owner_user_id=user.id)
            )
            .values_list("id", flat=True)
        )
        missing = [knowledge_base_id for knowledge_base_id in normalized if knowledge_base_id not in available]
        if missing:
            raise serializers.ValidationError(
                f"以下知识库不存在或无权访问：{', '.join(str(item) for item in missing)}"
            )
        return normalized

    def validate_sop_keys(self, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(item.strip() for item in value if item.strip()))
        if not normalized:
            return []

        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not getattr(user, "is_authenticated", False):
            raise serializers.ValidationError("登录后才能绑定 SOP。")

        from apps.orchestration.models import SopDefinition

        organization = self.instance.organization if self.instance else organization_for_user(user)
        available = set(
            SopDefinition.objects.filter(
                Q(organization=organization) | Q(organization__isnull=True),
                sop_key__in=normalized,
                status=SopDefinition.Status.PUBLISHED,
            ).values_list("sop_key", flat=True)
        )
        missing = [key for key in normalized if key not in available]
        if missing:
            raise serializers.ValidationError(
                f"以下 SOP 未发布、不存在或无权访问：{', '.join(missing)}"
            )
        return normalized


def _user_summary(user) -> dict | None:
    if user is None:
        return None
    display_name = ""
    try:
        display_name = str(getattr(user.settings, "display_name", "") or "").strip()
    except Exception:
        pass
    return {
        "id": user.id,
        "username": user.get_username(),
        "display_name": display_name or user.get_username(),
    }
