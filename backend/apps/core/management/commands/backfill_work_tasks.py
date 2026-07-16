from django.core.management.base import BaseCommand

from apps.core.models import TaskResultRecord, WorkTask
from apps.wecom.models import WeComNotificationRecord
from apps.core.views import _generate_work_task_artifacts


class Command(BaseCommand):
    help = "将已有任务结果和企业微信通知记录补录到真实任务跟踪表。"

    def handle(self, *args, **options):
        created = updated = 0
        for result in TaskResultRecord.objects.select_related("user").order_by("created_at"):
            snapshot = result.snapshot if isinstance(result.snapshot, dict) else {}
            executor = snapshot.get("executor") if isinstance(snapshot.get("executor"), dict) else {}
            notification = snapshot.get("notification") if isinstance(snapshot.get("notification"), dict) else {}
            target = str(notification.get("targetName") or executor.get("ownerName") or "")
            names = [name.strip() for name in target.replace("，", "、").split("、") if name.strip()]
            status_map = {"success": "completed", "partial_success": "partial", "failed": "failed"}
            defaults = {
                "title": str(snapshot.get("description") or result.title)[:500],
                "sop_id": result.sop_id,
                "agent_name": str(executor.get("agentName") or "")[:128],
                "priority": WorkTask.Priority.NORMAL,
                "status": status_map.get(result.status, WorkTask.Status.COMPLETED),
                "progress": 100 if result.status == "success" else 80 if result.status == "partial_success" else 40,
                "assignee_names": names,
                "notification_mode": "group" if notification.get("channel") == "wecom_group" else "person",
                "notification_target": target,
                "notification_status": str(notification.get("status") or "pending")[:32],
                "timeline": [],
            }
            row, was_created = WorkTask.objects.update_or_create(
                sender=result.user, trace_id=result.trace_id, defaults=defaults,
            )
            record = WeComNotificationRecord.objects.filter(
                user=result.user, task_trace_id=result.trace_id,
            ).order_by("-created_at").first()
            if record:
                row.notification_record_id = record.id
                row.notification_status = record.status
                row.assignee_wecom_userids = record.target_ids
                row.save(update_fields=[
                    "notification_record_id", "notification_status",
                    "assignee_wecom_userids", "updated_at",
                ])
            technical = snapshot.get("technicalDetails") if isinstance(snapshot.get("technicalDetails"), dict) else {}
            raw_result = technical.get("rawResult") if isinstance(technical.get("rawResult"), dict) else {}
            _generate_work_task_artifacts(row, {}, raw_result)
            created += int(was_created)
            updated += int(not was_created)
        self.stdout.write(self.style.SUCCESS(f"任务补录完成：新增 {created}，更新 {updated}。"))
