"""
Apache AGE 图谱查询(LightRAG workspace / source_id)。

LightRAG 在 public.graph_sources 中登记 source_id -> workspace 映射;
AGE 图名为 {workspace}_chunk_entity_relation,图内顶点通常不含 UUID source_id。
"""
from __future__ import annotations

import json
import re
import time

from django.conf import settings

from .pg import PgLake, PgSession, pglake


def _sid() -> str:
    return (settings.LIGHTRAG_SOURCE_ID or "").strip()


def has_age() -> bool:
    if not pglake.available(force=True):
        return False
    try:
        rows = pglake.query("SELECT 1 FROM pg_extension WHERE extname = 'age'")
        return bool(rows)
    except Exception:
        return False


def list_graphs() -> list[str]:
    if not has_age():
        return []
    rows = pglake.query("SELECT name FROM ag_catalog.ag_graph ORDER BY name")
    return [r["name"] for r in rows]


def resolve_source(source_id: str | None = None) -> dict | None:
    """从 graph_sources 解析 source_id 对应的 workspace / 名称。"""
    sid = (source_id or _sid()).strip()
    if not sid:
        return None
    try:
        rows = pglake.query(
            """
            SELECT id, name, workspace, description, kind
            FROM public.graph_sources
            WHERE id::text = %s
            LIMIT 1
            """,
            [sid],
        )
        return rows[0] if rows else None
    except Exception:
        return None


def graph_name_for_workspace(workspace: str) -> str:
    ws = (workspace or "").strip()
    if ws.endswith("_chunk_entity_relation"):
        return ws
    return f"{ws}_chunk_entity_relation"


def graph_for_source(source_id: str | None = None) -> str | None:
    """按 source_id 定位 AGE 图名;未登记时返回 None。"""
    src = resolve_source(source_id)
    if not src or not src.get("workspace"):
        return None
    name = graph_name_for_workspace(src["workspace"])
    return name if name in list_graphs() else None


def _candidate_graphs(source_id: str | None = None) -> list[str]:
    """优先: source_id 映射的 workspace 图;其次 LIGHTRAG_WORKSPACE;最后全部 *_chunk_entity_relation。"""
    graphs = list_graphs()
    g = graph_for_source(source_id)
    if g:
        return [g]
    ws = (settings.LIGHTRAG_WORKSPACE or "").strip()
    if ws:
        name = graph_name_for_workspace(ws)
        return [name] if name in graphs else []
    return [g for g in graphs if g.endswith("_chunk_entity_relation")]


def _parse_agtype_props(raw) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    s = str(raw)
    s = re.sub(r"::[a-z]+$", "", s.strip())
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        return {}


def _prepare_age(sess: PgSession):
    """每个连接需 LOAD AGE 并设置 search_path。"""
    sess.query("LOAD 'age'")
    sess.query("SET search_path = ag_catalog, public")


_GRAPH_NAME_RE = re.compile(r"^[\w]+$")


def _safe_graph_name(graph: str) -> str:
    g = (graph or "").strip()
    if not g or not _GRAPH_NAME_RE.match(g):
        raise ValueError(f"非法 AGE 图名: {graph}")
    return g


def _parse_agtype_scalar(raw) -> str | int | float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float, bool)):
        return raw
    s = re.sub(r"::[a-z]+$", "", str(raw).strip())
    if s.isdigit() or (s.startswith("-") and s[1:].isdigit()):
        return int(s)
    try:
        val = json.loads(s)
        if isinstance(val, (dict, list)):
            return s
        return val
    except json.JSONDecodeError:
        return s


def cypher(
    graph: str,
    cypher_body: str,
    columns: list[str],
    *,
    sess: PgSession | None = None,
) -> list[dict]:
    """执行 AGE cypher 查询;columns 为返回列名列表。"""
    graph = _safe_graph_name(graph)
    col_sql = ", ".join(f"{c} agtype" for c in columns)
    # AGE 要求第二参数为 dollar-quoted 字符串,不能用 psycopg2 单引号参数绑定
    tag = "ag_cypher"
    while f"${tag}$" in cypher_body:
        tag += "_"
    sql = f"SELECT * FROM cypher('{graph}', ${tag}${cypher_body}${tag}$) AS ({col_sql})"

    def _run(s: PgSession):
        _prepare_age(s)
        return s.query(sql)

    if sess:
        return _run(sess)
    with pglake.session() as s:
        return _run(s)


def _pick_node_name(props: dict) -> str:
    for key in ("entity_name", "entity_id", "name", "title", "file_path", "content"):
        val = props.get(key)
        if val is not None and str(val).strip():
            s = str(val).strip()
            return s[:128] if key != "content" else s[:48]
    return "node"


# 进程内结果缓存:同一 source/limit 5 分钟内直接复用,避免每次打开页面都重连 PG
_LIVE_CACHE: dict[tuple, tuple[float, dict]] = {}
_LIVE_CACHE_TTL = 300.0


def invalidate_live_cache():
    _LIVE_CACHE.clear()


def fetch_graph_live(
    graph: str | None = None,
    *,
    source_id: str | None = None,
    node_limit: int = 2000,
    edge_limit: int = 3000,
    sess: PgSession | None = None,
    use_cache: bool = True,
) -> dict:
    """
    通过 Cypher 直接从 AGE 读取轻量节点/边,不导入 SQLite 全库。
    结果按 (graph, source_id, limits) 缓存 5 分钟;use_cache=False 强制重查。
    """
    sid_key = (source_id or _sid()).strip()
    cache_key = (graph or "", sid_key, int(node_limit), int(edge_limit))
    if use_cache:
        hit = _LIVE_CACHE.get(cache_key)
        if hit and time.time() - hit[0] < _LIVE_CACHE_TTL:
            return {**hit[1], "cached": True}

    if not has_age():
        return {"error": "当前 PostgreSQL 未安装 AGE 扩展"}

    sid = sid_key
    src = resolve_source(sid) if sid else None
    graph = graph or graph_for_source(sid) or (
        graph_name_for_workspace(settings.LIGHTRAG_WORKSPACE) if settings.LIGHTRAG_WORKSPACE else ""
    )
    if not graph:
        return {"error": "未找到 AGE 图", "source_id": sid}

    node_limit = max(1, min(int(node_limit), 10000))
    edge_limit = max(1, min(int(edge_limit), 20000))

    def _load(s: PgSession):
        node_rows = cypher(
            graph,
            f"MATCH (n) RETURN id(n), properties(n) LIMIT {node_limit}",
            ["vid", "props"],
            sess=s,
        )
        edge_rows = cypher(
            graph,
            f"MATCH (a)-[r]->(b) RETURN id(a), id(b), type(r) LIMIT {edge_limit}",
            ["src", "tgt", "rlabel"],
            sess=s,
        )
        return node_rows, edge_rows

    if sess:
        node_rows, edge_rows = _load(sess)
    else:
        with pglake.session() as s:
            node_rows, edge_rows = _load(s)

    id_set: set[int] = set()
    objects: list[dict] = []
    for i, row in enumerate(node_rows):
        vid = _parse_agtype_scalar(row.get("vid"))
        if vid is None:
            continue
        try:
            nid = int(vid)
        except (TypeError, ValueError):
            continue
        props = _parse_agtype_props(row.get("props"))
        id_set.add(nid)
        angle = i * 0.618033988749895 * 6.28318
        radius = 80 + (i % 20) * 18
        objects.append({
            "id": nid,
            "category": "virtual",
            "otype": str(props.get("entity_type") or props.get("label") or "base"),
            "name": _pick_node_name(props),
            "attributes": {**props, "_age_id": nid, "_table": f"age.{graph}", "数据来源": f"AGE·{graph}"},
            "x": 500 + radius * __import__("math").cos(angle),
            "y": 340 + radius * __import__("math").sin(angle),
        })

    relations: list[dict] = []
    for i, row in enumerate(edge_rows):
        src_id = _parse_agtype_scalar(row.get("src"))
        tgt_id = _parse_agtype_scalar(row.get("tgt"))
        try:
            s_id, t_id = int(src_id), int(tgt_id)
        except (TypeError, ValueError):
            continue
        if s_id not in id_set or t_id not in id_set:
            continue
        label = str(_parse_agtype_scalar(row.get("rlabel")) or "关联")[:64]
        relations.append({
            "id": i + 1,
            "source": s_id,
            "target": t_id,
            "label": label,
        })

    stats = graph_stats(sid, sess=sess) if sid else {}
    pg_v = stats.get("vertices", 0)
    pg_e = stats.get("edges", 0)
    result = {
        "source": "age_cypher",
        "graph": graph,
        "source_id": sid,
        "source_name": (src or {}).get("name"),
        "workspace": (src or {}).get("workspace") or settings.LIGHTRAG_WORKSPACE,
        "objects": objects,
        "relations": relations,
        "meta": {
            "scope": "age_live",
            "age_graph": graph,
            "objects": len(objects),
            "relations": len(relations),
            "pg_vertices": pg_v,
            "pg_edges": pg_e,
            "node_limit": node_limit,
            "edge_limit": edge_limit,
            "truncated": len(objects) >= node_limit or len(relations) >= edge_limit,
        },
        "lightrag": {
            "source_id": sid,
            "workspace": (src or {}).get("workspace") or settings.LIGHTRAG_WORKSPACE,
            "source_name": (src or {}).get("name"),
            "graph": graph,
            "vertices": pg_v,
            "edges": pg_e,
        },
    }
    _LIVE_CACHE[cache_key] = (time.time(), result)
    return result


def _q(lake: PgLake, sess: PgSession | None, sql: str, params: list | None = None):
    if sess:
        return sess.query(sql, params)
    return lake.query(sql, params)


def _count_graph(
    graph: str,
    source_id: str,
    *,
    workspace_scoped: bool,
    lake: PgLake = pglake,
    sess: PgSession | None = None,
) -> dict:
    info = {"graph": graph, "vertices": 0, "edges": 0, "labels": {}}
    labels = _q(
        lake, sess,
        """
        SELECT l.name, l.kind
        FROM ag_catalog.ag_label l
        JOIN ag_catalog.ag_graph gr ON gr.graphid = l.graph
        WHERE gr.name = %s AND l.name NOT LIKE '_ag_label_%%'
        ORDER BY l.kind, l.name
        """,
        [graph],
    )
    for lb in labels:
        name, kind = lb["name"], lb["kind"]
        try:
            if workspace_scoped:
                cnt = _q(
                    lake, sess,
                    f'SELECT COUNT(*) AS c FROM "{graph}"."{name}"',
                )[0]["c"]
            else:
                cnt = _q(
                    lake, sess,
                    f'SELECT COUNT(*) AS c FROM "{graph}"."{name}" '
                    f"WHERE properties::text ILIKE %s",
                    [f"%{source_id}%"],
                )[0]["c"]
        except Exception:
            cnt = 0
        if cnt:
            info["labels"][name] = {"kind": kind, "count": cnt}
            if kind == "e":
                info["edges"] += cnt
            else:
                info["vertices"] += cnt
    return info


def graph_stats(source_id: str | None = None, sess: PgSession | None = None) -> dict:
    """统计指定 source_id 对应 AGE 图中的节点/边数量。"""
    sid = source_id or _sid()
    if not sid:
        return {"error": "未配置 LIGHTRAG_SOURCE_ID"}
    if not has_age():
        return {"error": "当前 PostgreSQL 未安装 AGE 扩展", "source_id": sid}

    src = resolve_source(sid)
    workspace_scoped = bool(src and src.get("workspace"))
    graphs = _candidate_graphs(sid)

    result = {
        "source_id": sid,
        "source_name": (src or {}).get("name"),
        "workspace": (src or {}).get("workspace") or settings.LIGHTRAG_WORKSPACE,
        "graphs": [],
    }
    best = None
    for g in graphs:
        info = _count_graph(g, sid, workspace_scoped=workspace_scoped, sess=sess)
        result["graphs"].append(info)
        if info["vertices"] + info["edges"] > 0:
            if best is None or (info["vertices"] + info["edges"]) > (
                best["vertices"] + best["edges"]
            ):
                best = info
    result["selected_graph"] = best["graph"] if best else None
    result["vertices"] = best["vertices"] if best else 0
    result["edges"] = best["edges"] if best else 0
    if not best and src and not graphs:
        result["error"] = f"workspace {src.get('workspace')} 对应 AGE 图不存在"
    return result


def iter_graph_elements(
    graph: str,
    source_id: str | None = None,
    *,
    workspace_scoped: bool = False,
    sess: PgSession | None = None,
):
    """迭代图中顶点与边;workspace_scoped=True 时导入整图(按 source 隔离的 workspace)。"""
    sid = (source_id or _sid()).strip()
    labels = _q(
        pglake, sess,
        """
        SELECT l.name, l.kind
        FROM ag_catalog.ag_label l
        JOIN ag_catalog.ag_graph gr ON gr.graphid = l.graph
        WHERE gr.name = %s AND l.name NOT LIKE '_ag_label_%%'
        """,
        [graph],
    )
    for lb in labels:
        name, kind = lb["name"], lb["kind"]
        try:
            if workspace_scoped:
                rows = _q(
                    pglake, sess,
                    f'SELECT id, start_id, end_id, properties FROM "{graph}"."{name}"',
                )
            else:
                rows = _q(
                    pglake, sess,
                    f'SELECT id, start_id, end_id, properties FROM "{graph}"."{name}" '
                    f"WHERE properties::text ILIKE %s",
                    [f"%{sid}%"],
                )
        except Exception:
            continue
        for row in rows:
            props = _parse_agtype_props(row.get("properties"))
            yield {
                "label": name,
                "kind": "edge" if kind == "e" else "vertex",
                "id": row.get("id"),
                "start_id": row.get("start_id"),
                "end_id": row.get("end_id"),
                "properties": props,
            }
