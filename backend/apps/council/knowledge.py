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
                    f"值={r['value']:.4g}{r['unit'] or ''}"
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
