"""吉客云通用查询规划：门控 → LLM 选能力+参数 → 执行 → 证据块。"""
from __future__ import annotations

import json
import re
from typing import Any

from apps.connectors.jackyun_catalog import CAPABILITIES, catalog_prompt_text

_GATE_KEYWORDS = (
    "库存", "在库", "在途", "warehouse", "inventory", "stock",
    "补货", "缺货", "断货", "备货", "安全库存", "可售",
    "订单", "交易", "发货", "出库", "退款单", "销售单",
    "商品", "货号", "条码", "sku", "barcode", "仓库", "仓编码",
    "吉客云", "jackyun",
)

_SKU_RE = re.compile(r"\b([A-Za-z]{2,8}-\d{2,}|\d{6,20})\b")
_SKU_KW_RE = re.compile(
    r"(?:货号|sku|商品编码|条码|barcode)\s*[:：]?\s*([a-zA-Z0-9._-]+)",
    flags=re.IGNORECASE,
)


def extract_goods_token(question: str) -> str:
    token = _SKU_RE.search(question or "")
    if token:
        return token.group(1)
    kw = _SKU_KW_RE.search(question or "")
    return kw.group(1).strip("-") if kw else ""


def should_query_jackyun(question: str) -> bool:
    q = (question or "").lower()
    if extract_goods_token(question):
        return True
    return any(k.lower() in q for k in _GATE_KEYWORDS)


def _heuristic_plan(question: str) -> dict[str, Any]:
    q = (question or "").lower()
    goods = extract_goods_token(question)
    params: dict[str, Any] = {"pageIndex": 0, "pageSize": 50}
    if goods:
        params["goodsNo"] = goods

    if any(k in q for k in ("订单", "交易", "发货", "出库", "退款单", "销售单", "trade")):
        return {"capability": "trades", "params": params, "reason": "启发式：订单/交易"}
    if any(k in q for k in ("仓库", "仓编码", "warehouse")) and not any(
        k in q for k in ("库存", "在库", "补货", "缺货", "inventory", "stock")
    ):
        return {"capability": "warehouse", "params": {"pageIndex": 0, "pageSize": 50}, "reason": "启发式：仓库"}
    if any(k in q for k in ("商品信息", "商品资料", "主数据", "档案", "价格", "成本")) or (
        any(k in q for k in ("商品", "货号", "条码"))
        and not any(k in q for k in ("库存", "补货", "缺货", "断货", "订单", "发货"))
    ):
        if goods:
            params["goodsNo"] = goods
        return {"capability": "goods", "params": params, "reason": "启发式：商品"}
    # 默认库存（含补货/缺货/纯货号）
    return {"capability": "inventory", "params": params, "reason": "启发式：库存/货号"}


def _parse_plan_json(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(data, dict):
        return None
    return data


def _sanitize_plan(data: dict[str, Any], question: str) -> dict[str, Any] | None:
    cid = str(data.get("capability") or data.get("id") or "").strip()
    if cid not in CAPABILITIES:
        return None
    params_in = data.get("params") if isinstance(data.get("params"), dict) else {}
    allowed = set(CAPABILITIES[cid]["params"].keys())
    params: dict[str, Any] = {}
    for k, v in params_in.items():
        if k in allowed and v is not None and v != "":
            params[k] = v
    # 模型漏填货号时，用问句 token 补上
    goods = extract_goods_token(question)
    if goods and "goodsNo" in allowed and not params.get("goodsNo") and not params.get("skuBarcode"):
        params["goodsNo"] = goods
    reason = str(data.get("reason") or "").strip() or "llm"
    return {"capability": cid, "params": params, "reason": reason}


def plan_jackyun_query(question: str, *, llm_user=None) -> dict[str, Any]:
    """返回 {capability, params, reason, source: llm|heuristic}。"""
    from apps.council import llm

    catalog = catalog_prompt_text()
    system = (
        "你是吉客云只读查询规划器。根据用户问题，从能力目录中选一个 capability，"
        "并给出 OpenAPI 业务参数。只输出 JSON，不要其它文字。\n"
        '格式：{"capability":"inventory|goods|trades|warehouse",'
        '"params":{...},"reason":"一句话"}\n'
        "规则：只能使用目录中的参数名；不要编造 method；"
        "若问题含货号/条码，优先填入 goodsNo 或 skuBarcode；"
        "pageSize 默认 50，最大 100。"
    )
    user = f"能力目录：\n{catalog}\n\n用户问题：\n{question}"
    try:
        result = llm.chat_messages_result(
            system,
            [{"role": "user", "content": user}],
            temperature=0,
            max_tokens=300,
            llm_user=llm_user,
        )
        parsed = _sanitize_plan(_parse_plan_json(result.get("content") or "") or {}, question)
        if parsed:
            parsed["source"] = "llm"
            return parsed
    except Exception:
        pass

    plan = _heuristic_plan(question)
    plan["source"] = "heuristic"
    return plan


def _format_inventory_block(result: dict, plan: dict) -> str:
    rows = result.get("results") or []
    summary = result.get("summary") or {}
    cid = plan.get("capability")
    reason = plan.get("reason") or ""
    source = plan.get("source") or ""
    header = (
        f"【吉客云·{cid}】method={result.get('method')}；"
        f"规划={source}/{reason}"
    )
    if not rows:
        goods = (plan.get("params") or {}).get("goodsNo") or ""
        if goods:
            return f"{header}\n- 货号/条码 `{goods}` 无库存记录。"
        return f"{header}\n- 查询成功，但当前筛选无记录。"
    lines = [
        f"- 本页 {len(rows)} 条：当前合计={summary.get('current_quantity', 0):g}，"
        f"可用={summary.get('available_quantity', 0):g}，"
        f"锁定={summary.get('locked_quantity', 0):g}，"
        f"采购在途={summary.get('purchasing_quantity', 0):g}",
    ]
    for r in rows[:12]:
        lines.append(
            "- "
            + f"{r.get('warehouse_name') or r.get('warehouse_code') or '未标注仓库'} · "
            + f"{r.get('goods_name') or r.get('goods_no') or '未标注货品'}"
            + (f"({r.get('goods_no')})" if r.get("goods_no") else "")
            + f"：当前={r.get('current_quantity', 0):g}，"
            + f"可用={r.get('available_quantity', 0):g}，"
            + f"锁定={r.get('locked_quantity', 0):g}，"
            + f"采购在途={r.get('purchasing_quantity', 0):g}"
        )
    lines.append("- 说明：实时接口当前页结果，不等同于历史库存快照。")
    return header + "\n" + "\n".join(lines)


def _format_generic_block(result: dict, plan: dict) -> str:
    cid = plan.get("capability")
    reason = plan.get("reason") or ""
    source = plan.get("source") or ""
    rows = result.get("results") or []
    header = (
        f"【吉客云·{cid}】method={result.get('method')}；"
        f"规划={source}/{reason}；命中约 {result.get('count', 0)} 条"
    )
    if not rows:
        return f"{header}\n- 查询成功，但当前筛选无记录。"
    lines = []
    for row in rows[:15]:
        if not isinstance(row, dict):
            lines.append(f"- {row}")
            continue
        # 优先展示常见业务字段
        preferred = (
            "goodsNo", "goodsName", "sku", "skuName", "warehouseName",
            "tradeNo", "shopName", "qty", "amount", "status",
            "warehouseCode", "warehouse_name", "goods_no", "goods_name",
        )
        parts = []
        for key in preferred:
            if key in row and row[key] not in (None, ""):
                parts.append(f"{key}={row[key]}")
        if not parts:
            for key, val in list(row.items())[:6]:
                if val not in (None, ""):
                    parts.append(f"{key}={val}")
        lines.append("- " + ", ".join(parts))
    return header + "\n" + "\n".join(lines)


def format_jackyun_result(result: dict, plan: dict) -> str:
    if plan.get("capability") == "inventory":
        return _format_inventory_block(result, plan)
    return _format_generic_block(result, plan)


def jackyun_block(question: str, *, llm_user=None) -> str:
    """门控 → 规划 → 执行 → 文本证据块；未命中或未配置返回空串。"""
    if not should_query_jackyun(question):
        return ""
    try:
        from apps.connectors.jackyun import jackyun_configured, query_by_plan, JackyunError
    except Exception:
        return ""
    if not jackyun_configured():
        return "【吉客云】未配置 JACKYUN_APP_KEY / JACKYUN_APP_SECRET，跳过实时查询。"

    plan = plan_jackyun_query(question, llm_user=llm_user)
    try:
        result = query_by_plan(plan["capability"], plan.get("params") or {})
    except JackyunError as exc:
        return (
            f"【吉客云·{plan.get('capability')}】查询失败：{exc}\n"
            f"- 规划来源={plan.get('source')}：{plan.get('reason')}"
        )
    except Exception as exc:
        return f"【吉客云】查询异常：{exc}"
    return format_jackyun_result(result, plan)
