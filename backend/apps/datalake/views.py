import json
import re
import uuid

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.db.models import Q

from .service import ducklake
from .pg import pglake
from .certified_metrics import canonical_hash, compose_inventory_sales_snapshot, contracts_for, resolve_metric
from .models import ImportContract, RawImportBatch, ReferenceMappingSet, SourceSnapshot
from .sales_ledger import SalesLedgerRejected, import_sales_ledger, reconcile_sales_ledger
from apps.core.organizations import ensure_current_organization, is_organization_admin
from apps.core.models import AuditLog


def _use_pg() -> bool:
    if not pglake.available():
        return False
    try:
        pglake.ensure_ready()
        return True
    except Exception:
        return False


def _pg_path() -> str:
    return pglake.endpoint()


def _json_safe(value):
    """将数据库返回的 date/datetime/Decimal 等值规范化为可持久化 JSON。"""
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


@api_view(["GET"])
def tables(request):
    if _use_pg():
        return Response({
            "source": "postgres",
            "path": _pg_path(),
            "tables": pglake.list_tables(),
        })
    ducklake.seed()
    return Response({"source": "duckdb", "path": ducklake.path, "tables": ducklake.list_tables()})


@api_view(["GET"])
def asset_preview(request, table: str):
    """预览已接入的数据资产，表名必须来自当前数据底座的实际目录。"""
    organization = ensure_current_organization(request.user)
    if not re.fullmatch(r"[A-Za-z0-9_]+", table):
        return Response({"error": "数据表标识无效"}, status=status.HTTP_400_BAD_REQUEST)
    use_pg = _use_pg()
    source = "postgres" if use_pg else "duckdb"
    available_tables = pglake.list_tables() if use_pg else ducklake.list_tables()
    table_meta = next((row for row in available_tables if row.get("table") == table), None)
    if table_meta is None:
        return Response({"error": "数据资产不存在或当前不可访问"}, status=status.HTTP_404_NOT_FOUND)
    try:
        limit = min(max(int(request.query_params.get("limit", 50)), 1), 100)
    except (TypeError, ValueError):
        limit = 50
    if use_pg:
        rows = pglake.query(f'SELECT * FROM {pglake.schema}."{table}" LIMIT {limit}')
    else:
        rows = ducklake.query(f'SELECT * FROM "{table}" LIMIT {limit}')
    source_system = f"physical:{source}:{table}"[:64]
    trusted_versions = SourceSnapshot.objects.filter(
        organization=organization,
        source_system=source_system,
        governance_status="governed",
    )[:20]
    return Response({
        "table": table,
        "source": source,
        "row_count": int(table_meta.get("rows") or 0),
        "preview_count": len(rows),
        "columns": list(rows[0].keys()) if rows else [],
        "rows": rows,
        "trusted_versions": [_snapshot_payload(row) for row in trusted_versions],
    })


@api_view(["POST"])
def publish_asset(request):
    """将已经存在于企业数据层的物理表发布为可追溯的可信数据版本。"""
    organization = ensure_current_organization(request.user)
    if not is_organization_admin(request.user, organization):
        return Response({"error": "仅企业所有者或管理员可以发布可信数据"}, status=status.HTTP_403_FORBIDDEN)

    body = request.data if isinstance(request.data, dict) else {}
    table = str(body.get("table") or "").strip()
    asset_key = str(body.get("asset_key") or table).strip().lower()
    display_name = str(body.get("display_name") or table).strip()
    as_of = parse_datetime(str(body.get("as_of") or ""))
    if not table or not re.fullmatch(r"[A-Za-z0-9_]+", table):
        return Response({"error": "数据表标识无效"}, status=status.HTTP_400_BAD_REQUEST)
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,95}", asset_key):
        return Response({"error": "数据资产标识仅支持小写字母、数字、点、下划线和短横线"}, status=status.HTTP_400_BAD_REQUEST)
    if as_of is None or timezone.is_naive(as_of):
        return Response({"error": "数据截至时间必须是带时区的 ISO 时间"}, status=status.HTTP_400_BAD_REQUEST)
    if body.get("confirm_complete") is not True:
        return Response({"error": "必须确认当前数据范围完整后才能发布可信版本"}, status=status.HTTP_400_BAD_REQUEST)

    use_pg = _use_pg()
    source = "postgres" if use_pg else "duckdb"
    available_tables = pglake.list_tables() if use_pg else ducklake.list_tables()
    table_meta = next((row for row in available_tables if row.get("table") == table), None)
    if table_meta is None:
        return Response({"error": "数据资产不存在或当前不可访问"}, status=status.HTTP_404_NOT_FOUND)
    row_count = int(table_meta.get("rows") or 0)
    if row_count <= 0:
        return Response({"error": "空数据资产不能发布为可信数据"}, status=status.HTTP_409_CONFLICT)
    if row_count > 100_000:
        return Response(
            {"error": "当前版本超过 10 万行，请通过连接器生成分区快照后再发布"},
            status=status.HTTP_409_CONFLICT,
        )

    if use_pg:
        rows = pglake.query(f'SELECT * FROM {pglake.schema}."{table}"')
    else:
        rows = ducklake.query(f'SELECT * FROM "{table}"')
    payload = _json_safe({
        "asset_key": asset_key,
        "display_name": display_name,
        "table": table,
        "columns": list(rows[0].keys()) if rows else [],
        "rows": rows,
    })
    content_hash = canonical_hash(payload)
    source_system = f"physical:{source}:{table}"[:64]
    existing = SourceSnapshot.objects.filter(
        organization=organization,
        source_system=source_system,
        content_hash=content_hash,
        governance_status="governed",
    ).first()
    if existing:
        return Response({**_snapshot_payload(existing), "reused": True})

    snapshot = SourceSnapshot.objects.create(
        organization=organization,
        snapshot_key=f"asset:{asset_key}:{content_hash.removeprefix('sha256:')[:12]}"[:96],
        source_system=source_system,
        source_mode=SourceSnapshot.SourceMode.LIVE,
        scope={"asset_key": asset_key, "display_name": display_name, "table": table, "source": source},
        as_of=as_of,
        complete=True,
        completeness={"confirmed_by_user": True, "row_count": row_count},
        schema_version="physical-table-v1",
        row_count=len(rows),
        content_hash=content_hash,
        payload=payload,
        governance_status="governed",
        reconciliation_status="not_required",
        boundary_covered=True,
        source_complete=True,
        created_by=request.user,
    )
    AuditLog.objects.create(
        trace_id=f"data-{uuid.uuid4().hex[:16]}",
        actor=request.user.username,
        intent="publish_trusted_data_asset",
        action="datalake.asset.publish",
        payload={"organization_id": organization.id, "table": table, "asset_key": asset_key, "as_of": as_of.isoformat()},
        decision=AuditLog.Decision.ALLOW,
        checks=["organization_admin", "asset_exists", "non_empty", "complete_confirmed", "content_hashed"],
        result={"snapshot_id": snapshot.id, "content_hash": content_hash, "row_count": len(rows)},
    )
    return Response(_snapshot_payload(snapshot), status=status.HTTP_201_CREATED)


_PLACEHOLDER_BRAND = re.compile(r"^(?:品牌|brand)[\s_-]*[a-z0-9]+$", re.IGNORECASE)


def _is_real_brand(value: str) -> bool:
    normalized = value.strip()
    if not normalized or _PLACEHOLDER_BRAND.fullmatch(normalized):
        return False
    return normalized.casefold() not in {"demo", "fixture", "mock", "test", "测试品牌", "示例品牌"}


def _contract_backed_inventory_brands(organization) -> set[str]:
    """只返回已确认品牌契约且能在真实库存商品中找到证据的品牌。"""
    if not _use_pg():
        return set()
    try:
        inventory_rows = pglake.query(
            """
            SELECT goods_name
            FROM dim_sku_inventory_map
            WHERE source IN ('jackyun_inventory', 'manual_verified')
              AND confidence >= 0.99
              AND COALESCE(goods_name, '') <> ''
            """
        )
    except Exception:
        return set()
    product_names = [str(row.get("goods_name") or "").casefold() for row in inventory_rows]
    if not product_names:
        return set()

    contracts = ImportContract.objects.filter(
        Q(organization=organization) | Q(organization__isnull=True),
        signoff_status=ImportContract.SignoffStatus.CONFIRMED,
    ).order_by("-organization_id", "contract_key", "-version")
    brands: set[str] = set()
    for contract in contracts:
        aliases = [
            str(value).strip()
            for value in (contract.schema or {}).get("brand_aliases", [])
            if str(value).strip()
        ]
        canonical = next((value for value in aliases if _is_real_brand(value)), "")
        if canonical and any(alias.casefold() in name for alias in aliases for name in product_names):
            brands.add(canonical)
    return brands


@api_view(["GET"])
def report_options(request):
    """从当前企业最新可信维度快照中提取报告筛选项。"""
    organization = ensure_current_organization(request.user)
    snapshots = SourceSnapshot.objects.filter(
        organization=organization,
        governance_status="governed",
        source_mode=SourceSnapshot.SourceMode.LIVE,
        complete=True,
        source_complete=True,
        boundary_covered=True,
    ).order_by("-as_of", "-id")[:200]
    latest: dict[str, SourceSnapshot] = {}
    for snapshot in snapshots:
        asset_key = str((snapshot.scope or {}).get("asset_key") or snapshot.source_system)
        latest.setdefault(asset_key, snapshot)

    brands: set[str] = set()
    platforms: set[str] = set()
    for asset_key, snapshot in latest.items():
        if not any(token in asset_key.lower() for token in ("product", "shop")):
            continue
        for row in (snapshot.payload or {}).get("rows", []):
            if not isinstance(row, dict):
                continue
            brand = str(row.get("brand") or "").strip()
            platform = str(row.get("platform") or "").strip().lower()
            if _is_real_brand(brand):
                brands.add(brand)
            if platform:
                platforms.add(platform)
    brands.update(_contract_backed_inventory_brands(organization))
    return Response({
        "brands": [{"label": value, "value": value} for value in sorted(brands)],
        "platforms": [{"label": value, "value": value} for value in sorted(platforms)],
        "brand_source": "governed_snapshots_and_verified_inventory",
    })


@api_view(["GET"])
def metrics(request):
    if _use_pg():
        rows = pglake.query(
            """
            SELECT s.dt, d.metric_name AS metric, s.dim_value AS dim,
                   s.value, s.mom, s.yoy, d.formula, d.unit
            FROM ads_metric_snapshot s
            JOIN ads_metric_def d ON d.metric_code = s.metric_code
            ORDER BY s.dt DESC, d.metric_code, s.dim_type, s.dim_value
            """
        )
        return Response({"source": "postgres", "count": len(rows), "results": rows})
    ducklake.seed()
    rows = ducklake.query("SELECT * FROM metric_snapshot ORDER BY dt DESC")
    return Response({"source": "duckdb", "count": len(rows), "results": rows})


@api_view(["GET"])
def anomalies(request):
    if _use_pg():
        rows = pglake.query(
            """
            SELECT a.dt, a.dim_value AS scope, d.metric_name AS metric,
                   a.level, a.detail, a.rule
            FROM ads_anomaly a
            JOIN ads_metric_def d ON d.metric_code = a.metric_code
            ORDER BY a.dt DESC, a.level
            """
        )
        return Response({"source": "postgres", "count": len(rows), "results": rows})
    ducklake.seed()
    rows = ducklake.query("SELECT * FROM anomaly ORDER BY dt DESC")
    return Response({"source": "duckdb", "count": len(rows), "results": rows})


@api_view(["POST"])
def run_query(request):
    """只读 SQL 查询(骨架:仅允许 SELECT)。"""
    sql = (request.data.get("sql") or "").strip()
    if not sql.lower().startswith("select"):
        return Response({"error": "仅允许 SELECT 查询"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        if _use_pg():
            return Response({"source": "postgres", **_wrap(pglake.query(sql))})
        rows = ducklake.query(sql)
        return Response({"source": "duckdb", **_wrap(rows)})
    except Exception as exc:  # noqa: BLE001
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


def _wrap(rows: list[dict]) -> dict:
    return {"count": len(rows), "results": rows}


def _snapshot_payload(row: SourceSnapshot) -> dict:
    return {
        "id": row.id,
        "snapshot_key": row.snapshot_key,
        "source_system": row.source_system,
        "source_mode": row.source_mode,
        "scope": row.scope,
        "as_of": row.as_of.isoformat(),
        "complete": row.complete,
        "completeness": row.completeness,
        "schema_version": row.schema_version,
        "row_count": row.row_count,
        "content_hash": row.content_hash,
        "governance_status": row.governance_status,
        "reconciliation_status": row.reconciliation_status,
        "manifest_hash": row.manifest_hash,
        "boundary_covered": row.boundary_covered,
        "source_complete": row.source_complete,
        "created_at": row.created_at.isoformat(),
    }


@api_view(["GET", "POST"])
def snapshots(request):
    organization = ensure_current_organization(request.user)
    if request.method == "GET":
        rows = SourceSnapshot.objects.filter(organization=organization)[:100]
        return Response({"results": [_snapshot_payload(row) for row in rows]})

    body = request.data if isinstance(request.data, dict) else {}
    payload = body.get("payload") or {}
    as_of = parse_datetime(str(body.get("as_of") or ""))
    if as_of is None:
        return Response({"error": "as_of 必须是带时区的 ISO 时间"}, status=status.HTTP_400_BAD_REQUEST)
    source_mode = str(body.get("source_mode") or "live")
    if source_mode not in SourceSnapshot.SourceMode.values:
        return Response({"error": "source_mode 仅支持 live/fixture/mock"}, status=status.HTTP_400_BAD_REQUEST)
    if str(body.get("source_system") or "") == "jackyun_sales_ledger_export":
        return Response(
            {"error": "销售明细账必须通过 governed Raw 导入接口，不能直接提交 Snapshot"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    computed_hash = canonical_hash(payload)
    supplied_hash = str(body.get("content_hash") or "")
    if supplied_hash and supplied_hash != computed_hash:
        return Response({"error": "content_hash 与 payload 不一致"}, status=status.HTTP_400_BAD_REQUEST)
    rows = payload.get("rows", []) if isinstance(payload, dict) else []
    snapshot = SourceSnapshot.objects.create(
        organization=organization,
        source_system=str(body.get("source_system") or "")[:64],
        source_mode=source_mode,
        scope=body.get("scope") or {},
        as_of=as_of,
        complete=bool(body.get("complete", False)),
        completeness=body.get("completeness") or {},
        schema_version=str(body.get("schema_version") or "")[:32],
        row_count=len(rows) if isinstance(rows, list) else 0,
        content_hash=computed_hash,
        payload=payload,
        governance_status="legacy_accepted",
        reconciliation_status="not_required",
        boundary_covered=True,
        source_complete=bool(body.get("complete", False)),
        created_by=request.user,
    )
    return Response(_snapshot_payload(snapshot), status=status.HTTP_201_CREATED)


@api_view(["POST"])
def snapshot_compose(request):
    organization = ensure_current_organization(request.user)
    try:
        inventory_snapshot = SourceSnapshot.objects.get(
            id=request.data.get("inventory_snapshot_id"), organization=organization,
        )
        sales_snapshot = SourceSnapshot.objects.get(
            id=request.data.get("sales_snapshot_id"), organization=organization,
        )
        snapshot = compose_inventory_sales_snapshot(
            organization=organization, user=request.user,
            inventory_snapshot=inventory_snapshot, sales_snapshot=sales_snapshot,
        )
    except SourceSnapshot.DoesNotExist:
        return Response({"error": "库存或销售 Snapshot 不存在"}, status=status.HTTP_404_NOT_FOUND)
    except (ValueError, PermissionError) as exc:
        return Response({"error": str(exc), "code": "snapshot_compose_blocked"}, status=status.HTTP_409_CONFLICT)
    return Response(_snapshot_payload(snapshot), status=status.HTTP_201_CREATED)


@api_view(["GET"])
def metric_contracts(request):
    organization = ensure_current_organization(request.user)
    return Response({"results": [{
        "id": row.id,
        "metric_id": row.metric_id,
        "version": row.version,
        "name": row.name,
        "formula": row.formula,
        "unit": row.unit,
        "dimensions": row.dimensions,
        "time_window": row.time_window,
        "missing_policy": row.missing_policy,
        "contract_hash": row.contract_hash,
    } for row in contracts_for(organization)]})


@api_view(["POST"])
def metric_results_resolve(request):
    organization = ensure_current_organization(request.user)
    try:
        snapshot = SourceSnapshot.objects.get(id=request.data.get("snapshot_id"), organization=organization)
        result = resolve_metric(
            organization=organization,
            user=request.user,
            snapshot=snapshot,
            metric_id=str(request.data.get("metric_id") or ""),
            version=str(request.data.get("version") or "v1"),
            dimensions=request.data.get("dimensions") or {},
        )
    except SourceSnapshot.DoesNotExist:
        return Response({"error": "Snapshot 不存在"}, status=status.HTTP_404_NOT_FOUND)
    except (ValueError, PermissionError) as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({
        "id": result.id,
        "metric_id": result.contract.metric_id,
        "metric_version": result.contract.version,
        "contract_hash": result.contract.contract_hash,
        "value": str(result.value),
        "unit": result.unit,
        "dimensions": result.dimensions,
        "as_of": result.as_of.isoformat(),
        "snapshot_id": result.snapshot_id,
        "snapshot_hash": result.snapshot.content_hash,
        "query_fingerprint": result.query_fingerprint,
        "result_fingerprint": result.result_fingerprint,
        "warnings": result.warnings,
    })


def _contract_payload(row: ImportContract) -> dict:
    return {
        "id": row.id, "contract_key": row.contract_key, "version": row.version,
        "dataset_type": row.dataset_type, "schema": row.schema, "contract_hash": row.contract_hash,
        "signoff_status": row.signoff_status, "created_at": row.created_at.isoformat(),
    }


@api_view(["GET", "POST"])
def import_contracts(request):
    organization = ensure_current_organization(request.user)
    if request.method == "GET":
        rows = ImportContract.objects.filter(Q(organization=organization) | Q(organization__isnull=True)).order_by(
            "contract_key", "-version"
        )
        return Response({"results": [_contract_payload(row) for row in rows]})
    schema = request.data.get("schema") or {}
    row = ImportContract.objects.create(
        organization=organization, contract_key=str(request.data.get("contract_key") or "")[:96],
        version=str(request.data.get("version") or "v1")[:32],
        dataset_type=str(request.data.get("dataset_type") or "sales_ledger")[:64],
        schema=schema, contract_hash=canonical_hash(schema), created_by=request.user,
    )
    return Response(_contract_payload(row), status=status.HTTP_201_CREATED)


@api_view(["POST"])
def import_contract_confirm(request, contract_id: int):
    organization = ensure_current_organization(request.user)
    if not is_organization_admin(request.user, organization):
        return Response({"error": "仅企业管理员可以确认导入契约"}, status=status.HTTP_403_FORBIDDEN)
    try:
        row = ImportContract.objects.get(id=contract_id, organization=organization)
    except ImportContract.DoesNotExist:
        return Response({"error": "导入契约不存在"}, status=status.HTTP_404_NOT_FOUND)
    row.signoff_status = ImportContract.SignoffStatus.CONFIRMED
    row.confirmed_by = request.user
    row.confirmed_at = timezone.now()
    row.save(update_fields=["signoff_status", "confirmed_by", "confirmed_at"])
    return Response(_contract_payload(row))


def _mapping_payload(row: ReferenceMappingSet) -> dict:
    return {
        "id": row.id, "mapping_key": row.mapping_key, "kind": row.kind, "version": row.version,
        "content_hash": row.content_hash, "status": row.status, "entry_count": len(row.mappings or {}),
        "created_at": row.created_at.isoformat(),
    }


@api_view(["GET", "POST"])
def reference_mappings(request):
    organization = ensure_current_organization(request.user)
    if request.method == "GET":
        rows = ReferenceMappingSet.objects.filter(organization=organization).order_by("kind", "mapping_key", "-version")
        return Response({"results": [_mapping_payload(row) for row in rows]})
    mappings = request.data.get("mappings") or {}
    if not isinstance(mappings, dict) or not mappings:
        return Response({"error": "mappings 必须是非空对象"}, status=status.HTTP_400_BAD_REQUEST)
    kind = str(request.data.get("kind") or "")
    if kind not in ReferenceMappingSet.MappingKind.values:
        return Response({"error": "kind 仅支持 channel/product/warehouse"}, status=status.HTTP_400_BAD_REQUEST)
    row = ReferenceMappingSet.objects.create(
        organization=organization, mapping_key=str(request.data.get("mapping_key") or "")[:96], kind=kind,
        version=str(request.data.get("version") or "v1")[:32], mappings=mappings,
        content_hash=canonical_hash(mappings), created_by=request.user,
    )
    return Response(_mapping_payload(row), status=status.HTTP_201_CREATED)


@api_view(["POST"])
def reference_mapping_confirm(request, mapping_id: int):
    organization = ensure_current_organization(request.user)
    if not is_organization_admin(request.user, organization):
        return Response({"error": "仅企业管理员可以确认映射"}, status=status.HTTP_403_FORBIDDEN)
    try:
        row = ReferenceMappingSet.objects.get(id=mapping_id, organization=organization)
    except ReferenceMappingSet.DoesNotExist:
        return Response({"error": "映射不存在"}, status=status.HTTP_404_NOT_FOUND)
    row.status = ImportContract.SignoffStatus.CONFIRMED
    row.confirmed_by = request.user
    row.confirmed_at = timezone.now()
    row.save(update_fields=["status", "confirmed_by", "confirmed_at"])
    return Response(_mapping_payload(row))


def _raw_import_payload(row: RawImportBatch) -> dict:
    reconciliation_hash = canonical_hash({
        "manifest_hash": row.manifest_hash, "content_hash": row.content_hash, "receipt": row.aggregate_receipt,
    })
    return {
        "id": row.id, "import_key": row.import_key, "dataset_type": row.dataset_type,
        "source_system": row.source_system, "status": row.status,
        "reconciliation_status": row.reconciliation_status, "manifest_hash": row.manifest_hash,
        "content_hash": row.content_hash, "window_start": row.window_start, "window_end": row.window_end,
        "actual_start": row.actual_start, "actual_end": row.actual_end,
        "boundary_covered": row.boundary_covered, "source_complete": row.source_complete,
        "row_count": row.row_count, "accepted_row_count": row.accepted_row_count,
        "quarantine_summary": row.quarantine_summary, "quality_signals": row.quality_signals,
        "snapshot_id": row.snapshot_id, "reconciliation_hash": reconciliation_hash,
        "created_at": row.created_at.isoformat(),
    }


def _audit_raw(request, *, organization, action: str, decision: str, result: dict) -> None:
    AuditLog.objects.create(
        trace_id=f"raw-import-{organization.id}-{timezone.now().strftime('%Y%m%d%H%M%S%f')}",
        actor=request.user.get_username(), intent="governed_raw_import", action=action,
        payload={"organization_id": organization.id}, decision=decision,
        checks=["organization_scope", "manifest_hash", "contract_signoff", "mapping_signoff", "aggregate_only"],
        result=result,
    )


@api_view(["GET"])
def raw_imports(request):
    organization = ensure_current_organization(request.user)
    rows = RawImportBatch.objects.filter(organization=organization)[:100]
    return Response({"results": [_raw_import_payload(row) for row in rows]})


@api_view(["POST"])
def sales_ledger_import(request):
    organization = ensure_current_organization(request.user)
    uploaded = request.FILES.get("file")
    if uploaded is None:
        return Response({"error": "缺少销售明细账 XLSX 文件"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        manifest_raw = request.data.get("manifest") or "{}"
        manifest = json.loads(manifest_raw) if isinstance(manifest_raw, str) else manifest_raw
        contract = ImportContract.objects.get(id=request.data.get("contract_id"))
        channel_mapping = ReferenceMappingSet.objects.get(id=request.data.get("channel_mapping_id"))
        product_mapping = ReferenceMappingSet.objects.get(id=request.data.get("product_mapping_id"))
        row = import_sales_ledger(
            organization=organization, user=request.user, uploaded=uploaded, manifest=manifest,
            contract=contract, channel_mapping=channel_mapping, product_mapping=product_mapping,
        )
    except (json.JSONDecodeError, ImportContract.DoesNotExist, ReferenceMappingSet.DoesNotExist):
        return Response({"error": "Manifest、导入契约或映射不存在"}, status=status.HTTP_400_BAD_REQUEST)
    except SalesLedgerRejected as exc:
        _audit_raw(
            request, organization=organization, action="datalake.sales_ledger.import",
            decision=AuditLog.Decision.BLOCK, result={"error_code": "governed_raw_rejected"},
        )
        return Response({"error": str(exc), "code": "governed_raw_rejected"}, status=status.HTTP_409_CONFLICT)
    _audit_raw(
        request, organization=organization, action="datalake.sales_ledger.import",
        decision=AuditLog.Decision.DRY_RUN,
        result={"import_id": row.id, "row_count": row.row_count, "accepted_row_count": row.accepted_row_count},
    )
    return Response(_raw_import_payload(row), status=status.HTTP_201_CREATED)


@api_view(["POST"])
def raw_import_reconcile(request, import_id: int):
    organization = ensure_current_organization(request.user)
    if not is_organization_admin(request.user, organization):
        return Response({"error": "仅企业管理员可以完成业务对账"}, status=status.HTTP_403_FORBIDDEN)
    try:
        row = RawImportBatch.objects.get(id=import_id, organization=organization)
        row = reconcile_sales_ledger(
            batch=row, organization=organization, user=request.user,
            reconciliation_hash=str(request.data.get("reconciliation_hash") or ""),
        )
    except RawImportBatch.DoesNotExist:
        return Response({"error": "导入批次不存在"}, status=status.HTTP_404_NOT_FOUND)
    except (SalesLedgerRejected, PermissionError) as exc:
        _audit_raw(
            request, organization=organization, action="datalake.sales_ledger.reconcile",
            decision=AuditLog.Decision.BLOCK, result={"import_id": import_id, "error_code": "reconciliation_blocked"},
        )
        return Response({"error": str(exc), "code": "reconciliation_blocked"}, status=status.HTTP_409_CONFLICT)
    _audit_raw(
        request, organization=organization, action="datalake.sales_ledger.reconcile",
        decision=AuditLog.Decision.ALLOW, result={"import_id": row.id, "snapshot_id": row.snapshot_id},
    )
    return Response(_raw_import_payload(row))
