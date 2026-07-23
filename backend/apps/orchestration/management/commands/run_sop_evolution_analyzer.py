"""Periodic SOP evolution analyzer.

Default: also autostarts inside Django (`SOP_EVOLUTION_AUTOSTART=true`).
This command remains for one-shot / dedicated worker use:

  python manage.py run_sop_evolution_analyzer --once
  python manage.py run_sop_evolution_analyzer --interval 3600
"""
from __future__ import annotations

import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.db.models import Count, Q

from apps.core.models import Organization
from apps.orchestration.evolution_analyzer import analyze_sop_evolution
from apps.orchestration.models import SopDefinition


def analyze_due_sops(*, limit: int = 40) -> dict:
    orgs = Organization.objects.filter(is_active=True, sop_evolution_enabled=True)
    created_total = 0
    scanned = 0
    skipped = 0
    for org in orgs:
        sops = (
            SopDefinition.objects.filter(organization=org)
            .exclude(status=SopDefinition.Status.ARCHIVED)
            .annotate(
                signal_n=Count("evolution_signals", distinct=True),
                run_n=Count("versions__runs", distinct=True),
            )
            .filter(Q(signal_n__gt=0) | Q(run_n__gte=3))
            .order_by("-updated_at")[:limit]
        )
        for sop in sops:
            scanned += 1
            try:
                created = analyze_sop_evolution(definition=sop, user=None, enrich_with_llm=False)
                created_total += len(created)
            except Exception:
                skipped += 1
    return {"scanned": scanned, "created": created_total, "skipped": skipped, "orgs": orgs.count()}


class Command(BaseCommand):
    help = "扫描企业 SOP 并生成进化提案。默认已随 runserver/daphne 自动后台运行。"

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="只执行一轮后退出。")
        parser.add_argument("--interval", type=int, default=3600, help="轮询间隔秒数，默认 3600。")
        parser.add_argument("--limit", type=int, default=40, help="每轮每个企业最多分析的 SOP 数。")

    def handle(self, *args, **options):
        interval = min(max(int(options["interval"]), 60), 86400)
        limit = min(max(int(options["limit"]), 1), 200)
        self.stdout.write(self.style.SUCCESS(
            f"SOP 进化分析器已启动（间隔 {interval}s，每企业最多 {limit} 条）。"
            " 提示：日常开发直接 python manage.py runserver 即可自动挂载，无需单独开此命令。"
        ))
        while True:
            try:
                close_old_connections()
                result = analyze_due_sops(limit=limit)
                self.stdout.write(
                    f"本轮完成：企业 {result['orgs']}，扫描 {result['scanned']}，"
                    f"新建提案 {result['created']}，失败跳过 {result['skipped']}。"
                )
            except Exception as exc:
                self.stderr.write(self.style.ERROR(f"进化分析异常（{type(exc).__name__}）：{exc}"))
                if options["once"]:
                    raise
            finally:
                close_old_connections()
            if options["once"]:
                break
            time.sleep(interval)
