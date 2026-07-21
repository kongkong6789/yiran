from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

import json

from apps.datalake.pg import pglake

from .base import list_connectors
from .jackyun import (
    jackyun_configured,
    jackyun_status,
    query_by_plan,
    query_inventory,
    sync_to_datalake,
    JackyunError,
)
from .kingdee import kingdee_status


@api_view(["GET"])
def connectors(request):
    data = list_connectors()
    from .kingdee import kingdee_configured
    return Response({
        "count": len(data),
        "results": data,
        "jackyun_configured": jackyun_configured(),
        "kingdee_configured": kingdee_configured(),
    })


@api_view(["POST"])
def jackyun_sync(request):
    """只读同步吉客云商品/订单到 DataLake,并重跑指标管道。"""
    try:
        result = sync_to_datalake()
        return Response(result)
    except Exception as exc:
        return Response(
            {"ok": False, "error": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


@api_view(["GET"])
def jackyun_connection_status(request):
    """返回签名登录态；probe=1 时实际调用一条只读库存接口。"""
    probe = str(request.query_params.get("probe", "")).lower() in ("1", "true", "yes")
    result = jackyun_status(probe=probe)
    code = status.HTTP_200_OK
    if probe and result.get("reachable") is False:
        code = status.HTTP_502_BAD_GATEWAY
    return Response(result, status=code)


@api_view(["GET"])
def jackyun_inventory(request):
    """吉客云实时库存只读查询。"""
    try:
        result = query_inventory(
            goods_no=str(request.query_params.get("goods_no", "")),
            goods_name=str(request.query_params.get("goods_name", "")),
            warehouse_code=str(request.query_params.get("warehouse_code", "")),
            sku_barcode=str(request.query_params.get("sku_barcode", "")),
            page_index=int(request.query_params.get("page_index", 0)),
            page_size=int(request.query_params.get("page_size", 50)),
        )
        return Response(result)
    except (TypeError, ValueError):
        return Response(
            {"ok": False, "error": "page_index/page_size 必须是整数"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as exc:
        return Response(
            {"ok": False, "error": str(exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )


@api_view(["GET", "POST"])
def jackyun_sku_mappings(request):
    """查询或校验后写入「销售 SKU → 吉客云货号/条码」映射。"""
    pglake.init_schema()
    if request.method == "GET":
        rows = pglake.query(
            """
            SELECT sales_sku, goods_no, sku_barcode, goods_name,
                   source, confidence, updated_at
            FROM dim_sku_inventory_map
            ORDER BY updated_at DESC
            LIMIT 500
            """
        )
        return Response({"count": len(rows), "results": rows})

    sales_sku = str(request.data.get("sales_sku") or "").strip()
    goods_no = str(request.data.get("goods_no") or "").strip()
    sku_barcode = str(request.data.get("sku_barcode") or "").strip()
    if not sales_sku or not (goods_no or sku_barcode):
        return Response(
            {"ok": False, "error": "sales_sku 与 goods_no/sku_barcode 至少各填一项"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        result = query_inventory(
            goods_no=goods_no,
            sku_barcode=sku_barcode,
            page_size=50,
        )
    except Exception as exc:
        return Response(
            {"ok": False, "error": f"吉客云校验失败：{exc}"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    rows = result.get("results") or []
    if not rows:
        return Response(
            {"ok": False, "error": "吉客云未查到该货号/条码，未写入映射"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    first = rows[0]
    canonical_goods_no = str(first.get("goods_no") or goods_no).strip()
    canonical_barcode = str(first.get("sku_barcode") or sku_barcode).strip()
    pglake.upsert_sku_inventory_mappings(
        [{
            "sales_sku": sales_sku,
            "goods_no": canonical_goods_no,
            "sku_barcode": canonical_barcode,
            "goods_name": first.get("goods_name") or "",
        }],
        source="manual_verified",
        confidence=1.0,
    )
    return Response({
        "ok": True,
        "sales_sku": sales_sku,
        "goods_no": canonical_goods_no,
        "sku_barcode": canonical_barcode,
        "goods_name": first.get("goods_name") or "",
        "inventory_summary": result.get("summary") or {},
    })


@api_view(["GET", "POST"])
def jackyun_query(request):
    """通用只读查询：传 capability+params，或传 question 走规划器。"""
    data = request.data if request.method == "POST" else request.query_params
    question = str(data.get("question") or "").strip()
    capability = str(data.get("capability") or "").strip()
    params = data.get("params")
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except json.JSONDecodeError:
            return Response(
                {"ok": False, "error": "params 必须是 JSON 对象"},
                status=status.HTTP_400_BAD_REQUEST,
            )
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return Response(
            {"ok": False, "error": "params 必须是对象"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if question and not capability:
        from apps.council.jackyun_planner import format_jackyun_result, plan_jackyun_query

        plan = plan_jackyun_query(question, llm_user=getattr(request, "user", None))
        try:
            result = query_by_plan(plan["capability"], plan.get("params") or {})
        except JackyunError as exc:
            return Response(
                {"ok": False, "error": str(exc), "plan": plan},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:
            return Response(
                {"ok": False, "error": str(exc), "plan": plan},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({
            "ok": True,
            "plan": plan,
            "result": result,
            "block": format_jackyun_result(result, plan),
        })

    if not capability:
        from apps.connectors.jackyun_catalog import list_capabilities

        return Response({
            "ok": True,
            "capabilities": list_capabilities(),
            "hint": "传 capability+params，或传 question 自动规划",
        })

    try:
        result = query_by_plan(capability, params)
        return Response({"ok": True, "result": result})
    except JackyunError as exc:
        return Response(
            {"ok": False, "error": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as exc:
        return Response(
            {"ok": False, "error": str(exc)},
            status=status.HTTP_502_BAD_GATEWAY,
        )


@api_view(["GET"])
def kingdee_connection_status(request):
    """金蝶配置与登录探测；probe=1 时尝试 ValidateUser。"""
    probe = str(request.query_params.get("probe", "")).lower() in ("1", "true", "yes")
    result = kingdee_status(probe=probe)
    code = status.HTTP_200_OK
    if probe and result.get("reachable") is False:
        code = status.HTTP_502_BAD_GATEWAY
    return Response(result, status=code)
