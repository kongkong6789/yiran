from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .service import ducklake
from .pg import pglake


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
