from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from xml.etree import ElementTree

from .binding_service import create_sync_job, dispatch_sync_job, manual_bind, match_user, resolve_binding_config, run_sync_job
from .models import UserWeComBinding, WeComApiConfig, WeComBindingAuditLog, WeComBindingSyncJob, WeComContact
from .serializers import (
    BindingAuditLogSerializer, BindingSyncJobSerializer, ManualBindingSerializer,
    UserWeComBindingSerializer, WeComApiConfigSerializer, WeComContactSerializer, WeComManagedContactSerializer, WeComCallbackEventSerializer,
    WeComGroupWebhookSerializer, TaskNotificationSerializer, WeComNotificationRecordSerializer,
)
from .services import WeComApiError, WeComClient
from .contact_service import get_cached_contacts, sync_contacts
from .callback_service import MAX_CALLBACK_BYTES, decrypt_verified_payload, receive_event
from .crypto import WeComCallbackCryptoError
from .models import WeComCallbackEvent, WeComGroupWebhook, WeComNotificationRecord
from .notification_service import retry_notification, send_task_notification
from .access import (
    accessible_config_queryset,
    accessible_webhook_queryset,
    resolve_accessible_config,
    resolve_accessible_webhook,
)
from apps.core.organizations import create_personal_organization, current_organization, is_organization_admin, organization_user_ids
from apps.core.permissions import IsOrganizationAdmin


@api_view(["GET", "PUT", "PATCH"])
@permission_classes([IsAuthenticated])
def api_config(request):
    organization = current_organization(request.user)
    if not organization:
        organization = create_personal_organization(request.user).organization
    can_manage_org = is_organization_admin(request.user, organization)
    config = resolve_accessible_config(request.user, require_manage=request.method != "GET")
    if not config and can_manage_org:
        config, _ = WeComApiConfig.objects.get_or_create(
            user=request.user,
            defaults={"organization": organization},
        )
        if not config.organization_id and organization:
            config.organization = organization
            config.save(update_fields=["organization", "updated_at"])
    if not config:
        if request.method != "GET":
            return Response({"ok": False, "detail": "仅企业管理员可修改企业微信配置。"}, status=403)
        return Response({
            "ok": True,
            "corpId": "",
            "agentId": "",
            "secret": "",
            "callbackUrl": "",
            "token": "",
            "encodingAesKey": "",
            "configured": False,
            "canManage": False,
            "accessScope": "owner",
            "allowedUserIds": [],
            "organization": {"id": organization.id, "name": organization.name} if organization else None,
            "detail": "当前企业尚未向你授权企业微信连接。",
        })
    if request.method == "GET":
        return Response({"ok": True, **WeComApiConfigSerializer(config, context={"request": request}).data})
    if not config.can_manage(request.user):
        return Response({"ok": False, "detail": "仅企业管理员可修改企业微信配置。"}, status=403)

    serializer = WeComApiConfigSerializer(
        config,
        data=request.data,
        partial=request.method == "PATCH",
        context={"request": request},
    )
    serializer.is_valid(raise_exception=True)
    saved = serializer.save()
    return Response({"ok": True, **WeComApiConfigSerializer(saved, context={"request": request}).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def test_api_config(request):
    existing = resolve_accessible_config(request.user, require_manage=True)
    organization = current_organization(request.user)
    if not organization:
        organization = create_personal_organization(request.user).organization
    if not is_organization_admin(request.user, organization) and not (existing and existing.can_manage(request.user)):
        return Response({"ok": False, "detail": "仅企业管理员可测试企业微信配置。"}, status=403)
    corp_id = str(request.data.get("corpId") or "").strip()
    agent_id = str(request.data.get("agentId") or "").strip()
    secret = str(request.data.get("secret") or "")
    if secret == "***":
        secret = existing.secret if existing else ""
    if not corp_id or not agent_id or not secret:
        return Response({"ok": False, "detail": "请先填写 CorpID、AgentID 和 Secret。"}, status=400)
    config = WeComApiConfig(user=request.user, organization=organization, corp_id=corp_id, agent_id=agent_id)
    config.secret = secret
    try:
        client = WeComClient(config)
        app = client.test_wecom_connection()
        contacts = client.get_visible_contacts()
    except WeComApiError as exc:
        return Response({"ok": False, "code": exc.code, "detail": exc.detail}, status=exc.status_code)
    return Response({"ok": True, "appName": app["appName"], "visibleMembers": len(contacts), "permission": "正常"})


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def callback(request, callback_key):
    """企业微信公开回调：URL 验证与加密事件接收。认证由签名、AES 和 CorpID 完成。"""
    config = WeComApiConfig.objects.filter(callback_key=callback_key).first()
    if not config:
        return HttpResponse("not found", status=404, content_type="text/plain")
    signature = str(request.query_params.get("msg_signature") or "")
    timestamp = str(request.query_params.get("timestamp") or "")
    nonce = str(request.query_params.get("nonce") or "")
    if not signature or not timestamp or not nonce:
        return HttpResponse("invalid request", status=400, content_type="text/plain")
    try:
        if request.method == "GET":
            encrypted = str(request.query_params.get("echostr") or "")
            if not encrypted:
                raise WeComCallbackCryptoError("缺少 echostr。")
            echo = decrypt_verified_payload(
                config, signature=signature, timestamp=timestamp, nonce=nonce, encrypted=encrypted,
            )
            WeComApiConfig.objects.filter(pk=config.pk).update(callback_verified_at=timezone.now())
            return HttpResponse(echo, content_type="text/plain; charset=utf-8")

        if len(request.body) > MAX_CALLBACK_BYTES:
            return HttpResponse("payload too large", status=413, content_type="text/plain")
        body_text = request.body.decode("utf-8")
        if "<!DOCTYPE" in body_text.upper() or "<!ENTITY" in body_text.upper():
            raise WeComCallbackCryptoError("XML 包含不允许的声明。")
        root = ElementTree.fromstring(body_text)
        encrypted = str(root.findtext("Encrypt") or "")
        if not encrypted:
            raise WeComCallbackCryptoError("缺少 Encrypt。")
        receive_event(
            config, signature=signature, timestamp=timestamp, nonce=nonce, encrypted=encrypted,
        )
        return HttpResponse("success", content_type="text/plain; charset=utf-8")
    except (WeComCallbackCryptoError, ElementTree.ParseError, UnicodeDecodeError):
        # 不返回密码学细节，避免被用于探测签名或密钥。
        return HttpResponse("invalid callback", status=400, content_type="text/plain")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def contacts(request):
    config = resolve_accessible_config(request.user)
    if not config:
        return Response(
            {"ok": False, "configured": False, "code": "wecom_not_configured", "detail": "当前企业尚未配置企业微信 API，或管理员未向你授权。"},
            status=status.HTTP_409_CONFLICT,
        )
    if request.method == "POST" and not config.can_manage(request.user):
        return Response({"ok": False, "detail": "仅企业管理员可主动同步通讯录。"}, status=403)

    use_cache = request.method == "GET" and config.contacts_synced_at is not None
    try:
        results = get_cached_contacts(config) if use_cache else sync_contacts(config)
    except WeComApiError as exc:
        return Response(
            {"ok": False, "configured": config.configured, "code": exc.code, "detail": exc.detail},
            status=exc.status_code,
        )

    return Response({
        "ok": True,
        "configured": True,
        "dataSource": "database" if use_cache else "wecom_sync",
        "syncedAt": config.contacts_synced_at,
        "count": len(results),
        "results": WeComContactSerializer(results, many=True).data,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def managed_contacts(request):
    config = resolve_accessible_config(request.user)
    if not config or not config.can_manage(request.user):
        return Response({"ok": False, "detail": "仅企业管理员可以读取账号绑定所需的成员标识。"}, status=403)
    results = get_cached_contacts(config)
    return Response({
        "ok": True,
        "dataSource": "database",
        "count": len(results),
        "results": WeComManagedContactSerializer(results, many=True).data,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def callback_events(request):
    configs = accessible_config_queryset(request.user, include_disabled=True)
    rows = WeComCallbackEvent.objects.filter(config__in=configs).order_by("-received_at")[:100]
    return Response({"ok": True, "count": rows.count(), "results": WeComCallbackEventSerializer(rows, many=True).data})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def group_webhooks(request):
    if request.method == "GET":
        rows = accessible_webhook_queryset(request.user, include_disabled=True)
        return Response({"ok": True, "count": rows.count(), "results": WeComGroupWebhookSerializer(rows, many=True, context={"request": request}).data})
    organization = current_organization(request.user)
    if not organization:
        organization = create_personal_organization(request.user).organization
    if not is_organization_admin(request.user, organization):
        return Response({"ok": False, "detail": "仅企业管理员可新增群机器人。"}, status=403)
    serializer = WeComGroupWebhookSerializer(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    row = serializer.save()
    return Response({"ok": True, "group": WeComGroupWebhookSerializer(row, context={"request": request}).data}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def group_webhook_detail(request, webhook_id: int):
    row = resolve_accessible_webhook(request.user, webhook_id, require_manage=True)
    if not row:
        return Response({"ok": False, "error": "群机器人配置不存在。"}, status=404)
    if request.method == "DELETE":
        row.delete()
        return Response({"ok": True})
    serializer = WeComGroupWebhookSerializer(row, data=request.data, partial=True, context={"request": request})
    serializer.is_valid(raise_exception=True)
    row = serializer.save()
    return Response({"ok": True, "group": WeComGroupWebhookSerializer(row, context={"request": request}).data})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def group_webhook_test(request, webhook_id: int):
    row = resolve_accessible_webhook(request.user, webhook_id, require_manage=True)
    if row and not row.enabled:
        row = None
    if not row:
        return Response({"ok": False, "detail": "群机器人不存在或已停用。"}, status=404)
    try:
        from .services import send_group_webhook_markdown
        send_group_webhook_markdown(
            row.webhook_key,
            "## ✅ 良策测试消息\n> 群机器人连接正常\n\n<font color=\"comment\">此消息由配置页面主动发送。</font>",
        )
        row.last_success_at = timezone.now()
        row.last_error_code = ""
        row.last_error_reason = ""
        row.save(update_fields=["last_success_at", "last_error_code", "last_error_reason", "updated_at"])
    except WeComApiError as exc:
        row.last_failure_at = timezone.now()
        row.last_error_code = exc.code
        row.last_error_reason = exc.detail[:500]
        row.save(update_fields=["last_failure_at", "last_error_code", "last_error_reason", "updated_at"])
        return Response({"ok": False, "code": exc.code, "detail": exc.detail}, status=exc.status_code)
    return Response({"ok": True, "detail": "测试消息已被企业微信受理。", "group": WeComGroupWebhookSerializer(row, context={"request": request}).data})


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def notifications(request):
    if request.method == "GET":
        rows = WeComNotificationRecord.objects.select_related("user")
        if request.user.is_superuser and request.query_params.get("all") == "1":
            pass
        elif is_organization_admin(request.user) and request.query_params.get("all") == "1":
            rows = rows.filter(user_id__in=organization_user_ids(current_organization(request.user)))
        else:
            rows = rows.filter(user=request.user)
        rows = rows[:100]
        return Response({"ok": True, "count": len(rows), "results": WeComNotificationRecordSerializer(rows, many=True).data})
    serializer = TaskNotificationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        row = send_task_notification(user=request.user, data=serializer.validated_data)
    except WeComApiError as exc:
        return Response({"ok": False, "code": exc.code, "detail": exc.detail}, status=exc.status_code)
    if row.status == WeComNotificationRecord.Status.PARTIAL:
        http_status = status.HTTP_207_MULTI_STATUS
    elif row.status == WeComNotificationRecord.Status.RETRY_WAITING:
        http_status = status.HTTP_202_ACCEPTED
    elif row.status == WeComNotificationRecord.Status.FAILED:
        http_status = status.HTTP_403_FORBIDDEN if row.error_code == "WEWORK_NO_PERMISSION" else status.HTTP_502_BAD_GATEWAY
    else:
        http_status = status.HTTP_200_OK
    return Response({"ok": row.status in {WeComNotificationRecord.Status.ACCEPTED, WeComNotificationRecord.Status.PARTIAL}, "notification": WeComNotificationRecordSerializer(row).data}, status=http_status)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def retry_notification_view(request, notification_id: int):
    qs = WeComNotificationRecord.objects.select_related("config", "group_webhook", "user")
    if request.user.is_superuser:
        row = qs.filter(id=notification_id).first()
    elif is_organization_admin(request.user):
        row = qs.filter(id=notification_id, user_id__in=organization_user_ids(current_organization(request.user))).first()
    else:
        row = qs.filter(id=notification_id, user=request.user).first()
    if not row:
        return Response({"ok": False, "detail": "通知记录不存在。"}, status=404)
    row = retry_notification(row, force=bool(request.user.is_staff or request.user.is_superuser))
    code = 202 if row.status == WeComNotificationRecord.Status.RETRY_WAITING else 200
    return Response({"ok": row.status in {WeComNotificationRecord.Status.ACCEPTED, WeComNotificationRecord.Status.PARTIAL}, "notification": WeComNotificationRecordSerializer(row).data}, status=code)


User = get_user_model()


def _serialize_bindings(rows, *, many=True):
    items = list(rows) if many else [rows]
    config_ids = {item.wecom_config_id for item in items if item.wecom_config_id}
    user_ids = {item.wecom_userid for item in items if item.wecom_userid}
    contacts = WeComContact.objects.filter(
        config_id__in=config_ids,
        wecom_userid__in=user_ids,
    )
    contact_map = {(item.config_id, item.wecom_userid): item for item in contacts}
    serializer = UserWeComBindingSerializer(
        items if many else rows,
        many=many,
        context={"contact_map": contact_map},
    )
    return serializer.data


def _admin_config(request):
    config = resolve_binding_config(actor=request.user)
    if not config or not config.configured:
        return None, Response({"ok": False, "error": "请先配置可用的企业微信 API。"}, status=409)
    return config, None


@api_view(["GET"])
@permission_classes([IsOrganizationAdmin])
def bindings(request):
    organization = current_organization(request.user)
    qs = UserWeComBinding.objects.select_related("platform_user", "platform_user__settings").filter(
        platform_user_id__in=organization_user_ids(organization),
    ).order_by("-updated_at")
    status_value = str(request.query_params.get("status") or "").strip()
    q = str(request.query_params.get("q") or "").strip()
    if status_value:
        qs = qs.filter(status=status_value)
    if q:
        qs = qs.filter(Q(platform_user__username__icontains=q) | Q(platform_user__settings__display_name__icontains=q) | Q(wecom_userid__icontains=q))
    page = max(int(request.query_params.get("page") or 1), 1)
    page_size = min(max(int(request.query_params.get("page_size") or 50), 1), 100)
    total = qs.count()
    rows = qs[(page - 1) * page_size:page * page_size]
    return Response({"ok": True, "count": total, "results": _serialize_bindings(rows)})


@api_view(["POST"])
@permission_classes([IsOrganizationAdmin])
def sync_bindings(request):
    config, error = _admin_config(request)
    if error:
        return error
    job = create_sync_job(config=config, actor=request.user, batch_size=request.data.get("batch_size", 100))
    if str(request.query_params.get("wait") or "") == "1":
        run_sync_job(job)
    else:
        dispatch_sync_job(job.id)
    return Response({"ok": True, "job": BindingSyncJobSerializer(job).data}, status=202)


@api_view(["POST"])
@permission_classes([IsOrganizationAdmin])
def match_binding(request, user_id: int):
    config, error = _admin_config(request)
    if error:
        return error
    if not User.objects.filter(id=user_id, id__in=organization_user_ids(current_organization(request.user))).exists():
        return Response({"ok": False, "error": "平台用户不存在。"}, status=404)
    binding = match_user(user_id, source=UserWeComBinding.Source.MANUAL, config=config, actor=request.user, force=True)
    return Response({"ok": True, "binding": _serialize_bindings(binding, many=False)})


@api_view(["POST"])
@permission_classes([IsOrganizationAdmin])
def manual_binding(request):
    config, error = _admin_config(request)
    if error:
        return error
    serializer = ManualBindingSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = User.objects.filter(
        id=serializer.validated_data["platformUserId"],
        id__in=organization_user_ids(current_organization(request.user)),
    ).first()
    if not user:
        return Response({"ok": False, "error": "平台用户不存在。"}, status=404)
    try:
        binding = manual_bind(platform_user=user, wecom_userid=serializer.validated_data["weComUserId"], config=config, actor=request.user)
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=409)
    return Response({"ok": True, "binding": _serialize_bindings(binding, many=False)})


@api_view(["DELETE"])
@permission_classes([IsOrganizationAdmin])
def delete_binding(request, binding_id: int):
    binding = UserWeComBinding.objects.filter(
        id=binding_id,
        platform_user_id__in=organization_user_ids(current_organization(request.user)),
    ).first()
    if not binding:
        return Response({"ok": False, "error": "绑定记录不存在。"}, status=404)
    WeComBindingAuditLog.objects.create(platform_user=binding.platform_user, actor=request.user, action="unbind", status="disabled", message="管理员已解除企业微信绑定。")
    binding.delete()
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([IsOrganizationAdmin])
def sync_jobs(request):
    config = resolve_binding_config(actor=request.user)
    rows = WeComBindingSyncJob.objects.filter(config=config).order_by("-created_at")[:100] if config else []
    return Response({"ok": True, "results": BindingSyncJobSerializer(rows, many=True).data})


@api_view(["GET"])
@permission_classes([IsOrganizationAdmin])
def conflicts(request):
    rows = UserWeComBinding.objects.select_related("platform_user", "platform_user__settings").filter(
        platform_user_id__in=organization_user_ids(current_organization(request.user)),
        status__in=[UserWeComBinding.Status.CONFLICT, UserWeComBinding.Status.DUPLICATE_PHONE],
    ).order_by("-updated_at")
    return Response({"ok": True, "count": rows.count(), "results": _serialize_bindings(rows)})


@api_view(["GET"])
@permission_classes([IsOrganizationAdmin])
def binding_logs(request, binding_id: int):
    rows = WeComBindingAuditLog.objects.filter(
        binding_id=binding_id,
        platform_user_id__in=organization_user_ids(current_organization(request.user)),
    ).select_related("actor").order_by("-created_at")[:200]
    return Response({"ok": True, "results": BindingAuditLogSerializer(rows, many=True).data})
