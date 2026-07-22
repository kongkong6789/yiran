"""LLM-backed Chinese/English translation for collaboration messages."""
from __future__ import annotations

import json
import re
from typing import Any

from apps.council import llm


class TranslationConfigurationError(RuntimeError):
    pass


class TranslationLLMError(RuntimeError):
    pass


_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z]")


def target_language(text: str) -> str:
    """Chinese-containing text goes to English; other Latin text goes to Chinese."""
    return "en" if _CJK_RE.search(text or "") else "zh-CN"


def is_translatable(text: str) -> bool:
    value = text or ""
    return bool(_CJK_RE.search(value) or _LATIN_RE.search(value))


def _extract_payload(raw: str) -> list[dict[str, Any]]:
    value = (raw or "").strip()
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.I)
    value = re.sub(r"\s*```$", "", value)
    decoder = json.JSONDecoder()
    parsed: Any = None
    for token in ("[", "{"):
        start = value.find(token)
        if start < 0:
            continue
        try:
            parsed, _ = decoder.raw_decode(value[start:])
            break
        except json.JSONDecodeError:
            continue
    if isinstance(parsed, dict):
        parsed = parsed.get("translations")
    if not isinstance(parsed, list):
        raise TranslationLLMError("LLM 翻译结果格式无效，请重试")
    return [item for item in parsed if isinstance(item, dict)]


def translate_message_batch(
    entries: list[dict[str, Any]],
    *,
    user,
) -> tuple[list[dict[str, Any]], str]:
    prepared = []
    for entry in entries:
        text = str(entry.get("text") or "").strip()[:4000]
        if not text or not is_translatable(text):
            continue
        prepared.append({
            "message_id": int(entry["message_id"]),
            "text": text,
            "source_language": "zh" if target_language(text) == "en" else "en",
            "target_language": target_language(text),
        })
    if not prepared:
        return [], ""

    system = (
        "You are a precise enterprise chat translation engine. Translate every JSON item "
        "to its target_language. Preserve names, @mentions, URLs, code, Markdown structure, "
        "numbers, dates, and product terminology. Do not summarize or add explanations. "
        "Return only a JSON array. Each item must contain message_id, source_language, "
        "target_language, and translated_text."
    )
    result = llm.chat_messages_result(
        system,
        [{"role": "user", "content": json.dumps(prepared, ensure_ascii=False)}],
        temperature=0.1,
        max_tokens=min(6000, max(800, len(prepared) * 360)),
        model=llm.fast_model(user),
        timeout=60,
        llm_user=user,
        allow_images=False,
    )
    if not result.get("configured"):
        raise TranslationConfigurationError("未配置可用的 LLM，请先在个人设置中配置模型")
    raw = str(result.get("content") or "").strip()
    if not raw:
        raise TranslationLLMError(f"LLM 翻译失败：{result.get('error') or '模型未返回内容'}")

    expected = {item["message_id"]: item for item in prepared}
    translated: dict[int, dict[str, Any]] = {}
    for item in _extract_payload(raw):
        try:
            message_id = int(item.get("message_id"))
        except (TypeError, ValueError):
            continue
        source = expected.get(message_id)
        text = str(item.get("translated_text") or "").strip()
        if source is None or not text:
            continue
        translated[message_id] = {
            "message_id": message_id,
            "source_language": str(item.get("source_language") or source["source_language"]),
            "target_language": str(item.get("target_language") or source["target_language"]),
            "translated_text": text,
        }
    if len(translated) != len(prepared):
        raise TranslationLLMError("LLM 未完整返回全部消息的翻译，请重试")
    return [translated[item["message_id"]] for item in prepared], str(result.get("model") or "")
