"""Markdown → self-contained HTML report for SOP / trial artifacts."""
from __future__ import annotations

import html
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


def markdown_to_html_document(markdown: str, *, title: str = "经营分析报告") -> str:
    body = _markdown_to_html_body(markdown or "")
    safe_title = html.escape(title or "经营分析报告")
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{safe_title}</title>
  <style>
    :root {{
      --bg: #f6f4ef;
      --card: #ffffff;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #e7e2d8;
      --accent: #0f766e;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(15,118,110,.08), transparent 40%),
        linear-gradient(180deg, #fbfaf7 0%, var(--bg) 100%);
      line-height: 1.7;
    }}
    .wrap {{
      max-width: 920px;
      margin: 0 auto;
      padding: 28px 20px 48px;
    }}
    .sheet {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 28px 32px;
      box-shadow: 0 10px 30px rgba(31, 41, 55, .05);
    }}
    h1, h2, h3, h4 {{ line-height: 1.3; margin: 1.2em 0 .55em; }}
    h1 {{ font-size: 1.85rem; margin-top: 0; letter-spacing: -.02em; }}
    h2 {{ font-size: 1.35rem; border-bottom: 1px solid var(--line); padding-bottom: .35em; }}
    h3 {{ font-size: 1.1rem; color: var(--accent); }}
    p {{ margin: .75em 0; }}
    ul, ol {{ padding-left: 1.35em; }}
    li {{ margin: .28em 0; }}
    blockquote {{
      margin: 1em 0;
      padding: .75em 1em;
      border-left: 4px solid var(--accent);
      background: #f3faf8;
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
    th {{ background: #f8faf9; }}
    .meta {{
      color: var(--muted);
      font-size: .85rem;
      margin-bottom: 1.2rem;
    }}
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
  </style>
</head>
<body>
  <div class="wrap">
    <article class="sheet">
      <div class="meta">经营分析报告</div>
      {body}
    </article>
  </div>
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
                items.append(f"<li>{_inline(re.sub(r'^\\s*[-*+]\\s+', '', lines[i]))}</li>")
                i += 1
            blocks.append(f"<ul>{''.join(items)}</ul>")
            continue

        if re.match(r"^\s*\d+\.\s+", line):
            items = []
            while i < len(lines) and re.match(r"^\s*\d+\.\s+", lines[i]):
                items.append(f"<li>{_inline(re.sub(r'^\\s*\\d+\\.\\s+', '', lines[i]))}</li>")
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
