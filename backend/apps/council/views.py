from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404

from apps.core.organizations import is_organization_admin

from .access import (
    agent_queryset_for_user,
    can_create_agent,
    can_manage_agent,
    organization_for_user,
    organization_member_ids,
)
from .models import AgentProfile, Meeting, Deliverable, MeetingInvite
from .serializers import AgentProfileSerializer
from . import engine, llm, graph_knowledge
from . import invites as invite_svc


def _agent_dict(a: AgentProfile, request=None) -> dict:
    return AgentProfileSerializer(a, context={"request": request} if request else {}).data


def _meeting_queryset(request):
    organization = organization_for_user(request.user)
    if organization is None:
        return Meeting.objects.none()
    return Meeting.objects.filter(participants__organization=organization).distinct()


def _validated_agent_ids(request, values) -> tuple[list[int], str | None]:
    requested: list[int] = []
    for value in values or []:
        try:
            requested.append(int(value))
        except (TypeError, ValueError):
            return [], "智能体 ID 格式无效"
    requested = list(dict.fromkeys(requested))
    visible = set(
        agent_queryset_for_user(request.user)
        .filter(
            id__in=requested,
            is_active=True,
            lifecycle_status=AgentProfile.LifecycleStatus.PUBLISHED,
        )
        .values_list("id", flat=True)
    )
    if visible != set(requested):
        return [], "所选智能体不存在、未发布或无权访问"
    return requested, None


def _validated_user_ids(request, values) -> tuple[list[int], str | None]:
    organization = organization_for_user(request.user)
    if organization is None:
        return [], "当前账号没有可用企业"
    requested: list[int] = []
    for value in values or []:
        try:
            requested.append(int(value))
        except (TypeError, ValueError):
            return [], "成员 ID 格式无效"
    requested = list(dict.fromkeys(requested))
    if not set(requested).issubset(organization_member_ids(organization)):
        return [], "所选成员不属于当前企业或已停用"
    return requested, None


def _human_dict(u) -> dict:
    display = engine._display_name(u)
    avatar_url = None
    try:
        settings = getattr(u, "settings", None)
        if settings and getattr(settings, "avatar", None):
            avatar_url = f"/api/auth/avatar/{u.id}/"
    except Exception:
        pass
    return {
        "id": u.id,
        "username": u.get_username(),
        "display_name": display,
        "avatar_url": avatar_url,
        "kind": "human",
    }


@api_view(["GET", "POST"])
def agents(request):
    organization = organization_for_user(request.user)
    if request.method == "POST":
        if organization is None or not can_create_agent(request.user, organization):
            raise PermissionDenied("仅企业所有者或管理员可以创建数字员工。")
        serializer = AgentProfileSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        owner_id = serializer.validated_data.get("owner_id") or request.user.id
        a = serializer.save(
            organization=organization,
            created_by=request.user,
            owner_id=owner_id,
            emoji=serializer.validated_data.get("emoji") or "🤖",
            group=serializer.validated_data.get("group") or "未分类",
        )
        return Response(_agent_dict(a, request), status=status.HTTP_201_CREATED)
    data = [_agent_dict(a, request) for a in agent_queryset_for_user(request.user)]
    return Response({
        "count": len(data),
        "results": data,
        "llm": llm.llm_available(),
        "organization": (
            {"id": organization.id, "name": organization.name}
            if organization else None
        ),
        "permissions": {
            "can_create": can_create_agent(request.user, organization),
            "can_manage_all": bool(
                organization and is_organization_admin(request.user, organization)
            ),
        },
    })


@api_view(["GET", "PATCH", "DELETE"])
def agent_detail(request, agent_id: int):
    a = get_object_or_404(
        agent_queryset_for_user(request.user, include_archived=True),
        id=agent_id,
    )
    if request.method == "GET":
        return Response(_agent_dict(a, request))
    if not can_manage_agent(request.user, a):
        raise PermissionDenied("只有数字员工负责人或企业管理员可以修改该员工。")
    if request.method == "DELETE":
        a.archive()
        a.save(update_fields=["is_active", "lifecycle_status", "archived_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = AgentProfileSerializer(
        a,
        data=request.data,
        partial=True,
        context={"request": request},
    )
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


def _meeting_dict(m: Meeting, *, brief: bool = False) -> dict:
    humans = list(m.human_participants.all())
    agents = list(m.participants.all())
    base = {
        "id": m.id,
        "title": m.title,
        "question": m.question,
        "intro": m.intro or "",
        "scheduled_at": m.scheduled_at.isoformat() if m.scheduled_at else None,
        "duration_minutes": m.duration_minutes,
        "started_at": m.started_at.isoformat() if m.started_at else None,
        "status": m.status,
        "round": m.round,
        "context_summary": m.context_summary if not brief else "",
        "participants": [] if brief else [_agent_dict(a) for a in agents],
        "human_participants": [] if brief else [_human_dict(u) for u in humans],
        "created_at": m.created_at.isoformat(),
    }
    if brief:
        latest = m.deliverables.first()
        base["message_count"] = m.messages.count()
        base["has_deliverable"] = latest is not None
        base["deliverable_title"] = latest.title if latest else None
        base["agent_count"] = len(agents)
        base["human_count"] = len(humans)
        base["agent_names"] = [a.name for a in agents[:6]]
        base["human_names"] = [engine._display_name(u) for u in humans[:6]]
    return base


@api_view(["GET", "POST"])
def meetings(request):
    if request.method == "POST":
        d = request.data
        title = (d.get("title") or "").strip()
        intro = (d.get("intro") or "").strip()
        question = (d.get("question") or "").strip() or intro or title
        agent_ids, agent_error = _validated_agent_ids(request, d.get("agent_ids") or [])
        user_ids, user_error = _validated_user_ids(request, d.get("user_ids") or [])
        start_now = d.get("start_now", True)
        if isinstance(start_now, str):
            start_now = start_now.strip().lower() in ("1", "true", "yes", "y")
        else:
            start_now = bool(start_now)

        if not question:
            return Response({"error": "请填写会议标题或简介/核心问题"}, status=status.HTTP_400_BAD_REQUEST)
        if agent_error:
            return Response({"error": agent_error}, status=status.HTTP_400_BAD_REQUEST)
        if user_error:
            return Response({"error": user_error}, status=status.HTTP_400_BAD_REQUEST)
        if not agent_ids:
            return Response({"error": "请至少选择 1 个 AI 对象"}, status=status.HTTP_400_BAD_REQUEST)

        scheduled_at = None
        raw_sched = d.get("scheduled_at")
        if raw_sched:
            from django.utils.dateparse import parse_datetime
            scheduled_at = parse_datetime(str(raw_sched))
            if scheduled_at is None:
                return Response({"error": "scheduled_at 格式无效"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            duration = int(d.get("duration_minutes") or 60)
        except (TypeError, ValueError):
            duration = 60

        m = engine.start_meeting(
            title or question[:30],
            question,
            agent_ids,
            user_ids,
            intro=intro,
            scheduled_at=scheduled_at,
            duration_minutes=duration,
            start_now=start_now,
        )
        if request.user and request.user.is_authenticated:
            m.human_participants.add(request.user)
        # 创建并开始时，给被拉入的同事发醒目邀请
        if start_now and (user_ids or []):
            from django.contrib.auth import get_user_model
            User = get_user_model()
            targets = list(User.objects.filter(id__in=user_ids))
            invite_svc.issue_invites(
                m,
                targets,
                invited_by=request.user if request.user.is_authenticated else None,
            )
        msgs = [engine._msg_dict(x) for x in m.messages.order_by("id")]
        return Response(
            {"meeting": _meeting_dict(m), "messages": msgs},
            status=status.HTTP_201_CREATED,
        )
    data = [
        _meeting_dict(m, brief=True)
        for m in _meeting_queryset(request).prefetch_related(
            "participants", "human_participants", "deliverables"
        )
    ]
    return Response({"count": len(data), "results": data})


@api_view(["POST"])
def meeting_start(request, meeting_id: int):
    """草稿/暂停 → 正式开始。"""
    m = get_object_or_404(_meeting_queryset(request), id=meeting_id)
    was_draft = m.status == Meeting.Status.DRAFT
    try:
        engine.activate_meeting(m)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    # 草稿正式开场：提醒所有已选同事（不含自己）
    if was_draft:
        humans = list(m.human_participants.all())
        invite_svc.issue_invites(
            m,
            humans,
            invited_by=request.user if request.user.is_authenticated else None,
        )
    last_sys = m.messages.filter(speaker_type="system").order_by("-id").first()
    return Response({
        "meeting": _meeting_dict(m),
        "message": engine._msg_dict(last_sys) if last_sys else None,
    })


@api_view(["POST"])
def meeting_pause(request, meeting_id: int):
    """进行中 → 已暂停。"""
    m = get_object_or_404(_meeting_queryset(request), id=meeting_id)
    try:
        engine.pause_meeting(m)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    last_sys = m.messages.filter(speaker_type="system").order_by("-id").first()
    return Response({
        "meeting": _meeting_dict(m),
        "message": engine._msg_dict(last_sys) if last_sys else None,
    })


@api_view(["POST"])
def meetings_pause_active(request):
    """批量暂停进行中的会议。body 可选 meeting_ids；省略则暂停全部 active。"""
    raw_ids = request.data.get("meeting_ids") if isinstance(request.data, dict) else None
    meeting_ids = None
    if raw_ids is not None:
        try:
            meeting_ids = [int(x) for x in raw_ids]
        except (TypeError, ValueError):
            return Response({"error": "meeting_ids 无效"}, status=status.HTTP_400_BAD_REQUEST)
    visible_active_ids = list(
        _meeting_queryset(request)
        .filter(status=Meeting.Status.ACTIVE)
        .values_list("id", flat=True)
    )
    if meeting_ids is not None:
        requested_ids = set(meeting_ids)
        visible_active_ids = [item for item in visible_active_ids if item in requested_ids]
    paused = engine.pause_active_meetings(meeting_ids=visible_active_ids)
    return Response({
        "ok": True,
        "paused_count": len(paused),
        "results": [_meeting_dict(m, brief=True) for m in paused],
    })


@api_view(["GET"])
def graph_preview(request):
    """预览会议问题将引用哪些图谱实体(发起会议前可见)。"""
    question = (request.query_params.get("question") or "").strip()
    if not question:
        return Response({"refs": [], "card": ""})
    result = graph_knowledge.search_graph(question)
    return Response({"refs": result.get("refs", []), "card": result.get("card", "")})


@api_view(["GET"])
def meeting_detail(request, meeting_id: int):
    m = get_object_or_404(
        _meeting_queryset(request).prefetch_related(
            "participants", "human_participants", "messages", "deliverables",
        ),
        id=meeting_id,
    )
    msgs = [engine._msg_dict(x) for x in m.messages.all()]
    finals = engine._final_deliverables(m)
    latest_md = next((d for d in finals if d.kind == Deliverable.Kind.MARKDOWN), None)
    if not latest_md:
        latest_md = m.deliverables.filter(kind=Deliverable.Kind.MARKDOWN).first()
    # 进会路径默认不查图谱，避免 AGE/远端库超时把「创建并开始」拖慢
    graph_refs = []
    if str(request.query_params.get("include_graph") or "").lower() in ("1", "true", "yes"):
        try:
            graph_refs = graph_knowledge.search_graph(m.question).get("refs", []) or []
        except Exception:
            graph_refs = []
    return Response({
        "meeting": _meeting_dict(m),
        "messages": msgs,
        "deliverable": engine._deliverable_dict(latest_md) if latest_md else None,
        "deliverables": [engine._deliverable_dict(d) for d in finals] if finals else (
            [engine._deliverable_dict(latest_md)] if latest_md else []
        ),
        "graph_refs": graph_refs,
    })


@api_view(["POST"])
def meeting_invite(request, meeting_id: int):
    """会中继续拉 AI 对象 / 同事入会。"""
    m = get_object_or_404(_meeting_queryset(request), id=meeting_id)
    if m.status == Meeting.Status.STOPPED:
        return Response({"error": "会议已结束，无法加人"}, status=status.HTTP_400_BAD_REQUEST)
    agent_ids, agent_error = _validated_agent_ids(request, request.data.get("agent_ids") or [])
    user_ids, user_error = _validated_user_ids(request, request.data.get("user_ids") or [])
    if agent_error:
        return Response({"error": agent_error}, status=status.HTTP_400_BAD_REQUEST)
    if user_error:
        return Response({"error": user_error}, status=status.HTTP_400_BAD_REQUEST)
    if not agent_ids and not user_ids:
        return Response({"error": "请选择要拉入的对象或同事"}, status=status.HTTP_400_BAD_REQUEST)
    m, added_users = engine.invite_participants(m, agent_ids=agent_ids, user_ids=user_ids)
    if added_users:
        invite_svc.issue_invites(
            m,
            added_users,
            invited_by=request.user if request.user.is_authenticated else None,
        )
    last_sys = m.messages.filter(speaker_type="system").order_by("-id").first()
    return Response({
        "meeting": _meeting_dict(m),
        "message": engine._msg_dict(last_sys) if last_sys else None,
        "invited_count": len(added_users),
    })


@api_view(["GET"])
def meeting_invites_pending(request):
    """当前用户待处理的会议邀请（轮询兜底）。"""
    if not request.user or not request.user.is_authenticated:
        return Response({"count": 0, "results": []})
    qs = (
        MeetingInvite.objects
        .filter(
            user=request.user,
            status__in=[MeetingInvite.Status.PENDING, MeetingInvite.Status.SEEN],
            meeting__status__in=[Meeting.Status.ACTIVE, Meeting.Status.PAUSED, Meeting.Status.DRAFT],
        )
        .select_related("meeting", "invited_by")
        .order_by("-created_at")[:20]
    )
    return Response({
        "count": qs.count(),
        "results": [invite_svc.invite_payload(inv) for inv in qs],
    })


@api_view(["POST"])
def meeting_invite_ack(request, invite_id: int):
    """处理邀请：seen / join / dismiss。"""
    inv = get_object_or_404(MeetingInvite, id=invite_id, user=request.user)
    action = str(request.data.get("action") or "seen").strip().lower()
    if action == "join":
        inv.status = MeetingInvite.Status.JOINED
        inv.meeting.human_participants.add(request.user)
    elif action == "dismiss":
        inv.status = MeetingInvite.Status.DISMISSED
    else:
        inv.status = MeetingInvite.Status.SEEN
    inv.save(update_fields=["status", "updated_at"])
    return Response({"ok": True, "invite": invite_svc.invite_payload(inv)})


@api_view(["GET"])
def deliverable_download(request, meeting_id: int, deliverable_id: int):
    """下载会议产物:md / html / xlsx。"""
    import base64
    from django.http import HttpResponse

    m = get_object_or_404(_meeting_queryset(request), id=meeting_id)
    d = get_object_or_404(Deliverable, id=deliverable_id, meeting=m)
    fname = d.filename or f"deliverable.{d.kind}"
    if d.kind == Deliverable.Kind.XLSX:
        raw = base64.b64decode(d.content)
        resp = HttpResponse(
            raw,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    elif d.kind == Deliverable.Kind.HTML:
        resp = HttpResponse(d.content, content_type="text/html; charset=utf-8")
    else:
        resp = HttpResponse(d.content, content_type="text/markdown; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="{fname}"'
    return resp


@api_view(["GET"])
def meeting_messages(request, meeting_id: int):
    """轮询新消息:?after=<last_id>"""
    m = get_object_or_404(_meeting_queryset(request), id=meeting_id)
    after = int(request.query_params.get("after", 0))
    qs = m.messages.filter(id__gt=after)
    return Response({
        "status": m.status,
        "round": m.round,
        "results": [engine._msg_dict(x) for x in qs],
    })


@api_view(["POST"])
def meeting_tick(request, meeting_id: int):
    m = get_object_or_404(_meeting_queryset(request), id=meeting_id)
    return Response(engine.tick_round(m, user=request.user))


@api_view(["POST"])
def meeting_interject(request, meeting_id: int):
    m = get_object_or_404(_meeting_queryset(request), id=meeting_id)
    text = (request.data.get("text") or "").strip()
    if not text:
        return Response({"error": "text 必填"}, status=status.HTTP_400_BAD_REQUEST)
    if m.status == Meeting.Status.STOPPED:
        return Response({"error": "会议已结束"}, status=status.HTTP_400_BAD_REQUEST)
    speaker = None
    if request.user and request.user.is_authenticated:
        speaker = engine._display_name(request.user)
        m.human_participants.add(request.user)
    return Response(engine.interject(m, text, speaker_name=speaker, user=request.user))


@api_view(["POST"])
def meeting_stop(request, meeting_id: int):
    m = get_object_or_404(_meeting_queryset(request), id=meeting_id)
    return Response(engine.stop(m))
