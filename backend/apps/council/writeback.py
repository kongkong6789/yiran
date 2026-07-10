"""
会议成果回写本体图谱(闭环):

会议结束时:
  1. 把会议与最终方案建成本体对象(会议 -[产出]-> 方案);
  2. 把会议引用的 AGE 图谱实体落为本地对象并建「引用」关系;
  3. 用 LLM 从方案文本抽取新实体/关系写入图谱(无 LLM 时跳过)。

全程容错:回写失败不影响会议结束流程。
"""
from __future__ import annotations

import json
import random
import threading

from apps.ontology.models import OntObject, OntRelation
from apps.ontology import signals as ont_signals

from . import llm, graph_knowledge


def _extract_from_plan(text: str, source_tag: str) -> tuple[int, int, dict[str, OntObject]]:
    """LLM 抽取方案中的实体/关系并写入本体库,返回 (新增对象数, 新增关系数, 名称映射)。"""
    if not llm.llm_available() or not text.strip():
        return 0, 0, {}
    system = (
        "你是本体建模助手。从会议方案中抽取核心对象与关系,只输出 JSON,不要任何解释。格式:"
        '{"objects":[{"name":"","category":"physical|virtual","otype":""}],'
        '"relations":[{"source":"对象名","target":"对象名","label":""}]}。'
        "只抽取方案中的关键业务对象(如渠道/商品/岗位/流程/指标),最多 8 个对象。"
    )
    out = llm.chat(system, text[:4000], temperature=0.2, max_tokens=800)
    try:
        cleaned = out.strip().strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        data = json.loads(cleaned)
    except (json.JSONDecodeError, AttributeError):
        return 0, 0, {}

    name_to_obj: dict[str, OntObject] = {}
    for item in data.get("objects", [])[:8]:
        nm = (item.get("name") or "").strip()
        if not nm:
            continue
        obj, _ = OntObject.objects.get_or_create(
            name=nm[:128],
            otype=(item.get("otype") or "物体")[:32],
            defaults={
                "category": item.get("category") or "virtual",
                "attributes": {"数据来源": source_tag},
                "x": 200 + random.random() * 400,
                "y": 200 + random.random() * 300,
            },
        )
        name_to_obj[nm] = obj

    created_rel = 0
    for item in data.get("relations", []):
        s = name_to_obj.get(item.get("source"))
        t = name_to_obj.get(item.get("target"))
        if s and t and s.id != t.id:
            OntRelation.objects.get_or_create(
                source=s, target=t, label=(item.get("label") or "关联")[:64],
            )
            created_rel += 1
    return len(name_to_obj), created_rel, name_to_obj


def writeback_meeting(meeting, deliverable) -> dict:
    """会议结束后回写图谱,返回回写摘要;失败返回 {"error": ...}。

    PG 全量镜像同步较重(万级对象约数分钟),移到后台线程执行,不阻塞会议结束。
    """
    source_tag = f"圆桌会议·{meeting.title[:40]}"
    ont_signals.pause_sync()
    try:
        meeting_obj, _ = OntObject.objects.get_or_create(
            name=f"会议:{meeting.title[:100]}",
            otype="会议",
            defaults={
                "category": "virtual",
                "attributes": {
                    "数据来源": source_tag,
                    "核心问题": meeting.question[:300],
                    "meeting_id": meeting.id,
                },
                "x": 480, "y": 120,
            },
        )
        plan_obj = OntObject.objects.create(
            category="virtual",
            otype="方案",
            name=deliverable.title[:128],
            attributes={
                "数据来源": source_tag,
                "版本": deliverable.version,
                "deliverable_id": deliverable.id,
            },
            x=620, y=200,
        )
        OntRelation.objects.get_or_create(source=meeting_obj, target=plan_obj, label="产出")

        # 引用的 AGE 实体:按名称落为本地对象并建关系
        refs = graph_knowledge.search_graph(meeting.question).get("refs", [])
        ref_count = 0
        for r in refs:
            ent, _ = OntObject.objects.get_or_create(
                name=str(r["name"])[:128],
                otype=str(r.get("otype") or "entity")[:32],
                defaults={
                    "category": "virtual",
                    "attributes": {
                        "数据来源": "AGE 图谱引用",
                        "description": r.get("description") or "",
                        "_age_id": r["id"],
                    },
                    "x": 300 + random.random() * 400,
                    "y": 300 + random.random() * 300,
                },
            )
            OntRelation.objects.get_or_create(source=meeting_obj, target=ent, label="引用")
            ref_count += 1

        # LLM 从方案抽取新对象/关系
        new_objs, new_rels, extracted = _extract_from_plan(deliverable.content, source_tag)
        for obj in extracted.values():
            OntRelation.objects.get_or_create(source=plan_obj, target=obj, label="涉及")

        return {
            "meeting_object_id": meeting_obj.id,
            "plan_object_id": plan_obj.id,
            "referenced_entities": ref_count,
            "extracted_objects": new_objs,
            "extracted_relations": new_rels,
        }
    except Exception as exc:
        return {"error": f"图谱回写失败: {exc}"}
    finally:
        # PG 全量镜像较重,放后台线程,不阻塞会议结束响应
        threading.Thread(target=ont_signals.resume_sync_and_flush, daemon=True).start()
