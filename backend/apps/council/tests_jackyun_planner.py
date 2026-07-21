from unittest.mock import patch

from django.test import SimpleTestCase

from apps.council.jackyun_planner import (
    _heuristic_plan,
    _sanitize_plan,
    should_query_jackyun,
)
from apps.connectors.jackyun import JackyunError, query_by_plan
from apps.connectors.jackyun_catalog import CAPABILITIES, list_capabilities


class JackyunCatalogTests(SimpleTestCase):
    def test_catalog_methods_are_declared(self):
        ids = {c["id"] for c in list_capabilities()}
        self.assertEqual(ids, set(CAPABILITIES))
        for meta in CAPABILITIES.values():
            self.assertTrue(meta["method"])


class JackyunPlannerGateTests(SimpleTestCase):
    def test_gate_skips_chitchat(self):
        self.assertFalse(should_query_jackyun("今天天气怎么样"))

    def test_gate_hits_business_and_sku(self):
        self.assertTrue(should_query_jackyun("帮我看看库存"))
        self.assertTrue(should_query_jackyun("8809669502311 要不要补货"))
        self.assertTrue(should_query_jackyun("查一下这个货号的商品信息"))


class JackyunPlannerHeuristicTests(SimpleTestCase):
    def test_heuristic_inventory_for_sku_restock(self):
        plan = _heuristic_plan("8809669502311 库存是否要补货")
        self.assertEqual(plan["capability"], "inventory")
        self.assertEqual(plan["params"].get("goodsNo"), "8809669502311")

    def test_heuristic_trades(self):
        plan = _heuristic_plan("查一下货号 8809669502311 的最近订单")
        self.assertEqual(plan["capability"], "trades")

    def test_heuristic_goods(self):
        plan = _heuristic_plan("货号 8809669502311 的商品信息是什么")
        self.assertEqual(plan["capability"], "goods")

    def test_sanitize_rejects_unknown_capability(self):
        self.assertIsNone(_sanitize_plan({"capability": "hack", "params": {}}, "x"))

    def test_sanitize_filters_unknown_params(self):
        plan = _sanitize_plan(
            {
                "capability": "inventory",
                "params": {"goodsNo": "G1", "evil": "1"},
                "reason": "t",
            },
            "G1 库存",
        )
        self.assertEqual(plan["capability"], "inventory")
        self.assertEqual(plan["params"], {"goodsNo": "G1"})


class JackyunQueryByPlanTests(SimpleTestCase):
    def test_rejects_unknown_capability(self):
        with self.assertRaises(JackyunError):
            query_by_plan("not-real", {})

    def test_rejects_unknown_params(self):
        with self.assertRaises(JackyunError):
            query_by_plan("inventory", {"notAParam": "x"})

    @patch("apps.connectors.jackyun._cache_inventory_mappings")
    @patch("apps.connectors.jackyun._api_call")
    def test_inventory_via_query_by_plan(self, api_call, _cache):
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
        result = query_by_plan("inventory", {"goodsNo": "G001", "pageSize": 20})
        self.assertEqual(result["capability"], "inventory")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["summary"]["available_quantity"], 17)
        self.assertEqual(api_call.call_args.args[0], "erp.stockquantity.get")
