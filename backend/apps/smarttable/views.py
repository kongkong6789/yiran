import csv
import io
import json
import re

from django.db import transaction
from django.db.models import Max, Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.core.organizations import current_organization, is_organization_admin

from .models import SmartAutomation, SmartColumn, SmartRow, SmartSheet, SmartView
from .serializers import (
    SmartAutomationSerializer,
    SmartColumnSerializer,
    SmartRowSerializer,
    SmartSheetDetailSerializer,
    SmartSheetListSerializer,
    SmartViewSerializer,
)
from .spreadsheet_io import (
    collect_headers,
    infer_column_spec,
    parse_spreadsheet_upload,
    rows_from_csv_text,
    sheet_name_from_filename,
)

DEFAULT_COLUMNS = (
    ("title", "标题", SmartColumn.FieldType.TEXT),
    ("status", "状态", SmartColumn.FieldType.SELECT),
    ("priority", "优先级", SmartColumn.FieldType.SELECT),
    ("owner", "负责人", SmartColumn.FieldType.PERSON),
    ("due", "截止日期", SmartColumn.FieldType.DATE),
    ("tags", "标签", SmartColumn.FieldType.MULTI_SELECT),
    ("done", "已完成", SmartColumn.FieldType.CHECKBOX),
    ("note", "备注", SmartColumn.FieldType.TEXT),
)

STATUS_OPTIONS = ["未开始", "进行中", "已完成"]
PRIORITY_OPTIONS = ["高", "中", "低"]
TAG_OPTIONS = ["经营", "库存", "客服", "紧急"]


def _accessible_sheets(user):
    """本人创建的，或同组织内的表格。"""
    org = current_organization(user)
    qs = SmartSheet.objects.all()
    if org is not None:
        qs = qs.filter(Q(owner=user) | Q(organization=org))
    else:
        qs = qs.filter(owner=user)
    return qs.select_related("owner", "organization").prefetch_related(
        "columns", "rows", "views", "automations"
    ).distinct()


def _can_manage_sheet(user, sheet: SmartSheet) -> bool:
    """改名/删表：创建者或组织管理员。"""
    if sheet.owner_id == getattr(user, "id", None):
        return True
    if sheet.organization_id and is_organization_admin(user, sheet.organization):
        return True
    return bool(getattr(user, "is_superuser", False))


def _get_accessible_sheet(user, sheet_id: int) -> SmartSheet:
    return get_object_or_404(_accessible_sheets(user), pk=sheet_id)


def _ensure_default_views(sheet: SmartSheet):
    if sheet.views.exists():
        return
    SmartView.objects.create(
        sheet=sheet,
        name="表格视图",
        view_type=SmartView.ViewType.GRID,
        position=0,
        config={},
    )
    status_col = sheet.columns.filter(field_type=SmartColumn.FieldType.SELECT).first()
    SmartView.objects.create(
        sheet=sheet,
        name="看板视图",
        view_type=SmartView.ViewType.KANBAN,
        position=1,
        config={"kanban_field": status_col.key if status_col else ""},
    )
    SmartView.objects.create(
        sheet=sheet,
        name="表单视图",
        view_type=SmartView.ViewType.FORM,
        position=2,
        config={},
    )
    SmartView.objects.create(
        sheet=sheet,
        name="仪表盘",
        view_type=SmartView.ViewType.DASHBOARD,
        position=3,
        config={"charts": []},
    )


def _ensure_demo_sheet(user):
    if SmartSheet.objects.filter(owner=user).exists():
        for sheet in SmartSheet.objects.filter(owner=user):
            _ensure_default_views(sheet)
            if sheet.organization_id is None:
                org = current_organization(user)
                if org is not None:
                    sheet.organization = org
                    sheet.save(update_fields=["organization"])
        return
    with transaction.atomic():
        sheet = SmartSheet.objects.create(
            name="示例任务表",
            description="多维表格：表格 / 看板 / 表单（同组织成员可见）",
            owner=user,
            organization=current_organization(user),
        )
        for idx, (key, title, field_type) in enumerate(DEFAULT_COLUMNS):
            options = []
            if key == "status":
                options = list(STATUS_OPTIONS)
            elif key == "priority":
                options = list(PRIORITY_OPTIONS)
            elif key == "tags":
                options = list(TAG_OPTIONS)
            SmartColumn.objects.create(
                sheet=sheet,
                key=key,
                title=title,
                field_type=field_type,
                options=options,
                position=idx,
            )
        SmartRow.objects.create(
            sheet=sheet,
            position=0,
            values={
                "title": "整理本周经营数据",
                "status": "进行中",
                "priority": "高",
                "owner": user.username,
                "due": "",
                "tags": ["经营"],
                "done": False,
                "note": "点击单元格可直接编辑",
            },
        )
        SmartRow.objects.create(
            sheet=sheet,
            position=1,
            values={
                "title": "跟进库存预警 SKU",
                "status": "未开始",
                "priority": "中",
                "owner": "",
                "due": "",
                "tags": ["库存", "紧急"],
                "done": False,
                "note": "",
            },
        )
        SmartRow.objects.create(
            sheet=sheet,
            position=2,
            values={
                "title": "复盘客服差评工单",
                "status": "已完成",
                "priority": "低",
                "owner": user.username,
                "due": "",
                "tags": ["客服"],
                "done": True,
                "note": "",
            },
        )
        _ensure_default_views(sheet)


def _next_position(qs):
    return int(qs.aggregate(m=Max("position")).get("m") or -1) + 1


def _unique_column_key(sheet, title: str) -> str:
    base = "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in (title or "col").strip()) or "col"
    base = base[:48]
    key = base
    n = 1
    while SmartColumn.objects.filter(sheet=sheet, key=key).exists():
        n += 1
        key = f"{base}_{n}"
    return key


def _run_automations(sheet: SmartSheet, trigger: str, row: SmartRow):
    for rule in sheet.automations.filter(enabled=True, trigger=trigger):
        if rule.action != SmartAutomation.Action.SET_FIELD:
            continue
        field = str((rule.config or {}).get("field") or "")
        value = (rule.config or {}).get("value")
        if not field:
            continue
        values = dict(row.values or {})
        values[field] = value
        row.values = values
        row.save(update_fields=["values", "updated_at"])


@api_view(["GET", "POST"])
def sheets(request):
    if request.method == "GET":
        _ensure_demo_sheet(request.user)
        qs = _accessible_sheets(request.user).select_related("owner", "organization")
        kb_raw = request.query_params.get("knowledge_base")
        if kb_raw not in (None, ""):
            try:
                kb_id = int(kb_raw)
            except (TypeError, ValueError):
                return Response({"ok": False, "detail": "knowledge_base 无效"}, status=400)
            qs = qs.filter(knowledge_base_id=kb_id)
        return Response({"results": SmartSheetListSerializer(qs, many=True, context={"request": request}).data})

    name = str(request.data.get("name") or "").strip() or "未命名表格"
    description = str(request.data.get("description") or "").strip()
    knowledge_base_id = None
    kb_raw = request.data.get("knowledge_base")
    if kb_raw not in (None, ""):
        try:
            kb_id = int(kb_raw)
        except (TypeError, ValueError):
            return Response({"ok": False, "detail": "knowledge_base 无效"}, status=400)
        from apps.knowledge.models import KnowledgeBase

        # knowledge 与账号库分离，只能软关联 ID，不能建跨库外键对象
        get_object_or_404(KnowledgeBase.objects.all(), pk=kb_id)
        knowledge_base_id = kb_id
    with transaction.atomic():
        sheet = SmartSheet.objects.create(
            name=name,
            description=description,
            owner=request.user,
            organization=current_organization(request.user),
            knowledge_base_id=knowledge_base_id,
        )
        for idx, (key, title, field_type) in enumerate(DEFAULT_COLUMNS[:4]):
            options = []
            if key == "status":
                options = list(STATUS_OPTIONS)
            elif key == "priority":
                options = list(PRIORITY_OPTIONS)
            SmartColumn.objects.create(
                sheet=sheet,
                key=key,
                title=title,
                field_type=field_type,
                options=options,
                position=idx,
            )
        SmartRow.objects.create(sheet=sheet, position=0, values={})
        _ensure_default_views(sheet)
    return Response(SmartSheetDetailSerializer(sheet).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
def sheet_detail(request, sheet_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    _ensure_default_views(sheet)

    if request.method == "GET":
        return Response(SmartSheetDetailSerializer(sheet).data)

    if request.method == "DELETE":
        if not _can_manage_sheet(request.user, sheet):
            return Response({"ok": False, "detail": "仅创建者或组织管理员可删除表格"}, status=403)
        sheet.delete()
        return Response({"ok": True})

    if not _can_manage_sheet(request.user, sheet):
        return Response({"ok": False, "detail": "仅创建者或组织管理员可修改表格信息"}, status=403)

    name = request.data.get("name")
    description = request.data.get("description")
    if name is not None:
        sheet.name = str(name).strip() or sheet.name
    if description is not None:
        sheet.description = str(description).strip()
    sheet.save()
    return Response(SmartSheetDetailSerializer(sheet, context={"request": request}).data)


@api_view(["POST"])
def create_column(request, sheet_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    title = str(request.data.get("title") or "").strip() or "新列"
    field_type = str(request.data.get("field_type") or SmartColumn.FieldType.TEXT)
    if field_type not in SmartColumn.FieldType.values:
        field_type = SmartColumn.FieldType.TEXT
    options = request.data.get("options") or []
    if not isinstance(options, list):
        options = []
    col = SmartColumn.objects.create(
        sheet=sheet,
        key=_unique_column_key(sheet, title),
        title=title,
        field_type=field_type,
        options=options,
        position=_next_position(sheet.columns.all()),
    )
    sheet.save(update_fields=["updated_at"])
    return Response(SmartColumnSerializer(col).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
def column_detail(request, sheet_id: int, column_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    col = get_object_or_404(SmartColumn.objects.filter(sheet=sheet), pk=column_id)

    if request.method == "DELETE":
        key = col.key
        col.delete()
        for row in sheet.rows.all():
            if key in row.values:
                values = dict(row.values)
                values.pop(key, None)
                row.values = values
                row.save(update_fields=["values", "updated_at"])
        sheet.save(update_fields=["updated_at"])
        return Response({"ok": True})

    if "title" in request.data:
        col.title = str(request.data.get("title") or "").strip() or col.title
    if "field_type" in request.data:
        ft = str(request.data.get("field_type") or "")
        if ft in SmartColumn.FieldType.values:
            col.field_type = ft
    if "options" in request.data and isinstance(request.data.get("options"), list):
        col.options = request.data["options"]
    if "position" in request.data:
        try:
            col.position = int(request.data["position"])
        except (TypeError, ValueError):
            pass
    col.save()
    sheet.save(update_fields=["updated_at"])
    return Response(SmartColumnSerializer(col).data)


@api_view(["POST"])
def create_row(request, sheet_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    values = request.data.get("values") or {}
    if not isinstance(values, dict):
        values = {}
    row = SmartRow.objects.create(
        sheet=sheet,
        values=values,
        position=_next_position(sheet.rows.all()),
    )
    _run_automations(sheet, SmartAutomation.Trigger.ROW_CREATED, row)
    row.refresh_from_db()
    sheet.save(update_fields=["updated_at"])
    return Response(SmartRowSerializer(row).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
def row_detail(request, sheet_id: int, row_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    row = get_object_or_404(SmartRow.objects.filter(sheet=sheet), pk=row_id)

    if request.method == "DELETE":
        row.delete()
        sheet.save(update_fields=["updated_at"])
        return Response({"ok": True})

    if "values" in request.data and isinstance(request.data.get("values"), dict):
        merged = dict(row.values or {})
        merged.update(request.data["values"])
        row.values = merged
    if "position" in request.data:
        try:
            row.position = int(request.data["position"])
        except (TypeError, ValueError):
            pass
    row.save()
    _run_automations(sheet, SmartAutomation.Trigger.ROW_UPDATED, row)
    row.refresh_from_db()
    sheet.save(update_fields=["updated_at"])
    return Response(SmartRowSerializer(row).data)


@api_view(["GET", "POST"])
def views(request, sheet_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    _ensure_default_views(sheet)
    if request.method == "GET":
        return Response({"results": SmartViewSerializer(sheet.views.all(), many=True).data})

    name = str(request.data.get("name") or "").strip() or "新视图"
    view_type = str(request.data.get("view_type") or SmartView.ViewType.GRID)
    if view_type not in SmartView.ViewType.values:
        view_type = SmartView.ViewType.GRID
    config = request.data.get("config") if isinstance(request.data.get("config"), dict) else {}
    view = SmartView.objects.create(
        sheet=sheet,
        name=name,
        view_type=view_type,
        config=config,
        position=_next_position(sheet.views.all()),
    )
    sheet.save(update_fields=["updated_at"])
    return Response(SmartViewSerializer(view).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
def view_detail(request, sheet_id: int, view_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    view = get_object_or_404(SmartView.objects.filter(sheet=sheet), pk=view_id)
    if request.method == "DELETE":
        view.delete()
        sheet.save(update_fields=["updated_at"])
        return Response({"ok": True})

    if "name" in request.data:
        view.name = str(request.data.get("name") or "").strip() or view.name
    if "view_type" in request.data:
        vt = str(request.data.get("view_type") or "")
        if vt in SmartView.ViewType.values:
            view.view_type = vt
    if "config" in request.data and isinstance(request.data.get("config"), dict):
        view.config = request.data["config"]
    if "position" in request.data:
        try:
            view.position = int(request.data["position"])
        except (TypeError, ValueError):
            pass
    view.save()
    sheet.save(update_fields=["updated_at"])
    return Response(SmartViewSerializer(view).data)


@api_view(["GET", "POST"])
def automations(request, sheet_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    if request.method == "GET":
        return Response({"results": SmartAutomationSerializer(sheet.automations.all(), many=True).data})

    name = str(request.data.get("name") or "").strip() or "自动化规则"
    trigger = str(request.data.get("trigger") or SmartAutomation.Trigger.ROW_CREATED)
    action = str(request.data.get("action") or SmartAutomation.Action.SET_FIELD)
    if trigger not in SmartAutomation.Trigger.values:
        trigger = SmartAutomation.Trigger.ROW_CREATED
    if action not in SmartAutomation.Action.values:
        action = SmartAutomation.Action.SET_FIELD
    config = request.data.get("config") if isinstance(request.data.get("config"), dict) else {}
    rule = SmartAutomation.objects.create(
        sheet=sheet,
        name=name,
        trigger=trigger,
        action=action,
        config=config,
        enabled=bool(request.data.get("enabled", True)),
    )
    sheet.save(update_fields=["updated_at"])
    return Response(SmartAutomationSerializer(rule).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH", "DELETE"])
def automation_detail(request, sheet_id: int, automation_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    rule = get_object_or_404(SmartAutomation.objects.filter(sheet=sheet), pk=automation_id)
    if request.method == "DELETE":
        rule.delete()
        return Response({"ok": True})

    for key in ("name", "trigger", "action"):
        if key in request.data:
            setattr(rule, key, request.data[key])
    if "enabled" in request.data:
        rule.enabled = bool(request.data["enabled"])
    if "config" in request.data and isinstance(request.data.get("config"), dict):
        rule.config = request.data["config"]
    rule.save()
    return Response(SmartAutomationSerializer(rule).data)


@api_view(["GET"])
def export_csv(request, sheet_id: int):
    sheet = _get_accessible_sheet(request.user, sheet_id)
    columns = list(sheet.columns.all())
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([c.title for c in columns])
    for row in sheet.rows.all():
        values = row.values or {}
        out = []
        for col in columns:
            val = values.get(col.key, "")
            if isinstance(val, list):
                val = ",".join(str(x) for x in val)
            elif isinstance(val, bool):
                val = "是" if val else "否"
            out.append("" if val is None else str(val))
        writer.writerow(out)
    resp = HttpResponse(buf.getvalue().encode("utf-8-sig"), content_type="text/csv; charset=utf-8")
    resp["Content-Disposition"] = f'attachment; filename="sheet-{sheet.id}.csv"'
    return resp


def _import_dict_rows(sheet: SmartSheet, dict_rows: list[dict]) -> int:
    title_to_col = {c.title: c for c in sheet.columns.all()}
    # 兼容表头多空格 / 全角空格
    alias_to_col = {}
    for title, col in title_to_col.items():
        norm = re.sub(r"\s+", "", title)
        alias_to_col[title] = col
        alias_to_col[norm] = col
    created = 0
    with transaction.atomic():
        for item in dict_rows:
            values = {}
            for title, cell in (item or {}).items():
                key = str(title or "").strip()
                norm_key = re.sub(r"\s+", "", key)
                col = alias_to_col.get(key) or alias_to_col.get(norm_key)
                if not col:
                    continue
                text = "" if cell is None else str(cell).strip()
                if col.field_type == SmartColumn.FieldType.CHECKBOX:
                    values[col.key] = text in {"1", "true", "True", "是", "yes", "Y", "y"}
                elif col.field_type == SmartColumn.FieldType.MULTI_SELECT:
                    values[col.key] = [x.strip() for x in re.split(r"[,，;；]", text) if x.strip()]
                elif col.field_type == SmartColumn.FieldType.NUMBER:
                    try:
                        values[col.key] = float(text) if text else None
                    except ValueError:
                        values[col.key] = text
                elif col.field_type == SmartColumn.FieldType.DATE:
                    values[col.key] = text[:10] if text else ""
                else:
                    values[col.key] = text
            if not values:
                continue
            SmartRow.objects.create(
                sheet=sheet,
                values=values,
                position=_next_position(sheet.rows.all()),
            )
            created += 1
    sheet.save(update_fields=["updated_at"])
    return created


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def import_csv(request, sheet_id: int):
    """导入 CSV / Excel（.xlsx / .xls）。表头需与字段「列名」一致。"""
    sheet = _get_accessible_sheet(request.user, sheet_id)
    source = "csv"
    dict_rows: list[dict] = []

    uploaded = request.FILES.get("file") if hasattr(request, "FILES") else None
    if uploaded is not None:
        name = getattr(uploaded, "name", "") or "upload"
        content = uploaded.read()
        if not content:
            return Response({"ok": False, "error": "上传文件为空"}, status=400)
        try:
            dict_rows, source = parse_spreadsheet_upload(content, name)
        except ValueError as exc:
            return Response({"ok": False, "error": str(exc)}, status=400)
        except Exception as exc:
            return Response(
                {"ok": False, "error": f"无法解析表格：{exc}。若是 WPS/Excel 旧格式，请另存为 .xlsx 后重试"},
                status=400,
            )
    else:
        raw = request.data.get("csv") or ""
        if not str(raw).strip():
            return Response({"ok": False, "error": "请上传 .xlsx/.xls/.csv 文件，或提交 csv 文本"}, status=400)
        dict_rows = rows_from_csv_text(str(raw))

    if not dict_rows:
        return Response({"ok": False, "error": "文件为空或没有可导入的数据行"}, status=400)

    created = _import_dict_rows(sheet, dict_rows)
    if created == 0:
        titles = "、".join(c.title for c in sheet.columns.all()[:8])
        return Response(
            {
                "ok": False,
                "error": f"未匹配到任何列。请确认表头与字段列名一致（当前列：{titles or '无'}）",
                "created": 0,
                "source": source,
            },
            status=400,
        )
    return Response({"ok": True, "created": created, "source": source})


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def import_sheet(request):
    """从 Excel/CSV 新建一张数据表（按表头自动建列）。"""
    uploaded = request.FILES.get("file") if hasattr(request, "FILES") else None
    if uploaded is None:
        return Response({"ok": False, "error": "请上传 .xlsx/.xls/.csv 文件"}, status=400)

    filename = getattr(uploaded, "name", "") or "导入表格"
    content = uploaded.read()
    if not content:
        return Response({"ok": False, "error": "上传文件为空"}, status=400)

    try:
        dict_rows, source = parse_spreadsheet_upload(content, filename)
    except ValueError as exc:
        return Response({"ok": False, "error": str(exc)}, status=400)
    except Exception as exc:
        return Response(
            {"ok": False, "error": f"无法解析表格：{exc}。若是 WPS/Excel 旧格式，请另存为 .xlsx 后重试"},
            status=400,
        )

    headers = collect_headers(dict_rows)
    if not headers:
        return Response({"ok": False, "error": "未找到有效表头，请确认第一行为列名"}, status=400)

    sheet_name = str(request.data.get("name") or "").strip() or sheet_name_from_filename(filename)
    description = str(request.data.get("description") or "").strip()

    with transaction.atomic():
        sheet = SmartSheet.objects.create(
            name=sheet_name[:120],
            description=description,
            owner=request.user,
            organization=current_organization(request.user),
        )
        for idx, title in enumerate(headers):
            col_values = [str(row.get(title, "") or "") for row in dict_rows]
            field_type, options = infer_column_spec(col_values)
            SmartColumn.objects.create(
                sheet=sheet,
                key=_unique_column_key(sheet, title),
                title=title,
                field_type=field_type,
                options=options,
                position=idx,
            )
        row_count = _import_dict_rows(sheet, dict_rows)
        _ensure_default_views(sheet)
        # 若存在单选列，更新看板分组字段
        status_col = sheet.columns.filter(field_type=SmartColumn.FieldType.SELECT).first()
        if status_col:
            kanban = sheet.views.filter(view_type=SmartView.ViewType.KANBAN).first()
            if kanban:
                kanban.config = {**(kanban.config or {}), "kanban_field": status_col.key}
                kanban.save(update_fields=["config"])

    sheet = _get_accessible_sheet(request.user, sheet.id)
    payload = SmartSheetDetailSerializer(sheet).data
    payload["import_meta"] = {"source": source, "row_count": row_count, "column_count": len(headers)}
    return Response(payload, status=status.HTTP_201_CREATED)
