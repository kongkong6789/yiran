import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from apps.core.automation_scheduler import (
    initialize_missing_schedules,
    process_due_automations,
    refresh_data_triggers,
)


class Command(BaseCommand):
    help = "常驻处理 /work 自动化定时任务和数据变化触发器。"

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="只执行一轮后退出。")
        parser.add_argument("--interval", type=int, default=15, help="轮询间隔秒数，默认 15。")
        parser.add_argument("--limit", type=int, default=50, help="每轮最多执行的自动化数量。")

    def handle(self, *args, **options):
        interval = min(max(options["interval"], 5), 300)
        limit = min(max(options["limit"], 1), 500)
        self.stdout.write(self.style.SUCCESS(
            f"自动化调度器已启动（轮询 {interval} 秒，每轮最多 {limit} 项）。"
        ))
        while True:
            try:
                close_old_connections()
                initialized = initialize_missing_schedules(limit=limit)
                data_changes = refresh_data_triggers(limit=limit)
                processed = process_due_automations(limit=limit)
                if initialized or data_changes or processed or options["once"]:
                    self.stdout.write(
                        f"本轮完成：补齐计划 {initialized} 项，数据变化入队 {data_changes} 项，执行 {processed} 项。"
                    )
            except Exception as exc:
                self.stderr.write(self.style.ERROR(
                    f"调度轮询异常（{type(exc).__name__}）：{exc}"
                ))
                if options["once"]:
                    raise
            finally:
                close_old_connections()
            if options["once"]:
                break
            time.sleep(interval)
