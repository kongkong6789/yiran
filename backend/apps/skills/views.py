"""Skill 上传 / 管理 / 调用 API。"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .analytics import build_skill_analytics, management_scope
from .cos_storage import cos_enabled
from .models import SkillAsset, UserSkill
from .parser import build_skill_folder_archive, extract_skill_from_upload, parse_skill_markdown
from .repository import (
    delete_skill_asset,
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
        "owner_id": row.source_asset.owner_id if row.source_asset_id and row.source_asset else None,
        "owner": (
            (row.source_asset.owner.get_full_name().strip() or row.source_asset.owner.username)
            if row.source_asset_id and row.source_asset and row.source_asset.owner_id
            else ""
        ),
        "visibility": (
            row.source_asset.visibility
            if row.source_asset_id and row.source_asset
            else SkillAsset.Visibility.PRIVATE
        ),
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


def _asset_row_payload(row: SkillAsset, user=None) -> dict:
    return {
        "id": row.id,
        "skill_id": row.skill_id,
        "visibility": row.visibility,
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
        "is_uploader": bool(user and row.uploader_id == user.id),
        "owner_id": row.owner_id,
        "owner": (
            (row.owner.get_full_name().strip() or row.owner.username)
            if row.owner_id
            else ""
        ),
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def _read_upload(request) -> tuple[str, bytes]:
    if request.FILES.get("file"):
        upload = request.FILES["file"]
        return upload.name, upload.read()
    folder_uploads = request.FILES.getlist("files")
    if folder_uploads:
        paths = request.data.getlist("paths")
        if paths and len(paths) != len(folder_uploads):
            raise ValueError("技能文件夹路径信息不完整,请重新选择文件夹")
        folder_files = [
            (str(paths[index] if paths else upload.name), upload.read())
            for index, upload in enumerate(folder_uploads)
        ]
        return build_skill_folder_archive(folder_files)
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
    rows = list_user_skills(request.user)
    return Response({"count": len(rows), "results": [_skill_row_payload(r) for r in rows]})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def asset_list(request):
    rows = list_skill_assets(user=request.user, shared=True)
    return Response({
        "count": len(rows),
        "results": [_asset_row_payload(r, request.user) for r in rows],
        "cos_enabled": cos_enabled(),
        "shared": True,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def skill_analytics(request):
    return Response(build_skill_analytics(request.user))


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def asset_owner_update(request, asset_id: int):
    can_manage, _, scoped_user_ids = management_scope(request.user)
    if not can_manage:
        return Response({"ok": False, "error": "仅企业管理员可调整技能责任人"}, status=403)

    assets = SkillAsset.objects.select_related("owner", "uploader")
    if scoped_user_ids is not None:
        assets = assets.filter(uploader_id__in=scoped_user_ids)
    asset = get_object_or_404(assets, id=asset_id)

    owner_id = request.data.get("owner_id")
    if owner_id in (None, ""):
        owner = None
    else:
        owners = get_user_model().objects.filter(is_active=True)
        if scoped_user_ids is not None:
            owners = owners.filter(id__in=scoped_user_ids)
        owner = get_object_or_404(owners, id=owner_id)
    asset.owner = owner
    asset.save(update_fields=["owner", "updated_at"])
    return Response({"ok": True, "asset": _asset_row_payload(asset, request.user)})


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def asset_visibility_update(request, asset_id: int):
    asset = get_object_or_404(
        SkillAsset.objects.select_related("owner", "uploader"),
        id=asset_id,
    )
    if asset.uploader_id != request.user.id and not (request.user.is_staff or request.user.is_superuser):
        return Response({"ok": False, "error": "仅上传者可发布或取消共享"}, status=403)

    visibility = str(request.data.get("visibility") or "")
    if visibility not in SkillAsset.Visibility.values:
        return Response({"ok": False, "error": "技能可见范围无效"}, status=400)

    revoked_count = 0
    if visibility == SkillAsset.Visibility.PRIVATE:
        revoked_count, _ = UserSkill.objects.filter(source_asset=asset).exclude(user_id=asset.uploader_id).delete()
    asset.visibility = visibility
    asset.save(update_fields=["visibility", "updated_at"])
    return Response({
        "ok": True,
        "asset": _asset_row_payload(asset, request.user),
        "revoked_count": revoked_count,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def asset_upload(request):
    """上传到 COS Skill 仓库(路径与 media 分离);默认不自动加入个人 Skill。"""
    try:
        filename, data = _read_upload(request)
        adopt = bool(request.data.get("adopt", False))
        asset, personal = save_skill_asset_from_bytes(
            request.user, filename, data, adopt=adopt,
        )
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)

    if asset:
        body = {
            "ok": True,
            "asset": _asset_row_payload(asset, request.user),
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
        "asset": _asset_row_payload(asset, request.user),
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
            **_asset_row_payload(asset, request.user),
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
        usage_source="direct",
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
