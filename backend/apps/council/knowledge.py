"""
会议知识注入:让 Agent「带着资料」发言,而不是凭常识。

汇聚三路资料:
  - 第2层 RAG:检索相关 SOP / 制度 / 规则 / 方案文档;
  - 第1层 数据底座:拉取关键业务指标与异常预警(PG 优先,DuckDB 降级);
  - 第5层 本体图谱:围绕问题检索 AGE 图谱实体与关系子图。
拼成一张「资料卡」文本,注入到发言与方案生成的 prompt。
"""
from apps.rag.service import retrieve as rag_retrieve
from apps.datalake.service import ducklake
from apps.datalake.pg import pglake

from . import graph_knowledge


def _fmt_num(value, unit: str = "") -> str:
    """把数值格式化成业务可读文本，避免出现 4.18e+05 这种科学计数法。"""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return f"{value}{unit}"
    u = (unit or "").strip()
    # 比率/百分比类：保留小数，不做万元换算
    if u in ("比率", "率", "%") or (-1 <= v <= 1 and v != int(v)):
        if u in ("%",):
            return f"{v:.2f}%"
        return f"{v:.4f}".rstrip("0").rstrip(".") + u
    av = abs(v)
    if av >= 1_0000_0000:
        return f"{v / 1_0000_0000:.2f}".rstrip("0").rstrip(".") + "亿" + u
    if av >= 1_0000:
        return f"{v / 1_0000:.2f}".rstrip("0").rstrip(".") + "万" + u
    if v == int(v):
        return f"{int(v):,}{u}"
    return f"{v:,.2f}{u}"


def _safe_query(sql: str) -> list[dict]:
    """查询 DuckDB;若表不存在则尝试 seed 后重试。"""
    try:
        return ducklake.query(sql)
    except Exception:
        try:
            ducklake.seed()
            return ducklake.query(sql)
        except Exception:
            return []


def _pg_ready() -> bool:
    if not pglake.available():
        return False
    try:
        pglake.ensure_ready()
        return True
    except Exception:
        return False


def _metrics_rows() -> list[dict]:
    """结构化指标行,供 Excel/HTML 报告使用。"""
    if _pg_ready():
        try:
            return pglake.query(
                """
                SELECT s.dt, d.metric_name, d.metric_code, d.formula, d.unit,
                       s.dim_type, s.dim_value, s.value, s.mom, s.yoy
                FROM ads_metric_snapshot s
                JOIN ads_metric_def d ON d.metric_code = s.metric_code
                ORDER BY s.dt DESC, d.metric_code, s.dim_type, s.dim_value
                LIMIT 30
                """
            )
        except Exception:
            pass
    return _safe_query(
        "SELECT dt, metric AS metric_name, dim AS dim_value, value, mom, yoy "
        "FROM metric_snapshot ORDER BY dt DESC LIMIT 20"
    )


def _anomaly_rows() -> list[dict]:
    if _pg_ready():
        try:
            return pglake.query(
                """
                SELECT a.dt, a.dim_value, d.metric_name, a.level, a.rule, a.detail
                FROM ads_anomaly a
                JOIN ads_metric_def d ON d.metric_code = a.metric_code
                ORDER BY a.dt DESC LIMIT 15
                """
            )
        except Exception:
            pass
    return _safe_query(
        "SELECT dt, scope AS dim_value, metric AS metric_name, level, detail "
        "FROM anomaly ORDER BY dt DESC LIMIT 10"
    )


def _metrics_block() -> str:
    """关键指标:优先 PG(带统一口径),降级 DuckDB。"""
    if _pg_ready():
        try:
            rows = _metrics_rows()[:9]
            if rows:
                lines = [
                    f"- {r['metric_name']}({r['dim_value']},{r['dt']}):"
                    f"值={_fmt_num(r['value'], r['unit'] or '')}"
                    + (f",环比={r['mom']:+.1%}" if r["mom"] is not None else "")
                    + f"(口径:{r['formula']})"
                    for r in rows
                ]
                return "【关键业务指标(PostgreSQL·统一口径)】\n" + "\n".join(lines)
        except Exception:
            pass
    metrics = _safe_query(
        "SELECT metric, dim, value, mom, yoy FROM metric_snapshot ORDER BY dt DESC LIMIT 6"
    )
    if not metrics:
        return ""
    lines = [
        f"- {m['metric']}({m['dim']}):值={m['value']},环比={m['mom']},同比={m['yoy']}"
        for m in metrics
    ]
    return "【关键业务指标(DuckDB)】\n" + "\n".join(lines)


def _anomaly_block() -> str:
    """异常预警:优先 PG(带触发规则),降级 DuckDB。"""
    if _pg_ready():
        try:
            rows = _anomaly_rows()[:5]
            if rows:
                lines = [
                    f"- [{r['level']}] {r['dim_value']} · {r['metric_name']}:"
                    f"{r['detail']}(规则:{r['rule']})"
                    for r in rows
                ]
                return "【异常预警(PostgreSQL)】\n" + "\n".join(lines)
        except Exception:
            pass
    anomalies = _safe_query(
        "SELECT scope, metric, level, detail FROM anomaly ORDER BY dt DESC LIMIT 5"
    )
    if not anomalies:
        return ""
    lines = [
        f"- [{a['level']}] {a['scope']} · {a['metric']}:{a['detail']}"
        for a in anomalies
    ]
    return "【异常预警(DuckDB)】\n" + "\n".join(lines)


def _orders_block(question: str) -> str:
    """问订单/销量时，补充销售明细事实（业务库）。"""
    q = (question or "").lower()
    if not any(k in q for k in ("订单", "下单", "销量", "销售明细", "gmv", "sales")):
        return ""
    if not _pg_ready():
        return ""
    try:
        rows = pglake.query(
            """
            SELECT d.dt, COALESCE(s.shop_name, d.shop_id) AS shop,
                   d.sku, COALESCE(p.product_name, d.sku) AS product,
                   d.gmv, d.orders, d.units, d.refund_amt
            FROM dwd_sales_detail d
            LEFT JOIN dim_shop s ON s.shop_id = d.shop_id
            LEFT JOIN dim_product p ON p.sku = d.sku
            ORDER BY d.dt DESC, d.gmv DESC
            LIMIT 12
            """
        )
    except Exception:
        return ""
    if not rows:
        return ""
    lines = [
        f"- {r['dt']} · {r['shop']} · {r['product']}({r['sku']}):"
        f"订单={r['orders']}笔,件数={r['units']},GMV={_fmt_num(r['gmv'])},退款={_fmt_num(r['refund_amt'])}"
        for r in rows
    ]
    return "【订单/销售明细(PostgreSQL·dwd_sales_detail)】\n" + "\n".join(lines)


def _inventory_block(question: str) -> str:
    """库存意图：当前库无独立库存快照时明确告知，避免模型瞎编。"""
    q = (question or "").lower()
    if not any(k in q for k in ("库存", "在库", "在途", "warehouse", "inventory", "stock")):
        return ""
    if not _pg_ready():
        return "【库存】当前未接入库存快照表，无法给出在库数量。"
    try:
        tables = {
            r["table_name"]
            for r in pglake.query(
                """
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = current_schema()
                """
            )
        }
    except Exception:
        tables = set()
    for name in ("dwd_inventory_snapshot", "inventory_snapshot", "stock_snapshot"):
        if name in tables:
            try:
                rows = pglake.query(
                    f"""
                    SELECT * FROM {name}
                    ORDER BY 1 DESC
                    LIMIT 10
                    """
                )
            except Exception:
                rows = []
            if rows:
                keys = list(rows[0].keys())[:6]
                lines = [
                    "- " + ", ".join(f"{k}={r.get(k)}" for k in keys)
                    for r in rows
                ]
                return f"【库存快照(PostgreSQL·{name})】\n" + "\n".join(lines)
    return (
        "【库存】DataLake 尚未接入库存快照表"
        "（期望 dwd_inventory_snapshot / inventory_snapshot）。"
        "请先同步库存数据；当前仅有销售明细与指标，不能代替库存数量。"
    )


def gather_knowledge(question: str, top_k: int = 3) -> str:
    """围绕会议问题汇聚 RAG + 数据底座 + 本体图谱资料,返回可直接注入 prompt 的文本(无资料返回空串)。"""
    blocks: list[str] = []

    # 第2层 RAG:制度 / SOP / 规则 / 方案
    docs = rag_retrieve(question, top_k=top_k)
    if docs:
        lines = [f"- [{d['kind']}] {d['title']}:{d['content']}" for d in docs]
        blocks.append("【制度/SOP/规则(RAG 检索)】\n" + "\n".join(lines))

    # 第5层 本体图谱:相关实体与关系子图(AGE)
    gb = graph_knowledge.search_graph(question).get("card")
    if gb:
        blocks.append(gb)

    # 业务意图：回路上卷计算（按渠道/平台/品牌汇总销售额）
    from .loop_rollup import rollup_block
    rb = rollup_block(question)
    if rb:
        blocks.append(rb)

    # 业务意图：订单 / 库存
    ob = _orders_block(question)
    if ob:
        blocks.append(ob)
    ib = _inventory_block(question)
    if ib:
        blocks.append(ib)

    # 第1层 数据底座:关键指标(PG 优先,带口径)
    mb = _metrics_block()
    if mb:
        blocks.append(mb)

    # 第1层 数据底座:异常预警
    ab = _anomaly_block()
    if ab:
        blocks.append(ab)

    return "\n\n".join(blocks)


def fetch_metrics_rows() -> list[dict]:
    return _metrics_rows()


def fetch_anomaly_rows() -> list[dict]:
    return _anomaly_rows()
