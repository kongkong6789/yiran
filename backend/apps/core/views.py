from pathlib import Path
import mimetypes
import uuid

from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone

from .agent_chat import run_chat
from .chat_runs import ChatRunCancelled, cancel_run, is_run_cancelled
from .attachments import (
    attachment_public_meta,
    process_uploaded_files,
    resolve_attachment_path,
    resolve_attachment_path_any,
)
from .chat_runs import cancel_run
from .models import AuditLog, ChatMessage, ChatRun, ChatSession


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
def agent_chat_run_cancel(request, run_id):
    run = ChatRun.objects.filter(id=run_id, user=request.user).first()
    if run is None:
        return Response({"ok": False, "error": "对话执行不存在"}, status=404)
    try:
        run = cancel_run(run)
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=409)
    return Response({
        "ok": True,
        "cancelled": True,
        "run_id": str(run.id),
        "conversation_id": str(run.session_id),
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def agent_chat(request):
    """对话 Agent:按登录用户隔离会话与 MCP 配置。"""
    message = str(request.data.get("message") or "").strip()
    raw_run_id = str(request.data.get("run_id") or "").strip()
    try:
        run_id = uuid.UUID(raw_run_id)
    except (TypeError, ValueError, AttributeError):
        return Response({"ok": False, "error": "run_id 必须是有效 UUID"}, status=400)
    if ChatRun.objects.filter(id=run_id).exists():
        return Response({"ok": False, "error": "run_id 已被使用"}, status=409)

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
    run = ChatRun.objects.create(
        id=run_id,
        user=request.user,
        session=session,
    )
    cancel_check = lambda: is_run_cancelled(run.id)

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
            cancel_check=cancel_check,
        )
    except ChatRunCancelled:
        return Response({
            "ok": False,
            "cancelled": True,
            "run_id": str(run.id),
            "conversation_id": str(session.id),
            "conversation_title": session.title,
        })
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("agent_chat failed")
        ChatRun.objects.filter(
            id=run.id,
            status=ChatRun.Status.RUNNING,
        ).update(
            status=ChatRun.Status.FAILED,
            error=str(exc),
            finished_at=timezone.now(),
        )
        return Response({"ok": False, "error": str(exc)}, status=500)

    if result.get("ok") and result.get("reply"):
        if cancel_check():
            return Response({
                "ok": False,
                "cancelled": True,
                "run_id": str(run.id),
                "conversation_id": str(session.id),
                "conversation_title": session.title,
            })
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

    if result.get("ok"):
        ChatRun.objects.filter(
            id=run.id,
            status=ChatRun.Status.RUNNING,
        ).update(
            status=ChatRun.Status.COMPLETED,
            finished_at=timezone.now(),
        )
    else:
        ChatRun.objects.filter(
            id=run.id,
            status=ChatRun.Status.RUNNING,
        ).update(
            status=ChatRun.Status.FAILED,
            error=str(result.get("error") or "对话失败"),
            finished_at=timezone.now(),
        )
    result["conversation_id"] = str(session.id)
    result["conversation_title"] = session.title
    result["run_id"] = str(run.id)
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
