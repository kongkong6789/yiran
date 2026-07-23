"""小策 bot：按 Agent 绑定的已发布 SOP 调用编排运行时。"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any

from django.db.models import Q

from apps.core.organizations import current_organization
from apps.core.progress import emit_progress
from apps.council.models import AgentProfile
from apps.orchestration.models import SopDefinition, SopVersion
from apps.orchestration.sop_runtime import execute_sop_version, match_sop

logger = logging.getLogger(__name__)

XIAOCE_AGENT_CODE = "xiaoce"

_RUN_INTENT_RE = re.compile(
    r"(跑一下|帮我跑|执行一下|运行一下|启动一下|"
    r"跑[这本]?个?流程|执行[这本]?个?流程|运行[这本]?个?流程|"
    r"跑\s*sop|执行\s*sop|运行\s*sop|"
    r"调用.{0,8}(sop|流程)|帮我(出|做|生成).{0,16}(周报|日报|月报)|"
    r"(获取|拉取|汇总).{0,24}(销售|周报|明细))",
    re.IGNORECASE,
)
_EXPLICIT_KEY_RE = re.compile(
    r"(?:sop[_:\s]|流程\s*(?:key|键)?\s*[:：]\s*)([a-zA-Z0-9][a-zA-Z0-9_.\-]{1,95})",
    re.IGNORECASE,
)
_CONFIRM_RE = re.compile(
    r"^\s*(确认|继续|好的|是的|执行吧|继续执行|确认执行|继续跑)\s*[。.!！]?\s*$",
    re.IGNORECASE,
)
_CANCEL_PENDING_RE = re.compile(
    r"^\s*(取消|算了|不跑了|停止|别跑了|取消流程)\s*[。.!！]?\s*$",
    re.IGNORECASE,
)
_DATE_RANGE_RE = re.compile(
    r"(?P<a_m>\d{1,2})\s*[./月]\s*(?P<a_d>\d{1,2})\s*日?"
    r"\s*[-~～—至到]+\s*"
    r"(?P<b_m>\d{1,2})\s*[./月]\s*(?P<b_d>\d{1,2})\s*日?",
)
_BRAND_EXPLICIT_RE = re.compile(
    r"(?:品牌|brand)\s*[:：]?\s*([A-Za-z][A-Za-z0-9\-_]{1,40}|[\u4e00-\u9fff]{2,20})",
    re.IGNORECASE,
)
_FIELD_LABELS = {
    "date_range": "统计日期范围",
    "brand": "品牌",
    "日期": "统计日期范围",
    "品牌": "品牌",
    "周期": "统计周期",
    "范围": "统计范围",
    "店铺": "店铺",
}
_STOPWORDS = {
    "获取", "帮我", "生成", "汇总", "天猫", "销售", "明细", "周报", "日报", "月报",
    "按照", "模版", "模板", "趋势", "重点", "单品", "本地版", "流程", "执行", "运行",
    "调用", "请", "需要", "分析", "店铺", "数据", "报告",
}


def _xiaoce_agent_qs(organization, *, active_only: bool = True):
    qs = AgentProfile.objects.filter(organization=organization)
    if active_only:
        qs = qs.filter(
            is_active=True,
            lifecycle_status=AgentProfile.LifecycleStatus.PUBLISHED,
        )
    else:
        qs = qs.exclude(lifecycle_status=AgentProfile.LifecycleStatus.ARCHIVED)
    return qs


def resolve_xiaoce_agent(organization, *, active_only: bool = True) -> AgentProfile | None:
    if organization is None:
        return None
    qs = _xiaoce_agent_qs(organization, active_only=active_only)
    by_code = qs.filter(employee_code__iexact=XIAOCE_AGENT_CODE).order_by("id").first()
    if by_code is not None:
        return by_code
    return (
        qs.filter(Q(name="小策") | Q(name__iexact="xiaoce"))
        .order_by("id")
        .first()
    )


def bound_sop_keys(agent: AgentProfile | None) -> list[str]:
    if agent is None:
        return []
    raw = agent.sop_keys if isinstance(agent.sop_keys, list) else []
    return list(dict.fromkeys(str(item).strip() for item in raw if str(item).strip()))


def _published_versions_for_keys(*, organization, keys: list[str]) -> list[SopVersion]:
    if not keys:
        return []
    definitions = list(
        SopDefinition.objects.filter(
            Q(organization=organization) | Q(organization__isnull=True),
            status=SopDefinition.Status.PUBLISHED,
            sop_key__in=keys,
        ).select_related("organization")
    )
    by_key: dict[str, SopDefinition] = {}
    for definition in definitions:
        prev = by_key.get(definition.sop_key)
        if prev is None:
            by_key[definition.sop_key] = definition
            continue
        if prev.organization_id is None and definition.organization_id is not None:
            by_key[definition.sop_key] = definition
    versions: list[SopVersion] = []
    for key in keys:
        definition = by_key.get(key)
        if definition is None or not definition.current_version:
            continue
        version = definition.versions.filter(
            version=definition.current_version,
            status=SopVersion.Status.PUBLISHED,
        ).first()
        if version is not None:
            versions.append(version)
    return versions


_LIST_SOP_RE = re.compile(
    r"(有哪些|有什么|哪些|什么).{0,8}(sop|流程|周报|日报)|"
    r"(sop|流程).{0,8}(有哪些|有什么|列表|清单|可以|能用|试用)|"
    r"(支持|能跑|会跑).{0,8}(哪些|什么).{0,6}(sop|流程)",
    re.IGNORECASE,
)
_ASK_SOP_RE = re.compile(
    r"(你不是有|不是有|有没有|有个|那个).{0,16}(sop|流程|周报|日报)|"
    r"(sop|流程).{0,8}(叫|名叫|名称)|"
    r"天猫销售.{0,4}(日|周)报",
    re.IGNORECASE,
)


def looks_like_sop_meta_question(text: str) -> bool:
    cleaned = str(text or "").strip()
    if not cleaned:
        return False
    return bool(_LIST_SOP_RE.search(cleaned) or _ASK_SOP_RE.search(cleaned))


def _format_bound_catalog(versions: list[SopVersion]) -> str:
    if not versions:
        return "当前还没有绑定可调用的已发布 SOP。"
    lines = ["我当前可调用的已发布 SOP："]
    for version in versions[:20]:
        definition = version.definition
        lines.append(f"- 《{definition.name}》（`{definition.sop_key}`）")
    lines.append("直接说「跑一下《名称》」或带上品牌和日期，我就可以执行。")
    return "\n".join(lines)


def _soft_match_bound_versions(text: str, versions: list[SopVersion]) -> list[SopVersion]:
    """宽松点名：日报/周报、本地库/本地版 等近义也能对上。"""
    cleaned = _normalize_name(text)
    if not cleaned:
        return []
    hits: list[SopVersion] = []
    for version in versions:
        name = _normalize_name(version.definition.name)
        soft = _normalize_name(re.sub(r"[（(].*?[）)]", "", version.definition.name))
        aliases = {
            name,
            soft,
            name.replace("周报", "日报").replace("本地版", "本地库"),
            name.replace("日报", "周报").replace("本地库", "本地版"),
            soft.replace("周报", "日报"),
            soft.replace("日报", "周报"),
        }
        if any(alias and alias in cleaned for alias in aliases):
            hits.append(version)
            continue
        # token overlap: 天猫+销售+(日|周)报
        if "天猫" in cleaned and "销售" in cleaned and (("周报" in cleaned) or ("日报" in cleaned)):
            if "天猫" in name and "销售" in name and (("周报" in name) or ("日报" in name)):
                hits.append(version)
    return list({item.id: item for item in hits}.values())


def looks_like_sop_run_intent(text: str) -> bool:
    cleaned = str(text or "").strip()
    if not cleaned:
        return False
    if _EXPLICIT_KEY_RE.search(cleaned):
        return True
    return bool(_RUN_INTENT_RE.search(cleaned))


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "").strip().lower())


def _collect_expected_fields(version: SopVersion | None) -> list[str]:
    if version is None:
        return []
    fields: list[str] = []
    for node in (version.graph or {}).get("nodes") or []:
        if not isinstance(node, dict) or node.get("type") != "collect_info":
            continue
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        for item in config.get("expected_user_info") or []:
            name = str(item).strip()
            if name and name not in fields:
                fields.append(name)
    return fields


def _field_label(field: str) -> str:
    key = str(field or "").strip()
    if key.startswith("_confirm_"):
        return "人工确认"
    return _FIELD_LABELS.get(key, key)


def _collect_instruction(version: SopVersion | None, missing: list[str]) -> str:
    if version is None:
        return ""
    for node in (version.graph or {}).get("nodes") or []:
        if not isinstance(node, dict) or node.get("type") != "collect_info":
            continue
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        expected = [str(item) for item in (config.get("expected_user_info") or [])]
        if missing and not any(item in expected for item in missing):
            continue
        instruction = str(config.get("instruction") or "").strip()
        if instruction:
            return instruction
    return ""


def extract_slots_from_text(text: str, missing: list[str] | None = None) -> dict[str, str]:
    """从自然语言里抽出常见槽位（品牌、日期范围等）。"""
    cleaned = str(text or "").strip()
    if not cleaned:
        return {}
    wanted = [str(item).strip() for item in (missing or []) if str(item).strip()]
    want_date = (not wanted) or any(item in wanted for item in ("date_range", "日期", "周期", "范围"))
    want_brand = (not wanted) or any(item in wanted for item in ("brand", "品牌"))
    out: dict[str, str] = {}

    date_match = _DATE_RANGE_RE.search(cleaned)
    if want_date and date_match:
        date_value = (
            f"{int(date_match.group('a_m'))}.{int(date_match.group('a_d'))}"
            f"-{int(date_match.group('b_m'))}.{int(date_match.group('b_d'))}"
        )
        date_key = next(
            (item for item in ("date_range", "日期", "周期", "范围") if (not wanted) or item in wanted),
            "date_range",
        )
        if wanted:
            date_key = next((item for item in ("date_range", "日期", "周期", "范围") if item in wanted), date_key)
        out[date_key] = date_value

    if want_brand:
        brand_key = next(
            (item for item in ("brand", "品牌") if (not wanted) or item in wanted),
            "brand",
        )
        if wanted:
            brand_key = next((item for item in ("brand", "品牌") if item in wanted), brand_key)
        brand_match = _BRAND_EXPLICIT_RE.search(cleaned)
        if brand_match:
            out[brand_key] = brand_match.group(1).strip()
        else:
            search_region = cleaned[: date_match.start()] if date_match else cleaned
            tokens = re.findall(r"[A-Za-z][A-Za-z0-9\-_]{1,40}|[\u4e00-\u9fff]{2,12}", search_region)
            candidates = [token for token in tokens if token not in _STOPWORDS and token.lower() not in {"tmall", "sop"}]
            latin = [token for token in candidates if re.match(r"^[A-Za-z]", token)]
            if latin:
                out[brand_key] = latin[-1]
            elif candidates:
                out[brand_key] = candidates[-1]
    return out


def match_bound_sop_version(
    *,
    text: str,
    versions: list[SopVersion],
    organization,
    user,
) -> SopVersion | list[SopVersion] | None:
    if not versions:
        return None
    cleaned = str(text or "").strip()
    explicit = ""
    match = _EXPLICIT_KEY_RE.search(cleaned)
    if match:
        explicit = match.group(1).strip()
    by_key = {version.definition.sop_key: version for version in versions}

    if explicit:
        return by_key.get(explicit)

    matched = match_sop(
        text=cleaned,
        payload={},
        organization=organization,
        user=user,
    )
    if matched is not None and matched.definition.sop_key in by_key:
        return by_key[matched.definition.sop_key]

    normalized = _normalize_name(cleaned)
    name_hits: list[SopVersion] = []
    example_hits: list[SopVersion] = []
    for version in versions:
        definition = version.definition
        name = _normalize_name(definition.name)
        if name and name in normalized:
            name_hits.append(version)
            continue
        # Soft name hit: key fragments like 天猫销售周报
        soft = _normalize_name(re.sub(r"[（(].*?[）)]", "", definition.name))
        if soft and soft in normalized:
            name_hits.append(version)
            continue
        for example in version.utterance_examples or []:
            sample = _normalize_name(str(example))
            if sample and (sample in normalized or normalized in sample):
                example_hits.append(version)
                break

    unique_name = list({item.id: item for item in name_hits}.values())
    if len(unique_name) == 1:
        return unique_name[0]
    if len(unique_name) > 1:
        return unique_name

    unique_examples = list({item.id: item for item in example_hits}.values())
    if len(unique_examples) == 1:
        return unique_examples[0]
    if len(unique_examples) > 1:
        return unique_examples

    # Single bound SOP + strong run/report intent → use it directly.
    if len(versions) == 1 and looks_like_sop_run_intent(cleaned):
        return versions[0]
    return None


def _format_result_body(result: dict) -> str:
    payload = result.get("result") if isinstance(result.get("result"), dict) else {}
    for key in ("report_markdown", "user_message", "markdown", "summary", "message"):
        value = str(payload.get(key) or "").strip()
        if value:
            return value
    error = str(result.get("error") or payload.get("error") or "").strip()
    if error:
        return error
    return ""


def format_sop_reply(*, version: SopVersion, result: dict) -> str:
    name = version.definition.name
    decision = str(result.get("decision") or "").strip()
    missing = [str(item) for item in (result.get("missing") or []) if str(item).strip()]
    body = _format_result_body(result)

    if decision == "allow":
        if body:
            return body
        return f"《{name}》已生成完成。"

    if decision == "need_input":
        confirm_only = bool(missing) and all(item.startswith("_confirm_") for item in missing)
        if confirm_only:
            return (
                f"《{name}》已准备好，回复「确认」后继续生成。\n"
                "如果要改参数，直接说新的品牌和日期即可。"
            )
        labels = [_field_label(item) for item in missing if not item.startswith("_confirm_")]
        instruction = _collect_instruction(version, missing)
        lines = [f"要生成《{name}》，还差这两项信息："]
        if labels:
            lines = [f"要生成《{name}》，还需要："]
            for label in labels:
                lines.append(f"- {label}")
        if instruction:
            lines.append(instruction)
        lines.append("直接回复即可，例如：`Unove，7.6-7.16`")
        return "\n".join(lines)

    if decision == "handoff":
        return body or f"《{name}》需要人工接管，我先停在这里。"

    if body:
        return body
    error = str(result.get("error") or "").strip()
    if error:
        return f"《{name}》这次没跑完：{error}"
    return f"《{name}》这次没跑完，请换个说法再试一次。"


def _pending_from_room(room) -> dict | None:
    from .models import CollabMessage

    last_ai = (
        CollabMessage.objects.filter(room=room, msg_type="ai", ai_kind="xiaoce")
        .order_by("-id")
        .only("meta")
        .first()
    )
    if last_ai is None or not isinstance(last_ai.meta, dict):
        return None
    pending = last_ai.meta.get("sop_pending")
    return pending if isinstance(pending, dict) else None


def _parse_json_object(text: str) -> dict | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _catalog_for_llm(versions: list[SopVersion]) -> str:
    lines: list[str] = []
    for version in versions:
        definition = version.definition
        fields = _collect_expected_fields(version)
        field_hint = "、".join(_field_label(item) for item in fields[:6]) if fields else "无固定槽位"
        lines.append(
            f"- key=`{definition.sop_key}` name=《{definition.name}》 "
            f"常用槽位: {field_hint}"
        )
    return "\n".join(lines) if lines else "- （无可调用 SOP）"


def interpret_xiaoce_turn_with_llm(
    *,
    user,
    text: str,
    versions: list[SopVersion],
    pending: dict | None,
) -> dict[str, Any] | None:
    """用快模型判断本轮是跑 SOP / 续跑补参 / 取消 / 普通闲聊，并抽取槽位。"""
    from apps.council import llm

    if not llm.llm_available(user):
        return None

    pending_block = "无"
    if pending:
        missing = [str(item) for item in (pending.get("missing") or []) if str(item).strip()]
        pending_block = (
            f"sop_key=`{pending.get('sop_key')}` "
            f"missing={missing} "
            f"已有payload键={list((pending.get('payload') or {}).keys())}"
        )

    system = (
        "你是小策会话里的 SOP 路由器，只做结构化判断，不回答用户。\n"
        "根据用户这句话，判断意图，并抽取可填入 SOP 的槽位。\n"
        "只输出 JSON："
        '{"intent":"run_sop|resume|cancel|list_sops|ask_sop|chat","sop_key":"","slots":{},'
        '"confirm":false,"reason":"一句话"}。\n'
        "规则：\n"
        "1) intent=run_sop：用户想新开/执行某个已绑定 SOP（含周报、销售明细汇总等）。\n"
        "2) intent=resume：存在 pending 时，用户在补充参数、确认继续，或仍在完成同一流程。\n"
        "3) intent=cancel：明确取消当前 pending 流程。\n"
        "4) intent=list_sops：用户问有哪些/能试用哪些 SOP/流程。\n"
        "5) intent=ask_sop：用户点名确认某个 SOP 是否存在（如「你不是有天猫销售日报吗」）；"
        "即使名称略有出入（日报/周报、本地库/本地版），也尽量从可调用列表选最接近的 sop_key。\n"
        "6) intent=chat：普通闲聊/问答，与 SOP 能力无关；"
        "不要把「有没有某 SOP」当成知识库文档检索。\n"
        "7) 有 pending 时，除非用户明确换话题闲聊，否则优先 resume。\n"
        "8) sop_key 必须来自可调用列表；不确定则留空。\n"
        "9) slots 只填能从原文可靠抽出的字段，键名优先用列表中的英文槽位"
        "（如 brand、date_range），值为简洁字符串。\n"
        "10) 用户说确认/继续时 confirm=true。"
    )
    user_prompt = (
        f"可调用 SOP：\n{_catalog_for_llm(versions)}\n\n"
        f"当前 pending：{pending_block}\n\n"
        f"用户消息：{text}"
    )
    try:
        out = llm.chat(
            system,
            user_prompt,
            temperature=0.1,
            max_tokens=220,
            model=llm.fast_model(user),
            timeout=12,
            llm_user=user,
        )
    except Exception:
        logger.exception("xiaoce sop llm interpret failed")
        return None

    data = _parse_json_object(out or "")
    if not data:
        return None

    intent = str(data.get("intent") or "").strip().lower()
    if intent not in {"run_sop", "resume", "cancel", "list_sops", "ask_sop", "chat"}:
        return None
    sop_key = str(data.get("sop_key") or "").strip()
    allowed = {version.definition.sop_key for version in versions}
    if sop_key and sop_key not in allowed:
        # Allow pending key even if temporarily unbound.
        if not (pending and sop_key == str(pending.get("sop_key") or "").strip()):
            sop_key = ""
    slots_raw = data.get("slots") if isinstance(data.get("slots"), dict) else {}
    slots: dict[str, str] = {}
    for key, value in slots_raw.items():
        name = str(key).strip()
        text_value = str(value).strip()
        if name and text_value:
            slots[name] = text_value[:200]
    return {
        "intent": intent,
        "sop_key": sop_key,
        "slots": slots,
        "confirm": bool(data.get("confirm")),
        "reason": str(data.get("reason") or "").strip(),
        "source": "llm",
    }


def interpret_xiaoce_turn_rules(
    *,
    text: str,
    versions: list[SopVersion],
    pending: dict | None,
    organization,
    user,
) -> dict[str, Any]:
    """规则降级：无 LLM 或模型失败时使用。"""
    cleaned = str(text or "").strip()
    if pending and _CANCEL_PENDING_RE.match(cleaned):
        return {"intent": "cancel", "sop_key": "", "slots": {}, "confirm": False, "source": "rules"}
    if pending and cleaned:
        slots = extract_slots_from_text(cleaned, [str(x) for x in (pending.get("missing") or [])])
        return {
            "intent": "resume",
            "sop_key": str(pending.get("sop_key") or ""),
            "slots": slots,
            "confirm": bool(_CONFIRM_RE.match(cleaned)),
            "source": "rules",
        }
    if _LIST_SOP_RE.search(cleaned):
        return {"intent": "list_sops", "sop_key": "", "slots": {}, "confirm": False, "source": "rules"}
    if _ASK_SOP_RE.search(cleaned) or looks_like_sop_meta_question(cleaned):
        soft = _soft_match_bound_versions(cleaned, versions)
        sop_key = soft[0].definition.sop_key if len(soft) == 1 else ""
        return {
            "intent": "ask_sop",
            "sop_key": sop_key,
            "slots": {},
            "confirm": False,
            "source": "rules",
            "soft_matches": soft,
        }
    if not looks_like_sop_run_intent(cleaned):
        return {"intent": "chat", "sop_key": "", "slots": {}, "confirm": False, "source": "rules"}
    matched = match_bound_sop_version(
        text=cleaned,
        versions=versions,
        organization=organization,
        user=user,
    )
    if matched is None:
        soft = _soft_match_bound_versions(cleaned, versions)
        if len(soft) == 1:
            matched = soft[0]
        elif len(soft) > 1:
            matched = soft
    if matched is None or isinstance(matched, list):
        return {
            "intent": "run_sop",
            "sop_key": "",
            "slots": extract_slots_from_text(cleaned),
            "confirm": False,
            "source": "rules",
            "ambiguous": matched if isinstance(matched, list) else None,
        }
    return {
        "intent": "run_sop",
        "sop_key": matched.definition.sop_key,
        "slots": extract_slots_from_text(cleaned, _collect_expected_fields(matched)),
        "confirm": False,
        "source": "rules",
    }


def interpret_xiaoce_turn(
    *,
    user,
    text: str,
    versions: list[SopVersion],
    pending: dict | None,
    organization,
) -> dict[str, Any]:
    judged = interpret_xiaoce_turn_with_llm(
        user=user,
        text=text,
        versions=versions,
        pending=pending,
    )
    if judged is not None:
        return judged
    return interpret_xiaoce_turn_rules(
        text=text,
        versions=versions,
        pending=pending,
        organization=organization,
        user=user,
    )


def _apply_slots_to_payload(payload: dict, slots: dict[str, str], *, missing: list[str] | None = None) -> dict:
    next_payload = dict(payload or {})
    wanted = {str(item).strip() for item in (missing or []) if str(item).strip()}
    alias = {
        "日期": "date_range",
        "日期范围": "date_range",
        "品牌": "brand",
        "统计日期范围": "date_range",
    }
    for key, value in (slots or {}).items():
        target = alias.get(key, key)
        if wanted and target not in wanted:
            if target == "date_range" and "date_range" not in wanted and "日期" in wanted:
                target = "日期"
            elif target == "brand" and "brand" not in wanted and "品牌" in wanted:
                target = "品牌"
            elif target not in wanted:
                # Still accept unknown slot names that look useful.
                pass
        if value not in (None, ""):
            next_payload[target] = value
    return next_payload


def _build_resume_payload(pending: dict, text: str, *, slots: dict[str, str] | None = None, confirm: bool = False) -> dict:
    payload = dict(pending.get("payload") or {}) if isinstance(pending.get("payload"), dict) else {}
    missing = [str(item) for item in (pending.get("missing") or []) if str(item).strip()]
    if confirm or _CONFIRM_RE.match(text or ""):
        payload["_checkpoint_confirm"] = True
        confirmed = [str(item) for item in (payload.get("_confirmed_nodes") or []) if str(item).strip()]
        for item in missing:
            if item.startswith("_confirm_"):
                node_key = item[len("_confirm_") :]
                if node_key and node_key not in confirmed:
                    confirmed.append(node_key)
                payload[item] = True
        payload["_confirmed_nodes"] = confirmed

    payload = _apply_slots_to_payload(payload, slots or {}, missing=missing)

    # Rule fallback fill for any still-empty slots.
    extracted = extract_slots_from_text(text, missing or None)
    for key, value in extracted.items():
        if value and payload.get(key) in (None, "", []):
            payload[key] = value

    empty = [
        item
        for item in missing
        if not item.startswith("_confirm_") and payload.get(item) in (None, "", [])
    ]
    if len(empty) == 1 and not (slots or extracted) and not confirm:
        payload[empty[0]] = str(text or "").strip()
    return payload


def try_handle_xiaoce_sop(
    *,
    user,
    room,
    text: str,
    cancel_check=None,
    progress_callback=None,
) -> dict[str, Any] | None:
    """若应作为 SOP 调用处理则返回 {reply, meta}；否则返回 None 走普通问答。"""
    organization = current_organization(user)
    if organization is None:
        return None

    cleaned = str(text or "").strip()
    if not cleaned:
        return None

    pending = _pending_from_room(room)
    agent = resolve_xiaoce_agent(organization)
    if agent is None:
        disabled = resolve_xiaoce_agent(organization, active_only=False)
        if disabled is not None and (
            not disabled.is_active
            or disabled.lifecycle_status != AgentProfile.LifecycleStatus.PUBLISHED
        ):
            # 先用轻量规则看是否在谈 SOP，避免无谓打扰闲聊。
            if looks_like_sop_run_intent(cleaned) or pending:
                return {
                    "reply": (
                        "数字员工「小策」当前是停用状态，还不能跑流程。\n"
                        "请先在「智能体」里启用它，并勾选要开放的已发布 SOP。"
                    ),
                    "meta": {"sop_agent_disabled": True, "agent_id": disabled.id},
                }
            return None

    keys = bound_sop_keys(agent)
    if pending and str(pending.get("sop_key") or "").strip() and str(pending.get("sop_key")) not in keys:
        # Resume path can still use pending key.
        keys = list(dict.fromkeys([*keys, str(pending.get("sop_key")).strip()]))
    versions = _published_versions_for_keys(organization=organization, keys=keys)

    # 无绑定且无 pending：只在明显像跑流程/问 SOP 时提示，否则交给普通聊天。
    if not versions and not pending:
        if looks_like_sop_run_intent(cleaned) or looks_like_sop_meta_question(cleaned):
            return {
                "reply": (
                    "想跑流程的话，需要先给小策绑定已发布 SOP。\n"
                    "打开「智能体」→ 启用名为「小策」的数字员工 → 勾选 SOP 后保存，然后再说一次。"
                ),
                "meta": {"sop_unbound": True},
            }
        return None

    emit_progress(progress_callback, "understanding", "running")
    judged = interpret_xiaoce_turn(
        user=user,
        text=cleaned,
        versions=versions,
        pending=pending,
        organization=organization,
    )
    emit_progress(progress_callback, "understanding", "completed")

    intent = str(judged.get("intent") or "chat")
    slots = judged.get("slots") if isinstance(judged.get("slots"), dict) else {}
    confirm = bool(judged.get("confirm"))

    if intent == "chat":
        # 模型偶发漏判：点名/列举 SOP 时仍兜住，避免掉进知识库「SOP文档」检索。
        if looks_like_sop_meta_question(cleaned):
            intent = "list_sops" if _LIST_SOP_RE.search(cleaned) else "ask_sop"
        else:
            return None

    if intent == "list_sops":
        return {
            "reply": _format_bound_catalog(versions),
            "meta": {"sop_catalog": True, "sop_judge": judged},
        }

    if intent == "ask_sop":
        sop_key = str(judged.get("sop_key") or "").strip()
        version = next((item for item in versions if item.definition.sop_key == sop_key), None)
        soft = judged.get("soft_matches")
        if version is None:
            soft_hits = soft if isinstance(soft, list) else _soft_match_bound_versions(cleaned, versions)
            if len(soft_hits) == 1:
                version = soft_hits[0]
            elif len(soft_hits) > 1:
                catalog = "\n".join(f"- 《{item.definition.name}》" for item in soft_hits[:8])
                return {
                    "reply": (
                        "你说的名字和我这边略有差别，接近的可调用流程有：\n"
                        f"{catalog}\n"
                        "回复其中一个名称，或直接说「跑一下……」。"
                    ),
                    "meta": {"sop_ask": True, "sop_judge": judged},
                }
        if version is None and len(versions) == 1:
            version = versions[0]
        if version is None:
            return {
                "reply": (
                    "我这边没有完全同名的流程。\n"
                    f"{_format_bound_catalog(versions)}"
                ),
                "meta": {"sop_ask": True, "sop_judge": judged},
            }
        return {
            "reply": (
                f"有的。对应可调用流程是《{version.definition.name}》"
                f"（`{version.definition.sop_key}`）。\n"
                "如果说的是「日报/本地库」，我这边登记名是「周报/本地版」，是同一个绑定流程。\n"
                "直接说「跑一下天猫销售周报」或带上品牌和日期即可。"
            ),
            "meta": {
                "sop_ask": True,
                "sop_key": version.definition.sop_key,
                "sop_judge": judged,
            },
        }

    if intent == "cancel":
        return {
            "reply": "好的，已取消这次流程。需要时再说一声要跑哪个即可。",
            "meta": {"sop_pending_cleared": True, "sop_judge": judged},
        }

    if intent == "resume":
        if not pending:
            # 模型偶发误判：没有 pending 就当新开。
            intent = "run_sop"
        else:
            sop_key = str(judged.get("sop_key") or pending.get("sop_key") or "").strip()
            version = next((item for item in versions if item.definition.sop_key == sop_key), None)
            if version is None and sop_key:
                version = (_published_versions_for_keys(organization=organization, keys=[sop_key]) or [None])[0]
            if version is None:
                return {
                    "reply": "上次那个流程现在不可用了，请重新说一次要跑哪个。",
                    "meta": {"sop_pending_cleared": True, "sop_judge": judged},
                }
            payload = _build_resume_payload(pending, cleaned, slots=slots, confirm=confirm)
            trace_id = str(pending.get("trace_id") or "").strip() or f"xiaoce-sop-{uuid.uuid4().hex}"
            packed = _execute_and_pack(
                version=version,
                text=cleaned,
                payload=payload,
                user=user,
                organization=organization,
                trace_id=trace_id,
                cancel_check=cancel_check,
                progress_callback=progress_callback,
                agent=agent,
            )
            packed["meta"] = {**(packed.get("meta") or {}), "sop_judge": judged}
            return packed

    # run_sop
    if not versions:
        return {
            "reply": "小策还没有可调用的已发布 SOP，请先在智能体里绑定。",
            "meta": {"sop_unbound": True, "sop_judge": judged},
        }

    sop_key = str(judged.get("sop_key") or "").strip()
    version = next((item for item in versions if item.definition.sop_key == sop_key), None)
    if version is None:
        ambiguous = judged.get("ambiguous")
        if isinstance(ambiguous, list) and ambiguous:
            catalog = "\n".join(f"- {item.definition.name}" for item in ambiguous[:12])
            return {
                "reply": f"匹配到多个流程，请指定一个：\n{catalog}",
                "meta": {"sop_ambiguous": True, "sop_judge": judged},
            }
        if len(versions) == 1:
            version = versions[0]
        else:
            catalog = "\n".join(f"- {item.definition.name}" for item in versions[:12])
            return {
                "reply": (
                    "我理解你想跑流程，但还没定位到具体哪一个。当前可调用：\n"
                    f"{catalog}\n"
                    "直接说流程名称即可。"
                ),
                "meta": {"sop_ambiguous": True, "sop_judge": judged},
            }

    payload = {"_sop_key": version.definition.sop_key}
    payload = _apply_slots_to_payload(payload, slots, missing=_collect_expected_fields(version))
    # 规则再补一层，避免模型漏抽。
    for key, value in extract_slots_from_text(cleaned, _collect_expected_fields(version)).items():
        if value and payload.get(key) in (None, "", []):
            payload[key] = value
    packed = _execute_and_pack(
        version=version,
        text=cleaned,
        payload=payload,
        user=user,
        organization=organization,
        trace_id=f"xiaoce-sop-{uuid.uuid4().hex}",
        cancel_check=cancel_check,
        progress_callback=progress_callback,
        agent=agent,
    )
    packed["meta"] = {**(packed.get("meta") or {}), "sop_judge": judged}
    return packed


def _execute_and_pack(
    *,
    version: SopVersion,
    text: str,
    payload: dict,
    user,
    organization,
    trace_id: str,
    cancel_check=None,
    progress_callback=None,
    agent: AgentProfile | None,
) -> dict[str, Any]:
    from apps.core.cancellation import raise_if_cancelled

    raise_if_cancelled(cancel_check)
    emit_progress(progress_callback, "sop", "running")

    def on_progress(event: dict) -> None:
        if not isinstance(event, dict):
            return
        kind = str(event.get("kind") or "")
        if kind == "finish":
            status = str(event.get("status") or "")
            if status == "failed":
                emit_progress(progress_callback, "sop", "failed", error_code="stage_failed")
            else:
                emit_progress(progress_callback, "sop", "completed")

    try:
        result = execute_sop_version(
            version=version,
            text=text,
            payload=payload,
            role="operator",
            trace_id=trace_id,
            user=user,
            organization=organization,
            on_progress=on_progress,
        )
    except Exception:
        emit_progress(progress_callback, "sop", "failed", error_code="stage_failed")
        logger.exception(
            "xiaoce sop execution failed key=%s user=%s",
            version.definition.sop_key,
            getattr(user, "id", None),
        )
        raise

    decision = str(result.get("decision") or "").strip()
    meta: dict[str, Any] = {
        "sop_run": {
            "sop_key": version.definition.sop_key,
            "version": version.version,
            "trace_id": trace_id,
            "decision": decision,
            "run_id": str((result.get("sop") or {}).get("run_id") or ""),
            "agent_id": agent.id if agent else None,
        }
    }
    if decision == "need_input":
        meta["sop_pending"] = {
            "sop_key": version.definition.sop_key,
            "version": version.version,
            "trace_id": trace_id,
            "missing": list(result.get("missing") or []),
            "payload": dict(payload),
        }
    reply = format_sop_reply(version=version, result=result)
    if decision not in {"allow", "need_input"} and progress_callback:
        emit_progress(progress_callback, "sop", "completed")
    return {"reply": reply, "meta": meta}
