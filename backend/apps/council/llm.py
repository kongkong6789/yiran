"""
LLM 服务:优先使用真实 LLM(OpenAI 兼容 API),未配置 key 时降级为智能 mock。

用标准库 urllib 调用,避免额外依赖。真实使用时在 backend/.env 配置:
  LLM_API_KEY=sk-xxx
  LLM_BASE_URL=https://api.openai.com/v1
  LLM_MODEL=gpt-4o-mini
"""
import json
import random
import urllib.request
import urllib.error

from django.conf import settings

from apps.core.cancellation import AgentRunCancelled, raise_if_cancelled


_LLM_HTTP_HEADERS = {
    # Cloudflare 1010 会拦默认 Python-urllib / 过简 UA
    "User-Agent": (
        "Mozilla/5.0 (compatible; LiangceAgent/1.0; "
        "+https://github.com/kongkong6789/yiran)"
    ),
    "Accept": "application/json",
}


def _llm_request_headers(api_key: str, *, accept: str | None = None) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        **_LLM_HTTP_HEADERS,
    }
    if accept:
        headers["Accept"] = accept
    return headers


def _resolve_credentials(user=None) -> tuple[str, str, str]:
    """解析 LLM 凭据: 用户个人设置优先,否则回退全局 .env。"""
    if user is not None and getattr(user, "is_authenticated", False):
        from apps.core.models import UserSettings

        us = UserSettings.objects.filter(user=user).first()
        if us and us.llm_api_key:
            return (
                us.llm_api_key.strip(),
                (us.llm_base_url or settings.LLM_BASE_URL or "").strip(),
                (us.llm_model or settings.LLM_MODEL or "").strip(),
            )
    return (
        (settings.LLM_API_KEY or "").strip(),
        (settings.LLM_BASE_URL or "").strip(),
        (settings.LLM_MODEL or "").strip(),
    )


def resolve_llm_credentials(user=None) -> tuple[str, str, str]:
    """Return the effective OpenAI-compatible credentials for trusted runtimes."""
    return _resolve_credentials(user)


def llm_available(user=None) -> bool:
    api_key, _, _ = _resolve_credentials(user)
    return bool(api_key)


def credential_status(user=None) -> dict:
    """返回当前用户实际会使用的模型配置状态，不暴露密钥或网关地址。"""
    source = "platform"
    if user is not None and getattr(user, "is_authenticated", False):
        from apps.core.models import UserSettings

        us = UserSettings.objects.filter(user=user).only("llm_api_key").first()
        if us and (us.llm_api_key or "").strip():
            source = "personal"

    api_key, base_url, model = _resolve_credentials(user)
    missing = []
    if not api_key:
        missing.append("api_key")
    if not base_url:
        missing.append("base_url")
    if not model:
        missing.append("model")
    return {
        "configured": not missing,
        "model": model,
        "source": source,
        "missing": missing,
    }


def fast_model(user=None) -> str:
    """逐轮发言/压缩用的快模型。

    个人凭据必须和个人模型成对使用；否则会把用户配置的可用模型替换成
    平台 ``LLM_MODEL_FAST``，在第三方网关上表现为 model_not_found。
    """
    _, _, model = _resolve_credentials(user)
    if user is not None and getattr(user, "is_authenticated", False):
        from apps.core.models import UserSettings

        personal = (
            UserSettings.objects.filter(user=user)
            .only("llm_api_key", "llm_model")
            .first()
        )
        if (
            personal
            and (personal.llm_api_key or "").strip()
            and (personal.llm_model or "").strip()
        ):
            return personal.llm_model.strip()
    return getattr(settings, "LLM_MODEL_FAST", None) or model


def chat(system: str, user: str, temperature: float = 0.8, max_tokens: int = 400,
         model: str | None = None, timeout: int = 30, *, llm_user=None) -> str:
    """调用 LLM 生成一段文本;失败或无 key 时返回空串(由上层降级到 mock)。"""
    return chat_messages(
        system,
        [{"role": "user", "content": user}],
        temperature=temperature,
        max_tokens=max_tokens,
        model=model,
        timeout=timeout,
        llm_user=llm_user,
    )


def looks_non_vision_model(model: str) -> bool:
    """粗判常见纯文本模型(DeepSeek 等),避免识图时被个人设置覆盖。"""
    m = (model or "").lower().replace(" ", "").replace("_", "-")
    if not m:
        return False
    if any(x in m for x in ("-vl", "vision", "gpt-4o", "gpt4o", "4o-mini", "gemini", "claude-3", "claude-4")):
        return False
    if "deepseek" in m or m.startswith("ds-"):
        return True
    if any(x in m for x in ("coder", "-r1", "reasoner")):
        return True
    return False


def personal_llm_model(user=None) -> str:
    if user is None or not getattr(user, "is_authenticated", False):
        return ""
    from apps.core.models import UserSettings

    us = UserSettings.objects.filter(user=user).first()
    return ((us.llm_model if us else "") or "").strip()


def vision_model_candidates(user=None) -> list[str]:
    """识图模型候选:全局 IMAGE_VISION_MODEL 优先,不回退到非视觉个人模型。"""
    ordered: list[str] = []
    for name in (
        (getattr(settings, "IMAGE_VISION_MODEL", "") or "").strip(),
        "gpt-4o",
        "gpt-4o-mini",
        "qwen-vl-max",
        "qwen-vl-plus",
    ):
        if name and name not in ordered and not looks_non_vision_model(name):
            ordered.append(name)
    personal = personal_llm_model(user)
    if personal and not looks_non_vision_model(personal) and personal not in ordered:
        ordered.insert(0, personal)
    return ordered or [(settings.LLM_MODEL or "gpt-4o").strip()]


def _is_vision_unsupported_error(err: str) -> bool:
    e = (err or "").lower()
    return (
        "image_url" in e
        or ("unknown variant" in e and "text" in e)
        or "does not support image" in e
        or ("vision" in e and ("not support" in e or "unsupported" in e))
    )


def _strip_images_from_messages(messages: list[dict]) -> list[dict]:
    """将 multimodal content 压成纯文本,用于不支持识图的模型重试/说明。"""
    out: list[dict] = []
    for m in messages:
        content = m.get("content")
        if isinstance(content, list):
            texts = [
                str(p.get("text") or "").strip()
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            img_n = sum(
                1 for p in content
                if isinstance(p, dict) and p.get("type") == "image_url"
            )
            text = "\n".join(t for t in texts if t)
            if img_n:
                text = (text + f"\n\n(用户另附了 {img_n} 张图片,但当前模型接口不支持识图)").strip()
            out.append({"role": m.get("role", "user"), "content": text})
        else:
            out.append(m)
    return out


def chat_messages(
    system: str,
    messages: list[dict],
    *,
    temperature: float = 0.7,
    max_tokens: int = 800,
    model: str | None = None,
    timeout: int = 45,
    llm_user=None,
    cancel_check=None,
) -> str:
    """多轮对话;失败返回空串。详细错误见 chat_messages_result。"""
    return chat_messages_result(
        system, messages,
        temperature=temperature, max_tokens=max_tokens,
        model=model, timeout=timeout, llm_user=llm_user,
        cancel_check=cancel_check,
    ).get("content") or ""


def chat_messages_result(
    system: str,
    messages: list[dict],
    *,
    temperature: float = 0.7,
    max_tokens: int = 800,
    model: str | None = None,
    timeout: int = 45,
    llm_user=None,
    allow_images: bool = True,
    api_key: str | None = None,
    base_url: str | None = None,
    cancel_check=None,
) -> dict:
    """多轮对话,返回 {content, error, configured, model, base_url, vision_unsupported}。

    可显式传入 api_key/base_url(例如图片专用密钥)。
    """
    resolved_key, resolved_base, default_model = _resolve_credentials(llm_user)
    used_key = (api_key or resolved_key or "").strip()
    used_base = (base_url or resolved_base or "").strip()
    used_model = model or default_model or fast_model(llm_user)
    if not used_key:
        return {
            "content": "",
            "error": "未配置 LLM API Key(个人设置或全局 .env)",
            "configured": False,
            "model": used_model,
            "base_url": used_base,
            "vision_unsupported": False,
        }
    if not used_base:
        return {
            "content": "",
            "error": "未配置 LLM Base URL",
            "configured": True,
            "model": used_model,
            "base_url": "",
            "vision_unsupported": False,
        }

    raise_if_cancelled(cancel_check)
    completion = _chat_completions_stream_once if cancel_check else _chat_completions_once
    completion_kwargs = {
        "api_key": used_key,
        "base_url": used_base,
        "used_model": used_model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "timeout": timeout,
        "allow_images": allow_images,
    }
    if cancel_check:
        completion_kwargs["cancel_check"] = cancel_check
    result = completion(system, messages, **completion_kwargs)
    # 个人设置优先，但个人 Key 失效时不能让整个问答不可用。
    # 仅对明确的鉴权失败回退全局凭据；超时、限流等错误仍保留原结果，
    # 避免一次请求在两个上游重复消耗。
    error = str(result.get("error") or "")
    global_key = (getattr(settings, "LLM_API_KEY", "") or "").strip()
    global_base = (getattr(settings, "LLM_BASE_URL", "") or "").strip()
    global_model = (getattr(settings, "LLM_MODEL", "") or "").strip()
    personal_auth_failed = (
        api_key is None
        and llm_user is not None
        and getattr(llm_user, "is_authenticated", False)
        and bool(global_key and global_base)
        and used_key != global_key
        and (
            "LLM HTTP 401" in error
            or "LLM HTTP 403" in error
            or "LLM HTTP 502" in error
            or "LLM HTTP 503" in error
            or "LLM network error" in error
            or "invalid token" in error.lower()
            or "invalid api key" in error.lower()
            or "authentication" in error.lower()
        )
    )
    if personal_auth_failed:
        raise_if_cancelled(cancel_check)
        completion_kwargs = {
            **completion_kwargs,
            "api_key": global_key,
            "base_url": global_base,
            "used_model": global_model or used_model,
        }
        fallback = completion(system, messages, **completion_kwargs)
        fallback["credential_fallback"] = "global"
        if not fallback.get("content") and fallback.get("error"):
            fallback["error"] = (
                "个人 LLM 凭据已失效，且全局模型重试失败："
                f"{fallback['error']}"
            )
        result = fallback

    # 网关 channel 下线时按备用模型重试（model_not_found / No available channel）
    result = _retry_with_fallback_models(
        system,
        messages,
        result=result,
        completion=completion,
        completion_kwargs=completion_kwargs,
        cancel_check=cancel_check,
    )

    if (
        allow_images
        and not result.get("content")
        and _is_vision_unsupported_error(result.get("error") or "")
    ):
        result["vision_unsupported"] = True
    return result


def _is_model_unavailable_error(err: str) -> bool:
    e = (err or "").lower()
    return (
        "model_not_found" in e
        or "no available channel" in e
        or "model_not_available" in e
        or ("is not supported by any configured account" in e)
    )


def _fallback_model_names(primary: str) -> list[str]:
    ordered: list[str] = []
    for name in getattr(settings, "LLM_MODEL_FALLBACKS", None) or []:
        n = (name or "").strip()
        if n and n not in ordered:
            ordered.append(n)
    for name in (
        (getattr(settings, "LLM_MODEL", "") or "").strip(),
        (getattr(settings, "LLM_MODEL_FAST", "") or "").strip(),
    ):
        if name and name not in ordered:
            ordered.append(name)
    primary = (primary or "").strip()
    return [m for m in ordered if m and m != primary]


def is_model_unavailable_error(error: str) -> bool:
    """Public classifier shared by isolated agent runtimes."""
    return _is_model_unavailable_error(error)


def llm_model_candidates(primary: str) -> list[str]:
    """Return a stable, de-duplicated primary + fallback model sequence."""
    ordered: list[str] = []
    for name in [(primary or "").strip(), *_fallback_model_names(primary)]:
        if name and name not in ordered:
            ordered.append(name)
    return ordered


def _retry_with_fallback_models(
    system: str,
    messages: list[dict],
    *,
    result: dict,
    completion,
    completion_kwargs: dict,
    cancel_check=None,
) -> dict:
    if result.get("content") or not _is_model_unavailable_error(str(result.get("error") or "")):
        return result
    tried = {(completion_kwargs.get("used_model") or "").strip()}
    last = result
    for alt in _fallback_model_names(completion_kwargs.get("used_model") or ""):
        if alt in tried:
            continue
        tried.add(alt)
        raise_if_cancelled(cancel_check)
        alt_kwargs = {**completion_kwargs, "used_model": alt}
        last = completion(system, messages, **alt_kwargs)
        last["model_fallback"] = alt
        if last.get("content") or not _is_model_unavailable_error(str(last.get("error") or "")):
            return last
    return last


def _completion_messages(
    system: str,
    messages: list[dict],
    allow_images: bool,
) -> list[dict]:
    payload_messages = [{"role": "system", "content": system}]
    for message in messages[-20:]:
        role = message.get("role", "user")
        if role not in ("user", "assistant", "system"):
            role = "user"
        content = message.get("content")
        if isinstance(content, list):
            if not allow_images:
                texts = [
                    str(part.get("text") or "").strip()
                    for part in content
                    if isinstance(part, dict) and part.get("type") == "text"
                ]
                text = "\n".join(item for item in texts if item)
                if text:
                    payload_messages.append({"role": role, "content": text})
                continue
            cleaned = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                part_type = part.get("type")
                if part_type == "text" and str(part.get("text") or "").strip():
                    cleaned.append({"type": "text", "text": str(part["text"]).strip()})
                elif part_type == "image_url" and part.get("image_url"):
                    cleaned.append({"type": "image_url", "image_url": part["image_url"]})
            if cleaned:
                normalized = (
                    cleaned[0]["text"]
                    if len(cleaned) == 1 and cleaned[0]["type"] == "text"
                    else cleaned
                )
                payload_messages.append({"role": role, "content": normalized})
            continue
        text = (content or "").strip() if isinstance(content, str) else ""
        if text:
            payload_messages.append({"role": role, "content": text})
    return payload_messages


def _chat_completions_stream_once(
    system: str,
    messages: list[dict],
    *,
    api_key: str,
    base_url: str,
    used_model: str,
    temperature: float,
    max_tokens: int,
    timeout: int,
    allow_images: bool,
    cancel_check,
) -> dict:
    url = base_url.rstrip("/") + "/chat/completions"
    body = json.dumps({
        "model": used_model,
        "messages": _completion_messages(system, messages, allow_images),
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers=_llm_request_headers(api_key, accept="text/event-stream"),
    )
    try:
        parts: list[str] = []
        raise_if_cancelled(cancel_check)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            for raw_line in response:
                raise_if_cancelled(cancel_check)
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                if not payload:
                    continue
                data = json.loads(payload)
                delta = (data.get("choices") or [{}])[0].get("delta") or {}
                content = delta.get("content") or ""
                if isinstance(content, str):
                    parts.append(content)
            raise_if_cancelled(cancel_check)
        content = "".join(parts).strip()
        return {
            "content": content,
            "error": "" if content else "模型返回空内容",
            "configured": True,
            "model": used_model,
            "base_url": base_url,
            "vision_unsupported": False,
        }
    except AgentRunCancelled:
        raise
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            detail = str(exc)
        return {
            "content": "",
            "error": f"LLM HTTP {exc.code}: {detail or exc.reason}",
            "configured": True,
            "model": used_model,
            "base_url": base_url,
            "vision_unsupported": False,
        }
    except (urllib.error.URLError, KeyError, json.JSONDecodeError, TimeoutError) as exc:
        return {
            "content": "",
            "error": f"LLM 调用失败: {exc}",
            "configured": True,
            "model": used_model,
            "base_url": base_url,
            "vision_unsupported": False,
        }


def _chat_completions_once(
    system: str,
    messages: list[dict],
    *,
    api_key: str,
    base_url: str,
    used_model: str,
    temperature: float,
    max_tokens: int,
    timeout: int,
    allow_images: bool,
) -> dict:
    url = base_url.rstrip("/") + "/chat/completions"
    body = json.dumps(
        {
            "model": used_model,
            "messages": _completion_messages(system, messages, allow_images),
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers=_llm_request_headers(api_key),
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        if isinstance(content, list):
            content = "".join(
                str(p.get("text") or "") for p in content if isinstance(p, dict)
            )
        content = str(content).strip()
        if not content:
            return {
                "content": "",
                "error": "模型返回空内容",
                "configured": True,
                "model": used_model,
                "base_url": base_url,
                "vision_unsupported": False,
            }
        return {
            "content": content,
            "error": "",
            "configured": True,
            "model": used_model,
            "base_url": base_url,
            "vision_unsupported": False,
        }
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            detail = str(exc)
        return {
            "content": "",
            "error": f"LLM HTTP {exc.code}: {detail or exc.reason}",
            "configured": True,
            "model": used_model,
            "base_url": base_url,
            "vision_unsupported": False,
        }
    except (urllib.error.URLError, KeyError, json.JSONDecodeError, TimeoutError) as exc:
        return {
            "content": "",
            "error": f"LLM 调用失败: {exc}",
            "configured": True,
            "model": used_model,
            "base_url": base_url,
            "vision_unsupported": False,
        }


# ---------------- 智能 Mock(无 LLM key 时使用) ----------------

_OPENERS = [
    "针对「{q}」,我的判断是:", "就「{q}」这个问题,直接说结论——",
    "关于「{q}」,我倾向于:", "从我的角度看「{q}」:",
]
_STANCE_BY_ROLE = {
    "增长": ["优先做能快速拉新的动作", "把预算压到 ROI 最高的渠道", "用短周期 A/B 验证再放量"],
    "产品": ["先明确核心用户和最小闭环", "砍掉非必要功能,聚焦主路径", "用可用原型验证需求真伪"],
    "运营": ["先把现有流量的转化做扎实", "用精细化分层运营提留存", "建立可复用的 SOP 再扩量"],
    "财务": ["控制现金流,量入为出", "关注单位经济模型是否成立", "设定清晰的止损线"],
    "技术": ["用最简架构先跑通再优化", "避免过度设计,关注可维护性", "把关键路径的稳定性放第一"],
    "default": ["先聚焦最关键的一两个抓手", "用数据验证假设再决策", "小步快跑、快速迭代"],
}
_BUILDONS = [
    "补充一点:{prev_name} 说的方向可行,但要注意落地节奏。",
    "我不完全同意 {prev_name},风险在于执行成本被低估了。",
    "顺着上一位的思路,可以再加一条:",
    "结合刚才大家说的,我把方案再收敛一下:",
]
_DEEPEN = [
    "具体到执行,第一步先做 {a},第二步再 {b}。",
    "把它拆成三块:目标、抓手、度量,重点是 {a}。",
    "关键指标建议盯 {a},不要被 {b} 带偏。",
]


def _pick_stance(role: str) -> list[str]:
    for k, v in _STANCE_BY_ROLE.items():
        if k in (role or ""):
            return v
    return _STANCE_BY_ROLE["default"]


def mock_speak(question: str, agent_name: str, role: str, round_no: int,
               prev_name: str | None, user_hint: str | None) -> str:
    """生成一段贴合人设、随轮次深化、围绕问题的模拟发言。"""
    stance = _pick_stance(role)
    parts = []
    if round_no <= 1 or not prev_name:
        parts.append(random.choice(_OPENERS).format(q=question[:24]))
    else:
        parts.append(random.choice(_BUILDONS).format(prev_name=prev_name))
    parts.append(random.choice(stance) + "。")
    a, b = random.sample(stance, 2) if len(stance) >= 2 else (stance[0], stance[0])
    parts.append(random.choice(_DEEPEN).format(a=a, b=b))
    if user_hint:
        parts.append(f"(已收到你的提示:{user_hint[:20]},我据此调整了上面的建议。)")
    return "".join(parts)


def compress_context(question: str, previous_summary: str, recent_msgs: list[str],
                     allow_llm: bool = True) -> str:
    """上下文压缩:始终围绕核心问题,保留结论要点。

    allow_llm=False 时只做本地启发式压缩(不发网络请求),用于讨论过程中的逐轮压缩以提速。
    """
    joined = "\n".join(recent_msgs[-8:])
    if allow_llm and llm_available():
        system = "你是会议记录员。只输出围绕核心问题的要点纪要,不要分析过程,150字以内。"
        user = f"核心问题:{question}\n已有纪要:{previous_summary}\n新增发言:\n{joined}\n请更新纪要。"
        out = chat(system, user, temperature=0.3, max_tokens=300, model=fast_model(), timeout=20)
        if out:
            return out
    # 启发式:保留最近发言的首句要点
    points = []
    for m in recent_msgs[-6:]:
        first = m.split("。")[0]
        if first:
            points.append("· " + first.strip()[:40])
    merged = (previous_summary + "\n" if previous_summary else "") + "\n".join(points)
    return merged[-800:]


def synthesize_plan(question: str, summary: str, all_points: list[str], knowledge: str = "") -> str:
    """生成/迭代最终方案文件(Markdown)。knowledge 为 RAG+DuckDB 汇聚的参考资料。"""
    if llm_available():
        system = ("你是方案撰写者。基于会议讨论与参考资料,直接输出一份围绕核心问题的可执行方案(Markdown),"
                  "包含:结论、关键举措、执行步骤、风险。方案要引用参考资料中的具体制度/数据。"
                  "不要输出分析过程。")
        user = (
            (f"参考资料:\n{knowledge}\n\n" if knowledge else "")
            + f"核心问题:{question}\n会议纪要:{summary}\n讨论要点:\n"
            + "\n".join(all_points[-20:])
        )
        out = chat(system, user, temperature=0.5, max_tokens=800)
        if out:
            return out
    # mock 方案
    bullets = "\n".join(f"- {p}" for p in all_points[-8:]) or "- (暂无足够讨论)"
    return (
        f"# 方案:{question}\n\n"
        f"## 结论\n围绕「{question}」,综合各方观点,建议采取以下方向。\n\n"
        f"## 关键举措\n{bullets}\n\n"
        f"## 执行步骤\n1. 明确目标与度量指标\n2. 选定最高 ROI 的抓手先落地\n"
        f"3. 小步验证后再放量\n4. 建立复盘与迭代机制\n\n"
        f"## 风险与止损\n- 执行成本被低估:设定阶段性检查点\n- 数据不足即决策:先做小样本验证\n\n"
        f"---\n> 纪要摘要:{summary[:200]}"
    )
