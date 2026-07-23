from __future__ import annotations

from django.db.models import Q, QuerySet

from apps.core.models import OrganizationMembership, Team, TeamMembership
from apps.core.organizations import current_organization, is_organization_admin

from .models import KnowledgeBase, KnowledgePermission


def user_organization_ids(user) -> list[int]:
    if not user or not getattr(user, "is_authenticated", False):
        return []
    return list(
        OrganizationMembership.objects.filter(
            user=user,
            is_active=True,
            organization__is_active=True,
        ).values_list("organization_id", flat=True)
    )


def user_team_ids(user) -> list[int]:
    if not user or not getattr(user, "is_authenticated", False):
        return []
    return list(
        TeamMembership.objects.filter(
            user=user,
            team__is_active=True,
        ).values_list("team_id", flat=True)
    )


def visible_knowledge_base_filter(user) -> Q:
    if not user or not getattr(user, "is_authenticated", False):
        return Q(pk__in=[])
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return Q()

    org_subjects = [str(pk) for pk in user_organization_ids(user)]
    team_subjects = [str(pk) for pk in user_team_ids(user)]
    permission_q = Q()
    if org_subjects:
        permission_q |= Q(
            visibility=KnowledgeBase.Visibility.COMPANY,
            permissions__subject_type=KnowledgePermission.SubjectType.ORG,
            permissions__subject_id__in=org_subjects,
        )
    if team_subjects:
        permission_q |= Q(
            visibility=KnowledgeBase.Visibility.TEAM,
            permissions__subject_type=KnowledgePermission.SubjectType.TEAM,
            permissions__subject_id__in=team_subjects,
        )

    return (
        Q(owner_user_id=user.id)
        | Q(permissions__subject_type=KnowledgePermission.SubjectType.USER, permissions__subject_id=str(user.id))
        | permission_q
    )


def visible_knowledge_bases(user) -> QuerySet[KnowledgeBase]:
    qs = KnowledgeBase.objects.filter(archived_at__isnull=True)
    return qs.filter(visible_knowledge_base_filter(user)).distinct()


def can_view_knowledge_base(user, kb: KnowledgeBase) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return True
    if kb.owner_user_id == getattr(user, "id", None):
        return True
    if kb.visibility == KnowledgeBase.Visibility.PRIVATE:
        return kb.owner_user_id == user.id
    if kb.permissions.filter(subject_type=KnowledgePermission.SubjectType.USER, subject_id=str(user.id)).exists():
        return True
    org_subjects = [str(pk) for pk in user_organization_ids(user)]
    if kb.visibility == KnowledgeBase.Visibility.COMPANY and org_subjects and kb.permissions.filter(
        subject_type=KnowledgePermission.SubjectType.ORG,
        subject_id__in=org_subjects,
    ).exists():
        return True
    team_subjects = [str(pk) for pk in user_team_ids(user)]
    return bool(
        team_subjects
        and kb.permissions.filter(
            subject_type=KnowledgePermission.SubjectType.TEAM,
            subject_id__in=team_subjects,
        ).exists()
    )


def can_manage_knowledge_base(user, kb: KnowledgeBase) -> bool:
    if not can_view_knowledge_base(user, kb):
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return True
    if kb.owner_user_id == getattr(user, "id", None):
        return True
    if kb.visibility == KnowledgeBase.Visibility.PRIVATE:
        return kb.owner_user_id == user.id
    if kb.owner_user_id == getattr(user, "id", None):
        return True
    if kb.permissions.filter(
        subject_type=KnowledgePermission.SubjectType.USER,
        subject_id=str(user.id),
        role__in=[KnowledgePermission.Role.OWNER, KnowledgePermission.Role.EDITOR],
    ).exists():
        return True

    org_ids = user_organization_ids(user)
    permitted_org_ids = []
    if kb.visibility == KnowledgeBase.Visibility.COMPANY:
        permitted_org_ids = [
            int(subject_id)
            for subject_id in kb.permissions.filter(
                subject_type=KnowledgePermission.SubjectType.ORG,
                subject_id__in=[str(pk) for pk in org_ids],
            ).values_list("subject_id", flat=True)
            if str(subject_id).isdigit()
        ]
    if any(is_organization_admin(user, organization_id) for organization_id in permitted_org_ids):
        return True

    permitted_team_ids = [
        int(subject_id)
        for subject_id in kb.permissions.filter(
            subject_type=KnowledgePermission.SubjectType.TEAM,
            subject_id__in=[str(pk) for pk in user_team_ids(user)],
        ).values_list("subject_id", flat=True)
        if str(subject_id).isdigit()
    ]
    if not permitted_team_ids:
        return False
    if TeamMembership.objects.filter(
        user=user,
        team_id__in=permitted_team_ids,
        role=TeamMembership.Role.LEAD,
    ).exists():
        return True
    enterprise_org_ids = Team.objects.filter(
        id__in=permitted_team_ids,
        kind=Team.Kind.ENTERPRISE,
    ).exclude(organization_id__isnull=True).values_list("organization_id", flat=True)
    return any(is_organization_admin(user, organization_id) for organization_id in enterprise_org_ids)


def sync_default_permissions(kb: KnowledgeBase, user, *, team_ids: list[int] | None = None) -> None:
    KnowledgePermission.objects.update_or_create(
        knowledge_base=kb,
        subject_type=KnowledgePermission.SubjectType.USER,
        subject_id=str(kb.owner_user_id or getattr(user, "id", "")),
        defaults={"role": KnowledgePermission.Role.OWNER},
    )
    if kb.visibility == KnowledgeBase.Visibility.PRIVATE:
        KnowledgePermission.objects.filter(knowledge_base=kb).exclude(
            subject_type=KnowledgePermission.SubjectType.USER,
            subject_id=str(kb.owner_user_id or getattr(user, "id", "")),
        ).delete()
        return

    if kb.visibility == KnowledgeBase.Visibility.COMPANY:
        organization = current_organization(user)
        if organization:
            KnowledgePermission.objects.update_or_create(
                knowledge_base=kb,
                subject_type=KnowledgePermission.SubjectType.ORG,
                subject_id=str(organization.id),
                defaults={"role": KnowledgePermission.Role.VIEWER},
            )
        KnowledgePermission.objects.filter(
            knowledge_base=kb,
            subject_type=KnowledgePermission.SubjectType.TEAM,
        ).delete()
        return

    if kb.visibility == KnowledgeBase.Visibility.TEAM:
        team_ids = team_ids or user_team_ids(user)
        team_subject_ids = [str(team_id) for team_id in team_ids]
        for subject_id in team_subject_ids:
            KnowledgePermission.objects.update_or_create(
                knowledge_base=kb,
                subject_type=KnowledgePermission.SubjectType.TEAM,
                subject_id=subject_id,
                defaults={"role": KnowledgePermission.Role.VIEWER},
            )
        KnowledgePermission.objects.filter(
            knowledge_base=kb,
            subject_type=KnowledgePermission.SubjectType.TEAM,
        ).exclude(subject_id__in=team_subject_ids).delete()
        KnowledgePermission.objects.filter(
            knowledge_base=kb,
            subject_type=KnowledgePermission.SubjectType.ORG,
        ).delete()
