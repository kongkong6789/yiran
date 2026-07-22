from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.core.models import Organization, OrganizationMembership
from apps.ontology.models import OntObject, OntologyStatus


class InventoryShadowPilotTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(username="pilot-user", password="test-pass")
        self.other = User.objects.create_user(username="other-user", password="test-pass")
        self.organization = Organization.objects.create(name="Pilot企业", created_by=self.user)
        self.other_organization = Organization.objects.create(name="其他企业", created_by=self.other)
        OrganizationMembership.objects.create(
            organization=self.organization, user=self.user,
            role=OrganizationMembership.Role.MEMBER, is_primary=True,
        )
        OrganizationMembership.objects.create(
            organization=self.other_organization, user=self.other,
            role=OrganizationMembership.Role.OWNER, is_primary=True,
        )
        OntObject.objects.create(
            organization=self.organization,
            object_key="SKU:SKU-1",
            category="physical",
            otype="SKU",
            name="SKU-1",
            status=OntologyStatus.CONFIRMED,
            confirmed_by=self.user,
            confirmed_at=timezone.now(),
        )
        self.client.force_authenticate(self.user)

    def _snapshot(self, source_mode="live", complete=True):
        response = self.client.post("/api/datalake/snapshots/", {
            "source_system": "jackyun",
            "source_mode": source_mode,
            "scope": {"shop": "shop-1", "warehouse": "wh-1", "sku_ids": ["SKU-1"]},
            "as_of": timezone.now().isoformat(),
            "complete": complete,
            "completeness": {"pages_complete": complete},
            "schema_version": "inventory-v1",
            "payload": {"rows": [{
                "sku": "SKU-1",
                "available_quantity": 100,
                "in_transit_quantity": 20,
                "sales_qty": 300,
            }]},
        }, format="json")
        self.assertEqual(response.status_code, 201)
        return response.data["id"]

    def _metrics(self, snapshot_id):
        ids = []
        for metric_id in (
            "available_stock_qty", "in_transit_inventory_qty",
            "avg_daily_sales_qty", "inventory_cover_days",
        ):
            response = self.client.post("/api/datalake/metric-results/resolve/", {
                "snapshot_id": snapshot_id,
                "metric_id": metric_id,
                "version": "v1",
                "dimensions": {"sku": "SKU-1"},
            }, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            ids.append(response.data["id"])
        return ids

    def test_certified_metrics_and_simulation_are_reproducible(self):
        snapshot_id = self._snapshot()
        metric_ids = self._metrics(snapshot_id)
        loops = self.client.get("/api/loops/")
        self.assertEqual(loops.status_code, 200)
        loop = next(row for row in loops.data["results"] if row["loop_key"] == "inventory.reorder.balance")
        response = self.client.post(
            f"/api/loops/{loop['id']}/simulate/",
            {"metric_result_ids": metric_ids, "parameters": {"lead_time_days": 7, "periods": 30}},
            format="json",
            HTTP_IDEMPOTENCY_KEY="pilot-sim-1",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["result"]["classification"], "scenario_analysis_not_prediction")
        self.assertFalse(response.data["result"]["external_write_performed"])
        self.assertEqual(len(response.data["result"]["scenarios"]), 3)
        repeated = self.client.post(
            f"/api/loops/{loop['id']}/simulate/",
            {"metric_result_ids": metric_ids, "parameters": {"lead_time_days": 7, "periods": 30}},
            format="json",
            HTTP_IDEMPOTENCY_KEY="pilot-sim-1",
        )
        self.assertEqual(repeated.data["id"], response.data["id"])
        self.assertEqual(repeated.data["result_hash"], response.data["result_hash"])

    def test_fixture_and_incomplete_snapshot_fail_closed(self):
        fixture_id = self._snapshot(source_mode="fixture")
        response = self.client.post("/api/datalake/metric-results/resolve/", {
            "snapshot_id": fixture_id, "metric_id": "available_stock_qty", "version": "v1",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("fixture", response.data["error"])
        incomplete_id = self._snapshot(complete=False)
        response = self.client.post("/api/datalake/metric-results/resolve/", {
            "snapshot_id": incomplete_id, "metric_id": "available_stock_qty", "version": "v1",
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("不完整", response.data["error"])

    def test_orchestration_uses_login_principal_and_in_process_graph(self):
        snapshot_id = self._snapshot()
        response = self.client.post("/api/orchestration/run/", {
            "text": "请做库存补货分析",
            "role": "director",
            "payload": {"snapshot_id": snapshot_id, "parameters": {"periods": 14}},
            "trace_id": "shadow-graph-1",
        }, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["decision"], "allow")
        self.assertEqual(response.data["principal"]["role"], "operator")
        self.assertEqual(response.data["action"], "inventory.reorder.shadow")
        self.assertFalse(response.data["result"]["result"]["external_write_performed"])

    def test_cross_tenant_loop_and_simulation_are_hidden(self):
        loops = self.client.get("/api/loops/")
        loop_id = next(row["id"] for row in loops.data["results"] if row["loop_key"] == "inventory.reorder.balance")
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f"/api/loops/{loop_id}/").status_code, 404)
