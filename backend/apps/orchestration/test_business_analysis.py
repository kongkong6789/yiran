from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.core.models import WorkTask
from apps.core.organizations import ensure_current_organization
from apps.datalake.certified_metrics import canonical_hash
from apps.datalake.models import SourceSnapshot


class BusinessAnalysisTaskTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="analysis-user", password="test-pass")
        self.client.force_authenticate(self.user)
        self.organization = ensure_current_organization(self.user)
        payload = {
            "asset_key": "unove.sales.details",
            "display_name": "销售业务明细",
            "columns": ["dt", "gmv", "orders", "shop_id"],
            "rows": [
                {"dt": "2026-07-15", "gmv": 1200, "orders": 12, "shop_id": "S001"},
                {"dt": "2026-07-16", "gmv": 800, "orders": 10, "shop_id": "S002"},
            ],
        }
        self.snapshot = SourceSnapshot.objects.create(
            organization=self.organization,
            source_system="physical:postgres:dwd_sales_detail",
            source_mode=SourceSnapshot.SourceMode.LIVE,
            scope={"asset_key": "unove.sales.details", "display_name": "销售业务明细", "table": "dwd_sales_detail"},
            as_of=timezone.now(),
            complete=True,
            source_complete=True,
            boundary_covered=True,
            schema_version="physical-table-v1",
            row_count=2,
            content_hash=canonical_hash(payload),
            payload=payload,
            governance_status="governed",
            created_by=self.user,
        )

    @patch("apps.orchestration.business_analysis.llm.chat_messages_result")
    @patch("apps.orchestration.business_analysis.llm.llm_available", return_value=True)
    def test_weekly_report_reads_trusted_snapshot_and_returns_evidence(self, _available, chat):
        chat.return_value = {"content": "## 核心结论\n\nGMV 合计 2,000 元。", "model": "test-model", "error": ""}
        response = self.client.post("/api/orchestration/run/", {
            "text": "帮我生成销售周报",
            "payload": {},
            "trace_id": "weekly-report-1",
            "mode": "task_create",
        }, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["decision"], "allow")
        self.assertEqual(response.data["action"], "report.generate")
        self.assertEqual(response.data["result"]["execution_mode"], "ai_business_analysis")
        self.assertEqual(response.data["result"]["evidence"][0]["snapshot_id"], self.snapshot.id)
        self.assertIn("GMV 合计 2,000 元", response.data["result"]["report_markdown"])
        self.assertIn(self.snapshot.content_hash, response.data["result"]["report_markdown"])
        prompt = chat.call_args.args[1][0]["content"]
        self.assertIn("unove.sales.details", prompt)
        self.assertIn('"gmv":1200', prompt)

    def test_report_without_trusted_data_fails_closed(self):
        self.snapshot.delete()
        response = self.client.post("/api/orchestration/run/", {
            "text": "生成销售周报", "payload": {}, "trace_id": "weekly-report-no-data", "mode": "task_create",
        }, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["decision"], "block")
        self.assertEqual(response.data["result"]["error_code"], "TRUSTED_DATA_REQUIRED")
        self.assertNotEqual(response.data["action"], "task.manual")

    def test_ai_report_markdown_replaces_generic_task_template(self):
        task = WorkTask.objects.create(sender=self.user, trace_id="artifact-1", title="销售周报")
        response = self.client.patch("/api/tasks/artifact-1/", {
            "status": "completed",
            "progress": 100,
            "resultData": {"report_markdown": "# 真正的销售周报\n\nGMV：2,000 元", "evidence": []},
        }, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        markdown = bytes(task.artifacts.get(kind="md").content).decode("utf-8")
        self.assertEqual(markdown, "# 真正的销售周报\n\nGMV：2,000 元")
        self.assertNotIn("任务概览", markdown)
