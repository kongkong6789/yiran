from __future__ import annotations

import mimetypes
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.core.auth_views import _profiles_root
from apps.core.avatar_storage import AvatarStorageError, enabled, is_cos_token, upload
from apps.core.models import UserSettings


class Command(BaseCommand):
    help = "将历史本地用户头像迁移到腾讯云 COS，成功后删除本地文件。"

    def add_arguments(self, parser):
        parser.add_argument("--keep-local", action="store_true", help="迁移成功后保留本地旧文件")
        parser.add_argument("--clear-missing", action="store_true", help="清空已不存在的本地头像引用")

    def handle(self, *args, **options):
        if not enabled():
            raise CommandError("腾讯云 COS 未完整配置，无法迁移头像")

        migrated = skipped = missing = failed = 0
        for profile in UserSettings.objects.exclude(avatar="").order_by("user_id").iterator():
            if is_cos_token(profile.avatar):
                skipped += 1
                continue
            path = _profiles_root() / Path(profile.avatar).name
            if not path.is_file():
                missing += 1
                self.stderr.write(f"用户 {profile.user_id} 的本地头像不存在：{profile.avatar}")
                if options["clear_missing"]:
                    UserSettings.objects.filter(pk=profile.pk, avatar=profile.avatar).update(avatar="")
                continue
            try:
                stored = upload(
                    path.name,
                    path.read_bytes(),
                    content_type=mimetypes.guess_type(path.name)[0] or "image/png",
                )
                UserSettings.objects.filter(pk=profile.pk, avatar=profile.avatar).update(avatar=stored.token)
                if not options["keep_local"]:
                    path.unlink(missing_ok=True)
                migrated += 1
            except (AvatarStorageError, OSError) as exc:
                failed += 1
                self.stderr.write(f"用户 {profile.user_id} 头像迁移失败：{type(exc).__name__}")

        self.stdout.write(self.style.SUCCESS(
            f"头像迁移完成：成功 {migrated}，已在 COS {skipped}，本地缺失 {missing}，失败 {failed}。"
        ))
        if failed:
            raise CommandError("部分头像迁移失败，请检查 COS 配置和服务日志")
