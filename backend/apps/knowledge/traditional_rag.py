from __future__ import annotations

import concurrent.futures
import csv
import hashlib
import json
import math
import re
import threading
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from io import StringIO
from pathlib import Path, PurePath
from uuid import uuid4
from xml.etree import ElementTree

from django.conf import settings
from django.db import close_old_connections, transaction
from django.db.models import Q
from django.utils import timezone

from apps.skills.cos_storage import cos_enabled, fetch_object_bytes, upload_media_bytes

from .models import KnowledgeBase, KnowledgeChunkRef, KnowledgeEmbedding, KnowledgeFile, KnowledgeIngestJob


EXTENSION_TO_FILE_TYPE = {
    ".csv": "csv",
    ".docx": "docx",
    ".htm": "html",
    ".html": "html",
    ".json": "json",
    ".markdown": "markdown",
    ".md": "markdown",
    ".txt": "txt",
    ".xlsx": "xlsx",
}

TEXT_FILE_TYPES = {"docx", "html", "json", "markdown", "txt"}
TABLE_FILE_TYPES = {"csv", "xlsx", "csv_markdown", "xlsx_markdown"}
TABLE_SOURCE_FILE_SUFFIXES = {".csv", ".xls", ".xlsx"}
TABLE_SOURCE_TYPES = {"csv", "xls", "xlsx"}

KEYWORD_STOPWORDS = {
    "and",
    "or",
    "the",
    "for",
    "with",
    "from",
    "this",
    "that",
    "into",
    "about",
    "http",
    "https",
    "www",
    "com",
    "cn",
    "html",
    "prodid",
    "\u4ea7\u54c1",
    "\u5546\u54c1",
    "\u7f16\u53f7",
    "\u5907\u6848",
    "\u7cfb\u7edf",
    "\u4e2d\u6587\u540d",
    "\u6210\u5206",
    "\u529f\u6548",
    "\u5ba3\u79f0",
    "\u8bc4\u4ef7",
    "\u7ed3\u8bba",
}


def extract_chunk_keywords(text: str, *, limit: int = 12) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{2,}|[\u4e00-\u9fff]{2,}|\d{4,}", text or "")
    scores: dict[str, float] = {}
    first_seen: dict[str, int] = {}
    for index, token in enumerate(tokens):
        normalized = token.strip(" _-./:,;:!?()[]{}<>\"'`").lower()
        if not normalized or normalized in KEYWORD_STOPWORDS:
            continue
        if len(normalized) < 2:
            continue
        first_seen.setdefault(normalized, index)
        length_bonus = min(len(normalized), 12) / 12
        digit_penalty = 0.45 if normalized.isdigit() else 0
        scores[normalized] = scores.get(normalized, 0) + 1 + length_bonus - digit_penalty
    ordered = sorted(scores, key=lambda item: (-scores[item], first_seen[item], item))
    return ordered[:limit]
DEFAULT_CHUNK_SIZE = 1024
DEFAULT_CHUNK_OVERLAP = 50
MAX_TABLE_ROWS = 5000


class TraditionalRagError(ValueError):
    def __init__(self, message: str, code: str = "traditional_rag_error"):
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass(frozen=True)
class ParsedSegment:
    text: str
    metadata: dict


@dataclass(frozen=True)
class ParsedDocument:
    text: str
    segments: list[ParsedSegment]
    metadata: dict


@dataclass(frozen=True)
class TraditionalIngestResult:
    file: KnowledgeFile
    job: KnowledgeIngestJob
    chunks: list[KnowledgeChunkRef]


def safe_original_filename(filename: str) -> str:
    base = PurePath(filename).name.strip()
    if not base:
        return "upload.bin"
    safe = "".join(char if char.isalnum() or char in {".", "_", "-", " ", "(", ")"} else "_" for char in base)
    return safe[:180] or "upload.bin"


def detect_file_type(filename: str, content: bytes) -> str:
    suffix = PurePath(filename).suffix.lower()
    file_type = EXTENSION_TO_FILE_TYPE.get(suffix)
    if not file_type:
        raise TraditionalRagError("Unsupported file type for traditional RAG.", "unsupported_file_type")
    if file_type in {"docx", "xlsx"} and not content.startswith(b"PK"):
        raise TraditionalRagError(f"Invalid {file_type.upper()} file header.", "unsupported_file_type")
    return file_type


def storage_root() -> Path:
    root = getattr(settings, "KNOWLEDGE_UPLOAD_ROOT", None)
    return Path(root) if root else settings.BASE_DIR / "data" / "knowledge_uploads"


def relative_storage_path(knowledge_base_id: int, file_id: int, filename: str) -> str:
    return f"knowledge/{knowledge_base_id}/{file_id}/{filename}"


def resolve_storage_path(path: str) -> Path:
    parts = [part for part in path.replace("\\", "/").split("/") if part]
    return storage_root().joinpath(*parts)


def cos_storage_path(bucket: str, key: str) -> str:
    return f"cos://{bucket}/{key.lstrip('/')}"


def parse_cos_storage_path(storage_path: str) -> tuple[str, str] | None:
    if not storage_path.startswith("cos://"):
        return None
    bucket_and_key = storage_path.removeprefix("cos://")
    bucket, _, key = bucket_and_key.partition("/")
    if not bucket or not key:
        raise TraditionalRagError("Invalid COS storage path.", "storage_error")
    return bucket, key


def write_uploaded_file(upload, knowledge_base_id: int, file_id: int, filename: str) -> tuple[str, bytes, dict]:
    relative_path = relative_storage_path(knowledge_base_id, file_id, filename)
    content = bytearray()
    for chunk in upload.chunks():
        content.extend(chunk)
    if not content:
        raise TraditionalRagError("Uploaded file is empty.", "empty_file")
    data = bytes(content)
    return write_bytes_content(
        data,
        knowledge_base_id=knowledge_base_id,
        file_id=file_id,
        filename=filename,
        content_type=getattr(upload, "content_type", "") or None,
    )


def write_bytes_content(
    data: bytes,
    *,
    knowledge_base_id: int,
    file_id: int,
    filename: str,
    content_type: str | None = None,
    existing_storage_path: str | None = None,
) -> tuple[str, bytes, dict]:
    if not data:
        raise TraditionalRagError("Uploaded file is empty.", "empty_file")
    relative_path = relative_storage_path(knowledge_base_id, file_id, filename)
    if cos_enabled():
        # Prefer rewriting the same COS key when possible.
        cos_ref = parse_cos_storage_path(existing_storage_path or "")
        upload_key = cos_ref[1] if cos_ref else relative_path
        media = upload_media_bytes(upload_key, data, content_type=content_type)
        return cos_storage_path(media["bucket"], media["cos_key"]), data, {
            "storage_backend": "cos",
            "cos_bucket": media["bucket"],
            "cos_key": media["cos_key"],
            "cos_url": media["cos_url"],
        }

    destination = resolve_storage_path(relative_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    # Clean old local path if filename changed.
    if existing_storage_path and not existing_storage_path.startswith("cos://"):
        old = resolve_storage_path(existing_storage_path)
        if old != destination and old.exists():
            try:
                old.unlink()
            except OSError:
                pass
    return relative_path, data, {"storage_backend": "local"}


def read_stored_file(storage_path: str) -> bytes:
    cos_ref = parse_cos_storage_path(storage_path)
    if cos_ref:
        content = fetch_object_bytes(*cos_ref)
    else:
        content = resolve_storage_path(storage_path).read_bytes()
    if not content:
        raise TraditionalRagError("Uploaded file is empty.", "empty_file")
    return content


class _TextHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        lowered = tag.lower()
        if lowered in {"script", "style", "noscript"}:
            self._skip_depth += 1
        elif lowered in {"article", "br", "div", "h1", "h2", "h3", "h4", "li", "p", "section", "tr"}:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        lowered = tag.lower()
        if lowered in {"script", "style", "noscript"} and self._skip_depth > 0:
            self._skip_depth -= 1
        elif lowered in {"article", "div", "h1", "h2", "h3", "h4", "li", "p", "section", "tr"}:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0 and data.strip():
            self._parts.append(data)

    def text(self) -> str:
        return unescape(" ".join(self._parts))

def normalize_text(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()

def segments_from_text(text: str, *, parser: str) -> ParsedDocument:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [normalize_text(part) for part in re.split(r"\n\s*\n", normalized)]
    segments = [
        ParsedSegment(paragraph, {"parser": parser, "kind": "paragraph", "paragraph_index": index})
        for index, paragraph in enumerate(paragraph for paragraph in paragraphs if paragraph)
    ]
    if not segments and normalize_text(normalized):
        segments = [ParsedSegment(normalize_text(normalized), {"parser": parser, "kind": "text", "paragraph_index": 0})]
    if not segments:
        raise TraditionalRagError("No indexable text extracted from file.", "parser_error")
    joined = "\n\n".join(segment.text for segment in segments)
    return ParsedDocument(
        text=joined,
        segments=segments,
        metadata={"parser": parser, "paragraph_count": len(segments), "char_count": len(joined)},
    )


def parse_text_bytes(content: bytes, *, parser: str) -> ParsedDocument:
    return segments_from_text(content.decode("utf-8", errors="replace"), parser=parser)

def parse_frontmatter_scalar(value: str) -> object:
    stripped = value.strip()
    if stripped.startswith(("'", '"')) and stripped.endswith(("'", '"')) and len(stripped) >= 2:
        return stripped[1:-1]
    lowered = stripped.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if re.fullmatch(r"[-+]?\d+", stripped):
        try:
            return int(stripped)
        except ValueError:
            return stripped
    return stripped


def split_markdown_frontmatter(text: str) -> tuple[dict, str]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.startswith("---\n"):
        return {}, normalized
    end_match = re.search(r"\n---\s*(?:\n|$)", normalized[4:])
    if not end_match:
        return {}, normalized
    frontmatter_text = normalized[4 : 4 + end_match.start()]
    body = normalized[4 + end_match.end() :]
    metadata: dict[str, object] = {}
    current_list_key: str | None = None
    for raw_line in frontmatter_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        list_match = re.match(r"^-\s*(.+)$", line)
        if list_match and current_list_key:
            metadata.setdefault(current_list_key, []).append(parse_frontmatter_scalar(list_match.group(1)))
            continue
        key_match = re.match(r"^([A-Za-z_][A-Za-z0-9_\-]*)\s*:\s*(.*)$", line)
        if not key_match:
            current_list_key = None
            continue
        key, value = key_match.group(1), key_match.group(2)
        if value == "":
            metadata[key] = []
            current_list_key = key
        else:
            metadata[key] = parse_frontmatter_scalar(value)
            current_list_key = None
    return metadata, body


def markdown_frontmatter_table_type(metadata: dict) -> str | None:
    source_type = str(metadata.get("source_type") or "").strip().lower()
    if source_type in TABLE_SOURCE_TYPES:
        return "csv" if source_type == "csv" else "xlsx"
    source_file = str(metadata.get("source_file") or "").strip()
    suffix = PurePath(source_file).suffix.lower()
    if suffix in TABLE_SOURCE_FILE_SUFFIXES:
        return "csv" if suffix == ".csv" else "xlsx"
    return None


def parse_markdown_table_bytes(content: bytes) -> ParsedDocument:
    text = content.decode("utf-8", errors="replace")
    frontmatter, body = split_markdown_frontmatter(text)
    table_type = markdown_frontmatter_table_type(frontmatter)
    if not table_type:
        return segments_from_text(text, parser="markdown")
    rows, table_metadata = markdown_table_rows(body, frontmatter, table_type)
    if not rows:
        return segments_from_text(body, parser="markdown")
    joined = "\n\n".join(segment.text for segment in rows)
    parser = f"{table_type}_markdown"
    return ParsedDocument(
        text=joined,
        segments=rows,
        metadata={
            "parser": parser,
            "source_parser": "markdown",
            "table_source_type": table_type,
            "frontmatter": frontmatter,
            "table_count": len(table_metadata),
            "row_count": len(rows),
            "char_count": len(joined),
            "tables": table_metadata,
        },
    )


def markdown_table_rows(body: str, frontmatter: dict, table_type: str) -> tuple[list[ParsedSegment], list[dict]]:
    pipe_rows = markdown_pipe_table_rows(body)
    if pipe_rows:
        return markdown_raw_rows_to_segments(pipe_rows, frontmatter, table_type, "markdown_pipe_table")
    vertical_rows, vertical_metadata = markdown_vertical_table_rows(body, frontmatter)
    if vertical_rows:
        return markdown_raw_rows_to_segments(vertical_rows, frontmatter, table_type, "markdown_vertical_table", vertical_metadata)
    flattened_rows = markdown_flattened_table_rows(body, frontmatter)
    if flattened_rows:
        return markdown_raw_rows_to_segments(flattened_rows, frontmatter, table_type, "markdown_flattened_table")
    block_rows = markdown_block_table_rows(body, frontmatter)
    if block_rows:
        return markdown_raw_rows_to_segments(block_rows, frontmatter, table_type, "markdown_block_table")
    return [], []


def markdown_raw_rows_to_segments(raw_rows: list[list[object]], frontmatter: dict, table_type: str, extraction_method: str, extra_metadata: dict | None = None) -> tuple[list[ParsedSegment], list[dict]]:
    parser = f"{table_type}_markdown"
    rows, metadata = table_rows_to_segments(
        str(frontmatter.get("worksheets") or frontmatter.get("title") or "Markdown"),
        raw_rows,
        {
            "parser": parser,
            "source_parser": "markdown",
            "table_source_type": table_type,
            "table_extraction_method": extraction_method,
            "source_file": frontmatter.get("source_file"),
            "source_type": frontmatter.get("source_type"),
            **(extra_metadata or {}),
        },
    )
    return rows, metadata


def markdown_pipe_table_rows(body: str) -> list[list[object]]:
    rows: list[list[object]] = []
    for raw_line in body.splitlines():
        line = raw_line.strip()
        if "|" not in line:
            continue
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        if all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells):
            continue
        rows.append(cells)
    return rows if len(rows) >= 2 else []



def markdown_vertical_table_rows(body: str, frontmatter: dict) -> tuple[list[list[object]], dict]:
    lines = markdown_data_lines(body, frontmatter, keep_empty=True)
    first_data_index = next((index for index, line in enumerate(lines) if looks_like_date(line)), None)
    diagnostics: dict[str, object] = {
        "table_parser": "single_pass_state_machine",
        "source_line_count": len(lines),
        "anomaly_count": 0,
        "anomalies": [],
    }
    if first_data_index is None or first_data_index < 1:
        return [], diagnostics
    headers = [line for line in lines[:first_data_index] if line]
    headers = trim_table_title(headers, frontmatter)
    diagnostics["expected_columns"] = len(headers)
    diagnostics["headers"] = headers
    if len(headers) < 2 or len(headers) > 80 or not looks_like_date_header(headers[0]):
        add_table_anomaly(diagnostics, "invalid_header", 1, f"Unable to identify vertical table headers before first data row at line {first_data_index + 1}.")
        return [], diagnostics

    rows: list[list[object]] = [headers]
    current_values: list[str] = []
    current_start_line: int | None = None

    def flush_current(end_line: int) -> None:
        nonlocal current_values, current_start_line
        if not current_values:
            return
        values = trim_trailing_empty_cells(current_values)
        if not values:
            current_values = []
            current_start_line = None
            return
        if len(values) < len(headers):
            add_table_anomaly(
                diagnostics,
                "missing_cells",
                current_start_line or end_line,
                f"Expected {len(headers)} cells, got {len(values)} cells; padded missing trailing cells.",
                {"expected": len(headers), "actual": len(values)},
            )
            values.extend([""] * (len(headers) - len(values)))
        elif len(values) > len(headers):
            extra_values = values[len(headers) - 1 :]
            add_table_anomaly(
                diagnostics,
                "extra_cells",
                current_start_line or end_line,
                f"Expected {len(headers)} cells, got {len(values)} cells; merged overflow into the last column.",
                {"expected": len(headers), "actual": len(values), "overflow_count": len(values) - len(headers)},
            )
            values = values[: len(headers) - 1] + [" / ".join(value for value in extra_values if value)]
        rows.append(values)
        current_values = []
        current_start_line = None

    for index, line in enumerate(lines[first_data_index:], start=first_data_index):
        line_number = index + 1
        if looks_like_date(line):
            flush_current(line_number - 1)
            current_values = [line]
            current_start_line = line_number
            continue
        if current_start_line is None:
            if line:
                add_table_anomaly(diagnostics, "stray_value", line_number, "Ignored non-empty value before the first data row.", {"value": line[:120]})
            continue
        current_values.append(line)
    flush_current(len(lines))

    diagnostics["parsed_rows"] = max(len(rows) - 1, 0)
    return (rows if len(rows) >= 2 else []), diagnostics



def add_table_anomaly(diagnostics: dict, kind: str, line: int, message: str, extra: dict | None = None) -> None:
    diagnostics["anomaly_count"] = int(diagnostics.get("anomaly_count") or 0) + 1
    anomalies = diagnostics.setdefault("anomalies", [])
    if isinstance(anomalies, list) and len(anomalies) < 50:
        item = {"kind": kind, "line": line, "message": message}
        if extra:
            item.update(extra)
        anomalies.append(item)

def trim_table_title(headers: list[str], frontmatter: dict) -> list[str]:
    if not headers:
        return headers
    title = str(frontmatter.get("title") or "").strip()
    source_file_stem = PurePath(str(frontmatter.get("source_file") or "")).stem
    if len(headers) > 1 and headers[0] in {title, source_file_stem}:
        return headers[1:]
    if len(headers) > 1 and not looks_like_date_header(headers[0]) and looks_like_date_header(headers[1]):
        return headers[1:]
    return headers


def trim_trailing_empty_cells(values: list[str]) -> list[str]:
    result = list(values)
    while result and result[-1] == "":
        result.pop()
    return result


def looks_like_date_header(value: str) -> bool:
    normalized = normalize_text(value).lower()
    return normalized in {"日期", "date", "成交日期", "时间", "datetime"} or "日期" in normalized

def markdown_flattened_table_rows(body: str, frontmatter: dict) -> list[list[object]]:
    lines = markdown_data_lines(body, frontmatter)
    if len(lines) < 4:
        return []
    data_start = infer_flattened_data_start(lines)
    if data_start is None or data_start < 1:
        return []
    headers = lines[:data_start]
    if len(headers) > 80:
        return []
    data_lines = lines[data_start:]
    row_count = len(data_lines) // len(headers)
    if row_count < 1:
        return []
    usable = row_count * len(headers)
    if usable < len(data_lines) * 0.85:
        return []
    rows = [headers]
    rows.extend(data_lines[index : index + len(headers)] for index in range(0, usable, len(headers)))
    return rows


def markdown_block_table_rows(body: str, frontmatter: dict) -> list[list[object]]:
    blocks = [
        normalize_text(block)
        for block in re.split(r"\n\s*\n", body.replace("\r\n", "\n").replace("\r", "\n"))
        if normalize_text(block)
    ]
    title = str(frontmatter.get("title") or "").strip()
    if title and blocks and blocks[0] == title:
        blocks = blocks[1:]
    if len(blocks) < 2:
        return []
    return [["content"], *[[block] for block in blocks]]


def markdown_data_lines(body: str, frontmatter: dict, *, keep_empty: bool = False) -> list[str]:
    lines: list[str] = []
    for raw_line in body.replace("\r\n", "\n").replace("\r", "\n").splitlines():
        line = normalize_text(raw_line.strip().strip("|"))
        if line.startswith("#"):
            continue
        if line and re.fullmatch(r":?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*", line):
            continue
        if line or keep_empty:
            lines.append(line)
    while lines and lines[0] == "":
        lines.pop(0)
    while lines and lines[-1] == "":
        lines.pop()
    return lines


def infer_flattened_data_start(lines: list[str]) -> int | None:
    best_index: int | None = None
    best_score = -1.0
    for index in range(1, min(len(lines), 80)):
        remaining = len(lines) - index
        if remaining < index:
            continue
        first = lines[index]
        second = lines[index + 1] if index + 1 < len(lines) else ""
        row_count = remaining / index
        remainder_ratio = (remaining % index) / index
        score = 0.0
        if looks_like_table_data_start(first):
            score += 2.0
        if looks_like_date(second):
            score += 1.5
        if row_count >= 2:
            score += 1.0
        score -= remainder_ratio
        if score > best_score:
            best_score = score
            best_index = index
    return best_index if best_score >= 2.0 else None


def looks_like_table_data_start(value: str) -> bool:
    return bool(re.fullmatch(r"\d{1,12}", value) or looks_like_date(value))


def looks_like_date(value: str) -> bool:
    return bool(re.search(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", value))

def parse_html_bytes(content: bytes) -> ParsedDocument:
    parser = _TextHTMLParser()
    parser.feed(content.decode("utf-8", errors="replace"))
    return segments_from_text(parser.text(), parser="html")


def flatten_json(value: object, prefix: str = "") -> list[str]:
    if isinstance(value, dict):
        lines: list[str] = []
        for key, child in value.items():
            child_key = f"{prefix}.{key}" if prefix else str(key)
            lines.extend(flatten_json(child, child_key))
        return lines
    if isinstance(value, list):
        lines = []
        for index, child in enumerate(value):
            child_key = f"{prefix}[{index}]" if prefix else f"[{index}]"
            lines.extend(flatten_json(child, child_key))
        return lines
    normalized = json.dumps(value, ensure_ascii=False) if isinstance(value, (bool, type(None))) else str(value)
    return [f"{prefix}: {normalized}" if prefix else normalized]


def parse_json_bytes(content: bytes) -> ParsedDocument:
    try:
        data = json.loads(content.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as error:
        raise TraditionalRagError(f"JSON parse failed: {error}", "parser_error") from error
    return segments_from_text("\n".join(flatten_json(data)), parser="json")


def paragraph_text(node: ElementTree.Element, ns: dict[str, str]) -> str:
    parts = [text_node.text or "" for text_node in node.findall(".//w:t", ns)]
    return normalize_text("".join(parts))


def parse_docx_bytes(content: bytes) -> ParsedDocument:
    try:
        with zipfile.ZipFile(PathLikeBytes(content)) as archive:
            xml = archive.read("word/document.xml")
    except KeyError as error:
        raise TraditionalRagError("DOCX missing word/document.xml.", "parser_error") from error
    except zipfile.BadZipFile as error:
        raise TraditionalRagError("DOCX file is corrupted.", "parser_error") from error

    root = ElementTree.fromstring(xml)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    body = root.find("w:body", ns)
    if body is None:
        raise TraditionalRagError("DOCX missing document body.", "parser_error")

    segments: list[ParsedSegment] = []
    paragraph_index = 0
    table_index = 0
    for child in list(body):
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            paragraph = paragraph_text(child, ns)
            if paragraph:
                segments.append(ParsedSegment(paragraph, {"parser": "docx", "kind": "paragraph", "paragraph_index": paragraph_index}))
                paragraph_index += 1
        elif tag == "tbl":
            rows: list[str] = []
            for row in child.findall("w:tr", ns):
                cells: list[str] = []
                for cell in row.findall("w:tc", ns):
                    cell_text = " ".join(filter(None, (paragraph_text(p, ns) for p in cell.findall("w:p", ns))))
                    cells.append(cell_text)
                if any(cells):
                    rows.append(" | ".join(cells))
            if rows:
                segments.append(
                    ParsedSegment(
                        "\n".join(rows),
                        {"parser": "docx", "kind": "table", "table_index": table_index, "row_count": len(rows)},
                    )
                )
                table_index += 1
    if not segments:
        raise TraditionalRagError("DOCX contains no indexable text.", "parser_error")
    text = "\n\n".join(segment.text for segment in segments)
    return ParsedDocument(
        text=text,
        segments=segments,
        metadata={"parser": "docx", "paragraph_count": paragraph_index, "table_count": table_index, "char_count": len(text)},
    )


class PathLikeBytes:
    def __init__(self, content: bytes):
        from io import BytesIO

        self._buffer = BytesIO(content)

    def read(self, *args, **kwargs):
        return self._buffer.read(*args, **kwargs)

    def seek(self, *args, **kwargs):
        return self._buffer.seek(*args, **kwargs)

    def tell(self):
        return self._buffer.tell()

    def seekable(self):
        return True


def parse_table_bytes(content: bytes, file_type: str) -> ParsedDocument:
    rows: list[ParsedSegment] = []
    table_metadata: list[dict] = []
    if file_type == "csv":
        text = content.decode("utf-8-sig", errors="replace")
        sample = text[:4096]
        try:
            dialect = csv.Sniffer().sniff(sample)
        except csv.Error:
            dialect = csv.excel
        raw_rows = list(csv.reader(StringIO(text), dialect))
        rows, table_metadata = table_rows_to_segments("CSV", raw_rows, {"parser": "csv", "dialect": dialect.delimiter})
    elif file_type == "xlsx":
        for sheet_name, raw_rows, metadata in read_xlsx_rows(content):
            sheet_rows, sheet_metadata = table_rows_to_segments(sheet_name, raw_rows, metadata)
            rows.extend(sheet_rows)
            table_metadata.extend(sheet_metadata)
    if not rows:
        raise TraditionalRagError("No indexable table rows extracted from file.", "parser_error")
    text = "\n\n".join(segment.text for segment in rows)
    return ParsedDocument(
        text=text,
        segments=rows,
        metadata={"parser": file_type, "table_count": len(table_metadata), "row_count": len(rows), "char_count": len(text), "tables": table_metadata},
    )


def table_rows_to_segments(sheet_name: str, raw_rows: list[list[object]], metadata: dict) -> tuple[list[ParsedSegment], list[dict]]:
    non_empty_rows = [row for row in raw_rows if any(str(value or "").strip() for value in row)]
    if not non_empty_rows:
        return [], []
    headers = dedupe_headers([normalize_header(value, index) for index, value in enumerate(non_empty_rows[0])])
    segments: list[ParsedSegment] = []
    for row_index, raw_row in enumerate(non_empty_rows[1:]):
        values = {
            header: parse_scalar(raw_row[index] if index < len(raw_row) else None)
            for index, header in enumerate(headers)
        }
        present = {key: value for key, value in values.items() if value is not None}
        if not present:
            continue
        text = " | ".join(f"{key}: {value}" for key, value in present.items())
        segment_metadata = {
            "parser": metadata.get("parser"),
            "kind": "table_row",
            "sheet_name": sheet_name,
            "row_index": row_index,
            "values": present,
            "columns": headers,
        }
        for key in ("source_parser", "table_source_type", "table_extraction_method", "source_file", "source_type"):
            if metadata.get(key) is not None:
                segment_metadata[key] = metadata[key]
        segments.append(ParsedSegment(text, segment_metadata))
    return segments, [{"sheet_name": sheet_name, "columns": headers, "row_count": len(segments), **metadata}]


def normalize_header(value: object, index: int) -> str:
    text = str(value or "").strip()
    return text if text else f"column_{index + 1}"


def dedupe_headers(headers: list[str]) -> list[str]:
    counts: dict[str, int] = {}
    result: list[str] = []
    for header in headers:
        count = counts.get(header, 0)
        counts[header] = count + 1
        result.append(header if count == 0 else f"{header}_{count + 1}")
    return result


def parse_scalar(value: object) -> object:
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    normalized = text.replace(",", "")
    if re.fullmatch(r"[-+]?\d+", normalized):
        try:
            return int(normalized)
        except ValueError:
            return text
    if re.fullmatch(r"[-+]?(?:\d+\.\d*|\d*\.\d+)", normalized):
        try:
            return float(normalized)
        except ValueError:
            return text
    lowered = text.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    return text


def read_xlsx_rows(content: bytes) -> list[tuple[str, list[list[object]], dict]]:
    try:
        with zipfile.ZipFile(PathLikeBytes(content)) as archive:
            shared_strings = xlsx_shared_strings(archive)
            ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            sheets: list[tuple[str, list[list[object]], dict]] = []
            for sheet_index, (sheet_name, sheet_path) in enumerate(xlsx_sheet_paths(archive)):
                root = ElementTree.fromstring(archive.read(sheet_path))
                raw_rows: list[list[object]] = []
                for row in root.findall(".//s:sheetData/s:row", ns):
                    values: list[object] = []
                    for cell in row.findall("s:c", ns):
                        column_index = xlsx_column_index(cell.attrib.get("r", ""))
                        while len(values) <= column_index:
                            values.append(None)
                        values[column_index] = xlsx_cell_value(cell, shared_strings, ns)
                    raw_rows.append(values)
                sheets.append((sheet_name, raw_rows, {"parser": "xlsx", "sheet_index": sheet_index, "sheet_path": sheet_path}))
            return sheets
    except zipfile.BadZipFile as error:
        raise TraditionalRagError("XLSX file is corrupted.", "parser_error") from error
    except KeyError as error:
        raise TraditionalRagError(f"XLSX missing required structure: {error}", "parser_error") from error


def xlsx_column_index(cell_ref: str) -> int:
    letters = "".join(char for char in cell_ref if char.isalpha()).upper()
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return max(index - 1, 0)


def xlsx_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        xml = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ElementTree.fromstring(xml)
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    return ["".join(node.text or "" for node in item.findall(".//s:t", ns)) for item in root.findall("s:si", ns)]


def xlsx_sheet_paths(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    ns = {
        "s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
    }
    rel_targets = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("pr:Relationship", ns)
        if "Id" in rel.attrib and "Target" in rel.attrib
    }
    sheets: list[tuple[str, str]] = []
    for sheet in workbook.findall("s:sheets/s:sheet", ns):
        name = sheet.attrib.get("name", f"Sheet{len(sheets) + 1}")
        rel_id = sheet.attrib.get(f"{{{ns['r']}}}id")
        target = rel_targets.get(rel_id or "")
        if not target:
            continue
        path = target.lstrip("/")
        if not path.startswith("xl/"):
            path = f"xl/{path}"
        sheets.append((name, path))
    return sheets


def xlsx_cell_value(cell: ElementTree.Element, shared_strings: list[str], ns: dict[str, str]) -> object:
    cell_type = cell.attrib.get("t")
    value_node = cell.find("s:v", ns)
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//s:t", ns))
    if value_node is None or value_node.text is None:
        return None
    raw = value_node.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return raw
    if cell_type == "b":
        return raw == "1"
    return raw


def parse_document(content: bytes, file_type: str) -> ParsedDocument:
    if file_type == "docx":
        return parse_docx_bytes(content)
    if file_type == "html":
        return parse_html_bytes(content)
    if file_type == "json":
        return parse_json_bytes(content)
    if file_type == "markdown":
        return parse_markdown_table_bytes(content)
    if file_type == "txt":
        return parse_text_bytes(content, parser="txt")
    if file_type in TABLE_FILE_TYPES:
        return parse_table_bytes(content, file_type)
    raise TraditionalRagError("Unsupported file type for parsing.", "unsupported_file_type")


def segment_reference(segment_index: int, metadata: dict) -> dict:
    reference = {"segment_index": segment_index}
    for key in ("kind", "paragraph_index", "parser", "row_index", "sheet_name", "table_index"):
        if key in metadata:
            reference[key] = metadata[key]
    return reference


def reference_kinds(references: list[dict]) -> list[str]:
    kinds: list[str] = []
    for reference in references:
        kind = reference.get("kind")
        if isinstance(kind, str) and kind not in kinds:
            kinds.append(kind)
    return kinds


def table_segment_headers(segment: ParsedSegment) -> list[str]:
    columns = segment.metadata.get("columns")
    if isinstance(columns, list):
        return [str(column) for column in columns if str(column)]
    values = segment.metadata.get("values")
    if isinstance(values, dict):
        return [str(key) for key in values.keys()]
    return []


def compact_table_segment_text(segment: ParsedSegment, headers: list[str]) -> str:
    values = segment.metadata.get("values")
    if not isinstance(values, dict) or not headers:
        return segment.text.strip()
    row_values = [str(values.get(header, "")) for header in headers]
    while row_values and row_values[-1] == "":
        row_values.pop()
    return " | ".join(row_values).strip()


def split_table_into_compact_chunks(parsed: ParsedDocument, *, max_chars: int) -> list[tuple[str, dict]]:
    chunks: list[tuple[str, dict]] = []
    current_parts: list[str] = []
    current_references: list[dict] = []
    current_start: int | None = None
    current_end: int | None = None
    current_chars = 0
    current_headers: list[str] = []
    current_sheet_name: str | None = None

    def header_text(headers: list[str]) -> str:
        return "字段: " + " | ".join(headers) if headers else ""

    def flush() -> None:
        nonlocal current_parts, current_references, current_start, current_end, current_chars, current_headers, current_sheet_name
        if not current_parts:
            return
        prefix = header_text(current_headers)
        text = "\n".join(([prefix] if prefix else []) + current_parts).strip()
        if text:
            chunks.append(
                (
                    text,
                    {
                        "segment_start": current_start,
                        "segment_end": current_end,
                        "segments": current_references,
                        "reference_kinds": reference_kinds(current_references),
                        "char_count": len(text),
                        "chunking_strategy": "table_compact_chars",
                        "columns": current_headers,
                        "sheet_name": current_sheet_name,
                    },
                )
            )
        current_parts = []
        current_references = []
        current_start = None
        current_end = None
        current_chars = 0
        current_headers = []
        current_sheet_name = None

    for segment_index, segment in enumerate(parsed.segments):
        if segment.metadata.get("kind") != "table_row":
            flush()
            text = segment.text.strip()
            if text:
                references = [segment_reference(segment_index, segment.metadata)]
                chunks.append((text[:max_chars], {"segment_start": segment_index, "segment_end": segment_index, "segments": references, "reference_kinds": reference_kinds(references), "char_count": min(len(text), max_chars)}))
            continue
        headers = table_segment_headers(segment)
        sheet_name = str(segment.metadata.get("sheet_name") or "") or None
        row_text = compact_table_segment_text(segment, headers)
        if not row_text:
            continue
        prefix_len = len(header_text(headers)) + 1 if headers else 0
        projected = current_chars + len(row_text) + (1 if current_parts else prefix_len)
        if current_parts and (headers != current_headers or sheet_name != current_sheet_name or projected > max_chars):
            flush()
        if current_start is None:
            current_start = segment_index
            current_headers = headers
            current_sheet_name = sheet_name
            current_chars = prefix_len
        current_end = segment_index
        current_parts.append(row_text)
        current_references.append(segment_reference(segment_index, segment.metadata))
        current_chars += len(row_text) + (1 if len(current_parts) > 1 else 0)
    flush()
    if not chunks:
        raise TraditionalRagError("No chunks generated from file.", "empty_chunks")
    return chunks


def split_into_chunks(parsed: ParsedDocument, *, max_chars: int = DEFAULT_CHUNK_SIZE, overlap_chars: int = DEFAULT_CHUNK_OVERLAP) -> list[tuple[str, dict]]:
    max_chars = max(1, max_chars)
    overlap_chars = max(0, min(overlap_chars, max_chars - 1))
    chunks: list[tuple[str, dict]] = []
    parser = parsed.metadata.get("parser")
    if parser in TABLE_FILE_TYPES and not bool(getattr(settings, "KNOWLEDGE_TABLE_ROW_CHUNKING", True)):
        return split_table_into_compact_chunks(parsed, max_chars=max_chars)
    if parser in TABLE_FILE_TYPES and bool(getattr(settings, "KNOWLEDGE_TABLE_ROW_CHUNKING", True)):
        for segment_index, segment in enumerate(parsed.segments):
            text = segment.text.strip()
            if not text:
                continue
            references = [segment_reference(segment_index, segment.metadata)]
            metadata = dict(segment.metadata)
            metadata.update(
                {
                    "segment_start": segment_index,
                    "segment_end": segment_index,
                    "segments": references,
                    "reference_kinds": reference_kinds(references),
                    "char_count": len(text),
                    "chunking_strategy": "table_row",
                }
            )
            chunks.append((text, metadata))
        if not chunks:
            raise TraditionalRagError("No chunks generated from file.", "empty_chunks")
        return chunks
    current_parts: list[str] = []
    current_references: list[dict] = []
    current_start: int | None = None
    current_end: int | None = None
    current_chars = 0

    def flush() -> None:
        nonlocal current_parts, current_references, current_start, current_end, current_chars
        if not current_parts:
            return
        text = "\n\n".join(current_parts).strip()
        if text:
            chunks.append(
                (
                    text,
                    {
                        "segment_start": current_start,
                        "segment_end": current_end,
                        "segments": current_references,
                        "reference_kinds": reference_kinds(current_references),
                        "char_count": len(text),
                    },
                )
            )
        current_parts = []
        current_references = []
        current_start = None
        current_end = None
        current_chars = 0

    for segment_index, segment in enumerate(parsed.segments):
        text = segment.text.strip()
        if not text:
            continue
        if len(text) > max_chars:
            flush()
            start = 0
            while start < len(text):
                end = min(len(text), start + max_chars)
                piece = text[start:end].strip()
                if piece:
                    references = [segment_reference(segment_index, segment.metadata)]
                    metadata = dict(segment.metadata)
                    metadata.update(
                        {
                            "segment_start": segment_index,
                            "segment_end": segment_index,
                            "segments": references,
                            "reference_kinds": reference_kinds(references),
                            "char_start": start,
                            "char_end": end,
                            "char_count": len(piece),
                        }
                    )
                    chunks.append((piece, metadata))
                if end >= len(text):
                    break
                start = max(0, end - overlap_chars)
            continue
        projected = current_chars + len(text) + (2 if current_parts else 0)
        if projected > max_chars:
            flush()
        if current_start is None:
            current_start = segment_index
        current_end = segment_index
        current_chars += len(text) + (2 if current_parts else 0)
        current_parts.append(text)
        current_references.append(segment_reference(segment_index, segment.metadata))
    flush()
    if not chunks:
        raise TraditionalRagError("No chunks generated from file.", "empty_chunks")
    return chunks



def embedding_settings() -> dict | None:
    base_url = (getattr(settings, "EMBEDDING_BASE_URL", "") or "").strip().rstrip("/")
    api_key = (getattr(settings, "EMBEDDING_API_KEY", "") or "").strip()
    model = (getattr(settings, "EMBEDDING_MODEL", "") or "").strip()
    api_format = (getattr(settings, "EMBEDDING_API_FORMAT", "local-inputs") or "local-inputs").strip().lower()
    normalize = bool(getattr(settings, "EMBEDDING_NORMALIZE", True))
    pooling = (getattr(settings, "EMBEDDING_POOLING", "mean") or "mean").strip()
    dimensions = max(0, int(getattr(settings, "EMBEDDING_DIMENSIONS", 0) or 0))
    document_instruction = (getattr(settings, "EMBEDDING_DOCUMENT_INSTRUCTION", "") or "").strip()
    query_instruction = (getattr(settings, "EMBEDDING_QUERY_INSTRUCTION", "") or "").strip()
    if not base_url:
        return None
    if api_format == "openai" and (not api_key or not model):
        raise TraditionalRagError(
            "Embedding config is incomplete. OpenAI format requires EMBEDDING_API_KEY and EMBEDDING_MODEL.",
            "config_error",
        )
    return {
        "base_url": base_url,
        "api_key": api_key,
        "model": model or "local-embedding",
        "api_format": api_format,
        "normalize": normalize,
        "pooling": pooling,
        "dimensions": dimensions,
        "document_instruction": document_instruction,
        "query_instruction": query_instruction,
    }


def normalize_vector(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [value / norm for value in vector]


def embedding_endpoint(base_url: str) -> str:
    return base_url if base_url.rstrip("/").endswith("/embeddings") else f"{base_url}/embeddings"


def build_embedding_payload(config: dict, texts: list[str]) -> dict:
    if config["api_format"] == "openai":
        payload = {"model": config["model"], "input": texts}
        if config.get("dimensions"):
            payload["dimensions"] = config["dimensions"]
        return payload
    payload = {
        "inputs": [{"text": text} for text in texts],
        "normalize": config["normalize"],
        "pooling": config["pooling"],
    }
    if config.get("dimensions"):
        payload["dimensions"] = config["dimensions"]
    return payload


def prepare_embedding_texts(texts: list[str], config: dict, *, input_type: str, max_text_chars: int) -> tuple[list[str], dict]:
    instruction = config.get("query_instruction") if input_type == "query" else config.get("document_instruction")
    prefix = f"{instruction}\n" if instruction else ""
    prepared: list[str] = []
    truncated_count = 0
    max_original_chars = 0
    max_prepared_chars = 0
    for text in texts:
        raw = text or ""
        max_original_chars = max(max_original_chars, len(raw))
        budget = max_text_chars - len(prefix) if max_text_chars > 0 else 0
        if max_text_chars > 0 and budget <= 0:
            clipped = ""
            truncated = bool(raw)
        elif max_text_chars > 0 and len(raw) > budget:
            clipped = raw[:budget]
            truncated = True
        else:
            clipped = raw
            truncated = False
        value = f"{prefix}{clipped}" if prefix else clipped
        if max_text_chars > 0 and len(value) > max_text_chars:
            value = value[:max_text_chars]
            truncated = True
        if truncated:
            truncated_count += 1
        max_prepared_chars = max(max_prepared_chars, len(value))
        prepared.append(value)
    return prepared, {
        "input_type": input_type,
        "instruction_applied": bool(prefix),
        "truncated_count": truncated_count,
        "max_original_chars": max_original_chars,
        "max_prepared_chars": max_prepared_chars,
    }

def extract_embedding_vectors(result: object, expected_count: int) -> list[list[float]]:
    data: object
    if isinstance(result, dict):
        data = result.get("data") or result.get("embeddings") or result.get("vectors") or result.get("result")
    else:
        data = result
    if not isinstance(data, list) or len(data) != expected_count:
        raise TraditionalRagError("Embedding API returned an unexpected number of vectors.", "embedding_error")
    if data and all(isinstance(item, dict) for item in data):
        ordered = sorted(data, key=lambda item: item.get("index", 0))
        raw_vectors = [item.get("embedding") or item.get("vector") or item.get("values") for item in ordered]
    else:
        raw_vectors = data
    vectors: list[list[float]] = []
    for raw in raw_vectors:
        if not isinstance(raw, list) or not raw:
            raise TraditionalRagError("Embedding API response is missing embedding vectors.", "embedding_error")
        vectors.append(normalize_vector([float(value) for value in raw]))
    dimensions = len(vectors[0])
    if any(len(vector) != dimensions for vector in vectors):
        raise TraditionalRagError("Embedding API returned vectors with inconsistent dimensions.", "embedding_error")
    return vectors


def iter_embedding_batches(texts: list[str], *, batch_size: int, max_batch_chars: int) -> list[list[str]]:
    batches: list[list[str]] = []
    current: list[str] = []
    current_chars = 0
    for text in texts:
        text_chars = len(text or "")
        would_exceed_count = len(current) >= batch_size
        would_exceed_chars = bool(current) and max_batch_chars > 0 and current_chars + text_chars > max_batch_chars
        if would_exceed_count or would_exceed_chars:
            batches.append(current)
            current = []
            current_chars = 0
        current.append(text)
        current_chars += text_chars
    if current:
        batches.append(current)
    return batches


def embed_texts(texts: list[str], *, fail_on_error: bool = True, input_type: str = "document") -> tuple[list[list[float]], dict]:
    config = embedding_settings()
    if config is None:
        return [], {"status": "not_configured"}
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if config["api_key"]:
        headers["Authorization"] = f"Bearer {config['api_key']}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    attempts = max(1, int(getattr(
        settings,
        "EMBEDDING_RETRY_ATTEMPTS" if fail_on_error else "EMBEDDING_OPTIONAL_RETRY_ATTEMPTS",
        5 if fail_on_error else 1,
    )))
    timeout_seconds = max(1.0, float(getattr(
        settings,
        "EMBEDDING_TIMEOUT_SECONDS" if fail_on_error else "EMBEDDING_OPTIONAL_TIMEOUT_SECONDS",
        30 if fail_on_error else 90,
    )))
    batch_size = max(1, int(getattr(settings, "EMBEDDING_BATCH_SIZE", 64)))
    max_text_chars = max(0, int(getattr(settings, "EMBEDDING_MAX_TEXT_CHARS", 8192)))
    max_batch_chars = max(0, int(getattr(settings, "EMBEDDING_MAX_BATCH_CHARS", 60000)))
    request_concurrency = max(1, int(getattr(settings, "EMBEDDING_REQUEST_CONCURRENCY", 4)))
    normalized_texts, input_metadata = prepare_embedding_texts(
        texts,
        config,
        input_type=input_type,
        max_text_chars=max_text_chars,
    )
    endpoint = embedding_endpoint(config["base_url"])
    all_vectors: list[list[float]] = []
    last_error: Exception | None = None
    batches = iter_embedding_batches(normalized_texts, batch_size=batch_size, max_batch_chars=max_batch_chars)

    def request_batch(batch: list[str]) -> list[list[float]]:
        payload = json.dumps(build_embedding_payload(config, batch), ensure_ascii=False).encode("utf-8")
        batch_last_error: Exception | None = None
        for attempt in range(attempts):
            request = urllib.request.Request(
                endpoint,
                data=payload,
                headers=headers,
                method="POST",
            )
            try:
                with opener.open(request, timeout=timeout_seconds) as response:
                    result = json.loads(response.read().decode("utf-8"))
                return extract_embedding_vectors(result, len(batch))
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")
                raise TraditionalRagError(f"Embedding API HTTP {error.code}: {detail}", "embedding_error") from error
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                batch_last_error = error
                if attempt < attempts - 1:
                    time.sleep(min(1.0 * (attempt + 1), 3.0))
                    continue
            except json.JSONDecodeError as error:
                raise TraditionalRagError("Embedding API returned invalid JSON.", "embedding_error") from error
        raise TraditionalRagError(f"Embedding API network error: {batch_last_error}", "embedding_error")

    try:
        if request_concurrency == 1 or len(batches) <= 1:
            batch_vectors = [request_batch(batch) for batch in batches]
        else:
            workers = min(request_concurrency, len(batches))
            batch_vectors = [None] * len(batches)
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
                future_to_index = {executor.submit(request_batch, batch): index for index, batch in enumerate(batches)}
                for future in concurrent.futures.as_completed(future_to_index):
                    batch_vectors[future_to_index[future]] = future.result()
        for vectors in batch_vectors:
            all_vectors.extend(vectors or [])
        last_error = None
    except TraditionalRagError as error:
        last_error = error

    if last_error is not None:
        message = last_error.message if isinstance(last_error, TraditionalRagError) else f"Embedding API network error: {last_error}"
        if fail_on_error:
            raise last_error if isinstance(last_error, TraditionalRagError) else TraditionalRagError(message, "embedding_error")
        return [], {
            "status": "unavailable",
            "error": "embedding_error",
            "message": message,
            "provider": config["api_format"],
            "model": config["model"],
            "endpoint": endpoint,
            "batch_size": batch_size,
            "max_text_chars": max_text_chars,
            "max_batch_chars": max_batch_chars,
            "batch_count": len(batches),
            "request_concurrency": request_concurrency,
            "dimensions_requested": config.get("dimensions") or None,
            **input_metadata,
        }

    if len(all_vectors) != len(texts):
        raise TraditionalRagError("Embedding API returned an unexpected number of vectors.", "embedding_error")
    return all_vectors, {
        "status": "ready",
        "provider": config["api_format"],
        "model": config["model"],
        "dimensions": len(all_vectors[0]) if all_vectors else 0,
        "count": len(all_vectors),
        "endpoint": endpoint,
        "batch_size": batch_size,
        "max_text_chars": max_text_chars,
        "max_batch_chars": max_batch_chars,
        "batch_count": len(batches),
        "request_concurrency": request_concurrency,
        "dimensions_requested": config.get("dimensions") or None,
        **input_metadata,
    }

def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return -1.0
    return sum(a * b for a, b in zip(left, right, strict=True))


def semantic_search(*, query: str, knowledge_base_id: int | None = None, limit: int = 10) -> list[KnowledgeChunkRef]:
    normalized = query.strip()
    if not normalized:
        raise TraditionalRagError("Search query cannot be empty.", "invalid_input")
    vectors, metadata = embed_texts([normalized], input_type="query")
    if metadata.get("status") != "ready" or not vectors:
        raise TraditionalRagError("Embedding is not configured, semantic search is unavailable.", "config_error")
    embeddings = KnowledgeEmbedding.objects.select_related("chunk", "chunk__file", "chunk__file__knowledge_base").filter(
        chunk__file__archived_at__isnull=True,
        chunk__file__knowledge_base__archived_at__isnull=True,
        model=metadata["model"],
        dimensions=metadata["dimensions"],
    )
    if knowledge_base_id:
        embeddings = embeddings.filter(chunk__file__knowledge_base_id=knowledge_base_id)
    scored = sorted(
        ((cosine_similarity(vectors[0], item.vector), item.chunk) for item in embeddings),
        key=lambda item: item[0],
        reverse=True,
    )
    return [chunk for score, chunk in scored[: max(1, min(limit, 50))] if score >= 0]

def _run_ingest_pipeline(
    *,
    file: KnowledgeFile,
    job: KnowledgeIngestJob,
    content: bytes,
    file_type: str,
    digest: str,
    content_metadata: dict,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> TraditionalIngestResult:
    job.status = KnowledgeIngestJob.Status.PARSING
    job.stage = "parsing"
    job.progress = 10
    if job.started_at is None:
        job.started_at = timezone.now()
    job.save(update_fields=["status", "stage", "progress", "started_at", "updated_at"])

    parsed = parse_document(content, file_type)
    job.status = KnowledgeIngestJob.Status.CHUNKING
    job.stage = "chunking"
    job.progress = 60
    job.save(update_fields=["status", "stage", "progress", "updated_at"])

    chunk_items = split_into_chunks(
        parsed,
        max_chars=chunk_size or DEFAULT_CHUNK_SIZE,
        overlap_chars=chunk_overlap if chunk_overlap is not None else DEFAULT_CHUNK_OVERLAP,
    )
    job.status = KnowledgeIngestJob.Status.EMBEDDING
    job.stage = "embedding"
    job.progress = 80
    job.save(update_fields=["status", "stage", "progress", "updated_at"])

    vectors, embedding_metadata = embed_texts([text for text, _ in chunk_items], fail_on_error=False, input_type="document")
    knowledge_db = file._state.db or "knowledge"
    with transaction.atomic(using=knowledge_db):
        file.file_type = file_type
        file.content_hash = digest
        file.char_count = len(parsed.text)
        file.chunk_count = len(chunk_items)
        file.status = KnowledgeFile.Status.READY
        file.metadata = {
            **(file.metadata or {}),
            **content_metadata,
            "content_hash": digest,
            "parser": parsed.metadata,
            "chunk_config": {
                "max_chars": chunk_size or DEFAULT_CHUNK_SIZE,
                "overlap_chars": chunk_overlap if chunk_overlap is not None else DEFAULT_CHUNK_OVERLAP,
                "table_row_chunking": bool(getattr(settings, "KNOWLEDGE_TABLE_ROW_CHUNKING", True)),
            },
            "embedding": embedding_metadata,
        }
        file.save()
        file.chunk_refs.all().delete()
        chunks = [
            KnowledgeChunkRef(
                file=file,
                chunk_index=index,
                chunk_ref=f"knowledge_file:{file.id}:chunk:{index}",
                text_preview=text[:2000],
                metadata={
                    **metadata,
                    "parser": parsed.metadata.get("parser"),
                    "ingest_mode": "traditional-rag",
                    "keywords": extract_chunk_keywords(text),
                },
            )
            for index, (text, metadata) in enumerate(chunk_items)
        ]
        KnowledgeChunkRef.objects.bulk_create(chunks)
        saved_chunks = list(file.chunk_refs.order_by("chunk_index"))
        if embedding_metadata.get("status") == "ready":
            embeddings = []
            for chunk, vector in zip(saved_chunks, vectors, strict=True):
                chunk.embedding_ref = f"knowledge_embedding:{chunk.id}"
                chunk.save(update_fields=["embedding_ref"])
                embeddings.append(
                    KnowledgeEmbedding(
                        chunk=chunk,
                        model=embedding_metadata["model"],
                        dimensions=embedding_metadata["dimensions"],
                        vector=vector,
                        provider=embedding_metadata.get("provider", "openai-compatible"),
                    )
                )
            KnowledgeEmbedding.objects.bulk_create(embeddings)
        job.status = KnowledgeIngestJob.Status.READY
        job.stage = "ready"
        job.progress = 100
        job.error = None
        job.metrics = {
            "char_count": file.char_count,
            "chunk_count": file.chunk_count,
            "parser": parsed.metadata,
            "embedding": embedding_metadata,
        }
        job.finished_at = timezone.now()
        job.save()
        KnowledgeBase.objects.filter(id=file.knowledge_base_id).update(
            file_count=file.knowledge_base.files.filter(archived_at__isnull=True).count(),
            status=KnowledgeBase.Status.READY,
        )
    file.refresh_from_db()
    job.refresh_from_db()
    return TraditionalIngestResult(file=file, job=job, chunks=list(file.chunk_refs.order_by("chunk_index")))


def _mark_ingest_failed(file: KnowledgeFile, job: KnowledgeIngestJob, error: Exception) -> None:
    payload = {
        "error": getattr(error, "code", "processing_error"),
        "message": getattr(error, "message", str(error)),
    }
    file.status = KnowledgeFile.Status.FAILED
    file.metadata = {**(file.metadata or {}), "error": payload}
    file.save(update_fields=["status", "metadata", "updated_at"])
    job.status = KnowledgeIngestJob.Status.FAILED
    job.stage = "failed"
    job.progress = 100
    job.error = payload
    job.finished_at = timezone.now()
    job.save(update_fields=["status", "stage", "progress", "error", "finished_at", "updated_at"])


def _run_async_ingest_job(job_id: int, *, chunk_size: int | None, chunk_overlap: int | None) -> None:
    close_old_connections()
    try:
        job = KnowledgeIngestJob.objects.select_related("file", "file__knowledge_base").get(id=job_id)
        file = job.file
        content = read_stored_file(file.storage_path)
        file_type = file.file_type or detect_file_type(file.original_filename, content)
        digest = file.content_hash or hashlib.sha256(content).hexdigest()
        content_metadata = {
            "content_type": (file.metadata or {}).get("content_type", ""),
            "file_size": (file.metadata or {}).get("file_size", len(content)),
            "ingest_mode": "traditional-rag",
            "async": True,
        }
        _run_ingest_pipeline(
            file=file,
            job=job,
            content=content,
            file_type=file_type,
            digest=digest,
            content_metadata=content_metadata,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
    except Exception as error:
        try:
            if "job" not in locals():
                job = KnowledgeIngestJob.objects.select_related("file").get(id=job_id)
                file = job.file
            _mark_ingest_failed(file, job, error)
        except Exception:
            pass
    finally:
        close_old_connections()


def enqueue_ingest_upload(
    *,
    knowledge_base: KnowledgeBase,
    upload,
    user,
    segment_mode: str = "general",
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> TraditionalIngestResult:
    original_filename = safe_original_filename(getattr(upload, "name", "") or "upload.bin")
    file = KnowledgeFile.objects.create(
        knowledge_base=knowledge_base,
        original_filename=original_filename,
        segment_mode=segment_mode or "general",
        status=KnowledgeFile.Status.PROCESSING,
        uploaded_by=None,
        metadata={"ingest_mode": "traditional-rag", "async": True},
    )
    job = KnowledgeIngestJob.objects.create(
        file=file,
        status=KnowledgeIngestJob.Status.PENDING,
        stage="queued",
        progress=5,
        created_by=None,
    )
    try:
        storage_path, content, storage_metadata = write_uploaded_file(upload, knowledge_base.id, file.id, original_filename)
        file_type = detect_file_type(original_filename, content)
        digest = hashlib.sha256(content).hexdigest()
        file.storage_path = storage_path
        file.file_type = file_type
        file.content_hash = digest
        file.metadata = {
            **(file.metadata or {}),
            "content_hash": digest,
            **storage_metadata,
            "content_type": getattr(upload, "content_type", ""),
            "file_size": getattr(upload, "size", len(content)),
            "chunk_config": {
                "max_chars": chunk_size or DEFAULT_CHUNK_SIZE,
                "overlap_chars": chunk_overlap if chunk_overlap is not None else DEFAULT_CHUNK_OVERLAP,
            },
        }
        file.save(update_fields=["storage_path", "file_type", "content_hash", "metadata", "updated_at"])
    except Exception as error:
        _mark_ingest_failed(file, job, error)
        raise

    thread = threading.Thread(
        target=_run_async_ingest_job,
        kwargs={"job_id": job.id, "chunk_size": chunk_size, "chunk_overlap": chunk_overlap},
        name=f"knowledge-ingest-{job.id}",
        daemon=True,
    )
    thread.start()
    return TraditionalIngestResult(file=file, job=job, chunks=[])


def enqueue_file_reingest(
    *,
    file: KnowledgeFile,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> KnowledgeIngestJob:
    """Re-run parse/chunk/embed after document content was overwritten."""
    job = KnowledgeIngestJob.objects.create(
        file=file,
        status=KnowledgeIngestJob.Status.PENDING,
        stage="queued",
        progress=5,
        created_by=None,
    )
    file.status = KnowledgeFile.Status.PROCESSING
    meta = dict(file.metadata or {})
    if chunk_size is not None or chunk_overlap is not None:
        meta["chunk_config"] = {
            **(meta.get("chunk_config") or {}),
            "max_chars": chunk_size or DEFAULT_CHUNK_SIZE,
            "overlap_chars": chunk_overlap if chunk_overlap is not None else DEFAULT_CHUNK_OVERLAP,
        }
    file.metadata = meta
    file.save(update_fields=["status", "metadata", "updated_at"])
    thread = threading.Thread(
        target=_run_async_ingest_job,
        kwargs={"job_id": job.id, "chunk_size": chunk_size, "chunk_overlap": chunk_overlap},
        name=f"knowledge-reingest-{job.id}",
        daemon=True,
    )
    thread.start()
    return job


def ingest_upload(
    *,
    knowledge_base: KnowledgeBase,
    upload,
    user,
    segment_mode: str = "general",
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> TraditionalIngestResult:
    original_filename = safe_original_filename(getattr(upload, "name", "") or "upload.bin")
    file = KnowledgeFile.objects.create(
        knowledge_base=knowledge_base,
        original_filename=original_filename,
        segment_mode=segment_mode or "general",
        status=KnowledgeFile.Status.PROCESSING,
        uploaded_by=None,
        metadata={"ingest_mode": "traditional-rag"},
    )
    job = KnowledgeIngestJob.objects.create(
        file=file,
        status=KnowledgeIngestJob.Status.PARSING,
        stage="parsing",
        progress=10,
        created_by=None,
        started_at=timezone.now(),
    )
    try:
        storage_path, content, storage_metadata = write_uploaded_file(upload, knowledge_base.id, file.id, original_filename)
        file.storage_path = storage_path
        file_type = detect_file_type(original_filename, content)
        digest = hashlib.sha256(content).hexdigest()
        return _run_ingest_pipeline(
            file=file,
            job=job,
            content=content,
            file_type=file_type,
            digest=digest,
            content_metadata={
                "content_type": getattr(upload, "content_type", ""),
                **storage_metadata,
                "file_size": getattr(upload, "size", len(content)),
                "ingest_mode": "traditional-rag",
            },
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
    except Exception as error:
        _mark_ingest_failed(file, job, error)
        raise

_QUERY_STOPWORDS = {
    "ai",
    "AI",
    "\u5e2e\u6211",
    "\u67e5\u4e00\u4e0b",
    "\u67e5\u8be2",
    "\u68c0\u7d22",
    "\u627e\u4e00\u4e0b",
    "\u770b\u4e00\u4e0b",
    "\u6709\u6ca1\u6709",
    "\u662f\u4ec0\u4e48",
    "\u8bf7\u95ee",
}


def _keyword_terms(query: str) -> list[str]:
    text = re.sub(r"@[A-Za-z0-9_\-\u4e00-\u9fff]+", " ", query or "")
    raw_terms = re.findall(r"[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fffA-Za-z0-9-]{2,}", text)
    out: list[str] = []
    seen: set[str] = set()
    strip_chars = " \t\r\n,.;:!?()[]{}<>\"'`"
    for term in raw_terms:
        item = term.strip(strip_chars)
        if not item or item in _QUERY_STOPWORDS or len(item) < 2:
            continue
        if item not in seen:
            seen.add(item)
            out.append(item)
        if "-" in item:
            for part in item.split("-"):
                part = part.strip(strip_chars)
                if len(part) >= 2 and part not in _QUERY_STOPWORDS and part not in seen:
                    seen.add(part)
                    out.append(part)
    return out[:12]


def keyword_search(*, query: str, knowledge_base_id: int | None = None, limit: int = 10) -> list[KnowledgeChunkRef]:
    normalized = query.strip()
    if not normalized:
        raise TraditionalRagError("Search query cannot be empty.", "invalid_input")
    rows = KnowledgeChunkRef.objects.select_related("file", "file__knowledge_base").filter(
        file__archived_at__isnull=True,
        file__knowledge_base__archived_at__isnull=True,
    )
    if knowledge_base_id:
        rows = rows.filter(file__knowledge_base_id=knowledge_base_id)

    cap = max(1, min(limit, 50))
    exact = list(rows.filter(text_preview__icontains=normalized).order_by("-created_at")[:cap])
    if exact:
        return exact

    terms = _keyword_terms(normalized)
    if not terms:
        return []
    candidates = rows
    q_filter = None
    for term in terms:
        term_q = Q(text_preview__icontains=term)
        q_filter = term_q if q_filter is None else q_filter | term_q
    if q_filter is None:
        return []
    scored = []
    for chunk in candidates.filter(q_filter).order_by("-created_at")[:500]:
        text = chunk.text_preview or ""
        score = 0
        for term in terms:
            if term and term in text:
                score += max(1, min(len(term), 12))
        if score:
            scored.append((score, chunk.created_at, chunk))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [chunk for _score, _created_at, chunk in scored[:cap]]

