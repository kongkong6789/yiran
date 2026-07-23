from __future__ import annotations

from copy import deepcopy
import json
import re

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.organizations import ensure_current_organization, is_organization_admin
from apps.council import llm
from apps.ontology.registry import get_action, list_actions

from .models import SopDefinition, SopVersion
from .sop_schema import graph_hash, validate_graph


def _available_catalog(organization) -> dict:
    """Assets + actions the editor/AI can bind."""
    from apps.datalake.models import SourceSnapshot

    actions = list_actions()
    assets: list[dict] = []
    seen: set[str] = set()
    rows = (
        SourceSnapshot.objects.filter(organization=organization)
        .order_by("-as_of", "-id")[:120]
    )
    for row in rows:
        scope = row.scope if isinstance(row.scope, dict) else {}
        asset_key = str(scope.get("asset_key") or row.source_system or row.snapshot_key or "").strip()
        if not asset_key or asset_key in seen:
            continue
        seen.add(asset_key)
        display = str(scope.get("display_name") or "").strip() or asset_key
        assets.append({
            "asset_key": asset_key,
            "display_name": display,
            "snapshot_id": row.id,
            "as_of": row.as_of.isoformat() if row.as_of else None,
            "row_count": row.row_count or 0,
            "governance_status": row.governance_status,
        })
    return {"availableActions": actions, "availableAssets": assets}


def _pick_action_name(text: str, *, fallback: str = "", actions: list[dict] | None = None) -> str:
    blob = text or ""
    catalog = actions or list_actions()
    names = {str(item.get("name") or "") for item in catalog}

    def ok(name: str) -> str:
        return name if name and (name in names or get_action(name)) else ""

    if any(word in blob for word in ("库存", "补货", "缺货")):
        for name in ("inventory.reorder.shadow", "inventory.risk_scan"):
            if ok(name):
                return name
    if any(word in blob for word in ("吉客云", "jackyun", "同步")):
        if ok("jackyun.sync"):
            return "jackyun.sync"
    if any(word in blob for word in ("采购", "下单")):
        if ok("purchase.create"):
            return "purchase.create"
    if any(word in blob for word in ("改价", "调价")):
        if ok("price_change.apply"):
            return "price_change.apply"
    if any(word in blob for word in ("周报", "报告", "分析", "经营", "销售")):
        if ok("report.generate"):
            return "report.generate"
    if ok(fallback):
        return fallback
    if ok("report.generate"):
        return "report.generate"
    return next((str(item.get("name") or "") for item in catalog if item.get("name")), "")


def _pick_assets(text: str, assets: list[dict]) -> list[dict]:
    if not assets:
        return []
    blob = (text or "").lower()
    rules = [
        (("销售", "天猫", "周报", "成交", "gmv", "sales"), ("sales", "销售", "ledger", "shop_daily", "sku_daily")),
        (("库存", "补货", "缺货", "inventory"), ("inventory", "库存", "sku_mapping")),
        (("店铺", "shop"), ("shop", "店铺")),
        (("商品", "product", "sku"), ("product", "商品", "sku")),
        (("指标", "metric"), ("metric", "指标")),
    ]
    picked: list[dict] = []
    for keywords, needles in rules:
        if not any(word in blob or word in (text or "") for word in keywords):
            continue
        for asset in assets:
            hay = f"{asset.get('asset_key', '')} {asset.get('display_name', '')}".lower()
            if any(str(needle).lower() in hay for needle in needles):
                if asset not in picked:
                    picked.append(asset)
    if not picked:
        for asset in assets:
            hay = f"{asset.get('asset_key', '')} {asset.get('display_name', '')}".lower()
            if "sales" in hay or "销售" in hay:
                picked.append(asset)
                break
    if not picked:
        picked = assets[:1]
    return picked[:3]


def _bindings_empty(bindings: dict | None) -> bool:
    data = bindings if isinstance(bindings, dict) else {}
    return not (data.get("snapshot_ids") or data.get("asset_keys") or data.get("metric_ids"))


def _autofill_graph_bindings(
    graph: dict,
    *,
    assets: list[dict],
    actions: list[dict],
    instruction: str = "",
    draft_action: str = "",
) -> dict:
    """Fill empty enterprise-data / action bindings after AI or local rewrite."""
    next_graph = deepcopy(graph)
    text = instruction or ""
    for node in next_graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        node_type = str(node.get("type") or "")
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        title = str(node.get("title") or "")
        hint = f"{text} {title} {config.get('instruction') or ''}"

        if node_type in {"data_bind", "execute_action", "collect_info"} and _bindings_empty(config.get("data_bindings")):
            # collect_info usually doesn't need data, but AI often puts data step as data_bind/execute
            if node_type == "collect_info" and "数据" not in hint and "销售" not in hint and "库存" not in hint:
                pass
            else:
                picked = _pick_assets(hint, assets)
                if picked:
                    config["data_bindings"] = {
                        "snapshot_ids": [int(item["snapshot_id"]) for item in picked if item.get("snapshot_id")],
                        "metric_ids": [],
                        "asset_keys": [str(item["asset_key"]) for item in picked],
                        "scope": str((config.get("data_bindings") or {}).get("scope") or ""),
                        "brand_ids": list((config.get("data_bindings") or {}).get("brand_ids") or []),
                    }

        if node_type in {"execute_action", "gate"}:
            action_name = str(config.get("action_name") or "").strip()
            if not action_name or not get_action(action_name):
                action_name = _pick_action_name(hint, fallback=draft_action, actions=actions)
                config["action_name"] = action_name
            allowed = [str(item) for item in (config.get("allowed_actions") or [])]
            token = f"call_action:{action_name}" if action_name else ""
            allowed = [item for item in allowed if not str(item).startswith("call_action:") or item == token]
            if token and token not in allowed:
                allowed.append(token)
            if "continue_flow" not in allowed:
                allowed.append("continue_flow")
            config["allowed_actions"] = allowed
            # Prefer human title for execute nodes when still generic.
            action = get_action(action_name)
            if action and (not title or title in {"执行动作", "执行周报动作", "生成业务结果", "新流程节点"}):
                node["title"] = action.title

        if node_type == "data_bind" and (not title or title in {"选用企业数据", "绑定企业可信数据", "新流程节点"}):
            keys = ((config.get("data_bindings") or {}).get("asset_keys") or [])
            if keys:
                node["title"] = "选用企业销售数据" if any("sales" in str(k).lower() or "销售" in str(k) for k in keys) else "选用企业可信数据"

        node["config"] = config
    return _normalize_node_actions(next_graph, draft_action)


def _extract_json_object(text: str) -> dict:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if not match:
            raise ValueError("AI 未返回可解析的 SOP 结构。")
        value = json.loads(match.group(0))
    if not isinstance(value, dict):
        raise ValueError("AI 返回的 SOP 结构必须是 JSON 对象。")
    return value


def _fallback_node_rewrite(instruction: str, draft: dict, target_key: str) -> dict:
    """无 LLM 时，仅改写选中节点的说明/类型。"""
    result = deepcopy(draft)
    graph = deepcopy(result.get("graph") or {})
    nodes = list(graph.get("nodes") or [])
    found = False
    for node in nodes:
        if str(node.get("key") or "") != target_key:
            continue
        found = True
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        config = {
            **config,
            "instruction": instruction[:800],
            "detail": instruction[:800],
            "message": instruction[:800],
        }
        if any(word in instruction for word in ("人工确认", "审批", "复核")):
            node["type"] = "checkpoint"
            node["title"] = "人工确认"
            config["allowed_actions"] = ["confirm", "ask_user", "continue_flow"]
        elif any(word in instruction for word in ("知识库", "查资料", "检索")):
            node["type"] = "knowledge_query"
            node["title"] = node.get("title") or "检索业务知识"
            config["allowed_actions"] = ["query_knowledge", "continue_flow"]
        elif any(word in instruction for word in ("企业数据", "销售", "库存", "绑定数据")):
            node["type"] = "data_bind"
            node["title"] = node.get("title") or "选用企业数据"
            config["allowed_actions"] = ["continue_flow"]
        elif any(word in instruction for word in ("转人工", "兜底", "异常")):
            node["type"] = "handoff"
            node["title"] = node.get("title") or "转人工处理"
            config["allowed_actions"] = ["handoff_human"]
        node["config"] = config
        break
    if not found:
        raise ValueError(f"未找到要修改的步骤：{target_key}")
    graph["nodes"] = nodes
    result["graph"] = validate_graph(graph)
    return {
        "assistant": f"已仅更新步骤「{target_key}」。其他步骤未改动。",
        "draft": result,
        "model": "local-rules",
        "scope": "node",
        "targetNodeKey": target_key,
    }


def _merge_targeted_node(draft: dict, generated: dict, target_key: str) -> dict:
    """把 AI 返回的单节点补丁合并回原 graph，禁止整图替换。"""
    graph = deepcopy(draft.get("graph") or {})
    nodes = list(graph.get("nodes") or [])
    current = next((node for node in nodes if str(node.get("key") or "") == target_key), None)
    if not current:
        raise ValueError(f"目标步骤不存在：{target_key}")

    patch = generated.get("node") if isinstance(generated.get("node"), dict) else None
    if not patch and isinstance(generated.get("graph"), dict):
        patch = next(
            (
                node for node in (generated["graph"].get("nodes") or [])
                if isinstance(node, dict) and str(node.get("key") or "") == target_key
            ),
            None,
        )
    if not isinstance(patch, dict):
        raise ValueError("AI 未返回可合并的目标步骤。")

    merged_config = {
        **(current.get("config") if isinstance(current.get("config"), dict) else {}),
        **(patch.get("config") if isinstance(patch.get("config"), dict) else {}),
    }
    if merged_config.get("instruction"):
        merged_config["detail"] = merged_config.get("instruction")
        merged_config["message"] = merged_config.get("instruction")
    updated = {
        **current,
        "type": str(patch.get("type") or current.get("type") or "checkpoint"),
        "title": str(patch.get("title") or current.get("title") or target_key)[:128],
        "config": merged_config,
        "key": target_key,
    }
    graph["nodes"] = [updated if str(node.get("key") or "") == target_key else node for node in nodes]

    # 仅允许改写该节点的出边条件/目标，不增删其他边结构。
    edge_patches = generated.get("edgesFromNode")
    if isinstance(edge_patches, list):
        kept = [edge for edge in (graph.get("edges") or []) if edge.get("source") != target_key]
        for edge in edge_patches:
            if not isinstance(edge, dict):
                continue
            target = str(edge.get("target") or "")
            if not target or target == target_key:
                continue
            if target not in {str(node.get("key") or "") for node in graph["nodes"]}:
                continue
            kept.append({
                "source": target_key,
                "target": target,
                "condition": str(edge.get("condition") or "always"),
                "priority": int(edge.get("priority") or 1),
                "label": str(edge.get("label") or "")[:64],
            })
        if any(edge.get("source") == target_key for edge in kept) or target_key in (graph.get("terminals") or []):
            graph["edges"] = kept

    return validate_graph(graph)


def _normalize_images(raw) -> list[str]:
    """Accept data-URL / http(s) image strings for multimodal rewrite."""
    if not isinstance(raw, list):
        return []
    urls: list[str] = []
    for item in raw[:4]:
        if isinstance(item, str):
            url = item.strip()
        elif isinstance(item, dict):
            url = str(item.get("url") or item.get("dataUrl") or item.get("image_url") or "").strip()
            if not url and isinstance(item.get("image_url"), dict):
                url = str(item["image_url"].get("url") or "").strip()
        else:
            continue
        if url.startswith(("data:image/", "http://", "https://")) and len(url) <= 2_500_000:
            urls.append(url)
    return urls


def _user_message_content(text: str, images: list[str]):
    if not images:
        return text
    parts: list[dict] = [{"type": "text", "text": text}]
    for url in images:
        parts.append({"type": "image_url", "image_url": {"url": url}})
    return parts


def _resolve_target_keys(request_data: dict, current_graph: dict) -> list[str]:
    keys: list[str] = []
    raw_list = request_data.get("targetNodeKeys") or request_data.get("target_node_keys")
    if isinstance(raw_list, list):
        keys.extend(str(item).strip() for item in raw_list if str(item).strip())
    single = str(request_data.get("targetNodeKey") or request_data.get("target_node_key") or "").strip()
    if single:
        keys.append(single)
    seen: set[str] = set()
    ordered: list[str] = []
    node_ids = {str(node.get("key") or "") for node in (current_graph.get("nodes") or [])}
    for key in keys:
        if key in seen or key not in node_ids:
            continue
        seen.add(key)
        ordered.append(key)
    return ordered


def _merge_targeted_nodes(draft: dict, generated: dict, target_keys: list[str]) -> dict:
    working_graph = deepcopy(draft.get("graph") or {})
    working = {**draft, "graph": working_graph}
    patches_by_key: dict[str, dict] = {}
    if isinstance(generated.get("nodes"), list):
        for patch in generated["nodes"]:
            if isinstance(patch, dict) and str(patch.get("key") or "") in target_keys:
                patches_by_key[str(patch["key"])] = patch
    if isinstance(generated.get("node"), dict):
        key = str(generated["node"].get("key") or "")
        if key in target_keys:
            patches_by_key.setdefault(key, generated["node"])
    if isinstance(generated.get("graph"), dict):
        for patch in generated["graph"].get("nodes") or []:
            if isinstance(patch, dict) and str(patch.get("key") or "") in target_keys:
                patches_by_key.setdefault(str(patch["key"]), patch)
    for key in target_keys:
        patch = patches_by_key.get(key)
        if not patch:
            continue
        edge_patch = generated.get("edgesFromNode") if len(target_keys) == 1 else None
        working["graph"] = _merge_targeted_node(working, {"node": patch, "edgesFromNode": edge_patch}, key)
    return working["graph"]


def _fallback_nodes_rewrite(instruction: str, draft: dict, target_keys: list[str]) -> dict:
    result = deepcopy(draft)
    for key in target_keys:
        result = _fallback_node_rewrite(instruction, result, key)["draft"]
    titles = [
        str(node.get("title") or node.get("key"))
        for node in (result.get("graph") or {}).get("nodes") or []
        if str(node.get("key") or "") in set(target_keys)
    ]
    return {
        "assistant": f"已统一更新 {len(target_keys)} 个步骤：{'、'.join(titles[:4])}{'…' if len(titles) > 4 else ''}。",
        "draft": result,
        "model": "local-rules",
        "scope": "nodes",
        "targetNodeKeys": target_keys,
    }


def _wants_full_rebuild(instruction: str, draft: dict) -> bool:
    text = instruction or ""
    if any(word in text for word in ("从零", "重建", "重新设计", "全部重做", "推倒重来", "替换整条", "重搭")):
        return True
    name = str(draft.get("name") or "")
    key = str(draft.get("key") or "")
    nodes = ((draft.get("graph") or {}).get("nodes") or []) if isinstance(draft.get("graph"), dict) else []
    default_name = name in {"", "新建 SOP", "未命名流程"}
    return (not key and default_name and len(nodes) <= 4)


def _normalize_node_actions(graph: dict, fallback_action: str = "") -> dict:
    """Replace invented action names with registered contracts."""
    next_graph = deepcopy(graph)
    fallback = fallback_action if fallback_action and get_action(fallback_action) else ""
    if not fallback and get_action("report.generate"):
        fallback = "report.generate"
    for node in next_graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        action_name = str(config.get("action_name") or "").strip()
        if action_name and not get_action(action_name):
            config["action_name"] = fallback
            allowed = [str(item) for item in (config.get("allowed_actions") or [])]
            allowed = [item for item in allowed if not item.startswith("call_action:")]
            if fallback:
                token = f"call_action:{fallback}"
                if token not in allowed:
                    allowed.append(token)
            if "continue_flow" not in allowed:
                allowed.append("continue_flow")
            config["allowed_actions"] = allowed
            node["config"] = config
    return next_graph


def _ensure_connected(graph: dict) -> dict:
    """Make sure non-terminal nodes have outgoing edges so the canvas stays linked."""
    next_graph = deepcopy(graph)
    nodes = [node for node in (next_graph.get("nodes") or []) if isinstance(node, dict) and node.get("key")]
    if not nodes:
        return validate_graph(next_graph)
    keys = [str(node["key"]) for node in nodes]
    terminals = {str(item) for item in (next_graph.get("terminals") or [])}
    start = str(next_graph.get("start") or keys[0])
    if start not in keys:
        start = keys[0]
        next_graph["start"] = start
    if not terminals:
        end_key = next((str(node["key"]) for node in nodes if node.get("type") == "end"), keys[-1])
        terminals = {end_key}
        next_graph["terminals"] = [end_key]
    edges = [
        edge for edge in (next_graph.get("edges") or [])
        if isinstance(edge, dict) and str(edge.get("source") or "") in keys and str(edge.get("target") or "") in keys
    ]
    outgoing = {key: [] for key in keys}
    for edge in edges:
        outgoing[str(edge["source"])].append(edge)

    def next_candidate(index: int) -> str | None:
        for cursor in range(index + 1, len(keys)):
            return keys[cursor]
        return next(iter(terminals), None)

    for index, key in enumerate(keys):
        if key in terminals:
            continue
        if outgoing.get(key):
            continue
        target = next_candidate(index)
        if not target or target == key:
            continue
        edge = {"source": key, "target": target, "condition": "always", "priority": 1}
        edges.append(edge)
        outgoing[key].append(edge)

    # Ensure start participates in the chain.
    if start not in terminals and not outgoing.get(start):
        target = next_candidate(keys.index(start)) if start in keys else (keys[1] if len(keys) > 1 else None)
        if target and target != start:
            edges.append({"source": start, "target": target, "condition": "always", "priority": 1})

    next_graph["edges"] = edges
    # Preserve editor layout if present.
    meta = next_graph.get("meta") if isinstance(next_graph.get("meta"), dict) else {}
    layout = meta.get("layout") if isinstance(meta.get("layout"), dict) else {}
    validated = validate_graph(next_graph)
    if layout:
        validated.setdefault("meta", {})["layout"] = layout
    return validated


def _merge_flow_graph(current_graph: dict, generated_graph: dict, instruction: str, *, fallback_action: str = "") -> dict:
    """Update the flow without casually deleting unrelated nodes or dropping edges."""
    current = deepcopy(current_graph) if isinstance(current_graph, dict) else {}
    generated = deepcopy(generated_graph) if isinstance(generated_graph, dict) else {}
    text = instruction or ""
    allow_delete = any(word in text for word in ("删除", "去掉", "移除", "不要这个", "取消这一步", "删掉"))
    if _wants_full_rebuild(text, {"graph": current, "name": "", "key": ""}):
        merged = _normalize_node_actions(generated or current, fallback_action)
        # keep layout from current when rebuilding titles only
        cur_layout = ((current.get("meta") or {}) if isinstance(current.get("meta"), dict) else {}).get("layout")
        if isinstance(cur_layout, dict) and cur_layout:
            merged.setdefault("meta", {})
            if isinstance(merged.get("meta"), dict):
                merged["meta"]["layout"] = cur_layout
        return _ensure_connected(merged)

    current_nodes = {
        str(node.get("key")): deepcopy(node)
        for node in (current.get("nodes") or [])
        if isinstance(node, dict) and node.get("key")
    }
    generated_nodes = [
        node for node in (generated.get("nodes") or [])
        if isinstance(node, dict) and str(node.get("key") or "").strip()
    ]
    generated_keys = [str(node.get("key")) for node in generated_nodes]

    for node in generated_nodes:
        key = str(node.get("key"))
        incoming = node if isinstance(node, dict) else {}
        if key in current_nodes:
            old = current_nodes[key]
            old_config = old.get("config") if isinstance(old.get("config"), dict) else {}
            new_config = incoming.get("config") if isinstance(incoming.get("config"), dict) else {}
            merged_config = {**old_config, **new_config}
            # Keep previously bound enterprise data/knowledge unless user explicitly cleared them.
            for field in ("data_bindings", "knowledge_scope"):
                old_value = old_config.get(field) if isinstance(old_config.get(field), dict) else {}
                new_value = new_config.get(field) if isinstance(new_config.get(field), dict) else {}
                if field == "data_bindings":
                    old_ids = old_value.get("snapshot_ids") or old_value.get("asset_keys") or []
                    new_ids = new_value.get("snapshot_ids") or new_value.get("asset_keys") or []
                    if old_ids and not new_ids:
                        merged_config[field] = old_value
                if field == "knowledge_scope":
                    old_ids = old_value.get("knowledge_base_ids") or []
                    new_ids = new_value.get("knowledge_base_ids") or []
                    if old_ids and not new_ids:
                        merged_config[field] = old_value
            current_nodes[key] = {
                **old,
                **{k: v for k, v in incoming.items() if k != "config"},
                "key": key,
                "config": merged_config,
            }
        else:
            current_nodes[key] = incoming

    if allow_delete and generated_keys:
        keep = set(generated_keys)
        start = str(current.get("start") or generated.get("start") or "")
        terminals = [str(item) for item in (generated.get("terminals") or current.get("terminals") or [])]
        keep.update([start, *terminals])
        current_nodes = {key: node for key, node in current_nodes.items() if key in keep}

    # Prefer generated order, then append preserved extras.
    ordered_keys: list[str] = []
    for key in generated_keys:
        if key in current_nodes and key not in ordered_keys:
            ordered_keys.append(key)
    for key in current_nodes:
        if key not in ordered_keys:
            ordered_keys.append(key)

    start = str(generated.get("start") or current.get("start") or (ordered_keys[0] if ordered_keys else ""))
    terminals = [str(item) for item in (generated.get("terminals") or current.get("terminals") or []) if str(item) in current_nodes]
    if not terminals:
        terminals = [key for key, node in current_nodes.items() if node.get("type") == "end"] or ([ordered_keys[-1]] if ordered_keys else [])

    edge_map: dict[tuple[str, str, str], dict] = {}
    for edge in [*(current.get("edges") or []), *(generated.get("edges") or [])]:
        if not isinstance(edge, dict):
            continue
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if source not in current_nodes or target not in current_nodes:
            continue
        condition = str(edge.get("condition") or "always")
        edge_map[(source, target, condition)] = {
            "source": source,
            "target": target,
            "condition": condition,
            "priority": int(edge.get("priority") or 1),
            "label": str(edge.get("label") or "")[:64],
        }

    meta = {}
    if isinstance(current.get("meta"), dict):
        meta.update(current["meta"])
    if isinstance(generated.get("meta"), dict):
        # Keep layout from current; take goal/required_info updates from generated.
        layout = meta.get("layout")
        meta.update(generated["meta"])
        if isinstance(layout, dict):
            meta["layout"] = layout

    merged = {
        "start": start if start in current_nodes else (ordered_keys[0] if ordered_keys else start),
        "terminals": terminals,
        "nodes": [current_nodes[key] for key in ordered_keys],
        "edges": list(edge_map.values()),
        "meta": meta,
    }
    merged = _normalize_node_actions(merged, fallback_action or str((current_nodes.get(start) or {}).get("config", {}).get("action_name") or ""))
    return _ensure_connected(merged)


def _fallback_rewrite(instruction: str, draft: dict, target_node_key: str = "", target_node_keys: list[str] | None = None) -> dict:
    """LLM 未配置时仍允许用自然语言完成常见的流程增删。"""
    keys = list(target_node_keys or [])
    if target_node_key and target_node_key not in keys:
        keys.append(target_node_key)
    if len(keys) > 1:
        return _fallback_nodes_rewrite(instruction, draft, keys)
    if len(keys) == 1:
        return _fallback_node_rewrite(instruction, draft, keys[0])

    text = instruction or ""
    if _wants_full_rebuild(text, draft):
        return _scaffold_business_flow(text, draft)

    result = deepcopy(draft)
    graph = deepcopy(result.get("graph") or {})
    nodes = list(graph.get("nodes") or [])
    edges = list(graph.get("edges") or [])
    terminal = str((graph.get("terminals") or ["finish"])[0])
    if any(word in instruction for word in ("人工确认", "审批", "人工审核")) and not any(node.get("type") == "checkpoint" for node in nodes):
        new_key = "confirm.result"
        insert_at = max(0, len(nodes) - 1)
        nodes.insert(insert_at, {
            "key": new_key,
            "type": "checkpoint",
            "title": "人工确认结果",
            "config": {
                "instruction": "等待负责人确认后继续",
                "allowed_actions": ["confirm", "ask_user", "continue_flow"],
                "expected_user_info": [],
                "knowledge_scope": {"knowledge_base_ids": [], "retrieval_hint": ""},
                "data_bindings": {"snapshot_ids": [], "metric_ids": [], "asset_keys": [], "scope": "", "brand_ids": []},
            },
        })
        incoming = [edge for edge in edges if edge.get("target") == terminal]
        for edge in incoming:
            edge["target"] = new_key
        edges.append({"source": new_key, "target": terminal, "condition": "always", "priority": 1})
    if any(word in instruction for word in ("知识库", "知识检索", "查资料")) and not any(node.get("type") == "knowledge_query" for node in nodes):
        new_key = "knowledge.lookup"
        insert_at = max(0, len(nodes) - 1)
        nodes.insert(insert_at, {
            "key": new_key,
            "type": "knowledge_query",
            "title": "检索业务知识",
            "config": {
                "instruction": "按任务目标检索已绑定知识库",
                "allowed_actions": ["query_knowledge", "continue_flow"],
                "expected_user_info": [],
                "knowledge_scope": {"knowledge_base_ids": [], "retrieval_hint": ""},
                "data_bindings": {"snapshot_ids": [], "metric_ids": [], "asset_keys": [], "scope": "", "brand_ids": []},
            },
        })
        incoming = [edge for edge in edges if edge.get("target") == terminal]
        for edge in incoming:
            edge["target"] = new_key
        edges.append({"source": new_key, "target": terminal, "condition": "always", "priority": 1})
    if any(word in instruction for word in ("企业数据", "绑定数据", "可信数据", "销售数据")) and not any(node.get("type") == "data_bind" for node in nodes):
        new_key = "data.bind"
        insert_at = max(0, len(nodes) - 1)
        nodes.insert(insert_at, {
            "key": new_key,
            "type": "data_bind",
            "title": "绑定企业可信数据",
            "config": {
                "instruction": "绑定本步骤要使用的企业可信 Snapshot / 指标",
                "allowed_actions": ["continue_flow"],
                "expected_user_info": [],
                "knowledge_scope": {"knowledge_base_ids": [], "retrieval_hint": ""},
                "data_bindings": {"snapshot_ids": [], "metric_ids": [], "asset_keys": [], "scope": "", "brand_ids": []},
            },
        })
        incoming = [edge for edge in edges if edge.get("target") == terminal]
        for edge in incoming:
            edge["target"] = new_key
        edges.append({"source": new_key, "target": terminal, "condition": "always", "priority": 1})
    if any(word in instruction for word in ("失败", "异常", "兜底")) and not any(node.get("type") == "handoff" for node in nodes):
        key = "handoff.failure"
        nodes.append({
            "key": key,
            "type": "handoff",
            "title": "异常转人工处理",
            "config": {
                "instruction": "自动处理失败，请人工接管",
                "message": "自动处理失败，请人工接管",
                "allowed_actions": ["handoff_human"],
                "expected_user_info": [],
                "knowledge_scope": {"knowledge_base_ids": [], "retrieval_hint": ""},
                "data_bindings": {"snapshot_ids": [], "metric_ids": [], "asset_keys": [], "scope": "", "brand_ids": []},
            },
        })
        execute = next((node for node in nodes if node.get("type") == "execute_action"), None)
        if execute:
            edges.append({"source": execute["key"], "target": key, "condition": "decision:block", "priority": 2})
        graph["terminals"] = list(dict.fromkeys([*(graph.get("terminals") or []), key]))
    # Soft-update titles/instructions on existing collect/execute when user describes intent.
    for node in nodes:
        if not isinstance(node, dict):
            continue
        config = node.get("config") if isinstance(node.get("config"), dict) else {}
        if node.get("type") == "collect_info" and any(word in text for word in ("确认", "日期", "品牌")):
            fields = list(config.get("expected_user_info") or [])
            if any(word in text for word in ("日期", "周一", "周报")) and "date_range" not in fields and "日期" not in fields:
                fields.append("date_range")
            if "品牌" in text and "brand" not in fields and "品牌" not in fields:
                fields.append("brand")
            config["expected_user_info"] = fields
            config["required_fields"] = fields
            if text and len(str(config.get("instruction") or "")) < 8:
                config["instruction"] = "确认任务日期、品牌和数据范围等必要信息"
            node["config"] = config
        if node.get("type") == "execute_action" and any(word in text for word in ("周报", "报告", "分析")):
            action_name = str(config.get("action_name") or result.get("actionName") or "report.generate")
            if not get_action(action_name):
                action_name = "report.generate" if get_action("report.generate") else action_name
            config["action_name"] = action_name
            if "周报" in text:
                node["title"] = node.get("title") if "周报" in str(node.get("title") or "") else "生成销售周报"
                config["instruction"] = text[:800] or config.get("instruction") or "生成销售周报"
            node["config"] = config
    graph["nodes"], graph["edges"] = nodes, edges
    result["graph"] = _ensure_connected(_normalize_node_actions(graph, str(result.get("actionName") or "")))
    result = _enrich_draft_meta(instruction, result)
    return {
        "assistant": "已根据你的描述更新流程草稿，并保留原有步骤与连线。你可以继续告诉我需要增加、删除或调整的步骤。",
        "draft": result,
        "model": "local-rules",
        "tools": [
            {"name": "read_graph", "summary": "读取当前流程", "status": "ok"},
            {"name": "local_scaffold", "summary": "按规则更新步骤并补齐连线", "status": "ok"},
            {"name": "validate_graph", "summary": "校验节点与连线", "status": "ok"},
        ],
    }


def _empty_config(**overrides):
    base = {
        "instruction": "",
        "expected_user_info": [],
        "allowed_actions": ["continue_flow"],
        "knowledge_scope": {"knowledge_base_ids": [], "retrieval_hint": ""},
        "data_bindings": {"snapshot_ids": [], "metric_ids": [], "asset_keys": [], "scope": "", "brand_ids": []},
        "action_name": "",
        "detail": "",
        "message": "",
    }
    base.update(overrides)
    if base.get("instruction") and not base.get("detail"):
        base["detail"] = base["instruction"]
        base["message"] = base["instruction"]
    return base


def _enrich_draft_meta(instruction: str, draft: dict) -> dict:
    result = deepcopy(draft)
    text = instruction or ""
    if "周报" in text:
        result["name"] = "天猫销售周报" if "天猫" in text else "销售周报"
        result["businessDomain"] = result.get("businessDomain") or "经营分析"
        result["actionName"] = result.get("actionName") or "report.generate"
        result["description"] = text[:500]
        result["key"] = result.get("key") or ("tmall.sales.weekly" if "天猫" in text else "sales.weekly.report")
    elif any(word in text for word in ("库存", "补货")):
        result["name"] = result.get("name") if result.get("name") not in {"", "新建 SOP", "未命名流程"} else "库存风险分析"
        result["businessDomain"] = result.get("businessDomain") or "库存管理"
        result["description"] = text[:500] or result.get("description")
        result["key"] = result.get("key") or "inventory.risk.review"
    elif any(word in text for word in ("报告", "报表", "分析")) and (not result.get("name") or result.get("name") in {"新建 SOP", "未命名流程"}):
        result["name"] = "经营分析流程"
        result["businessDomain"] = result.get("businessDomain") or "经营分析"
        result["description"] = text[:500]
        result["key"] = result.get("key") or "ops.analysis.flow"
        result["actionName"] = result.get("actionName") or "report.generate"
    if text and (not result.get("description") or result.get("description") in {"", "左边说目标，右边点步骤微调。"}):
        result["description"] = text[:500]
    if not result.get("key"):
        result["key"] = "custom.sop.flow"
    if not re.fullmatch(r"[a-z][a-z0-9_.-]{1,95}", str(result.get("key") or "")):
        result["key"] = "custom.sop.flow"
    return result


def _scaffold_business_flow(instruction: str, draft: dict) -> dict:
    """LLM 不可用/失败时，按业务意图搭一条可用主链路。"""
    text = instruction or ""
    wants_confirm = any(word in text for word in ("确认", "先确认", "人工确认", "审批"))
    wants_data = any(word in text for word in ("企业数据", "销售数据", "库存", "台账", "数据", "天猫", "销售"))
    action_name = str(draft.get("actionName") or "report.generate")
    if "库存" in text:
        action_name = "inventory.risk_scan" if get_action("inventory.risk_scan") else action_name
    elif get_action("report.generate"):
        action_name = "report.generate"

    collect_fields = []
    if any(word in text for word in ("日期", "周一", "周报", "周期")):
        collect_fields.append("日期")
    if any(word in text for word in ("品牌", "天猫", "店铺")):
        collect_fields.append("品牌")
    if not collect_fields:
        collect_fields = ["日期", "品牌"] if wants_confirm or wants_data else []

    nodes = [{
        "key": "collect.scope",
        "type": "collect_info",
        "title": "确认任务所需信息",
        "config": _empty_config(
            instruction="确认任务日期、品牌和数据范围等必要信息" if wants_confirm or collect_fields else "确认本次任务的基本范围",
            expected_user_info=collect_fields,
            allowed_actions=["ask_user", "continue_flow"],
        ),
    }]
    edges = []
    prev = "collect.scope"

    if wants_data:
        nodes.append({
            "key": "data.bind",
            "type": "data_bind",
            "title": "选用企业销售数据" if "销售" in text or "天猫" in text else "选用企业可信数据",
            "config": _empty_config(
                instruction="选择本流程要用的销售、库存等可信业务数据",
                allowed_actions=["continue_flow"],
            ),
        })
        edges.append({"source": prev, "target": "data.bind", "condition": "always", "priority": 1})
        prev = "data.bind"

    if wants_confirm and "人工" in text:
        nodes.append({
            "key": "confirm.before",
            "type": "checkpoint",
            "title": "人工确认后继续",
            "config": _empty_config(
                instruction="生成结果前请负责人确认范围与数据",
                allowed_actions=["confirm", "ask_user", "continue_flow"],
            ),
        })
        edges.append({"source": prev, "target": "confirm.before", "condition": "always", "priority": 1})
        prev = "confirm.before"

    nodes.append({
        "key": "execute",
        "type": "execute_action",
        "title": "生成销售周报" if "周报" in text else "生成业务结果",
        "config": _empty_config(
            instruction=text[:800] or "按已确认信息生成业务结果",
            allowed_actions=["continue_flow", f"call_action:{action_name}"],
            action_name=action_name,
        ),
    })
    edges.append({"source": prev, "target": "execute", "condition": "always", "priority": 1})

    nodes.append({
        "key": "finish",
        "type": "end",
        "title": "完成",
        "config": _empty_config(instruction="流程完成", allowed_actions=["continue_flow"]),
    })
    edges.append({"source": "execute", "target": "finish", "condition": "always", "priority": 1})

    result = deepcopy(draft)
    result["actionName"] = action_name
    result["graph"] = validate_graph({
        "start": "collect.scope",
        "terminals": ["finish"],
        "nodes": nodes,
        "edges": edges,
        "meta": {"goal": [text[:200]] if text else [], "required_info": collect_fields},
    })
    result = _enrich_draft_meta(text, result)
    return {
        "assistant": f"已搭好「{result.get('name') or '业务流程'}」主链路，可在右侧继续点选步骤微调，或拖拽手柄连线。",
        "draft": result,
        "model": "local-scaffold",
        "tools": [
            {"name": "read_intent", "summary": "理解业务目标与约束", "status": "ok"},
            {"name": "scaffold_flow", "summary": f"搭建 {len(nodes)} 个步骤", "status": "ok"},
            {"name": "validate_graph", "summary": "校验节点与连线", "status": "ok"},
        ],
    }


def _tool_step(name: str, summary: str, status: str = "ok") -> dict:
    return {"name": name, "summary": summary, "status": status}


def _visible_sops(organization):
    return SopDefinition.objects.filter(Q(organization=organization) | Q(organization__isnull=True)).order_by(
        "business_domain", "name"
    )


def _find_sop(organization, sop_key: str):
    return _visible_sops(organization).filter(sop_key=sop_key).order_by("organization_id").last()


def _can_edit(sop: SopDefinition, user) -> bool:
    return bool(sop.organization_id and (sop.created_by_id == user.id or is_organization_admin(user, sop.organization)))


def _version_payload(row: SopVersion, *, include_graph: bool = True) -> dict:
    payload = {
        "id": row.id,
        "version": row.version,
        "status": row.status,
        "contentHash": row.content_hash,
        "changeSummary": row.change_summary,
        "triggerIntents": row.trigger_intents,
        "utteranceExamples": row.utterance_examples,
        "publishedAt": row.published_at.isoformat() if row.published_at else None,
        "createdAt": row.created_at.isoformat(),
    }
    if include_graph:
        payload.update({"graph": row.graph, "inputSchema": row.input_schema, "outputSchema": row.output_schema})
    return payload


def _sop_payload(row: SopDefinition, user, *, include_graph: bool = False) -> dict:
    current = row.versions.filter(version=row.current_version).first() if row.current_version else row.versions.first()
    editable = _can_edit(row, user)
    draft = row.versions.filter(status=SopVersion.Status.DRAFT).order_by("-created_at").first() if editable else None
    selected = draft or current
    success_rate = round((row.success_count / row.call_count) * 100, 1) if row.call_count else 0
    payload = {
        "id": row.id,
        "key": row.sop_key,
        "name": row.name,
        "businessDomain": row.business_domain,
        "description": row.description,
        "actionName": row.action_name,
        "status": row.status,
        "currentVersion": row.current_version,
        "system": row.is_system,
        "canEdit": editable,
        "hasDraft": bool(draft),
        "draftVersion": draft.version if draft else None,
        "callCount": row.call_count,
        "successRate": success_rate,
        "nodeCount": len((selected.graph or {}).get("nodes") or []) if selected else 0,
        "updatedAt": row.updated_at.isoformat(),
    }
    if include_graph and selected:
        payload["version"] = _version_payload(selected)
    return payload


def _version_values(data: dict, *, fallback: SopVersion | None = None) -> dict:
    graph = validate_graph(data.get("graph", fallback.graph if fallback else {}))
    input_schema = data.get("inputSchema", data.get("input_schema", fallback.input_schema if fallback else {}))
    output_schema = data.get("outputSchema", data.get("output_schema", fallback.output_schema if fallback else {}))
    triggers = data.get("triggerIntents", data.get("trigger_intents", fallback.trigger_intents if fallback else []))
    examples = data.get("utteranceExamples", data.get("utterance_examples", fallback.utterance_examples if fallback else []))
    if not isinstance(input_schema, dict) or not isinstance(output_schema, dict):
        raise ValueError("输入与输出 Schema 必须是 JSON 对象。")
    if not isinstance(triggers, list) or not isinstance(examples, list):
        raise ValueError("触发意图和示例指令必须是数组。")
    return {
        "graph": graph,
        "input_schema": input_schema,
        "output_schema": output_schema,
        "trigger_intents": [str(item).strip()[:120] for item in triggers if str(item).strip()][:30],
        "utterance_examples": [str(item).strip()[:300] for item in examples if str(item).strip()][:30],
        "change_summary": str(data.get("changeSummary", data.get("change_summary", fallback.change_summary if fallback else "")))[:300],
        "content_hash": graph_hash(graph=graph, input_schema=input_schema, output_schema=output_schema, trigger_intents=triggers, examples=examples),
    }


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_ai_rewrite(request):
    organization = ensure_current_organization(request.user)
    instruction = str(request.data.get("instruction") or "").strip()
    draft = request.data.get("draft") or {}
    history = request.data.get("history") or []
    images = _normalize_images(request.data.get("images") or [])
    if not instruction and not images:
        return Response({"error": "请输入你希望 AI 如何创建或修改 SOP。"}, status=400)
    if not instruction and images:
        instruction = "请根据附图理解业务意图，并据此修改当前选中范围的 SOP。"
    if not isinstance(draft, dict) or not isinstance(history, list):
        return Response({"error": "SOP 草稿或对话历史格式错误。"}, status=400)
    current_graph = draft.get("graph") or {}
    try:
        validate_graph(current_graph)
    except ValueError as exc:
        return Response({"error": f"当前流程无法交给 AI 修改：{exc}"}, status=400)

    target_keys = _resolve_target_keys(request.data if isinstance(request.data, dict) else {}, current_graph)
    edit_scope = "flow" if not target_keys else ("node" if len(target_keys) == 1 else "nodes")
    node_count = len((current_graph.get("nodes") or []))
    catalog = _available_catalog(organization)
    available_actions = catalog["availableActions"]
    available_assets = catalog["availableAssets"]

    def _finalize_graph(graph: dict) -> dict:
        filled = _autofill_graph_bindings(
            graph,
            assets=available_assets,
            actions=available_actions,
            instruction=instruction,
            draft_action=str(draft.get("actionName") or ""),
        )
        return _ensure_connected(filled)

    def _soft_fallback(reason: str = ""):
        try:
            payload = _fallback_rewrite(instruction, draft, target_node_keys=target_keys)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=400)
        tools = list(payload.get("tools") or [])
        tools.insert(0, _tool_step("read_graph", f"读取当前流程（{node_count} 步）"))
        if reason:
            tools.insert(1, _tool_step("llm_rewrite", reason, "failed"))
        draft_out = payload.get("draft") if isinstance(payload.get("draft"), dict) else draft
        graph = _finalize_graph(draft_out.get("graph") or current_graph)
        draft_out = {**draft_out, "graph": graph}
        if not draft_out.get("actionName"):
            draft_out["actionName"] = _pick_action_name(instruction, fallback=str(draft.get("actionName") or ""), actions=available_actions)
        payload["draft"] = draft_out
        payload["tools"] = [
            *tools,
            _tool_step("bind_assets", f"绑定企业数据 {len(available_assets)} 项可选"),
            _tool_step("bind_actions", f"绑定业务能力 {len(available_actions)} 项可选"),
        ]
        payload["scope"] = edit_scope
        if target_keys:
            payload["targetNodeKeys"] = target_keys
        return Response(payload)

    if not llm.llm_available(request.user):
        return _soft_fallback("模型未配置，改用本地编排工具")

    if edit_scope in {"node", "nodes"}:
        target_nodes = [
            node for node in (current_graph.get("nodes") or [])
            if str(node.get("key") or "") in set(target_keys)
        ]
        tools = [
            _tool_step("read_graph", f"读取选中步骤（{len(target_keys)}）"),
            _tool_step("rewrite_nodes", "调用模型修改选中步骤"),
        ]
        system = """你是企业 SOP 步骤编辑器。用户已选中一个或多个流程步骤，你只能修改这些步骤，禁止改动未选中步骤或整图结构。
只返回一个 JSON 对象，禁止 Markdown。字段：
- assistant：简短中文，说明改了哪些步骤
- nodes：数组，每项 { key, type, title, config }，key 必须属于选中步骤
- 若只改一步，也可返回 node：{ key, type, title, config }
- edgesFromNode（仅单步时可选）：该步骤出边 [{target, condition, priority}]
节点 type 仅允许 collect_info、data_bind、knowledge_query、checkpoint、execute_action、gate、handoff、end。
config 必须包含 instruction、expected_user_info、allowed_actions、knowledge_scope、data_bindings、action_name。
绑定规则：
1. data_bindings.asset_keys / snapshot_ids 必须从 availableAssets 中选择真实值；涉及销售/库存时优先选对应资产。
2. execute_action / gate 的 action_name 必须从 availableActions.name 中选，title 可用中文理解，但字段写 name。
3. allowed_actions 需包含 continue_flow，执行节点还需 call_action:<action_name>。
若用户附带了图片，先理解图中的流程/表单/白板内容，再落到选中步骤的修改。
不要返回完整 graph，不要改 SOP 名称/key/未选中节点。"""
        payload_text = json.dumps({
            "instruction": instruction,
            "targetNodeKeys": target_keys,
            "targetNodes": target_nodes,
            "sopName": draft.get("name"),
            "actionName": draft.get("actionName"),
            "availableActions": available_actions,
            "availableAssets": available_assets[:40],
        }, ensure_ascii=False)
        messages = [{"role": "user", "content": _user_message_content(payload_text, images)}]
        result = llm.chat_messages_result(
            system, messages, temperature=0.15, max_tokens=2200, timeout=60,
            llm_user=request.user, allow_images=bool(images),
        )
        if not result.get("content"):
            if result.get("vision_unsupported"):
                return Response({"error": "当前模型不支持看图，请换支持视觉的模型，或去掉图片后再试。"}, status=502)
            return _soft_fallback(str(result.get("error") or "模型未返回内容，改用本地工具"))
        try:
            generated = _extract_json_object(str(result["content"]))
            graph = _finalize_graph(_merge_targeted_nodes(draft, generated, target_keys))
            tools.append(_tool_step("validate_graph", "合并并校验选中步骤"))
            tools.append(_tool_step("bind_assets", "补齐企业数据与业务能力绑定"))
        except (ValueError, json.JSONDecodeError):
            return _soft_fallback("模型返回无法合并，改用本地工具")
        revised = {
            "key": str(draft.get("key") or ""),
            "version": str(draft.get("version") or "1.0.0"),
            "name": str(draft.get("name") or "新建 SOP")[:128],
            "businessDomain": str(draft.get("businessDomain") or "")[:64],
            "description": str(draft.get("description") or "")[:500],
            "actionName": str(draft.get("actionName") or "")[:96],
            "triggerIntents": list(draft.get("triggerIntents") or [])[:30],
            "utteranceExamples": list(draft.get("utteranceExamples") or [])[:30],
            "graph": graph,
        }
        titles = [
            str(node.get("title") or node.get("key"))
            for node in graph["nodes"] if str(node.get("key") or "") in set(target_keys)
        ]
        default_assistant = (
            f"已只更新步骤「{titles[0]}」。"
            if len(titles) == 1
            else f"已统一更新 {len(titles)} 个步骤：{'、'.join(titles[:4])}。"
        )
        return Response({
            "assistant": str(generated.get("assistant") or default_assistant)[:1200],
            "draft": revised,
            "model": result.get("model") or "",
            "scope": edit_scope,
            "targetNodeKeys": target_keys,
            "tools": tools,
        })

    tools = [
        _tool_step("read_graph", f"读取当前流程（{node_count} 步）"),
        _tool_step("rewrite_flow", "调用模型生成/修改整条流程"),
    ]
    system = """你是企业 SOP 流程设计师（流程型技能 / SkillCard）。根据用户指令修改当前 SOP 草稿，只返回一个 JSON 对象，禁止 Markdown。
返回字段必须为 assistant、key、name、businessDomain、description、actionName、triggerIntents、utteranceExamples、graph。新建 SOP 时生成稳定的英文 key；修改已有 SOP 时必须保留原 key。
graph 必须含 start、terminals、nodes、edges，可选 meta.goal / meta.required_info。
节点字段：key、type、title、config。
节点 type 仅允许 collect_info、data_bind、knowledge_query、checkpoint、execute_action、gate、handoff、end。
推荐默认链路：collect_info → data_bind（可选）→ knowledge_query（可选）→ gate（可选）→ execute_action → end。
config 必须包含：
- instruction：给 AI 的目标说明（中文）
- expected_user_info：字符串数组（槽位/必填字段）
- allowed_actions：ask_user / query_knowledge / handoff_human / continue_flow / confirm / call_action:<动作名>
- knowledge_scope：{ knowledge_base_ids:[], retrieval_hint:"" }
- data_bindings：{ snapshot_ids:[], metric_ids:[], asset_keys:[], scope:"", brand_ids:[] }，必须从 availableAssets 选择真实 asset_key/snapshot_id
- action_name：execute_action / gate 必须从 availableActions.name 选择（如 report.generate），禁止编造
边字段：source、target、condition、priority。condition 仅允许 always、result_ok、result_failed、decision:<值>、field_present:<字段>、field_missing:<字段>。
重要约束：
1. 除非用户明确要求删除/重建，必须保留当前草稿里已有节点，只改需要改的步骤。
2. 每个非终止节点都必须有出边，整条链路必须从 start 连到 terminals，禁止孤立节点。
3. 节点 key 稳定且使用小写英文、数字、点、下划线或短横线；不要生成环。
4. data_bind / execute_action 节点不要把企业数据留空；按用户意图从 availableAssets 选择。
若用户附带了图片，先理解图中的流程/表单/白板，再生成或修改整条 SOP。
assistant 用简短中文说明本次修改、已绑定的企业数据/业务能力，以及仍需用户确认的信息。"""
    compact_history = [
        {"role": str(item.get("role") or "user"), "content": str(item.get("content") or "")[:1000]}
        for item in history[-8:] if isinstance(item, dict)
    ]
    messages = [
        *compact_history,
        {
            "role": "user",
            "content": _user_message_content(
                json.dumps({
                    "instruction": instruction,
                    "currentDraft": draft,
                    "availableActions": available_actions,
                    "availableAssets": available_assets[:40],
                }, ensure_ascii=False),
                images,
            ),
        },
    ]
    result = llm.chat_messages_result(
        system, messages, temperature=0.15, max_tokens=3000, timeout=60,
        llm_user=request.user, allow_images=bool(images),
    )
    if not result.get("content"):
        if result.get("vision_unsupported"):
            return Response({"error": "当前模型不支持看图，请换支持视觉的模型，或去掉图片后再试。"}, status=502)
        return _soft_fallback(str(result.get("error") or "模型未返回内容，改用本地编排工具"))
    try:
        generated = _extract_json_object(str(result["content"]))
        graph = _finalize_graph(_merge_flow_graph(
            current_graph,
            generated.get("graph") or current_graph,
            instruction,
            fallback_action=str(draft.get("actionName") or ""),
        ))
        tools.append(_tool_step("validate_graph", "合并节点并补齐连线"))
        tools.append(_tool_step("bind_assets", "补齐企业数据与业务能力绑定"))
    except (ValueError, json.JSONDecodeError):
        tools.append(_tool_step("repair_json", "修复模型返回的流程 JSON"))
        repair = llm.chat_messages_result(
            "修复下面的 SOP JSON。只返回语法正确的完整 JSON 对象，不要 Markdown，不要解释，不要改变业务含义。必须保留原有节点并保证 edges 把流程连起来。",
            [{"role": "user", "content": str(result["content"])[:12000]}],
            temperature=0, max_tokens=3500, timeout=45, llm_user=request.user, allow_images=False,
        )
        try:
            generated = _extract_json_object(str(repair.get("content") or ""))
            graph = _finalize_graph(_merge_flow_graph(
                current_graph,
                generated.get("graph") or current_graph,
                instruction,
                fallback_action=str(draft.get("actionName") or ""),
            ))
            tools.append(_tool_step("validate_graph", "合并修复后的流程并补齐连线"))
            tools.append(_tool_step("bind_assets", "补齐企业数据与业务能力绑定"))
        except (ValueError, json.JSONDecodeError):
            return _soft_fallback("模型返回结构不完整，改用本地编排工具")
    action_name = str(generated.get("actionName") or draft.get("actionName") or "").strip()
    if action_name and not get_action(action_name):
        action_name = str(draft.get("actionName") or "")
    if not action_name:
        action_name = _pick_action_name(instruction, fallback="", actions=available_actions)
    proposed_key = str(draft.get("key") or generated.get("key") or "").strip()
    if proposed_key and not re.fullmatch(r"[a-z][a-z0-9_.-]{1,95}", proposed_key):
        proposed_key = ""
    revised = {
        "key": proposed_key,
        "version": str(draft.get("version") or "1.0.0"),
        "name": str(generated.get("name") or draft.get("name") or "新建 SOP")[:128],
        "businessDomain": str(generated.get("businessDomain") or draft.get("businessDomain") or "")[:64],
        "description": str(generated.get("description") or draft.get("description") or "")[:500],
        "actionName": action_name[:96],
        "triggerIntents": list(generated.get("triggerIntents") or draft.get("triggerIntents") or [])[:30],
        "utteranceExamples": list(generated.get("utteranceExamples") or draft.get("utteranceExamples") or [])[:30],
        "graph": graph,
    }
    tools.append(_tool_step("apply_draft", f"写入流程（{len(graph.get('nodes') or [])} 步）"))
    return Response({
        "assistant": str(generated.get("assistant") or "已更新 SOP 流程草稿，并尽量绑定企业数据与业务能力。")[:1200],
        "draft": revised,
        "model": result.get("model") or "",
        "scope": "flow",
        "tools": tools,
    })


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def sops(request):
    organization = ensure_current_organization(request.user)
    if request.method == "GET":
        return Response({"results": [_sop_payload(row, request.user) for row in _visible_sops(organization)]})
    data = request.data
    key = str(data.get("key") or data.get("sopKey") or "").strip()
    name = str(data.get("name") or "").strip()
    version_number = str(data.get("version") or "1.0.0").strip()
    action_name = str(data.get("actionName") or "").strip()
    if not key or not name:
        return Response({"error": "SOP ID 和名称不能为空。"}, status=400)
    if action_name and not get_action(action_name):
        return Response({"error": "绑定的动作契约不存在。"}, status=400)
    if SopDefinition.objects.filter(organization=organization, sop_key=key).exists():
        return Response({"error": "当前工作区已存在相同 SOP ID。"}, status=400)
    try:
        values = _version_values(data)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    with transaction.atomic():
        sop = SopDefinition.objects.create(
            organization=organization,
            sop_key=key,
            name=name[:128],
            business_domain=str(data.get("businessDomain") or "")[:64],
            description=str(data.get("description") or "")[:500],
            action_name=action_name,
            created_by=request.user,
            updated_by=request.user,
        )
        SopVersion.objects.create(definition=sop, version=version_number, created_by=request.user, **values)
    return Response(_sop_payload(sop, request.user, include_graph=True), status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def sop_detail(request, sop_key: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    if not sop:
        return Response({"error": "SOP 不存在。"}, status=404)
    if request.method == "GET":
        return Response(_sop_payload(sop, request.user, include_graph=True))
    if not _can_edit(sop, request.user):
        return Response({"error": "系统 SOP 请先复制到当前工作区后编辑。"}, status=403)
    if request.method == "DELETE":
        sop.status = SopDefinition.Status.ARCHIVED
        sop.updated_by = request.user
        sop.save(update_fields=["status", "updated_by", "updated_at"])
        return Response(status=204)
    for field, key, limit in [
        ("name", "name", 128), ("business_domain", "businessDomain", 64),
        ("description", "description", 500), ("action_name", "actionName", 96),
    ]:
        if key in request.data:
            setattr(sop, field, str(request.data.get(key) or "")[:limit])
    if sop.action_name and not get_action(sop.action_name):
        return Response({"error": "绑定的动作契约不存在。"}, status=400)
    sop.updated_by = request.user
    sop.save()
    return Response(_sop_payload(sop, request.user, include_graph=True))


def _allocate_unique_sop_key(organization, preferred: str) -> str:
    preferred = (preferred or "").strip()[:96] or "sop.copy"
    if not SopDefinition.objects.filter(organization=organization, sop_key=preferred).exists():
        return preferred
    base = preferred
    for index in range(2, 1000):
        candidate = f"{base}.{index}"[:96]
        if not SopDefinition.objects.filter(organization=organization, sop_key=candidate).exists():
            return candidate
    raise ValueError("无法分配唯一的 SOP ID。")


def _default_copy_key(sop_key: str) -> str:
    matched = re.match(r"^(.*?\.local)(?:\.\d+)?$", sop_key or "")
    if matched:
        return matched.group(1)
    return f"{(sop_key or 'sop').strip()}.local"


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_duplicate(request, sop_key: str):
    organization = ensure_current_organization(request.user)
    source = _find_sop(organization, sop_key)
    if not source:
        return Response({"error": "SOP 不存在。"}, status=404)
    source_version = source.versions.filter(version=source.current_version).first() or source.versions.first()
    preferred = str(request.data.get("key") or _default_copy_key(source.sop_key)).strip()[:96]
    try:
        key = _allocate_unique_sop_key(organization, preferred)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    copy_index = 1
    if key != preferred:
        suffix = key.rsplit(".", 1)[-1]
        copy_index = int(suffix) if suffix.isdigit() else 2
    default_name = f"{source.name}（本地版）" if copy_index == 1 else f"{source.name}（本地版 {copy_index}）"
    if request.data.get("name"):
        default_name = str(request.data.get("name"))
    with transaction.atomic():
        copy = SopDefinition.objects.create(
            organization=organization,
            sop_key=key,
            name=default_name[:128],
            business_domain=source.business_domain,
            description=source.description,
            action_name=source.action_name,
            created_by=request.user,
            updated_by=request.user,
        )
        if source_version:
            SopVersion.objects.create(
                definition=copy,
                version="1.0.0",
                graph=deepcopy(source_version.graph),
                input_schema=deepcopy(source_version.input_schema),
                output_schema=deepcopy(source_version.output_schema),
                trigger_intents=deepcopy(source_version.trigger_intents),
                utterance_examples=deepcopy(source_version.utterance_examples),
                content_hash=source_version.content_hash,
                change_summary=f"复制自 {source.sop_key}@{source_version.version}",
                created_by=request.user,
            )
    return Response(_sop_payload(copy, request.user, include_graph=True), status=201)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def sop_versions(request, sop_key: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    if not sop:
        return Response({"error": "SOP 不存在。"}, status=404)
    if request.method == "GET":
        return Response({"results": [_version_payload(row) for row in sop.versions.all()]})
    if not _can_edit(sop, request.user):
        return Response({"error": "没有权限创建该 SOP 的版本。"}, status=403)
    version_number = str(request.data.get("version") or "").strip()
    if not version_number or sop.versions.filter(version=version_number).exists():
        return Response({"error": "版本号为空或已经存在。"}, status=400)
    base = sop.versions.filter(version=sop.current_version).first() or sop.versions.first()
    try:
        values = _version_values(request.data, fallback=base)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    row = SopVersion.objects.create(definition=sop, version=version_number, created_by=request.user, **values)
    return Response(_version_payload(row), status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def sop_version_detail(request, sop_key: str, version: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    row = sop.versions.filter(version=version).first() if sop else None
    if not row:
        return Response({"error": "SOP 版本不存在。"}, status=404)
    if request.method == "GET":
        return Response(_version_payload(row))
    if not _can_edit(sop, request.user) or row.status != SopVersion.Status.DRAFT:
        return Response({"error": "只有当前工作区的草稿版本可以修改。"}, status=403)
    try:
        values = _version_values(request.data, fallback=row)
    except ValueError as exc:
        return Response({"error": str(exc)}, status=400)
    for field, value in values.items():
        setattr(row, field, value)
    row.save()
    return Response(_version_payload(row))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def sop_publish(request, sop_key: str, version: str):
    organization = ensure_current_organization(request.user)
    sop = _find_sop(organization, sop_key)
    row = sop.versions.filter(version=version).first() if sop else None
    if not row:
        return Response({"error": "SOP 版本不存在。"}, status=404)
    if not _can_edit(sop, request.user):
        return Response({"error": "没有权限发布该 SOP。"}, status=403)
    validate_graph(row.graph)
    with transaction.atomic():
        sop.versions.filter(status=SopVersion.Status.PUBLISHED).exclude(id=row.id).update(status=SopVersion.Status.RETIRED)
        row.status = SopVersion.Status.PUBLISHED
        row.published_by = request.user
        row.published_at = timezone.now()
        row.save(update_fields=["status", "published_by", "published_at", "updated_at"])
        sop.current_version = row.version
        sop.status = SopDefinition.Status.PUBLISHED
        sop.updated_by = request.user
        sop.save(update_fields=["current_version", "status", "updated_by", "updated_at"])
    return Response(_sop_payload(sop, request.user, include_graph=True))
