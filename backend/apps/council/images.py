"""文生图 / 图生图(OpenAI 兼容 /v1/images/*)。"""
from __future__ import annotations

import base64
import json
import re
import uuid
import urllib.error
import urllib.request
from pathlib import Path

from django.conf import settings

from apps.core.attachments import attachments_root


def _image_creds() -> tuple[str, str]:
    key = (getattr(settings, "IMAGE_API_KEY", "") or "").strip()
    base = (getattr(settings, "IMAGE_BASE_URL", "") or settings.LLM_BASE_URL or "").strip()
    return key, base


def image_api_available() -> bool:
    key, base = _image_creds()
    return bool(key and base)


def is_image_gen_model(model: str | None) -> bool:
    """是否为文生图 / 图生图模型(非 Chat)。"""
    m = (model or "").lower().replace(" ", "").replace("_", "-")
    if not m:
        return False
    keys = (
        "dall-e", "dalle", "flux", "stable-diffusion", "sdxl", "sd-3",
        "midjourney", "imagen", "kolors", "wanx", "cogview", "ideogram",
        "gpt-image", "gemini-image", "banana",
    )
    if any(k in m for k in keys):
        return True
    # 如 gemini-3-pro-image-preview / gemini-3.1-flash-image-preview
    if "image" in m and any(x in m for x in ("gemini", "gpt", "preview", "flash", "pro")):
        return True
    return False


def _fetch_model_ids(api_key: str, base_url: str) -> list[str]:
    if not api_key or not base_url:
        return []
    url = base_url.rstrip("/") + "/models"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "LiangceAgent/1.0 (OpenAI-compatible)",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        ids: list[str] = []
        for item in data.get("data") or []:
            mid = (item.get("id") or item.get("model") or "").strip()
            if mid:
                ids.append(mid)
        return sorted(set(ids), key=str.lower)
    except Exception:
        return []


def list_gateway_models() -> dict:
    """分别用对话 Key / 生图 Key 拉取网关真实模型列表。"""
    chat_key = (settings.LLM_API_KEY or "").strip()
    chat_base = (settings.LLM_BASE_URL or "").strip()
    img_key, img_base = _image_creds()

    chat_ids = _fetch_model_ids(chat_key, chat_base)
    image_ids = _fetch_model_ids(img_key, img_base)
    # 生图 Key 下若返回了明确的生图型号,以其为准;否则从合并列表里筛
    image_only = [m for m in image_ids if is_image_gen_model(m)]
    if not image_only and image_ids:
        image_only = list(image_ids)
    chat_only = [m for m in chat_ids if not is_image_gen_model(m)]

    def pretty(mid: str) -> str:
        return mid

    return {
        "ok": True,
        "chat": [{"value": m, "title": pretty(m), "kind": "chat"} for m in chat_only],
        "image": [{"value": m, "title": pretty(m), "kind": "image"} for m in image_only],
        "source": {
            "chat_base": chat_base,
            "image_base": img_base,
        },
    }


def detect_image_intent(message: str, has_image: bool) -> str:
    """返回 generate | edit | analyze | none。"""
    text = (message or "").strip().lower()
    cn = message or ""
    if any(k in cn for k in ("图生图", "改图", "编辑这张", "修改图片", "把图", "基于这张图", "按照这张图")):
        return "edit"
    if has_image and any(k in cn for k in ("改成", "换成", "变成", "重绘", "修一下", "编辑")):
        return "edit"
    if any(k in cn for k in ("生成图片", "文生图", "画一张", "画个", "生成一张", "出一张图", "帮我画")):
        return "generate"
    if has_image and any(k in cn for k in ("逆向", "关键字", "关键词", "描述", "识别", "分析", "看图", "这是什么", "图里")):
        return "analyze"
    if has_image and not text:
        return "analyze"
    if has_image:
        return "analyze"
    return "none"


def _parse_image_response(data: dict, user_id: int) -> dict:
    items = data.get("data") or []
    if not items:
        return {"ok": False, "error": "图片接口返回空 data", "images": []}
    root = attachments_root(user_id)
    root.mkdir(parents=True, exist_ok=True)
    images: list[dict] = []
    for item in items:
        b64 = item.get("b64_json") or ""
        url = item.get("url") or ""
        stored = ""
        local_url = ""
        if b64:
            raw = base64.b64decode(b64)
            stored = f"{uuid.uuid4().hex}_gen.png"
            path = root / stored
            path.write_bytes(raw)
            local_url = f"/api/agent/attachments/{stored}"
        images.append({
            "url": local_url or url,
            "remote_url": url,
            "stored_id": stored,
        })
    return {"ok": True, "error": "", "images": images}


def _is_model_channel_error(err: str) -> bool:
    e = (err or "").lower()
    return (
        "model_not_found" in e
        or "no available channel" in e
        or "no available" in e and "model" in e
    )


def image_model_candidates(*, preferred: str | None = None, for_edit: bool = False) -> list[str]:
    """生图候选顺序。图生图优先 gemini(多数网关 gpt-image-2 无 edits 通道)。"""
    ordered: list[str] = []
    prefer = (preferred or "").strip()
    default_edit = (getattr(settings, "IMAGE_EDIT_MODEL", "") or "").strip()
    default_gen = (getattr(settings, "IMAGE_GEN_MODEL", "") or "").strip()

    if for_edit:
        starters = (
            prefer if prefer and "gemini" in prefer.lower() else "",
            default_edit,
            "gemini-3.1-flash-image-preview",
            "gemini-3-pro-image-preview",
            prefer,
            default_gen,
            "gpt-image-2",
        )
    else:
        starters = (prefer, default_gen, "gpt-image-2", "gemini-3.1-flash-image-preview", "gemini-3-pro-image-preview")

    for name in starters:
        name = (name or "").strip()
        if name and name not in ordered:
            ordered.append(name)

    try:
        for item in list_gateway_models().get("image") or []:
            value = (item.get("value") or "").strip()
            if value and value not in ordered:
                ordered.append(value)
    except Exception:
        pass
    return ordered


def generate_image(prompt: str, *, user_id: int, size: str = "1024x1024", model: str | None = None) -> dict:
    key, base = _image_creds()
    if not key or not base:
        return {"ok": False, "error": "未配置 IMAGE_API_KEY / IMAGE_BASE_URL", "images": [], "model": ""}
    used_model = (model or "").strip() or getattr(settings, "IMAGE_GEN_MODEL", "gpt-image-2")
    url = base.rstrip("/") + "/images/generations"
    body = json.dumps({
        "model": used_model,
        "prompt": (prompt or "").strip() or "a simple illustration",
        "n": 1,
        "size": size,
        "response_format": "b64_json",
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            "User-Agent": "LiangceAgent/1.0 (OpenAI-compatible)",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        result = _parse_image_response(data, user_id)
        result["model"] = used_model
        return result
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            detail = str(exc)
        return {
            "ok": False,
            "error": f"文生图 HTTP {exc.code}: {detail}",
            "images": [],
            "model": used_model,
        }
    except Exception as exc:
        return {"ok": False, "error": f"文生图失败: {exc}", "images": [], "model": used_model}


def generate_image_with_fallback(
    prompt: str, *, user_id: int, preferred: str | None = None, size: str = "1024x1024",
) -> dict:
    tried: list[str] = []
    last: dict = {"ok": False, "error": "无可用生图模型", "images": []}
    for model_name in image_model_candidates(preferred=preferred, for_edit=False):
        tried.append(model_name)
        last = generate_image(prompt, user_id=user_id, size=size, model=model_name)
        if last.get("ok"):
            last["tried"] = tried
            return last
        if not _is_model_channel_error(last.get("error") or ""):
            last["tried"] = tried
            return last
    last["tried"] = tried
    last["error"] = (
        f"{last.get('error') or '文生图失败'}\n"
        f"已尝试: {', '.join(tried)}"
    )
    return last


def edit_image(
    prompt: str,
    *,
    user_id: int,
    image_bytes: bytes,
    filename: str = "image.png",
    size: str = "1024x1024",
    model: str | None = None,
) -> dict:
    key, base = _image_creds()
    if not key or not base:
        return {"ok": False, "error": "未配置 IMAGE_API_KEY / IMAGE_BASE_URL", "images": [], "model": ""}
    used_model = (model or "").strip() or getattr(settings, "IMAGE_EDIT_MODEL", "gemini-3.1-flash-image-preview")
    url = base.rstrip("/") + "/images/edits"

    boundary = f"----LiangceBound{uuid.uuid4().hex}"
    fname = Path(filename).name or "image.png"
    if not fname.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        fname = "image.png"

    def part(name: str, value: bytes, filename: str | None = None, content_type: str | None = None) -> bytes:
        lines = [f"--{boundary}".encode(), f'Content-Disposition: form-data; name="{name}"'.encode()]
        if filename:
            lines[1] = (
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"'
            ).encode()
        if content_type:
            lines.append(f"Content-Type: {content_type}".encode())
        lines.append(b"")
        lines.append(value)
        return b"\r\n".join(lines)

    mime = "image/png"
    lower = fname.lower()
    if lower.endswith((".jpg", ".jpeg")):
        mime = "image/jpeg"
    elif lower.endswith(".webp"):
        mime = "image/webp"

    chunks = [
        part("model", used_model.encode()),
        part("prompt", (prompt or "edit this image").encode("utf-8")),
        part("n", b"1"),
        part("size", size.encode()),
        part("response_format", b"b64_json"),
        part("image", image_bytes, filename=fname, content_type=mime),
        f"--{boundary}--".encode(),
        b"",
    ]
    body = b"\r\n".join(chunks)
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {key}",
            "User-Agent": "LiangceAgent/1.0 (OpenAI-compatible)",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        result = _parse_image_response(data, user_id)
        result["model"] = used_model
        return result
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            detail = str(exc)
        return {
            "ok": False,
            "error": f"图生图 HTTP {exc.code}: {detail}",
            "images": [],
            "model": used_model,
        }
    except Exception as exc:
        return {"ok": False, "error": f"图生图失败: {exc}", "images": [], "model": used_model}


def edit_image_with_fallback(
    prompt: str,
    *,
    user_id: int,
    image_bytes: bytes,
    filename: str = "image.png",
    preferred: str | None = None,
    size: str = "1024x1024",
) -> dict:
    tried: list[str] = []
    last: dict = {"ok": False, "error": "无可用图生图模型", "images": []}
    for model_name in image_model_candidates(preferred=preferred, for_edit=True):
        tried.append(model_name)
        last = edit_image(
            prompt,
            user_id=user_id,
            image_bytes=image_bytes,
            filename=filename,
            size=size,
            model=model_name,
        )
        if last.get("ok"):
            last["tried"] = tried
            return last
        if not _is_model_channel_error(last.get("error") or ""):
            last["tried"] = tried
            return last

    # 该网关常见情况: gpt-image-2 等无 /images/edits 通道 → 退回文生图(仅文字)
    gen = generate_image_with_fallback(
        f"根据参考图意图重绘: {prompt}",
        user_id=user_id,
        preferred=preferred,
        size=size,
    )
    if gen.get("ok"):
        gen["fallback_from_edit"] = True
        gen["tried"] = tried + (gen.get("tried") or [])
        gen["error"] = ""
        return gen

    last["tried"] = tried
    last["error"] = (
        f"{last.get('error') or '图生图失败'}\n\n"
        "说明: 所选模型在列表里可见,但网关 **图生图(`/images/edits`) 没有可用通道**"
        "(常见于 gpt-image-2)。已尝试: "
        + ", ".join(tried)
        + "。可改选 gemini-*-image-* 再试,或用文字描述改走文生图。"
    )
    return last


def format_image_results(title: str, result: dict) -> str:
    if not result.get("ok"):
        err = result.get("error") or "未知错误"
        low = err.lower()
        tip = ""
        if "no active api keys" in low:
            tip = (
                "\n\n网关含义: **生图分组没有可用的上游 API Key**。"
                "接口地址没写错,是 centos 后台该分组未开通/欠费/Key 失效。"
                "请到 https://ai.centos.hk 检查生图密钥对应分组的通道。"
            )
        elif _is_model_channel_error(err) and "已尝试" not in err:
            tip = (
                "\n\n网关含义: 模型能列出,但 **当前分组没有该能力通道**"
                "(`/images/generations` 或 `/images/edits`)。"
                "请在 centos 控制台为生图 Key 开通对应模型通道"
                "(文生图 generations / 图生图 edits)。"
            )
        return f"【{title}失败】\n{err}{tip}"
    used = result.get("model") or ""
    lines = [f"【{title}成功】" + (f" · `{used}`" if used else "")]
    if result.get("fallback_from_edit"):
        lines.append("提示: 图生图通道不可用,已按文字描述改为文生图。")
    for i, img in enumerate(result.get("images") or [], 1):
        u = img.get("url") or img.get("remote_url") or ""
        if u:
            lines.append(f"{i}. ![]({u})")
            lines.append(f"   链接: {u}")
    return "\n".join(lines)


def extract_generation_prompt(message: str) -> str:
    text = (message or "").strip()
    text = re.sub(
        r"^(请|帮我|麻烦)?(生成|画|绘制|出)(一张|个|一幅)?(图片|图)?[：:\s]*",
        "",
        text,
    )
    return text.strip() or message.strip()
