from django.conf import settings
from django.db import migrations


def forwards(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    Organization = apps.get_model("core", "Organization")
    Membership = apps.get_model("core", "OrganizationMembership")
    WeComApiConfig = apps.get_model("wecom", "WeComApiConfig")
    WeComGroupWebhook = apps.get_model("wecom", "WeComGroupWebhook")

    users = list(User.objects.order_by("id"))
    if not users:
        return
    owner = next((user for user in users if user.is_superuser), None) or next(
        (user for user in users if user.is_staff),
        users[0],
    )
    organization = Organization.objects.create(name="默认企业", created_by_id=owner.id)
    for user in users:
        role = "owner" if user.id == owner.id else ("admin" if user.is_staff else "member")
        Membership.objects.create(
            organization_id=organization.id,
            user_id=user.id,
            role=role,
            is_primary=True,
            is_active=True,
        )
    WeComApiConfig.objects.filter(organization__isnull=True).update(organization=organization)
    used_names = set(
        WeComGroupWebhook.objects.filter(organization=organization).values_list("name", flat=True)
    )
    for webhook in WeComGroupWebhook.objects.filter(organization__isnull=True).order_by("id"):
        base_name = webhook.name
        candidate = base_name
        suffix = 2
        while candidate in used_names:
            candidate = f"{base_name} ({suffix})"[:100]
            suffix += 1
        webhook.name = candidate
        webhook.organization_id = organization.id
        webhook.save(update_fields=["name", "organization"])
        used_names.add(candidate)


def backwards(apps, schema_editor):
    Organization = apps.get_model("core", "Organization")
    WeComApiConfig = apps.get_model("wecom", "WeComApiConfig")
    WeComGroupWebhook = apps.get_model("wecom", "WeComGroupWebhook")
    organization = Organization.objects.filter(name="默认企业").order_by("id").first()
    if not organization:
        return
    WeComApiConfig.objects.filter(organization=organization).update(organization=None)
    WeComGroupWebhook.objects.filter(organization=organization).update(organization=None)
    organization.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0009_organization_organizationmembership"),
        ("wecom", "0008_remove_wecomgroupwebhook_uniq_wecom_group_name_per_user_and_more"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
