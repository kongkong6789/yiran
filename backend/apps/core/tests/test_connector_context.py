from contextlib import nullcontext
from unittest import TestCase, mock

from apps.core.connector_context import (
    collect_connector_context,
    normalize_connector_ids,
)


class ConnectorContextTests(TestCase):
    def test_connector_ids_are_allowlisted_and_deduplicated(self):
        self.assertEqual(
            normalize_connector_ids(["JACKYUN", "shell", "jackyun", "nas"]),
            ["jackyun", "nas"],
        )

    def test_selected_jackyun_executes_real_read_context_path(self):
        with (
            mock.patch(
                "apps.core.connector_context.use_connector_secrets",
                return_value=nullcontext({}),
            ),
            mock.patch(
                "apps.core.connector_context.jackyun_block",
                return_value="【吉客云·inventory】实时库存 12",
            ) as query,
        ):
            result = collect_connector_context(
                "请通过吉客云连接器查询 SKU-100",
                connector_ids=["jackyun"],
            )

        query.assert_called_once()
        self.assertEqual(result["attempted_count"], 1)
        self.assertIn("实时库存 12", result["blocks"][0])
        self.assertEqual(result["refs"][0]["server"], "jackyun")
        self.assertTrue(result["refs"][0]["ok"])

    def test_selected_wecom_without_document_reports_missing_link(self):
        result = collect_connector_context(
            "请使用企业微信连接器",
            connector_ids=["wecom"],
            wecom_reader=lambda *_args, **_kwargs: {
                "attempted": False,
                "content": "",
                "error": "",
            },
        )

        self.assertIn("没有提供可读取的企业微信文档链接", result["blocks"][0])
