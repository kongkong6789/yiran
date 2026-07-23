"""Access helpers for digital employees (AgentProfile) scoped by organization."""
from __future__ import annotations

from django.db.models import QuerySet

from apps.core.models import Organization, OrganizationMembership
from apps.core.organizations import current_organization, is_organization_admin

from .models import AgentProfile


def organization_for_user(user) -> Organization | None:
    if not user or not getattr(user, "is_authenticated", False):
        return None
    return current_organization(user)


def organization_member_ids(organization: Organization | None) -> set[int]:
    if organization is None:
        return set()
    return set(
        OrganizationMembership.objects.filter(
            organization=organization,
            is_active=True,
            user__is_active=True,
        ).values_list("user_id", flat=True)
    )


def agent_queryset_for_user(user, *, include_archived: bool = False) -> QuerySet[AgentProfile]:
    if not user or not getattr(user, "is_authenticated", False):
        return AgentProfile.objects.none()

    qs = AgentProfile.objects.all()
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        if not include_archived:
            qs = qs.exclude(lifecycle_status=AgentProfile.LifecycleStatus.ARCHIVED)
        return qs.select_related("organization", "owner", "created_by")

    organization = organization_for_user(user)
    if organization is None:
        return AgentProfile.objects.none()

    qs = qs.filter(organization=organization)
    if not include_archived:
        qs = qs.exclude(lifecycle_status=AgentProfile.LifecycleStatus.ARCHIVED)
    return qs.select_related("organization", "owner", "created_by")


def can_create_agent(user, organization: Organization | None) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if organization is None:
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return True
    return is_organization_admin(user, organization)


def can_manage_agent(user, agent: AgentProfile | None) -> bool:
    if not user or not getattr(user, "is_authenticated", False) or agent is None:
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return True
    if agent.owner_id == user.id or agent.created_by_id == user.id:
        return True
    return is_organization_admin(user, agent.organization)
