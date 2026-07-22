from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction

from .models import AuditLog, Organization, OrganizationMembership


User = get_user_model()
ADMIN_ROLES = {OrganizationMembership.Role.OWNER, OrganizationMembership.Role.ADMIN}


def primary_membership(user) -> OrganizationMembership | None:
    if not user or not getattr(user, "is_authenticated", False):
        return None
    return (
        OrganizationMembership.objects.select_related("organization")
        .filter(user=user, is_active=True, organization__is_active=True)
        .order_by("-is_primary", "id")
        .first()
    )


def current_organization(user) -> Organization | None:
    membership = primary_membership(user)
    return membership.organization if membership else None


def ensure_current_organization(user) -> Organization | None:
    """返回当前企业；兼容历史账号，为尚未归属企业的登录用户创建个人企业。"""
    organization = current_organization(user)
    if organization or not user or not getattr(user, "is_authenticated", False):
        return organization
    return create_personal_organization(user).organization


def is_organization_admin(user, organization: Organization | None = None) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False):
        return True
    qs = OrganizationMembership.objects.filter(
        user=user,
        is_active=True,
        role__in=ADMIN_ROLES,
        organization__is_active=True,
    )
    if organization is not None:
        qs = qs.filter(organization=organization)
    return qs.exists()


def default_managed_organization(user) -> Organization | None:
    """优先返回用户可管理的当前企业；否则回退到其任意可管理企业。"""
    primary = current_organization(user)
    if primary and is_organization_admin(user, primary):
        return primary
    admin_ids = admin_organization_ids(user)
    if admin_ids:
        return Organization.objects.filter(id=admin_ids[0], is_active=True).first()
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return primary
    return None


def admin_organization_ids(user) -> list[int]:
    """当前用户以所有者/管理员身份所在的启用企业 id 列表。"""
    if not user or not getattr(user, "is_authenticated", False):
        return []
    return list(
        OrganizationMembership.objects.filter(
            user=user,
            is_active=True,
            role__in=ADMIN_ROLES,
            organization__is_active=True,
        ).values_list("organization_id", flat=True)
    )


def organization_user_ids(organization: Organization | None) -> list[int]:
    if organization is None:
        return []
    return list(
        OrganizationMembership.objects.filter(
            organization=organization,
            is_active=True,
            user__is_active=True,
        ).values_list("user_id", flat=True)
    )


@transaction.atomic
def create_personal_organization(user, *, name: str = "") -> OrganizationMembership:
    existing = primary_membership(user)
    if existing:
        return existing
    organization = Organization.objects.create(
        name=(name or f"{user.username}的企业")[:128],
        created_by=user,
    )
    return OrganizationMembership.objects.create(
        organization=organization,
        user=user,
        role=OrganizationMembership.Role.OWNER,
        is_primary=True,
    )


@transaction.atomic
def assign_user_to_organization(
    user,
    organization: Organization,
    *,
    role: str = OrganizationMembership.Role.MEMBER,
    make_primary: bool = True,
) -> OrganizationMembership:
    existing = OrganizationMembership.objects.select_for_update().filter(
        organization=organization,
        user=user,
    ).first()
    if make_primary:
        OrganizationMembership.objects.filter(user=user, is_primary=True).exclude(
            pk=existing.pk if existing else None,
        ).update(is_primary=False)
        is_primary = True
    else:
        has_primary = OrganizationMembership.objects.filter(
            user=user,
            is_active=True,
            is_primary=True,
        ).exclude(pk=existing.pk if existing else None).exists()
        is_primary = bool(existing and existing.is_primary) or not has_primary
    membership, _ = OrganizationMembership.objects.update_or_create(
        organization=organization,
        user=user,
        defaults={"role": role, "is_active": True, "is_primary": is_primary},
    )
    return membership


@transaction.atomic
def create_organization_with_owner(*, name: str, owner, actor) -> tuple[Organization, OrganizationMembership]:
    organization = Organization.objects.create(name=name[:128], created_by=actor)
    OrganizationMembership.objects.filter(
        user=owner,
        is_primary=True,
        is_active=True,
    ).update(is_primary=False)
    membership = OrganizationMembership.objects.create(
        organization=organization,
        user=owner,
        role=OrganizationMembership.Role.OWNER,
        is_primary=True,
        is_active=True,
    )
    AuditLog.objects.create(
        trace_id=f"organization-create-{organization.id}",
        actor=actor.username,
        intent="创建企业",
        action="organization.create",
        payload={
            "organization_id": organization.id,
            "organization_name": organization.name,
            "owner_user_id": owner.id,
        },
        decision=AuditLog.Decision.ALLOW,
        result={"owner_membership_id": membership.id},
    )
    return organization, membership


@transaction.atomic
def transfer_organization_ownership(*, organization: Organization, actor, target_user) -> tuple[OrganizationMembership, OrganizationMembership]:
    locked_organization = Organization.objects.select_for_update().get(id=organization.id)
    current_owner = (
        OrganizationMembership.objects.select_for_update()
        .select_related("user")
        .filter(
            organization=locked_organization,
            role=OrganizationMembership.Role.OWNER,
            is_active=True,
        )
        .first()
    )
    if not current_owner or current_owner.user_id != actor.id:
        raise PermissionError("仅当前企业所有者可以转移企业所有权")
    if target_user.id == actor.id:
        raise ValueError("目标成员已经是当前企业所有者")
    target_membership = (
        OrganizationMembership.objects.select_for_update()
        .select_related("user")
        .filter(
            organization=locked_organization,
            user=target_user,
            is_active=True,
        )
        .first()
    )
    if not target_membership:
        raise ValueError("目标用户不是当前企业的启用成员")
    if not target_user.is_active:
        raise ValueError("目标用户账号已停用，不能接收企业所有权")

    previous_owner_id = current_owner.user_id
    current_owner.role = OrganizationMembership.Role.ADMIN
    current_owner.save(update_fields=["role", "updated_at"])
    target_membership.role = OrganizationMembership.Role.OWNER
    target_membership.save(update_fields=["role", "updated_at"])
    AuditLog.objects.create(
        trace_id=f"organization-transfer-{locked_organization.id}-{target_user.id}",
        actor=actor.username,
        intent="转移企业所有权",
        action="organization.transfer_ownership",
        payload={
            "organization_id": locked_organization.id,
            "previous_owner_user_id": previous_owner_id,
            "new_owner_user_id": target_user.id,
        },
        decision=AuditLog.Decision.ALLOW,
        result={"transferred": True},
    )
    return current_owner, target_membership
