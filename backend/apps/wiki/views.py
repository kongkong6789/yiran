from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import WikiPage

SEED_PAGES = [
    ("brand", "brand-a", "品牌A 概览", "品牌A 主营天猫旗舰店,近30天 GMV 稳定,主推 SKU-1001。"),
    ("shop", "tmall-flagship", "天猫旗舰店", "核心店铺,7/7 GMV 环比 -6%,需关注。"),
    ("sku", "SKU-1001", "SKU-1001 商品页", "爆款单品,建议维持价格,关注退款率。"),
    ("flow", "daily-report", "每日日报流程", "拉数 → 识别异常 → 生成日报 → 发布。"),
    ("metric", "gmv", "GMV 指标页", "全站成交额,日更,环比/同比监控。"),
]


def _ensure_seed():
    if WikiPage.objects.exists():
        return
    for kind, key, title, content in SEED_PAGES:
        WikiPage.objects.create(kind=kind, key=key, title=title, content=content)


@api_view(["GET"])
def pages(request):
    _ensure_seed()
    kind = request.query_params.get("kind")
    qs = WikiPage.objects.all()
    if kind:
        qs = qs.filter(kind=kind)
    data = [
        {
            "id": p.id,
            "kind": p.kind,
            "kind_display": p.get_kind_display(),
            "key": p.key,
            "title": p.title,
            "content": p.content,
            "updated_at": p.updated_at.isoformat(),
        }
        for p in qs
    ]
    return Response({"count": len(data), "results": data})
