"""列出 PostgreSQL 全部业务表及行数。"""
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

SKIP_SCHEMAS = {"pg_catalog", "information_schema", "ag_catalog", "pg_toast"}


def main():
    pglake.invalidate_cache()
    print(f"连接: {pglake.endpoint()}\n")

    with pglake.session() as sess:
        tables = sess.query(
            """
            SELECT table_schema, table_name
            FROM information_schema.tables
            WHERE table_schema NOT IN %s
              AND table_type = 'BASE TABLE'
            ORDER BY table_schema, table_name
            """,
            [tuple(SKIP_SCHEMAS)],
        )

        by_schema: dict[str, list[tuple[str, int]]] = {}
        for t in tables:
            schema, name = t["table_schema"], t["table_name"]
            try:
                cnt = sess.query(
                    f'SELECT COUNT(*) AS c FROM "{schema}"."{name}"',
                )[0]["c"]
            except Exception:
                cnt = -1
            by_schema.setdefault(schema, []).append((name, cnt))

        total_tables = 0
        total_rows = 0
        for schema in sorted(by_schema):
            rows = by_schema[schema]
            print(f"## schema: {schema} ({len(rows)} 张表)")
            for name, cnt in rows:
                total_tables += 1
                if cnt >= 0:
                    total_rows += cnt
                    print(f"  - {name}\t({cnt} 行)")
                else:
                    print(f"  - {name}\t(无法统计)")
            print()

        print(f"合计: {len(by_schema)} 个 schema, {total_tables} 张业务表, 约 {total_rows} 行")


if __name__ == "__main__":
    main()
