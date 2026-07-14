"""本地 Agent 对话。"""
from __future__ import annotations

import re

from ..storage import UserStore
from .llm import chat_messages, llm_available
from .mcp_client import read_wecom_document
from .mcp_registry import get_def, resolve_config

DOC_URL_RE = re.compile(r"https?://doc\.weixin\.qq\.com/[^\s<>\"]+")

SYSTEM_PROMPT = """你是「良策 AI」本地对话助手。
可基于用户本机配置的 MCP（如企业微信文档）读取资料后回答。
回答简洁、可执行、中文；有依据时引用；不确定时说明需补充信息。"""

DOC_SYSTEM_APPEND = """
当前对话围绕企业微信文档。只使用【企业微信 MCP 文档】数据回答；
用户要「原始数据/表格」时,将 records 格式化为 Markdown 表格,不要用其他业务指标。"""


def _find_doc_url(message: str, history: list[dict]) -> str:
    m = DOC_URL_RE.search(message)
    if m:
        return m.group(0).rstrip("。），,)]")
    for item in reversed(history):
        if item.get("role") != "user":
            continue
        m = DOC_URL_RE.search(str(item.get("content") or ""))
        if m:
            return m.group(0).rstrip("。），,)]")
    return ""


def _mock_reply(message: str, refs: str) -> str:
    preview = refs[:280] + ("…" if len(refs) > 280 else "")
    return (
        f"收到:「{message[:60]}」。\n\n"
        "当前未配置 LLM API Key,处于演示模式。参考资料:\n"
        f"{preview or '(暂无)'}\n\n"
        "请在「设置」中填写 LLM Key,或编辑本机 config.env。"
    )


def run_chat(store: UserStore, message: str, history: list[dict] | None = None) -> dict:
    message = (message or "").strip()
    history = history or []
    if not message:
        return {"ok": False, "error": "消息不能为空"}

    doc_url = _find_doc_url(message, history)
    doc_mode = bool(doc_url)

    wecom_cfg = resolve_config(store, get_def("wecom")) if get_def("wecom") else {}
    mcp = read_wecom_document(
        message,
        wecom_cfg.get("url", ""),
        document_url=doc_url or None,
    ) if doc_url or DOC_URL_RE.search(message) else read_wecom_document(message, wecom_cfg.get("url", ""))

    reference_blocks: list[str] = []
    if mcp.get("content"):
        reference_blocks.append(
            f"【企业微信 MCP 文档】\n来源:{mcp.get('source')}\n{mcp['content']}"
        )
    elif mcp.get("attempted") and mcp.get("error"):
        reference_blocks.append(f"【企业微信 MCP 状态】读取失败:{mcp['error']}")

    user_block = message
    if reference_blocks:
        user_block = f"参考资料:\n{'\n\n'.join(reference_blocks)}\n\n用户问题:{message}"

    clean_history = [
        {"role": item["role"], "content": str(item["content"])}
        for item in history[-30:]
        if item.get("role") in {"user", "assistant"} and item.get("content")
    ]
    messages = [*clean_history, {"role": "user", "content": user_block}]
    system = SYSTEM_PROMPT + (DOC_SYSTEM_APPEND if doc_mode else "")
    wants_table = doc_mode and any(k in message for k in ("原始", "表格", "导出", "展示"))
    reply = chat_messages(
        system, messages, user_store=store,
        max_tokens=2500 if wants_table else 900,
        temperature=0.4 if doc_mode else 0.7,
    )
    if not reply:
        reply = _mock_reply(message, "\n\n".join(reference_blocks))

    return {
        "ok": True,
        "reply": reply,
        "llm": llm_available(store),
        "knowledge_hit": bool(mcp.get("content")),
        "doc_context": doc_mode,
        "mcp": {
            "attempted": bool(mcp.get("attempted")),
            "ok": bool(mcp.get("content")),
            "error": mcp.get("error") or "",
            "tool": mcp.get("tool") or "",
            "source": mcp.get("source") or doc_url,
        },
        "refs": {"mcp": [{"server": "wecom", "tool": mcp.get("tool"), "source": mcp.get("source")}] if mcp.get("content") else []},
    }
