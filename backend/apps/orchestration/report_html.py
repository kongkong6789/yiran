"""Markdown → self-contained HTML report for SOP / trial artifacts."""
from __future__ import annotations

import html
import json
import re


def looks_like_html_document(text: str) -> bool:
    sample = (text or "").lstrip().lower()
    return sample.startswith("<!doctype html") or sample.startswith("<html")


def extract_embedded_html(report: str) -> tuple[str, str]:
    """Peel a full HTML document out of model output (fenced or raw).

    Returns (html_document, remaining_markdown).
    """
    text = (report or "").strip()
    if not text:
        return "", ""

    fence = re.search(r"```html\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    if fence:
        candidate = fence.group(1).strip()
        if looks_like_html_document(candidate):
            remaining = f"{text[:fence.start()]}{text[fence.end():]}".strip()
            return candidate, remaining

    # Model often opens ```html and never closes it before hitting the token limit.
    open_fence = re.search(r"```html\s*([\s\S]*)$", text, flags=re.IGNORECASE)
    if open_fence:
        candidate = open_fence.group(1).strip()
        # Drop a trailing incomplete closer if present.
        candidate = re.sub(r"```\s*$", "", candidate).strip()
        if looks_like_html_document(candidate):
            remaining = text[:open_fence.start()].strip()
            return candidate, remaining

    doc = re.search(r"(<!DOCTYPE\s+html[\s\S]*?</html>)", text, flags=re.IGNORECASE)
    if doc:
        remaining = f"{text[:doc.start()]}{text[doc.end():]}".strip()
        remaining = re.sub(r"```html\s*$", "", remaining, flags=re.IGNORECASE).strip()
        remaining = re.sub(r"^```\s*", "", remaining).strip()
        return doc.group(1).strip(), remaining

    if looks_like_html_document(text):
        return text, ""

    return "", text


def resolve_report_output_format(payload: dict | None, text: str = "", instruction: str = "") -> str:
    data = payload if isinstance(payload, dict) else {}
    raw = str(
        data.get("output_format")
        or data.get("report_format")
        or data.get("format")
        or ""
    ).strip().lower()
    aliases = {
        "html": "html",
        "htm": "html",
        "webpage": "html",
        "web": "html",
        "markdown": "markdown",
        "md": "markdown",
        "text": "markdown",
    }
    if raw in aliases:
        return aliases[raw]
    blob = f"{instruction}\n{text}\n{data.get('_node_instruction') or ''}"
    if any(token in blob for token in ("HTML", "html", "网页报告", "网页版", "输出html", "输出 HTML")):
        return "html"
    return "markdown"


def markdown_to_html_document(
    markdown: str,
    *,
    title: str = "经营分析报告",
    kpis: list[dict] | None = None,
    charts: list[dict] | None = None,
) -> str:
    body = _markdown_to_html_body(markdown or "")
    safe_title = html.escape(title or "经营分析报告")
    kpi_html = _render_kpi_strip(kpis or [])
    charts_html = _render_chart_canvases(charts or [])
    charts_payload = json.dumps(charts or [], ensure_ascii=False).replace("</", "<\\/")
    chart_boot = ""
    if charts:
        chart_boot = f"""
  <script id="report-charts-data" type="application/json">{charts_payload}</script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script>
    (function() {{
      const node = document.getElementById("report-charts-data");
      if (!node || !window.Chart) return;
      let charts = [];
      try {{ charts = JSON.parse(node.textContent || "[]"); }} catch (err) {{ return; }}
      const palette = ["#0f766e", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#65a30d"];
      charts.forEach((spec) => {{
        const canvas = document.getElementById(spec.id);
        if (!canvas) return;
        const colors = (spec.labels || []).map((_, i) => palette[i % palette.length]);
        const datasets = (spec.datasets || []).map((ds, di) => ({{
          label: ds.label || spec.title || "系列",
          data: ds.data || [],
          borderColor: palette[di % palette.length],
          backgroundColor: spec.type === "line" ? "rgba(15,118,110,.12)" : colors,
          fill: spec.type === "line",
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 3,
        }}));
        new Chart(canvas, {{
          type: spec.type === "doughnut" ? "doughnut" : (spec.type || "line"),
          data: {{ labels: spec.labels || [], datasets }},
          options: {{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {{
              legend: {{ position: "bottom", labels: {{ boxWidth: 12, font: {{ size: 11 }} }} }},
              title: {{ display: false }},
            }},
            scales: spec.type === "doughnut" ? {{}} : {{
              x: {{ ticks: {{ maxRotation: 45, font: {{ size: 10 }} }}, grid: {{ display: false }} }},
              y: {{ beginAtZero: true, ticks: {{ font: {{ size: 10 }} }} }},
            }},
          }},
        }});
      }});
    }})();
  </script>
"""
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{safe_title}</title>
  <style>
    :root {{
      --bg: #f4f7f6;
      --card: #ffffff;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #e5ebe8;
      --accent: #0f766e;
      --accent-soft: #ecfdf8;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15,118,110,.10), transparent 42%),
        linear-gradient(180deg, #fbfcfb 0%, var(--bg) 100%);
      line-height: 1.7;
    }}
    .wrap {{
      max-width: 980px;
      margin: 0 auto;
      padding: 28px 20px 56px;
    }}
    .sheet {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 28px 32px 36px;
      box-shadow: 0 12px 34px rgba(31, 41, 55, .06);
    }}
    .hero {{
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 18px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--line);
    }}
    .hero h1 {{
      margin: 0;
      font-size: 1.7rem;
      letter-spacing: -.02em;
    }}
    .meta {{
      color: var(--muted);
      font-size: .85rem;
    }}
    .kpi-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
      margin: 0 0 22px;
    }}
    .kpi-card {{
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: linear-gradient(180deg, #fff, var(--accent-soft));
    }}
    .kpi-card .label {{ color: var(--muted); font-size: .78rem; }}
    .kpi-card .value {{
      margin-top: 4px;
      font-size: 1.25rem;
      font-weight: 700;
      color: #134e4a;
      font-variant-numeric: tabular-nums;
    }}
    .kpi-card .sub {{ margin-top: 2px; color: var(--muted); font-size: .72rem; }}
    .chart-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
      margin: 8px 0 24px;
    }}
    .chart-card {{
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px 16px;
      background: #fff;
    }}
    .chart-card h3 {{
      margin: 0 0 10px;
      font-size: .95rem;
      color: var(--accent);
    }}
    .chart-card .chart-box {{
      position: relative;
      height: 240px;
    }}
    h1, h2, h3, h4 {{ line-height: 1.3; margin: 1.2em 0 .55em; }}
    h2 {{ font-size: 1.28rem; border-bottom: 1px solid var(--line); padding-bottom: .35em; }}
    h3 {{ font-size: 1.05rem; color: var(--accent); }}
    p {{ margin: .75em 0; }}
    ul, ol {{ padding-left: 1.35em; }}
    li {{ margin: .28em 0; }}
    blockquote {{
      margin: 1em 0;
      padding: .75em 1em;
      border-left: 4px solid var(--accent);
      background: var(--accent-soft);
      color: #374151;
    }}
    code {{
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: .92em;
      background: #f3f4f6;
      padding: .1em .35em;
      border-radius: 4px;
    }}
    pre {{
      overflow: auto;
      background: #111827;
      color: #e5e7eb;
      padding: 14px 16px;
      border-radius: 10px;
    }}
    pre code {{ background: transparent; color: inherit; padding: 0; }}
    table {{
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      font-size: .95rem;
    }}
    th, td {{
      border: 1px solid var(--line);
      padding: .55em .7em;
      text-align: left;
      vertical-align: top;
    }}
    th {{ background: #f5faf8; }}
    .mermaid {{
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px;
      overflow: auto;
    }}
    .chart-fallback {{
      margin: 1em 0;
      padding: 12px 14px;
      border: 1px dashed var(--line);
      border-radius: 10px;
      background: #fafaf8;
      color: var(--muted);
      font-size: .92rem;
    }}
    @media (max-width: 640px) {{
      .sheet {{ padding: 20px 16px 28px; }}
      .chart-card .chart-box {{ height: 220px; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <article class="sheet">
      <header class="hero">
        <h1>{safe_title}</h1>
        <div class="meta">经营分析报告 · 可信数据驱动</div>
      </header>
      {kpi_html}
      {charts_html}
      {body}
    </article>
  </div>
  {chart_boot}
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({{ startOnLoad: false, theme: "neutral", securityLevel: "loose" }});
    const nodes = Array.from(document.querySelectorAll("pre.mermaid"));
    for (const node of nodes) {{
      const source = (node.textContent || "").trim();
      const fallback = () => {{
        const box = document.createElement("div");
        box.className = "chart-fallback";
        box.innerHTML = "<strong>图表未能渲染</strong><br/>语法不兼容或过于复杂。请以下方文字与表格解读为准。";
        node.replaceWith(box);
      }};
      if (!source || /^xychart/i.test(source) || /^quadrantchart/i.test(source)) {{
        fallback();
        continue;
      }}
      try {{
        const id = "mmd-" + Math.random().toString(36).slice(2);
        const {{ svg }} = await mermaid.render(id, source);
        const wrap = document.createElement("div");
        wrap.className = "mermaid";
        wrap.innerHTML = svg;
        node.replaceWith(wrap);
      }} catch (err) {{
        fallback();
      }}
    }}
  </script>
</body>
</html>
"""


def _fmt_kpi_value(value) -> str:
    if value is None:
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return html.escape(str(value))
    if abs(number - round(number)) < 1e-9 and abs(number) >= 1:
        return f"{int(round(number)):,}"
    if abs(number) >= 100:
        return f"{number:,.1f}"
    return f"{number:,.2f}"


def _render_kpi_strip(kpis: list[dict]) -> str:
    if not kpis:
        return ""
    cards = []
    for row in kpis[:8]:
        label = html.escape(str(row.get("label") or row.get("column") or "指标"))
        asset = html.escape(str(row.get("asset") or ""))
        value = _fmt_kpi_value(row.get("sum"))
        cards.append(
            f'<div class="kpi-card"><div class="label">{label}</div>'
            f'<div class="value">{value}</div>'
            f'<div class="sub">{asset}</div></div>'
        )
    return f'<section class="kpi-grid" aria-label="关键指标">{"".join(cards)}</section>'


def _render_chart_canvases(charts: list[dict]) -> str:
    if not charts:
        return ""
    cards = []
    for spec in charts[:6]:
        chart_id = html.escape(str(spec.get("id") or f"chart-{len(cards)+1}"))
        title = html.escape(str(spec.get("title") or "图表"))
        cards.append(
            f'<div class="chart-card"><h3>{title}</h3>'
            f'<div class="chart-box"><canvas id="{chart_id}"></canvas></div></div>'
        )
    return f'<section class="chart-grid" aria-label="经营图表">{"".join(cards)}</section>'


def sanitize_mermaid_source(code: str) -> str | None:
    """Return cleaned mermaid source, or None to drop fragile / unsupported charts."""
    text = (code or "").strip()
    if not text:
        return None
    head = text.splitlines()[0].strip().lower()
    # xychart-beta / quadrant often break in Mermaid 11 with LLM output.
    if head.startswith("xychart") or head.startswith("quadrant"):
        return None
    # Normalize curly / fullwidth quotes that LLMs often emit in pie labels.
    text = (
        text.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\uff02", '"')
        .replace("\uff07", "'")
    )
    # Normalize Chinese colon after labels in pie lines: "A"：40 -> "A" : 40
    text = re.sub(r'("([^"\\]|\\.)*")\s*[：:]\s*', r"\1 : ", text)
    return text


def _markdown_to_html_body(markdown: str) -> str:
    text = (markdown or "").replace("\r\n", "\n").strip()
    if not text:
        return "<p></p>"

    lines = text.split("\n")
    blocks: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        fence = re.match(r"^```(\w*)\s*$", line)
        if fence:
            lang = fence.group(1) or ""
            i += 1
            chunk: list[str] = []
            while i < len(lines) and not re.match(r"^```\s*$", lines[i]):
                chunk.append(lines[i])
                i += 1
            code = "\n".join(chunk)
            if lang.lower() == "mermaid":
                cleaned = sanitize_mermaid_source(code)
                if cleaned:
                    blocks.append(f'<pre class="mermaid">{html.escape(cleaned)}</pre>')
                else:
                    blocks.append(
                        '<div class="chart-fallback">'
                        "<strong>趋势已用文字/表格表达</strong><br/>"
                        "系统已跳过不稳定的自动图表语法，请以下方解读为准。"
                        "</div>"
                    )
            else:
                blocks.append(f"<pre><code>{html.escape(code)}</code></pre>")
            i += 1
            continue

        if re.match(r"^#{1,6}\s+", line):
            level = len(line) - len(line.lstrip("#"))
            level = min(max(level, 1), 6)
            content = _inline(line[level:].strip())
            blocks.append(f"<h{level}>{content}</h{level}>")
            i += 1
            continue

        if re.match(r"^>\s?", line):
            quote: list[str] = []
            while i < len(lines) and re.match(r"^>\s?", lines[i]):
                quote.append(re.sub(r"^>\s?", "", lines[i]))
                i += 1
            blocks.append(f"<blockquote><p>{_inline('<br />'.join(quote))}</p></blockquote>")
            continue

        if re.match(r"^\s*[-*+]\s+", line):
            items: list[str] = []
            while i < len(lines) and re.match(r"^\s*[-*+]\s+", lines[i]):
                item_text = re.sub(r"^\s*[-*+]\s+", "", lines[i])
                items.append(f"<li>{_inline(item_text)}</li>")
                i += 1
            blocks.append(f"<ul>{''.join(items)}</ul>")
            continue

        if re.match(r"^\s*\d+\.\s+", line):
            items = []
            while i < len(lines) and re.match(r"^\s*\d+\.\s+", lines[i]):
                item_text = re.sub(r"^\s*\d+\.\s+", "", lines[i])
                items.append(f"<li>{_inline(item_text)}</li>")
                i += 1
            blocks.append(f"<ol>{''.join(items)}</ol>")
            continue

        if "|" in line and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{3,}", lines[i + 1]):
            header = _split_table_row(line)
            i += 2
            rows = [header]
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                rows.append(_split_table_row(lines[i]))
                i += 1
            thead = "".join(f"<th>{_inline(cell)}</th>" for cell in rows[0])
            body_rows = []
            for row in rows[1:]:
                body_rows.append("<tr>" + "".join(f"<td>{_inline(cell)}</td>" for cell in row) + "</tr>")
            blocks.append(f"<table><thead><tr>{thead}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>")
            continue

        if not line.strip():
            i += 1
            continue

        para: list[str] = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,6}\s+|>\s*|```|\s*[-*+]\s+|\s*\d+\.\s+)", lines[i]) and "|" not in lines[i]:
            para.append(lines[i])
            i += 1
        blocks.append(f"<p>{_inline('<br />'.join(para))}</p>")

    return "\n".join(blocks)


def _split_table_row(line: str) -> list[str]:
    raw = line.strip().strip("|")
    return [cell.strip() for cell in raw.split("|")]


def _inline(text: str) -> str:
    value = html.escape(text)
    value = re.sub(r"`([^`]+)`", r"<code>\1</code>", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", value)
    value = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", value)
    value = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2" target="_blank" rel="noreferrer">\1</a>', value)
    return value
