"""Conversation harness: progress wrap, risk gate, context/token budget."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Callable

from django.core.exceptions import ValidationError

from .progress import emit_progress

HARNESS_SYSTEM_APPEND = """

Harness constraints:
- Prefer concise, evidence-grounded answers; do not invent missing numbers.
- When reference material is truncated, say what is incomplete instead of guessing.
- Stay within the user's ask; avoid dumping unrelated context.
"""

# Rough chars-per-token heuristic for CJK-heavy prompts.
_CHARS_PER_TOKEN = 2.2
_DEFAULT_REF_CHAR_BUDGET = 48_000
_DEFAULT_SOFT_TURN_TOKEN_BUDGET = 12_000
_DEFAULT_HISTORY_LIMIT = 30
_MAX_MESSAGE_CHARS = 20_000

_RISKY_PATTERNS = (
    re.compile(r"(?i)ignore\s+(all\s+)?(previous|prior|above)\s+instructions"),
    re.compile(r"(?i)disregard\s+(the\s+)?system\s+prompt"),
    re.compile(r"忽略(以上|之前|前面)?(所有)?(指令|提示|规则)"),
    re.compile(r"无视(系统|开发者)?(提示|指令)"),
)


@dataclass
class HarnessConfig:
    history_limit: int = _DEFAULT_HISTORY_LIMIT
    soft_turn_token_budget: int = _DEFAULT_SOFT_TURN_TOKEN_BUDGET
    reference_char_budget: int = _DEFAULT_REF_CHAR_BUDGET
    max_message_chars: int = _MAX_MESSAGE_CHARS


@dataclass
class ConversationHarness:
    """Lightweight turn harness around agent chat orchestration."""

    progress_callback: Callable[..., Any] | None = None
    config: HarnessConfig = field(default_factory=HarnessConfig)
    _risk_flags: list[str] = field(default_factory=list, init=False, repr=False)
    _trimmed_refs: int = field(default=0, init=False, repr=False)
    _last_budget: dict[str, Any] = field(default_factory=dict, init=False, repr=False)

    def emit_progress(self, code: str, status: str, data: dict | None = None, **extra) -> None:
        payload = dict(data or {})
        payload.update(extra)
        emit_progress(self.progress_callback, code, status, **payload)

    def assess_message_risk(self, message: str) -> None:
        text = (message or "").strip()
        if len(text) > self.config.max_message_chars:
            raise ValidationError("消息过长，请缩短后再试。")
        flags: list[str] = []
        for pattern in _RISKY_PATTERNS:
            if pattern.search(text):
                flags.append("prompt_injection_heuristic")
                break
        self._risk_flags = flags
        # Soft flag only — do not hard-block normal product usage.

    def trim_reference_blocks(self, blocks: list[str] | None) -> list[str]:
        items = [str(b) for b in (blocks or []) if str(b).strip()]
        budget = self.config.reference_char_budget
        kept: list[str] = []
        used = 0
        trimmed = 0
        for block in items:
            remaining = budget - used
            if remaining <= 0:
                trimmed += 1
                continue
            if len(block) <= remaining:
                kept.append(block)
                used += len(block)
            else:
                kept.append(block[: max(0, remaining - 80)] + "\n…[reference truncated by harness]")
                used = budget
                trimmed += 1
        self._trimmed_refs = trimmed
        return kept

    @staticmethod
    def estimate_tokens(text: str) -> int:
        if not text:
            return 0
        return max(1, int(len(text) / _CHARS_PER_TOKEN))

    def _estimate_messages_tokens(self, messages: list[dict] | None) -> int:
        total = 0
        for item in messages or []:
            content = item.get("content") if isinstance(item, dict) else ""
            if isinstance(content, list):
                parts = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        parts.append(str(part.get("text") or ""))
                    else:
                        parts.append(str(part))
                total += self.estimate_tokens("\n".join(parts))
            else:
                total += self.estimate_tokens(str(content or ""))
        return total

    def finalize_budget(
        self,
        *,
        messages: list[dict] | None = None,
        max_output_tokens: int = 900,
    ) -> dict[str, Any]:
        prompt_tokens = self._estimate_messages_tokens(messages)
        soft = self.config.soft_turn_token_budget
        projected = prompt_tokens + max(0, int(max_output_tokens or 0))
        report = {
            "prompt_tokens_estimated": prompt_tokens,
            "max_output_tokens": int(max_output_tokens or 0),
            "soft_turn_token_budget": soft,
            "projected_tokens": projected,
            "over_soft_budget": projected > soft,
            "trimmed_reference_blocks": self._trimmed_refs,
            "risk_flags": list(self._risk_flags),
        }
        self._last_budget = report
        return report

    def metadata(self) -> dict[str, Any]:
        return {
            "config": asdict(self.config),
            "risk_flags": list(self._risk_flags),
            "trimmed_reference_blocks": self._trimmed_refs,
            "budget": dict(self._last_budget),
        }
