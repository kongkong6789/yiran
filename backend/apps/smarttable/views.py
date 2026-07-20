import csv
import io
import json

from django.db import transaction
from django.db.models import Max
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import SmartAutomation, SmartColumn, SmartRow, SmartSheet, SmartView
from .serializers import (
    SmartAutomationSerializer,
    SmartColumnSerializer,
    SmartRowSerializer,
    SmartSheetDetailSerializer,
    SmartSheetListSerializer,
    SmartViewSerializer,
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


def _user_sheets(user):
    return SmartSheet.objects.filter(owner=user).prefetch_related(
        "columns", "rows", "views", "automations"
    )


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


def _ensure_demo_sheet(user):
    if SmartSheet.objects.filter(owner=user).exists():
        for sheet in SmartSheet.objects.filter(owner=user):
            _ensure_default_views(sheet)
        return
    with transaction.atomic():
        sheet = SmartSheet.objects.create(
            name="示例任务表",
            description="多维表格：表格 / 看板 / 表单",
            owner=user,
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
        qs = _user_sheets(request.user)
        return Response({"results": SmartSheetListSerializer(qs, many=True).data})

    name = str(request.data.get("name") or "").strip() or "未命名表格"
    description = str(request.data.get("description") or "").strip()
    with transaction.atomic():
        sheet = SmartSheet.objects.create(
            name=name,
            description=description,
            owner=request.user,
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
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
    _ensure_default_views(sheet)

    if request.method == "GET":
        return Response(SmartSheetDetailSerializer(sheet).data)

    if request.method == "DELETE":
        sheet.delete()
        return Response({"ok": True})

    name = request.data.get("name")
    description = request.data.get("description")
    if name is not None:
        sheet.name = str(name).strip() or sheet.name
    if description is not None:
        sheet.description = str(description).strip()
    sheet.save()
    return Response(SmartSheetDetailSerializer(sheet).data)


@api_view(["POST"])
def create_column(request, sheet_id: int):
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
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
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
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
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
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
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
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
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
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
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
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
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
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
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
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
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
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


@api_view(["POST"])
def import_csv(request, sheet_id: int):
    sheet = get_object_or_404(_user_sheets(request.user), pk=sheet_id)
    raw = request.data.get("csv") or ""
    if hasattr(request, "FILES") and request.FILES.get("file"):
        raw = request.FILES["file"].read().decode("utf-8-sig", errors="replace")
    if not str(raw).strip():
        return Response({"ok": False, "error": "empty csv"}, status=400)

    reader = csv.DictReader(io.StringIO(str(raw)))
    title_to_col = {c.title: c for c in sheet.columns.all()}
    created = 0
    with transaction.atomic():
        for item in reader:
            values = {}
            for title, cell in (item or {}).items():
                col = title_to_col.get(str(title or "").strip())
                if not col:
                    continue
                text = "" if cell is None else str(cell).strip()
                if col.field_type == SmartColumn.FieldType.CHECKBOX:
                    values[col.key] = text in {"1", "true", "True", "是", "yes", "Y", "y"}
                elif col.field_type == SmartColumn.FieldType.MULTI_SELECT:
                    values[col.key] = [x.strip() for x in text.split(",") if x.strip()]
                elif col.field_type == SmartColumn.FieldType.NUMBER:
                    try:
                        values[col.key] = float(text) if text else None
                    except ValueError:
                        values[col.key] = text
                else:
                    values[col.key] = text
            SmartRow.objects.create(
                sheet=sheet,
                values=values,
                position=_next_position(sheet.rows.all()),
            )
            created += 1
    sheet.save(update_fields=["updated_at"])
    return Response({"ok": True, "created": created})
