"""结构化财务事实库知识注入。

数据源：
  - finance_source_files：源文件、批次与数据质量元数据
  - finance_settlement_lines：结算明细
  - finance_monthly_metrics：月×店×平台×结算类型×项目聚合

同一拼多多推广账单存在旧 XLSX 与新 Markdown 批次时，只采用 Markdown，
避免推广费用重复计算。
"""
from __future__ import annotations

import re

from apps.datalake.pg import finance_pglake


_TRIGGERS = (
    "财务", "结算", "账单", "对账", "收入", "支出", "费用", "净额",
    "现金", "佣金", "推广费", "服务费", "物流费", "财务利润",
)
_PLATFORMS = ("拼多多", "天猫", "微信", "小红书", "吉客云", "支付宝")

_EFFECTIVE_CTE = """
WITH effective_sources AS (
    SELECT f.id
    FROM finance_source_files f
    WHERE COALESCE(f.row_count, 0) > 0
      AND COALESCE(f.metadata->>'handling_status', '') <> 'reference_only'
      AND NOT (
        f.file_role = 'promotion_statement'
        AND LOWER(COALESCE(f.file_ext, '')) <> '.md'
        AND EXISTS (
            SELECT 1 FROM finance_source_files newer
            WHERE newer.period_month = f.period_month
              AND newer.shop_name = f.shop_name
              AND newer.platform = f.platform
              AND newer.file_role = f.file_role
              AND LOWER(COALESCE(newer.file_ext, '')) = '.md'
              AND COALESCE(newer.row_count, 0) > 0
        )
      )
),
effective_metrics AS (
    SELECT m.*
    FROM finance_monthly_metrics m
    WHERE EXISTS (
        SELECT 1
        FROM effective_sources e,
             LATERAL jsonb_array_elements_text(
                 COALESCE(m.attributes->'source_file_ids', '[]'::jsonb)
             ) sid
        WHERE sid.value = e.id
    )
)
"""


def _money(value) -> str:
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        return f"{value}元"
    av = abs(v)
    if av >= 100_000_000:
        return f"{v / 100_000_000:.2f}".rstrip("0").rstrip(".") + "亿元"
    if av >= 10_000:
        return f"{v / 10_000:.2f}".rstrip("0").rstrip(".") + "万元"
    return f"{v:,.2f}元"


def _ready() -> bool:
    return finance_pglake.enabled() and finance_pglake.available()


def _filters(question: str) -> tuple[str | None, str | None]:
    month_match = re.search(r"(20\d{2})[-年/.](0?[1-9]|1[0-2])", question or "")
    month = None
    if month_match:
        month = f"{month_match.group(1)}-{int(month_match.group(2)):02d}"
    platform = next((p for p in _PLATFORMS if p in (question or "")), None)
    return month, platform


def _where(month: str | None, platform: str | None) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []
    if month:
        clauses.append("period_month = %s")
        params.append(month)
    if platform:
        clauses.append("platform = %s")
        params.append(platform)
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def finance_block(question: str) -> str:
    """命中财务意图时返回可审计的月度汇总资料卡。"""
    q = (question or "").lower()
    if not any(k.lower() in q for k in _TRIGGERS):
        return ""
    if not _ready():
        return "【财务事实库】当前连接不可用，无法读取结算与费用数据。"

    month, platform = _filters(question)
    try:
        if not month:
            latest = finance_pglake.query(
                "SELECT MAX(period_month) AS month FROM finance_monthly_metrics"
            )
            month = latest[0].get("month") if latest else None
        where_sql, params = _where(month, platform)

        totals = finance_pglake.query(
            _EFFECTIVE_CTE
            + """
            SELECT period_month,
                   COUNT(*) AS metric_rows,
                   SUM(income_amount) AS income,
                   SUM(expense_amount) AS expense,
                   SUM(net_amount) AS net,
                   SUM(operating_income_amount) AS operating_income,
                   SUM(operating_expense_amount) AS operating_expense,
                   SUM(operating_net_amount) AS operating_net,
                   SUM(internal_transfer_amount) AS internal_transfer
            FROM effective_metrics
            """
            + where_sql
            + " GROUP BY period_month ORDER BY period_month DESC",
            params,
        )
        by_platform = finance_pglake.query(
            _EFFECTIVE_CTE
            + """
            SELECT platform,
                   SUM(income_amount) AS income,
                   SUM(expense_amount) AS expense,
                   SUM(net_amount) AS net,
                   SUM(operating_expense_amount) AS operating_expense
            FROM effective_metrics
            """
            + where_sql
            + " GROUP BY platform ORDER BY SUM(expense_amount) DESC",
            params,
        )
        top_expenses = finance_pglake.query(
            _EFFECTIVE_CTE
            + """
            SELECT income_item, SUM(operating_expense_amount) AS expense
            FROM effective_metrics
            """
            + where_sql
            + """
            GROUP BY income_item
            HAVING SUM(operating_expense_amount) > 0
            ORDER BY expense DESC
            LIMIT 8
            """,
            params,
        )
        source_where = "WHERE period_month = %s"
        source_params: list = [month]
        if platform:
            source_where += " AND platform = %s"
            source_params.append(platform)
        source_summary = finance_pglake.query(
            """
            WITH valid AS (
                SELECT f.*
                FROM finance_source_files f
                WHERE COALESCE(f.row_count, 0) > 0
                  AND COALESCE(f.metadata->>'handling_status', '') <> 'reference_only'
                  AND NOT (
                    f.file_role = 'promotion_statement'
                    AND LOWER(COALESCE(f.file_ext, '')) <> '.md'
                    AND EXISTS (
                        SELECT 1 FROM finance_source_files newer
                        WHERE newer.period_month = f.period_month
                          AND newer.shop_name = f.shop_name
                          AND newer.platform = f.platform
                          AND newer.file_role = f.file_role
                          AND LOWER(COALESCE(newer.file_ext, '')) = '.md'
                    )
                  )
            )
            SELECT COUNT(*) AS files, COALESCE(SUM(row_count), 0) AS declared_rows
            FROM valid
            """
            + source_where,
            source_params,
        )
    except Exception as exc:
        return f"【财务事实库】查询失败：{exc}"

    if not totals:
        scope = f"{month or '指定期间'}{platform or ''}"
        return f"【财务事实库】{scope}暂无有效财务数据。"

    total = totals[0]
    src = source_summary[0] if source_summary else {}
    scope = f"{total['period_month']}" + (f" · {platform}" if platform else "")
    lines = [
        "【结构化财务事实库(PostgreSQL·已去重)】",
        f"- 范围：{scope}；有效源文件 {int(src.get('files') or 0)} 个",
        "- 去重：拼多多推广费用优先新版 Markdown，排除旧批次 XLSX",
        f"- 账面收入：{_money(total['income'])}；账面支出：{_money(total['expense'])}；"
        f"账面净额：{_money(total['net'])}",
        f"- 经营收入：{_money(total['operating_income'])}；"
        f"经营支出：{_money(total['operating_expense'])}；"
        f"经营净额：{_money(total['operating_net'])}",
        f"- 内部转账：{_money(total['internal_transfer'])}（不作为经营损益）",
    ]
    if by_platform:
        lines.append("· 平台汇总：")
        for row in by_platform:
            lines.append(
                f"  - {row['platform'] or '未标注平台'}：收入 {_money(row['income'])}，"
                f"支出 {_money(row['expense'])}，净额 {_money(row['net'])}"
            )
    if top_expenses:
        lines.append("· 主要支出项目：")
        lines.extend(
            f"  - {row['income_item'] or '未分类'}：{_money(row['expense'])}"
            for row in top_expenses
        )
    lines.append(
        "- 口径：finance_monthly_metrics；明细可追溯至 finance_settlement_lines/source_files"
    )
    return "\n".join(lines)
