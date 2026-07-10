"""闭环检测:在 CausalLink 候选图上找闭合路径并判定 R/B。"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from apps.ontology.models import OntRelation


def classify_loop_type(relations: list[OntRelation]) -> str:
    """偶数个负极性 → R, 奇数个负极性 → B。"""
    neg = sum(1 for r in relations if r.polarity == OntRelation.Polarity.NEGATIVE)
    return "R" if neg % 2 == 0 else "B"


def _normalize_cycle(rel_ids: list[int]) -> tuple[int, ...]:
    """旋转归一化,便于去重。"""
    if not rel_ids:
        return tuple()
    n = len(rel_ids)
    rotations = [tuple(rel_ids[i:] + rel_ids[:i]) for i in range(n)]
    return min(rotations)


def find_closed_loops(
    relations: Iterable[OntRelation],
    *,
    max_len: int = 8,
    max_cycles: int = 40,
) -> list[dict]:
    """
    在有向关系图上搜索简单闭环。
    返回候选列表: relation_ids, loop_type, node_ids, confidence。
    """
    rel_list = list(relations)
    if len(rel_list) < 2:
        return []

    rel_map = {r.id: r for r in rel_list}
    node_ids = {r.source_id for r in rel_list} | {r.target_id for r in rel_list}
    adj: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for r in rel_list:
        adj[r.source_id].append((r.target_id, r.id))

    cycles: list[dict] = []
    seen: set[tuple[int, ...]] = set()

    def dfs(start: int, current: int, path_rels: list[int], visited_nodes: set[int]) -> None:
        if len(cycles) >= max_cycles:
            return
        if len(path_rels) > max_len:
            return
        for nxt, rel_id in adj.get(current, []):
            if nxt == start and len(path_rels) >= 2:
                key = _normalize_cycle(path_rels + [rel_id])
                if key in seen:
                    continue
                seen.add(key)
                members = [rel_map[rid] for rid in path_rels + [rel_id] if rid in rel_map]
                scores = [m.evidence_score for m in members if m.evidence_score is not None]
                confidence = round(sum(scores) / len(scores)) if scores else 30
                cycles.append({
                    "relation_ids": list(path_rels) + [rel_id],
                    "loop_type": classify_loop_type(members),
                    "node_ids": list(visited_nodes | {start, nxt}),
                    "confidence": min(100, max(0, confidence)),
                    "negative_count": sum(1 for m in members if m.polarity == "-"),
                })
                continue
            if nxt in visited_nodes:
                continue
            visited_nodes.add(nxt)
            path_rels.append(rel_id)
            dfs(start, nxt, path_rels, visited_nodes)
            path_rels.pop()
            visited_nodes.remove(nxt)

    for node in node_ids:
        if node not in adj:
            continue
        dfs(node, node, [], {node})

    cycles.sort(key=lambda c: (-c["confidence"], len(c["relation_ids"])))
    return cycles


def _longest_candidate_chains(candidates: list[OntRelation], limit: int = 5) -> list[dict]:
    """在候选边子图上找最长开放链(用于提示还差哪一段才能闭环)。"""
    if not candidates:
        return []
    adj: dict[int, list[tuple[int, int]]] = defaultdict(list)
    rel_map = {r.id: r for r in candidates}
    for r in candidates:
        adj[r.source_id].append((r.target_id, r.id))

    chains: list[dict] = []

    def walk(start: int, current: int, rel_ids: list[int], nodes: set[int]) -> None:
        extended = False
        for nxt, rid in adj.get(current, []):
            if nxt in nodes:
                continue
            extended = True
            walk(start, nxt, rel_ids + [rid], nodes | {nxt})
        if not extended and rel_ids:
            members = [rel_map[i] for i in rel_ids]
            chains.append({
                "relation_ids": rel_ids,
                "node_names": [members[0].source.name]
                + [m.target.name for m in members],
                "length": len(rel_ids),
            })

    starts = [r.source_id for r in candidates if r.source_id not in {x.target_id for x in candidates}]
    if not starts:
        starts = [candidates[0].source_id]
    for s in starts[:20]:
        walk(s, s, [], {s})

    chains.sort(key=lambda c: (-c["length"], c["relation_ids"][0]))
    out: list[dict] = []
    seen: set[tuple[int, ...]] = set()
    for c in chains:
        key = tuple(c["relation_ids"])
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
        if len(out) >= limit:
            break
    return out


def diagnose_loop_detection(
    relations: list[OntRelation],
    *,
    candidates_only: bool = True,
    max_len: int = 8,
) -> dict:
    """解释为何检测为 0,并给出可操作建议。"""
    candidates = [r for r in relations if r.is_causal_candidate]
    search_set = candidates if candidates_only and len(candidates) >= 2 else relations
    cycles_strict = find_closed_loops(candidates, max_len=max_len) if len(candidates) >= 2 else []
    cycles_search = find_closed_loops(search_set, max_len=max_len)
    cycles_all = find_closed_loops(relations, max_len=max_len)

    hints: list[str] = []
    reason = ""

    if len(candidates) == 0:
        reason = "尚未标记任何 CausalLink 候选边"
        hints.append("在本体图谱关系列表点「编辑」,勾选「CausalLink 候选」并设置极性 (+/-)")
    elif len(candidates) == 1:
        reason = "仅标记 1 条候选边,无法构成闭环(至少需要 3 个节点、2 条以上首尾相接的边)"
        hints.append("继续标记同一条业务链路上的相邻因果边,例如 A→B、B→C、C→A")
    elif not cycles_all:
        reason = "当前本体库关系图是有向无环结构(DAG),不存在 A→B→…→A 的闭合路径"
        hints.append("知识图谱多为单向引用;业务反馈回路需手工标出完整环路,或用手工创建回路")
        hints.append("试点示例:品牌数→单品牌投入→服务质量→续约率→品牌数,每条边都标为候选")
    elif not cycles_strict and cycles_all:
        reason = "全图存在闭环,但你标记的候选边未覆盖任一整条闭合链"
        hints.append("找到构成环路的每一条边,全部标为 CausalLink 候选后再检测")
    else:
        targets = {r.target_id for r in candidates}
        sources = {r.source_id for r in candidates}
        if not (targets & sources):
            reason = "已标记的候选边彼此不连通(没有「上一条的终点 = 下一条的起点」)"
            hints.append("请按业务因果顺序,标记首尾相接的一条链,最后再补上回到起点的边")
        else:
            reason = "候选边已部分连通,但尚未形成闭合环"
            hints.append("检查是否缺少最后一条「回到起点」的因果边,或链路上仍有断点")

    chains = _longest_candidate_chains(candidates)
    return {
        "candidate_count": len(candidates),
        "search_relation_count": len(search_set),
        "total_relation_count": len(relations),
        "cycles_in_candidates": len(cycles_strict),
        "cycles_in_search_set": len(cycles_search),
        "cycles_in_all_relations": len(cycles_all),
        "reason": reason,
        "hints": hints,
        "longest_open_chains": chains,
        "candidates_preview": [
            {
                "id": r.id,
                "source_name": r.source.name,
                "target_name": r.target.name,
                "label": r.label,
                "polarity": r.polarity or "",
            }
            for r in candidates[:20]
        ],
    }


def detect_from_queryset(qs=None, **kwargs) -> list[dict]:
    if qs is None:
        qs = OntRelation.objects.filter(is_causal_candidate=True)
    relations = list(qs.select_related("source", "target")[:800])
    candidates_only = kwargs.pop("candidates_only", True)
    if len(relations) < 2:
        relations = list(OntRelation.objects.select_related("source", "target")[:300])
        candidates_only = False
    if candidates_only and sum(1 for r in relations if r.is_causal_candidate) >= 2:
        cand = [r for r in relations if r.is_causal_candidate]
        return find_closed_loops(cand, **kwargs)
    return find_closed_loops(relations, **kwargs)
