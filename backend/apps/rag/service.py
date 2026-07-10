"""
第2层 LightRAG 图谱检索(骨架)。

当前用轻量关键词检索占位,保留 retrieve 接口。
未来替换为 LightRAG:构建实体-关系图谱,支持 local/global/hybrid 检索。
"""
from dataclasses import dataclass


@dataclass
class Doc:
    doc_id: str
    kind: str      # sop / policy / plan / rule
    title: str
    content: str


# 示例知识库(SOP / 制度 / 方案 / 业务规则)
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


def retrieve(query: str, top_k: int = 3) -> list[dict]:
    """朴素关键词打分检索。"""
    q = query.lower()
    scored = []
    for d in CORPUS:
        text = (d.title + d.content).lower()
        score = sum(1 for ch in set(q) if ch.strip() and ch in text)
        if score:
            scored.append((score, d))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [
        {"doc_id": d.doc_id, "kind": d.kind, "title": d.title, "content": d.content, "score": s}
        for s, d in scored[:top_k]
    ]
