"""二期：事实层健康 + 连接器对齐摘要。"""
from __future__ import annotations

from pathlib import Path

from django.conf import settings


def _duck_tables() -> tuple[bool, list[dict], str]:
    path = Path(getattr(settings, "DUCKDB_PATH", "") or "")
    if not path.exists():
        return False, [], f"DuckDB 文件不存在: {path}"
    try:
        import duckdb

        con = duckdb.connect(str(path), read_only=True)
        rows = con.execute(
            "SELECT table_schema, table_name FROM information_schema.tables "
            "WHERE table_schema NOT IN ('information_schema','pg_catalog') "
            "ORDER BY 1,2 LIMIT 200"
        ).fetchall()
        con.close()
        return True, [{"schema": r[0], "name": r[1]} for r in rows], ""
    except Exception as e:
        return False, [], str(e)


def _pg_tables() -> tuple[bool, list[dict], str]:
    try:
        from apps.datalake.pg import pglake as lake

        if not lake.enabled() or not lake.available():
            err = getattr(lake, "_last_error", "") or "PG 未启用或不可用"
            return False, [], err
        try:
            tables = lake.list_tables() if hasattr(lake, "list_tables") else []
            if isinstance(tables, list):
                out = []
                for t in tables[:200]:
                    if isinstance(t, dict):
                        out.append(t)
                    else:
                        out.append({"name": str(t)})
                return True, out, ""
        except Exception as e:
            return True, [], str(e)
        return True, [], ""
    except Exception as e:
        return False, [], str(e)


def _connector_summary() -> list[dict]:
    items = []
    # 环境级连接线索
    jy = bool(getattr(settings, "JACKYUN_APP_KEY", None) or __import__("os").getenv("JACKYUN_APP_KEY"))
    items.append({
        "id": "jackyun",
        "name": "吉客云",
        "kind": "connector",
        "status": "configured" if jy else "unconfigured",
        "note": "只读同步商品/订单 → DataLake（知行 Skill 对齐）" if jy else "未配置 JACKYUN_*，可走 MCP/连接页",
    })
    kd = bool(__import__("os").getenv("MCP_KINGDEE_URL") or __import__("os").getenv("KINGDEE_ACCT_ID"))
    items.append({
        "id": "kingdee",
        "name": "金蝶",
        "kind": "connector",
        "status": "configured" if kd else "unconfigured",
        "note": "只读 ERP 对齐知行 kingdee Skill" if kd else "未配置金蝶相关环境变量",
    })
    try:
        from apps.mcp.models import McpServerConfig
        n = McpServerConfig.objects.filter(enabled=True).count()
        items.append({
            "id": "mcp",
            "name": "MCP 服务器",
            "kind": "mcp",
            "status": "ok" if n else "empty",
            "note": f"已启用 {n} 个个人/系统 MCP 配置",
        })
    except Exception as e:
        items.append({
            "id": "mcp",
            "name": "MCP 服务器",
            "kind": "mcp",
            "status": "error",
            "note": str(e),
        })
    return items


def fact_health() -> dict:
    from .fact_catalog import resolve_fact_availability

    duck_ok, duck_tables, duck_err = _duck_tables()
    pg_ok, pg_tables, pg_err = _pg_tables()
    connectors = _connector_summary()
    facts = resolve_fact_availability(duck_tables, pg_tables)
    missing_n = sum(1 for f in facts if f["status"] in ("missing", "empty"))
    partial_n = sum(1 for f in facts if f["status"] == "partial")
    ok_n = sum(1 for f in facts if f["status"] == "ok")

    status = "ok" if (duck_ok or pg_ok) else "degraded"
    if not duck_ok and not pg_ok:
        status = "unavailable"
    elif missing_n >= 5:
        status = "degraded"
    return {
        "schema": "liangce_commerce_fact_health_v2",
        "status": status,
        "duckdb": {
            "path": getattr(settings, "DUCKDB_PATH", ""),
            "available": duck_ok,
            "table_count": len(duck_tables),
            "tables": duck_tables[:80],
            "error": duck_err,
        },
        "postgres": {
            "available": pg_ok,
            "table_count": len(pg_tables),
            "tables": pg_tables[:80],
            "error": pg_err,
        },
        "connectors": connectors,
        "facts": facts,
        "facts_summary": {
            "total": len(facts),
            "ok": ok_n,
            "partial": partial_n,
            "missing": missing_n,
        },
        "guidance": [
            "平台导出 Excel/CSV 可入库 DataLake 后在此查看表",
            "ERP 实时查询默认只读，写回需审批（五期治理）",
            "可到「能力→数据 / 连接」做同步与查询",
            f"基础数据 F1–F8：已接入 {ok_n} · 部分 {partial_n} · 缺失 {missing_n}",
        ],
    }
