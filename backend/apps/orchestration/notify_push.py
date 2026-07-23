"""SOP 推送工具：平台站内 / 企业微信。正式发送前必须确认；试跑只预览不投递。"""
from __future__ import annotations

from typing import Any


DESTINATION_LABELS = {
    "platform": "平台站内通知",
    "wecom": "企业微信",
}


def _truthy(value: Any) -> bool:
    return value in (True, "true", "1", 1, "yes", "on")


def _normalize_destination(raw: Any) -> str:
    value = str(raw or "").strip().lower()
    aliases = {
        "platform": "platform",
        "in_app": "platform",
        "站内": "platform",
        "平台": "platform",
        "app": "platform",
        "wecom": "wecom",
        "wechat_work": "wecom",
        "企业微信": "wecom",
        "企微": "wecom",
    }
    return aliases.get(value, value if value in DESTINATION_LABELS else "")


def _push_confirmed(payload: dict) -> bool:
    if _truthy(payload.get("_notify_push_confirm")):
        return True
    if _truthy(payload.get("_checkpoint_confirm")):
        return True
    confirmed = payload.get("_confirmed_nodes") or []
    return isinstance(confirmed, list) and any(str(item).strip() for item in confirmed)


def _recipient_user_ids(payload: dict, user) -> list[int]:
    raw = payload.get("recipient_user_ids") or payload.get("recipient_ids") or []
    ids: list[int] = []
    if isinstance(raw, list):
        for item in raw:
            try:
                ids.append(int(item))
            except (TypeError, ValueError):
                continue
    if not ids and user is not None and getattr(user, "id", None):
        ids = [int(user.id)]
    return list(dict.fromkeys(ids))


def run_notify_push(
    *,
    text: str,
    organization,
    user,
    trace_id: str,
    initial_steps: list | None = None,
    payload: dict | None = None,
) -> dict:
    payload = dict(payload or {})
    steps = list(initial_steps or [])
    destination = _normalize_destination(payload.get("destination"))
    content = str(payload.get("content") or payload.get("push_content") or text or "").strip()
    trial = _truthy(payload.get("_sop_trial"))
    label = DESTINATION_LABELS.get(destination, destination or "未指定渠道")

    if not destination:
        message = "请选择推送渠道：platform（平台站内）或 wecom（企业微信）。"
        steps.append({"node": "推送校验", "status": "need_input", "detail": message, "data": {"missing": ["destination"]}})
        return {
            "trace_id": trace_id,
            "decision": "need_input",
            "action": "notify.push",
            "missing": ["destination"],
            "error": message,
            "result": {"ok": False, "user_message": message, "external_write_performed": False},
            "steps": steps,
        }
    if not content:
        message = "请填写要推送的内容。"
        steps.append({"node": "推送校验", "status": "need_input", "detail": message, "data": {"missing": ["content"]}})
        return {
            "trace_id": trace_id,
            "decision": "need_input",
            "action": "notify.push",
            "missing": ["content"],
            "error": message,
            "result": {"ok": False, "user_message": message, "external_write_performed": False},
            "steps": steps,
        }

    preview = {
        "destination": destination,
        "destination_label": label,
        "content": content[:4000],
        "organization_id": getattr(organization, "id", None),
        "recipient_user_ids": _recipient_user_ids(payload, user),
        "recipient_contact_ids": list(payload.get("recipient_contact_ids") or [])
        if isinstance(payload.get("recipient_contact_ids"), list)
        else [],
    }

    if trial:
        detail = f"试跑预览：将通过「{label}」推送（未真实发送）。"
        steps.extend([
            {"node": "人工确认", "status": "done", "detail": "试跑已自动确认推送意图", "data": {}},
            {"node": "推送预览", "status": "done", "detail": detail, "data": preview},
        ])
        return {
            "trace_id": trace_id,
            "decision": "allow",
            "action": "notify.push",
            "result": {
                "ok": True,
                "execution_mode": "notify_push_dry_run",
                "external_write_performed": False,
                "pushed_to_user": False,
                "destination": destination,
                "destination_label": label,
                "preview": preview,
                "user_message": detail,
            },
            "steps": steps,
        }

    if not _push_confirmed(payload):
        message = (
            f"推送前需人工确认：将通过「{label}」发送给用户。"
            "确认渠道与内容无误后继续。"
        )
        steps.append({
            "node": "人工确认推送",
            "status": "need_input",
            "detail": message,
            "data": {"missing": ["_notify_push_confirm"], "preview": preview},
        })
        return {
            "trace_id": trace_id,
            "decision": "need_input",
            "action": "notify.push",
            "missing": ["_notify_push_confirm"],
            "error": message,
            "result": {
                "ok": False,
                "user_message": message,
                "preview": preview,
                "external_write_performed": False,
                "requires_confirmation": True,
            },
            "steps": steps,
        }

    steps.append({
        "node": "人工确认推送",
        "status": "done",
        "detail": f"已确认通过「{label}」推送",
        "data": preview,
    })

    try:
        if destination == "platform":
            send_result = _send_platform(user=user, content=content, payload=payload, preview=preview)
        else:
            send_result = _send_wecom(user=user, content=content, payload=payload, preview=preview)
    except Exception as exc:  # noqa: BLE001 - surface connector errors to SOP steps
        message = str(exc) or "推送失败"
        steps.append({"node": "执行推送", "status": "block", "detail": message, "data": {"error": message}})
        return {
            "trace_id": trace_id,
            "decision": "block",
            "action": "notify.push",
            "error": message,
            "result": {"ok": False, "user_message": message, "external_write_performed": False},
            "steps": steps,
        }

    if send_result.get("need_input"):
        missing = send_result.get("missing") or []
        message = str(send_result.get("error") or "还需要补充推送接收人")
        steps.append({"node": "执行推送", "status": "need_input", "detail": message, "data": send_result})
        return {
            "trace_id": trace_id,
            "decision": "need_input",
            "action": "notify.push",
            "missing": missing,
            "error": message,
            "result": {
                "ok": False,
                "user_message": message,
                "external_write_performed": False,
                "preview": preview,
            },
            "steps": steps,
        }

    detail = str(send_result.get("user_message") or f"已通过「{label}」推送")
    steps.append({"node": "执行推送", "status": "done", "detail": detail, "data": send_result})
    return {
        "trace_id": trace_id,
        "decision": "allow",
        "action": "notify.push",
        "result": {
            "ok": True,
            "execution_mode": "notify_push",
            "external_write_performed": True,
            "pushed_to_user": True,
            "destination": destination,
            "destination_label": label,
            "delivery": send_result,
            "user_message": detail,
        },
        "steps": steps,
    }


def _send_platform(*, user, content: str, payload: dict, preview: dict) -> dict:
    from apps.council.invites import publish_user_event

    recipient_ids = _recipient_user_ids(payload, user)
    if not recipient_ids:
        return {
            "need_input": True,
            "missing": ["recipient_user_ids"],
            "error": "平台推送需要指定接收用户。",
        }
    for uid in recipient_ids:
        publish_user_event(
            uid,
            "sop_notify_push",
            {
                "title": "流程通知",
                "content": content[:2000],
                "destination": "platform",
                "preview": preview,
            },
        )
    return {
        "channel": "platform",
        "recipient_user_ids": recipient_ids,
        "user_message": f"已向平台站内推送（{len(recipient_ids)} 人）。",
    }


def _send_wecom(*, user, content: str, payload: dict, preview: dict) -> dict:
    from apps.wecom.access import resolve_accessible_config
    from apps.wecom.models import WeComContact, WeComNotificationRecord
    from apps.wecom.services import WeComApiError, WeComClient

    config = resolve_accessible_config(user)
    if not config or not config.configured or not config.can_use(user):
        raise WeComApiError("WECOM_NOT_AUTHORIZED", "当前企业未配置企业微信应用，或你没有使用权限。", status_code=403)

    contact_ids = []
    raw_contacts = payload.get("recipient_contact_ids") or []
    if isinstance(raw_contacts, list):
        for item in raw_contacts:
            try:
                contact_ids.append(int(item))
            except (TypeError, ValueError):
                continue
    contact_ids = list(dict.fromkeys(contact_ids))

    target_ids: list[str] = []
    if contact_ids:
        contacts = list(WeComContact.objects.filter(
            id__in=contact_ids, config=config, available=True,
        ).only("id", "wecom_userid", "name"))
        if len(contacts) != len(contact_ids):
            raise WeComApiError("WECOM_CONTACT_NOT_FOUND", "部分企业微信成员不存在或不可用。", status_code=400)
        target_ids = [item.wecom_userid for item in contacts]
        target_label = "、".join(item.name or item.wecom_userid for item in contacts)[:120]
    else:
        requested = []
        raw_users = payload.get("recipient_wecom_userids") or payload.get("recipient_user_ids") or []
        if isinstance(raw_users, list):
            requested = [str(item).strip() for item in raw_users if str(item).strip()]
        if not requested:
            return {
                "need_input": True,
                "missing": ["recipient_contact_ids"],
                "error": "企业微信推送需要选择接收成员（recipient_contact_ids）。",
            }
        allowed = set(WeComContact.objects.filter(
            config=config, available=True, wecom_userid__in=requested,
        ).values_list("wecom_userid", flat=True))
        if len(allowed) != len(set(requested)):
            raise WeComApiError("WECOM_CONTACT_NOT_FOUND", "部分企业微信成员不存在或不可用。", status_code=400)
        target_ids = list(dict.fromkeys(requested))
        target_label = "、".join(target_ids)[:120]

    record = WeComNotificationRecord.objects.create(
        user=user,
        channel=WeComNotificationRecord.Channel.PERSON,
        config=config,
        target_ids=target_ids,
        target_label=target_label,
        content=content[:2048],
        content_preview=content[:500],
        task_trace_id=str(payload.get("trace_id") or "")[:64],
        status=WeComNotificationRecord.Status.PENDING,
    )
    result = WeComClient(config).send_app_text(target_ids, content[:2048])
    record.wecom_msgid = result.get("msgid") or ""
    record.invalid_users = result.get("invalidUsers") or []
    record.status = (
        WeComNotificationRecord.Status.PARTIAL
        if record.invalid_users
        else WeComNotificationRecord.Status.ACCEPTED
    )
    from django.utils import timezone

    record.accepted_at = timezone.now()
    record.last_attempt_at = record.accepted_at
    record.save(update_fields=[
        "wecom_msgid", "invalid_users", "status", "accepted_at", "last_attempt_at",
    ])
    return {
        "channel": "wecom",
        "record_id": record.id,
        "target_ids": target_ids,
        "target_label": target_label,
        "invalid_users": record.invalid_users,
        "user_message": f"已通过企业微信推送给 {target_label or '指定成员'}。",
    }
