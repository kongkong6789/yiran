from django.core.management.base import BaseCommand, CommandError

from apps.wecom.binding_service import create_sync_job, resolve_binding_config, run_sync_job
from apps.wecom.models import UserWeComBinding


class Command(BaseCommand):
    help = "分页同步平台用户与企业微信 UserID 绑定（建议每天凌晨执行）"

    def add_arguments(self, parser):
        parser.add_argument("--batch-size", type=int, default=100)
        parser.add_argument("--config-user-id", type=int, default=None)

    def handle(self, *args, **options):
        config = resolve_binding_config(config_user_id=options["config_user_id"])
        if not config or not config.configured:
            raise CommandError("未找到唯一且可用的企业微信配置，请设置 WECOM_BINDING_CONFIG_USER_ID。")
        job = create_sync_job(
            config=config,
            source=UserWeComBinding.Source.SCHEDULED_SYNC,
            batch_size=options["batch_size"],
        )
        try:
            run_sync_job(job)
        except Exception as exc:
            raise CommandError(f"同步失败，任务 ID={job.id}。") from exc
        self.stdout.write(self.style.SUCCESS(
            "同步完成："
            f"扫描 {job.scanned_count}，成功 {job.matched_count}，未找到 {job.not_found_count}，"
            f"无效 {job.invalid_phone_count}，重复 {job.duplicate_phone_count}，冲突 {job.conflict_count}，"
            f"权限不足 {job.permission_denied_count}，等待重试 {job.retry_waiting_count}。"
        ))
