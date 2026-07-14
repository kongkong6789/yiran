import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Card, Row, Col, Button, Input, Select, Radio, Space, Tag, App,
  Modal, Divider, Typography, Empty, Alert, List, AutoComplete,
  Drawer, Table, Spin, Statistic, Switch, InputNumber,
} from "antd";
import {
  PlusOutlined, DeleteOutlined, SplitCellsOutlined, MergeCellsOutlined,
  ApiOutlined, ThunderboltOutlined, ReloadOutlined, EditOutlined,
  DatabaseOutlined, ShareAltOutlined,
  FilterOutlined,
} from "@ant-design/icons";
import ForceGraph2D from "react-force-graph-2d";
import { forceCollide } from "d3-force";
import {
  addObject, updateObject, deleteObject, addRelation, deleteRelation, updateRelation, upsertRelationCausal,
  splitObject, mergeObjects, extractGraph, importFromAge, importFromDb, getAgeLiveGraph, getObjectData,
  type OntGraph, type OntObject, type OntRelation, type ObjectData,
} from "../api/client";
import { findSimpleLoops, pickLoopBatch, enumerateConnectedBatches } from "../utils/graphCycles";

const PALETTE = [
  "#8ab4ff", "#ffa0c8", "#7dffd4", "#d8b4ff", "#ffd080",
  "#90f0ff", "#ffb8e8", "#d0ff70", "#ffc888", "#90f8f0",
];
const colorOfType = (t: string) => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

type GNode = {
  id: number;
  name: string;
  otype: string;
  category: string;
  attributes: Record<string, unknown>;
  degree: number;
  color: string;
  x?: number;
  y?: number;
};
type GLink = { source: number | GNode; target: number | GNode; label: string; id: number };

const ageGraphName = (workspace?: string) =>
  workspace ? `${workspace}_chunk_entity_relation` : "";

const TOP_N_DEFAULT = 90;
const OVERVIEW_ZOOM_PADDING = 130;
const LOOPS_PER_BATCH = 5;
const NODES_PER_BATCH = 100;

type DisplayMode = "smart" | "loops" | "batch";

function thinDenseHubEdges(relations: OntRelation[], maxSpokesPerHub = 10): OntRelation[] {
  const degree = new Map<number, number>();
  relations.forEach((r) => {
    degree.set(r.source, (degree.get(r.source) || 0) + 1);
    degree.set(r.target, (degree.get(r.target) || 0) + 1);
  });
  const kept = new Map<number, number>();
  const sorted = [...relations].sort((a, b) => {
    const da = Math.max(degree.get(a.source) || 0, degree.get(a.target) || 0);
    const db = Math.max(degree.get(b.source) || 0, degree.get(b.target) || 0);
    return db - da;
  });
  const out: OntRelation[] = [];
  for (const r of sorted) {
    const hubs = [r.source, r.target].filter((id) => (degree.get(id) || 0) > maxSpokesPerHub);
    if (hubs.length === 0) {
      out.push(r);
      continue;
    }
    if (hubs.some((id) => (kept.get(id) || 0) >= maxSpokesPerHub)) continue;
    hubs.forEach((id) => kept.set(id, (kept.get(id) || 0) + 1));
    out.push(r);
  }
  return out;
}

export default function OntologyGraph() {
  const { message } = App.useApp();
  const [graph, setGraph] = useState<OntGraph | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<"select" | "connect">("select");
  const [connectFrom, setConnectFrom] = useState<number | null>(null);

  // 新增对象表单
  const [cat, setCat] = useState<"physical" | "virtual">("physical");
  const [otype, setOtype] = useState("物体");
  const [name, setName] = useState("");
  // 合并
  const [mergeTarget, setMergeTarget] = useState<number | null>(null);
  // 连线弹窗
  const [relModal, setRelModal] = useState<{ s: number; t: number } | null>(null);
  const [relLabel, setRelLabel] = useState("关联");
  const [editingRel, setEditingRel] = useState<OntRelation | null>(null);
  const [ePolarity, setEPolarity] = useState<string>("");
  const [eDelay, setEDelay] = useState<number | null>(null);
  const [eEvidence, setEEvidence] = useState<number | null>(null);
  const [eCausal, setECausal] = useState(false);
  const [savingRel, setSavingRel] = useState(false);
  // LLM 抽取
  const [extractText, setExtractText] = useState("");
  const [extracting, setExtracting] = useState(false);
  // 数据底座
  const [importingAge, setImportingAge] = useState(false);
  const [importingDb, setImportingDb] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [objData, setObjData] = useState<ObjectData | null>(null);
  // 编辑对象
  const [editing, setEditing] = useState<OntObject | null>(null);
  const [eCat, setECat] = useState<"physical" | "virtual">("physical");
  const [eType, setEType] = useState("");
  const [eName, setEName] = useState("");
  const [eAttrs, setEAttrs] = useState<{ k: string; v: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [otypeFilter, setOtypeFilter] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("smart");
  const [batchIndex, setBatchIndex] = useState(0);
  const [hoverNode, setHoverNode] = useState<GNode | null>(null);

  const fgRef = useRef<any>(null);
  const didFitRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hoverIdRef = useRef<number | null>(null);
  // 从 URL 带入待聚焦节点(如圆桌会议跳转 /ontology?focus=<id>)
  const [searchParams] = useSearchParams();
  const pendingFocusRef = useRef<number | null>(
    searchParams.get("focus") ? Number(searchParams.get("focus")) : null,
  );
  const [size, setSize] = useState({ w: 800, h: 520 });

  const load = useCallback((refresh = false, fullFetch = false, quiet = false) => {
    if (!quiet) setLoading(true);
    const limits = fullFetch
      ? { limit: 2000, edge_limit: 3000 }
      : { limit: 1000, edge_limit: 1500 };
    return getAgeLiveGraph({ ...limits, ...(refresh ? { refresh: 1 as const } : {}) })
      .then(setGraph)
      .finally(() => { if (!quiet) setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleDisplayModeChange = (mode: DisplayMode) => {
    setDisplayMode(mode);
    setBatchIndex(0);
    didFitRef.current = false;
    if (mode === "loops" || mode === "batch") {
      const total = graph?.meta?.objects ?? graph?.objects.length ?? 0;
      if (total > TOP_N_DEFAULT) {
        message.info(mode === "loops" ? "闭环浏览：正在加载图谱并识别闭环…" : "分批浏览：正在加载更多节点…");
        load(true, true);
      }
    }
  };

  const targetGraphName = ageGraphName(graph?.lightrag?.workspace);
  const pgVertices = graph?.lightrag?.vertices ?? 0;
  const pgEdges = graph?.lightrag?.edges ?? 0;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () =>
      setSize({ w: el.clientWidth, h: Math.max(el.clientHeight, 480) });
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(apply, 150);
    });
    ro.observe(el);
    apply();
    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  const objById = (id: number | null) => graph?.objects.find((o) => o.id === id) || null;

  const baseScope = useMemo(() => {
    if (!graph) return { objects: [] as OntObject[], relations: [] as OntRelation[] };
    let objects = graph.objects;
    if (otypeFilter) objects = objects.filter((o) => o.otype === otypeFilter);
    const q = searchText.trim().toLowerCase();
    if (q) {
      objects = objects.filter(
        (o) => o.name.toLowerCase().includes(q) || o.otype.toLowerCase().includes(q),
      );
    }
    const idSet = new Set(objects.map((o) => o.id));
    const relations = graph.relations.filter((r) => idSet.has(r.source) && idSet.has(r.target));
    return { objects, relations };
  }, [graph, otypeFilter, searchText]);

  const loopCandidates = useMemo(
    () => findSimpleLoops(baseScope.relations, { maxLen: 6, maxLoops: 120 }),
    [baseScope.relations],
  );

  const scopedDegree = useMemo(() => {
    const degree = new Map<number, number>();
    baseScope.relations.forEach((r) => {
      degree.set(r.source, (degree.get(r.source) || 0) + 1);
      degree.set(r.target, (degree.get(r.target) || 0) + 1);
    });
    return degree;
  }, [baseScope.relations]);

  const connectedNodeBatches = useMemo(
    () => enumerateConnectedBatches(
      baseScope.objects,
      baseScope.relations,
      NODES_PER_BATCH,
      (id) => scopedDegree.get(id) || 0,
    ),
    [baseScope.objects, baseScope.relations, scopedDegree],
  );

  const loopBatchCount = Math.max(1, Math.ceil(loopCandidates.length / LOOPS_PER_BATCH));
  const nodeBatchCount = Math.max(1, connectedNodeBatches.length);

  useEffect(() => {
    const maxPage = displayMode === "loops" ? loopBatchCount : nodeBatchCount;
    if (batchIndex >= maxPage) setBatchIndex(Math.max(0, maxPage - 1));
  }, [batchIndex, displayMode, loopBatchCount, nodeBatchCount]);

  const filtered = useMemo(() => {
    if (!graph) return { objects: [] as OntObject[], relations: [] as OntRelation[], loopCount: 0 };
    let { objects, relations } = baseScope;
    let loopCount = 0;

    if (displayMode === "loops") {
      if (loopCandidates.length === 0) {
        const keep = connectedNodeBatches[batchIndex] ?? new Set<number>();
        objects = objects.filter((o) => keep.has(o.id));
        relations = relations.filter((r) => keep.has(r.source) && keep.has(r.target));
      } else {
        const batch = pickLoopBatch(loopCandidates, batchIndex, LOOPS_PER_BATCH);
        loopCount = batch.loops.length;
        const keepNodes = batch.nodeIds;
        const keepRels = batch.relationIds;
        objects = objects.filter((o) => keepNodes.has(o.id));
        relations = relations.filter((r) => keepRels.has(r.id));
      }
      return { objects, relations, loopCount };
    }

    if (displayMode === "batch") {
      const keep = connectedNodeBatches[batchIndex] ?? new Set<number>();
      return {
        objects: objects.filter((o) => keep.has(o.id)),
        relations: relations.filter((r) => keep.has(r.source) && keep.has(r.target)),
        loopCount: 0,
      };
    }

    // smart
    relations = thinDenseHubEdges(relations, 10);
    const linked = new Set<number>();
    relations.forEach((r) => {
      linked.add(r.source);
      linked.add(r.target);
    });
    objects = objects.filter((o) => linked.has(o.id));

    if (objects.length > TOP_N_DEFAULT) {
      const degree = new Map<number, number>();
      relations.forEach((r) => {
        degree.set(r.source, (degree.get(r.source) || 0) + 1);
        degree.set(r.target, (degree.get(r.target) || 0) + 1);
      });
      if (selected && objects.some((o) => o.id === selected)) {
        const keep = new Set<number>([selected]);
        relations.forEach((r) => {
          if (r.source === selected) keep.add(r.target);
          if (r.target === selected) keep.add(r.source);
        });
        objects = objects.filter((o) => keep.has(o.id));
      } else {
        const ranked = [...objects].sort(
          (a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0),
        );
        const keep = new Set(ranked.slice(0, TOP_N_DEFAULT).map((o) => o.id));
        objects = objects.filter((o) => keep.has(o.id));
      }
      const keepIds = new Set(objects.map((o) => o.id));
      relations = relations.filter((r) => keepIds.has(r.source) && keepIds.has(r.target));
    }
    return { objects, relations, loopCount: 0 };
  }, [graph, baseScope, displayMode, selected, batchIndex, loopCandidates, connectedNodeBatches]);

  const fgData = useMemo(() => {
    const degree = new Map<number, number>();
    filtered.relations.forEach((r) => {
      degree.set(r.source, (degree.get(r.source) || 0) + 1);
      degree.set(r.target, (degree.get(r.target) || 0) + 1);
    });
    const nodes: GNode[] = filtered.objects.map((o) => ({
      id: o.id,
      name: o.name,
      otype: o.otype,
      category: o.category,
      attributes: o.attributes || {},
      degree: degree.get(o.id) || 0,
      color: colorOfType(o.otype),
    }));
    const links: GLink[] = filtered.relations.map((r) => ({
      id: r.id,
      source: r.source,
      target: r.target,
      label: r.label,
    }));
    return { nodes, links };
  }, [filtered]);

  useEffect(() => {
    didFitRef.current = false;
  }, [fgData.nodes.length, fgData.links.length, batchIndex, displayMode]);

  const neighborIds = useMemo(() => {
    if (!hoverNode && selected == null) return null;
    const focus = hoverNode?.id ?? selected!;
    const s = new Set<number>([focus]);
    filtered.relations.forEach((r) => {
      if (r.source === focus) s.add(r.target);
      if (r.target === focus) s.add(r.source);
    });
    return s;
  }, [hoverNode, selected, filtered.relations]);

  const linkCurvature = 0;

  const otypes = useMemo(
    () => Array.from(new Set(filtered.objects.map((o) => o.otype))).sort(),
    [filtered.objects],
  );

  const nodeR = (n: GNode) => 2 + Math.min(n.degree, 8) * 0.32;

  const nodeValFn = useCallback(
    (node: GNode) => {
      const base = nodeR(node);
      if (selected === node.id || hoverNode?.id === node.id) return base * 1.35;
      return base;
    },
    [selected, hoverNode],
  );

  const nodeColorFn = useCallback(
    (node: GNode) => {
      const dimmed = neighborIds ? !neighborIds.has(node.id) : false;
      if (dimmed) return "#8a96c8";
      if (connectFrom === node.id) return "#ffcc55";
      if (selected === node.id) return "#ff70d0";
      if (hoverNode?.id === node.id) return "#ffffff";
      return node.color;
    },
    [neighborIds, connectFrom, selected, hoverNode],
  );

  const linkColorFn = useCallback(
    (link: GLink) => {
      if (!neighborIds) return "rgba(184, 200, 255, 0.32)";
      const s = typeof link.source === "object" ? link.source.id : link.source;
      const t = typeof link.target === "object" ? link.target.id : link.target;
      if (neighborIds.has(s) && neighborIds.has(t)) return "#ffffff";
      return "rgba(158, 180, 232, 0.22)";
    },
    [neighborIds],
  );

  const linkWidthFn = useCallback(
    (link: GLink) => {
      if (!neighborIds) return 0.65;
      const s = typeof link.source === "object" ? link.source.id : link.source;
      const t = typeof link.target === "object" ? link.target.id : link.target;
      return neighborIds.has(s) && neighborIds.has(t) ? 1.8 : 0.4;
    },
    [neighborIds],
  );

  const particleCountFn = useCallback(
    (link: GLink) => {
      if (!neighborIds) return 0;
      const s = typeof link.source === "object" ? link.source.id : link.source;
      const t = typeof link.target === "object" ? link.target.id : link.target;
      return neighborIds.has(s) && neighborIds.has(t) ? 1 : 0;
    },
    [neighborIds],
  );

  const fitOverview = useCallback(() => {
    fgRef.current?.zoomToFit(480, OVERVIEW_ZOOM_PADDING);
  }, []);

  const focusNode = (id: number) => {
    const tryFocus = (attempt = 0) => {
      const n = fgData.nodes.find((x) => x.id === id);
      if (!n || n.x == null || n.y == null) {
        if (attempt < 30) requestAnimationFrame(() => tryFocus(attempt + 1));
        return;
      }
      fgRef.current?.centerAt(n.x, n.y, 700);
      fgRef.current?.zoom(Math.min(6, Math.max(2.5, 480 / Math.max(size.w, size.h) * 4)), 700);
    };
    tryFocus();
  };

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || fgData.nodes.length === 0) return;
    const n = fgData.nodes.length;
    const charge = -220 - Math.min(n, 180) * 2.2;
    const linkDist = 72 + Math.min(n, 120) * 0.45;

    fg.d3Force("charge")?.strength(charge).distanceMax(720);
    fg.d3Force("link")?.distance(linkDist).strength(0.55);
    fg.d3Force("center")?.strength(0.018);
    fg.d3Force(
      "collide",
      forceCollide<GNode>()
        .radius((node: GNode) => nodeR(node) + 10)
        .strength(0.85)
        .iterations(2),
    );
    fg.d3ReheatSimulation();
  }, [fgData.nodes.length, fgData.links.length]);

  const handleNodeClick = (id: number) => {
    if (mode === "connect") {
      if (connectFrom === null) {
        setConnectFrom(id);
      } else if (connectFrom !== id) {
        setRelModal({ s: connectFrom, t: id });
        setConnectFrom(null);
      }
    } else {
      setSelected(id);
      focusNode(id);
    }
  };

  // ---------- 操作 ----------
  const doAdd = async () => {
    if (!name.trim()) return message.warning("请输入对象名称");
    await addObject({ category: cat, otype, name, x: 120 + Math.random() * 300, y: 120 + Math.random() * 200 });
    setName("");
    message.success("已添加对象");
    load();
  };

  const doDelete = async (id: number) => {
    await deleteObject(id);
    if (selected === id) setSelected(null);
    load();
  };

  const doSplit = async (id: number) => {
    await splitObject(id);
    message.success("已拆分出新对象");
    load();
  };

  const openEdit = (o: OntObject) => {
    setEditing(o);
    setECat(o.category);
    setEType(o.otype);
    setEName(o.name);
    setEAttrs(Object.entries(o.attributes || {}).map(([k, v]) => ({ k, v: String(v) })));
  };

  const saveEdit = async () => {
    if (!editing) return;
    if (!eName.trim()) return message.warning("名称不能为空");
    const attrs: Record<string, unknown> = {};
    eAttrs.forEach(({ k, v }) => { if (k.trim()) attrs[k.trim()] = v; });
    await updateObject(editing.id, {
      category: eCat, otype: eType || "物体", name: eName.trim(), attributes: attrs,
    });
    setEditing(null);
    message.success("已保存");
    load();
  };

  const doMerge = async () => {
    if (!selected || !mergeTarget) return;
    await mergeObjects(selected, mergeTarget);
    setMergeTarget(null);
    message.success("已合并");
    load();
  };

  const confirmRelation = async () => {
    if (!relModal) return;
    await addRelation({ source: relModal.s, target: relModal.t, label: relLabel || "关联" });
    setRelModal(null);
    setRelLabel("关联");
    message.success("已建立关系");
    load();
  };

  const openRelCausal = (r: OntRelation) => {
    setEditingRel(r);
    setEPolarity(r.polarity || "");
    setEDelay(r.delay_days ?? null);
    setEEvidence(r.evidence_score ?? null);
    setECausal(!!r.is_causal_candidate);
  };

  const saveRelCausal = async () => {
    if (!editingRel || savingRel) return;
    const body = {
      polarity: ePolarity,
      delay_days: eDelay,
      evidence_score: eEvidence,
      is_causal_candidate: eCausal,
    };
    setSavingRel(true);
    try {
      if (isAgeLive) {
        const payload: Parameters<typeof upsertRelationCausal>[0] = {
          label: editingRel.label,
          ...body,
        };
        if (editingRel.db_relation_id) {
          payload.relation_id = editingRel.db_relation_id;
        } else {
          payload.source_age_id = editingRel.source;
          payload.target_age_id = editingRel.target;
          payload.source_name = objById(editingRel.source)?.name;
          payload.target_name = objById(editingRel.target)?.name;
        }
        await upsertRelationCausal(payload);
      } else {
        await updateRelation(editingRel.id, body);
      }
      setEditingRel(null);
      message.success("因果元数据已保存");
      await load(true, displayMode !== "smart", true);
    } catch (e: any) {
      const data = e?.response?.data;
      if (data?.need_import) {
        message.warning(data.error || "请先导入到本体库");
      } else if (e?.code === "ECONNABORTED") {
        message.error("保存超时,请稍后重试");
      } else {
        message.error(data?.error || data?.detail || "保存失败");
      }
      throw e;
    } finally {
      setSavingRel(false);
    }
  };

  const isAgeLive = graph?.source === "age_cypher";

  const doImportAge = async (sourceId?: string) => {
    setImportingAge(true);
    try {
      const sid = sourceId || graph?.lightrag?.source_id;
      const res = await importFromAge(sid);
      message.success(
        `AGE 导入完成:${res.source_name || res.source_id} · ${res.vertices} 顶点,` +
        `新增 ${res.created_objects} 对象、${res.created_relations} 关系`
      );
      await load();
    } catch (e: any) {
      const detail = e?.response?.data?.error || e?.response?.data?.detail;
      const msg = e?.code === "ECONNABORTED"
        ? "AGE 导入超时,请稍后重试(大数据量最多约 15 分钟)"
        : detail || "AGE 图谱导入失败";
      message.error(msg);
    } finally {
      setImportingAge(false);
    }
  };

  const doImportDb = async () => {
    setImportingDb(true);
    try {
      const res = await importFromDb();
      message.success(
        `数仓导入完成:实体 ${res.total_entities}(湖 ${res.lake_entities}/公有 ${res.public_entities}),` +
        `新增对象 ${res.created_objects}、关系 ${res.created_relations}`
      );
      await load(true, displayMode !== "smart");
    } catch (e: any) {
      const detail = e?.response?.data?.error || e?.response?.data?.detail;
      const msg = e?.code === "ECONNABORTED"
        ? "数仓导入超时,请稍后重试"
        : detail || "从数仓导入失败(请确认 PostgreSQL 可用)";
      message.error(msg);
    } finally {
      setImportingDb(false);
    }
  };

  const openData = async (id: number) => {
    const obj = objById(id);
    if (!obj) return;
    setDataOpen(true);
    if (graph?.source === "age_cypher") {
      setObjData({
        object: { id: obj.id, otype: obj.otype, name: obj.name, attributes: obj.attributes },
        source: "age_cypher",
        blocks: [],
        note: "直接来自 AGE Cypher 查询,未导入本地库",
      });
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    try {
      setObjData(await getObjectData(id));
    } catch {
      message.error("读取数据失败");
      setDataOpen(false);
    } finally {
      setDataLoading(false);
    }
  };

  const doExtract = async () => {
    if (!extractText.trim()) return;
    setExtracting(true);
    try {
      const res = await extractGraph(extractText.trim());
      message.success(`抽取:新增 ${res.created_objects} 对象 / ${res.created_relations} 关系`);
      setExtractText("");
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "抽取失败(可能未配置可用 LLM)");
    } finally {
      setExtracting(false);
    }
  };

  const presetOptions = (graph?.presets?.[cat] || []).map((t) => ({ value: t, label: t }));
  const sel = objById(selected);
  const meta = graph?.meta;
  const graphObjectCount = meta?.objects ?? graph?.objects.length ?? 0;
  const graphRelationCount = meta?.relations ?? graph?.relations.length ?? 0;

  const isSampled = displayMode === "smart" && filtered.objects.length < graphObjectCount;
  const isPagedMode = displayMode === "loops" || displayMode === "batch";
  const pageTotal = displayMode === "loops" ? loopBatchCount : nodeBatchCount;
  const pageLabel = displayMode === "loops"
    ? `闭环 ${Math.min(batchIndex + 1, pageTotal)}/${pageTotal} · 本批 ${filtered.loopCount || 0} 个闭环`
    : `分批 ${batchIndex + 1}/${pageTotal}`;

  const goPrevBatch = () => {
    setBatchIndex((i) => Math.max(0, i - 1));
    didFitRef.current = false;
  };
  const goNextBatch = () => {
    setBatchIndex((i) => Math.min(pageTotal - 1, i + 1));
    didFitRef.current = false;
  };

  return (
    <Row gutter={16}>
      <Col xs={24} lg={16}>
        <Card
          size="small"
          title={
            <Space size={8}>
              <span>AGE 图谱</span>
              <Tag color="cyan">平面</Tag>
              {graph?.lightrag?.source_name && (
                <Tag color="gold">{graph.lightrag.source_name}</Tag>
              )}
              {targetGraphName && (
                <Tag color="geekblue">{targetGraphName}</Tag>
              )}
            </Space>
          }
          styles={{ body: { padding: 0 } }}
          extra={
            <Space wrap>
              <Button
                size="small"
                loading={importingDb}
                icon={<DatabaseOutlined />}
                onClick={() => doImportDb()}
              >
                从数仓导入
              </Button>
              <Button
                size="small"
                type="primary"
                loading={importingAge}
                icon={<ShareAltOutlined />}
                onClick={() => doImportAge()}
              >
                导入到本体库
              </Button>
              <Radio.Group
                size="small"
                value={mode}
                onChange={(e) => { setMode(e.target.value); setConnectFrom(null); }}
                optionType="button"
                options={[
                  { label: "选择", value: "select" },
                  { label: "连线", value: "connect" },
                ]}
              />
              <Button size="small" icon={<ReloadOutlined />} onClick={() => load(true, displayMode !== "smart")} loading={loading} />
              <Button size="small" onClick={fitOverview}>总览</Button>
            </Space>
          }
        >
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--lc-border)", background: "#f8fafc" }}>
            <Space wrap size={[12, 8]} style={{ width: "100%" }}>
              <Statistic
                title={<span style={{ fontSize: 11, color: "var(--lc-text-muted)" }}>PG 本图</span>}
                value={pgVertices}
                suffix={
                  <span style={{ fontSize: 12, color: "var(--lc-text-muted)" }}>
                    顶点 · {pgEdges} 边
                  </span>
                }
                valueStyle={{ fontSize: 18, color: "var(--lc-navy)" }}
              />
              <Statistic
                title={<span style={{ fontSize: 11, color: "var(--lc-text-muted)" }}>Cypher 本图</span>}
                value={graphObjectCount}
                suffix={
                  <span style={{ fontSize: 12, color: "var(--lc-text-muted)" }}>
                    / {graphRelationCount} 关系
                  </span>
                }
                valueStyle={{ fontSize: 18, color: "var(--lc-accent-blue, #3D6FA8)" }}
              />
              <Statistic
                title={<span style={{ fontSize: 11, color: "var(--lc-text-muted)" }}>画布</span>}
                value={fgData.nodes.length}
                suffix={
                  <span style={{ fontSize: 12, color: "var(--lc-text-muted)" }}>
                    / {fgData.links.length} 关系
                  </span>
                }
                valueStyle={{ fontSize: 18, color: "var(--lc-text)" }}
              />
              {meta?.scope && (
                <Tag color="green" style={{ marginTop: 18 }}>AGE Cypher 直读</Tag>
              )}
              <Select
                size="small"
                allowClear
                placeholder="类型"
                style={{ width: 110 }}
                value={otypeFilter ?? undefined}
                onChange={(v) => setOtypeFilter(v ?? null)}
                options={otypes.map((t) => ({ value: t, label: t }))}
              />
              <Input
                size="small"
                allowClear
                prefix={<FilterOutlined style={{ color: "#6b7194" }} />}
                placeholder="搜索名称/类型"
                style={{ width: 160 }}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              <Radio.Group
                size="small"
                value={displayMode}
                onChange={(e) => handleDisplayModeChange(e.target.value)}
                optionType="button"
                options={[
                  { label: "智能抽样", value: "smart" },
                  { label: "闭环浏览", value: "loops" },
                  { label: "分批浏览", value: "batch" },
                ]}
              />
              {isPagedMode && (
                <Space size={4}>
                  <Button size="small" disabled={batchIndex <= 0} onClick={goPrevBatch}>上一批</Button>
                  <Tag>{pageLabel}</Tag>
                  <Button size="small" disabled={batchIndex >= pageTotal - 1} onClick={goNextBatch}>下一批</Button>
                </Space>
              )}
            </Space>
            {meta && (
              <Typography.Text type="secondary" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
                本图 {targetGraphName} · PG 共 {pgVertices} 顶点 / {pgEdges} 边 ·
                Cypher 返回 {graphObjectCount} / {graphRelationCount}
                {meta.truncated ? "（已截断,可调大 limit）" : ""}
              </Typography.Text>
            )}
            {importingAge && (
              <Alert
                style={{ marginTop: 8 }}
                type="info"
                showIcon
                banner
                message="正在导入到本地本体库(可选,看图谱无需等待)…"
              />
            )}
            {isAgeLive && (
              <Alert
                style={{ marginTop: 8 }}
                type="warning"
                showIcon
                banner
                message="AGE 直读模式：编辑因果元数据将自动同步到本体库(无需先全量导入)。"
              />
            )}
            {isSampled && (
              <Alert
                style={{ marginTop: 8 }}
                type="info"
                showIcon
                banner
                message={`智能抽样：展示 ${fgData.nodes.length} 个高连接节点（共 ${graphObjectCount}）；选中节点可展开邻域，或切换「显示全部」`}
              />
            )}
            {displayMode === "loops" && loopCandidates.length === 0 && (
              <Alert
                style={{ marginTop: 8 }}
                type="info"
                showIcon
                banner
                message="当前子图未识别到闭环，已自动按节点分批展示（可切换「分批浏览」）"
              />
            )}
            {displayMode === "loops" && loopCandidates.length > 0 && (
              <Alert
                style={{ marginTop: 8 }}
                type="info"
                showIcon
                banner
                message={`闭环浏览：共识别 ${loopCandidates.length} 个闭环，每批展示 ${LOOPS_PER_BATCH} 个 · 本画布 ${fgData.nodes.length} 节点`}
              />
            )}
            {displayMode === "batch" && (
              <Alert
                style={{ marginTop: 8 }}
                type="info"
                showIcon
                banner
                message={`分批浏览：按连通子图扩展，每批约 ${NODES_PER_BATCH} 个节点 · 共 ${nodeBatchCount} 批 · 全图 ${baseScope.objects.length} 节点`}
              />
            )}
          </div>
          {mode === "connect" && (
            <div style={{ padding: "6px 12px", background: "rgba(184,134,59,0.12)", color: "#8a6a35", fontSize: 12 }}>
              连线模式:先点起点,再点终点 —— {connectFrom ? `已选「${objById(connectFrom)?.name}」` : "请点起点"}
            </div>
          )}
          <div
            ref={wrapRef}
            style={{
              position: "relative",
              height: "calc(100vh - 300px)",
              minHeight: 560,
              background: "linear-gradient(180deg, #f4f7fb 0%, #e8eef6 100%)",
              overflow: "hidden",
            }}
          >
            <div
              aria-hidden
              style={{
                position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0,
                background: `
                  radial-gradient(ellipse 80% 60% at 50% 50%, rgba(61,111,168,0.08) 0%, transparent 70%),
                  linear-gradient(rgba(26,39,64,0.04) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(26,39,64,0.04) 1px, transparent 1px)
                `,
                backgroundSize: "auto, 48px 48px, 48px 48px",
              }}
            />
            {loading && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 2,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(245,247,251,0.72)",
              }}>
                <Spin tip="加载图谱…" />
              </div>
            )}
            {!loading && !importingAge && fgData.nodes.length === 0 && (
              <Empty
                style={{ marginTop: 120 }}
                description={pgVertices > 0 ? "正在等待 AGE 同步,或点击「同步 AGE」" : "PG 中该 AGE 图暂无数据"}
              />
            )}
            {fgData.nodes.length > 0 && (
              <>
                <Typography.Text
                  type="secondary"
                  style={{
                    position: "absolute", left: 12, bottom: 10, zIndex: 1,
                    fontSize: 11, pointerEvents: "none",
                  }}
                >
                  拖动画布平移 · 滚轮缩放 · 点击节点选中 · 可拖动节点
                </Typography.Text>
                <ForceGraph2D
                  ref={fgRef}
                  width={size.w}
                  height={size.h}
                  graphData={fgData}
                  backgroundColor="transparent"
                  enableNodeDrag={fgData.nodes.length < 200}
                  nodeId="id"
                  nodeColor={nodeColorFn}
                  nodeVal={nodeValFn}
                  nodeLabel={(n) => {
                    const node = n as GNode;
                    return `<div style="padding:6px 10px;background:#fff;border:1px solid #d7e0ec;border-radius:8px;font-size:12px;color:#1a2740;max-width:240px;box-shadow:0 4px 16px rgba(26,39,64,0.12);">
                      <b style="color:#0b2144">${node.name}</b><br/><span style="color:#5c6b84">${node.otype}</span>
                      ${node.degree ? `<br/><span style="color:#3d6fa8">连接 ${node.degree}</span>` : ""}
                    </div>`;
                  }}
                  linkColor={linkColorFn}
                  linkWidth={linkWidthFn}
                  linkCurvature={linkCurvature}
                  linkDirectionalParticles={particleCountFn}
                  linkDirectionalParticleWidth={2}
                  linkDirectionalParticleSpeed={0.004}
                  linkDirectionalParticleColor={() => "#c8e8ff"}
                  linkDirectionalArrowLength={displayMode === "batch" ? 3.5 : 4}
                  linkDirectionalArrowRelPos={0.92}
                  linkDirectionalArrowColor={(link: GLink) => linkColorFn(link)}
                  onNodeHover={(n) => {
                    const id = (n as GNode | null)?.id ?? null;
                    if (hoverIdRef.current === id) return;
                    hoverIdRef.current = id;
                    setHoverNode(n as GNode | null);
                  }}
                  onNodeClick={(n) => handleNodeClick((n as GNode).id)}
                  onBackgroundClick={() => {
                    hoverIdRef.current = null;
                    setHoverNode(null);
                    if (mode === "select") setSelected(null);
                  }}
                  warmupTicks={80}
                  cooldownTicks={120}
                  d3AlphaDecay={0.028}
                  d3VelocityDecay={0.35}
                  onEngineStop={() => {
                    if (didFitRef.current) return;
                    didFitRef.current = true;
                    const focusId = pendingFocusRef.current;
                    if (focusId != null && fgData.nodes.some((n) => n.id === focusId)) {
                      pendingFocusRef.current = null;
                      setSelected(focusId);
                      focusNode(focusId);
                    } else {
                      fitOverview();
                    }
                  }}
                />
              </>
            )}
          </div>
        </Card>
      </Col>

      <Col xs={24} lg={8}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Card size="small" title={<><PlusOutlined /> 添加对象</>}>
            <Space direction="vertical" style={{ width: "100%" }} size={8}>
              <Radio.Group
                value={cat}
                onChange={(e) => {
                  setCat(e.target.value);
                  const first = graph?.presets?.[e.target.value as "physical" | "virtual"]?.[0];
                  if (first) setOtype(first);
                }}
                optionType="button"
                options={[
                  { label: "物理", value: "physical" },
                  { label: "虚拟", value: "virtual" },
                ]}
              />
              <Select
                style={{ width: "100%" }}
                value={otype}
                onChange={setOtype}
                options={presetOptions}
                showSearch
                placeholder="选择或输入类型"
                popupRender={(menu) => <>{menu}</>}
              />
              <Input placeholder="对象名称,如:张三 / 运营岗 / 客户A"
                value={name} onChange={(e) => setName(e.target.value)} onPressEnter={doAdd} />
              <Button type="primary" icon={<PlusOutlined />} onClick={doAdd} block>add</Button>
            </Space>
          </Card>

          <Card size="small" title={<><ApiOutlined /> 选中对象</>}>
            {!sel && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="在画布中点选一个对象" />}
            {sel && (
              <Space direction="vertical" style={{ width: "100%" }} size={8}>
                <div>
                  <Tag color={sel.category === "physical" ? "blue" : "gold"}>
                    {sel.category === "physical" ? "物理" : "虚拟"}
                  </Tag>
                  <Tag>{sel.otype}</Tag>
                  <b>{sel.name}</b>
                </div>
                <Space wrap>
                  <Button type="primary" icon={<DatabaseOutlined />} onClick={() => openData(sel.id)}>查看数据</Button>
                  <Button type="primary" ghost icon={<EditOutlined />} onClick={() => openEdit(sel)}>编辑</Button>
                  <Button icon={<SplitCellsOutlined />} onClick={() => doSplit(sel.id)}>split</Button>
                  <Button danger icon={<DeleteOutlined />} onClick={() => doDelete(sel.id)}>delete</Button>
                </Space>
                <Divider style={{ margin: "6px 0" }} />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  merge:把下面选中的对象合并进「{sel.name}」
                </Typography.Text>
                <Space.Compact style={{ width: "100%" }}>
                  <Select
                    style={{ flex: 1 }}
                    placeholder="选择要并入的对象"
                    value={mergeTarget ?? undefined}
                    onChange={setMergeTarget}
                    options={(filtered.objects || [])
                      .filter((o) => o.id !== sel.id)
                      .map((o) => ({ value: o.id, label: `${o.otype}·${o.name}` }))}
                  />
                  <Button icon={<MergeCellsOutlined />} onClick={doMerge} disabled={!mergeTarget}>
                    merge
                  </Button>
                </Space.Compact>
              </Space>
            )}
          </Card>

          <Card size="small" title={<><ThunderboltOutlined /> AI 抽取(自然语言→图谱)</>}>
            {!graph?.llm && (
              <Alert style={{ marginBottom: 8 }} type="warning" showIcon
                message="当前 LLM 不可用(需在 .env 填正确的网关 base_url)。可先手动建图。" />
            )}
            <Input.TextArea rows={3} value={extractText}
              onChange={(e) => setExtractText(e.target.value)}
              placeholder="例:张三是运营岗,负责客户A的售后流程,使用A区工位。" />
            <Button style={{ marginTop: 8 }} block loading={extracting}
              icon={<ThunderboltOutlined />} onClick={doExtract}>
              抽取并加入图谱
            </Button>
          </Card>

          {filtered.relations.length > 0 && (
            <Card size="small" title="关系列表" styles={{ body: { maxHeight: 280, overflow: "auto" } }}>
              <List
                size="small"
                pagination={{ pageSize: 8, size: "small", hideOnSinglePage: true }}
                dataSource={
                  selected
                    ? filtered.relations.filter((r) => r.source === selected || r.target === selected)
                    : filtered.relations
                }
                renderItem={(r) => {
                  const s = objById(r.source);
                  const t = objById(r.target);
                  return (
                    <List.Item
                      actions={[
                        <Button
                          key="e"
                          size="small"
                          type="link"
                          icon={<EditOutlined />}
                          onClick={() => openRelCausal(r)}
                        >
                          编辑
                        </Button>,
                        !isAgeLive && (
                          <Button key="d" size="small" type="link" danger
                            icon={<DeleteOutlined />} onClick={() => deleteRelation(r.id).then(() => load())}>
                            删除
                          </Button>
                        ),
                      ].filter(Boolean)}>
                      <span style={{ fontSize: 12 }}>
                        {s?.name} <Tag color="cyan">{r.label}</Tag> {t?.name}
                        {r.is_causal_candidate && <Tag color="gold" style={{ marginLeft: 4 }}>因果</Tag>}
                        {r.polarity && <Tag style={{ marginLeft: 2 }}>{r.polarity}</Tag>}
                      </span>
                    </List.Item>
                  );
                }} />
            </Card>
          )}
        </Space>
      </Col>

      <Modal
        title="CausalLink 元数据"
        open={!!editingRel}
        onOk={saveRelCausal}
        onCancel={() => !savingRel && setEditingRel(null)}
        okText="保存"
        confirmLoading={savingRel}
        maskClosable={!savingRel}
        destroyOnClose
      >
        {editingRel && (
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Typography.Text type="secondary">
              关系 #{editingRel.id}: {objById(editingRel.source)?.name} → {objById(editingRel.target)?.name}
            </Typography.Text>
            <div>
              <Typography.Text type="secondary">极性</Typography.Text>
              <br />
              <Radio.Group
                value={ePolarity}
                onChange={(e) => setEPolarity(e.target.value)}
                optionType="button"
                options={[
                  { label: "未设", value: "" },
                  { label: "正 (+)", value: "+" },
                  { label: "负 (-)", value: "-" },
                ]}
              />
            </div>
            <div>
              <Typography.Text type="secondary">延迟(天)</Typography.Text>
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                value={eDelay ?? undefined}
                onChange={(v) => setEDelay(v)}
                placeholder="如 30"
              />
            </div>
            <div>
              <Typography.Text type="secondary">证据分 (0~100)</Typography.Text>
              <InputNumber
                style={{ width: "100%" }}
                min={0}
                max={100}
                value={eEvidence ?? undefined}
                onChange={(v) => setEEvidence(v)}
              />
            </div>
            <div>
              <Switch checked={eCausal} onChange={setECausal} />
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>CausalLink 候选</Typography.Text>
            </div>
          </Space>
        )}
      </Modal>

      <Modal
        title="编辑对象"
        open={!!editing}
        onOk={saveEdit}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <Typography.Text type="secondary">大类</Typography.Text>
            <br />
            <Radio.Group
              value={eCat}
              onChange={(e) => setECat(e.target.value)}
              optionType="button"
              options={[
                { label: "物理", value: "physical" },
                { label: "虚拟", value: "virtual" },
              ]}
            />
          </div>
          <div>
            <Typography.Text type="secondary">类型(可选择预设或自定义)</Typography.Text>
            <AutoComplete
              style={{ width: "100%" }}
              value={eType}
              onChange={setEType}
              options={(graph?.presets?.[eCat] || []).map((t) => ({ value: t }))}
              placeholder="如:人 / 岗位 / 流程"
            />
          </div>
          <div>
            <Typography.Text type="secondary">名称</Typography.Text>
            <Input value={eName} onChange={(e) => setEName(e.target.value)} onPressEnter={saveEdit} />
          </div>
          <div>
            <Typography.Text type="secondary">属性</Typography.Text>
            <Space direction="vertical" style={{ width: "100%" }} size={6}>
              {eAttrs.map((row, i) => (
                <Space.Compact key={i} style={{ width: "100%" }}>
                  <Input
                    style={{ width: "40%" }}
                    placeholder="键"
                    value={row.k}
                    onChange={(e) => {
                      const next = [...eAttrs];
                      next[i] = { ...next[i], k: e.target.value };
                      setEAttrs(next);
                    }}
                  />
                  <Input
                    style={{ width: "50%" }}
                    placeholder="值"
                    value={row.v}
                    onChange={(e) => {
                      const next = [...eAttrs];
                      next[i] = { ...next[i], v: e.target.value };
                      setEAttrs(next);
                    }}
                  />
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => setEAttrs(eAttrs.filter((_, j) => j !== i))}
                  />
                </Space.Compact>
              ))}
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={() => setEAttrs([...eAttrs, { k: "", v: "" }])}
                block
              >
                添加属性
              </Button>
            </Space>
          </div>
        </Space>
      </Modal>

      <Drawer
        title={
          objData ? (
            <Space>
              <DatabaseOutlined />
              <span>{objData.object.otype} · {objData.object.name}</span>
              <Tag color={objData.source === "postgres" ? "green" : "orange"}>
                {objData.source === "postgres" ? "PostgreSQL" : "数据底座不可用"}
              </Tag>
            </Space>
          ) : "对象数据"
        }
        open={dataOpen}
        onClose={() => { setDataOpen(false); setObjData(null); }}
        width={640}
      >
        {dataLoading && (
          <div style={{ textAlign: "center", padding: 48 }}><Spin /></div>
        )}
        {!dataLoading && objData && (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            {objData.object.attributes && Object.keys(objData.object.attributes).length > 0 && (
              <Card size="small" title="图谱属性">
                <Space wrap>
                  {Object.entries(objData.object.attributes).map(([k, v]) => (
                    <Tag key={k}>{k}: {String(v)}</Tag>
                  ))}
                </Space>
              </Card>
            )}
            {objData.blocks.map((b) => (
              <Card size="small" title={b.title} key={b.title}>
                <Table
                  size="small"
                  rowKey={(_, i) => String(i)}
                  pagination={false}
                  scroll={{ x: true }}
                  dataSource={b.rows}
                  columns={Object.keys(b.rows[0] || {}).map((k) => ({
                    title: k,
                    dataIndex: k,
                    render: (v: unknown) => {
                      if (v === null || v === undefined) return "—";
                      if (k === "环比" && typeof v === "number") {
                        return (
                          <Tag color={v >= 0 ? "green" : "red"}>
                            {(v * 100).toFixed(1)}%
                          </Tag>
                        );
                      }
                      if (k === "级别") {
                        const s = String(v);
                        return (
                          <Tag color={s === "critical" ? "red" : s === "warning" ? "orange" : "blue"}>
                            {s}
                          </Tag>
                        );
                      }
                      return String(v);
                    },
                  }))}
                />
              </Card>
            ))}
            {objData.blocks.length === 0 && (
              <Empty description={objData.note || "暂无关联数据"} />
            )}
          </Space>
        )}
      </Drawer>

      <Modal
        title="建立关系"
        open={!!relModal}
        onOk={confirmRelation}
        onCancel={() => { setRelModal(null); setRelLabel("关联"); }}
        okText="创建"
        cancelText="取消"
      >
        {relModal && (
          <Space direction="vertical" style={{ width: "100%" }}>
            <div>
              <Tag color="orange">{objById(relModal.s)?.name}</Tag> →{" "}
              <Tag color="blue">{objById(relModal.t)?.name}</Tag>
            </div>
            <Input placeholder="关系名,如:使用 / 负责 / 属于"
              value={relLabel} onChange={(e) => setRelLabel(e.target.value)} onPressEnter={confirmRelation} />
          </Space>
        )}
      </Modal>
    </Row>
  );
}
