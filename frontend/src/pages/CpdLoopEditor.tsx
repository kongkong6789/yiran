import {
  ArrowLeftOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  LinkOutlined,
  PlusOutlined,
  SaveOutlined,
  SendOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { App, Button, Empty, Form, Input, Modal, Radio, Select, Space, Spin, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  agentChat,
  getMetricContracts,
  listKnowledgeBases,
  type KnowledgeBaseItem,
} from "../api/client";
import { CpdExplainTiles } from "../components/CpdExplainTiles";
import { type CpdNamedLoop } from "../loopsHierarchy/cpdCatalog";
import {
  findMergedCpdLoop,
  formatNodeBinding,
  loadCpdDraft,
  normalizeDraftGraph,
  normalizeNodeBinding,
  persistCpdDraftAndSync,
  type CpdDraftEdge as DraftEdge,
  type CpdDraftNode as DraftNode,
  type CpdLoopDraft as LoopDraft,
  type CpdNodeBindRole,
  type CpdNodeBindType,
  type CpdNodeBinding,
  type CpdNodeConnectorKey,
} from "../loopsHierarchy/cpdDraftStore";
import {
  applyAiBindings,
  autoBindNodesLocal,
  buildAutoBindPrompt,
  extractBindingsFromAi,
} from "../loopsHierarchy/cpdAutoBind";
import { getCpdExplain } from "../loopsHierarchy/cpdLoopExplain";
import { getLevelModel } from "../loopsHierarchy/data";
import { LEVEL_LABEL, LEVEL_ORDER, type LoopLevel } from "../loopsHierarchy/types";
import { graphTooltipStyle, useVisualizationTheme } from "../theme/visualization";

type ChatMessage = { id: string; role: "user" | "assistant"; content: string; model?: string };

type MetricContractOption = {
  id: number;
  metric_id: string;
  name: string;
  unit?: string;
  version?: string;
};

const CONNECTOR_OPTIONS: { value: CpdNodeConnectorKey; label: string }[] = [
  { value: "jackyun", label: "吉客云" },
  { value: "kingdee", label: "金蝶" },
];

const CONNECTOR_ACTIONS: Record<CpdNodeConnectorKey, { value: string; label: string; roleHint: CpdNodeBindRole }[]> = {
  jackyun: [
    { value: "jackyun.sync", label: "同步商品/订单 → DataLake", roleHint: "observe" },
    { value: "jackyun.inventory", label: "查询库存", roleHint: "observe" },
    { value: "jackyun.query", label: "开放查询", roleHint: "observe" },
  ],
  kingdee: [
    { value: "kingdee.status", label: "连接探活", roleHint: "observe" },
    { value: "kingdee.bill_query", label: "单据查询（只读）", roleHint: "observe" },
    { value: "purchase.create", label: "创建采购单（需闸机确认）", roleHint: "act" },
  ],
};

const BIND_TYPE_OPTIONS: { value: CpdNodeBindType; label: string }[] = [
  { value: "none", label: "暂不绑定" },
  { value: "metric", label: "数据库指标（DataLake）" },
  { value: "connector", label: "吉客云 / 金蝶接口" },
  { value: "knowledge", label: "知识库" },
];

const ROLE_OPTIONS: { value: CpdNodeBindRole; label: string }[] = [
  { value: "observe", label: "Observe · 看数" },
  { value: "orient", label: "Orient · 解释" },
  { value: "act", label: "Act · 执行" },
];

type NodeFormValues = {
  code: string;
  name: string;
  bind_type: CpdNodeBindType;
  role: CpdNodeBindRole;
  metric_id?: string;
  connector?: CpdNodeConnectorKey;
  connector_action?: string;
  knowledge_base_id?: number;
  knowledge_query?: string;
  note?: string;
};

function bindingFromForm(
  values: NodeFormValues,
  metrics: MetricContractOption[],
  knowledgeBases: KnowledgeBaseItem[],
): CpdNodeBinding | undefined {
  const bind_type = values.bind_type || "none";
  if (bind_type === "none") return { bind_type: "none", role: "observe" };
  const metric = metrics.find((m) => m.metric_id === values.metric_id);
  const kb = knowledgeBases.find((k) => k.id === values.knowledge_base_id);
  return normalizeNodeBinding({
    bind_type,
    role: values.role || "observe",
    metric_id: values.metric_id,
    metric_name: metric?.name,
    connector: values.connector,
    connector_action: values.connector_action,
    knowledge_base_id: values.knowledge_base_id,
    knowledge_base_name: kb?.name,
    knowledge_query: values.knowledge_query,
    note: values.note,
  });
}

type EditorCatalogLoop = {
  code: string;
  name: string;
  kind: CpdNamedLoop["kind"];
  chain: string;
  leverage: string;
  steps?: string[];
  stockPath?: string[];
  edgeIds?: string[];
  explain?: {
    stocks: string;
    flows: string;
    delays: string;
    behavior: string;
    intervention: string;
  };
  level: LoopLevel;
};

type GNode = DraftNode & {
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  val: number;
  color: string;
};

type GLink = {
  id: string;
  source: string | GNode;
  target: string | GNode;
  label: string;
  polarity: "+" | "-";
};

const KIND_COLOR: Record<CpdNamedLoop["kind"], string> = {
  R: "#ea580c",
  B: "#2563eb",
  C: "#7c3aed",
};

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** 图谱侧栏非公司回路会带「品牌·R-B1」前缀，编辑页要用裸 code */
function normalizeLoopCode(loopCode: string): string {
  const raw = decodeURIComponent(loopCode).trim();
  const labels = Object.values(LEVEL_LABEL);
  for (const label of labels) {
    const prefix = `${label}·`;
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  // 兼容英文层名或旧格式 brand·R-B1
  const m = raw.match(/^[a-zA-Z\u4e00-\u9fa5]+[·.](.+)$/);
  if (m && /^(R|B|C)[-A-Z0-9]+$/i.test(m[1])) return m[1];
  return raw;
}

function parseLevelParam(raw?: string | null): LoopLevel | null {
  if (!raw) return null;
  const v = decodeURIComponent(raw).trim().toLowerCase();
  if ((LEVEL_ORDER as string[]).includes(v)) return v as LoopLevel;
  const byLabel = (Object.entries(LEVEL_LABEL) as [LoopLevel, string][])
    .find(([, label]) => label === raw || `${label}层` === raw);
  return byLabel?.[0] || null;
}

function resolveLayerLoop(level: LoopLevel, code: string, loopCode: string): EditorCatalogLoop | null {
  if (level === "company") return null;
  const model = getLevelModel(level);
  const loop = model.loops.find((item) => (
    item.code === code
    || item.code === loopCode
    || `${LEVEL_LABEL[level]}·${item.code}` === decodeURIComponent(loopCode)
  ));
  if (!loop) return null;
  return {
    code: loop.code,
    name: loop.name,
    kind: loop.kind,
    chain: loop.path,
    leverage: `${LEVEL_LABEL[level]}层杠杆优化`,
    steps: [],
    stockPath: [],
    edgeIds: [...(loop.edgeIds || [])],
    explain: {
      stocks: model.stocks
        .filter((s) => (loop.edgeIds || []).some((eid) => {
          const f = model.flows.find((x) => x.id === eid);
          return f && (f.from === s.id || f.to === s.id);
        }))
        .map((s) => s.label)
        .join("、"),
      flows: (loop.edgeIds || [])
        .map((eid) => model.flows.find((f) => f.id === eid)?.label)
        .filter(Boolean)
        .join("、"),
      delays: "",
      behavior: loop.path,
      intervention: `${LEVEL_LABEL[level]}层优先从本回路关键存量入手`,
    },
    level,
  };
}

function resolveLoopCatalog(loopCode?: string, preferredLevel?: LoopLevel | null): EditorCatalogLoop | null {
  if (!loopCode) return null;
  const code = normalizeLoopCode(loopCode);

  if (preferredLevel === "company" || !preferredLevel) {
    const companyLoop = findMergedCpdLoop(code) || findMergedCpdLoop(loopCode);
    if (companyLoop) {
      return {
        ...companyLoop,
        chain: companyLoop.chain,
        leverage: companyLoop.leverage,
        level: "company",
      };
    }
    if (preferredLevel === "company") return null;
  }

  if (preferredLevel) {
    return resolveLayerLoop(preferredLevel, code, loopCode);
  }

  for (const level of LEVEL_ORDER) {
    if (level === "company") continue;
    const found = resolveLayerLoop(level, code, loopCode);
    if (found) return found;
  }
  return null;
}

function catalogGraph(loop: EditorCatalogLoop): { nodes: DraftNode[]; edges: DraftEdge[] } {
  const model = getLevelModel(loop.level);
  const byId = new Map(model.stocks.map((s) => [s.id, s]));
  const path = (loop.stockPath || []).filter((id) => byId.has(id));
  const ids = path.length
    ? path
    : [...new Set((loop.edgeIds || []).flatMap((eid) => {
      const f = model.flows.find((x) => x.id === eid);
      return f ? [f.from, f.to] : [];
    }))];

  const nodes: DraftNode[] = ids.map((id) => {
    const stock = byId.get(id);
    return {
      id,
      code: stock?.code || id.toUpperCase(),
      name: stock?.label || id,
    };
  });
  const idSet = new Set(ids);
  const edges: DraftEdge[] = (loop.edgeIds || [])
    .map((eid) => model.flows.find((f) => f.id === eid))
    .filter((f): f is NonNullable<typeof f> => Boolean(f && idSet.has(f.from) && idSet.has(f.to)))
    .map((f) => ({
      id: f.id,
      from: f.from,
      to: f.to,
      label: f.label || (f.polarity === "-" ? "抑制" : "促进"),
      polarity: f.polarity,
    }));
  return { nodes, edges };
}

function draftFromCatalog(loop: EditorCatalogLoop): LoopDraft {
  const explain = loop.explain || getCpdExplain(loop.code) || {
    stocks: "",
    flows: "",
    delays: "",
    behavior: "",
    intervention: "",
  };
  const graph = catalogGraph(loop);
  return {
    code: loop.code,
    name: loop.name,
    kind: loop.kind,
    chain: loop.chain,
    leverage: loop.leverage,
    stockPath: graph.nodes.map((n) => n.id),
    edgeIds: graph.edges.map((e) => e.id),
    steps: [...(loop.steps || [])],
    nodes: graph.nodes,
    edges: graph.edges,
    explain: {
      stocks: explain.stocks || "",
      flows: explain.flows || "",
      delays: explain.delays || "",
      behavior: explain.behavior || "",
      intervention: explain.intervention || "",
    },
    notes: [],
    level: loop.level,
  };
}

function loadDraft(code: string, fallback: LoopDraft): LoopDraft {
  const parsed = loadCpdDraft(code);
  if (!parsed) return fallback;
  return normalizeDraftGraph({
    ...fallback,
    ...parsed,
    explain: {
      ...fallback.explain,
      ...parsed.explain,
    },
    nodes: parsed.nodes.length ? parsed.nodes : fallback.nodes,
    edges: parsed.edges.length ? parsed.edges : fallback.edges,
    stockPath: parsed.nodes.length ? parsed.nodes.map((n) => n.id) : fallback.stockPath,
    edgeIds: parsed.edges.length ? parsed.edges.map((e) => e.id) : fallback.edgeIds,
    steps: parsed.steps?.length ? parsed.steps : fallback.steps,
    notes: Array.isArray(parsed.notes) ? parsed.notes : fallback.notes,
  });
}

function syncPathFields(draft: LoopDraft): LoopDraft {
  return {
    ...draft,
    stockPath: draft.nodes.map((n) => n.id),
    edgeIds: draft.edges.map((e) => e.id),
  };
}

function extractJsonPatch(text: string): Partial<LoopDraft> | null {
  const match = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/\{[\s\S]*"explain"[\s\S]*\}/);
  if (!match) return null;
  try {
    const raw = match[1] || match[0];
    return JSON.parse(raw) as Partial<LoopDraft>;
  } catch {
    return null;
  }
}

function extractQuotedName(text: string): string | null {
  const m = text.match(/[「『"']([^」』"']{1,32})[」』"']/)
    || text.match(/(?:叫[做为]?|命名为|节点)\s*([\u4e00-\u9fa5A-Za-z0-9_]{2,24})/);
  return m?.[1]?.trim() || null;
}

function looksLikeAddNode(text: string): boolean {
  const t = text.trim();
  if (/删|删除|去掉|移除/.test(t)) return false;
  if (/(?:加|新增|增加).{0,12}(?:节点|存量|stock)/i.test(t)) return true;
  if (/(?:按你说|按上面|就这样|帮我).{0,8}(?:加|上)|(?:加上|加进去|加一下)/.test(t)) return true;
  return false;
}

function appendNode(
  draft: LoopDraft,
  name: string,
  label = "新增关联",
): { draft: LoopDraft; code: string; linkedFrom?: string } {
  const code = `X${draft.nodes.length + 1}`;
  const id = `custom_${code.toLowerCase()}_${Math.random().toString(36).slice(2, 5)}`;
  const last = draft.nodes[draft.nodes.length - 1];
  let next: LoopDraft = {
    ...draft,
    explain: { ...draft.explain },
    notes: [...draft.notes],
    nodes: [...draft.nodes, { id, code, name }],
    edges: [...draft.edges],
  };
  if (last) {
    next.edges = [
      ...draft.edges,
      { id: uid("e"), from: last.id, to: id, label, polarity: "+" },
    ];
  }
  next.explain.stocks = draft.explain.stocks
    ? `${draft.explain.stocks}、${name}`
    : name;
  next.notes.unshift(`已在图中新增节点 ${code}「${name}」`);
  next = syncPathFields(next);
  return { draft: next, code, linkedFrom: last?.code };
}

function applyLocalAdvice(
  instruction: string,
  draft: LoopDraft,
  priorAssistant = "",
): { assistant: string; draft: LoopDraft } {
  const text = instruction.trim();
  let next: LoopDraft = {
    ...draft,
    explain: { ...draft.explain },
    notes: [...draft.notes],
    nodes: [...draft.nodes],
    edges: [...draft.edges],
  };

  if (looksLikeAddNode(text)) {
    const name = extractQuotedName(text)
      || extractQuotedName(priorAssistant)
      || "自定义存量";
    const added = appendNode(draft, name);
    return {
      assistant: `已在右侧回路图加入节点 ${added.code}「${name}」${added.linkedFrom ? `，并连到 ${added.linkedFrom}` : ""}。可点节点改名字，点连线改标签；工具栏可继续加节点/连线/删除。`,
      draft: added.draft,
    };
  }

  if (/干预|杠杆|优化|建议/.test(text)) {
    next.notes.unshift(`优化建议：优先落在「${draft.leverage}」`);
    if (/延迟|周期/.test(text)) {
      next.explain.delays = `${draft.explain.delays}；可尝试缩短反馈周期以增强回路灵敏度。`;
    }
    if (/干预|动作/.test(text)) {
      next.explain.intervention = `${draft.explain.intervention}；结合对话：${text.slice(0, 48)}`;
    }
    return {
      assistant: [
        `针对 ${draft.code}「${draft.name}」，建议优先从杠杆点入手：${draft.leverage}。`,
        "",
        "右侧图可直接点节点/连线改文字，也可用「加节点」「连线」增删结构。",
        "确认时直接说「按你说的加上」即可真正改图。",
      ].join("\n"),
      draft: next,
    };
  }

  return {
    assistant: [
      `当前编辑 ${draft.code}「${draft.name}」。`,
      "",
      "右侧图：点击节点改名称，点击连线改标签；工具栏可加节点、连线、删除。",
      "对话也可说「加一个叫『现金缓冲』的节点」，或建议后说「按你说的加上」。",
    ].join("\n"),
    draft: next,
  };
}

function buildGraphData(
  draft: LoopDraft,
  size?: { w: number; h: number },
): { nodes: GNode[]; links: GLink[] } {
  const color = KIND_COLOR[draft.kind];
  const n = Math.max(draft.nodes.length, 1);
  const w = size?.w || 640;
  const h = size?.h || 420;
  // 按画布尺寸铺开，避免点挤在中间导致 zoomToFit 后整图偏小
  const r = Math.max(150, Math.min(w, h) * 0.34, 52 + n * 32);
  const cx = w * 0.5;
  const cy = h * 0.5;
  const nodes: GNode[] = draft.nodes.map((node, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return {
      ...node,
      fx: cx + r * Math.cos(a),
      fy: cy + r * Math.sin(a),
      val: 18,
      color,
    };
  });
  const links: GLink[] = draft.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    label: e.label,
    polarity: e.polarity,
  }));
  return { nodes, links };
}

function LoopPreview({
  draft,
  onChange,
}: {
  draft: LoopDraft;
  onChange: (next: LoopDraft) => void;
}) {
  const { message, modal } = App.useApp();
  const visualTheme = useVisualizationTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>();
  const [size, setSize] = useState({ w: 720, h: 520 });
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [nodeModal, setNodeModal] = useState<DraftNode | null>(null);
  const [edgeModal, setEdgeModal] = useState<DraftEdge | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nodeForm] = Form.useForm<NodeFormValues>();
  const [edgeForm] = Form.useForm<{ label: string; polarity: "+" | "-" }>();
  const [addForm] = Form.useForm<{ code: string; name: string }>();
  const [metrics, setMetrics] = useState<MetricContractOption[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [bindLoading, setBindLoading] = useState(false);
  const [autoBinding, setAutoBinding] = useState(false);
  const bindType = Form.useWatch("bind_type", nodeForm);
  const connectorKey = Form.useWatch("connector", nodeForm) as CpdNodeConnectorKey | undefined;

  const data = useMemo(() => buildGraphData(draft, size), [draft, size]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({
        w: Math.max(360, Math.floor(r.width)),
        h: Math.max(420, Math.floor(r.height)),
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => fgRef.current?.zoomToFit?.(280, 36), 80);
    return () => window.clearTimeout(t);
  }, [data.nodes.length, data.links.length, size.w, size.h]);

  useEffect(() => {
    let alive = true;
    setBindLoading(true);
    Promise.all([
      getMetricContracts().catch(() => ({ results: [] })),
      listKnowledgeBases().catch(() => [] as KnowledgeBaseItem[]),
    ]).then(([contractRes, kbRes]) => {
      if (!alive) return;
      const rows = Array.isArray(contractRes)
        ? contractRes
        : (contractRes as { results?: MetricContractOption[] })?.results || [];
      setMetrics(rows.map((row) => ({
        id: Number(row.id) || 0,
        metric_id: String(row.metric_id || ""),
        name: String(row.name || row.metric_id || ""),
        unit: row.unit ? String(row.unit) : undefined,
        version: row.version ? String(row.version) : undefined,
      })).filter((row) => row.metric_id));
      setKnowledgeBases(Array.isArray(kbRes) ? kbRes : []);
    }).finally(() => {
      if (alive) setBindLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const openEditNode = (node: DraftNode) => {
    setSelectedEdgeId(null);
    setSelectedNodeId(node.id);
    setNodeModal(node);
    const b = node.binding;
    nodeForm.setFieldsValue({
      code: node.code,
      name: node.name,
      bind_type: b?.bind_type || "none",
      role: b?.role || "observe",
      metric_id: b?.metric_id,
      connector: b?.connector,
      connector_action: b?.connector_action,
      knowledge_base_id: b?.knowledge_base_id,
      knowledge_query: b?.knowledge_query,
      note: b?.note,
    });
  };

  const openEditEdge = (edge: DraftEdge) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
    setEdgeModal(edge);
    edgeForm.setFieldsValue({ label: edge.label, polarity: edge.polarity });
  };

  const saveNode = async () => {
    if (!nodeModal) return;
    const values = await nodeForm.validateFields();
    const code = values.code.trim().toUpperCase();
    if (draft.nodes.some((n) => n.id !== nodeModal.id && n.code === code)) {
      message.warning("编码已存在");
      return;
    }
    if (values.bind_type === "metric" && !values.metric_id) {
      message.warning("请选择指标合同");
      return;
    }
    if (values.bind_type === "connector" && (!values.connector || !values.connector_action)) {
      message.warning("请选择连接器与能力");
      return;
    }
    if (values.bind_type === "knowledge" && !values.knowledge_base_id) {
      message.warning("请选择知识库");
      return;
    }
    const binding = bindingFromForm(values, metrics, knowledgeBases);
    onChange(syncPathFields({
      ...draft,
      nodes: draft.nodes.map((n) => (
        n.id === nodeModal.id
          ? { ...n, code, name: values.name.trim(), binding }
          : n
      )),
    }));
    setNodeModal(null);
    message.success(formatNodeBinding(binding) ? `节点已更新 · 已绑 ${formatNodeBinding(binding)}` : "节点已更新");
  };

  const saveEdge = async () => {
    if (!edgeModal) return;
    const values = await edgeForm.validateFields();
    onChange(syncPathFields({
      ...draft,
      edges: draft.edges.map((e) => (
        e.id === edgeModal.id
          ? { ...e, label: values.label.trim(), polarity: values.polarity }
          : e
      )),
    }));
    setEdgeModal(null);
    message.success("连线已更新");
  };

  const addNode = async () => {
    const values = await addForm.validateFields();
    const code = values.code.trim().toUpperCase();
    if (draft.nodes.some((n) => n.code === code)) {
      message.warning("编码已存在");
      return;
    }
    const id = `custom_${code.toLowerCase()}`;
    const last = draft.nodes[draft.nodes.length - 1];
    const nodes = [...draft.nodes, { id, code, name: values.name.trim() }];
    const edges = last
      ? [...draft.edges, {
        id: uid("e"),
        from: last.id,
        to: id,
        label: "关联",
        polarity: "+" as const,
      }]
      : draft.edges;
    onChange(syncPathFields({
      ...draft,
      nodes,
      edges,
      explain: {
        ...draft.explain,
        stocks: draft.explain.stocks
          ? `${draft.explain.stocks}、${values.name.trim()}`
          : values.name.trim(),
      },
      notes: [`新增节点 ${code}`, ...draft.notes],
    }));
    setAddOpen(false);
    addForm.resetFields();
    message.success(`已加入 ${code}`);
  };

  const autoBindDataSources = async () => {
    if (!draft.nodes.length || autoBinding) return;
    const unbound = draft.nodes.filter((n) => !n.binding || n.binding.bind_type === "none").length;
    const overwrite = unbound === 0;
    if (overwrite) {
      const ok = await new Promise<boolean>((resolve) => {
        modal.confirm({
          title: "全部节点已有绑定",
          content: "是否让 AI 重新接入并覆盖现有数据源？",
          okText: "重新接入",
          cancelText: "取消",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!ok) return;
    }

    setAutoBinding(true);
    try {
      const local = autoBindNodesLocal(draft.nodes, metrics, knowledgeBases, { overwrite });
      let nextNodes = local.nodes;
      let sourceLabel = "规则";
      let summary = local.summary;
      let bound = local.bound;

      try {
        const res = await agentChat({
          message: buildAutoBindPrompt(local.nodes, metrics, knowledgeBases),
          knowledge_mode: "none",
        });
        const rows = extractBindingsFromAi((res.reply || res.error || "").trim());
        if (rows?.length) {
          const ai = applyAiBindings(local.nodes, rows, metrics, knowledgeBases, { overwrite: true });
          nextNodes = ai.nodes;
          sourceLabel = "AI";
          summary = ai.summary;
          bound = ai.bound;
        }
      } catch {
        // 模型不可用时保留本地启发式结果
      }

      onChange(syncPathFields({
        ...draft,
        nodes: nextNodes,
        notes: [
          `${sourceLabel}自动接入数据源：${bound} 个节点`,
          ...summary.slice(0, 8),
          ...draft.notes,
        ],
      }));
      message.success(
        bound
          ? `${sourceLabel}已接入 ${bound} 个节点数据源`
          : "没有需要接入的节点",
      );
    } finally {
      setAutoBinding(false);
    }
  };

  const deleteSelected = () => {
    if (selectedEdgeId) {
      modal.confirm({
        title: "删除这条连线？",
        okText: "删除",
        okButtonProps: { danger: true },
        onOk: () => {
          onChange(syncPathFields({
            ...draft,
            edges: draft.edges.filter((e) => e.id !== selectedEdgeId),
          }));
          setSelectedEdgeId(null);
        },
      });
      return;
    }
    if (selectedNodeId) {
      modal.confirm({
        title: "删除这个节点？",
        content: "相关连线会一并删除。",
        okText: "删除",
        okButtonProps: { danger: true },
        onOk: () => {
          onChange(syncPathFields({
            ...draft,
            nodes: draft.nodes.filter((n) => n.id !== selectedNodeId),
            edges: draft.edges.filter((e) => e.from !== selectedNodeId && e.to !== selectedNodeId),
          }));
          setSelectedNodeId(null);
        },
      });
    }
  };

  return (
    <div className="cpd-loop-preview-wrap">
      <div className="cpd-loop-preview-toolbar">
        <Space size={6} wrap>
          <Button size="small" icon={<PlusOutlined />} onClick={() => {
            addForm.setFieldsValue({ code: `X${draft.nodes.length + 1}`, name: "" });
            setAddOpen(true);
          }}
          >
            加节点
          </Button>
          <Button
            size="small"
            type={linkMode ? "primary" : "default"}
            icon={<LinkOutlined />}
            onClick={() => {
              setLinkMode((v) => !v);
              setLinkFrom(null);
              if (!linkMode) message.info("连线：先点起点，再点终点");
            }}
          >
            {linkMode ? "连线中…" : "连线"}
          </Button>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<ThunderboltOutlined />}
            loading={autoBinding}
            disabled={!draft.nodes.length || bindLoading}
            onClick={() => void autoBindDataSources()}
          >
            {autoBinding ? "接入中…" : "AI 接入数据源"}
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!selectedNodeId && !selectedEdgeId}
            onClick={deleteSelected}
          >
            删除选中
          </Button>
        </Space>
        <span className="cpd-loop-preview-hint">点节点可改绑定 · 或一键 AI 接入</span>
      </div>

      <div className="cpd-loop-preview" ref={wrapRef}>
        {!data.nodes.length ? (
          <Empty description="暂无节点，点击「加节点」开始" />
        ) : (
          <ForceGraph2D
            ref={fgRef}
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor={visualTheme.canvas}
            nodeId="id"
            nodeVal={(n) => (n as GNode).val}
            nodeLabel={(n) => {
              const node = n as GNode;
              const bind = formatNodeBinding(node.binding);
              return `<div style="${graphTooltipStyle(visualTheme)}"><b>${node.code}</b> ${node.name}${bind ? `<br/><span style="opacity:.8">🔗 ${bind}</span>` : "<br/><span style='opacity:.65'>未绑定数据源 · 点击编辑</span>"}</div>`;
            }}
            nodeCanvasObjectMode={() => "replace"}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as GNode;
              const selected = selectedNodeId === n.id || linkFrom === n.id;
              const r = Math.max(9, Math.sqrt(n.val) * 3.1);
              const x = n.x || 0;
              const y = n.y || 0;
              if (selected) {
                ctx.beginPath();
                ctx.arc(x, y, r + 5, 0, Math.PI * 2);
                ctx.strokeStyle = "#C4924A";
                ctx.lineWidth = 2.2 / Math.max(globalScale, 0.25);
                ctx.stroke();
              }
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fillStyle = n.color;
              ctx.fill();
              if (n.binding && n.binding.bind_type !== "none") {
                ctx.beginPath();
                ctx.arc(x + r * 0.72, y - r * 0.72, Math.max(3.5, 4.2 / Math.max(globalScale, 0.5)), 0, Math.PI * 2);
                ctx.fillStyle = n.binding.bind_type === "knowledge"
                  ? "#7c3aed"
                  : n.binding.bind_type === "connector"
                    ? "#0f766e"
                    : "#2563eb";
                ctx.fill();
              }
              const fontSize = Math.max(12, 13.5 / Math.max(globalScale, 0.55));
              ctx.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              const bind = formatNodeBinding(n.binding);
              const label = bind ? `${n.code} ${n.name}` : `${n.code} ${n.name}`;
              const tw = ctx.measureText(label).width;
              ctx.fillStyle = visualTheme.labelBg;
              ctx.fillRect(x - tw / 2 - 4, y + r + 3, tw + 8, fontSize + 5);
              ctx.fillStyle = visualTheme.labelText;
              ctx.fillText(label, x, y + r + 5);
              if (bind) {
                const subSize = Math.max(10, 11 / Math.max(globalScale, 0.55));
                ctx.font = `500 ${subSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
                const sw = ctx.measureText(bind).width;
                ctx.fillStyle = visualTheme.labelBg;
                ctx.fillRect(x - sw / 2 - 3, y + r + fontSize + 8, sw + 6, subSize + 4);
                ctx.fillStyle = "#64748b";
                ctx.fillText(bind, x, y + r + fontSize + 10);
              }
            }}
            linkColor={(l) => {
              const link = l as GLink;
              if (selectedEdgeId === link.id) return "#C4924A";
              return link.polarity === "-" ? "#c53d3d" : "rgba(61,111,168,0.75)";
            }}
            linkWidth={(l) => ((l as GLink).id === selectedEdgeId ? 4.5 : 3)}
            linkCurvature={0.2}
            linkDirectionalArrowLength={7}
            linkDirectionalArrowRelPos={0.92}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={2.4}
            linkCanvasObjectMode={() => "after"}
            linkCanvasObject={(link, ctx, globalScale) => {
              const l = link as GLink;
              const src = typeof l.source === "object" ? l.source : null;
              const tgt = typeof l.target === "object" ? l.target : null;
              if (!src || !tgt || src.x == null || tgt.x == null) return;
              const x = ((src.x || 0) + (tgt.x || 0)) / 2;
              const y = ((src.y || 0) + (tgt.y || 0)) / 2 - 10;
              const fontSize = Math.max(11, 12 / Math.max(globalScale, 0.55));
              ctx.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
              const text = l.label;
              const w = ctx.measureText(text).width;
              ctx.fillStyle = visualTheme.labelBg;
              ctx.fillRect(x - w / 2 - 4, y - fontSize / 2 - 2, w + 8, fontSize + 5);
              ctx.fillStyle = selectedEdgeId === l.id
                ? "#C4924A"
                : (l.polarity === "-" ? "#b91c1c" : "#1d4ed8");
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(text, x, y);
            }}
            linkPointerAreaPaint={(link, color, ctx) => {
              const l = link as GLink;
              const src = typeof l.source === "object" ? l.source : null;
              const tgt = typeof l.target === "object" ? l.target : null;
              if (!src || !tgt || src.x == null || src.y == null || tgt.x == null || tgt.y == null) return;
              ctx.strokeStyle = color;
              ctx.lineWidth = 16;
              ctx.beginPath();
              ctx.moveTo(src.x, src.y);
              ctx.lineTo(tgt.x, tgt.y);
              ctx.stroke();
            }}
            onNodeClick={(n) => {
              const node = n as GNode;
              if (linkMode) {
                if (!linkFrom) {
                  setLinkFrom(node.id);
                  setSelectedNodeId(node.id);
                  message.info(`起点：${node.code}，再点终点`);
                  return;
                }
                if (linkFrom === node.id) {
                  message.warning("不能连到自身");
                  return;
                }
                if (draft.edges.some((e) => (
                  (e.from === linkFrom && e.to === node.id)
                  || (e.from === node.id && e.to === linkFrom)
                ))) {
                  message.warning("已有连线");
                  setLinkFrom(null);
                  return;
                }
                onChange(syncPathFields({
                  ...draft,
                  edges: [...draft.edges, {
                    id: uid("e"),
                    from: linkFrom,
                    to: node.id,
                    label: "因果",
                    polarity: "+",
                  }],
                }));
                setLinkFrom(null);
                setLinkMode(false);
                message.success("已添加连线，点击连线可改标签");
                return;
              }
              openEditNode(node);
            }}
            onLinkClick={(l) => {
              if (linkMode) return;
              const link = l as GLink;
              const edge = draft.edges.find((e) => e.id === link.id);
              if (edge) openEditEdge(edge);
            }}
            onBackgroundClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
              if (linkMode) setLinkFrom(null);
            }}
            enableNodeDrag
            cooldownTicks={40}
          />
        )}
      </div>

      <Modal
        title="编辑节点"
        open={Boolean(nodeModal)}
        onCancel={() => setNodeModal(null)}
        onOk={() => void saveNode()}
        okText="保存"
        width={560}
        destroyOnHidden
      >
        <Form form={nodeForm} layout="vertical" initialValues={{ bind_type: "none", role: "observe" }}>
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input maxLength={12} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input maxLength={32} />
          </Form.Item>

          <div className="cpd-node-bind-panel">
            <div className="cpd-node-bind-panel-title">
              <DatabaseOutlined /> 数据源绑定
              {bindLoading ? <Spin size="small" /> : null}
            </div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12, fontSize: 12 }}>
              数值优先绑 DataLake 指标；吉客云/金蝶负责灌数或只读查询；知识库用于解释与 Orient。
            </Typography.Paragraph>

            <Form.Item name="bind_type" label="绑定类型">
              <Select
                options={BIND_TYPE_OPTIONS}
                onChange={(v) => {
                  if (v === "knowledge") nodeForm.setFieldValue("role", "orient");
                  else if (v === "metric" || v === "connector") nodeForm.setFieldValue("role", "observe");
                }}
              />
            </Form.Item>

            {bindType && bindType !== "none" ? (
              <Form.Item name="role" label="在 Loop 中的角色">
                <Select options={ROLE_OPTIONS} />
              </Form.Item>
            ) : null}

            {bindType === "metric" ? (
              <Form.Item name="metric_id" label="指标合同" rules={[{ required: true, message: "请选择指标" }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={metrics.length ? "选择 MetricContract" : "暂无指标，请先在企业数据配置"}
                  options={metrics.map((m) => ({
                    value: m.metric_id,
                    label: `${m.name}（${m.metric_id}${m.unit ? ` · ${m.unit}` : ""}）`,
                  }))}
                  notFoundContent={
                    <span>
                      暂无合同 · 去
                      <Button type="link" size="small" href="/knowledge?tab=enterprise-data" target="_blank">企业数据</Button>
                    </span>
                  }
                />
              </Form.Item>
            ) : null}

            {bindType === "connector" ? (
              <>
                <Form.Item name="connector" label="连接器" rules={[{ required: true, message: "请选择连接器" }]}>
                  <Select
                    options={CONNECTOR_OPTIONS}
                    onChange={() => nodeForm.setFieldValue("connector_action", undefined)}
                  />
                </Form.Item>
                <Form.Item name="connector_action" label="能力" rules={[{ required: true, message: "请选择能力" }]}>
                  <Select
                    placeholder="选择接口能力"
                    options={(connectorKey ? CONNECTOR_ACTIONS[connectorKey] : []).map((a) => ({
                      value: a.value,
                      label: a.label,
                    }))}
                    onChange={(v) => {
                      const hit = connectorKey
                        ? CONNECTOR_ACTIONS[connectorKey].find((a) => a.value === v)
                        : undefined;
                      if (hit) nodeForm.setFieldValue("role", hit.roleHint);
                    }}
                  />
                </Form.Item>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 12 }}>
                  凭据在 <Button type="link" size="small" href="/connectors" target="_blank" style={{ padding: 0 }}>连接器</Button> 配置；写 ERP 必须过确认闸机。
                </Typography.Text>
              </>
            ) : null}

            {bindType === "knowledge" ? (
              <>
                <Form.Item name="knowledge_base_id" label="知识库" rules={[{ required: true, message: "请选择知识库" }]}>
                  <Select
                    showSearch
                    optionFilterProp="label"
                    placeholder={knowledgeBases.length ? "选择知识库" : "暂无知识库"}
                    options={knowledgeBases.map((kb) => ({
                      value: kb.id,
                      label: `${kb.name}${kb.file_count != null ? ` · ${kb.file_count} 文件` : ""}`,
                    }))}
                    notFoundContent={
                      <span>
                        暂无库 · 去
                        <Button type="link" size="small" href="/knowledge" target="_blank">知识库</Button>
                      </span>
                    }
                  />
                </Form.Item>
                <Form.Item name="knowledge_query" label="检索提示（可选）">
                  <Input.TextArea
                    rows={2}
                    maxLength={120}
                    placeholder="如：利润再投与推广预算的干预口径"
                  />
                </Form.Item>
              </>
            ) : null}

            {bindType && bindType !== "none" ? (
              <Form.Item name="note" label="备注（可选）">
                <Input maxLength={80} placeholder="如：按 SKU 维度取数" />
              </Form.Item>
            ) : null}
          </div>
        </Form>
      </Modal>

      <Modal
        title="编辑连线"
        open={Boolean(edgeModal)}
        onCancel={() => setEdgeModal(null)}
        onOk={() => void saveEdge()}
        okText="保存"
        destroyOnHidden
      >
        <Form form={edgeForm} layout="vertical">
          <Form.Item name="label" label="关系标签" rules={[{ required: true }]}>
            <Input maxLength={24} placeholder="如：扩渠、转化、抑制" />
          </Form.Item>
          <Form.Item name="polarity" label="极性" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio.Button value="+">促进 +</Radio.Button>
              <Radio.Button value="-">抑制 −</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新增节点"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void addNode()}
        okText="加入"
        destroyOnHidden
      >
        <Form form={addForm} layout="vertical">
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input placeholder="如 X6" maxLength={12} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如 渠道激励缓冲" maxLength={32} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default function CpdLoopEditor() {
  const { code = "" } = useParams<{ code: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const preferredLevel = useMemo(
    () => parseLevelParam(searchParams.get("level")),
    [searchParams],
  );
  const catalog = useMemo(
    () => resolveLoopCatalog(code, preferredLevel),
    [code, preferredLevel],
  );
  const levelLabel = catalog ? LEVEL_LABEL[catalog.level] : "";
  const [draft, setDraft] = useState<LoopDraft | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!catalog) {
      setDraft(null);
      return;
    }
    const base = draftFromCatalog(catalog);
    const loaded = loadDraft(catalog.code, base);
    setDraft(loaded);
    setMessages([{
      id: "welcome",
      role: "assistant",
      content: `已打开【${LEVEL_LABEL[catalog.level]}层】${catalog.code}「${catalog.name}」。右侧图可直接点节点/连线改文字，也可用「加节点」「连线」增删；左侧对话同样能改回路。`,
    }]);
  }, [catalog]);

  const persist = useCallback((next: LoopDraft) => {
    const syncedInput = syncPathFields({
      ...next,
      level: catalog?.level || next.level,
    });
    const synced = persistCpdDraftAndSync(syncedInput, catalog?.level);
    setDraft(synced);
  }, [catalog?.level]);

  const send = async () => {
    if (!draft || !catalog) return;
    const text = input.trim();
    if (!text || sending) return;
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: text };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput("");
    setSending(true);

    const prompt = [
      "你是经营回路（系统动力学 CPD）编辑助手。",
      `当前层级：${LEVEL_LABEL[catalog.level]}层`,
      `当前回路：${draft.code} ${draft.name}（${draft.kind}）`,
      `机理：${draft.chain}`,
      `杠杆：${draft.leverage}`,
      `节点：${JSON.stringify(draft.nodes)}`,
      `连线：${JSON.stringify(draft.edges)}`,
      `定量说明：${JSON.stringify(draft.explain)}`,
      "",
      `用户说：${text}`,
      "",
      "请用中文给出可执行建议。若需更新，在回复末尾附加 JSON：",
      "```json",
      '{"explain":{"stocks":"...","flows":"...","delays":"...","behavior":"...","intervention":"..."},"notes":["..."],"nodes":[{"id":"custom_x1","code":"X1","name":"..."}],"edges":[{"id":"e1","from":"...","to":"...","label":"...","polarity":"+"}]}',
      "```",
      "nodes/edges 若提供则视为完整替换图结构；否则只改 explain/notes。",
    ].join("\n");

    const priorAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content || "";

    try {
      const res = await agentChat({ message: prompt, knowledge_mode: "none" });
      const content = (res.reply || res.error || "").trim() || "已收到，但暂时没有生成具体建议。";
      const patch = extractJsonPatch(content);
      const patchHasGraph = Boolean(
        (Array.isArray(patch?.nodes) && patch!.nodes!.length)
        || (Array.isArray(patch?.edges) && patch!.edges!.length),
      );

      if (patch && patchHasGraph) {
        const next: LoopDraft = syncPathFields({
          ...draft,
          ...patch,
          explain: { ...draft.explain, ...(patch.explain || {}) },
          notes: Array.isArray(patch.notes) ? [...patch.notes, ...draft.notes] : draft.notes,
          nodes: Array.isArray(patch.nodes) && patch.nodes.length ? patch.nodes : draft.nodes,
          edges: Array.isArray(patch.edges) && patch.edges.length ? patch.edges : draft.edges,
        });
        persist(next);
        setMessages([...history, {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: content.replace(/```json[\s\S]*?```/i, "").trim() || content,
          model: res.llm_model,
        }]);
      } else if (looksLikeAddNode(text)) {
        // 模型只说了「已加上」却没带回 nodes，或用户说「按你说的加上」——本地真正改图
        const local = applyLocalAdvice(text, draft, `${priorAssistant}\n${content}`);
        persist(local.draft);
        setMessages([...history, {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: local.assistant,
          model: res.llm_model,
        }]);
      } else if (patch) {
        const next: LoopDraft = {
          ...draft,
          explain: { ...draft.explain, ...(patch.explain || {}) },
          notes: Array.isArray(patch.notes) ? [...patch.notes, ...draft.notes] : draft.notes,
        };
        persist(next);
        setMessages([...history, {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: content.replace(/```json[\s\S]*?```/i, "").trim() || content,
          model: res.llm_model,
        }]);
      } else {
        setMessages([...history, {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: content.replace(/```json[\s\S]*?```/i, "").trim() || content,
          model: res.llm_model,
        }]);
      }
    } catch {
      const local = applyLocalAdvice(text, draft, priorAssistant);
      persist(local.draft);
      setMessages([...history, { id: `a-${Date.now()}`, role: "assistant", content: local.assistant }]);
      message.info("在线模型暂不可用，已用本地回路顾问回复");
    } finally {
      setSending(false);
    }
  };

  if (!catalog || !draft) {
    return (
      <div className="cpd-loop-edit-page">
        <header className="sop-distill-header">
          <div>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/loops/graph")}>返回图谱</Button>
            <span><strong>回路编辑</strong><small>未找到 {code || "回路"}</small></span>
          </div>
        </header>
        <Empty description="请从回路图谱点击 🖊 进入编辑" />
      </div>
    );
  }

  return (
    <div className="cpd-loop-edit-page sop-distill-page">
      <header className="sop-distill-header cpd-loop-edit-header">
        <div className="cpd-loop-edit-header-main">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/loops/graph")}>返回图谱</Button>
          <div className="cpd-loop-edit-title">
            <strong>编辑闭环回路</strong>
            <div className="cpd-loop-edit-subtitle">
              <Tag color="geekblue">{levelLabel}层</Tag>
              <Tag color={draft.kind === "R" ? "orange" : draft.kind === "B" ? "blue" : "purple"}>{draft.code}</Tag>
              <span className="cpd-loop-edit-name">{draft.name}</span>
            </div>
          </div>
        </div>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={() => {
            persist(draft);
            message.success(`已保存：${levelLabel}层「${draft.code}」已更新`);
            navigate("/loops/graph");
          }}
        >
          保存并返回
        </Button>
      </header>

      <div className="sop-distill-workbench cpd-loop-edit-workbench">
        <section className="sop-chat-panel">
          <div className="sop-panel-title">
            <strong>AI 回路设计</strong>
            <span>对话改结构 · 要建议 · 改定量</span>
          </div>
          <div className="sop-chat-messages">
            {messages.map((item) => (
              <div key={item.id} className={`sop-chat-row is-${item.role}`}>
                <div className="sop-chat-avatar">{item.role === "assistant" ? "AI" : "我"}</div>
                <div className="sop-chat-bubble">
                  <p>{item.content}</p>
                  {item.model ? <small>{item.model}</small> : null}
                </div>
              </div>
            ))}
            {sending ? (
              <div className="sop-chat-row is-assistant">
                <div className="sop-chat-avatar">AI</div>
                <div className="sop-chat-bubble is-thinking"><Spin size="small" /> 正在理解回路并给出建议…</div>
              </div>
            ) : null}
          </div>
          <div className="sop-chat-composer">
            <Input.TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="例如：加一个「渠道激励缓冲」节点；或给干预写得更可执行"
              autoSize={{ minRows: 3, maxRows: 6 }}
            />
            <div>
              <span>Enter 发送 · Shift+Enter 换行</span>
              <Button
                type="primary"
                icon={sending ? <StopOutlined /> : <SendOutlined />}
                disabled={!input.trim() || sending}
                onClick={() => void send()}
              >
                {sending ? "生成中" : "发送"}
              </Button>
            </div>
          </div>
        </section>

        <section className="sop-design-panel cpd-loop-design-panel">
          <div className="sop-panel-title">
            <strong>回路结构</strong>
            <span className="cpd-loop-path-hint">{levelLabel}层</span>
          </div>
          <div className="cpd-loop-design-body">
            <LoopPreview draft={draft} onChange={persist} />
            <div className="cpd-loop-pathline">
              {draft.nodes.map((n) => n.code).join(" → ")}
            </div>
            <div className="cpd-loop-bindings">
              <div className="cpd-loop-section-label">
                节点数据源
                <span className="cpd-loop-bindings-tip">未绑定可用上方「AI 接入数据源」</span>
              </div>
              <div className="cpd-loop-bindings-list">
                {draft.nodes.map((n, idx) => {
                  const bind = formatNodeBinding(n.binding);
                  return (
                    <div key={`${n.id}::${idx}`} className={`cpd-loop-binding-row${bind ? " is-bound" : ""}`}>
                      <Tag color={n.binding?.bind_type === "knowledge" ? "purple" : n.binding?.bind_type === "connector" ? "cyan" : n.binding?.bind_type === "metric" ? "blue" : "default"}>
                        {n.code}
                      </Tag>
                      <span className="cpd-loop-binding-name">{n.name}</span>
                      <span className="cpd-loop-binding-ref">
                        {bind || "未绑定 · 点节点编辑"}
                        {n.binding?.role && bind ? ` · ${n.binding.role}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="cpd-loop-meta">
              <div className="cpd-loop-meta-block is-level">
                <small>所属层级</small>
                <p><b>{levelLabel}层</b><em>{catalog.level}</em></p>
              </div>
              <div className="cpd-loop-meta-block">
                <small>机理</small>
                <p>{draft.chain}</p>
              </div>
              <div className="cpd-loop-meta-block">
                <small>杠杆点</small>
                <p>{draft.leverage}</p>
              </div>
            </div>
            <div className="cpd-loop-explain-wrap">
              <div className="cpd-loop-section-label">定量说明</div>
              <CpdExplainTiles explain={draft.explain} seed={draft.code} />
            </div>
            {draft.notes.length ? (
              <div className="cpd-loop-notes">
                <strong>编辑备注</strong>
                <ul>
                  {draft.notes.slice(0, 6).map((note, idx) => <li key={`note-${idx}`}>{note}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
