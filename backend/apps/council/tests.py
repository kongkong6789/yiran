from unittest.mock import patch

from django.test import SimpleTestCase

from .restock import _inventory_for


class RestockMappingTests(SimpleTestCase):
    @patch("apps.connectors.jackyun.query_inventory")
    @patch("apps.council.restock.pglake.query")
    def test_inventory_uses_saved_sku_mapping(self, pg_query, query_inventory):
        pg_query.return_value = [{
            "goods_no": "8809669502311",
            "sku_barcode": "8809669502311",
            "goods_name": "测试商品",
            "source": "manual_verified",
            "confidence": 1,
        }]
        query_inventory.return_value = {
            "summary": {
                "available_quantity": 20,
                "current_quantity": 23,
                "locked_quantity": 3,
                "purchasing_quantity": 5,
            },
            "results": [{
                "goods_no": "8809669502311",
                "goods_name": "测试商品",
            }],
        }

        result = _inventory_for("SALE-SKU-1", "测试商品")

        self.assertIsNotNone(result)
        self.assertEqual(result["goods_no"], "8809669502311")
        self.assertEqual(result["available"], 20)
        self.assertEqual(result["matched_via"], "mapping")
        query_inventory.assert_called_once_with(
            goods_no="8809669502311",
            page_size=50,
        )
