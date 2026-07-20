"""Skill 上传 / 管理 / 调用 API。"""
from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .cos_storage import cos_enabled
from .models import SkillAsset, UserSkill
from .parser import extract_skill_from_upload, parse_skill_markdown
from .repository import (
    delete_skill_asset,
    ensure_shared_skills_for_user,
    find_shared_asset,
    list_skill_assets,
    materialize_user_skill,
    save_skill_asset_from_bytes,
)
from .service import list_user_skills, resolve_skills, skills_payload


def _skill_row_payload(row: UserSkill) -> dict:
    payload = {
        "id": row.id,
        "skill_id": row.skill_id,
        "visibility": row.visibility,
        "name": row.name,
        "description": row.description,
        "enabled": row.enabled,
        "instructions_preview": (row.instructions or "")[:240],
        "source_asset_id": row.source_asset_id,
        "storage": "cos" if row.source_asset_id else "local",
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }
    if row.source_asset_id and row.source_asset:
        payload["cos_url"] = row.source_asset.cos_url
    return payload


def _asset_row_payload(row: SkillAsset) -> dict:
    return {
        "id": row.id,
        "skill_id": row.skill_id,
        "name": row.name,
        "description": row.description,
        "original_filename": row.original_filename,
        "cos_bucket": row.cos_bucket,
        "cos_key": row.cos_key,
        "cos_url": row.cos_url,
        "file_size": row.file_size,
        "instructions_preview": row.instructions_preview,
        "package_kind": row.package_kind,
        "package_file_count": len(row.package_manifest or []),
        "has_scripts": any(
            (item.get("path") or "").startswith("scripts/")
            for item in (row.package_manifest or [])
        ),
        "storage": "cos" if row.cos_bucket else "local",
        "uploader": getattr(row.uploader, "username", "") or "",
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def _read_upload(request) -> tuple[str, bytes]:
    if request.FILES.get("file"):
        upload = request.FILES["file"]
        return upload.name, upload.read()
    content = str(request.data.get("content") or "").strip()
    if not content:
        raise ValueError("请上传文件或提供 content")
    name = str(request.data.get("filename") or request.data.get("name") or "SKILL.md")
    if not name.endswith(".md"):
        name = f"{name}.md" if "." not in name else name
    return name, content.encode("utf-8")


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def skill_list(request):
    # 共享仓库自动同步到当前用户，避免别人账号打开对话空 Skill
    ensure_shared_skills_for_user(request.user)
    rows = list_user_skills(request.user)
    return Response({"count": len(rows), "results": [_skill_row_payload(r) for r in rows]})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def asset_list(request):
    rows = list_skill_assets(shared=True)
    return Response({
        "count": len(rows),
        "results": [_asset_row_payload(r) for r in rows],
        "cos_enabled": cos_enabled(),
        "shared": True,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def asset_upload(request):
    """上传到 COS Skill 仓库(路径与 media 分离);默认不自动加入个人 Skill。"""
    try:
        filename, data = _read_upload(request)
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)

    adopt = bool(request.data.get("adopt", False))
    asset, personal = save_skill_asset_from_bytes(
        request.user, filename, data, adopt=adopt,
    )

    if asset:
        body = {
            "ok": True,
            "asset": _asset_row_payload(asset),
            "cos_enabled": True,
            "adopted": bool(personal),
        }
        if personal:
            body["personal"] = _skill_row_payload(personal)
        return Response(body, status=status.HTTP_201_CREATED)

    # COS 未启用:回退为直接写个人 Skill
    body = {
        "ok": True,
        "cos_enabled": False,
        "personal": _skill_row_payload(personal),
        "message": "未启用 COS,已保存到个人 Skill",
    }
    return Response(body, status=status.HTTP_201_CREATED)


asset_upload.parser_classes = (MultiPartParser, FormParser)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def asset_adopt(request, skill_id: str):
    """将共享仓库中的 Skill 启用到个人列表(用于 @ 调用)。"""
    asset = find_shared_asset(skill_id)
    if not asset:
        return Response({"ok": False, "error": "仓库中不存在该 Skill"}, status=404)
    personal = materialize_user_skill(request.user, asset)
    return Response({
        "ok": True,
        "personal": _skill_row_payload(personal),
        "asset": _asset_row_payload(asset),
    })


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def asset_detail(request, skill_id: str):
    delete_skill_asset(request.user, skill_id)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "DELETE", "PATCH"])
@permission_classes([IsAuthenticated])
def skill_detail(request, skill_id: str):
    row = get_object_or_404(UserSkill, user=request.user, skill_id=skill_id)
    if request.method == "DELETE":
        row.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    if request.method == "PATCH":
        if "enabled" in request.data:
            row.enabled = bool(request.data.get("enabled"))
        if request.data.get("description") is not None:
            row.description = str(request.data.get("description") or "").strip()
        row.save()
        return Response(_skill_row_payload(row))
    return Response({
        **_skill_row_payload(row),
        "raw_content": row.raw_content,
        "instructions": row.instructions,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def skill_upload(request):
    """兼容旧接口:启用 COS 时写入仓库;可通过 adopt=1 同时启用到个人列表。"""
    try:
        filename, data = _read_upload(request)
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)

    adopt = request.data.get("adopt")
    if adopt is None:
        adopt = not cos_enabled()

    asset, personal = save_skill_asset_from_bytes(
        request.user, filename, data, adopt=bool(adopt),
    )
    if asset:
        return Response({
            "ok": True,
            "created": True,
            **_asset_row_payload(asset),
            "adopted": bool(personal),
            "personal": _skill_row_payload(personal) if personal else None,
        }, status=status.HTTP_201_CREATED)

    return Response({
        "ok": True,
        "created": True,
        **_skill_row_payload(personal),
    }, status=status.HTTP_201_CREATED)


skill_upload.parser_classes = (MultiPartParser, FormParser)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def skill_invoke(request, skill_id: str):
    row = get_object_or_404(UserSkill, user=request.user, skill_id=skill_id, enabled=True)
    message = str(request.data.get("message") or "").strip()
    if not message:
        return Response({"ok": False, "error": "message 不能为空"}, status=400)

    from apps.core.agent_chat import run_chat

    result = run_chat(
        message,
        history=request.data.get("history") or [],
        user=request.user,
        skill_ids=[row.skill_id],
    )
    result["skills"] = skills_payload([row])
    code = 200 if result.get("ok") else 400
    return Response(result, status=code)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def skill_resolve_preview(request):
    message = str(request.data.get("message") or "")
    ids = request.data.get("skill_ids") or []
    skills = resolve_skills(message, request.user, skill_ids=ids)
    return Response({"count": len(skills), "results": skills_payload(skills)})
