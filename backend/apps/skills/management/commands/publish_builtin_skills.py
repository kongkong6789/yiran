"""Ensure builtin skills (e.g. wecom-todo) exist as shared assets users can adopt."""
from __future__ import annotations

from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.skills.models import SkillAsset, UserSkill
from apps.skills.repository import materialize_user_skill, save_skill_asset_from_bytes


User = get_user_model()
BUILTIN_DIR = Path(__file__).resolve().parents[2] / "builtin"
BOT_USERNAMES = {"小策bot", "良策AI", "liangce-ai", "xiaoce"}


class Command(BaseCommand):
    help = "Publish builtin skills (wecom-todo) as shared assets and optionally enable for users."

    def add_arguments(self, parser):
        parser.add_argument("--username", default="", help="Also enable the skill for this user")
        parser.add_argument("--all-users", action="store_true", help="Enable the skill for all active human users")
        parser.add_argument("--force", action="store_true", help="Overwrite existing shared asset content")

    def handle(self, *args, **options):
        uploader = User.objects.filter(is_superuser=True).order_by("id").first()
        if not uploader:
            uploader = User.objects.order_by("id").first()
        if not uploader:
            self.stderr.write(self.style.ERROR("No user available to own builtin skill assets"))
            return

        skill_md = BUILTIN_DIR / "wecom-todo" / "SKILL.md"
        if not skill_md.exists():
            self.stderr.write(self.style.ERROR(f"Missing {skill_md}"))
            return

        existing = SkillAsset.objects.filter(skill_id="wecom-todo").order_by("id").first()
        if existing and not options["force"]:
            asset = existing
            self.stdout.write(f"Reuse existing asset wecom-todo id={asset.id}")
        else:
            data = skill_md.read_bytes()
            asset, _personal = save_skill_asset_from_bytes(
                uploader,
                filename="SKILL.md",
                data=data,
                visibility=SkillAsset.Visibility.SHARED,
                skill_id_override="wecom-todo",
            )
            self.stdout.write(self.style.SUCCESS(f"Published wecom-todo asset id={asset.id}"))

        usernames = []
        username = str(options.get("username") or "").strip()
        if username:
            usernames.append(username)
        if options.get("all_users"):
            usernames.extend(
                User.objects.filter(is_active=True)
                .exclude(username__in=BOT_USERNAMES)
                .values_list("username", flat=True)
            )

        enabled = 0
        for name in dict.fromkeys(usernames):
            user = User.objects.filter(username=name).first()
            if not user:
                self.stderr.write(self.style.ERROR(f"User not found: {name}"))
                continue
            materialize_user_skill(user, asset)
            enabled += 1
            self.stdout.write(self.style.SUCCESS(f"Enabled wecom-todo for {name}"))
        if enabled:
            self.stdout.write(self.style.SUCCESS(f"Total enabled: {enabled}"))
