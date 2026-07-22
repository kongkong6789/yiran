"""企微待办技能：在协作会话中由平台代执行（非沙箱脚本）。"""
from __future__ import annotations

import json
import logging
import re
import uuid
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from apps.core.models import AuditLog, WorkTodo
from apps.core.organizations import current_organization

from .access import resolve_accessible_config
from .models import UserWeComBinding, WeComContact

logger = logging.getLogger(__name__)

WECOM_TODO_SKILL_IDS = {
    "wecom-todo",
    "qiwei-daiban",
    "enterprise-wecom-todo",
    "企微待办",
}

_FILLER_RE = re.compile(
    r"(请|麻烦|帮我|帮忙|帮|用|技能|企业微信|企微|微信|创建|新建|发起|同步|发送|建个|建一个|"
    r"做一个|做个|记一下|记下|提醒|通知|一个|一条|个|条|的|一下|给|向|把|将|成|为|"
    r"待办|任务|事项|内容是|内容为|标题是|标题为)"
)
_RETRY_RE = re.compile(r"(再试|重试|再来一次|重新(创建|发|同步)|按刚才|按上面|上次(那个|的)?|还是刚才)")
_NAME_SEP_RE = re.compile(r"[·•\-—–|/]|[:：]")

_LLM_EXTRACT_SYSTEM = """你是企微待办意图解析器。根据用户消息（及必要时的对话历史）提取要创建的企业微信待办。
只输出一个 JSON 对象，不要 Markdown，不要解释。

字段：
- ok: boolean，能否提取出明确待办
- assignee_names: string[]，负责人姓名（来自用户说法或候选通讯录；没有则 []）
- use_self: boolean，未指定负责人时是否发给本人（assignee_names 为空时通常为 true）
- title: string，待办标题（简短事项，不要夹带「给谁」）
- description: string，可选补充说明，可空字符串
- error: string，ok=false 时说明缺什么

规则：
1. 理解自然语言与口语，不要要求用户使用固定模板。
2. 若消息像「再试一次/重试」，优先从历史用户消息里还原姓名与事项。
3. assignee_names 优先使用【通讯录候选】里的准确姓名；用户说的别名尽量映射到候选。
4. 用户只说事项没说人 → use_self=true, assignee_names=[]。
5. title 必须是事项本身，例如「今天要读书」，不要写成「给黄炜龙创建待办」。
"""


@dataclass
class ParsedWeComTodoRequest:
    title: str
    description: str
    assignee_names: list[str]
    use_self: bool


def is_wecom_todo_skill(skill) -> bool:
    skill_id = str(getattr(skill, "skill_id", "") or "").strip().lower()
    name = str(getattr(skill, "name", "") or "").strip().lower()
    if skill_id in WECOM_TODO_SKILL_IDS:
        return True
    if "wecom-todo" in skill_id or "qiwei" in skill_id:
        return True
    return "企微待办" in name or "企业微信待办" in name or "wecom todo" in name


def _clean_message(message: str) -> str:
    text = str(message or "")
    text = re.sub(r"@[\w\-一-龥]+", " ", text)
    text = re.sub(r"[`*_#>]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _split_names(names_raw: str) -> list[str]:
    parts = [
        part.strip(" ，,、/和与及的")
        for part in re.split(r"[，,、/]|和|与|及", names_raw or "")
        if part.strip(" ，,、/和与及的")
    ]
    blocked = {"创建", "新建", "发起", "同步", "发送", "一个", "一条", "待办", "企微", "企业微信"}
    return [name for name in parts if name and name not in blocked and len(name) <= 32]


def _finalize(title: str, description: str, assignee_names: list[str]) -> ParsedWeComTodoRequest | None:
    title = (title or "").strip()
    description = (description or "").strip()
    if "\n" in title and not description:
        title, description = title.split("\n", 1)
        title = title.strip()
        description = description.strip()
    title = re.sub(r"\s+", " ", title).strip(" ：:，,。.;；")
    if not title:
        return None
    names = [n for n in assignee_names if n]
    return ParsedWeComTodoRequest(
        title=title[:120],
        description=(description or f"来自协作技能自动创建：{title}")[:4000],
        assignee_names=names,
        use_self=not names,
    )


def _parse_json_object(raw: str) -> dict | None:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            data = json.loads(text[start : end + 1])
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    return data if isinstance(data, dict) else None


def parsed_from_llm_payload(payload: dict | None) -> ParsedWeComTodoRequest | None:
    """把模型 JSON 转成 ParsedWeComTodoRequest（供测试与执行共用）。"""
    if not payload or not payload.get("ok"):
        return None
    names_raw = payload.get("assignee_names") or []
    if isinstance(names_raw, str):
        names = _split_names(names_raw)
    elif isinstance(names_raw, list):
        names = [str(item).strip() for item in names_raw if str(item).strip()]
    else:
        names = []
    use_self = bool(payload.get("use_self")) if "use_self" in payload else not names
    if use_self:
        names = []
    title = str(payload.get("title") or "").strip()
    description = str(payload.get("description") or "").strip()
    return _finalize(title, description, names)


def _candidate_names_for_prompt(message: str, known_names: list[str]) -> list[str]:
    """优先给出消息里出现的通讯录姓名；没有则给空，避免把整本通讯录塞进 prompt。"""
    text = _clean_message(message)
    hit = [name for name in known_names if name and name in text]
    hit = sorted(dict.fromkeys(hit), key=len, reverse=True)
    return hit[:30]


def _history_lines(history: list[dict] | None, *, limit: int = 8) -> str:
    if not history:
        return "(无)"
    lines: list[str] = []
    for item in history[-limit:]:
        role = str(item.get("role") or "user")
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        lines.append(f"{role}: {content[:500]}")
    return "\n".join(lines) or "(无)"


def extract_wecom_todo_intent_with_llm(
    *,
    user,
    message: str,
    history: list[dict] | None = None,
    known_names: list[str] | None = None,
) -> ParsedWeComTodoRequest | None:
    """用当前用户模型理解自然语言，产出结构化待办意图。"""
    known_names = known_names or []
    candidates = _candidate_names_for_prompt(message, known_names)
    if not candidates and history:
        blob = " ".join(str(item.get("content") or "") for item in history[-6:])
        candidates = _candidate_names_for_prompt(blob, known_names)

    prompt = (
        f"【当前用户消息】\n{_clean_message(message) or message}\n\n"
        f"【最近对话】\n{_history_lines(history)}\n\n"
        f"【通讯录候选姓名】\n"
        f"{('、'.join(candidates) if candidates else '（消息中未直接命中通讯录姓名，请按语义提取；没有则 use_self=true）')}\n\n"
        "请输出 JSON。"
    )
    try:
        from apps.council import llm

        result = llm.chat_messages_result(
            _LLM_EXTRACT_SYSTEM,
            [{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=400,
            timeout=45,
            llm_user=user,
            allow_images=False,
        )
    except Exception:
        logger.exception("wecom todo LLM intent extraction failed")
        return None

    if result.get("error") or not result.get("content"):
        logger.warning(
            "wecom todo LLM intent empty: configured=%s error=%s",
            result.get("configured"),
            (result.get("error") or "")[:200],
        )
        return None

    payload = _parse_json_object(result.get("content") or "")
    parsed = parsed_from_llm_payload(payload)
    if parsed:
        return parsed
    if payload and (payload.get("title") or payload.get("assignee_names")):
        return parsed_from_llm_payload({**payload, "ok": True})
    return None


def _parse_by_patterns(raw: str) -> ParsedWeComTodoRequest | None:
    patterns = [
        r"^(?:请|麻烦)?(?:帮|给|向)(?P<names>.+?)(?:创建|建|发|同步|做)?(?:一个|个|一条|条)?(?:企业微信|企微)?待办[：:\s]*(?P<body>.+)$",
        r"^(?:请|麻烦)?(?:帮|给|向)(?P<names>.+?)(?:企业微信|企微)?待办[：:\s]*(?P<body>.+)$",
        r"^(?:把|将)(?P<body>.+?)(?:创建|同步|发)(?:成|为|给)?(?P<names>.+?)(?:的)?(?:企业微信|企微)?待办$",
        r"^(?:创建|新建|发起)(?:一个|个|一条|条)?(?:企业微信|企微)?待办[：:\s]*(?:给(?P<names>.+?)[，,：:\s]+)(?P<body>.+)$",
        r"^(?:创建|新建|发起)(?:一个|个|一条|条)?(?:企业微信|企微)?待办[：:\s]*(?P<body>.+)$",
        r"^(?:请|麻烦)?帮(?P<names>.+?)(?:建|创建|做)(?:一个|个|一条|条)?(?:企业微信|企微)?待办[：:\s]*(?P<body>.+)$",
    ]
    for pattern in patterns:
        m = re.match(pattern, raw, flags=re.IGNORECASE)
        if not m:
            continue
        names = _split_names(m.groupdict().get("names") or "")
        body = (m.groupdict().get("body") or "").strip()
        if not names and body:
            names, body = _split_name_title_body(body)
        parsed = _finalize(body, "", names)
        if parsed:
            return parsed
    return None


def _split_name_title_body(body: str) -> tuple[list[str], str]:
    text = (body or "").strip()
    if not text:
        return [], ""
    parts = _NAME_SEP_RE.split(text, maxsplit=1)
    if len(parts) == 2:
        left, right = parts[0].strip(), parts[1].strip()
        if 1 <= len(left) <= 16 and right:
            return [left], right
    spaced = re.match(r"^([\u4e00-\u9fffA-Za-z]{1,16})\s+(.+)$", text)
    if spaced:
        return [spaced.group(1).strip()], spaced.group(2).strip()
    return [], text


def _match_known_names(text: str, known_names: list[str]) -> tuple[list[str], str]:
    if not text or not known_names:
        return [], text
    remaining = text
    found: list[str] = []
    for name in sorted({n for n in known_names if n}, key=len, reverse=True):
        if name in remaining:
            found.append(name)
            remaining = remaining.replace(name, " ", 1)
    if not found:
        return [], text
    remaining = _FILLER_RE.sub(" ", remaining)
    remaining = re.sub(r"\s+", " ", remaining).strip(" ：:，,。.;；·•-")
    return found, remaining


def _parse_free_text(raw: str, known_names: list[str] | None = None) -> ParsedWeComTodoRequest | None:
    text = raw.strip()
    if not text:
        return None
    if known_names:
        names, title = _match_known_names(text, known_names)
        if names and title:
            return _finalize(title, "", names)
        if names and not title:
            return None
    names, title = _split_name_title_body(text)
    if names and title:
        title = _FILLER_RE.sub(" ", title)
        title = re.sub(r"\s+", " ", title).strip(" ：:，,。.;；")
        if title:
            return _finalize(title, "", names)
    title = _FILLER_RE.sub(" ", text)
    title = re.sub(r"\s+", " ", title).strip(" ：:，,。.;；")
    if title and title != text.strip() and len(title) >= 2:
        return _finalize(title, "", [])
    if len(text) >= 2:
        return _finalize(text, "", [])
    return None


def _history_candidate(history: list[dict] | None) -> str:
    if not history:
        return ""
    for item in reversed(history):
        role = str(item.get("role") or "")
        content = str(item.get("content") or "").strip()
        if role not in {"user", ""} or not content:
            continue
        if _RETRY_RE.search(content) and len(content) < 40:
            continue
        cleaned = _clean_message(content)
        if cleaned:
            return cleaned
    return ""


def parse_wecom_todo_request(
    message: str,
    *,
    known_names: list[str] | None = None,
    history: list[dict] | None = None,
    skill_explicit: bool = False,
) -> ParsedWeComTodoRequest | None:
    """规则解析（LLM 失败时的兜底）。"""
    raw = _clean_message(message)
    if not raw:
        return None
    raw = re.sub(
        r"^(请|麻烦)?(帮我|帮忙)?(用)?(企微待办|企业微信待办|wecom[- ]?todo)?(技能)?[，,:\s]*",
        "",
        raw,
        flags=re.IGNORECASE,
    ).strip()
    if not raw:
        return None

    if _RETRY_RE.search(raw) and (not re.search(r"待办|任务", raw) or len(raw) < 24):
        prior = _history_candidate(history)
        if prior:
            raw = prior

    parsed = _parse_by_patterns(raw)
    if parsed:
        if parsed.use_self and known_names:
            names, title = _match_known_names(parsed.title, known_names)
            if names and title:
                return _finalize(title, parsed.description, names)
            names, title = _split_name_title_body(parsed.title)
            if names and title:
                return _finalize(title, parsed.description, names)
        return parsed

    soft = re.search(r"(?:企业微信|企微)?待办[：:\s]*(.+)$", raw, flags=re.IGNORECASE)
    if soft:
        body = soft.group(1).strip()
        names, title = _split_name_title_body(body)
        if known_names and not names:
            names, title = _match_known_names(body, known_names)
            if not title:
                title = body
        parsed = _finalize(title or body, "", names)
        if parsed:
            return parsed

    if skill_explicit or known_names or re.search(r"(企业微信|企微|待办)", raw):
        return _parse_free_text(raw, known_names=known_names)
    return _parse_free_text(raw, known_names=known_names)


def _contact_display_names(config) -> list[str]:
    return list(
        WeComContact.objects.filter(config=config, available=True)
        .exclude(name="")
        .values_list("name", flat=True)[:2000]
    )


def _find_contacts_by_names(*, config, names: list[str]) -> tuple[list[WeComContact], list[str], list[str]]:
    found: list[WeComContact] = []
    missing: list[str] = []
    ambiguous: list[str] = []
    for name in names:
        qs = list(
            WeComContact.objects.filter(
                config=config,
                available=True,
                name=name,
            ).order_by("id")[:5]
        )
        if not qs:
            qs = list(
                WeComContact.objects.filter(
                    config=config,
                    available=True,
                    name__icontains=name,
                ).order_by("id")[:5]
            )
        if not qs:
            missing.append(name)
        elif len(qs) > 1 and not any(item.name == name for item in qs):
            ambiguous.append(f"{name}（候选：{' / '.join(item.name for item in qs)}）")
        else:
            exact = next((item for item in qs if item.name == name), qs[0])
            if exact.id not in {item.id for item in found}:
                found.append(exact)
    return found, missing, ambiguous


def _self_contact(user, config) -> WeComContact | None:
    binding = UserWeComBinding.objects.filter(
        platform_user=user,
        status=UserWeComBinding.Status.MATCHED,
        wecom_config=config,
    ).first()
    if not binding or not binding.wecom_userid:
        return None
    return WeComContact.objects.filter(
        config=config,
        wecom_userid=binding.wecom_userid,
        available=True,
    ).first()


def create_wecom_todos_for_contacts(
    *,
    user,
    title: str,
    description: str,
    contacts: list[WeComContact],
    priority: str = WorkTodo.Priority.NORMAL,
) -> dict:
    organization = current_organization(user)
    if not organization:
        return {"ok": False, "error": "当前账号尚未加入企业。"}
    if not contacts:
        return {"ok": False, "error": "未指定企业微信负责人。"}

    sync_group_id = uuid.uuid4()
    created_ids: list[str] = []
    with transaction.atomic():
        for contact in contacts:
            linked = UserWeComBinding.objects.filter(
                wecom_config=contact.config,
                wecom_userid=contact.wecom_userid,
                status=UserWeComBinding.Status.MATCHED,
            ).first()
            row = WorkTodo.objects.create(
                organization=organization,
                creator=user,
                assignee=None,
                linked_platform_user_id=linked.platform_user_id if linked else None,
                recipient_type=WorkTodo.RecipientType.WECOM,
                recipient_name=contact.name,
                wecom_contact=contact,
                title=title[:120],
                description=(description or "")[:4000],
                priority=priority,
                due_at=None,
                remind_types=[0],
                sync_group_id=sync_group_id,
                sync_requested=True,
                sync_status=WorkTodo.SyncStatus.PENDING,
                sync_next_retry_at=timezone.now(),
            )
            created_ids.append(str(row.public_id))
        AuditLog.objects.create(
            trace_id=f"work-todo-skill-{created_ids[0]}",
            actor=user.username,
            intent="技能创建企业微信待办",
            action="work.todo.create.skill",
            payload={
                "organization_id": organization.id,
                "contact_names": [item.name for item in contacts],
            },
            decision=AuditLog.Decision.ALLOW,
            result={"created": True, "ids": created_ids},
        )
    from .todo_sync_service import sync_work_todo_group

    sync_result = sync_work_todo_group(sync_group_id, force=True)
    sync_status = sync_result.get("syncStatus", "pending")
    recipients = "、".join(item.name for item in contacts)
    if sync_status == "synced":
        detail = f"已为企业微信成员 {recipients} 创建待办，并同步到企业微信。"
    elif sync_status == "failed":
        detail = (
            f"已为企业微信成员 {recipients} 创建平台待办，但企微同步失败："
            f"{sync_result.get('detail') or '请稍后在待办页重试'}。"
        )
    else:
        detail = f"已为企业微信成员 {recipients} 创建待办，企微同步进行中。"
    return {
        "ok": True,
        "ids": created_ids,
        "recipients": [item.name for item in contacts],
        "syncStatus": sync_status,
        "detail": detail,
    }


def execute_wecom_todo_skill(
    *,
    user,
    message: str,
    history: list[dict] | None = None,
    skill_explicit: bool = True,
) -> dict:
    """AI 理解意图 → 平台创建企微待办。"""
    organization = current_organization(user)
    if not organization:
        return {"ok": False, "error": "当前账号尚未加入企业，无法创建企业微信待办。"}

    config = resolve_accessible_config(user)
    if not config or not config.configured:
        return {
            "ok": False,
            "error": "当前企业尚未配置可用的企业微信通讯录/待办能力，请先在「企微绑定」中完成配置。",
        }

    known_names = _contact_display_names(config)

    # 1) 先让模型做语义结构化（用户期望的 AI 技能路径）
    parsed = extract_wecom_todo_intent_with_llm(
        user=user,
        message=message,
        history=history,
        known_names=known_names,
    )
    parse_source = "llm" if parsed else ""

    # 2) 模型失败时再规则兜底
    if not parsed:
        parsed = parse_wecom_todo_request(
            message,
            known_names=known_names,
            history=history,
            skill_explicit=skill_explicit,
        )
        parse_source = "rules" if parsed else ""

    if not parsed:
        return {
            "ok": False,
            "error": (
                "还没理解要创建的待办事项。请再说一下负责人和做什么，"
                "例如「黄炜龙今天要读书」；未写姓名时默认发给已绑定的本人。"
            ),
        }

    contacts: list[WeComContact] = []
    missing: list[str] = []
    ambiguous: list[str] = []

    if parsed.use_self:
        self_contact = _self_contact(user, config)
        if not self_contact:
            return {
                "ok": False,
                "error": (
                    "未指定负责人，且当前账号尚未绑定企业微信成员，无法默认发给本人。"
                    "请先绑定企微，或在消息里写上姓名。"
                ),
            }
        contacts = [self_contact]
    else:
        contacts, missing, ambiguous = _find_contacts_by_names(
            config=config, names=parsed.assignee_names,
        )
        if missing or ambiguous or not contacts:
            parts = []
            if missing:
                parts.append(f"通讯录未找到：{('、'.join(missing))}")
            if ambiguous:
                parts.append(f"姓名不唯一：{('；'.join(ambiguous))}")
            if not contacts and not parts:
                parts.append("未匹配到任何企业微信成员")
            return {
                "ok": False,
                "error": "；".join(parts) + "。请核对姓名后重试，或使用右键消息「发起企微待办」手动选择。",
                "missing": missing,
                "ambiguous": ambiguous,
            }

    result = create_wecom_todos_for_contacts(
        user=user,
        title=parsed.title,
        description=parsed.description,
        contacts=contacts,
    )
    if result.get("ok"):
        result["title"] = parsed.title
        result["assignee_names"] = [item.name for item in contacts]
        result["used_self"] = parsed.use_self
        result["parse_source"] = parse_source
    return result


def format_wecom_todo_skill_result(result: dict) -> str:
    if not result:
        return ""
    if result.get("ok"):
        recipients = "、".join(result.get("assignee_names") or result.get("recipients") or [])
        return (
            "【企微待办技能执行结果】\n"
            f"- 状态：成功\n"
            f"- 标题：{result.get('title') or ''}\n"
            f"- 负责人：{recipients}\n"
            f"- 说明：{result.get('detail') or '已创建'}\n"
            "请用一两句话向用户确认结果；若需修改负责人，可提示其右键消息使用「发起企微待办」。"
        )
    return (
        "【企微待办技能执行结果】\n"
        f"- 状态：失败\n"
        f"- 原因：{result.get('error') or '未知错误'}\n"
        "请直接告诉用户失败原因与下一步，不要要求用户必须使用固定模板句式。"
    )


def try_execute_wecom_todo_skills(
    skills: list,
    message: str,
    user,
    *,
    history: list[dict] | None = None,
) -> list[dict]:
    blocks: list[dict] = []
    for skill in skills or []:
        if not is_wecom_todo_skill(skill):
            continue
        result = execute_wecom_todo_skill(
            user=user,
            message=message,
            history=history,
            skill_explicit=True,
        )
        blocks.append({
            "skill_id": getattr(skill, "skill_id", "wecom-todo"),
            "skill_name": getattr(skill, "name", "企微待办"),
            "ok": bool(result.get("ok")),
            "platform_action": "wecom_todo",
            "result": result,
            "stdout": format_wecom_todo_skill_result(result),
            "error": "" if result.get("ok") else (result.get("error") or "创建失败"),
        })
    return blocks
