from unittest.mock import patch

from django.test import SimpleTestCase

from .jackyun import _sign, query_inventory


class JackyunSignatureTests(SimpleTestCase):
    def test_signature_is_lowercase_and_excludes_reserved_fields(self):
        params = {
            "appkey": "TEST_KEY",
            "method": "erp.stockquantity.get",
            "timestamp": "2026-07-17 12:00:00",
            "version": "v1.0",
            "contenttype": "json",
            "bizcontent": '{"pageIndex": 0}',
        }
        base = _sign(params, "TEST_SECRET")
        with_reserved = _sign(
            {**params, "sign": "ignored", "contextid": "ignored", "token": "ignored"},
            "TEST_SECRET",
        )
        self.assertEqual(base, with_reserved)
        self.assertEqual(len(base), 32)
        self.assertEqual(base, base.lower())


class JackyunReadonlyGuardTests(SimpleTestCase):
    def test_rejects_unlisted_methods(self):
        from .jackyun import _api_call, JackyunError

        with self.assertRaises(JackyunError):
            _api_call("erp.stock.quantityadjust", {"goodsNo": "G001"})


class JackyunInventoryTests(SimpleTestCase):
    @patch("apps.connectors.jackyun._cache_inventory_mappings")
    @patch("apps.connectors.jackyun._api_call")
    def test_query_inventory_normalizes_vendor_fields(self, api_call, cache_mappings):
        api_call.return_value = {
            "code": "200",
            "result": {
                "data": {
                    "goodsStockQuantity": [{
                        "warehouseCode": "WH01",
                        "warehouseName": "主仓",
                        "goodsNo": "G001",
                        "goodsName": "测试商品",
                        "currentQuantity": "20",
                        "useQuantity": "17",
                        "lockedQuantity": "3",
                        "purchasingQuantity": "5",
                    }]
                }
            },
        }

        result = query_inventory(goods_no="G001", page_size=20)

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["summary"]["available_quantity"], 17)
        self.assertEqual(result["results"][0]["warehouse_code"], "WH01")
        self.assertEqual(result["results"][0]["purchasing_quantity"], 5)
        api_call.assert_called_once()
        self.assertEqual(api_call.call_args.args[0], "erp.stockquantity.get")
        self.assertEqual(api_call.call_args.args[1]["goodsNo"], "G001")
        cache_mappings.assert_called_once()
