"""
圆桌会议 <-> 本体图谱(AGE)打通:围绕会议问题检索相关实体子图。

数据来自 apps.datalake.age.fetch_graph_live(自带 5 分钟缓存),
在内存中做轻量关键词匹配(当前图仅数百实体,无需向量检索)。
"""
from __future__ import annotations

import re

from apps.datalake import age as age_svc


def _terms(text: str) -> tuple[set[str], set[str]]:
    """提取英文词(>=2 字符,排除纯数字避免误匹配)与中文双字词组。"""
    low = (text or "").lower()
    words = {w for w in re.findall(r"[a-z0-9_./-]{2,}", low) if not w.isdigit()}
    han = re.findall(r"[\u4e00-\u9fff]", low)
    bigrams = {han[i] + han[i + 1] for i in range(len(han) - 1)}
    return words, bigrams


def _score(question: str, q_words: set[str], q_bigrams: set[str], obj: dict) -> float:
    name = str(obj.get("name") or "")
    desc = str((obj.get("attributes") or {}).get("description") or "")
    name_l, desc_l = name.lower(), desc.lower()
    q_l = question.lower()

    score = 0.0
    # 实体名与问题互相包含:最强信号
    if name_l and name_l in q_l:
        score += 10 + len(name_l)
    n_words, n_bigrams = _terms(name)
    score += 3.0 * len(q_words & n_words) + 2.0 * len(q_bigrams & n_bigrams)
    # 描述命中:弱信号,封顶避免长描述霸榜
    d_words, d_bigrams = _terms(desc_l[:800])
    score += min(3.0, 0.5 * len(q_words & d_words) + 0.3 * len(q_bigrams & d_bigrams))
    return score


def search_graph(question: str, top_k: int = 6, max_edges: int = 12) -> dict:
    """
    围绕问题检索 AGE 图谱,返回:
      {"refs": [{"id","name","otype","description"}], "card": "可注入 prompt 的资料卡文本"}
    图谱不可用或无命中时返回空 refs / 空 card,不抛异常。
    """
    empty = {"refs": [], "card": ""}
    question = (question or "").strip()
    if not question:
        return empty
    try:
        g = age_svc.fetch_graph_live(node_limit=2000, edge_limit=3000)
    except Exception:
        return empty
    if g.get("error"):
        return empty

    objects = g.get("objects") or []
    relations = g.get("relations") or []
    if not objects:
        return empty

    q_words, q_bigrams = _terms(question)
    ranked = sorted(
        ((o, _score(question, q_words, q_bigrams, o)) for o in objects),
        key=lambda t: t[1],
        reverse=True,
    )
    hits = [(o, s) for o, s in ranked[:top_k] if s >= 2.0]
    if not hits:
        return empty

    by_id = {o["id"]: o for o in objects}
    hit_ids = {o["id"] for o, _ in hits}

    # 1-hop 邻域关系
    edge_lines: list[str] = []
    for r in relations:
        if len(edge_lines) >= max_edges:
            break
        if r["source"] in hit_ids or r["target"] in hit_ids:
            s, t = by_id.get(r["source"]), by_id.get(r["target"])
            if s and t:
                edge_lines.append(f"  关联:{s['name']} -[{r['label']}]-> {t['name']}")

    refs = []
    lines = []
    for o, _ in hits:
        desc = str((o.get("attributes") or {}).get("description") or "").replace("<SEP>", ";")
        refs.append({
            "id": o["id"],
            "name": o["name"],
            "otype": o.get("otype") or "entity",
            "description": desc[:200],
        })
        lines.append(f"- [{o.get('otype') or 'entity'}] {o['name']}:{desc[:160] or '(无描述)'}")

    graph_name = g.get("graph") or ""
    card = (
        f"【知识图谱(AGE·{graph_name})】\n"
        + "\n".join(lines)
        + ("\n" + "\n".join(edge_lines) if edge_lines else "")
    )
    return {"refs": refs, "card": card}
