"""上下文组装：记忆 + 参考材料 + 历史。"""
from __future__ import annotations

from dataclasses import dataclass, field

from .memory import MemoryBundle, load_memory


@dataclass
class AgentContextPack:
    reference_text: str
    reference_blocks: list[str]
    memory_block: str
    summary_block: str
    clean_history: list[dict]
    user_block: str
    memory: MemoryBundle = field(default_factory=lambda: MemoryBundle("", "", [], None))


def clean_chat_history(history: list[dict] | None, *, limit: int = 30) -> list[dict]:
    history = history or []
    return [
        {"role": item["role"], "content": str(item["content"])}
        for item in history[-limit:]
        if isinstance(item, dict)
        and item.get("role") in {"user", "assistant"}
        and item.get("content")
    ]


def assemble_context(
    *,
    message: str,
    history: list[dict] | None = None,
    user=None,
    session_key: str | None = None,
    reference_blocks: list[str] | None = None,
    history_limit: int = 30,
) -> AgentContextPack:
    """把记忆与参考块拼成最终 user_block。"""
    reference_blocks = list(reference_blocks or [])
    memory = load_memory(user, session_key)
    blocks: list[str] = []
    if memory.memory_block:
        blocks.append(memory.memory_block)
    if memory.summary_block:
        blocks.append(memory.summary_block)
    blocks.extend(reference_blocks)

    user_text = (message or "").strip() or "(no text message)"
    if blocks:
        reference_text = "\n\n".join(blocks)
        user_block = f"Reference material:\n{reference_text}\n\nUser question:\n{user_text}"
    else:
        reference_text = ""
        user_block = user_text

    return AgentContextPack(
        reference_text=reference_text,
        reference_blocks=blocks,
        memory_block=memory.memory_block,
        summary_block=memory.summary_block,
        clean_history=clean_chat_history(history, limit=history_limit),
        user_block=user_block,
        memory=memory,
    )


def build_debug_pack(user, query: str = "", session_key: str | None = None) -> dict:
    """管理页只读调试包。"""
    memory = load_memory(user, session_key)
    return {
        "query": query or "",
        "session_key": session_key or "",
        "memory_block": memory.memory_block,
        "summary_block": memory.summary_block,
        "items": [
            {
                "id": i.id,
                "scope": i.scope,
                "kind": i.kind,
                "content": i.content,
                "importance": i.importance,
                "source": i.source,
                "updated_at": i.updated_at.isoformat() if i.updated_at else None,
            }
            for i in memory.items
        ],
        "summary": (
            {
                "session_key": memory.summary.session_key,
                "summary": memory.summary.summary,
                "message_count": memory.summary.message_count,
                "updated_at": memory.summary.updated_at.isoformat()
                if memory.summary.updated_at
                else None,
            }
            if memory.summary
            else None
        ),
    }
