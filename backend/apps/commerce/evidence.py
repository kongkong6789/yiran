"""四期：经营证据图谱（自本体样例 + 回路/因果边投影）。"""
from __future__ import annotations

from apps.ontology.models import OntObject, OntRelation


def build_evidence_graph(*, limit: int = 200) -> dict:
    nodes: list[dict] = []
    edges: list[dict] = []

    objs = list(
        OntObject.objects.filter(attributes__commerce_seed=True).order_by("id")[: limit // 2]
    )
    if len(objs) < 5:
        objs = list(OntObject.objects.order_by("-id")[: min(40, limit // 2)])

    for o in objs:
        type_key = (o.attributes or {}).get("type_key") or o.otype
        nodes.append({
            "id": f"obj:{o.id}",
            "type": str(type_key),
            "label": f"{o.otype}·{o.name}",
            "summary": (o.attributes or {}).get("loop_level") or o.category,
            "risk_level": "low",
            "metadata": {"ont_id": o.id, "category": o.category},
        })

    ids = {o.id for o in objs}
    rels = (
        OntRelation.objects.filter(source_id__in=ids)
        .select_related("source", "target")
        .order_by("id")[:limit]
    )
    for r in rels:
        if r.target_id not in ids:
            continue
        edges.append({
            "id": f"rel:{r.id}",
            "source": f"obj:{r.source_id}",
            "target": f"obj:{r.target_id}",
            "type": r.label or "关联",
            "polarity": r.polarity or "",
            "label": r.label,
        })

    # 回路参与（示范节点）
    nodes.append({
        "id": "loop:company_8",
        "type": "FeedbackLoop",
        "label": "系统回路·公司层8Stock",
        "summary": "R 增长 / B 约束 / 资源反馈",
        "risk_level": "medium",
        "metadata": {"model_id": "company_8_stock"},
    })
    for o in objs:
        if (o.attributes or {}).get("loop_level") in ("company", "brand", "sku"):
            edges.append({
                "id": f"pl:{o.id}",
                "source": f"obj:{o.id}",
                "target": "loop:company_8",
                "type": "participates_in_loop",
                "polarity": "",
                "label": "参与回路",
            })

    return {
        "schema": "liangce_commerce_evidence_graph_v1",
        "source": "ontology+commerce_seed",
        "nodes": nodes[:limit],
        "edges": edges[:limit],
        "counts": {"nodes": len(nodes), "edges": len(edges)},
        "warnings": [] if objs else ["暂无本体对象，请先运行 seed_commerce_ontology"],
    }
