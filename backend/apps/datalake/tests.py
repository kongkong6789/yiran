import hashlib
import io
import json
from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase
from openpyxl import Workbook

from apps.core.models import Organization, OrganizationMembership
from apps.datalake.models import RawImportBatch, SourceSnapshot


class GovernedSalesLedgerTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="raw-owner", password="test-pass")
        self.organization = Organization.objects.create(name="Raw Pilot", created_by=self.user)
        OrganizationMembership.objects.create(
            organization=self.organization, user=self.user,
            role=OrganizationMembership.Role.OWNER, is_primary=True,
        )
        self.client.force_authenticate(self.user)

    def _mapping(self, key, kind, mappings):
        response = self.client.post("/api/datalake/reference-mappings/", {
            "mapping_key": key, "kind": kind, "version": "v1", "mappings": mappings,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        mapping_id = response.data["id"]
        confirmed = self.client.post(f"/api/datalake/reference-mappings/{mapping_id}/confirm/", {}, format="json")
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        return mapping_id

    @staticmethod
    def _workbook():
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Sheet1"
        sheet.append([
            "订单编号", "销售渠道", "货品编号", "数量", "分摊后金额", "结算币种",
            "建单时间", "订单状态", "订单类型", "品牌",
        ])
        sheet.append(["SECRET-ORDER-1", "天猫旗舰店", "RAW-SKU-1", "3", "99.90", "CNY",
                      "2026-01-23", "已完成", "零售业务", "UNOVE"])
        sheet.append(["SECRET-ORDER-2", "天猫旗舰店", "RAW-SKU-1", "5", "160.10", "RMB",
                      "2026-07-21", "发货在途", "零售业务", "UNOVE"])
        stream = io.BytesIO()
        workbook.save(stream)
        return stream.getvalue()

    def test_governed_import_is_aggregate_only_and_requires_reconciliation(self):
        contracts = self.client.get("/api/datalake/import-contracts/")
        contract = next(row for row in contracts.data["results"] if row["contract_key"] == "jackyun.sales_ledger.governed_raw")
        channel_id = self._mapping("unove.channel", "channel", {"天猫旗舰店": {"order_class": "天猫"}})
        product_id = self._mapping("unove.product", "product", {"RAW-SKU-1": {"sku_id": "SKU-1", "product_type": "正装"}})
        content = self._workbook()
        manifest = {
            "schema": "yiran_governed_raw_manifest_v1", "schema_version": "sales-ledger-v1",
            "content_sha256": f"sha256:{hashlib.sha256(content).hexdigest()}",
            "contract_hash": contract["contract_hash"], "row_count": 2,
            "window": {"start": "2026-01-23", "end": "2026-07-21"},
        }
        response = self.client.post("/api/datalake/raw-imports/sales-ledger/", {
            "file": SimpleUploadedFile("sales.xlsx", content), "manifest": json.dumps(manifest),
            "contract_id": contract["id"], "channel_mapping_id": channel_id, "product_mapping_id": product_id,
        }, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data["source_complete"])
        self.assertTrue(response.data["boundary_covered"])
        batch = RawImportBatch.objects.get(id=response.data["id"])
        serialized = json.dumps(batch.aggregate_receipt, ensure_ascii=False)
        self.assertNotIn("SECRET-ORDER", serialized)
        self.assertIn('"sales_qty": "8"', serialized)

        reconciled = self.client.post(f"/api/datalake/raw-imports/{batch.id}/reconcile/", {
            "reconciliation_hash": response.data["reconciliation_hash"],
        }, format="json")
        self.assertEqual(reconciled.status_code, 200, reconciled.data)
        self.assertTrue(reconciled.data["source_complete"])
        self.assertIsNotNone(reconciled.data["snapshot_id"])

        inventory = self.client.post("/api/datalake/snapshots/", {
            "source_system": "jackyun_inventory", "source_mode": "live",
            "scope": {"sku_ids": ["SKU-1"], "warehouse": "WH-1"},
            "as_of": "2026-07-22T00:00:00+08:00", "complete": True,
            "schema_version": "inventory-v1", "payload": {"rows": [{
                "sku": "SKU-1", "available_quantity": "100", "in_transit_quantity": "20",
            }]},
        }, format="json")
        self.assertEqual(inventory.status_code, 201, inventory.data)
        composite = self.client.post("/api/datalake/snapshots/compose/", {
            "inventory_snapshot_id": inventory.data["id"],
            "sales_snapshot_id": reconciled.data["snapshot_id"],
        }, format="json")
        self.assertEqual(composite.status_code, 201, composite.data)
        self.assertEqual(composite.data["source_system"], "composite_inventory_sales")
        metric = self.client.post("/api/datalake/metric-results/resolve/", {
            "snapshot_id": composite.data["id"], "metric_id": "avg_daily_sales_qty", "version": "v1",
        }, format="json")
        self.assertEqual(metric.status_code, 200, metric.data)
        self.assertEqual(metric.data["value"], "0.26666667")

    def test_sales_ledger_cannot_bypass_governed_import(self):
        response = self.client.post("/api/datalake/snapshots/", {
            "source_system": "jackyun_sales_ledger_export", "source_mode": "live",
            "as_of": "2026-07-22T00:00:00+08:00", "complete": True,
            "schema_version": "v1", "payload": {"rows": [{"sales_qty": 10}]},
        }, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("governed Raw", response.data["error"])

    @patch("apps.datalake.views.ducklake.query")
    @patch("apps.datalake.views.ducklake.list_tables")
    @patch("apps.datalake.views._use_pg", return_value=False)
    def test_existing_business_asset_can_be_published_as_trusted_data(
        self, _use_pg_mock, list_tables_mock, query_mock,
    ):
        list_tables_mock.return_value = [{"table": "daily_sales", "rows": 2}]
        query_mock.return_value = [
            {"dt": date(2026, 7, 21), "shop": "天猫", "gmv": 100},
            {"dt": date(2026, 7, 22), "shop": "抖音", "gmv": 200},
        ]
        response = self.client.post("/api/datalake/assets/publish/", {
            "table": "daily_sales",
            "asset_key": "unove.sales",
            "display_name": "UNOVE 销售数据",
            "as_of": "2026-07-22T12:00:00+08:00",
            "confirm_complete": True,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["governance_status"], "governed")
        snapshot = SourceSnapshot.objects.get(id=response.data["id"])
        self.assertEqual(snapshot.scope["asset_key"], "unove.sales")
        self.assertEqual(snapshot.row_count, 2)
        self.assertTrue(snapshot.complete)

        repeated = self.client.post("/api/datalake/assets/publish/", {
            "table": "daily_sales",
            "asset_key": "unove.sales",
            "display_name": "UNOVE 销售数据",
            "as_of": "2026-07-22T12:00:00+08:00",
            "confirm_complete": True,
        }, format="json")
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertTrue(repeated.data["reused"])

    @patch("apps.datalake.views.ducklake.query")
    @patch("apps.datalake.views.ducklake.list_tables")
    @patch("apps.datalake.views._use_pg", return_value=False)
    def test_existing_business_asset_can_be_previewed(
        self, _use_pg_mock, list_tables_mock, query_mock,
    ):
        list_tables_mock.return_value = [{"table": "daily_sales", "rows": 2}]
        query_mock.return_value = [
            {"dt": "2026-07-22", "shop": "天猫", "gmv": 100},
            {"dt": "2026-07-22", "shop": "抖音", "gmv": 200},
        ]
        response = self.client.get("/api/datalake/assets/daily_sales/preview/?limit=20")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["columns"], ["dt", "shop", "gmv"])
        self.assertEqual(response.data["row_count"], 2)
        self.assertEqual(len(response.data["rows"]), 2)
        self.assertEqual(response.data["trusted_versions"], [])
