"""Skill 上传 / 管理 / 调用 API。"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .analytics import build_skill_analytics, management_scope, user_avatar_url
from .cos_storage import cos_enabled
from .models import SkillAsset, SkillUsageEvent, UserSkill
from .parser import (
    MAX_SKILL_BYTES,
    MAX_SKILL_PACKAGE_FILES,
    MAX_SKILL_ZIP_BYTES,
    build_skill_folder_archive,
    extract_skill_from_upload,
    parse_skill_markdown,
)
from .repository import (
    SkillFileConflictError,
    asset_file_manifest,
    delete_skill_asset,
    find_shared_asset,
    list_skill_assets,
    materialize_user_skill,
    read_asset_text_file,
    save_skill_asset_from_bytes,
    save_asset_text_file,
)
from .skillhub import SkillHubError, download_verified_skill, get_skill_detail, search_skills
from .service import list_user_skills, resolve_skills, skills_payload

logger = logging.getLogger(__name__)


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
    can_edit = bool(user and (
        row.owner_id == user.id
        or getattr(user, "is_staff", False)
        or getattr(user, "is_superuser", False)
    ))
    return {
        "id": row.id,
        "skill_id": row.skill_id,
        "source": row.source,
        "source_url": row.source_url,
        "source_version": row.source_version,
        "source_verified": row.source_verified,
        "source_metadata": row.source_metadata,
        "content_hash": row.content_hash,
        "category": row.category,
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
        "is_owner": bool(user and row.owner_id == user.id),
        "can_edit": can_edit,
        "owner_id": row.owner_id,
        "owner": (
            (row.owner.get_full_name().strip() or row.owner.username)
            if row.owner_id
            else ""
        ),
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


def _asset_queryset_for_user(user):
    if user.is_staff or user.is_superuser:
        return SkillAsset.objects.all()
    return SkillAsset.objects.filter(
        Q(visibility=SkillAsset.Visibility.SHARED) | Q(uploader=user) | Q(owner=user)
    )


def _can_edit_asset(user, asset: SkillAsset) -> bool:
    return bool(asset.owner_id == user.id or user.is_staff or user.is_superuser)


def _usage_event_payload(row: SkillUsageEvent) -> dict:
    user = row.user
    return {
        "id": row.id,
        "skill_id": row.skill_id,
        "skill_name": row.skill_name,
        "user_id": row.user_id,
        "user": (user.get_full_name().strip() or user.username) if user else "未知用户",
        "avatar_url": user_avatar_url(user),
        "source": row.source,
        "source_label": row.get_source_display(),
        "used_at": row.used_at.isoformat(),
    }


def _read_upload(request) -> tuple[str, bytes]:
    if request.FILES.get("file"):
        upload = request.FILES["file"]
        lower_name = str(upload.name or "").lower()
        max_bytes = MAX_SKILL_ZIP_BYTES if lower_name.endswith(".zip") else MAX_SKILL_BYTES
        if upload.size > max_bytes:
            label = f"{max_bytes // (1024 * 1024)}MB" if max_bytes >= 1024 * 1024 else f"{max_bytes // 1024}KB"
            raise ValueError(f"{upload.name} 过大,上限 {label}")
        return upload.name, upload.read()
    folder_uploads = request.FILES.getlist("files")
    if folder_uploads:
        if len(folder_uploads) > MAX_SKILL_PACKAGE_FILES:
            raise ValueError(f"Skill 文件夹文件过多,上限 {MAX_SKILL_PACKAGE_FILES} 个")
        total_size = sum(upload.size for upload in folder_uploads)
        if total_size > MAX_SKILL_ZIP_BYTES:
            raise ValueError(f"Skill 文件夹过大,上限 {MAX_SKILL_ZIP_BYTES // (1024 * 1024)}MB")
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
    today = timezone.localdate()
    raw_start = request.query_params.get("trend_start")
    raw_end = request.query_params.get("trend_end")
    try:
        trend_end = date.fromisoformat(raw_end) if raw_end else today
        trend_start = date.fromisoformat(raw_start) if raw_start else trend_end - timedelta(days=6)
    except ValueError:
        return Response({"error": "日期格式无效，请使用 YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)

    trend_days = (trend_end - trend_start).days + 1
    if trend_end > today:
        return Response({"error": "趋势结束日期不能晚于今天"}, status=status.HTTP_400_BAD_REQUEST)
    if trend_days < 1:
        return Response({"error": "趋势开始日期不能晚于结束日期"}, status=status.HTTP_400_BAD_REQUEST)
    if trend_days > 90:
        return Response({"error": "单次最多查询 90 天趋势"}, status=status.HTTP_400_BAD_REQUEST)

    return Response(build_skill_analytics(
        request.user,
        trend_start=trend_start,
        trend_end=trend_end,
    ))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def skillhub_search(request):
    try:
        result = search_skills(
            str(request.query_params.get("q") or ""),
            page=int(request.query_params.get("page") or 1),
            page_size=int(request.query_params.get("page_size") or 12),
            sort_by=str(request.query_params.get("sort_by") or "score"),
            source=str(request.query_params.get("source") or ""),
            category=str(request.query_params.get("category") or ""),
            api_key=str(request.query_params.get("api_key") or ""),
        )
    except (SkillHubError, TypeError, ValueError) as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)
    return Response({"ok": True, **result})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def skillhub_detail(request, slug: str):
    try:
        detail = get_skill_detail(slug)
    except SkillHubError as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)
    return Response({"ok": True, "skill": detail})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def skillhub_import(request):
    slug = str(request.data.get("slug") or "")
    version = str(request.data.get("version") or "") or None
    category = str(request.data.get("category") or SkillAsset.Category.GENERAL)
    adopt = bool(request.data.get("adopt", True))
    try:
        detail, data, verification = download_verified_skill(slug, version)
        existing = SkillAsset.objects.filter(
            uploader=request.user,
            source=SkillAsset.Source.SKILLHUB,
            source_metadata__slug=detail["slug"],
        ).first()
        asset, personal = save_skill_asset_from_bytes(
            request.user,
            f"{detail['slug']}-{detail['version']}.zip",
            data,
            adopt=adopt,
            visibility=existing.visibility if existing else SkillAsset.Visibility.PRIVATE,
            category=category,
            source=SkillAsset.Source.SKILLHUB,
            source_url=detail["detail_url"],
            source_version=detail["version"],
            source_verified=bool(verification.get("verified")),
            source_metadata={
                "slug": detail["slug"],
                "owner": detail.get("owner", ""),
                "downloads": detail.get("downloads", 0),
                "stars": detail.get("stars", 0),
                "security_reports": {
                    key: {
                        "status": report.get("status", "unknown"),
                        "status_text": report.get("status_text", "未提供结论"),
                    }
                    for key, report in detail.get("security_reports", {}).items()
                    if isinstance(report, dict)
                },
                "verification_status": verification.get("status", "unknown"),
                "signature_key_id": verification.get("key_id", ""),
            },
            content_hash=str(verification.get("content_hash") or ""),
        )
    except (SkillHubError, ValueError) as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)
    return Response({
        "ok": True,
        "asset": _asset_row_payload(asset, request.user),
        "personal": _skill_row_payload(personal) if personal else None,
        "adopted": bool(personal),
        "verification": verification,
    }, status=status.HTTP_201_CREATED)


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


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def asset_category_update(request, asset_id: int):
    asset = get_object_or_404(
        SkillAsset.objects.select_related("owner", "uploader"),
        id=asset_id,
    )
    can_manage, _, scoped_user_ids = management_scope(request.user)
    manager_in_scope = can_manage and (
        scoped_user_ids is None or asset.uploader_id in scoped_user_ids
    )
    if asset.uploader_id != request.user.id and not manager_in_scope:
        return Response({"ok": False, "error": "仅上传者或企业管理员可调整能力分类"}, status=403)

    category = str(request.data.get("category") or "")
    if category not in SkillAsset.Category.values:
        return Response({"ok": False, "error": "能力分类无效"}, status=400)

    asset.category = category
    asset.save(update_fields=["category", "updated_at"])
    return Response({"ok": True, "asset": _asset_row_payload(asset, request.user)})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def asset_upload(request):
    """上传到 COS Skill 仓库(路径与 media 分离);默认不自动加入个人 Skill。"""
    try:
        filename, data = _read_upload(request)
        adopt = bool(request.data.get("adopt", False))
        category = str(request.data.get("category") or SkillAsset.Category.GENERAL)
        asset, personal = save_skill_asset_from_bytes(
            request.user,
            filename,
            data,
            adopt=adopt,
            category=category,
            skill_id_override=str(request.data.get("skill_id") or "").strip() or None,
        )
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)
    except Exception:
        logger.exception("Skill 资产上传失败 user_id=%s", request.user.id)
        return Response({"ok": False, "error": "技能存储服务处理失败，请稍后重试"}, status=502)

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


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def asset_usage_history(request, asset_id: int):
    """返回当前用户有权查看的 Skill 完整调用记录。"""
    can_manage, _, scoped_user_ids = management_scope(request.user)
    assets = SkillAsset.objects.select_related("uploader", "owner")
    if can_manage:
        if scoped_user_ids is not None:
            assets = assets.filter(uploader_id__in=scoped_user_ids)
    else:
        assets = assets.filter(Q(uploader=request.user) | Q(visibility=SkillAsset.Visibility.SHARED))
    asset = get_object_or_404(assets, id=asset_id)

    events = SkillUsageEvent.objects.filter(asset=asset).select_related("user", "user__settings")
    if not can_manage and asset.uploader_id != request.user.id:
        events = events.filter(user=request.user)

    try:
        page = max(1, int(request.query_params.get("page") or 1))
        page_size = min(50, max(1, int(request.query_params.get("page_size") or 20)))
    except (TypeError, ValueError):
        return Response({"ok": False, "error": "分页参数无效"}, status=400)

    total = events.count()
    start = (page - 1) * page_size
    rows = events[start:start + page_size]
    return Response({
        "ok": True,
        "asset": {"id": asset.id, "skill_id": asset.skill_id, "name": asset.name},
        "page": page,
        "page_size": page_size,
        "count": total,
        "results": [_usage_event_payload(row) for row in rows],
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def asset_files(request, asset_id: int):
    asset = get_object_or_404(
        _asset_queryset_for_user(request.user).select_related("owner", "uploader"),
        id=asset_id,
    )
    return Response({
        "ok": True,
        "asset": _asset_row_payload(asset, request.user),
        "files": asset_file_manifest(asset),
        "version": asset.updated_at.isoformat(),
        "can_edit": _can_edit_asset(request.user, asset),
    })


@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def asset_file_detail(request, asset_id: int, file_path: str):
    asset = get_object_or_404(
        _asset_queryset_for_user(request.user).select_related("owner", "uploader"),
        id=asset_id,
    )
    if request.method == "GET":
        try:
            content = read_asset_text_file(asset, file_path)
        except FileNotFoundError:
            return Response({"ok": False, "error": "技能文件不存在"}, status=404)
        except ValueError as exc:
            return Response({"ok": False, "error": str(exc)}, status=400)
        return Response({
            "ok": True,
            "path": file_path,
            "content": content,
            "version": asset.updated_at.isoformat(),
            "can_edit": _can_edit_asset(request.user, asset),
        })

    if not _can_edit_asset(request.user, asset):
        return Response({"ok": False, "error": "仅技能责任人可编辑文件内容"}, status=403)
    content = request.data.get("content")
    if not isinstance(content, str):
        return Response({"ok": False, "error": "content 必须是文本"}, status=400)
    try:
        updated = save_asset_text_file(
            asset,
            file_path,
            content,
            expected_updated_at=str(request.data.get("expected_version") or ""),
        )
    except SkillFileConflictError as exc:
        return Response({"ok": False, "error": str(exc), "conflict": True}, status=409)
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)
    return Response({
        "ok": True,
        "asset": _asset_row_payload(updated, request.user),
        "path": file_path,
        "content": content,
        "files": asset_file_manifest(updated),
        "version": updated.updated_at.isoformat(),
        "can_edit": True,
    })


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
        request.user,
        filename,
        data,
        adopt=bool(adopt),
        category=str(request.data.get("category") or SkillAsset.Category.GENERAL),
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
