"""
本体图谱 <-> 数据底座(PostgreSQL)打通:

  - import_from_db:把 PG 中每一行数据都建成图谱实体,并按外键/引用列自动建关系。
  - object_data:按 _db_key 回查该行完整数据。
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from django.conf import settings
from django.shortcuts import get_object_or_404
from psycopg2 import Error as PsycopgError
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from .models import OntObject, OntRelation
from .graph_views import PRESET_TYPES
from .signals import bulk_import_mode
from apps.council import llm
from apps.datalake.pg import PgSession, pglake
from apps.datalake import age as age_svc


# lake 建模表元信息(主键 + 展示名)
LAKE_TABLE_META: dict[str, dict] = {
    "dim_date": {"otype": "日期", "category": "virtual", "pk": ["dt"], "name": ["dt"]},
    "dim_shop": {"otype": "店铺", "category": "virtual", "pk": ["shop_id"], "name": ["shop_name", "shop_id"]},
    "dim_product": {"otype": "商品", "category": "physical", "pk": ["sku"], "name": ["product_name", "sku"]},
    "dwd_sales_detail": {
        "otype": "销售明细", "category": "virtual",
        "pk": ["dt", "shop_id", "sku"], "name": ["dt", "shop_id", "sku"],
    },
    "dws_sales_shop_daily": {
        "otype": "店铺日汇总", "category": "virtual",
        "pk": ["dt", "shop_id"], "name": ["dt", "shop_id"],
    },
    "dws_sales_sku_daily": {
        "otype": "商品日汇总", "category": "virtual",
        "pk": ["dt", "sku"], "name": ["dt", "sku"],
    },
    "ads_metric_def": {
        "otype": "指标定义", "category": "virtual",
        "pk": ["metric_code"], "name": ["metric_name", "metric_code"],
    },
    "ads_metric_snapshot": {
        "otype": "指标快照", "category": "virtual",
        "pk": ["dt", "metric_code", "dim_type", "dim_value"],
        "name": ["metric_code", "dim_value", "dt"],
    },
    "ads_anomaly": {
        "otype": "异常预警", "category": "virtual",
        "pk": ["id"], "name": ["metric_code", "dim_value", "dt"],
    },
    "biz_object_event": {
        "otype": "动作留痕", "category": "virtual",
        "pk": ["id"], "name": ["action", "object_type", "id"],
    },
}

# 导入时跳过的镜像/系统表
SKIP_TABLES = {"ont_object", "ont_relation"}

# public 表 -> 对象类型
PUBLIC_OTYPE: dict[str, str] = {
    "user": "用户",
    "knowledge_base": "知识库",
    "knowledge_folder": "知识目录",
    "knowledge_file": "知识文件",
    "document_version": "文档版本",
    "document_chunk": "文档分块",
    "document_summary": "文档摘要",
    "file_doc": "文件映射",
    "conversation": "会话",
    "message": "消息",
    "answer_citation": "引用溯源",
}

_SENSITIVE = ("password", "secret", "token", "password_hash")


def _pg_ready() -> bool:
    pglake.invalidate_cache()
    if not pglake.available(force=True):
        return False
    try:
        pglake.ensure_ready()
        return True
    except Exception as exc:
        pglake._last_error = str(exc)
        return False


def _json_val(v):
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (dict, list)):
        return v
    return v


def _row_key(schema: str, table: str, pk_cols: list[str], row: dict) -> str:
    parts = [str(row[c]) for c in pk_cols]
    return f"{schema}.{table}:" + "|".join(parts)


def _pick_name(table: str, row: dict, name_cols: list[str], pk_cols: list[str]) -> str:
    for col in name_cols:
        v = row.get(col)
        if v is not None and str(v).strip():
            s = str(v).strip()
            return s[:120]
    return _row_key("x", table, pk_cols, row).split(":", 1)[-1][:120]


def _ensure_relation(source: OntObject, target: OntObject, label: str) -> tuple[OntRelation, bool]:
    """幂等建关系;若历史导入留下重复边,只保留一条。"""
    qs = OntRelation.objects.filter(source=source, target=target, label=label).order_by("id")
    first = qs.first()
    if first:
        dupes = list(qs.values_list("id", flat=True)[1:])
        if dupes:
            OntRelation.objects.filter(id__in=dupes).delete()
        return first, False
    return OntRelation.objects.create(source=source, target=target, label=label), True


def _load_db_key_cache(prefix: str = "") -> dict[str, OntObject]:
    """SQLite 不支持 JSON contains,导入前按 _db_key 建索引;可选 prefix 缩小范围。"""
    cache: dict[str, OntObject] = {}
    for obj in OntObject.objects.only("id", "name", "otype", "category", "x", "y", "attributes").iterator(
        chunk_size=1000,
    ):
        k = (obj.attributes or {}).get("_db_key")
        if not k:
            continue
        ks = str(k)
        if prefix and not ks.startswith(prefix):
            continue
        cache[ks] = obj
    return cache


def _find_by_db_key(db_key: str, cache: dict[str, OntObject] | None = None) -> OntObject | None:
    if cache is not None:
        return cache.get(db_key)
    for obj in OntObject.objects.only("id", "name", "otype", "category", "x", "y", "attributes"):
        if (obj.attributes or {}).get("_db_key") == db_key:
            return obj
    return None


def _upsert_row(
    schema: str, table: str, otype: str, category: str,
    row: dict, pk_cols: list[str], name_cols: list[str], layout_i: int,
    cache: dict[str, OntObject],
) -> tuple[OntObject, bool]:
    db_key = _row_key(schema, table, pk_cols, row)
    attrs = {
        k: _json_val(v)
        for k, v in row.items()
        if not any(s in k.lower() for s in _SENSITIVE)
    }
    attrs["_db_key"] = db_key
    attrs["_table"] = f"{schema}.{table}"
    attrs["数据来源"] = f"PostgreSQL·{schema}.{table}"

    name = _pick_name(table, row, name_cols, pk_cols)
    angle = layout_i * 0.618033988749895 * 6.28318
    radius = 80 + (layout_i % 12) * 28
    x = 450 + radius * __import__("math").cos(angle)
    y = 320 + radius * __import__("math").sin(angle)

    obj = cache.get(db_key)
    if obj:
        merged = dict(obj.attributes or {})
        merged.update(attrs)
        obj.attributes = merged
        obj.otype = otype
        obj.category = category
        if not obj.name or obj.name == name:
            obj.name = name[:128]
        obj.save()
        cache[db_key] = obj
        return obj, False

    obj = OntObject.objects.create(
        category=category, otype=otype, name=name[:128],
        attributes=attrs, x=x, y=y,
    )
    cache[db_key] = obj
    return obj, True


def _table_pks(schema: str, table: str, sess: PgSession | None = None) -> list[str]:
    q = sess.query if sess else pglake.query
    rows = q(
        """
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = %s AND tc.table_name = %s
        ORDER BY kcu.ordinal_position
        """,
        [schema, table],
    )
    if rows:
        return [r["column_name"] for r in rows]
    # 无主键时退化为 id 或首列
    cols = q(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema=%s AND table_name=%s
        ORDER BY ordinal_position
        """,
        [schema, table],
    )
    names = [c["column_name"] for c in cols]
    if "id" in names:
        return ["id"]
    return [names[0]] if names else []


def _table_columns(schema: str, table: str) -> list[str]:
    rows = pglake.query(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema=%s AND table_name=%s
        ORDER BY ordinal_position
        """,
        [schema, table],
    )
    return [r["column_name"] for r in rows]


def _foreign_keys(schema: str, sess: PgSession | None = None) -> list[dict]:
    q = sess.query if sess else pglake.query
    return q(
        """
        SELECT
            tc.table_name AS child_table,
            kcu.column_name AS child_col,
            ccu.table_name AS parent_table,
            ccu.column_name AS parent_col
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
         AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = %s
        """,
        [schema],
    )


def _import_schema_tables(
    schema: str,
    table_meta: dict[str, dict] | None = None,
    cache: dict[str, OntObject] | None = None,
    sess: PgSession | None = None,
) -> tuple[dict[str, OntObject], int, int]:
    """导入 schema 下所有表(每行一实体)。返回 db_key->对象, 新建对象数, 新建关系数。"""
    if cache is None:
        cache = _load_db_key_cache()
    q = sess.query if sess else pglake.query
    tables = q(
        """
        SELECT table_name FROM information_schema.tables
        WHERE table_schema=%s AND table_type='BASE TABLE'
        ORDER BY table_name
        """,
        [schema],
    )
    key_to_obj: dict[str, OntObject] = {}
    created_objs = 0
    created_rels = 0
    layout_i = 0

    for t in tables:
        table = t["table_name"]
        if table in SKIP_TABLES:
            continue

        meta = (table_meta or {}).get(table, {})
        otype = meta.get("otype") or PUBLIC_OTYPE.get(table) or table
        category = meta.get("category", "virtual")
        pk_cols = meta.get("pk") or _table_pks(schema, table, sess)
        name_cols = meta.get("name") or (
            ["name", "title", "kb_name", "file_name", "username", "label"] + pk_cols
        )

        try:
            rows = q(f'SELECT * FROM "{schema}"."{table}"')
        except Exception:
            continue

        for row in rows:
            obj, created = _upsert_row(
                schema, table, otype, category, row, pk_cols, name_cols, layout_i, cache,
            )
            key_to_obj[obj.attributes["_db_key"]] = obj
            created_objs += int(created)
            layout_i += 1

    # 外键关系
    for fk in _foreign_keys(schema, sess):
        child_table = fk["child_table"]
        parent_table = fk["parent_table"]
        if child_table in SKIP_TABLES or parent_table in SKIP_TABLES:
            continue
        child_pk = (table_meta or {}).get(child_table, {}).get("pk") or _table_pks(schema, child_table, sess)
        parent_pk = (table_meta or {}).get(parent_table, {}).get("pk") or _table_pks(schema, parent_table, sess)
        try:
            child_rows = q(f'SELECT * FROM "{schema}"."{child_table}"')
        except Exception:
            continue
        for row in child_rows:
            child_key = _row_key(schema, child_table, child_pk, row)
            child_obj = key_to_obj.get(child_key)
            if not child_obj:
                continue
            parent_val = row.get(fk["child_col"])
            if parent_val is None:
                continue
            # 在父表行里找匹配
            try:
                parent_rows = q(
                    f'SELECT * FROM "{schema}"."{parent_table}" '
                    f'WHERE "{fk["parent_col"]}" = %s',
                    [parent_val],
                )
            except Exception:
                continue
            for prow in parent_rows:
                parent_key = _row_key(schema, parent_table, parent_pk, prow)
                parent_obj = key_to_obj.get(parent_key)
                if not parent_obj or parent_obj.id == child_obj.id:
                    continue
                label = f"引用·{fk['child_col']}"
                _, created = _ensure_relation(child_obj, parent_obj, label)
                created_rels += int(created)

    # lake 引用列(无正式 FK 时): *_id / 同名键关联维度表
    if schema == pglake.schema:
        refs = [
            ("dwd_sales_detail", "shop_id", "dim_shop", "shop_id", "属于店铺"),
            ("dwd_sales_detail", "sku", "dim_product", "sku", "销售商品"),
            ("dwd_sales_detail", "dt", "dim_date", "dt", "日期"),
            ("dws_sales_shop_daily", "shop_id", "dim_shop", "shop_id", "汇总店铺"),
            ("dws_sales_shop_daily", "dt", "dim_date", "dt", "日期"),
            ("dws_sales_sku_daily", "sku", "dim_product", "sku", "汇总商品"),
            ("dws_sales_sku_daily", "dt", "dim_date", "dt", "日期"),
            ("ads_metric_snapshot", "metric_code", "ads_metric_def", "metric_code", "指标"),
            ("ads_anomaly", "metric_code", "ads_metric_def", "metric_code", "指标"),
        ]
        for child_t, child_c, parent_t, parent_c, label in refs:
            child_pk = LAKE_TABLE_META.get(child_t, {}).get("pk") or _table_pks(schema, child_t, sess)
            parent_pk = LAKE_TABLE_META.get(parent_t, {}).get("pk") or _table_pks(schema, parent_t, sess)
            try:
                child_rows = q(f'SELECT * FROM "{schema}"."{child_t}"')
            except Exception:
                continue
            for row in child_rows:
                child_key = _row_key(schema, child_t, child_pk, row)
                child_obj = key_to_obj.get(child_key)
                val = row.get(child_c)
                if not child_obj or val is None:
                    continue
                try:
                    parents = q(
                        f'SELECT * FROM "{schema}"."{parent_t}" WHERE "{parent_c}" = %s',
                        [val],
                    )
                except Exception:
                    continue
                for prow in parents:
                    parent_key = _row_key(schema, parent_t, parent_pk, prow)
                    parent_obj = key_to_obj.get(parent_key)
                    if not parent_obj or parent_obj.id == child_obj.id:
                        continue
                    _, created = _ensure_relation(child_obj, parent_obj, label)
                    created_rels += int(created)

    return key_to_obj, created_objs, created_rels


@api_view(["POST"])
def import_from_db(request):
    """把数据库里每一行数据都导入为本体图谱实体,并自动建立引用/外键关系。"""
    if not _pg_ready():
        return Response(
            {
                "error": "PostgreSQL 数据底座不可用,无法导入",
                "hint": f"请检查 backend/.env: POSTGRES_HOST={settings.PG_HOST} POSTGRES_PORT={settings.PG_PORT} POSTGRES_DB={settings.PG_DB}",
                "detail": pglake._last_error or "连接失败",
                "config": {
                    "host": settings.PG_HOST,
                    "port": settings.PG_PORT,
                    "db": settings.PG_DB,
                    "active_host": getattr(pglake, "_active_host", ""),
                },
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    cache = _load_db_key_cache()
    try:
        with bulk_import_mode(), pglake.session() as sess:
            lake_objs, lake_new, lake_rels = _import_schema_tables(
                pglake.schema, LAKE_TABLE_META, cache, sess,
            )
            pub_objs, pub_new, pub_rels = _import_schema_tables("public", {}, cache, sess)
    except PsycopgError as exc:
        pglake._last_error = str(exc)
        return Response(
            {
                "error": "PostgreSQL 导入失败",
                "detail": str(exc),
                "hint": f"当前连接: {pglake.endpoint()}",
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    total_entities = len(lake_objs) + len(pub_objs)
    age_info = age_svc.graph_stats()
    return Response({
        "mode": "row_level",
        "source_id": settings.LIGHTRAG_SOURCE_ID,
        "lake_entities": len(lake_objs),
        "public_entities": len(pub_objs),
        "total_entities": total_entities,
        "created_objects": lake_new + pub_new,
        "created_relations": lake_rels + pub_rels,
        "age": age_info,
    })


def _age_vertex_fields(
    graph: str, label: str, age_id, props: dict, layout_i: int,
) -> tuple[str, str, str, str, dict, float, float]:
    db_key = f"age.{graph}.{label}.{age_id}"
    name = (
        props.get("entity_name") or props.get("entity_id")
        or props.get("content", "")[:48] or props.get("file_path", "")[-48:]
        or f"{label}-{age_id}"
    )
    name = str(name).strip()[:128]
    attrs = {k: _json_val(v) for k, v in props.items()}
    attrs["_db_key"] = db_key
    attrs["_table"] = f"age.{graph}"
    attrs["_age_id"] = age_id
    attrs["_age_label"] = label
    attrs["source_id"] = props.get("source_id") or settings.LIGHTRAG_SOURCE_ID
    attrs["数据来源"] = f"AGE·{graph}"

    angle = layout_i * 0.618033988749895 * 6.28318
    radius = 100 + (layout_i % 16) * 22
    x = 500 + radius * __import__("math").cos(angle)
    y = 340 + radius * __import__("math").sin(angle)
    category = "physical" if label.lower() in ("entity", "chunk") else "virtual"
    return db_key, category, label, name, attrs, x, y


def _upsert_age_vertex(
    graph: str, label: str, age_id, props: dict, layout_i: int,
    cache: dict[str, OntObject],
) -> tuple[OntObject, bool]:
    db_key, category, label, name, attrs, x, y = _age_vertex_fields(
        graph, label, age_id, props, layout_i,
    )
    obj = cache.get(db_key)
    if obj:
        merged = dict(obj.attributes or {})
        merged.update(attrs)
        obj.attributes = merged
        obj.otype = label
        obj.category = category
        obj.name = name
        obj.save()
        cache[db_key] = obj
        return obj, False
    obj = OntObject.objects.create(
        category=category, otype=label, name=name, attributes=attrs, x=x, y=y,
    )
    cache[db_key] = obj
    return obj, True


def _import_from_age(source_id: str | None = None) -> dict:
    sid = (source_id or settings.LIGHTRAG_SOURCE_ID or "").strip()
    src_info = age_svc.resolve_source(sid)
    workspace_scoped = bool(src_info and src_info.get("workspace"))

    with pglake.session() as sess:
        stats = age_svc.graph_stats(sid, sess=sess)
        graph = stats.get("selected_graph")
        if not graph:
            return {
                "error": stats.get("error") or "未找到该 source_id 对应的 AGE 图",
                "stats": stats,
                "source_id": sid,
            }

        cache_prefix = f"age.{graph}."
        cache = _load_db_key_cache(cache_prefix)
        vertices: list[dict] = []
        edges: list[dict] = []
        for el in age_svc.iter_graph_elements(
            graph, sid, workspace_scoped=workspace_scoped, sess=sess,
        ):
            if el["kind"] == "vertex":
                vertices.append(el)
            else:
                edges.append(el)

        id_map: dict = {}
        to_create: list[OntObject] = []
        to_update: list[OntObject] = []
        created_objs = 0
        layout_i = 0

        with bulk_import_mode():
            for el in vertices:
                db_key, category, label, name, attrs, x, y = _age_vertex_fields(
                    graph, el["label"], el["id"], el["properties"], layout_i,
                )
                obj = cache.get(db_key)
                if obj:
                    merged = dict(obj.attributes or {})
                    merged.update(attrs)
                    obj.attributes = merged
                    obj.otype = label
                    obj.category = category
                    obj.name = name
                    to_update.append(obj)
                else:
                    obj = OntObject(
                        category=category, otype=label, name=name,
                        attributes=attrs, x=x, y=y,
                    )
                    to_create.append(obj)
                    created_objs += 1
                id_map[el["id"]] = obj
                cache[db_key] = obj
                layout_i += 1

            if to_create:
                OntObject.objects.bulk_create(to_create, batch_size=500)
            if to_update:
                OntObject.objects.bulk_update(
                    to_update, ["attributes", "otype", "category", "name"], batch_size=500,
                )

            existing_rels = set(
                OntRelation.objects.values_list("source_id", "target_id", "label"),
            )
            new_rels: list[OntRelation] = []
            for el in edges:
                src = id_map.get(el["start_id"])
                tgt = id_map.get(el["end_id"])
                if not src or not tgt or not src.pk or not tgt.pk or src.pk == tgt.pk:
                    continue
                label = el["label"]
                key = (src.pk, tgt.pk, label)
                if key in existing_rels:
                    continue
                new_rels.append(OntRelation(source_id=src.pk, target_id=tgt.pk, label=label))
                existing_rels.add(key)
            if new_rels:
                OntRelation.objects.bulk_create(new_rels, batch_size=500)
            created_rels = len(new_rels)

    return {
        "source_id": sid,
        "source_name": (src_info or {}).get("name"),
        "workspace": (src_info or {}).get("workspace"),
        "graph": graph,
        "vertices": len(id_map),
        "created_objects": created_objs,
        "created_relations": created_rels,
        "stats": stats,
    }


@api_view(["GET"])
def age_stats(request):
    """查询当前 source_id 在 AGE 图中的节点/边统计。"""
    sid = request.query_params.get("source_id") or settings.LIGHTRAG_SOURCE_ID
    return Response({
        "source_id": sid,
        "workspace": settings.LIGHTRAG_WORKSPACE,
        **age_svc.graph_stats(sid),
    })


def _enrich_age_relations_causal(relations: list[dict]) -> list[dict]:
    """将本地库已保存的因果元数据合并进 AGE 直读边列表。"""
    if not relations:
        return relations
    db_index: dict[tuple[int, int, str], OntRelation] = {}
    for r in OntRelation.objects.select_related("source", "target").iterator(chunk_size=500):
        sa = (r.source.attributes or {}).get("_age_id")
        ta = (r.target.attributes or {}).get("_age_id")
        if sa is None or ta is None:
            continue
        try:
            db_index[(int(sa), int(ta), r.label)] = r
        except (TypeError, ValueError):
            continue
    out = []
    for rel in relations:
        key = (rel.get("source"), rel.get("target"), rel.get("label", "关联"))
        db_r = db_index.get(key)  # type: ignore[arg-type]
        if db_r:
            rel = {
                **rel,
                "polarity": db_r.polarity or "",
                "delay_days": db_r.delay_days,
                "evidence_score": db_r.evidence_score,
                "is_causal_candidate": db_r.is_causal_candidate,
                "db_relation_id": db_r.id,
            }
        out.append(rel)
    return out


@api_view(["GET"])
def age_live_graph(request):
    """通过 AGE Cypher 直接读取本图轻量节点/边,不拉 SQLite 全库。结果缓存 5 分钟,refresh=1 强制重查。"""
    sid = (request.query_params.get("source_id") or settings.LIGHTRAG_SOURCE_ID or "").strip()
    refresh = request.query_params.get("refresh") in ("1", "true", "yes")
    try:
        node_limit = int(request.query_params.get("limit", "1000"))
        edge_limit = int(request.query_params.get("edge_limit", "1500"))
        focus_raw = request.query_params.get("focus_age_id") or ""
        focus_age_id = int(focus_raw) if focus_raw else None
    except ValueError:
        return Response({"error": "limit / edge_limit / focus_age_id must be integers"}, status=status.HTTP_400_BAD_REQUEST)

    # 缓存命中时无需探测 PG 连通性,页面秒开
    result = age_svc.fetch_graph_live(
        source_id=sid or None,
        focus_age_id=focus_age_id,
        node_limit=node_limit,
        edge_limit=edge_limit,
        use_cache=not refresh,
    )
    if result.get("error") and not _pg_ready():
        return Response(
            {"error": "PostgreSQL 不可用", "detail": pglake._last_error},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if result.get("error"):
        return Response(result, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    relations = _enrich_age_relations_causal(result["relations"])
    return Response({
        "source": "age_cypher",
        "objects": result["objects"],
        "relations": relations,
        "presets": PRESET_TYPES,
        "llm": llm.llm_available(),
        "lightrag": result.get("lightrag", {}),
        "meta": result.get("meta", {}),
    })


@api_view(["POST"])
def import_from_age(request):
    """从 AGE 图按 source_id 导入实体与关系。"""
    if not _pg_ready():
        return Response(
            {"error": "PostgreSQL 不可用", "detail": pglake._last_error},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    sid = (request.data.get("source_id") or settings.LIGHTRAG_SOURCE_ID or "").strip()
    result = _import_from_age(sid)
    if result.get("error"):
        return Response(result, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(result)


def _round_rows(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        out.append({
            k: (round(v, 4) if isinstance(v, float) else _json_val(v))
            for k, v in r.items()
        })
    return out


@api_view(["GET"])
def object_data(request, obj_id: int):
    """返回对象在数据底座中的行级数据。"""
    o = get_object_or_404(OntObject, id=obj_id)
    attrs = o.attributes or {}
    db_key = attrs.get("_db_key")
    table_ref = attrs.get("_table")

    if not _pg_ready():
        return Response({
            "object": {"id": o.id, "otype": o.otype, "name": o.name, "attributes": attrs},
            "source": "unavailable",
            "blocks": [],
            "note": "PostgreSQL 数据底座不可用",
        })

    blocks: list[dict] = []

    # 行级实体:按 _db_key 回查原表该行
    if db_key and table_ref and "." in str(table_ref):
        schema, table = str(table_ref).split(".", 1)
        pk_cols = LAKE_TABLE_META.get(table, {}).get("pk") or _table_pks(schema, table)
        pk_vals = str(db_key).split(":", 1)[-1].split("|")
        if len(pk_vals) == len(pk_cols):
            where = " AND ".join(f'"{c}" = %s' for c in pk_cols)
            try:
                row = pglake.query(
                    f'SELECT * FROM "{schema}"."{table}" WHERE {where}',
                    pk_vals,
                )
                if row:
                    blocks.append({"title": f"行数据({table_ref})", "rows": _round_rows(row)})
            except Exception:
                pass

        # 关联行(出边/入边对应的其他表行)
        out_rels = o.out_relations.select_related("target")[:20]
        in_rels = o.in_relations.select_related("source")[:20]
        rel_rows = []
        for r in out_rels:
            rel_rows.append({
                "方向": "出", "关系": r.label,
                "目标": f"{r.target.otype}·{r.target.name}",
                "表": (r.target.attributes or {}).get("_table", ""),
            })
        for r in in_rels:
            rel_rows.append({
                "方向": "入", "关系": r.label,
                "来源": f"{r.source.otype}·{r.source.name}",
                "表": (r.source.attributes or {}).get("_table", ""),
            })
        if rel_rows:
            blocks.append({"title": "图谱关联", "rows": rel_rows})

    # 兼容旧版店铺/商品(无 _db_key)
    elif o.otype == "店铺":
        info = pglake.query(
            "SELECT * FROM dim_shop WHERE shop_name = %s", [o.name],
        )
        if info:
            blocks.append({"title": "店铺档案", "rows": _round_rows(info)})

    elif o.otype == "商品":
        sku = attrs.get("sku")
        if sku:
            info = pglake.query("SELECT * FROM dim_product WHERE sku = %s", [sku])
            if info:
                blocks.append({"title": "商品档案", "rows": _round_rows(info)})

    mirror = pglake.query(
        "SELECT id, category, otype, name, synced_at FROM ont_object WHERE id = %s",
        [o.id],
    )
    if mirror:
        blocks.append({"title": "本体镜像(lake.ont_object)", "rows": mirror})

    return Response({
        "object": {"id": o.id, "otype": o.otype, "name": o.name, "attributes": attrs},
        "source": "postgres",
        "blocks": blocks,
        "note": "" if blocks else "数据底座中暂无与该对象直接关联的业务数据",
    })
