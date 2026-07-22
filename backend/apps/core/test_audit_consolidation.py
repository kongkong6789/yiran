from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import AuditLog


class AuditConsolidationTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.member = User.objects.create_user(username="member", password="pass")
        self.admin = User.objects.create_superuser(username="admin", password="pass", email="admin@example.com")
        AuditLog.objects.create(
            trace_id="trace-audit-1",
            actor="admin",
            intent="库存补货分析",
            action="inventory.reorder.shadow",
            payload={"snapshot_id": 7},
            decision=AuditLog.Decision.ALLOW,
            checks=[{"name": "snapshot", "ok": True}],
            result={"simulation_run_id": 9},
        )

    def test_raw_compatibility_endpoint_rejects_non_superuser(self):
        self.client.force_authenticate(self.member)
        response = self.client.get("/api/audit-logs/")
        self.assertEqual(response.status_code, 403)

    def test_logs_overview_contains_raw_gate_detail_for_superuser(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/audit/overview/?page=1&pageSize=10")
        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.data["rows"] if item["traceId"] == "trace-audit-1")
        self.assertEqual(row["payload"], {"snapshot_id": 7})
        self.assertEqual(row["checks"], [{"name": "snapshot", "ok": True}])
        self.assertEqual(row["result"], {"simulation_run_id": 9})
        self.assertEqual(row["decision"], "allow")
