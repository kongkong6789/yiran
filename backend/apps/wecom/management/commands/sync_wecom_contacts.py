from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from apps.wecom.contact_service import sync_contacts
from apps.wecom.models import WeComApiConfig
from apps.wecom.services import WeComApiError


class Command(BaseCommand):
    help = "同步首次未缓存或超过指定小时未更新的企业微信通讯录。建议每天执行一次。"

    def add_arguments(self, parser):
        parser.add_argument("--max-age-hours", type=int, default=24)
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--force", action="store_true")

    def handle(self, *args, **options):
        limit = min(max(options["limit"], 1), 500)
        cutoff = timezone.now() - timedelta(hours=max(options["max_age_hours"], 1))
        rows = WeComApiConfig.objects.exclude(corp_id="").exclude(agent_id="").exclude(secret_encrypted="")
        if not options["force"]:
            rows = rows.filter(Q(contacts_synced_at__isnull=True) | Q(contacts_synced_at__lt=cutoff))
        success = failed = 0
        for config in rows.order_by("contacts_synced_at", "id")[:limit]:
            try:
                sync_contacts(config)
                success += 1
            except WeComApiError as exc:
                failed += 1
                self.stderr.write(f"配置 {config.id} 同步失败：{exc.code}")
        self.stdout.write(self.style.SUCCESS(f"企业微信通讯录同步完成：成功 {success}，失败 {failed}。"))
