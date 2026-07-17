"""对话 Agent:汇聚知识后单轮/多轮回复。"""
from __future__ import annotations

from django.conf import settings

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

当前对话围绕企业微信文档进行。务必遵守:
1. 只使用【企业微信 MCP 文档】中的 records/字段回答,不要使用其他来源的业务指标。
2. 用户追问「原始数据/表格展示/导出」时,将文档 records 格式化为 Markdown 表格,列名取字段标题。
3. 若参考资料中已有文档数据,不要切换到 GMV/退款率等无关指标。"""


SYSTEM_PROMPT = """你是「良策 AI」对话助手,面向电商/零售运营团队。

你可以基于平台注入的参考资料(制度/SOP、业务指标、异常预警、本体图谱、企业微信文档)回答问题,
并引导用户使用平台能力:
- 圆桌会议:多 Agent 围绕复杂问题会诊
- Agent 控制台:自然语言触发 SOP(采购/改价/日报/吉客云同步)
- 本体图谱 / Loops:因果链路与回路分析
- MCP 接入:企业微信、腾讯文档、金蝶、吉客云等
- Skill:用户可上传 SKILL.md 完整 zip 包(含 scripts/),对话中用 @skill-id 调用;平台会自动执行 Skill 中的 python 脚本
- 文生图/图生图:用户说「画一张…」走文生图;上传图片并说「改成…」走图生图

回答要求:简洁、可执行、中文;有数据或制度依据时引用;不确定时说明需补充的信息。
不要编造未出现在参考资料中的具体数字。"""

SKILL_EXEC_APPEND = """

Skill 脚本执行规则(必须遵守):
1. 若用户消息旁已注入【Skill 脚本执行结果】,表示平台已在后端执行过 python 脚本,禁止再让用户「自己去终端运行」相同命令。
2. 执行成功时,直接根据 stdout / json 文件内容写分析报告(结论→原因→举例→建议)。
3. 执行失败时,说明 stderr 中的错误(缺依赖、API Key、网络等)及修复方式,不要假装已拿到数据。
4. 若仅有【Skill 执行状态】未执行成功,按其中原因引导用户(重传 zip、补品牌名等),不要重复 Skill 原文里的手工步骤清单。
"""


def _fallback_reply(message: str, knowledge: str, *, llm_error: str = "", configured: bool = False) -> str:
    preview = knowledge[:280] + ("…" if len(knowledge) > 280 else "")
    if not configured:
        return (
            f"收到:「{message[:60]}」。\n\n"
            "当前未配置个人 LLM API Key,处于演示模式。\n"
            f"已检索到资料片段:\n{preview or '(暂无命中资料)'}\n\n"
            "请到右上角「个人设置」填写 **LLM API Key + Base URL + Model** 后重试;"
            "只填模型名不够,必须同时有可用的 API Key。"
        )
    return (
        f"收到:「{message[:60]}」。\n\n"
        "已配置 API Key,但本次模型调用失败,未能生成正式回答。\n\n"
        f"**错误信息:**\n```\n{llm_error or '未知错误'}\n```\n\n"
        "常见原因:\n"
        "1. Base URL / Model 不正确(需 OpenAI 兼容的 `/v1/chat/completions`)\n"
        "2. 模型不支持看图,却上传了图片(请换 gpt-4o / qwen-vl 等视觉模型)\n"
        "3. Key 无效、欠费或网络不通\n"
        "4. HTTP 403 / error 1010:密钥与接口不匹配"
        "(生图 Key 只能打 `/images/*`,识图请用模型 Key)\n\n"
        f"已检索资料片段:\n{preview or '(暂无)'}"
    )


def _mock_reply(message: str, knowledge: str) -> str:
    return _fallback_reply(message, knowledge, configured=False)


def run_chat(
    message: str,
    history: list[dict] | None = None,
    user=None,
    skill_ids: list[str] | None = None,
    attachments: list[dict] | None = None,
    model: str | None = None,
    cancel_check=None,
) -> dict:
    message = (message or "").strip()
    history = history or []
    attachments = attachments or []
    model_override = (model or "").strip() or None
    if not message and not attachments:
        return {"ok": False, "error": "消息不能为空"}

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
        reference_blocks.append(f"【Skill 执行状态】\n{skill_diag}")
    if knowledge:
        reference_blocks.append(knowledge)
    if mcp.get("content"):
        reference_blocks.append(
            f"【企业微信 MCP 文档】\n来源:{mcp.get('source')}\n{mcp['content']}"
        )
    elif mcp.get("attempted") and mcp.get("error"):
        reference_blocks.append(
            f"【企业微信 MCP 状态】读取失败:{mcp['error']}。"
            "请明确告诉用户此错误及修复方向,不要假装已经读取文档。"
        )

    user_block = message or "(用户仅上传了附件,请结合附件内容回答)"
    if reference_blocks:
        reference_text = "\n\n".join(reference_blocks)
        user_block = f"参考资料:\n{reference_text}\n\n用户问题:{user_block}"

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
    # 下拉选了生图模型时,强制走 images API
    if model_override and image_svc.is_image_gen_model(model_override):
        image_intent = "edit" if has_image else "generate"
    image_blocks: list[str] = []
    generated_images: list[dict] = []

    # 文生图 / 图生图:走独立 images API + 生图密钥
    raise_if_cancelled(cancel_check)
    if image_intent == "generate" and image_svc.image_api_available() and user is not None:
        prompt = image_svc.extract_generation_prompt(message)
        gen = image_svc.generate_image_with_fallback(
            prompt,
            user_id=user.id,
            preferred=model_override if image_svc.is_image_gen_model(model_override) else None,
        )
        image_blocks.append(image_svc.format_image_results("文生图", gen))
        if gen.get("ok"):
            generated_images.extend(gen.get("images") or [])
            if gen.get("model"):
                model_override = model_override or gen["model"]
    elif image_intent == "edit" and image_svc.image_api_available() and user is not None:
        src = next((a for a in attachments if a.get("is_image")), None)
        if not src:
            image_blocks.append("【图生图】请先上传要编辑的图片。")
        else:
            raw = b""
            stored = Path(src.get("stored_path") or "")
            if stored.is_file():
                raw = stored.read_bytes()
            elif src.get("image_base64"):
                import base64
                raw = base64.b64decode(src["image_base64"])
            if not raw:
                image_blocks.append("【图生图】读取原图失败。")
            else:
                preferred = model_override if image_svc.is_image_gen_model(model_override) else None
                edited = image_svc.edit_image_with_fallback(
                    message or "edit this image",
                    user_id=user.id,
                    image_bytes=raw,
                    filename=src.get("name") or "image.png",
                    preferred=preferred,
                )
                title = "文生图(图生图回退)" if edited.get("fallback_from_edit") else "图生图"
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
        system += (
            "\n\n用户本轮消息包含图片,请直接观察图像作答;"
            "不要声称无法查看图片。若信息不足,说明需要补充什么。"
        )
    wants_table = doc_mode and any(k in message for k in ("原始", "表格", "导出", "展示"))
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
        # 识图/对话走 Chat；生图密钥只用于 /images/*
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
            # 个人设置若是 DeepSeek 等纯文本模型,识图改用全局 .env 的 Key/URL + 视觉模型
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
                # 仅在「不支持 image_url」或明显模型不可用时换下一个视觉模型
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
        tried = "、".join(f"`{m}`" for m in tried_models) or f"`{used_model}`"
        reply = (
            "图片已上传,但调用的 Chat 通道不接受多模态 `image_url`(识图)。\n\n"
            f"已尝试视觉模型: {tried}\n"
            + (
                f"你的个人设置模型是 `{personal_model}`(纯文本,不能看图),"
                "识图时已忽略它并改用全局配置。\n"
                if personal_model and llm.looks_non_vision_model(personal_model)
                else ""
            )
            + "请任选其一:\n"
            "1. 打开右上角「个人设置」,把 Model 改成网关支持的视觉型号"
            "(如 `gpt-4o` / `qwen-vl-max`),不要用 DeepSeek Flash\n"
            "2. 或确认 centos 网关是否提供 VL Chat 模型,把名称写入 `.env` 的"
            " `IMAGE_VISION_MODEL` 后重启\n\n"
            "文生图/图生图不受影响:直接说「画一张…」,或上传图后说「改成…」。"
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
        "knowledge_hit": bool(knowledge or mcp.get("content") or attachments or generated_images),
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
