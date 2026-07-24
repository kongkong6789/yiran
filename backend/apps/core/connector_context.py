"""Trusted, read-only connector execution for Agent and Hermes conversations."""
from __future__ import annotations

from typing import Any

from apps.council.jackyun_planner import jackyun_block, should_query_jackyun
from apps.connectors.credentials import use_connector_secrets
from apps.connectors.kingdee import kingdee_block
from apps.mcp.client import find_document_url_in_thread, read_wecom_document
from apps.mcp.nas_files import read_nas_for_agent
from apps.mcp.registry import get_def, resolve_config

from .cancellation import raise_if_cancelled


CONNECTOR_IDS = frozenset({"wecom", "nas", "jackyun", "kingdee"})
_FAILURE_TERMS = ("失败", "异常", "未配置", "尚未", "停用", "未执行")
_KINGDEE_TERMS = (
    "金蝶",
    "kingdee",
    "k3cloud",
    "k3",
    "凭证",
    "应收",
    "应付",
    "总账",
    "科目",
    "账套",
    "财务对账",
    "余额表",
)


def normalize_connector_ids(values: Any) -> list[str]:
    """Return a stable allow-listed connector selection."""
    if isinstance(values, str):
        values = [values]
    if not isinstance(values, (list, tuple, set)):
        return []
    result: list[str] = []
    for value in values:
        normalized = str(value or "").strip().casefold()
        if normalized in CONNECTOR_IDS and normalized not in result:
            result.append(normalized)
    return result


def _nas_source_files(files: list[dict]) -> list[dict]:
    return [
        {
            "path": str(item.get("stored_path") or item.get("native_path") or ""),
            "name": str(item.get("name") or "NAS 文件"),
            "text": str(item.get("text") or ""),
            "source_id": f"nas-{index}",
        }
        for index, item in enumerate(files, 1)
        if item.get("stored_path") or item.get("native_path")
    ]


def _native_connector_status(server_id: str, user) -> tuple[bool, str]:
    """Honor the organization-level enabled switch before loading secrets."""
    if user is None or not getattr(user, "is_authenticated", False):
        return True, ""
    definition = get_def(server_id)
    if definition is None:
        return False, "连接器未注册"
    config = resolve_config(definition, user=user)
    if not config.get("enabled", True):
        return False, "当前企业已停用此连接器"
    if not config.get("configured"):
        return False, "当前企业尚未完成连接器配置"
    return True, ""


def collect_connector_context(
    message: str,
    *,
    user=None,
    history: list[dict] | None = None,
    connector_ids: list[str] | None = None,
    cancel_check=None,
    wecom_reader=None,
    nas_reader=None,
) -> dict[str, Any]:
    """Execute selected or clearly inferred read-only connectors.

    External write actions remain in audited Skills. This function only gathers
    evidence that can safely be passed into Hermes or the legacy LLM composer.
    """
    text = str(message or "")
    history = history or []
    selected = normalize_connector_ids(connector_ids)
    blocks: list[str] = []
    refs: list[dict[str, Any]] = []
    source_files: list[dict] = []
    attempted_count = 0
    wecom_reader = wecom_reader or read_wecom_document
    nas_reader = nas_reader or read_nas_for_agent

    document_url = find_document_url_in_thread(text, history)
    should_read_wecom = bool(document_url or "wecom" in selected)
    wecom = {"attempted": False, "content": "", "error": ""}
    if should_read_wecom:
        raise_if_cancelled(cancel_check)
        wecom = wecom_reader(
            text,
            document_url=document_url,
            user=user,
            cancel_check=cancel_check,
        )
        if wecom.get("attempted"):
            attempted_count += 1
            refs.append({
                "server": "wecom",
                "tool": wecom.get("tool") or "read_doc",
                "source": wecom.get("source") or document_url or "",
                "ok": bool(wecom.get("content")),
                "error": wecom.get("error") or "",
            })
        if wecom.get("content"):
            blocks.append(
                f"【企业微信文档 · {wecom.get('source') or document_url}】\n"
                f"{wecom['content']}"
            )
        elif wecom.get("attempted") and wecom.get("error"):
            blocks.append(
                "【企业微信连接器状态】读取失败："
                f"{wecom['error']}。请如实说明，不要声称已经读取文档。"
            )
        elif "wecom" in selected and not document_url:
            blocks.append("【企业微信连接器】已选择，但本轮没有提供可读取的企业微信文档链接。")

    raise_if_cancelled(cancel_check)
    try:
        nas = nas_reader(user, text) if user is not None else {
            "attempted": False,
            "content": "",
            "files": [],
            "error": "",
        }
    except Exception as exc:
        nas = {
            "attempted": "nas" in selected,
            "content": "",
            "files": [],
            "error": str(exc) if "nas" in selected else "",
        }
    if nas.get("attempted"):
        attempted_count += 1
        refs.append({
            "server": "nas",
            "tool": "read_path",
            "source": "",
            "ok": bool(nas.get("content") or nas.get("files")),
            "error": nas.get("error") or "",
        })
    if nas.get("content"):
        blocks.append(f"【NAS 文件库】\n{nas['content']}")
    if nas.get("error"):
        blocks.append(
            "【NAS 文件库状态】读取失败："
            f"{nas['error']}。请明确告诉用户错误与需要补充的完整路径。"
        )
    elif "nas" in selected and not nas.get("attempted"):
        blocks.append("【NAS 文件库状态】当前企业未配置可用的 NAS 路径，或连接器尚未启用。")
    nas_files = list(nas.get("files") or [])
    source_files.extend(_nas_source_files(nas_files))

    should_jackyun = "jackyun" in selected or should_query_jackyun(text)
    if should_jackyun:
        raise_if_cancelled(cancel_check)
        attempted_count += 1
        allowed, status_detail = _native_connector_status("jackyun", user)
        if not allowed:
            block = f"【吉客云】{status_detail}，未执行实时查询。"
        else:
            try:
                with use_connector_secrets("jackyun", user=user):
                    block = jackyun_block(text, llm_user=user)
            except Exception as exc:
                block = f"【吉客云】只读查询异常：{exc}"
        block = block or "【吉客云】未能识别本轮要查询的商品、库存、仓库或订单条件。"
        blocks.append(block)
        refs.append({
            "server": "jackyun",
            "tool": "read_query",
            "source": "organization_config",
            "ok": not any(term in block for term in _FAILURE_TERMS),
            "error": block if any(term in block for term in _FAILURE_TERMS) else "",
        })

    lowered = text.casefold()
    should_kingdee = "kingdee" in selected or any(term.casefold() in lowered for term in _KINGDEE_TERMS)
    if should_kingdee:
        raise_if_cancelled(cancel_check)
        attempted_count += 1
        allowed, status_detail = _native_connector_status("kingdee", user)
        if not allowed:
            block = f"【金蝶】{status_detail}，未执行实时查询。"
        else:
            try:
                with use_connector_secrets("kingdee", user=user):
                    block = kingdee_block(text)
            except Exception as exc:
                block = f"【金蝶】只读连接异常：{exc}"
        block = block or "【金蝶】未能识别本轮财务查询条件。"
        blocks.append(block)
        refs.append({
            "server": "kingdee",
            "tool": "read_query",
            "source": "organization_config",
            "ok": not any(term in block for term in _FAILURE_TERMS),
            "error": block if any(term in block for term in _FAILURE_TERMS) else "",
        })

    return {
        "blocks": blocks,
        "refs": refs,
        "source_files": source_files,
        "attempted_count": attempted_count,
        "selected": selected,
        "wecom": wecom,
        "nas": nas,
        "nas_files": nas_files,
        "document_url": document_url or "",
    }
