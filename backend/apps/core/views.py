from pathlib import Path
import mimetypes
import json
import io
import re
from urllib.parse import quote

from django.http import FileResponse, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .agent_chat import run_chat
from .attachments import (
    attachment_public_meta,
    process_uploaded_files,
    resolve_attachment_path,
    resolve_attachment_path_any,
)
from .models import AuditLog, ChatMessage, ChatSession, TaskFollowUp, TaskResultRecord, WorkTask, WorkTaskArtifact


def _is_admin(user) -> bool:
    return bool(getattr(user, "is_authenticated", False) and (user.is_staff or user.is_superuser))


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok", "service": "agent-saas-backend"})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def audit_logs(request):
    """审计日志列表(第6层闸机产生的记录)。"""
    limit = int(request.query_params.get("limit", 50))
    logs = AuditLog.objects.all()[:limit]
    data = [
        {
            "id": log.id,
            "trace_id": log.trace_id,
            "actor": log.actor,
            "intent": log.intent,
            "action": log.action,
            "payload": log.payload,
            "decision": log.decision,
            "checks": log.checks,
            "result": log.result,
            "created_at": log.created_at.isoformat(),
        }
        for log in logs
    ]
    return Response({"count": len(data), "results": data})


def _task_result_payload(row: TaskResultRecord) -> dict:
    return {
        "id": row.id, "traceId": row.trace_id, "sopId": row.sop_id, "status": row.status,
        "title": row.title, "snapshot": row.snapshot, "resolvedAttentionIds": row.resolved_attention_ids,
        "followUps": [{"id": item.id, "title": item.title, "description": item.description, "status": item.status, "dueAt": item.due_at.isoformat() if item.due_at else None, "createdAt": item.created_at.isoformat()} for item in row.follow_ups.all()],
        "createdAt": row.created_at.isoformat(), "updatedAt": row.updated_at.isoformat(),
    }


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def task_results(request):
    trace_id = str(request.data.get("traceId") or "").strip()[:64]
    snapshot = request.data.get("snapshot")
    if not trace_id or not isinstance(snapshot, dict):
        return Response({"ok": False, "detail": "traceId 和 snapshot 必填。"}, status=400)
    row, _ = TaskResultRecord.objects.update_or_create(
        user=request.user, trace_id=trace_id,
        defaults={"sop_id": str(request.data.get("sopId") or "")[:128], "status": str(request.data.get("status") or "success")[:32], "title": str(request.data.get("title") or "任务结果")[:255], "snapshot": snapshot},
    )
    return Response({"ok": True, "result": _task_result_payload(row)}, status=201)


def _owned_task_result(request, trace_id: str):
    return get_object_or_404(TaskResultRecord.objects.prefetch_related("follow_ups"), user=request.user, trace_id=trace_id)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def task_result_detail(request, trace_id: str):
    return Response({"ok": True, "result": _task_result_payload(_owned_task_result(request, trace_id))})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def task_result_export(request, trace_id: str):
    row = _owned_task_result(request, trace_id)
    payload = json.dumps(_task_result_payload(row), ensure_ascii=False, indent=2)
    response = HttpResponse(payload, content_type="application/json; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="task-result-{row.trace_id}.json"'
    return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def task_result_follow_up(request, trace_id: str):
    row = _owned_task_result(request, trace_id)
    title = str(request.data.get("title") or "").strip()[:255]
    if not title:
        return Response({"ok": False, "detail": "跟进任务标题必填。"}, status=400)
    follow = TaskFollowUp.objects.create(result=row, creator=request.user, title=title, description=str(request.data.get("description") or "")[:4000])
    return Response({"ok": True, "followUp": {"id": follow.id, "title": follow.title, "status": follow.status}}, status=201)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def task_attention_resolve(request, trace_id: str, item_id: str):
    row = _owned_task_result(request, trace_id)
    resolved = list(row.resolved_attention_ids or [])
    if item_id not in resolved:
        resolved.append(item_id)
        row.resolved_attention_ids = resolved
        row.save(update_fields=["resolved_attention_ids", "updated_at"])
    return Response({"ok": True, "resolvedAttentionIds": resolved})


def _work_task_payload(row: WorkTask) -> dict:
    return {
        "id": row.id,
        "traceId": row.trace_id,
        "title": row.title,
        "sopId": row.sop_id,
        "senderId": row.sender_id,
        "sender": row.sender.get_full_name() or row.sender.username,
        "assigneeIds": list(row.assignees.values_list("id", flat=True)),
        "assignees": row.assignee_names,
        "assigneeWeComUserIds": row.assignee_wecom_userids,
        "agentName": row.agent_name,
        "deadline": row.deadline.isoformat() if row.deadline else None,
        "priority": row.priority,
        "priorityLabel": row.get_priority_display(),
        "status": row.status,
        "statusLabel": row.get_status_display(),
        "progress": row.progress,
        "notificationMode": row.notification_mode,
        "notificationTarget": row.notification_target,
        "notificationStatus": row.notification_status,
        "notificationRecordId": row.notification_record_id,
        "timeline": row.timeline,
        "artifacts": [_work_task_artifact_payload(item) for item in row.artifacts.all()],
        "createdAt": row.created_at.isoformat(),
        "updatedAt": row.updated_at.isoformat(),
    }


def _work_task_artifact_payload(row: WorkTaskArtifact) -> dict:
    base = f"/tasks/{row.task.trace_id}/artifacts/{row.id}"
    return {
        "id": row.id,
        "name": row.name,
        "filename": row.filename,
        "type": "document" if row.kind == WorkTaskArtifact.Kind.MARKDOWN else "data" if row.kind == WorkTaskArtifact.Kind.JSON else "file",
        "format": row.get_kind_display(),
        "size": f"{max(1, round(row.size / 1024))} KB",
        "created_at": row.created_at.isoformat(),
        "preview_url": f"{base}/preview/" if row.kind != WorkTaskArtifact.Kind.XLSX else "",
        "download_url": f"{base}/download/",
    }


def _safe_filename(value: str, extension: str) -> str:
    stem = re.sub(r'[\\/:*?"<>|\r\n]+', "_", value).strip(" ._")[:80] or "任务产物"
    return f"{stem}.{extension}"


def _flatten(prefix: str, value, rows: list[tuple[str, str]]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            _flatten(f"{prefix}.{key}" if prefix else str(key), item, rows)
    elif isinstance(value, list):
        rows.append((prefix, json.dumps(value, ensure_ascii=False)))
    else:
        rows.append((prefix, "" if value is None else str(value)))


def _generate_work_task_artifacts(row: WorkTask, parameters: dict, result_data: dict) -> list[WorkTaskArtifact]:
    from openpyxl import Workbook

    summary = [
        f"# {row.title}",
        "",
        f"- Trace ID：{row.trace_id}",
        f"- SOP：{row.sop_id or '未匹配'}",
        f"- 执行智能体：{row.agent_name or '未设置'}",
        f"- 优先级：{row.get_priority_display()}",
        f"- 截止时间：{row.deadline.isoformat() if row.deadline else '未设置'}",
        f"- 负责人：{'、'.join(row.assignee_names) or '未设置'}",
        "",
        "## 执行参数",
        "```json",
        json.dumps(parameters, ensure_ascii=False, indent=2),
        "```",
        "",
        "## 执行结果",
        "```json",
        json.dumps(result_data, ensure_ascii=False, indent=2),
        "```",
    ]
    markdown = "\n".join(summary).encode("utf-8")
    json_bytes = json.dumps({
        "traceId": row.trace_id, "task": row.title, "sopId": row.sop_id,
        "priority": row.priority, "parameters": parameters, "result": result_data,
    }, ensure_ascii=False, indent=2).encode("utf-8")

    workbook = Workbook()
    info = workbook.active
    info.title = "任务信息"
    for values in [
        ("字段", "内容"), ("任务", row.title), ("Trace ID", row.trace_id),
        ("SOP", row.sop_id), ("执行智能体", row.agent_name),
        ("优先级", row.get_priority_display()), ("负责人", "、".join(row.assignee_names)),
        ("截止时间", row.deadline.isoformat() if row.deadline else ""),
    ]:
        info.append(values)
    params_sheet = workbook.create_sheet("执行参数")
    params_sheet.append(("字段", "值"))
    flattened: list[tuple[str, str]] = []
    _flatten("", parameters, flattened)
    for values in flattened:
        params_sheet.append(values)
    result_sheet = workbook.create_sheet("执行结果")
    result_sheet.append(("字段", "值"))
    flattened = []
    _flatten("", result_data, flattened)
    for values in flattened:
        result_sheet.append(values)
    stream = io.BytesIO()
    workbook.save(stream)
    artifacts = [
        (WorkTaskArtifact.Kind.MARKDOWN, "任务执行报告", _safe_filename(row.title, "md"), "text/markdown; charset=utf-8", markdown),
        (WorkTaskArtifact.Kind.JSON, "任务原始数据", _safe_filename(row.title, "json"), "application/json; charset=utf-8", json_bytes),
        (WorkTaskArtifact.Kind.XLSX, "任务执行数据", _safe_filename(row.title, "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", stream.getvalue()),
    ]
    result = []
    for kind, name, filename, content_type, content in artifacts:
        artifact, _ = WorkTaskArtifact.objects.update_or_create(
            task=row, kind=kind,
            defaults={"name": name, "filename": filename, "content_type": content_type, "content": content, "size": len(content)},
        )
        result.append(artifact)
    return result


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def work_tasks(request):
    if request.method == "GET":
        view = str(request.query_params.get("view") or "sent")
        rows = WorkTask.objects.select_related("sender").prefetch_related("assignees", "artifacts")
        rows = rows.filter(assignees=request.user) if view == "received" else rows.filter(sender=request.user)
        rows = rows.distinct()[:100]
        return Response({"ok": True, "count": len(rows), "results": [_work_task_payload(row) for row in rows]})

    trace_id = str(request.data.get("traceId") or "").strip()[:64]
    title = str(request.data.get("title") or "").strip()[:500]
    priority = str(request.data.get("priority") or WorkTask.Priority.NORMAL)
    if not trace_id or not title:
        return Response({"ok": False, "detail": "traceId 和 title 必填。"}, status=400)
    if priority not in WorkTask.Priority.values:
        return Response({"ok": False, "detail": "优先级无效。"}, status=400)
    deadline_raw = str(request.data.get("deadline") or "").strip()
    deadline = parse_datetime(deadline_raw) if deadline_raw else None
    if deadline and timezone.is_naive(deadline):
        deadline = timezone.make_aware(deadline)
    recipient_userids = [str(value) for value in request.data.get("recipientUserIds", []) if str(value)]
    assignee_names = [str(value)[:128] for value in request.data.get("assigneeNames", []) if str(value)]
    timeline = request.data.get("timeline") if isinstance(request.data.get("timeline"), list) else []
    row, _ = WorkTask.objects.update_or_create(
        sender=request.user,
        trace_id=trace_id,
        defaults={
            "title": title,
            "sop_id": str(request.data.get("sopId") or "")[:128],
            "agent_name": str(request.data.get("agentName") or "")[:128],
            "priority": priority,
            "deadline": deadline,
            "status": WorkTask.Status.RUNNING,
            "progress": min(max(int(request.data.get("progress") or 75), 0), 100),
            "assignee_wecom_userids": recipient_userids,
            "assignee_names": assignee_names,
            "notification_mode": str(request.data.get("notificationMode") or "")[:16],
            "notification_target": str(request.data.get("notificationTarget") or "")[:500],
            "timeline": timeline,
        },
    )
    from apps.wecom.models import UserWeComBinding
    platform_ids = UserWeComBinding.objects.filter(
        wecom_userid__in=recipient_userids,
        status=UserWeComBinding.Status.MATCHED,
    ).values_list("platform_user_id", flat=True)
    row.assignees.set(platform_ids)
    parameters = request.data.get("parameters") if isinstance(request.data.get("parameters"), dict) else {}
    result_data = request.data.get("resultData") if isinstance(request.data.get("resultData"), dict) else {}
    if request.data.get("generateArtifacts", True):
        _generate_work_task_artifacts(row, parameters, result_data)
    return Response({"ok": True, "task": _work_task_payload(row)}, status=201)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def work_task_detail(request, trace_id: str):
    row = get_object_or_404(WorkTask, sender=request.user, trace_id=trace_id)
    status_value = str(request.data.get("status") or row.status)
    if status_value not in WorkTask.Status.values:
        return Response({"ok": False, "detail": "任务状态无效。"}, status=400)
    row.status = status_value
    if "progress" in request.data:
        row.progress = min(max(int(request.data["progress"]), 0), 100)
    if "sopId" in request.data:
        row.sop_id = str(request.data["sopId"] or "")[:128]
    if isinstance(request.data.get("timeline"), list):
        row.timeline = request.data["timeline"]
    if "notificationStatus" in request.data:
        row.notification_status = str(request.data["notificationStatus"])[:32]
    if request.data.get("notificationRecordId"):
        row.notification_record_id = int(request.data["notificationRecordId"])
    row.save()
    parameters = request.data.get("parameters")
    result_data = request.data.get("resultData")
    if isinstance(parameters, dict) or isinstance(result_data, dict):
        _generate_work_task_artifacts(
            row,
            parameters if isinstance(parameters, dict) else {},
            result_data if isinstance(result_data, dict) else {},
        )
    return Response({"ok": True, "task": _work_task_payload(row)})


def _visible_work_task(request, trace_id: str):
    return get_object_or_404(
        WorkTask.objects.prefetch_related("assignees", "artifacts").filter(
            Q(sender=request.user) | Q(assignees=request.user),
        ).distinct(),
        trace_id=trace_id,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def work_task_artifact_preview(request, trace_id: str, artifact_id: int):
    task = _visible_work_task(request, trace_id)
    artifact = get_object_or_404(task.artifacts, id=artifact_id)
    if artifact.kind == WorkTaskArtifact.Kind.XLSX:
        return Response({"ok": False, "detail": "Excel 文件请下载后查看。"}, status=400)
    return HttpResponse(bytes(artifact.content), content_type=artifact.content_type)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def work_task_artifact_download(request, trace_id: str, artifact_id: int):
    task = _visible_work_task(request, trace_id)
    artifact = get_object_or_404(task.artifacts, id=artifact_id)
    response = HttpResponse(bytes(artifact.content), content_type=artifact.content_type)
    suffix = Path(artifact.filename).suffix if re.fullmatch(r"\.[A-Za-z0-9]+", Path(artifact.filename).suffix) else ""
    ascii_stem = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(artifact.filename).stem).strip("-")
    ascii_name = f"{ascii_stem or f'artifact-{artifact.id}'}{suffix}"
    response["Content-Disposition"] = (
        f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(artifact.filename)}'
    )
    response["Content-Length"] = artifact.size
    return response


def _attachment_meta(items: list[dict]) -> list[dict]:
    return attachment_public_meta(items)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agent_models(request):
    """返回网关当前可用的对话 / 生图模型(来自 /v1/models)。"""
    from apps.council import images as image_svc

    return Response(image_svc.list_gateway_models())


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def agent_chat(request):
    """对话 Agent:按登录用户隔离会话与 MCP 配置。"""
    message = str(request.data.get("message") or "").strip()

    try:
        attachments = process_uploaded_files(
            request.FILES.getlist("files"),
            request.user.id,
        )
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)

    if not message and not attachments:
        return Response({"ok": False, "error": "消息或附件不能为空"}, status=400)

    conversation_id = request.data.get("conversation_id")
    if conversation_id:
        session = get_object_or_404(ChatSession, id=conversation_id, user=request.user)
    else:
        title_src = message or (attachments[0]["name"] if attachments else "新对话")
        session = ChatSession.objects.create(
            user=request.user,
            title=title_src[:40] or "新对话",
        )

    history = list(
        session.messages.order_by("-created_at", "-id")
        .values("role", "content")[:30]
    )
    history.reverse()

    user_meta = {"attachments": _attachment_meta(attachments)} if attachments else {}
    display = message
    if attachments:
        names = "、".join(a["name"] for a in attachments)
        display = f"{message}\n\n[附件: {names}]".strip() if message else f"[附件: {names}]"
    ChatMessage.objects.create(
        session=session,
        role="user",
        content=display,
        meta=user_meta,
    )

    skill_ids = request.data.get("skill_ids") or []
    if isinstance(skill_ids, str):
        skill_ids = [skill_ids]

    model = str(request.data.get("model") or "").strip() or None

    try:
        result = run_chat(
            message,
            history,
            user=request.user,
            skill_ids=skill_ids,
            attachments=attachments,
            model=model,
        )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("agent_chat failed")
        return Response({"ok": False, "error": str(exc)}, status=500)

    if result.get("ok") and result.get("reply"):
        ChatMessage.objects.create(
            session=session,
            role="assistant",
            content=result["reply"],
            meta={
                "llm": result.get("llm"),
                "llm_model": result.get("llm_model") or "",
                "knowledge_hit": result.get("knowledge_hit"),
                "mcp": result.get("mcp") or {},
                "refs": result.get("refs") or {},
                "skills": result.get("skills") or [],
                "attachments": result.get("attachments") or [],
            },
        )
        if session.title == "新对话":
            session.title = (message or attachments[0]["name"])[:40]
        session.save(update_fields=["title", "updated_at"])

    result["conversation_id"] = str(session.id)
    result["conversation_title"] = session.title
    result["attachments"] = _attachment_meta(attachments)
    code = 200 if result.get("ok") else 400
    return Response(result, status=code)


@api_view(["GET"])
@permission_classes([AllowAny])
def agent_attachment(request, stored_id: str):
    """读取用户上传的附件(图片预览)。

    支持 Header Token 或 ?token= 查询参数(便于 <img src> 拉取)。
    """
    from rest_framework.authtoken.models import Token

    user = request.user if getattr(request.user, "is_authenticated", False) else None
    if user is None or not user.is_authenticated:
        raw = (request.query_params.get("token") or "").strip()
        if raw:
            row = Token.objects.filter(key=raw).select_related("user").first()
            user = row.user if row else None
    if user is None or not getattr(user, "is_authenticated", False):
        return Response({"ok": False, "error": "未登录"}, status=401)

    path = resolve_attachment_path(user.id, stored_id)
    if not path and _is_admin(user):
        path = resolve_attachment_path_any(stored_id)
    if not path:
        return Response({"ok": False, "error": "附件不存在"}, status=404)
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    original = path.name.split("_", 1)[-1] if "_" in path.name else path.name
    return FileResponse(path.open("rb"), as_attachment=False, filename=original, content_type=mime)


def _session_payload(session: ChatSession, include_messages: bool = False) -> dict:
    owner = session.user
    payload = {
        "id": str(session.id),
        "title": session.title,
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
        "user_id": owner.id if owner else None,
        "username": owner.username if owner else "",
    }
    if include_messages:
        payload["messages"] = [
            {
                "id": row.id,
                "role": row.role,
                "content": row.content,
                "meta": row.meta,
                "created_at": row.created_at.isoformat(),
            }
            for row in session.messages.all()
        ]
    return payload


def _sessions_for_user(user, *, all_users: bool = False):
    qs = ChatSession.objects.select_related("user")
    if all_users and _is_admin(user):
        return qs.all()
    return qs.filter(user=user)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def chat_sessions(request):
    if request.method == "POST":
        title = str(request.data.get("title") or "新对话").strip()[:120]
        session = ChatSession.objects.create(
            user=request.user,
            title=title or "新对话",
        )
        return Response(_session_payload(session, include_messages=True), status=201)

    limit = min(max(int(request.query_params.get("limit", 50)), 1), 200)
    username = str(request.query_params.get("username") or "").strip()
    qs = _sessions_for_user(request.user, all_users=True)
    if username and _is_admin(request.user):
        qs = qs.filter(user__username=username)
    sessions = list(qs[:limit])
    return Response({
        "count": len(sessions),
        "is_admin": _is_admin(request.user),
        "results": [_session_payload(item) for item in sessions],
    })


@api_view(["GET", "DELETE"])
@permission_classes([IsAuthenticated])
def chat_session_detail(request, session_id):
    if _is_admin(request.user):
        session = get_object_or_404(ChatSession.objects.select_related("user"), id=session_id)
    else:
        session = get_object_or_404(
            ChatSession.objects.select_related("user"),
            id=session_id,
            user=request.user,
        )
    if request.method == "DELETE":
        # 管理员可删任意会话；普通用户只能删自己的
        session.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    return Response(_session_payload(session, include_messages=True))
