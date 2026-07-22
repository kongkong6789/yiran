"""SkillHub 公共技能市场接入与下载包校验。"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import re
import zipfile
from pathlib import PurePosixPath
from typing import Any
from urllib.parse import urlparse

import requests
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .parser import MAX_SKILL_ZIP_BYTES


SKILLHUB_API_BASE = "https://api.skillhub.cn"
SKILLHUB_WEB_BASE = "https://www.skillhub.cn"
SKILLHUB_TIMEOUT = (4, 20)
SKILLHUB_PAGE_SIZE_MAX = 20
SKILLHUB_SORT_KEYS = {"score", "curated_score", "rank", "downloads", "stars", "updated_at"}
SKILLHUB_SOURCE_KEYS = {"", "clawhub", "community"}
SKILLHUB_API_KEY_FILTERS = {"", "required", "not_required"}
SKILLHUB_CATEGORY_KEYS = {
    "",
    "office-efficiency",
    "content-creation",
    "dev-programming",
    "data-analysis",
    "design-media",
    "ai-agent",
    "knowledge-management",
    "business-ops",
    "education",
    "professional",
    "it-ops-security",
    "life-service",
}
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$")
_SKILLHUB_URL_RE = re.compile(r"^https?://(?:www\.)?skillhub\.cn/skills/([^/?#]+)", re.IGNORECASE)
_RISK_STATUSES = {"malicious", "dangerous", "unsafe", "risk", "blocked"}


class SkillHubError(ValueError):
    """面向 API 的可读 SkillHub 异常。"""


def _validate_slug(slug: str) -> str:
    normalized = (slug or "").strip().lower()
    if not _SLUG_RE.fullmatch(normalized):
        raise SkillHubError("SkillHub Skill ID 无效")
    return normalized


def _validate_version(version: str | None) -> str:
    normalized = (version or "").strip()
    if not normalized or not _VERSION_RE.fullmatch(normalized):
        raise SkillHubError("SkillHub 版本号无效")
    return normalized


def _get_json(path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        response = requests.get(
            f"{SKILLHUB_API_BASE}{path}",
            params=params,
            timeout=SKILLHUB_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.Timeout as exc:
        raise SkillHubError("SkillHub 响应超时，请稍后重试") from exc
    except (requests.RequestException, ValueError) as exc:
        raise SkillHubError("SkillHub 暂时无法访问，请稍后重试") from exc
    if not isinstance(payload, dict):
        raise SkillHubError("SkillHub 返回了无法识别的数据")
    return payload


def _normalize_market_skill(row: dict[str, Any]) -> dict[str, Any]:
    labels = row.get("labels") if isinstance(row.get("labels"), dict) else {}
    sub_categories = row.get("subCategories") if isinstance(row.get("subCategories"), list) else []
    return {
        "slug": str(row.get("slug") or ""),
        "name": str(row.get("name") or row.get("displayName") or row.get("slug") or ""),
        "description": str(row.get("description_zh") or row.get("description") or row.get("summary_zh") or row.get("summary") or ""),
        "version": str(row.get("version") or (row.get("tags") or {}).get("latest") or ""),
        "category": str(row.get("category") or ""),
        "sub_categories": [
            {"key": str(item.get("key") or ""), "name": str(item.get("name") or "")}
            for item in sub_categories
            if isinstance(item, dict)
        ],
        "owner": str(row.get("ownerName") or ""),
        "source": str(row.get("source") or ""),
        "source_url": str(row.get("sourceUrl") or row.get("upstream_url") or ""),
        "icon_url": str(row.get("iconUrl") or ""),
        "downloads": int(row.get("downloads") or 0),
        "stars": int(row.get("stars") or 0),
        "score": float(row.get("score") or 0),
        "verified": bool(row.get("verified") or row.get("isAuthorVerified")),
        "requires_api_key": str(labels.get("requires_api_key") or "false").lower() == "true",
        "detail_url": f"{SKILLHUB_WEB_BASE}/skills/{row.get('slug') or ''}",
    }


def search_skills(
    keyword: str = "",
    *,
    page: int = 1,
    page_size: int = 12,
    sort_by: str = "score",
    source: str = "",
    category: str = "",
    api_key: str = "",
) -> dict[str, Any]:
    keyword = (keyword or "").strip()[:300]
    url_match = _SKILLHUB_URL_RE.match(keyword)
    if url_match:
        keyword = _validate_slug(url_match.group(1))
    keyword = keyword[:100]
    page = max(1, int(page or 1))
    page_size = min(SKILLHUB_PAGE_SIZE_MAX, max(1, int(page_size or 12)))
    sort_by = (sort_by or "score").strip().lower()
    source = (source or "").strip().lower()
    category = (category or "").strip().lower()
    api_key = (api_key or "").strip().lower()
    if sort_by not in SKILLHUB_SORT_KEYS:
        raise SkillHubError("SkillHub 排序方式无效")
    if source not in SKILLHUB_SOURCE_KEYS:
        raise SkillHubError("SkillHub 来源筛选无效")
    if category not in SKILLHUB_CATEGORY_KEYS:
        raise SkillHubError("SkillHub 场景分类无效")
    if api_key not in SKILLHUB_API_KEY_FILTERS:
        raise SkillHubError("SkillHub API Key 筛选无效")

    if sort_by in {"curated_score", "rank"}:
        showcase_path = "/api/v1/showcase/recommended" if sort_by == "curated_score" else "/api/v1/showcase/trending"
        showcase = _get_json(showcase_path)
        rows = showcase.get("skills") if isinstance(showcase.get("skills"), list) else []
        normalized_keyword = keyword.casefold()

        def matches(row: dict[str, Any]) -> bool:
            labels = row.get("labels") if isinstance(row.get("labels"), dict) else {}
            requires_api_key = str(labels.get("requires_api_key") or "false").lower() == "true"
            row_source = str(row.get("source") or "").lower()
            source_matches = (
                not source
                or (source == "clawhub" and row_source == "clawhub")
                or (source == "community" and row_source in {"community", "enterprise"})
            )
            searchable = " ".join(str(row.get(key) or "") for key in ("slug", "name", "description_zh", "description"))
            return (
                (not normalized_keyword or normalized_keyword in searchable.casefold())
                and source_matches
                and (not category or str(row.get("category") or "").lower() == category)
                and (api_key != "required" or requires_api_key)
                and (api_key != "not_required" or not requires_api_key)
            )

        filtered_rows = [row for row in rows if isinstance(row, dict) and matches(row)]
        total = len(filtered_rows)
        offset = (page - 1) * page_size
        return {
            "keyword": keyword,
            "page": page,
            "page_size": page_size,
            "total": total,
            "results": [_normalize_market_skill(row) for row in filtered_rows[offset:offset + page_size]],
        }

    params: dict[str, Any] = {
        "page": page,
        "pageSize": page_size,
        "sortBy": sort_by,
        "order": "desc",
        **({"keyword": keyword} if keyword else {}),
        **({"source": source} if source else {}),
        **({"category": category} if category else {}),
    }
    if api_key:
        params["labels"] = f"requires_api_key:{'true' if api_key == 'required' else 'false'}"
    payload = _get_json(
        "/api/skills",
        params=params,
    )
    if payload.get("code") != 0:
        raise SkillHubError(str(payload.get("message") or "SkillHub 搜索失败"))
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    rows = data.get("skills") if isinstance(data.get("skills"), list) else []
    return {
        "keyword": keyword,
        "page": page,
        "page_size": page_size,
        "total": int(data.get("total") or 0),
        "results": [_normalize_market_skill(row) for row in rows if isinstance(row, dict)],
    }


def get_skill_detail(slug: str) -> dict[str, Any]:
    slug = _validate_slug(slug)
    payload = _get_json(f"/api/v1/skills/{slug}")
    skill = payload.get("skill") if isinstance(payload.get("skill"), dict) else {}
    latest = payload.get("latestVersion") if isinstance(payload.get("latestVersion"), dict) else {}
    owner = payload.get("owner") if isinstance(payload.get("owner"), dict) else {}
    reports = payload.get("securityReports") if isinstance(payload.get("securityReports"), dict) else {}
    normalized = _normalize_market_skill({
        **skill,
        "name": skill.get("displayName"),
        "description": skill.get("summary"),
        "description_zh": skill.get("summary_zh"),
        "version": latest.get("version") or (skill.get("tags") or {}).get("latest"),
        "ownerName": owner.get("displayName") or owner.get("handle"),
        "downloads": (skill.get("stats") or {}).get("downloads"),
        "stars": (skill.get("stats") or {}).get("stars"),
    })
    normalized["security_reports"] = {
        key: {
            "status": str(value.get("status") or "unknown"),
            "status_text": str(value.get("statusText") or "未提供结论"),
            "report_url": str(value.get("reportUrl") or ""),
        }
        for key, value in reports.items()
        if isinstance(value, dict)
    }
    normalized["changelog"] = str(latest.get("changelog") or "")
    return normalized


def _download_zip(slug: str, version: str) -> bytes:
    try:
        with requests.get(
            f"{SKILLHUB_API_BASE}/api/v1/download",
            params={"slug": slug, "version": version},
            timeout=SKILLHUB_TIMEOUT,
            stream=True,
        ) as response:
            response.raise_for_status()
            final_host = (urlparse(response.url).hostname or "").lower()
            if final_host != "api.skillhub.cn" and not final_host.endswith((".myqcloud.com", ".tencentcos.cn")):
                raise SkillHubError("SkillHub 下载跳转到了未受信任的地址，已停止导入")
            content_length = int(response.headers.get("Content-Length") or 0)
            if content_length > MAX_SKILL_ZIP_BYTES:
                raise SkillHubError(f"SkillHub 技能包超过 {MAX_SKILL_ZIP_BYTES // (1024 * 1024)}MB 上限")
            chunks: list[bytes] = []
            size = 0
            for chunk in response.iter_content(chunk_size=64 * 1024):
                if not chunk:
                    continue
                size += len(chunk)
                if size > MAX_SKILL_ZIP_BYTES:
                    raise SkillHubError(f"SkillHub 技能包超过 {MAX_SKILL_ZIP_BYTES // (1024 * 1024)}MB 上限")
                chunks.append(chunk)
    except SkillHubError:
        raise
    except requests.Timeout as exc:
        raise SkillHubError("SkillHub 下载超时，请稍后重试") from exc
    except requests.RequestException as exc:
        raise SkillHubError("SkillHub 技能包下载失败，请稍后重试") from exc
    data = b"".join(chunks)
    if len(data) < 4 or data[:2] != b"PK":
        raise SkillHubError("SkillHub 返回的文件不是有效 ZIP 技能包")
    return data


def _should_hash(path: str) -> bool:
    parts = PurePosixPath(path.replace("\\", "/")).parts
    basename = parts[-1] if parts else ""
    return not (
        not basename
        or basename == "_meta.json"
        or basename in {".DS_Store", "Thumbs.db"}
        or basename.startswith("._")
        or "__MACOSX" in parts
    )


def calculate_content_hash(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            hashes = {
                info.filename.replace("\\", "/"): hashlib.sha256(archive.read(info)).hexdigest()
                for info in archive.infolist()
                if not info.is_dir() and _should_hash(info.filename)
            }
    except (zipfile.BadZipFile, OSError) as exc:
        raise SkillHubError("SkillHub 技能包已损坏") from exc
    manifest = "".join(f"{path}:{hashes[path]}\n" for path in sorted(hashes))
    return hashlib.sha256(manifest.encode("utf-8")).hexdigest()


def verify_package_signature(slug: str, version: str, data: bytes) -> dict[str, Any]:
    signature_info = _get_json(f"/api/v1/open/skills/{slug}/versions/{version}/signature")
    if not signature_info.get("signed"):
        return {"verified": False, "status": "unsigned", "content_hash": calculate_content_hash(data)}
    payload = str(signature_info.get("payload") or "")
    signature = str(signature_info.get("signature") or "")
    key_id = str(signature_info.get("key_id") or "")
    expected_hash = str(signature_info.get("content_hash") or "")
    keys_payload = _get_json("/api/v1/open/platform/keys")
    keys = keys_payload.get("keys") if isinstance(keys_payload.get("keys"), list) else []
    key = next((item for item in keys if isinstance(item, dict) and item.get("key_id") == key_id), None)
    if not key:
        raise SkillHubError("SkillHub 签名公钥不可用，已停止导入")
    try:
        public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(key["public_key_raw_b64"]))
        public_key.verify(base64.b64decode(signature), payload.encode("utf-8"))
    except (InvalidSignature, ValueError, KeyError) as exc:
        raise SkillHubError("SkillHub 数字签名校验失败，已停止导入") from exc
    actual_hash = calculate_content_hash(data)
    if actual_hash != expected_hash:
        raise SkillHubError("SkillHub 技能包内容指纹不匹配，已停止导入")
    try:
        signed_payload = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise SkillHubError("SkillHub 签名载荷无效，已停止导入") from exc
    if signed_payload.get("skill_slug") != slug or signed_payload.get("skill_version") != version:
        raise SkillHubError("SkillHub 签名与所选技能版本不一致，已停止导入")
    return {"verified": True, "status": "verified", "content_hash": actual_hash, "key_id": key_id}


def download_verified_skill(slug: str, version: str | None = None) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    slug = _validate_slug(slug)
    detail = get_skill_detail(slug)
    version = _validate_version(version or detail.get("version"))
    risky = [
        report
        for report in detail.get("security_reports", {}).values()
        if str(report.get("status") or "").lower() in _RISK_STATUSES
    ]
    if risky:
        raise SkillHubError("SkillHub 安全报告提示风险，已停止导入")
    data = _download_zip(slug, version)
    verification = verify_package_signature(slug, version, data)
    return {**detail, "version": version}, data, verification
