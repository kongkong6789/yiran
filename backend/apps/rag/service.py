"""
第2层 知识检索。

优先:AGE 图谱实体(LightRAG workspace) + Wiki 页面 + 内置 SOP 语料。
保留 retrieve(query) 接口,供编排层与圆桌知识卡复用。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Doc:
    doc_id: str
    kind: str      # sop / policy / plan / rule / entity / wiki
    title: str
    content: str


# 示例知识库(SOP / 制度 / 方案 / 业务规则)——始终作为兜底
CORPUS: list[Doc] = [
    Doc("sop-daily-report", "sop", "每日经营日报 SOP",
        "每天 09:00 拉取昨日 GMV、退款率、客单价指标快照,识别异常店铺,生成日报并发布。"),
    Doc("sop-price-change", "sop", "商品改价 SOP",
        "改价需先创建改价单(draft),经主管审批(approved)后方可应用到店铺后台;改价属高风险动作。"),
    Doc("policy-budget", "policy", "采购预算制度",
        "运营单笔采购不超过 1 万,主管不超过 10 万,总监不超过 100 万,超额需上级审批。"),
    Doc("rule-refund", "rule", "退款率预警规则",
        "单店退款率环比上升超过 0.3 个百分点触发预警,需核查售后与商品质量。"),
]


def _score_text(query: str, title: str, content: str) -> float:
    q = (query or "").lower()
    text = (title + " " + content).lower()
    if not q or not text:
        return 0.0
    score = 0.0
    # 整词/子串命中
    for token in set(q.replace("，", " ").replace(",", " ").split()):
        token = token.strip()
        if len(token) < 2:
            continue
        if token in text:
            score += 3.0 if token in title.lower() else 1.5
    # 中文双字
    hans = [ch for ch in q if "\u4e00" <= ch <= "\u9fff"]
    for i in range(len(hans) - 1):
        bg = hans[i] + hans[i + 1]
        if bg in text:
            score += 1.0
    return score


def _from_corpus(query: str, top_k: int) -> list[tuple[float, Doc]]:
    scored = []
    for d in CORPUS:
        s = _score_text(query, d.title, d.content)
        if s > 0:
            scored.append((s, d))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_k]


def _from_wiki(query: str, top_k: int) -> list[tuple[float, Doc]]:
    try:
        from apps.wiki.models import WikiPage
        pages = list(WikiPage.objects.all()[:80])
    except Exception:
        return []
    scored = []
    for p in pages:
        s = _score_text(query, p.title, p.content or "")
        if s > 0:
            scored.append((
                s,
                Doc(
                    doc_id=f"wiki-{p.kind}-{p.key}",
                    kind="wiki",
                    title=p.title,
                    content=(p.content or "")[:500],
                ),
            ))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_k]


def _from_age(query: str, top_k: int) -> list[tuple[float, Doc]]:
    try:
        from apps.council.graph_knowledge import search_graph
        hit = search_graph(query, top_k=top_k, max_edges=8)
    except Exception:
        return []
    refs = hit.get("refs") or []
    out = []
    for i, r in enumerate(refs):
        name = str(r.get("name") or "")
        otype = str(r.get("otype") or "实体")
        desc = str(r.get("description") or "")
        # search_graph 已按相关度排序,给递减分
        score = 12.0 - i
        out.append((
            score,
            Doc(
                doc_id=f"age-{r.get('id', i)}",
                kind="entity",
                title=f"[{otype}] {name}",
                content=desc or hit.get("card", "")[:300],
            ),
        ))
    return out


def retrieve(query: str, top_k: int = 5) -> list[dict]:
    """混合检索:AGE 实体 + Wiki + 内置 SOP,按分数合并去重。"""
    pool: list[tuple[float, Doc]] = []
    pool.extend(_from_age(query, top_k=top_k))
    pool.extend(_from_wiki(query, top_k=top_k))
    pool.extend(_from_corpus(query, top_k=top_k))
    pool.sort(key=lambda x: x[0], reverse=True)

    seen: set[str] = set()
    results = []
    for score, d in pool:
        if d.doc_id in seen:
            continue
        seen.add(d.doc_id)
        results.append({
            "doc_id": d.doc_id,
            "kind": d.kind,
            "title": d.title,
            "content": d.content,
            "score": round(score, 2),
        })
        if len(results) >= top_k:
            break
    return results
