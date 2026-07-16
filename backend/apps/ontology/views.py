from rest_framework.decorators import api_view
from rest_framework.response import Response

from .registry import OBJECTS, ROLE_BUDGET, list_actions
from .commerce_schema import schema_payload
from .models import OntObject, OntRelation


@api_view(["GET"])
def objects(request):
    return Response({"objects": OBJECTS, "role_budget": ROLE_BUDGET})


@api_view(["GET"])
def actions(request):
    return Response({"count": len(list_actions()), "results": list_actions()})


@api_view(["GET"])
def commerce_schema(request):
    """电商经营对象/关系/回路层级契约（知行一期迁入）+ 样例包含链摘要。"""
    payload = schema_payload()
    samples = list(
        OntObject.objects.filter(attributes__commerce_seed=True)
        .order_by("id")
        .values("id", "otype", "name", "category", "attributes")[:50]
    )
    sample_ids = [s["id"] for s in samples]
    contain_rels = []
    if sample_ids:
        contain_rels = list(
            OntRelation.objects.filter(source_id__in=sample_ids, label__startswith="包含")
            .select_related("source", "target")
            .order_by("id")
            .values(
                "id",
                "label",
                "source_id",
                "target_id",
                "source__name",
                "source__otype",
                "target__name",
                "target__otype",
            )[:40]
        )
    payload["samples"] = {
        "objects": samples,
        "contain_relations": [
            {
                "id": r["id"],
                "label": r["label"],
                "source": f"{r['source__otype']}·{r['source__name']}",
                "target": f"{r['target__otype']}·{r['target__name']}",
            }
            for r in contain_rels
        ],
    }
    payload["fusion"] = {
        "name": "知行经营中枢 → 良策",
        "source_path": r"D:\test\a2a-ecommerce-workbench",
        "phase": 5,
        "phase_title": "一期～五期已挂入「经营融合」工作台",
        "done": [
            "一期：电商对象类型与包含链",
            "二期：事实层健康 + 连接器对齐（/api/commerce/facts/health/）",
            "三期：Stock–Flow 仿真 What-if（/api/commerce/loops/simulate/）",
            "四期：证据图 / 治理 / 经营评审",
            "五期：经营 Agent 目录（旁路对话）",
            "前端入口：能力 → 经营融合",
        ],
        "pending": [
            "后续：LangGraph 进程旁路热插拨",
            "后续：校准预测与蒙特卡洛灵敏度",
            "后续：ERP 写回真审批闭环联调",
        ],
    }
    return Response(payload)
