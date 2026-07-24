"""Deterministic analytics for business reports (facts before LLM narration)."""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Any


_METRIC_ALIASES = {
    "gmv": ("gmv", "sales", "sales_amount", "amount", "pay_amount", "payment", "成交额", "销售额"),
    "orders": ("orders", "order_cnt", "order_count", "qty_order", "订单", "订单数"),
    "qty": ("qty", "quantity", "sales_qty", "件数", "销量"),
    "uv": ("uv", "visitor", "visitors", "访客"),
    "refund": ("refund", "refund_amount", "退款"),
}


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _fmt_number(value: float | int | None) -> str:
    if value is None:
        return "—"
    number = float(value)
    if abs(number - round(number)) < 1e-9 and abs(number) >= 1:
        return f"{int(round(number)):,}"
    if abs(number) >= 100:
        return f"{number:,.1f}"
    return f"{number:,.2f}"


def _metric_label(key: str) -> str:
    labels = {
        "gmv": "GMV / 成交额",
        "orders": "订单数",
        "qty": "销量 / 件数",
        "uv": "访客 UV",
        "refund": "退款额",
    }
    return labels.get(key, key)


def _detect_metric_columns(columns: list[str], numeric_summary: dict) -> dict[str, str]:
    """Map canonical metric -> actual column name."""
    found: dict[str, str] = {}
    lower_map = {str(col).lower(): str(col) for col in columns}
    for canonical, aliases in _METRIC_ALIASES.items():
        for alias in aliases:
            if alias in lower_map and lower_map[alias] in numeric_summary:
                found[canonical] = lower_map[alias]
                break
            for col_low, col in lower_map.items():
                if alias in col_low and col in numeric_summary:
                    found[canonical] = col
                    break
            if canonical in found:
                break
    if not found:
        ranked = sorted(
            (
                (col, abs(float((numeric_summary.get(col) or {}).get("sum") or 0)))
                for col in numeric_summary
            ),
            key=lambda item: item[1],
            reverse=True,
        )
        for index, (col, _) in enumerate(ranked[:3]):
            found[f"metric_{index + 1}"] = col
    return found


def _series_by_date(rows: list[dict], date_col: str, metric_cols: dict[str, str]) -> list[dict]:
    buckets: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    counts: dict[str, int] = defaultdict(int)
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = str(row.get(date_col) or "")[:10]
        if not day:
            continue
        counts[day] += 1
        for canonical, col in metric_cols.items():
            number = _finite(row.get(col))
            if number is not None:
                buckets[day][canonical] += number
    series = []
    for day in sorted(buckets):
        point = {"dt": day, "rows": counts[day]}
        for canonical in metric_cols:
            point[canonical] = round(buckets[day].get(canonical, 0.0), 6)
        series.append(point)
    return series


def _pick_date_column(profile: dict) -> str | None:
    date_ranges = profile.get("date_ranges") or {}
    for preferred in ("dt", "date", "day", "biz_date"):
        if preferred in date_ranges:
            return preferred
    if date_ranges:
        return next(iter(date_ranges))
    return None


def _mom_change(series: list[dict], metric: str) -> dict | None:
    if len(series) < 2:
        return None
    mid = max(1, len(series) // 2)
    first = series[:mid]
    second = series[mid:]
    a = sum(float(item.get(metric) or 0) for item in first)
    b = sum(float(item.get(metric) or 0) for item in second)
    if a == 0 and b == 0:
        return None
    delta = b - a
    pct = None if a == 0 else round(delta / a * 100, 2)
    return {
        "metric": metric,
        "earlier_sum": round(a, 6),
        "later_sum": round(b, 6),
        "delta": round(delta, 6),
        "pct": pct,
        "earlier_days": len(first),
        "later_days": len(second),
    }


def _anomaly_flags(series: list[dict], metric: str) -> list[dict]:
    values = [float(item.get(metric) or 0) for item in series]
    if len(values) < 3:
        return []
    mean = sum(values) / len(values)
    variance = sum((value - mean) ** 2 for value in values) / len(values)
    std = math.sqrt(variance)
    if std < 1e-9:
        return []
    flags = []
    for item, value in zip(series, values):
        z = (value - mean) / std
        if abs(z) >= 1.8:
            flags.append({
                "dt": item.get("dt"),
                "metric": metric,
                "value": round(value, 6),
                "z": round(z, 2),
                "direction": "偏高" if z > 0 else "偏低",
            })
    return flags[:5]


def build_analysis_pack(profiles: list[dict]) -> dict:
    """Build KPI / series / breakdown facts and chart specs from trusted profiles."""
    kpis: list[dict] = []
    series_blocks: list[dict] = []
    breakdowns: list[dict] = []
    mom: list[dict] = []
    anomalies: list[dict] = []
    charts: list[dict] = []

    for profile in profiles:
        if not isinstance(profile, dict):
            continue
        numeric = profile.get("numeric_summary") or {}
        categorical = profile.get("category_summary") or {}
        columns = list(profile.get("columns") or [])
        rows = list(profile.get("rows") or [])
        asset = str(profile.get("display_name") or profile.get("asset_key") or "数据")
        metrics = _detect_metric_columns(columns, numeric)
        date_col = _pick_date_column(profile)

        for canonical, col in metrics.items():
            summary = numeric.get(col) or {}
            kpis.append({
                "asset": asset,
                "key": canonical,
                "column": col,
                "label": _metric_label(canonical) if not str(canonical).startswith("metric_") else col,
                "sum": summary.get("sum"),
                "average": summary.get("average"),
                "minimum": summary.get("minimum"),
                "maximum": summary.get("maximum"),
                "count": summary.get("count"),
            })

        if date_col and metrics and rows:
            series = _series_by_date(rows, date_col, metrics)
            if series:
                series_blocks.append({
                    "asset": asset,
                    "date_col": date_col,
                    "metrics": metrics,
                    "points": series,
                })
                primary = next(iter(metrics))
                charts.append({
                    "id": f"trend-{len(charts) + 1}",
                    "type": "line",
                    "title": f"{asset} · {_metric_label(primary)}趋势",
                    "labels": [point["dt"] for point in series],
                    "datasets": [{
                        "label": _metric_label(primary),
                        "data": [point.get(primary) or 0 for point in series],
                    }],
                })
                change = _mom_change(series, primary)
                if change:
                    change["asset"] = asset
                    mom.append(change)
                anomalies.extend({**flag, "asset": asset} for flag in _anomaly_flags(series, primary))

        for col, values in list(categorical.items())[:4]:
            if not isinstance(values, list) or len(values) < 2:
                continue
            top = values[:8]
            breakdowns.append({
                "asset": asset,
                "column": col,
                "items": top,
            })
            charts.append({
                "id": f"pie-{len(charts) + 1}",
                "type": "doughnut",
                "title": f"{asset} · {col} 结构",
                "labels": [str(item.get("value")) for item in top],
                "datasets": [{
                    "label": col,
                    "data": [int(item.get("count") or 0) for item in top],
                }],
            })

    return {
        "kpis": kpis[:12],
        "series": series_blocks[:4],
        "breakdowns": breakdowns[:6],
        "mom": mom[:6],
        "anomalies": anomalies[:8],
        "charts": charts[:6],
    }


def analysis_facts_markdown(pack: dict) -> str:
    """Deterministic Markdown sections (numbers only, no LLM)."""
    lines: list[str] = ["", "## 关键指标一览", ""]
    kpis = pack.get("kpis") or []
    if not kpis:
        lines.append("当前筛选结果中暂无可用的数值型经营指标。")
    else:
        lines.extend([
            "| 指标 | 数据资产 | 合计 | 均值 | 最小 | 最大 | 样本数 |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: |",
        ])
        for row in kpis:
            lines.append(
                f"| {row.get('label') or row.get('column')} | {row.get('asset')} | "
                f"{_fmt_number(row.get('sum'))} | {_fmt_number(row.get('average'))} | "
                f"{_fmt_number(row.get('minimum'))} | {_fmt_number(row.get('maximum'))} | "
                f"{_fmt_number(row.get('count'))} |"
            )

    mom = pack.get("mom") or []
    if mom:
        lines.extend(["", "## 前后半段对比（自动）", ""])
        lines.extend([
            "| 指标 | 数据资产 | 前半合计 | 后半合计 | 变化 | 变化率 |",
            "| --- | --- | ---: | ---: | ---: | ---: |",
        ])
        for row in mom:
            pct = row.get("pct")
            pct_text = "—" if pct is None else f"{pct:+.1f}%"
            lines.append(
                f"| {_metric_label(str(row.get('metric')))} | {row.get('asset')} | "
                f"{_fmt_number(row.get('earlier_sum'))} | {_fmt_number(row.get('later_sum'))} | "
                f"{_fmt_number(row.get('delta'))} | {pct_text} |"
            )

    for block in pack.get("series") or []:
        metrics = block.get("metrics") or {}
        primary = next(iter(metrics), None)
        if not primary:
            continue
        lines.extend(["", f"## 趋势明细 · {block.get('asset')}", ""])
        lines.extend([
            f"| 日期 | {_metric_label(primary)} | 记录数 |",
            "| --- | ---: | ---: |",
        ])
        for point in block.get("points") or []:
            lines.append(
                f"| {point.get('dt')} | {_fmt_number(point.get(primary))} | {_fmt_number(point.get('rows'))} |"
            )

    for block in pack.get("breakdowns") or []:
        lines.extend(["", f"## 结构分布 · {block.get('asset')} / {block.get('column')}", ""])
        lines.extend(["| 维度值 | 出现次数 |", "| --- | ---: |"])
        for item in block.get("items") or []:
            lines.append(f"| {item.get('value')} | {_fmt_number(item.get('count'))} |")

    anomalies = pack.get("anomalies") or []
    if anomalies:
        lines.extend(["", "## 自动识别波动点", ""])
        for flag in anomalies:
            lines.append(
                f"- {flag.get('asset')} · {flag.get('dt')} · {_metric_label(str(flag.get('metric')))} "
                f"{flag.get('direction')}（值 {_fmt_number(flag.get('value'))}，z={flag.get('z')}）"
            )

    lines.append("")
    return "\n".join(lines)


def analysis_facts_for_llm(pack: dict) -> dict:
    """Compact JSON the model may cite (no raw rows)."""
    return {
        "kpis": pack.get("kpis") or [],
        "mom": pack.get("mom") or [],
        "anomalies": pack.get("anomalies") or [],
        "series_preview": [
            {
                "asset": block.get("asset"),
                "points": (block.get("points") or [])[:14],
                "metrics": list((block.get("metrics") or {}).keys()),
            }
            for block in (pack.get("series") or [])[:3]
        ],
        "breakdowns": pack.get("breakdowns") or [],
    }
