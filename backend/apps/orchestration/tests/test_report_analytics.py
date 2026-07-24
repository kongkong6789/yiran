from django.test import SimpleTestCase

from apps.orchestration.report_analytics import (
    analysis_facts_markdown,
    build_analysis_pack,
)
from apps.orchestration.report_html import markdown_to_html_document


class ReportAnalyticsTests(SimpleTestCase):
    def test_build_analysis_pack_makes_kpi_series_and_charts(self):
        profiles = [{
            "display_name": "销售业务明细",
            "asset_key": "unove.sales.details",
            "columns": ["dt", "gmv", "orders", "shop_id"],
            "numeric_summary": {
                "gmv": {"count": 3, "sum": 3000, "average": 1000, "minimum": 800, "maximum": 1200},
                "orders": {"count": 3, "sum": 35, "average": 11.6, "minimum": 10, "maximum": 13},
            },
            "category_summary": {
                "shop_id": [
                    {"value": "S001", "count": 2},
                    {"value": "S002", "count": 1},
                ],
            },
            "date_ranges": {
                "dt": {
                    "minimum": "2026-07-14",
                    "maximum": "2026-07-16",
                    "observed_count": 3,
                    "observed_values": ["2026-07-14", "2026-07-15", "2026-07-16"],
                },
            },
            "rows": [
                {"dt": "2026-07-14", "gmv": 1000, "orders": 12, "shop_id": "S001"},
                {"dt": "2026-07-15", "gmv": 1200, "orders": 13, "shop_id": "S001"},
                {"dt": "2026-07-16", "gmv": 800, "orders": 10, "shop_id": "S002"},
            ],
        }]
        pack = build_analysis_pack(profiles)
        self.assertTrue(pack["kpis"])
        self.assertTrue(pack["series"])
        self.assertTrue(any(chart["type"] == "line" for chart in pack["charts"]))
        self.assertTrue(any(chart["type"] == "doughnut" for chart in pack["charts"]))
        md = analysis_facts_markdown(pack)
        self.assertIn("关键指标一览", md)
        self.assertIn("趋势明细", md)
        self.assertIn("3,000", md)

    def test_html_report_includes_kpi_and_chart_canvas(self):
        html_doc = markdown_to_html_document(
            "## 经营解读与结论\n\nGMV 表现稳定。\n\n## 可执行建议\n\n1. 加强主推款投放。",
            title="销售周报",
            kpis=[{"label": "GMV / 成交额", "asset": "销售业务明细", "sum": 3000}],
            charts=[{
                "id": "trend-1",
                "type": "line",
                "title": "GMV趋势",
                "labels": ["2026-07-14", "2026-07-15"],
                "datasets": [{"label": "GMV", "data": [1000, 1200]}],
            }],
        )
        self.assertIn("kpi-grid", html_doc)
        self.assertIn("chart.js", html_doc.lower())
        self.assertIn('id="trend-1"', html_doc)
        self.assertIn("report-charts-data", html_doc)
        self.assertIn("经营解读与结论", html_doc)
