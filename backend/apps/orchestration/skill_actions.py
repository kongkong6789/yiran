"""Bridge Skill Center assets into SOP execute_action catalog / runtime."""
from __future__ import annotations

import re
from typing import Any

from apps.skills.models import SkillAsset, UserSkill


SKILL_ACTION_RE = re.compile(r"^skill:(\d+)$")


def skill_action_key(asset_id: int, explicit: str = "") -> str:
    key = str(explicit or "").strip()
    if key:
        return key[:96]
    return f"skill:{int(asset_id)}"


def parse_skill_asset_id(action_name: str) -> int | None:
    match = SKILL_ACTION_RE.match(str(action_name or "").strip())
    if not match:
        return None
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return None


def is_skill_action(action_name: str) -> bool:
    return parse_skill_asset_id(action_name) is not None


def resolve_skill_asset_for_user(*, action_name: str, user) -> SkillAsset | None:
    asset_id = parse_skill_asset_id(action_name)
    if not asset_id or not user:
        return None
    asset = SkillAsset.objects.filter(id=asset_id, sop_callable=True).select_related("uploader", "owner").first()
    if not asset:
        return None
    # Must be adopted+enabled by this user, or owned/uploaded by them with sop_callable.
    personal = UserSkill.objects.filter(user=user, source_asset_id=asset.id, enabled=True).first()
    if personal:
        return asset
    if asset.uploader_id == user.id or asset.owner_id == user.id:
        return asset
    if asset.visibility == SkillAsset.Visibility.SHARED:
        # Shared but not adopted: still require adoption for SOP bind to keep governance clear.
        return None
    return None


def list_skill_catalog_actions(*, user) -> list[dict]:
    """Skills the user can bind in SOP: enabled personal adoptions with sop_callable assets."""
    if not user:
        return []
    rows = (
        UserSkill.objects.filter(user=user, enabled=True, source_asset__isnull=False, source_asset__sop_callable=True)
        .select_related("source_asset")
        .order_by("-updated_at")[:80]
    )
    out: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        asset = row.source_asset
        if not asset:
            continue
        name = skill_action_key(asset.id, asset.action_key)
        if name in seen:
            continue
        seen.add(name)
        out.append({
            "name": name,
            "title": asset.name or row.name or f"技能 {asset.skill_id}",
            "object_type": "skill",
            "connector": "skill_runner",
            "required_fields": {},
            "required_roles": ["operator", "manager", "director"],
            "from_states": [],
            "to_state": None,
            "budget_field": None,
            "high_risk": bool(asset.sop_high_risk),
            "sop_ready": True,
            "group": "skill",
            "source": "skill",
            "skill_id": asset.skill_id,
            "asset_id": asset.id,
            "description": (asset.description or row.description or "")[:240],
        })
    return out


def run_skill_sop_action(
    *,
    action_name: str,
    text: str,
    payload: dict,
    user,
    organization,
    trace_id: str,
    initial_steps: list | None = None,
) -> dict:
    """Execute a skill:* action inside SOP / trial; returns orchestration-shaped result."""
    steps = list(initial_steps or [])
    asset = resolve_skill_asset_for_user(action_name=action_name, user=user)
    if not asset:
        message = f"技能动作不可用或未启用：{action_name}"
        steps.append({"node": "技能执行", "status": "block", "detail": message, "data": {}})
        return {
            "trace_id": trace_id,
            "decision": "block",
            "action": action_name,
            "error": message,
            "result": {"ok": False, "error_code": "SKILL_UNAVAILABLE", "user_message": message},
            "steps": steps,
        }

    personal = UserSkill.objects.filter(user=user, source_asset_id=asset.id, enabled=True).first()
    if not personal:
        # Auto-adopt for owner/uploader so SOP trial works without extra click.
        personal = UserSkill.objects.create(
            user=user,
            skill_id=asset.skill_id,
            name=asset.name,
            description=asset.description,
            raw_content="",
            instructions=asset.instructions_preview or "",
            source_asset=asset,
            enabled=True,
        )

    task_text = str(text or "").strip() or f"请执行技能「{asset.name}」"
    context = str(payload.get("_sop_context") or "").strip()
    instruction = str(payload.get("_node_instruction") or "").strip()
    message = task_text
    if instruction and instruction not in message:
        message = f"{instruction}\n\n{message}"
    if context:
        message = f"{message}\n\n【绑定数据摘要】\n{context[:4000]}"

    steps.append({
        "node": "加载技能",
        "status": "done",
        "detail": f"已加载技能「{asset.name}」",
        "data": {"asset_id": asset.id, "skill_id": asset.skill_id},
    })

    from apps.core.agent_chat import run_chat

    try:
        chat = run_chat(
            message,
            history=[],
            user=user,
            skill_ids=[personal.skill_id],
            usage_source="direct",
        )
    except Exception as exc:  # noqa: BLE001
        message_err = f"技能执行失败：{exc}"
        steps.append({"node": "技能执行", "status": "block", "detail": message_err, "data": {}})
        return {
            "trace_id": trace_id,
            "decision": "block",
            "action": action_name,
            "error": message_err,
            "result": {"ok": False, "error_code": "SKILL_FAILED", "user_message": message_err},
            "steps": steps,
        }

    ok = bool(chat.get("ok", True))
    reply = str(chat.get("reply") or chat.get("content") or chat.get("assistant") or "").strip()
    if not reply:
        reply = str(chat.get("error") or "技能已执行，但没有返回正文。").strip()
    steps.append({
        "node": "技能执行",
        "status": "done" if ok else "block",
        "detail": "技能调用完成" if ok else (chat.get("error") or "技能调用失败"),
        "data": {"model": chat.get("model"), "skill_id": personal.skill_id},
    })
    if not ok:
        return {
            "trace_id": trace_id,
            "decision": "block",
            "action": action_name,
            "error": reply[:400],
            "result": {
                "ok": False,
                "error_code": "SKILL_FAILED",
                "user_message": reply[:500],
                "skill_id": personal.skill_id,
            },
            "steps": steps,
        }

    title = str(payload.get("_node_title") or asset.name or "技能产物")
    from .report_html import sanitize_mermaid_source
    import re as _re

    def _soften(md: str) -> str:
        def _repl(match: _re.Match) -> str:
            cleaned = sanitize_mermaid_source(match.group(1) or "")
            if cleaned:
                return f"```mermaid\n{cleaned}\n```"
            return "\n> 图表已省略（语法不稳定），请以下方文字为准。\n"

        return _re.sub(r"```mermaid\s*([\s\S]*?)```", _repl, md or "", flags=_re.IGNORECASE)

    report_markdown = f"# {title}\n\n{_soften(reply)}\n"
    return {
        "trace_id": trace_id,
        "decision": "allow",
        "action": action_name,
        "result": {
            "ok": True,
            "execution_mode": "skill_action",
            "report_markdown": report_markdown,
            "user_message": f"已通过技能「{asset.name}」生成结果。",
            "skill_id": personal.skill_id,
            "asset_id": asset.id,
            "model": chat.get("model"),
            "external_write_performed": False,
            "organization_id": getattr(organization, "id", None),
        },
        "steps": steps,
    }


def scaffold_sop_graph_for_skill(*, asset: SkillAsset, action_name: str) -> dict[str, Any]:
    """Minimal SOP: collect → execute(skill) → end."""
    title = asset.name or asset.skill_id
    return {
        "start": "collect.scope",
        "terminals": ["end"],
        "nodes": [
            {
                "key": "collect.scope",
                "type": "collect_info",
                "title": "确认任务范围",
                "config": {
                    "instruction": asset.description or f"确认要运行的技能任务：{title}",
                    "expected_user_info": [],
                    "allowed_actions": ["ask_user", "continue_flow"],
                    "knowledge_scope": {"knowledge_base_ids": [], "retrieval_hint": ""},
                    "data_bindings": {"snapshot_ids": [], "metric_ids": [], "asset_keys": [], "scope": "", "brand_ids": []},
                    "action_name": "",
                },
            },
            {
                "key": "execute.skill",
                "type": "execute_action",
                "title": f"执行：{title}",
                "config": {
                    "instruction": asset.instructions_preview or asset.description or f"执行技能 {title}",
                    "expected_user_info": [],
                    "allowed_actions": ["continue_flow", f"call_action:{action_name}"],
                    "knowledge_scope": {"knowledge_base_ids": [], "retrieval_hint": ""},
                    "data_bindings": {"snapshot_ids": [], "metric_ids": [], "asset_keys": [], "scope": "", "brand_ids": []},
                    "action_name": action_name,
                },
            },
            {
                "key": "end",
                "type": "end",
                "title": "完成",
                "config": {
                    "instruction": "流程完成并留存",
                    "expected_user_info": [],
                    "allowed_actions": ["continue_flow"],
                    "knowledge_scope": {"knowledge_base_ids": [], "retrieval_hint": ""},
                    "data_bindings": {"snapshot_ids": [], "metric_ids": [], "asset_keys": [], "scope": "", "brand_ids": []},
                    "action_name": "",
                },
            },
        ],
        "edges": [
            {"source": "collect.scope", "target": "execute.skill", "condition": "always", "priority": 1},
            {"source": "execute.skill", "target": "end", "condition": "always", "priority": 1},
        ],
        "meta": {"source": "skill_publish", "asset_id": asset.id, "skill_id": asset.skill_id},
    }
