from django.db import migrations


def add_platform_team_creators(apps, schema_editor):
    Team = apps.get_model("core", "Team")
    TeamMembership = apps.get_model("core", "TeamMembership")
    memberships = [
        TeamMembership(team_id=team_id, user_id=created_by_id, role="lead")
        for team_id, created_by_id in Team.objects.filter(
            kind="platform",
            created_by_id__isnull=False,
        ).values_list("id", "created_by_id")
    ]
    if memberships:
        TeamMembership.objects.bulk_create(memberships, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0021_workautomation_scheduler"),
    ]

    operations = [
        migrations.RunPython(add_platform_team_creators, migrations.RunPython.noop),
    ]
