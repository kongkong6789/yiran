from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404

from .models import AgentProfile, Meeting, Message, Deliverable
from .serializers import AgentProfileSerializer
from . import engine, llm, graph_knowledge


def _agent_dict(a: AgentProfile) -> dict:
    return AgentProfileSerializer(a).data


@api_view(["GET", "POST"])
def agents(request):
    if request.method == "POST":
        serializer = AgentProfileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        a = serializer.save(
            emoji=serializer.validated_data.get("emoji") or "🤖",
            group=serializer.validated_data.get("group") or "未分类",
        )
        return Response(_agent_dict(a), status=status.HTTP_201_CREATED)
    data = [_agent_dict(a) for a in AgentProfile.objects.all()]
    return Response({"count": len(data), "results": data, "llm": llm.llm_available()})


@api_view(["PATCH", "DELETE"])
def agent_detail(request, agent_id: int):
    a = get_object_or_404(AgentProfile, id=agent_id)
    if request.method == "DELETE":
        a.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = AgentProfileSerializer(a, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


def _meeting_dict(m: Meeting, *, brief: bool = False) -> dict:
    base = {
        "id": m.id, "title": m.title, "question": m.question, "status": m.status,
        "round": m.round, "context_summary": m.context_summary,
        "participants": [_agent_dict(a) for a in m.participants.all()],
        "created_at": m.created_at.isoformat(),
    }
    if brief:
        latest = m.deliverables.first()
        base["message_count"] = m.messages.count()
        base["has_deliverable"] = latest is not None
        base["deliverable_title"] = latest.title if latest else None
        base["graph_ref_count"] = len(graph_knowledge.search_graph(m.question).get("refs", []))
    return base


@api_view(["GET", "POST"])
def meetings(request):
    if request.method == "POST":
        d = request.data
        question = (d.get("question") or "").strip()
        agent_ids = d.get("agent_ids") or []
        if not question:
            return Response({"error": "question 必填"}, status=status.HTTP_400_BAD_REQUEST)
        if not agent_ids:
            return Response({"error": "至少选择一个参会 Agent"}, status=status.HTTP_400_BAD_REQUEST)
        m = engine.start_meeting(d.get("title", ""), question, agent_ids)
        return Response(_meeting_dict(m), status=status.HTTP_201_CREATED)
    data = [_meeting_dict(m, brief=True) for m in Meeting.objects.all()]
    return Response({"count": len(data), "results": data})


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
    m = get_object_or_404(Meeting, id=meeting_id)
    msgs = [engine._msg_dict(x) for x in m.messages.all()]
    finals = engine._final_deliverables(m)
    latest_md = next((d for d in finals if d.kind == Deliverable.Kind.MARKDOWN), None)
    if not latest_md:
        latest_md = m.deliverables.filter(kind=Deliverable.Kind.MARKDOWN).first()
    graph_refs = graph_knowledge.search_graph(m.question).get("refs", [])
    return Response({
        "meeting": _meeting_dict(m),
        "messages": msgs,
        "deliverable": engine._deliverable_dict(latest_md) if latest_md else None,
        "deliverables": [engine._deliverable_dict(d) for d in finals] if finals else (
            [engine._deliverable_dict(latest_md)] if latest_md else []
        ),
        "graph_refs": graph_refs,
    })


@api_view(["GET"])
def deliverable_download(request, meeting_id: int, deliverable_id: int):
    """下载会议产物:md / html / xlsx。"""
    import base64
    from django.http import HttpResponse

    m = get_object_or_404(Meeting, id=meeting_id)
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
    m = get_object_or_404(Meeting, id=meeting_id)
    after = int(request.query_params.get("after", 0))
    qs = m.messages.filter(id__gt=after)
    return Response({
        "status": m.status,
        "round": m.round,
        "results": [engine._msg_dict(x) for x in qs],
    })


@api_view(["POST"])
def meeting_tick(request, meeting_id: int):
    m = get_object_or_404(Meeting, id=meeting_id)
    return Response(engine.tick_round(m))


@api_view(["POST"])
def meeting_interject(request, meeting_id: int):
    m = get_object_or_404(Meeting, id=meeting_id)
    text = (request.data.get("text") or "").strip()
    if not text:
        return Response({"error": "text 必填"}, status=status.HTTP_400_BAD_REQUEST)
    return Response(engine.interject(m, text))


@api_view(["POST"])
def meeting_stop(request, meeting_id: int):
    m = get_object_or_404(Meeting, id=meeting_id)
    return Response(engine.stop(m))
