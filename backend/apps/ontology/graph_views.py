"""
本体图谱 API:对象/关系的 CRUD + add / split / merge / delete 操作 + LLM 抽取。
"""
import json

from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from django.conf import settings
from django.shortcuts import get_object_or_404

from .models import OntObject, OntRelation
from .signals import suppress_ontology_sync
from apps.council import llm
from apps.datalake import age as age_svc
from .commerce_schema import preset_types_for_ui

# 前端预设类型：草图基础 + 电商经营类型（知行一期迁入）
_BASE_PRESETS = {
    "physical": ["时间", "空间", "物体", "人", "电脑", "工位"],
    "virtual": ["岗位", "流程", "客户"],
}


def _merged_presets() -> dict:
    commerce = preset_types_for_ui()
    physical = list(dict.fromkeys([*_BASE_PRESETS["physical"], *commerce["physical"]]))
    virtual = list(dict.fromkeys([*_BASE_PRESETS["virtual"], *commerce["virtual"]]))
    return {"physical": physical, "virtual": virtual}


PRESET_TYPES = _merged_presets()


def _obj(o: OntObject) -> dict:
    return {
        "id": o.id, "category": o.category, "otype": o.otype, "name": o.name,
        "attributes": o.attributes, "x": o.x, "y": o.y,
    }


def _rel(r: OntRelation) -> dict:
    return {
        "id": r.id, "source": r.source_id, "target": r.target_id, "label": r.label,
        "polarity": r.polarity or "",
        "delay_days": r.delay_days,
        "evidence_score": r.evidence_score,
        "is_causal_candidate": r.is_causal_candidate,
    }


def _age_graph_name() -> str:
    workspace = settings.LIGHTRAG_WORKSPACE
    if not workspace:
        src = age_svc.resolve_source(settings.LIGHTRAG_SOURCE_ID) if settings.LIGHTRAG_SOURCE_ID else None
        workspace = (src or {}).get("workspace")
    return age_svc.graph_name_for_workspace(workspace or "") if workspace else ""


def _filter_graph_objects(scope: str) -> tuple[list[OntObject], list[OntRelation], dict]:
    """scope=age 时只查当前 AGE 本图,不扫全库。"""
    if scope != "age":
        objs = list(OntObject.objects.all())
        rels = list(OntRelation.objects.all())
        meta = {
            "scope": scope,
            "objects": len(objs),
            "relations": len(rels),
        }
        return objs, rels, meta

    graph_name = _age_graph_name()
    if not graph_name:
        return [], [], {"scope": "age", "age_graph": "", "objects": 0, "relations": 0}

    table_key = f"age.{graph_name}"
    objs = list(OntObject.objects.filter(attributes__contains={"_table": table_key}))
    if not objs:
        # 兼容旧数据:仅 _db_key 带前缀、无 _table 时做小范围回退
        prefix = f"age.{graph_name}."
        objs = [
            o for o in OntObject.objects.iterator(chunk_size=500)
            if str((o.attributes or {}).get("_db_key", "")).startswith(prefix)
        ]
    ids = {o.id for o in objs}
    rels = list(OntRelation.objects.filter(source_id__in=ids, target_id__in=ids)) if ids else []
    meta = {
        "scope": "age",
        "age_graph": graph_name,
        "objects": len(objs),
        "relations": len(rels),
    }
    return objs, rels, meta


@api_view(["GET"])
def graph(request):
    """返回图谱;默认 scope=age 仅当前 AGE workspace 子图(轻量)。"""
    scope = (request.query_params.get("scope") or "age").strip().lower()
    sid = settings.LIGHTRAG_SOURCE_ID
    src = age_svc.resolve_source(sid) if sid else None
    stats = age_svc.graph_stats(sid) if sid else {}
    objs, rels, meta = _filter_graph_objects(scope)
    return Response({
        "objects": [_obj(o) for o in objs],
        "relations": [_rel(r) for r in rels],
        "presets": PRESET_TYPES,
        "llm": llm.llm_available(),
        "lightrag": {
            "source_id": sid,
            "workspace": settings.LIGHTRAG_WORKSPACE or (src or {}).get("workspace"),
            "source_name": (src or {}).get("name"),
            "graph": stats.get("selected_graph"),
            "vertices": stats.get("vertices", 0),
            "edges": stats.get("edges", 0),
        },
        "meta": meta,
    })


@api_view(["GET", "POST"])
def objects(request):
    if request.method == "POST":
        d = request.data
        if not d.get("name"):
            return Response({"error": "name 必填"}, status=status.HTTP_400_BAD_REQUEST)
        o = OntObject.objects.create(
            category=d.get("category", "physical"),
            otype=d.get("otype", "物体"),
            name=d.get("name"),
            attributes=d.get("attributes", {}) or {},
            x=d.get("x", 120), y=d.get("y", 120),
        )
        return Response(_obj(o), status=status.HTTP_201_CREATED)
    return Response({"results": [_obj(o) for o in OntObject.objects.all()]})


@api_view(["PATCH", "DELETE"])
def object_detail(request, obj_id: int):
    o = get_object_or_404(OntObject, id=obj_id)
    if request.method == "DELETE":
        o.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    d = request.data
    for f in ("category", "otype", "name", "attributes", "x", "y"):
        if f in d:
            setattr(o, f, d[f])
    o.save()
    return Response(_obj(o))


@api_view(["POST"])
def relations(request):
    d = request.data
    src = get_object_or_404(OntObject, id=d.get("source"))
    tgt = get_object_or_404(OntObject, id=d.get("target"))
    if src.id == tgt.id:
        return Response({"error": "不能连接自身"}, status=status.HTTP_400_BAD_REQUEST)
    r = OntRelation.objects.create(source=src, target=tgt, label=d.get("label", "关联"))
    return Response(_rel(r), status=status.HTTP_201_CREATED)


def _apply_causal_fields(r: OntRelation, d: dict) -> None:
    if "label" in d:
        r.label = d["label"]
    if "polarity" in d:
        r.polarity = d["polarity"] if d["polarity"] in ("+", "-", "") else r.polarity
    if "delay_days" in d:
        r.delay_days = d["delay_days"]
    if "evidence_score" in d:
        r.evidence_score = d["evidence_score"]
    if "is_causal_candidate" in d:
        r.is_causal_candidate = bool(d["is_causal_candidate"])


def _age_graph_table() -> str:
    g = _age_graph_name()
    return f"age.{g}" if g else ""


def _build_age_id_index() -> dict[int, OntObject]:
    index: dict[int, OntObject] = {}
    for obj in OntObject.objects.only("id", "attributes", "name"):
        raw = (obj.attributes or {}).get("_age_id")
        if raw is None:
            continue
        try:
            index[int(raw)] = obj
        except (TypeError, ValueError):
            continue
    return index


def _find_by_age_id(age_id: int, index: dict[int, OntObject] | None = None) -> OntObject | None:
    aid = int(age_id)
    if index is not None:
        return index.get(aid)
    return _build_age_id_index().get(aid)


def _resolve_age_node(
    age_id: int,
    name: str = "",
    index: dict[int, OntObject] | None = None,
) -> tuple[OntObject, bool]:
    """解析 AGE 节点到本地 OntObject;不存在则自动创建。返回 (object, created)。"""
    existing = _find_by_age_id(age_id, index)
    if existing:
        return existing, False

    nm = (name or "").strip()
    table = _age_graph_table()
    if nm:
        for cand in OntObject.objects.filter(name=nm).only("id", "name", "attributes")[:30]:
            attrs = cand.attributes or {}
            if table and attrs.get("_table") and attrs.get("_table") != table:
                continue
            raw = attrs.get("_age_id")
            if raw is not None:
                try:
                    if int(raw) != int(age_id):
                        continue
                except (TypeError, ValueError):
                    continue
            merged = dict(attrs)
            merged["_age_id"] = int(age_id)
            if table:
                merged["_table"] = table
            cand.attributes = merged
            cand.save(update_fields=["attributes"])
            return cand, False

    graph = _age_graph_name()
    attrs = {
        "_age_id": int(age_id),
        "_table": table or (f"age.{graph}" if graph else ""),
        "数据来源": f"AGE·{graph}" if graph else "AGE",
    }
    obj = OntObject.objects.create(
        category="virtual",
        otype="base",
        name=nm or f"node-{age_id}",
        attributes=attrs,
        x=0,
        y=0,
    )
    if index is not None:
        index[int(age_id)] = obj
    return obj, True


@api_view(["PATCH", "DELETE"])
def relation_detail(request, rel_id: int):
    r = get_object_or_404(OntRelation, id=rel_id)
    if request.method == "DELETE":
        r.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    with suppress_ontology_sync():
        _apply_causal_fields(r, request.data)
        r.save()
    return Response(_rel(r))


@api_view(["POST"])
def relation_upsert_causal(request):
    """AGE 直读边按 source/target 的 _age_id 匹配本地关系并写入因果元数据。"""
    d = request.data
    rel_id = d.get("relation_id")
    src_created = tgt_created = False
    with suppress_ontology_sync():
        if rel_id:
            r = get_object_or_404(OntRelation, id=rel_id)
        else:
            try:
                src_age = int(d["source_age_id"])
                tgt_age = int(d["target_age_id"])
            except (KeyError, TypeError, ValueError):
                return Response(
                    {"error": "需提供 relation_id 或 source_age_id + target_age_id"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            label = (d.get("label") or "关联").strip()[:64]
            src_name = (d.get("source_name") or "").strip()
            tgt_name = (d.get("target_name") or "").strip()
            age_index = _build_age_id_index()
            src, src_created = _resolve_age_node(src_age, src_name, age_index)
            tgt, tgt_created = _resolve_age_node(tgt_age, tgt_name, age_index)
            r = OntRelation.objects.filter(source=src, target=tgt, label=label).first()
            if not r:
                r = OntRelation.objects.create(source=src, target=tgt, label=label)
        _apply_causal_fields(r, d)
        r.save()
    payload = _rel(r)
    if not rel_id:
        payload["synced"] = {
            "source_created": src_created,
            "target_created": tgt_created,
        }
    return Response(payload)


@api_view(["POST"])
def split(request, obj_id: int):
    """拆分:复制出一个同类型的新对象(用于把一个混合实体拆成两个)。"""
    o = get_object_or_404(OntObject, id=obj_id)
    new_name = request.data.get("name") or (o.name + "-拆分")
    clone = OntObject.objects.create(
        category=o.category, otype=o.otype, name=new_name,
        attributes=dict(o.attributes), x=o.x + 80, y=o.y + 80,
    )
    return Response({"new_object": _obj(clone)}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def merge(request):
    """合并:把 from_id 的关系并到 keep_id,合并属性后删除 from_id。"""
    keep = get_object_or_404(OntObject, id=request.data.get("keep_id"))
    drop = get_object_or_404(OntObject, id=request.data.get("from_id"))
    if keep.id == drop.id:
        return Response({"error": "不能与自身合并"}, status=status.HTTP_400_BAD_REQUEST)

    # 重指向关系,避免自环与重复
    for r in drop.out_relations.all():
        if r.target_id != keep.id and not OntRelation.objects.filter(
            source=keep, target_id=r.target_id, label=r.label
        ).exists():
            r.source = keep
            r.save()
    for r in drop.in_relations.all():
        if r.source_id != keep.id and not OntRelation.objects.filter(
            source_id=r.source_id, target=keep, label=r.label
        ).exists():
            r.target = keep
            r.save()

    merged = dict(drop.attributes)
    merged.update(keep.attributes)
    keep.attributes = merged
    keep.save()
    drop.delete()
    return Response({"kept": _obj(keep)})


@api_view(["POST"])
def extract(request):
    """用 LLM 从自然语言抽取对象与关系并写入图谱;无 LLM 时返回提示。"""
    text = (request.data.get("text") or "").strip()
    if not text:
        return Response({"error": "text 必填"}, status=status.HTTP_400_BAD_REQUEST)
    if not llm.llm_available():
        return Response(
            {"error": "未配置可用 LLM(需在 .env 填入正确的 LLM_BASE_URL 网关地址)"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    system = (
        "你是本体建模助手。从文本中抽取对象与关系,只输出 JSON,不要任何解释。格式:"
        '{"objects":[{"name":"","category":"physical|virtual","otype":""}],'
        '"relations":[{"source":"对象名","target":"对象名","label":""}]}。'
        "category 物理指时间/空间/物体(人/电脑/工位),虚拟指岗位/流程/客户等。"
    )
    out = llm.chat(system, text, temperature=0.2, max_tokens=800)
    try:
        cleaned = out.strip().strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
        data = json.loads(cleaned)
    except (json.JSONDecodeError, AttributeError):
        return Response({"error": "LLM 返回无法解析", "raw": out}, status=status.HTTP_400_BAD_REQUEST)

    name_to_obj: dict[str, OntObject] = {}
    base_x, base_y = 140, 140
    for i, item in enumerate(data.get("objects", [])):
        nm = item.get("name")
        if not nm:
            continue
        o = OntObject.objects.create(
            category=item.get("category", "physical"),
            otype=item.get("otype", "物体"),
            name=nm,
            x=base_x + (i % 4) * 160, y=base_y + (i // 4) * 140,
        )
        name_to_obj[nm] = o
    created_rel = 0
    for item in data.get("relations", []):
        s = name_to_obj.get(item.get("source"))
        t = name_to_obj.get(item.get("target"))
        if s and t and s.id != t.id:
            OntRelation.objects.create(source=s, target=t, label=item.get("label", "关联"))
            created_rel += 1

    return Response({
        "created_objects": len(name_to_obj),
        "created_relations": created_rel,
        "objects": [_obj(o) for o in OntObject.objects.all()],
        "relations": [_rel(r) for r in OntRelation.objects.all()],
    })
