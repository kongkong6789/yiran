"""受控的对话 Skill 编辑工具。"""
from __future__ import annotations

import json
import re

from apps.council import llm

from .repository import read_asset_text_file, save_asset_text_file


EDIT_VERBS = ("修改", "编辑", "更新", "改写", "调整", "补充")
PATH_RE = re.compile(
    r"`([^`]+\.(?:md|markdown|txt|py|js|ts|tsx|jsx|json|ya?ml|toml|sh|ps1|css|html|csv|xml|ini|cfg))`",
    re.IGNORECASE,
)


def _json_object(text: str) -> dict:
    value = str(text or "").strip()
    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*|\s*```$", "", value, flags=re.IGNORECASE)
    start = value.find("{")
    end = value.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型没有返回有效的编辑方案")
    payload = json.loads(value[start:end + 1])
    if not isinstance(payload, dict):
        raise ValueError("模型编辑方案格式无效")
    return payload


def try_edit_skill_from_chat(message: str, active_skills: list, user, *, model: str | None = None) -> dict | None:
    """仅在用户明确要求编辑已选 Skill 时调用，并只允许责任人写入。"""
    text = str(message or "")
    if not active_skills or "技能" not in text or not any(term in text for term in EDIT_VERBS):
        return None

    skill = next((row for row in active_skills if getattr(row, "source_asset_id", None)), None)
    if skill is None:
        return {
            "ok": False,
            "kind": "skill_edit",
            "platform_action": "skill_edit",
            "skill_id": "",
            "stdout": "当前技能没有可编辑的仓库文件，请先将它上传为技能资产。",
        }
    asset = skill.source_asset
    can_edit = bool(
        asset.owner_id == getattr(user, "id", None)
        or getattr(user, "is_staff", False)
        or getattr(user, "is_superuser", False)
    )
    if not can_edit:
        return {
            "ok": False,
            "kind": "skill_edit",
            "platform_action": "skill_edit",
            "skill_id": asset.skill_id,
            "stdout": f"未修改 `{asset.skill_id}`：仅技能责任人可以编辑内容。",
        }

    match = PATH_RE.search(text)
    file_path = match.group(1) if match else (asset.skill_md_key or "SKILL.md")
    try:
        current = read_asset_text_file(asset, file_path)
    except (FileNotFoundError, ValueError) as exc:
        return {
            "ok": False,
            "kind": "skill_edit",
            "platform_action": "skill_edit",
            "skill_id": asset.skill_id,
            "stdout": f"未修改 `{asset.skill_id}`：{exc}",
        }

    system = """你是技能文件编辑器。根据用户要求修改给定文件，保持未要求部分不变。
只返回一个 JSON 对象，不要使用 Markdown 代码围栏：
{"content":"修改后的完整文件内容","summary":"一句话说明改了什么"}
不得改变文件路径，不得输出补丁，不得省略内容。"""
    result = llm.chat_messages_result(
        system,
        [{
            "role": "user",
            "content": f"用户要求：\n{text}\n\n目标文件：{file_path}\n\n当前完整内容：\n{current}",
        }],
        temperature=0.1,
        max_tokens=6000,
        model=model,
        timeout=90,
        llm_user=user,
        allow_images=False,
    )
    if not result.get("content"):
        return {
            "ok": False,
            "kind": "skill_edit",
            "platform_action": "skill_edit",
            "skill_id": asset.skill_id,
            "stdout": f"未修改 `{asset.skill_id}`：{result.get('error') or '模型没有生成编辑结果'}",
        }
    try:
        plan = _json_object(result["content"])
        next_content = plan.get("content")
        if not isinstance(next_content, str) or not next_content.strip():
            raise ValueError("模型返回的文件内容为空")
        updated = save_asset_text_file(
            asset,
            file_path,
            next_content,
            expected_updated_at=asset.updated_at.isoformat(),
        )
    except (ValueError, json.JSONDecodeError) as exc:
        return {
            "ok": False,
            "kind": "skill_edit",
            "platform_action": "skill_edit",
            "skill_id": asset.skill_id,
            "stdout": f"未修改 `{asset.skill_id}`：{exc}",
        }

    if file_path.casefold().endswith("skill.md") and getattr(skill, "pk", None):
        skill.refresh_from_db()
    return {
        "ok": True,
        "kind": "skill_edit",
        "platform_action": "skill_edit",
        "skill_id": asset.skill_id,
        "path": file_path,
        "stdout": f"已更新 `{asset.skill_id}/{file_path}`。{str(plan.get('summary') or '').strip()}",
        "updated_at": updated.updated_at.isoformat(),
    }
