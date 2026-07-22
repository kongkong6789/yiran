"""
第1层 数据底座:PostgreSQL 主库(DuckDB 作为本地降级)。

按数据建模方案分层建表(独立 schema,默认 lake):
  dim_*  维度:日期 / 店铺 / 商品
  dwd_*  明细:清洗后的销售明细(挂维度键,带装载时间)
  dws_*  汇总:店铺日汇总 / SKU 日汇总
  ads_*  应用:指标字典(口径)/ 指标快照 / 异常
  ont_*  本体镜像:与本体图谱的对象、关系保持一致(由 Django 侧同步)
  biz_object_event  业务对象动作留痕(harness 闸机结论)

连接失败时上层自动降级 DuckDB,不影响演示。
"""
import json
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path

import psycopg2
from django.conf import settings
from dotenv import load_dotenv

_lock = threading.Lock()


class PgLake:
    def __init__(self):
        self.schema = settings.PG_SCHEMA
        self._ready = False
        self._avail: bool | None = None
        self._avail_ts = 0.0
        self._last_error: str = ""
        self._active_host: str = ""

    def invalidate_cache(self):
        """配置变更或导入前调用,避免沿用旧的连通性缓存。"""
        self._avail = None
        self._avail_ts = 0.0
        self._last_error = ""
        self._ready = False

    # ---------------- 连接 ----------------

    def enabled(self) -> bool:
        return bool(settings.PG_HOST and settings.PG_DB)

    def _reload_env(self):
        """runserver 不会自动重载 .env,连接前刷新一次。"""
        load_dotenv(Path(settings.BASE_DIR) / ".env", override=True)

    def _pg_env(self, *keys: str, default: str = "") -> str:
        for key in keys:
            val = os.getenv(key)
            if val is not None and val != "":
                return val
        return default

    def _hosts(self) -> list[str]:
        """主库优先,连不上则试备用主机(Docker 未通时自动回退)。"""
        self._reload_env()
        out: list[str] = []
        for key in (
            ("POSTGRES_HOST", "PG_HOST"),
            ("POSTGRES_HOST_FALLBACK", "PG_HOST_FALLBACK"),
        ):
            h = self._pg_env(*key, default=getattr(settings, key[1], "")).strip()
            if h and h not in out:
                out.append(h)
        return out

    def _conn_params(self) -> dict:
        self._reload_env()
        return {
            "port": int(self._pg_env("POSTGRES_PORT", "PG_PORT", default=str(settings.PG_PORT))),
            "dbname": self._pg_env("POSTGRES_DB", "PG_DB", default=settings.PG_DB),
            "user": self._pg_env("POSTGRES_USER", "PG_USER", default=settings.PG_USER),
            "password": self._pg_env("POSTGRES_PASSWORD", "PG_PASSWORD", default=settings.PG_PASSWORD),
        }

    def endpoint(self) -> str:
        p = self._conn_params()
        host = self._active_host or (self._hosts()[0] if self._hosts() else "?")
        schema = self._pg_env("POSTGRES_SCHEMA", "PG_SCHEMA", default=settings.PG_SCHEMA)
        return f"{host}:{p['port']}/{p['dbname']} (schema={schema})"

    def connect(self):
        p = self._conn_params()
        schema = self._pg_env("POSTGRES_SCHEMA", "PG_SCHEMA", default=settings.PG_SCHEMA)
        last_exc: Exception | None = None
        for host in self._hosts():
            try:
                con = psycopg2.connect(
                    host=host, port=p["port"], dbname=p["dbname"],
                    user=p["user"], password=p["password"],
                    connect_timeout=5,
                    options=f"-c search_path={schema},public",
                )
                self._active_host = host
                return con
            except Exception as exc:
                last_exc = exc
        self._active_host = ""
        if last_exc:
            raise last_exc
        raise RuntimeError("未配置 POSTGRES_HOST / PG_HOST")

    def available(self, force: bool = False) -> bool:
        """连通性探测,结果缓存 30 秒;force=True 时立即重试。"""
        if not self.enabled():
            self._last_error = "未配置 POSTGRES_DB / PG_DB"
            return False
        now = time.time()
        if not force and self._avail is not None and now - self._avail_ts < 30:
            return self._avail
        try:
            with self.connect() as con:
                con.cursor().execute("SELECT 1")
            self._avail = True
            self._last_error = ""
        except Exception as exc:
            self._avail = False
            hosts = ", ".join(self._hosts()) or "?"
            self._last_error = f"{exc} (已尝试: {hosts})"
        self._avail_ts = now
        return self._avail

    def query(self, sql: str, params: list | None = None) -> list[dict]:
        with self.connect() as con:
            return self._fetch(con, sql, params)

    def _fetch(self, con, sql: str, params: list | None = None) -> list[dict]:
        try:
            cur = con.cursor()
            cur.execute(sql, params or [])
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchall() if cur.description else []
            return [dict(zip(cols, r)) for r in rows]
        except Exception:
            if not getattr(con, "autocommit", False):
                con.rollback()
            raise

    @contextmanager
    def session(self):
        """批量操作复用单连接,避免耗尽 PostgreSQL max_connections。"""
        con = self.connect()
        con.autocommit = True
        try:
            yield PgSession(self, con)
        finally:
            con.close()

    def execute(self, sql: str, params: list | None = None):
        with self.connect() as con:
            con.cursor().execute(sql, params or [])
            con.commit()

    # ---------------- 建模表 DDL(幂等) ----------------

    DDL = """
    CREATE SCHEMA IF NOT EXISTS {s};

    -- 维度
    CREATE TABLE IF NOT EXISTS {s}.dim_date (
        dt DATE PRIMARY KEY,
        year INT, quarter INT, month INT, week INT,
        is_promo BOOLEAN DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS {s}.dim_shop (
        shop_id VARCHAR PRIMARY KEY,
        shop_name VARCHAR NOT NULL,
        platform VARCHAR,
        brand VARCHAR,
        owner_role VARCHAR
    );
    CREATE TABLE IF NOT EXISTS {s}.dim_product (
        sku VARCHAR PRIMARY KEY,
        spu VARCHAR, product_name VARCHAR, category VARCHAR,
        brand VARCHAR, cost_price DOUBLE PRECISION, list_price DOUBLE PRECISION
    );
    CREATE TABLE IF NOT EXISTS {s}.dim_sku_inventory_map (
        sales_sku VARCHAR PRIMARY KEY,
        goods_no VARCHAR NOT NULL,
        sku_barcode VARCHAR,
        goods_name VARCHAR,
        source VARCHAR NOT NULL DEFAULT 'jackyun_inventory',
        confidence DOUBLE PRECISION NOT NULL DEFAULT 1,
        updated_at TIMESTAMP NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sku_inventory_map_goods_no
        ON {s}.dim_sku_inventory_map(goods_no);
    CREATE INDEX IF NOT EXISTS idx_sku_inventory_map_barcode
        ON {s}.dim_sku_inventory_map(sku_barcode);

    -- 明细
    CREATE TABLE IF NOT EXISTS {s}.dwd_sales_detail (
        dt DATE NOT NULL,
        shop_id VARCHAR NOT NULL,
        sku VARCHAR NOT NULL,
        gmv DOUBLE PRECISION DEFAULT 0,
        orders INT DEFAULT 0,
        units INT DEFAULT 0,
        refund_amt DOUBLE PRECISION DEFAULT 0,
        refund_orders INT DEFAULT 0,
        src VARCHAR DEFAULT 'seed',
        loaded_at TIMESTAMP DEFAULT now()
    );

    -- 汇总
    CREATE TABLE IF NOT EXISTS {s}.dws_sales_shop_daily (
        dt DATE, shop_id VARCHAR,
        gmv DOUBLE PRECISION, orders INT, refund_amt DOUBLE PRECISION,
        refund_rate DOUBLE PRECISION, aov DOUBLE PRECISION,
        PRIMARY KEY (dt, shop_id)
    );
    CREATE TABLE IF NOT EXISTS {s}.dws_sales_sku_daily (
        dt DATE, sku VARCHAR,
        gmv DOUBLE PRECISION, units INT, refund_rate DOUBLE PRECISION,
        PRIMARY KEY (dt, sku)
    );

    -- 应用层:口径与数值分离
    CREATE TABLE IF NOT EXISTS {s}.ads_metric_def (
        metric_code VARCHAR PRIMARY KEY,
        metric_name VARCHAR NOT NULL,
        formula VARCHAR,
        unit VARCHAR,
        direction VARCHAR DEFAULT 'up'   -- up=越高越好 / down=越低越好
    );
    CREATE TABLE IF NOT EXISTS {s}.ads_metric_snapshot (
        dt DATE, metric_code VARCHAR, dim_type VARCHAR, dim_value VARCHAR,
        value DOUBLE PRECISION, mom DOUBLE PRECISION, yoy DOUBLE PRECISION,
        PRIMARY KEY (dt, metric_code, dim_type, dim_value)
    );
    CREATE TABLE IF NOT EXISTS {s}.ads_anomaly (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        dt DATE, metric_code VARCHAR, dim_type VARCHAR, dim_value VARCHAR,
        level VARCHAR, rule VARCHAR, detail VARCHAR,
        handled BOOLEAN DEFAULT FALSE
    );

    -- 本体镜像:与本体图谱保持一致
    CREATE TABLE IF NOT EXISTS {s}.ont_object (
        id BIGINT PRIMARY KEY,
        category VARCHAR, otype VARCHAR, name VARCHAR,
        attributes JSONB DEFAULT '{{}}'::jsonb,
        synced_at TIMESTAMP DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS {s}.ont_relation (
        id BIGINT PRIMARY KEY,
        source_id BIGINT, target_id BIGINT, label VARCHAR,
        synced_at TIMESTAMP DEFAULT now()
    );

    -- 业务对象动作留痕
    CREATE TABLE IF NOT EXISTS {s}.biz_object_event (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        ts TIMESTAMP DEFAULT now(),
        trace_id VARCHAR,
        object_type VARCHAR, object_id VARCHAR,
        action VARCHAR, decision VARCHAR,
        from_state VARCHAR, to_state VARCHAR,
        operator_role VARCHAR,
        payload JSONB DEFAULT '{{}}'::jsonb
    );
    """

    def init_schema(self):
        with self.connect() as con:
            con.cursor().execute(self.DDL.format(s=self.schema))
            con.commit()

    # ---------------- 种子数据(幂等) ----------------

    def seed(self):
        with self.connect() as con:
            cur = con.cursor()
            cur.execute("SELECT COUNT(*) FROM dim_shop")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    """
                    INSERT INTO dim_shop VALUES
                    ('S001','天猫旗舰店','tmall','品牌A','operator'),
                    ('S002','抖音小店','douyin','品牌B','operator')
                    """
                )
            cur.execute("SELECT COUNT(*) FROM dim_product")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    """
                    INSERT INTO dim_product VALUES
                    ('SKU-1001','SPU-100','连衣裙-经典款','服饰','品牌A',80,200),
                    ('SKU-1002','SPU-100','连衣裙-新色','服饰','品牌A',85,210),
                    ('SKU-2001','SPU-200','防晒霜 50ml','美妆','品牌B',60,199)
                    """
                )
            cur.execute("SELECT COUNT(*) FROM dim_date")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    """
                    INSERT INTO dim_date
                    SELECT d::date,
                           EXTRACT(YEAR FROM d)::int, EXTRACT(QUARTER FROM d)::int,
                           EXTRACT(MONTH FROM d)::int, EXTRACT(WEEK FROM d)::int,
                           FALSE
                    FROM generate_series('2026-07-01'::date, '2026-07-31'::date, '1 day') AS d
                    """
                )
            cur.execute("SELECT COUNT(*) FROM dwd_sales_detail")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    """
                    INSERT INTO dwd_sales_detail
                        (dt, shop_id, sku, gmv, orders, units, refund_amt, refund_orders, src)
                    VALUES
                    ('2026-07-06','S001','SKU-1001',152000,760,780,2900,15,'seed'),
                    ('2026-07-06','S002','SKU-2001',198000,990,1050,7600,40,'seed'),
                    ('2026-07-07','S001','SKU-1001',128000,640,655,3200,17,'seed'),
                    ('2026-07-07','S001','SKU-1002', 86000,430,440,1500, 8,'seed'),
                    ('2026-07-07','S002','SKU-2001',204000,1020,1090,8800,46,'seed')
                    """
                )
            cur.execute("SELECT COUNT(*) FROM ads_metric_def")
            if cur.fetchone()[0] == 0:
                cur.execute(
                    """
                    INSERT INTO ads_metric_def VALUES
                    ('gmv','GMV','SUM(gmv)','元','up'),
                    ('refund_rate','退款率','SUM(refund_amt)/SUM(gmv)','比率','down'),
                    ('aov','客单价','SUM(gmv)/SUM(orders)','元','up')
                    """
                )
            con.commit()

    # ---------------- 加工管道:DWD -> DWS -> ADS ----------------

    def run_pipeline(self):
        """重算汇总与指标(数据量小,采用整表重建,天然幂等)。"""
        with self.connect() as con:
            cur = con.cursor()
            cur.execute("TRUNCATE dws_sales_shop_daily")
            cur.execute(
                """
                INSERT INTO dws_sales_shop_daily
                SELECT dt, shop_id, SUM(gmv), SUM(orders), SUM(refund_amt),
                       CASE WHEN SUM(gmv)>0 THEN SUM(refund_amt)/SUM(gmv) ELSE 0 END,
                       CASE WHEN SUM(orders)>0 THEN SUM(gmv)/SUM(orders) ELSE 0 END
                FROM dwd_sales_detail GROUP BY dt, shop_id
                """
            )
            cur.execute("TRUNCATE dws_sales_sku_daily")
            cur.execute(
                """
                INSERT INTO dws_sales_sku_daily
                SELECT dt, sku, SUM(gmv), SUM(units),
                       CASE WHEN SUM(gmv)>0 THEN SUM(refund_amt)/SUM(gmv) ELSE 0 END
                FROM dwd_sales_detail GROUP BY dt, sku
                """
            )
            cur.execute("TRUNCATE ads_metric_snapshot")
            cur.execute(
                """
                WITH base AS (
                    SELECT dt, 'all' AS dim_type, '全站' AS dim_value,
                           SUM(gmv) AS gmv, SUM(orders) AS orders, SUM(refund_amt) AS refund
                    FROM dwd_sales_detail GROUP BY dt
                    UNION ALL
                    SELECT d.dt, 'shop', s.shop_name,
                           SUM(d.gmv), SUM(d.orders), SUM(d.refund_amt)
                    FROM dwd_sales_detail d JOIN dim_shop s ON s.shop_id = d.shop_id
                    GROUP BY d.dt, s.shop_name
                ),
                m AS (
                    SELECT dt, dim_type, dim_value, 'gmv' AS metric_code, gmv AS value FROM base
                    UNION ALL
                    SELECT dt, dim_type, dim_value, 'refund_rate',
                           CASE WHEN gmv>0 THEN refund/gmv ELSE 0 END FROM base
                    UNION ALL
                    SELECT dt, dim_type, dim_value, 'aov',
                           CASE WHEN orders>0 THEN gmv/orders ELSE 0 END FROM base
                )
                INSERT INTO ads_metric_snapshot
                SELECT dt, metric_code, dim_type, dim_value, value,
                       CASE WHEN prev IS NULL OR prev = 0 THEN NULL
                            ELSE (value - prev) / prev END AS mom,
                       NULL AS yoy
                FROM (
                    SELECT m.*, LAG(value) OVER (
                        PARTITION BY metric_code, dim_type, dim_value ORDER BY dt
                    ) AS prev FROM m
                ) t
                """
            )
            cur.execute("TRUNCATE ads_anomaly RESTART IDENTITY")
            cur.execute(
                """
                INSERT INTO ads_anomaly (dt, metric_code, dim_type, dim_value, level, rule, detail)
                SELECT s.dt, s.metric_code, s.dim_type, s.dim_value,
                       CASE WHEN ABS(s.mom) > 0.15 THEN 'critical'
                            WHEN ABS(s.mom) > 0.05 THEN 'warning'
                            ELSE 'info' END,
                       CASE WHEN d.direction = 'up' THEN 'mom < -0.03' ELSE 'mom > 0.03' END,
                       d.metric_name || '(' || s.dim_value || ')环比 '
                           || ROUND((s.mom * 100)::numeric, 1) || '%,方向不利,需关注'
                FROM ads_metric_snapshot s
                JOIN ads_metric_def d ON d.metric_code = s.metric_code
                WHERE s.mom IS NOT NULL AND (
                    (d.direction = 'up'   AND s.mom < -0.03) OR
                    (d.direction = 'down' AND s.mom >  0.03)
                )
                """
            )
            con.commit()

    # ---------------- 就绪保证 ----------------

    def ensure_ready(self):
        """建表 + 种子 + 首次跑管道,进程内只做一次。"""
        if self._ready:
            return
        with _lock:
            if self._ready:
                return
            self.init_schema()
            self.seed()
            self.run_pipeline()
            self._ready = True

    # ---------------- 本体同步:与本体图谱对象保持一致 ----------------

    def sync_ontology(self):
        """全量镜像 Django 侧本体对象/关系到 PG(图谱规模小,全量重写最简单可靠)。"""
        from apps.ontology.models import OntObject, OntRelation

        objs = list(OntObject.objects.all())
        rels = list(OntRelation.objects.all())
        with self.connect() as con:
            cur = con.cursor()
            cur.execute("TRUNCATE ont_relation")
            cur.execute("TRUNCATE ont_object")
            for o in objs:
                cur.execute(
                    "INSERT INTO ont_object (id, category, otype, name, attributes) "
                    "VALUES (%s,%s,%s,%s,%s)",
                    [o.id, o.category, o.otype, o.name, json.dumps(o.attributes or {})],
                )
            for r in rels:
                cur.execute(
                    "INSERT INTO ont_relation (id, source_id, target_id, label) "
                    "VALUES (%s,%s,%s,%s)",
                    [r.id, r.source_id, r.target_id, r.label],
                )
            con.commit()

    # ---------------- 动作留痕 ----------------

    def log_event(self, *, trace_id: str, object_type: str, action: str,
                  decision: str, operator_role: str, payload: dict,
                  object_id: str = "", from_state: str = "", to_state: str = ""):
        self.execute(
            "INSERT INTO biz_object_event "
            "(trace_id, object_type, object_id, action, decision, from_state, to_state, "
            " operator_role, payload) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [trace_id, object_type, object_id, action, decision,
             from_state, to_state, operator_role, json.dumps(payload, ensure_ascii=False)],
        )

    def ingest_jackyun(self, goods: list[dict], trades: list[dict]) -> dict:
        """把吉客云商品/日汇总写入 dim + dwd(src=jackyun),幂等 upsert。"""
        products = shops = sales = 0
        with self.connect() as con:
            cur = con.cursor()
            for g in goods:
                sku = g.get("sku") or ""
                if not sku:
                    continue
                cur.execute(
                    """
                    INSERT INTO dim_product
                        (sku, spu, product_name, category, brand, cost_price, list_price)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (sku) DO UPDATE SET
                        spu = EXCLUDED.spu,
                        product_name = EXCLUDED.product_name,
                        category = EXCLUDED.category,
                        brand = EXCLUDED.brand,
                        cost_price = EXCLUDED.cost_price,
                        list_price = EXCLUDED.list_price
                    """,
                    [
                        sku, g.get("spu") or "", g.get("product_name") or sku,
                        g.get("category") or "", g.get("brand") or "",
                        g.get("cost_price") or 0, g.get("list_price") or 0,
                    ],
                )
                products += 1
            for t in trades:
                shop_id = t.get("shop_id") or ""
                sku = t.get("sku") or ""
                if not shop_id or not sku:
                    continue
                cur.execute(
                    """
                    INSERT INTO dim_shop (shop_id, shop_name, platform, brand, owner_role)
                    VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT (shop_id) DO UPDATE SET
                        shop_name = EXCLUDED.shop_name,
                        platform = EXCLUDED.platform
                    """,
                    [
                        shop_id, t.get("shop_name") or shop_id,
                        t.get("platform") or "jackyun", "", "operator",
                    ],
                )
                shops += 1
                cur.execute(
                    """
                    INSERT INTO dim_date (dt, year, quarter, month, week, is_promo)
                    SELECT %s::date,
                           EXTRACT(YEAR FROM %s::date)::int,
                           EXTRACT(QUARTER FROM %s::date)::int,
                           EXTRACT(MONTH FROM %s::date)::int,
                           EXTRACT(WEEK FROM %s::date)::int,
                           FALSE
                    ON CONFLICT (dt) DO NOTHING
                    """,
                    [t["dt"], t["dt"], t["dt"], t["dt"], t["dt"]],
                )
                cur.execute(
                    """
                    DELETE FROM dwd_sales_detail
                    WHERE dt = %s::date AND shop_id = %s AND sku = %s AND src = 'jackyun'
                    """,
                    [t["dt"], shop_id, sku],
                )
                cur.execute(
                    """
                    INSERT INTO dwd_sales_detail
                        (dt, shop_id, sku, gmv, orders, units, refund_amt, refund_orders, src)
                    VALUES (%s::date,%s,%s,%s,%s,%s,%s,%s,'jackyun')
                    """,
                    [
                        t["dt"], shop_id, sku,
                        t.get("gmv") or 0, t.get("orders") or 0, t.get("units") or 0,
                        t.get("refund_amt") or 0, t.get("refund_orders") or 0,
                    ],
                )
                sales += 1
            con.commit()
        return {"products": products, "shops": shops, "sales": sales}

    def upsert_sku_inventory_mappings(
        self,
        mappings: list[dict],
        *,
        source: str = "jackyun_inventory",
        confidence: float = 1.0,
    ) -> int:
        """写入销售 SKU → 吉客云货号/条码映射；同一销售 SKU 幂等更新。"""
        written = 0
        with self.connect() as con:
            cur = con.cursor()
            for item in mappings:
                sales_sku = str(item.get("sales_sku") or "").strip()
                goods_no = str(item.get("goods_no") or "").strip()
                if not sales_sku or not goods_no:
                    continue
                cur.execute(
                    """
                    INSERT INTO dim_sku_inventory_map
                        (sales_sku, goods_no, sku_barcode, goods_name,
                         source, confidence, updated_at)
                    VALUES (%s,%s,%s,%s,%s,%s,now())
                    ON CONFLICT (sales_sku) DO UPDATE SET
                        goods_no = EXCLUDED.goods_no,
                        sku_barcode = EXCLUDED.sku_barcode,
                        goods_name = EXCLUDED.goods_name,
                        source = EXCLUDED.source,
                        confidence = EXCLUDED.confidence,
                        updated_at = now()
                    """,
                    [
                        sales_sku,
                        goods_no,
                        str(item.get("sku_barcode") or "").strip(),
                        str(item.get("goods_name") or "").strip(),
                        source,
                        float(item.get("confidence") or confidence),
                    ],
                )
                written += 1
            con.commit()
        return written

    def list_tables(self) -> list[dict]:
        rows = self.query(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = %s ORDER BY table_name",
            [self.schema],
        )
        result = []
        for r in rows:
            name = r["table_name"]
            cnt = self.query(f'SELECT COUNT(*) AS c FROM {self.schema}."{name}"')[0]["c"]
            result.append({"table": name, "rows": cnt})
        return result


class PgSession:
    """复用同一 psycopg2 连接的查询会话。"""

    def __init__(self, lake: PgLake, con):
        self.lake = lake
        self._con = con

    def query(self, sql: str, params: list | None = None) -> list[dict]:
        return self.lake._fetch(self._con, sql, params)


class AgePgLake(PgLake):
    """知识图谱 AGE 连接。

    业务库(POSTGRES_*) 与知识库可分主机：优先 AGE_POSTGRES_*，其余字段回退 POSTGRES_*。
    例如业务在 192.168.0.188、AGE 在 192.168.1.142。
    """

    def __init__(self):
        super().__init__()
        # AGE 查询走 public/ag_catalog，不强制 lake schema
        self.schema = "public"

    def enabled(self) -> bool:
        return bool(self._hosts() and self._conn_params().get("dbname"))

    def _hosts(self) -> list[str]:
        self._reload_env()
        out: list[str] = []
        for keys in (
            ("AGE_POSTGRES_HOST", "AGE_PG_HOST"),
            ("POSTGRES_HOST", "PG_HOST"),
            ("POSTGRES_HOST_FALLBACK", "PG_HOST_FALLBACK"),
        ):
            h = self._pg_env(*keys, default="").strip()
            if h and h not in out:
                out.append(h)
        return out

    def _conn_params(self) -> dict:
        self._reload_env()
        return {
            "port": int(
                self._pg_env(
                    "AGE_POSTGRES_PORT", "AGE_PG_PORT", "POSTGRES_PORT", "PG_PORT",
                    default=str(settings.PG_PORT),
                )
            ),
            "dbname": self._pg_env(
                "AGE_POSTGRES_DB", "AGE_PG_DB", "POSTGRES_DB", "PG_DB",
                default=settings.PG_DB,
            ),
            "user": self._pg_env(
                "AGE_POSTGRES_USER", "AGE_PG_USER", "POSTGRES_USER", "PG_USER",
                default=settings.PG_USER,
            ),
            "password": self._pg_env(
                "AGE_POSTGRES_PASSWORD", "AGE_PG_PASSWORD", "POSTGRES_PASSWORD", "PG_PASSWORD",
                default=settings.PG_PASSWORD,
            ),
        }

    def connect(self):
        p = self._conn_params()
        last_exc: Exception | None = None
        for host in self._hosts():
            try:
                # AGE 需要 ag_catalog；连接后由 age._prepare_age 再 LOAD/SET
                con = psycopg2.connect(
                    host=host,
                    port=p["port"],
                    dbname=p["dbname"],
                    user=p["user"],
                    password=p["password"],
                    connect_timeout=5,
                    options="-c search_path=ag_catalog,public",
                )
                self._active_host = host
                return con
            except Exception as exc:
                last_exc = exc
        self._active_host = ""
        if last_exc:
            raise last_exc
        raise RuntimeError("未配置 AGE_POSTGRES_HOST / POSTGRES_HOST")


pglake = PgLake()
age_pglake = AgePgLake()
