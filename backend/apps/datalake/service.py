"""
第1层 DuckDB 数据底座。

统一存放:每日业务数据、指标快照、异常结果、Error Book 纠错记录。
dev 阶段每次操作短连接,避免跨线程共享连接的问题。
"""
from pathlib import Path
import threading

import duckdb
from django.conf import settings

_lock = threading.Lock()


class DuckLake:
    def __init__(self, path: str | None = None):
        self.path = path or settings.DUCKDB_PATH
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)

    def connect(self):
        return duckdb.connect(self.path)

    def query(self, sql: str, params: list | None = None):
        with self.connect() as con:
            cur = con.execute(sql, params or [])
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchall()
        return [dict(zip(cols, r)) for r in rows]

    def execute(self, sql: str, params: list | None = None):
        with self.connect() as con:
            con.execute(sql, params or [])

    def list_tables(self):
        with self.connect() as con:
            names = [
                row[0] for row in con.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema='main' ORDER BY table_name"
                ).fetchall()
            ]
            if not names:
                return []
            count_sql = " UNION ALL ".join(
                f'SELECT ? AS table_name, COUNT(*) AS row_count FROM "{name}"'
                for name in names
            )
            counts = {row[0]: row[1] for row in con.execute(count_sql, names).fetchall()}
        return [{"table": name, "rows": counts.get(name, 0)} for name in names]

    def seed(self):
        """初始化示例数据(幂等)。"""
        with _lock, self.connect() as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS daily_sales (
                    dt DATE, shop VARCHAR, brand VARCHAR, sku VARCHAR,
                    gmv DOUBLE, orders INTEGER, refund DOUBLE
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS metric_snapshot (
                    dt DATE, metric VARCHAR, dim VARCHAR, value DOUBLE, mom DOUBLE, yoy DOUBLE
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS anomaly (
                    dt DATE, scope VARCHAR, metric VARCHAR, level VARCHAR, detail VARCHAR
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS error_book (
                    ts TIMESTAMP, trace_id VARCHAR, wrong VARCHAR, corrected VARCHAR, note VARCHAR
                )
                """
            )
            if con.execute("SELECT COUNT(*) FROM daily_sales").fetchone()[0] == 0:
                con.execute(
                    """
                    INSERT INTO daily_sales VALUES
                    ('2026-07-07','天猫旗舰店','品牌A','SKU-1001', 128000, 640, 3200),
                    ('2026-07-07','天猫旗舰店','品牌A','SKU-1002',  86000, 430, 1500),
                    ('2026-07-07','抖音小店','品牌B','SKU-2001', 204000, 1020, 8800),
                    ('2026-07-06','天猫旗舰店','品牌A','SKU-1001', 152000, 760, 2900),
                    ('2026-07-06','抖音小店','品牌B','SKU-2001', 198000, 990, 7600)
                    """
                )
            if con.execute("SELECT COUNT(*) FROM metric_snapshot").fetchone()[0] == 0:
                con.execute(
                    """
                    INSERT INTO metric_snapshot VALUES
                    ('2026-07-07','GMV','全站', 418000, -0.06, 0.22),
                    ('2026-07-07','退款率','全站', 0.033, 0.004, -0.01),
                    ('2026-07-07','客单价','全站', 210.5, -0.02, 0.08)
                    """
                )
            if con.execute("SELECT COUNT(*) FROM anomaly").fetchone()[0] == 0:
                con.execute(
                    """
                    INSERT INTO anomaly VALUES
                    ('2026-07-07','天猫旗舰店','GMV','warning','环比下滑 6%,需关注'),
                    ('2026-07-07','抖音小店','退款率','info','退款率环比上升,建议核查')
                    """
                )

    def ingest_jackyun(self, goods: list[dict], trades: list[dict]) -> dict:
        """降级路径:把吉客云汇总写入 daily_sales(DuckDB)。"""
        self.seed()
        products = len([g for g in goods if g.get("sku")])
        shops = set()
        sales = 0
        with _lock, self.connect() as con:
            for t in trades:
                shop = t.get("shop_name") or t.get("shop_id") or ""
                sku = t.get("sku") or ""
                if not shop or not sku:
                    continue
                shops.add(shop)
                con.execute(
                    "DELETE FROM daily_sales WHERE dt = ? AND shop = ? AND sku = ?",
                    [t["dt"], shop, sku],
                )
                con.execute(
                    "INSERT INTO daily_sales VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [
                        t["dt"], shop, "", sku,
                        t.get("gmv") or 0, t.get("orders") or 0, t.get("refund_amt") or 0,
                    ],
                )
                sales += 1
        return {"products": products, "shops": len(shops), "sales": sales}


ducklake = DuckLake()


def ingest_jackyun(goods: list[dict], trades: list[dict]) -> dict:
    return ducklake.ingest_jackyun(goods, trades)
