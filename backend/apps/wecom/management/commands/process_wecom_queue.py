from django.core.management.base import BaseCommand
import time

from apps.wecom.queue_worker import process_wecom_queue_once


class Command(BaseCommand):
    help = "处理持久化的企业微信通知重试、回调事件和账号绑定队列。建议每分钟执行；默认也会随 Django 进程自动处理。"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--watch", action="store_true")
        parser.add_argument("--interval", type=int, default=30)

    def handle(self, *args, **options):
        limit = min(max(options["limit"], 1), 500)
        interval = min(max(options["interval"], 5), 300)
        while True:
            try:
                result = process_wecom_queue_once(limit=limit)
                self.stdout.write(self.style.SUCCESS(
                    f"企业微信队列处理完成：通知 {result['notifications']}，回调 {result['events']}，"
                    f"绑定任务 {result['bindings']}，待办同步 {result['todo_syncs']}，"
                    f"待办状态刷新 {result['todo_refreshes']}。"
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
