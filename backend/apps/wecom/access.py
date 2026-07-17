from __future__ import annotations

from django.db.models import Q, QuerySet

from apps.core.organizations import current_organization, is_organization_admin

from .models import WeComApiConfig, WeComGroupWebhook


def accessible_config_queryset(user, *, include_disabled: bool = False) -> QuerySet[WeComApiConfig]:
    organization = current_organization(user)
    qs = WeComApiConfig.objects.prefetch_related("allowed_users")
    if not include_disabled:
        qs = qs.filter(enabled=True)
    if not organization:
        return qs.filter(user=user)
    qs = qs.filter(organization=organization)
    if is_organization_admin(user, organization):
        return qs
    return qs.filter(
        Q(user=user)
        | Q(access_scope=WeComApiConfig.AccessScope.ORGANIZATION)
        | Q(access_scope=WeComApiConfig.AccessScope.SELECTED, allowed_users=user)
    ).distinct()


def resolve_accessible_config(user, *, require_manage: bool = False) -> WeComApiConfig | None:
    organization = current_organization(user)
    qs = accessible_config_queryset(user, include_disabled=require_manage)
    if require_manage:
        if not organization or not is_organization_admin(user, organization):
            qs = qs.filter(user=user)
    configured = qs.exclude(corp_id="").exclude(agent_id="").exclude(secret_encrypted="")
    return configured.order_by("-updated_at", "id").first() or qs.order_by("-updated_at", "id").first()


def accessible_webhook_queryset(user, *, include_disabled: bool = False) -> QuerySet[WeComGroupWebhook]:
    organization = current_organization(user)
    qs = WeComGroupWebhook.objects.prefetch_related("allowed_users")
    if not include_disabled:
        qs = qs.filter(enabled=True)
    if not organization:
        return qs.filter(user=user)
    qs = qs.filter(organization=organization)
    if is_organization_admin(user, organization):
        return qs
    return qs.filter(
        Q(user=user)
        | Q(access_scope=WeComGroupWebhook.AccessScope.ORGANIZATION)
        | Q(access_scope=WeComGroupWebhook.AccessScope.SELECTED, allowed_users=user)
    ).distinct()


def resolve_accessible_webhook(user, webhook_id: int, *, require_manage: bool = False) -> WeComGroupWebhook | None:
    qs = accessible_webhook_queryset(user, include_disabled=require_manage)
    row = qs.filter(id=webhook_id).first()
    if require_manage and row and not row.can_manage(user):
        return None
    return row
