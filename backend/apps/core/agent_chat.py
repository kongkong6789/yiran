"""Agent chat orchestration for Liangce AI."""
from __future__ import annotations

from django.conf import settings
from django.db.models import Q

from apps.council import llm
from apps.council import images as image_svc
from apps.council.knowledge import gather_knowledge
from apps.council.graph_knowledge import search_graph
from apps.mcp.client import find_document_url_in_thread, is_document_followup, read_wecom_document
from apps.skills.service import build_skill_system_block, resolve_skills, skills_payload
from apps.skills.runner import (
    diagnose_skill_execution,
    format_script_outputs,
    try_execute_skill_scripts,
)
from .attachments import format_attachment_context, vision_image_parts
from .cancellation import raise_if_cancelled
from pathlib import Path

DOC_SYSTEM_APPEND = """

Current conversation may include enterprise WeCom documents. Follow these rules:
1. Prefer MCP document records and document content over general guesses.
2. If the user asks about an uploaded or linked document, first use the provided document content and cite concrete details.
3. For business metrics such as GMV, sales, inventory, cost, or profit, distinguish document evidence from graph, loop, or SQL-derived data.
"""


SYSTEM_PROMPT = """You are Liangce AI, an assistant for ecommerce and retail operations teams.

You can use retrieved knowledge base snippets, business graph evidence, loop metrics, MCP documents, and skill outputs when they are provided in the prompt. Answer in the user language, prefer Chinese for Chinese questions, and ground factual answers in the supplied context.

Rules:
- Do not claim data is missing when relevant context is present.
- If context is insufficient, say what is missing and suggest a precise next query or data source.
- For product filing, ingredients, claims, sales, inventory, cost, and profit questions, prioritize exact product names, filing numbers, dates, and file evidence.
- Keep answers concise, but include enough evidence for the user to verify the result.
"""


SKILL_EXEC_APPEND = """

If skill execution results are provided, use them as tool evidence. If a skill failed, explain the failure briefly and continue with any available retrieved context.
"""


def _fallback_reply(message: str, knowledge: str, *, llm_error: str = "", configured: bool = False) -> str:
    preview = knowledge[:280] + ("..." if len(knowledge) > 280 else "")
    preview_text = preview or "\u6682\u65e0"
    error_text = llm_error or "unknown error"
    if not configured:
        return (
            f"\u6211\u5df2\u6536\u5230\u4f60\u7684\u95ee\u9898\uff1a{message[:60]}\n\n"
            "\u5f53\u524d\u6ca1\u6709\u914d\u7f6e LLM API Key\uff0c\u65e0\u6cd5\u751f\u6210\u5b8c\u6574\u56de\u7b54\u3002\n\n"
            f"\u5df2\u68c0\u7d22\u5230\u7684\u53c2\u8003\u7247\u6bb5\uff1a\n{preview_text}\n\n"
            "\u8bf7\u5148\u5728\u4e2a\u4eba\u8bbe\u7f6e\u6216\u5168\u5c40 .env \u914d\u7f6e LLM API Key + Base URL + Model\u3002"
        )
    return (
        f"\u6211\u5df2\u6536\u5230\u4f60\u7684\u95ee\u9898\uff1a{message[:60]}\n\n"
        f"\u6a21\u578b\u8c03\u7528\u672a\u6210\u529f\uff1a{error_text}\n\n"
        f"\u5df2\u68c0\u7d22\u5230\u7684\u53c2\u8003\u7247\u6bb5\uff1a\n{preview_text}"
    )


def _mock_reply(message: str, knowledge: str) -> str:
    return _fallback_reply(message, knowledge, configured=False)


def _selected_knowledge_context(
    message: str,
    knowledge_mode: str = "auto",
    knowledge_base_ids: list[int] | None = None,
    user=None,
) -> tuple[str, list[dict]]:
    mode = knowledge_mode if knowledge_mode in {"auto", "none", "selected"} else "auto"
    if mode == "none":
        return "", []
    try:
        from apps.knowledge.models import KnowledgeBase
        from apps.knowledge.traditional_rag import keyword_search, semantic_search
    except Exception:
        return "", []
    if not getattr(user, "is_authenticated", False):
        return "", []
    qs = KnowledgeBase.objects.filter(archived_at__isnull=True).filter(
        Q(visibility__in=[KnowledgeBase.Visibility.TEAM, KnowledgeBase.Visibility.COMPANY])
        | Q(visibility=KnowledgeBase.Visibility.PRIVATE, owner_user_id=user.id)
    )
    ids = [int(item) for item in (knowledge_base_ids or []) if str(item).strip().isdigit()]
    if mode == "selected":
        if not ids:
            return "", []
        qs = qs.filter(id__in=ids)
    bases = list(qs.order_by("-updated_at")[:8])
    if not bases:
        return "", []
    refs: list[dict] = []
    blocks: list[str] = []
    per_base_limit = 3 if mode == "auto" else 4
    for base in bases:
        chunks = []
        keyword_chunks = []
        semantic_chunks = []
        try:
            keyword_chunks = keyword_search(query=message, knowledge_base_id=base.id, limit=per_base_limit)
        except Exception:
            keyword_chunks = []
        try:
            semantic_chunks = semantic_search(query=message, knowledge_base_id=base.id, limit=per_base_limit)
        except Exception:
            semantic_chunks = []
        seen_chunk_ids: set[int] = set()
        for chunk in [*keyword_chunks, *semantic_chunks]:
            if chunk.id in seen_chunk_ids:
                continue
            seen_chunk_ids.add(chunk.id)
            chunks.append(chunk)
        if not chunks:
            continue
        lines = []
        for chunk in chunks[:per_base_limit]:
            preview = (chunk.text_preview or "").strip()
            if not preview:
                continue
            lines.append(f"- chunk_{chunk.chunk_index + 1:03d}: {preview[:700]}")
            refs.append({
                "knowledge_base_id": base.id,
                "knowledge_base_name": base.name,
                "file_id": chunk.file_id,
                "file_name": chunk.file.original_filename if getattr(chunk, "file", None) else "",
                "chunk_id": chunk.id,
                "chunk_index": chunk.chunk_index,
            })
        if lines:
            blocks.append(f"\u3010\u77e5\u8bc6\u5e93:{base.name}\u3011\n" + "\n".join(lines))
        if mode == "auto" and len(refs) >= 6:
            break
    if not blocks and mode == "selected":
        names = "\u3001".join(base.name for base in bases)
        return f"\u3010\u77e5\u8bc6\u5e93\u3011\u5df2\u9009\u62e9: {names}, \u4f46\u6ca1\u6709\u68c0\u7d22\u5230\u76f4\u63a5\u76f8\u5173\u5207\u7247\u3002", refs
    return "\n\n".join(blocks), refs

def run_chat(
    message: str,
    history: list[dict] | None = None,
    user=None,
    skill_ids: list[str] | None = None,
    attachments: list[dict] | None = None,
    model: str | None = None,
    cancel_check=None,
    knowledge_mode: str = "auto",
    knowledge_base_ids: list[int] | None = None,
) -> dict:
    message = (message or "").strip()
    history = history or []
    attachments = attachments or []
    model_override = (model or "").strip() or None
    if not message and not attachments:
        return {"ok": False, "error": "\u8bf7\u8f93\u5165\u6d88\u606f\u6216\u4e0a\u4f20\u9644\u4ef6\u3002"}

    raise_if_cancelled(cancel_check)
    doc_url = find_document_url_in_thread(message, history)
    doc_mode = bool(doc_url) and is_document_followup(message, history, doc_url)
    active_skills = resolve_skills(message, user, skill_ids=skill_ids)
    script_blocks = (
        try_execute_skill_scripts(
            active_skills,
            message,
            user,
            history=history,
            cancel_check=cancel_check,
        )
        if active_skills else []
    )
    raise_if_cancelled(cancel_check)
    script_output = format_script_outputs(script_blocks)
    skill_diag = diagnose_skill_execution(active_skills, message, script_blocks)

    knowledge = ""
    graph: dict = {"refs": []}
    if not doc_mode:
        knowledge = gather_knowledge(message, top_k=4)
        raise_if_cancelled(cancel_check)
        graph = search_graph(message, top_k=4, max_edges=6)
        raise_if_cancelled(cancel_check)
    selected_knowledge, selected_knowledge_refs = _selected_knowledge_context(message, knowledge_mode, knowledge_base_ids, user=user)

    mcp = (
        read_wecom_document(
            message,
            document_url=doc_url,
            user=user,
            cancel_check=cancel_check,
        )
        if doc_url
        else read_wecom_document(message, user=user, cancel_check=cancel_check)
    )
    raise_if_cancelled(cancel_check)
    refs = {
        "rag": [],
        "knowledge_bases": selected_knowledge_refs,
        "graph": graph.get("refs") or [],
        "mcp": (
            [{"server": "wecom", "tool": mcp.get("tool"), "source": mcp.get("source")}]
            if mcp.get("content")
            else []
        ),
        "skills": skills_payload(active_skills),
        "skill_scripts": script_blocks,
        "attachments": [
            {
                "id": a.get("id"),
                "name": a.get("name"),
                "size": a.get("size"),
                "has_text": a.get("has_text"),
                "is_image": bool(a.get("is_image")),
                "url": a.get("url") or "",
            }
            for a in attachments
        ],
    }

    reference_blocks: list[str] = []
    attach_ctx = format_attachment_context(attachments)
    if attach_ctx:
        reference_blocks.append(attach_ctx)
    if script_output:
        reference_blocks.append(script_output)
    elif skill_diag:
        reference_blocks.append(f"[Skill diagnostic]\n{skill_diag}")
    if selected_knowledge:
        reference_blocks.append(selected_knowledge)
    if knowledge:
        reference_blocks.append(knowledge)
    if mcp.get("content"):
        reference_blocks.append(f"[MCP document: {mcp.get('source')}]\n{mcp['content']}")
    elif mcp.get("attempted") and mcp.get("error"):
        reference_blocks.append(f"[MCP document unavailable]\n{mcp['error']}")

    user_block = message or "(no text message)"
    if reference_blocks:
        reference_text = "\n\n".join(reference_blocks)
        user_block = f"Reference material:\n{reference_text}\n\nUser question:\n{user_block}"


    clean_history = [
        {"role": item["role"], "content": str(item["content"])}
        for item in history[-30:]
        if isinstance(item, dict)
        and item.get("role") in {"user", "assistant"}
        and item.get("content")
    ]
    image_parts = vision_image_parts(attachments)
    has_image = bool(image_parts)
    image_intent = image_svc.detect_image_intent(message, has_image)
    # Force image API flow when an image-generation model is selected.
    if model_override and image_svc.is_image_gen_model(model_override):
        image_intent = "edit" if has_image else "generate"
    image_blocks: list[str] = []
    generated_images: list[dict] = []

    # Image generation and editing use the dedicated images API.
    raise_if_cancelled(cancel_check)
    if image_intent == "generate" and image_svc.image_api_available() and user is not None:
        prompt = image_svc.extract_generation_prompt(message)
        gen = image_svc.generate_image_with_fallback(
            prompt,
            user_id=user.id,
            preferred=model_override if image_svc.is_image_gen_model(model_override) else None,
        )
        image_blocks.append(image_svc.format_image_results("Generated images", gen))
        if gen.get("ok"):
            generated_images.extend(gen.get("images") or [])
            if gen.get("model"):
                model_override = model_override or gen["model"]
    elif image_intent == "edit" and image_svc.image_api_available() and user is not None:
        src = next((a for a in attachments if a.get("is_image")), None)
        if not src:
            image_blocks.append("Image editing needs an uploaded image.")
        else:
            raw = b""
            stored = Path(src.get("stored_path") or "")
            if stored.is_file():
                raw = stored.read_bytes()
            elif src.get("image_base64"):
                import base64
                raw = base64.b64decode(src["image_base64"])
            if not raw:
                image_blocks.append("Unable to read the uploaded image bytes.")
            else:
                preferred = model_override if image_svc.is_image_gen_model(model_override) else None
                edited = image_svc.edit_image_with_fallback(
                    message or "edit this image",
                    user_id=user.id,
                    image_bytes=raw,
                    filename=src.get("name") or "image.png",
                    preferred=preferred,
                )
                title = "Image edit fallback results" if edited.get("fallback_from_edit") else "Image edit results"
                image_blocks.append(image_svc.format_image_results(title, edited))
                if edited.get("ok"):
                    generated_images.extend(edited.get("images") or [])
                    if edited.get("model"):
                        model_override = model_override or edited["model"]
    raise_if_cancelled(cancel_check)

    if image_parts:
        user_content: str | list = [
            {"type": "text", "text": user_block},
            *image_parts,
        ]
    else:
        user_content = user_block
    messages = [*clean_history, {"role": "user", "content": user_content}]

    system = (
        SYSTEM_PROMPT
        + (DOC_SYSTEM_APPEND if doc_mode else "")
        + (SKILL_EXEC_APPEND if active_skills else "")
        + build_skill_system_block(active_skills)
    )
    if image_parts and image_intent == "analyze":
        system += "\n\nAnalyze the attached image carefully and answer only from visible image evidence unless reference material is provided."
    wants_table = doc_mode and any(k in message for k in ("\u8868\u683c", "\u8868", "\u5bf9\u6bd4", "\u6e05\u5355", "table"))
    has_script_data = any(b.get("ok") and b.get("stdout") for b in script_blocks)
    max_tokens = 3500 if has_script_data else (2500 if wants_table and mcp.get("content") else 900)
    if image_parts:
        max_tokens = max(max_tokens, 1200)

    skip_llm = image_intent in ("generate", "edit") and (
        bool(generated_images)
        or (bool(model_override) and image_svc.is_image_gen_model(model_override))
    )
    llm_result: dict = {
        "content": "", "error": "", "configured": True,
        "model": "", "vision_unsupported": False,
    }
    if not skip_llm:
        # Chat and vision analysis use chat completions; image generation uses images API.
        chat_kwargs: dict = {
            "max_tokens": max_tokens,
            "temperature": 0.4 if doc_mode else 0.6,
            "llm_user": user,
            "timeout": 90,
        }
        if cancel_check:
            chat_kwargs["cancel_check"] = cancel_check
        tried_models: list[str] = []
        if image_parts:
            # If the personal model is text-only, use global vision-capable configuration for image input.
            personal_model = llm.personal_llm_model(user)
            effective_personal = model_override or personal_model
            if llm.looks_non_vision_model(effective_personal) and (settings.LLM_API_KEY or "").strip():
                chat_kwargs["api_key"] = settings.LLM_API_KEY.strip()
                chat_kwargs["base_url"] = (settings.LLM_BASE_URL or "").strip()
                chat_kwargs.pop("llm_user", None)

            candidates = llm.vision_model_candidates(user)
            if model_override and not llm.looks_non_vision_model(model_override):
                candidates = [model_override] + [c for c in candidates if c != model_override]

            llm_result = {"content": "", "error": "", "configured": True, "model": "", "vision_unsupported": False}
            for model_name in candidates:
                tried_models.append(model_name)
                attempt = llm.chat_messages_result(
                    system, messages, **{**chat_kwargs, "model": model_name},
                )
                llm_result = attempt
                if attempt.get("content"):
                    break
                # Try another vision model only when image input is unsupported or the model is unavailable.
                err = attempt.get("error") or ""
                if not (
                    attempt.get("vision_unsupported")
                    or "404" in err
                    or "model" in err.lower() and ("not" in err.lower() or "invalid" in err.lower())
                ):
                    break
        else:
            if model_override:
                chat_kwargs["model"] = model_override
            llm_result = llm.chat_messages_result(system, messages, **chat_kwargs)
        raise_if_cancelled(cancel_check)

    reply = llm_result.get("content") or ""
    llm_error = llm_result.get("error") or ""
    llm_configured = bool(llm_result.get("configured"))
    used_model = llm_result.get("model") or ""
    if not used_model and model_override:
        used_model = model_override
    if image_intent in ("generate", "edit") and generated_images and model_override:
        used_model = model_override

    if image_blocks:
        if skip_llm or not reply:
            reply = "\n\n".join(image_blocks)
        else:
            reply = "\n\n".join(image_blocks) + "\n\n" + reply

    if not reply and image_parts and llm_result.get("vision_unsupported"):
        personal_model = llm.personal_llm_model(user)
        tried = ", ".join(f"`{m}`" for m in tried_models) or f"`{used_model}`"
        model_hint = f" Current personal model `{personal_model}` appears not to support image input." if personal_model and llm.looks_non_vision_model(personal_model) else ""
        reply = (
            "The current model does not support image input, so I could not analyze the uploaded image. "
            f"Tried model(s): {tried}."
            + model_hint
            + " Please switch to a vision-capable chat model or remove the image and ask with text only."
        )
    elif not reply:
        reply = _fallback_reply(
            message,
            "\n\n".join(reference_blocks) or knowledge,
            llm_error=llm_error,
            configured=llm_configured,
        )

    raise_if_cancelled(cancel_check)
    return {
        "ok": True,
        "reply": reply,
        "llm": llm.llm_available(user),
        "llm_error": llm_error,
        "llm_model": used_model or llm_result.get("model") or "",
        "knowledge_hit": bool(selected_knowledge or knowledge or mcp.get("content") or attachments or generated_images),
        "doc_context": bool(doc_mode),
        "image_intent": image_intent,
        "generated_images": generated_images,
        "mcp": {
            "attempted": bool(mcp.get("attempted")),
            "ok": bool(mcp.get("content")),
            "error": mcp.get("error") or "",
            "tool": mcp.get("tool") or "",
            "source": mcp.get("source") or doc_url,
        },
        "refs": refs,
        "skills": skills_payload(active_skills),
        "skill_scripts": script_blocks,
        "attachments": [
            {
                "id": a.get("id"),
                "name": a.get("name"),
                "size": a.get("size"),
                "mime": a.get("mime"),
                "has_text": a.get("has_text"),
                "is_image": bool(a.get("is_image")),
                "url": a.get("url") or "",
            }
            for a in attachments
        ],
    }
