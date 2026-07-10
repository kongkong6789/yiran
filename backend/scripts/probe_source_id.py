"""探测 source_id 在 PG / AGE 中的位置。"""
import os
import sys
from pathlib import Path

import django

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))
os.chdir(BASE)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.datalake.pg import pglake

SID = sys.argv[1] if len(sys.argv) > 1 else "a3983942-55d0-4257-80fd-27c50275675a"


def main():
    pglake.invalidate_cache()
    print("endpoint:", pglake.endpoint())

    with pglake.session() as sess:
        q = sess.query

        # 1) knowledge_base 映射
        for sql, params in [
            (
                "SELECT id, kb_name, workspace FROM public.knowledge_base "
                "WHERE id::text = %s LIMIT 5",
                [SID],
            ),
            (
                "SELECT id, kb_name, workspace FROM public.knowledge_base "
                "WHERE workspace ILIKE %s LIMIT 5",
                [f"%{SID}%"],
            ),
        ]:
            try:
                rows = q(sql, params)
                print(f"\nknowledge_base query: {rows}")
            except Exception as exc:
                print(f"\nknowledge_base err: {exc}")

        # 2) 全库文本搜索含 source_id 的表(仅 public 小表)
        tables = q(
            """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
            ORDER BY table_name
            """
        )
        hit_tables = []
        for t in tables:
            tbl = t["table_name"]
            if tbl.startswith("pg_") or tbl.startswith("_"):
                continue
            cols = q(
                """
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = %s
                """,
                [tbl],
            )
            text_cols = [
                c["column_name"]
                for c in cols
                if c["data_type"] in ("text", "character varying", "uuid", "jsonb", "json")
                or "uuid" in c["data_type"]
            ]
            for col in text_cols[:8]:
                try:
                    cnt = q(
                        f'SELECT COUNT(*) AS c FROM public."{tbl}" '
                        f'WHERE CAST("{col}" AS text) ILIKE %s',
                        [f"%{SID}%"],
                    )[0]["c"]
                    if cnt:
                        hit_tables.append((tbl, col, cnt))
                except Exception:
                    pass
        print("\npublic hits:", hit_tables[:20])

        # 2b) graph_sources / graph_documents 详情
        try:
            src = q(
                "SELECT * FROM public.graph_sources WHERE id::text = %s",
                [SID],
            )
            print("\ngraph_sources:", src)
        except Exception as exc:
            print("\ngraph_sources err:", exc)
        try:
            docs = q(
                "SELECT * FROM public.graph_documents WHERE source_id::text = %s LIMIT 10",
                [SID],
            )
            print("\ngraph_documents:", docs)
        except Exception as exc:
            print("\ngraph_documents err:", exc)

        # 3) AGE 图: 按 properties 搜索 + 采样
        graphs = q("SELECT name FROM ag_catalog.ag_graph ORDER BY name")
        for g in graphs:
            gn = g["name"]
            labels = q(
                """
                SELECT l.name, l.kind
                FROM ag_catalog.ag_label l
                JOIN ag_catalog.ag_graph gr ON gr.graphid = l.graph
                WHERE gr.name = %s AND l.name NOT LIKE '_ag_label_%%'
                """,
                [gn],
            )
            graph_hits = 0
            for lb in labels:
                name = lb["name"]
                try:
                    cnt = q(
                        f'SELECT COUNT(*) AS c FROM "{gn}"."{name}" '
                        f"WHERE properties::text ILIKE %s",
                        [f"%{SID}%"],
                    )[0]["c"]
                except Exception:
                    cnt = 0
                if cnt:
                    graph_hits += cnt
                    print(f"\nAGE hit: {gn}.{name} count={cnt}")
                    sample = q(
                        f'SELECT properties::text AS t FROM "{gn}"."{name}" '
                        f"WHERE properties::text ILIKE %s LIMIT 1",
                        [f"%{SID}%"],
                    )
                    if sample:
                        print(" sample:", sample[0]["t"][:400])
            if graph_hits == 0:
                # 打印非空图的总行数(无 source_id 过滤)
                total = 0
                for lb in labels:
                    try:
                        total += q(
                            f'SELECT COUNT(*) AS c FROM "{gn}"."{lb["name"]}"'
                        )[0]["c"]
                    except Exception:
                        pass
                if total:
                    print(f"\nAGE graph {gn}: total_rows={total} (no source_id match)")


if __name__ == "__main__":
    main()
