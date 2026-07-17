from django.core.management.base import BaseCommand
import time

from apps.wecom.binding_service import claim_sync_job, run_sync_job
from apps.wecom.event_processor import process_due_callback_events
from apps.wecom.models import WeComBindingSyncJob
from apps.wecom.notification_service import process_due_notifications
from apps.wecom.todo_sync_service import process_due_work_todo_syncs, refresh_due_work_todos


class Command(BaseCommand):
    help = "处理持久化的企业微信通知重试、回调事件和账号绑定队列。建议每分钟执行。"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--interval", type=int, default=30)

    def handle(self, *args, **options):
        limit = min(max(options["limit"], 1), 500)
        interval = min(max(options["interval"], 5), 300)
        while True:
            try:
                notifications = process_due_notifications(limit=limit)
                events = process_due_callback_events(limit=limit)
                todo_syncs = process_due_work_todo_syncs(limit=limit)
                todo_refreshes = refresh_due_work_todos(limit=limit)
                job_ids = list(
                    WeComBindingSyncJob.objects.filter(status=WeComBindingSyncJob.Status.PENDING)
                    .order_by("created_at")
                    .values_list("id", flat=True)[:limit]
                )
                claimed = 0
                for job_id in job_ids:
                    job = claim_sync_job(job_id)
                    if job:
                        claimed += 1
                        run_sync_job(job)
                self.stdout.write(self.style.SUCCESS(
                    f"企业微信队列处理完成：通知 {notifications}，回调 {events}，绑定任务 {claimed}，"
                    f"待办同步 {todo_syncs}，待办状态刷新 {todo_refreshes}。"
                ))
            except Exception as exc:
                if not options["watch"]:
                    raise
                self.stderr.write(self.style.ERROR(
                    f"企业微信队列本轮处理异常（{type(exc).__name__}），将在 {interval} 秒后自动重试。"
                ))
            if not options["watch"]:
                break
            time.sleep(interval)
