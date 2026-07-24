/**
 * CPD 回路编辑草稿：本地持久化，并回写经营回路列表 / 回路图谱。
 */
import { CPD_LOOPS, type CpdLoopKind, type CpdNamedLoop } from "./cpdCatalog";
import {
  loadLoopCustomState,
  saveLoopCustomState,
  type CustomCausalLink,
  type CustomStockNode,
  type LoopGraphCustomState,
} from "./forceGraphData";
import { getLevelModel } from "./data";
import { LEVEL_LABEL, LEVEL_ORDER, type LoopLevel } from "./types";

export const CPD_DRAFT_PREFIX = "lc-cpd-loop-draft-v2:";
const GRAPH_SYNC_PREFIX = "lc-cpd-draft-graph-sync:";

export type CpdNodeBindType = "none" | "metric" | "connector" | "knowledge";
export type CpdNodeBindRole = "observe" | "orient" | "act";
export type CpdNodeConnectorKey = "jackyun" | "kingdee";

/** 节点数据源绑定（本地草稿；后续可同步到 MetricBinding / KB） */
export type CpdNodeBinding = {
  bind_type: CpdNodeBindType;
  role: CpdNodeBindRole;
  metric_id?: string;
  metric_name?: string;
  connector?: CpdNodeConnectorKey;
  connector_action?: string;
  knowledge_base_id?: number;
  knowledge_base_name?: string;
  knowledge_query?: string;
  note?: string;
};

export type CpdDraftNode = {
  id: string;
  code: string;
  name: string;
  binding?: CpdNodeBinding;
};

export type CpdDraftEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  polarity: "+" | "-";
};

export type CpdLoopDraft = {
  code: string;
  name: string;
  kind: CpdLoopKind;
  chain: string;
  leverage: string;
  stockPath: string[];
  edgeIds: string[];
  steps: string[];
  nodes: CpdDraftNode[];
  edges: CpdDraftEdge[];
  explain: NonNullable<CpdNamedLoop["explain"]>;
  notes: string[];
  /** 所属层级；旧草稿可能缺失，保存/同步时会推断 */
  level?: LoopLevel;
};

type GraphSyncMeta = {
  stockIds: string[];
  linkIds: string[];
};

function levelStockIds(level: LoopLevel): Set<string> {
  return new Set(getLevelModel(level).stocks.map((s) => s.id));
}

function levelFlowIds(level: LoopLevel): Set<string> {
  return new Set(getLevelModel(level).flows.map((f) => f.id));
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function graphNodeId(level: LoopLevel, stockId: string) {
  if (!stockId) return stockId;
  if (stockId.includes(":")) return stockId;
  return `${level}:${stockId}`;
}

function bareStockId(ref: string) {
  return ref.includes(":") ? ref.split(":").slice(-1)[0] : ref;
}

/** 从编码 / 节点 id 推断草稿所属层级 */
export function resolveDraftLevel(draft: Pick<CpdLoopDraft, "code" | "level" | "nodes">): LoopLevel {
  if (draft.level && (LEVEL_ORDER as string[]).includes(draft.level)) return draft.level;
  if (CPD_LOOPS.some((l) => l.code === draft.code)) return "company";
  for (const level of LEVEL_ORDER) {
    if (level === "company") continue;
    if (getLevelModel(level).loops.some((l) => l.code === draft.code)) return level;
  }
  const sample = (draft.nodes || []).map((n) => bareStockId(n.id).toLowerCase()).find(Boolean) || "";
  if (/^k\d/.test(sample)) return "sku";
  if (/^l\d/.test(sample)) return "link";
  if (/^c\d/.test(sample)) return "channel";
  if (/^p\d/.test(sample)) return "platform";
  if (/^b\d/.test(sample)) return "brand";
  if (/^f\d/.test(sample)) return "fact";
  if (/^s\d/.test(sample)) return "company";
  return "company";
}

function resolveNodeId(
  ref: string,
  nodes: CpdDraftNode[],
  byId: Map<string, CpdDraftNode>,
): string | null {
  const raw = (ref || "").trim();
  if (!raw) return null;
  if (byId.has(raw)) return raw;
  const bare = bareStockId(raw);
  if (bare && byId.has(bare)) return bare;
  const lower = raw.toLowerCase();
  const byCode = nodes.find((n) => n.code.toLowerCase() === lower || n.id.toLowerCase() === lower);
  if (byCode) return byCode.id;
  const byBareCode = nodes.find((n) => n.code.toLowerCase() === bare.toLowerCase());
  return byBareCode?.id || null;
}

/**
 * 修正边端点（AI 常用 code 当 from/to），并为孤立新节点自动接到路径前一个点。
 */
export function normalizeDraftGraph(draft: CpdLoopDraft): CpdLoopDraft {
  // 同 id 只保留第一次，避免 React key / 全图重复
  const seenNodeIds = new Set<string>();
  const nodes: CpdDraftNode[] = [];
  for (const n of draft.nodes || []) {
    if (!n?.id || seenNodeIds.has(n.id)) continue;
    seenNodeIds.add(n.id);
    nodes.push(n);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: CpdDraftEdge[] = [];
  const seen = new Set<string>();

  for (const edge of draft.edges || []) {
    const from = resolveNodeId(edge.from, nodes, byId);
    const to = resolveNodeId(edge.to, nodes, byId);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    if (seen.has(key) || seen.has(`${to}->${from}`)) continue;
    seen.add(key);
    edges.push({
      id: edge.id || uid("e"),
      from,
      to,
      label: edge.label || "关联",
      polarity: edge.polarity === "-" ? "-" : "+",
    });
  }

  const degree = new Map<string, number>();
  nodes.forEach((n) => degree.set(n.id, 0));
  edges.forEach((e) => {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  });

  // 按当前路径顺序，把度为 0 的点接到前一个有点
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if ((degree.get(node.id) || 0) > 0) continue;
    const prev = nodes.slice(0, i).reverse().find((n) => n.id !== node.id)
      || nodes[i + 1];
    if (!prev) continue;
    const key = `${prev.id}->${node.id}`;
    if (seen.has(key) || seen.has(`${node.id}->${prev.id}`)) continue;
    seen.add(key);
    edges.push({
      id: uid("e"),
      from: prev.id,
      to: node.id,
      label: "关联",
      polarity: "+",
    });
    degree.set(prev.id, (degree.get(prev.id) || 0) + 1);
    degree.set(node.id, (degree.get(node.id) || 0) + 1);
  }

  return {
    ...draft,
    nodes,
    edges,
    stockPath: nodes.map((n) => n.id),
    edgeIds: edges.map((e) => e.id),
    level: resolveDraftLevel(draft),
  };
}

export function formatNodeBinding(binding?: CpdNodeBinding | null): string {
  if (!binding || binding.bind_type === "none") return "";
  if (binding.bind_type === "metric") {
    return `指标·${binding.metric_name || binding.metric_id || "未选"}`;
  }
  if (binding.bind_type === "connector") {
    const name = binding.connector === "kingdee" ? "金蝶" : binding.connector === "jackyun" ? "吉客云" : "连接器";
    return `${name}·${binding.connector_action || "只读"}`;
  }
  if (binding.bind_type === "knowledge") {
    return `知识·${binding.knowledge_base_name || binding.knowledge_base_id || "未选"}`;
  }
  return "";
}

export function normalizeNodeBinding(raw: unknown): CpdNodeBinding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Partial<CpdNodeBinding>;
  const bind_type = (["none", "metric", "connector", "knowledge"] as const)
    .includes(b.bind_type as CpdNodeBindType)
    ? (b.bind_type as CpdNodeBindType)
    : "none";
  if (bind_type === "none") return { bind_type: "none", role: "observe" };
  const role = (["observe", "orient", "act"] as const).includes(b.role as CpdNodeBindRole)
    ? (b.role as CpdNodeBindRole)
    : "observe";
  return {
    bind_type,
    role,
    metric_id: b.metric_id ? String(b.metric_id) : undefined,
    metric_name: b.metric_name ? String(b.metric_name) : undefined,
    connector: b.connector === "kingdee" || b.connector === "jackyun" ? b.connector : undefined,
    connector_action: b.connector_action ? String(b.connector_action) : undefined,
    knowledge_base_id: Number.isFinite(Number(b.knowledge_base_id)) ? Number(b.knowledge_base_id) : undefined,
    knowledge_base_name: b.knowledge_base_name ? String(b.knowledge_base_name) : undefined,
    knowledge_query: b.knowledge_query ? String(b.knowledge_query) : undefined,
    note: b.note ? String(b.note) : undefined,
  };
}

function normalizeDraftNodes(nodes: CpdDraftNode[]): CpdDraftNode[] {
  return (nodes || []).map((n) => ({
    id: n.id,
    code: n.code,
    name: n.name,
    binding: normalizeNodeBinding(n.binding),
  }));
}

export function loadCpdDraft(code: string): CpdLoopDraft | null {
  try {
    const raw = localStorage.getItem(`${CPD_DRAFT_PREFIX}${code}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CpdLoopDraft>;
    if (!parsed?.code || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    const draft: CpdLoopDraft = {
      code: parsed.code,
      name: parsed.name || parsed.code,
      kind: parsed.kind || "R",
      chain: parsed.chain || "",
      leverage: parsed.leverage || "",
      stockPath: Array.isArray(parsed.stockPath) ? parsed.stockPath : parsed.nodes.map((n) => n.id),
      edgeIds: Array.isArray(parsed.edgeIds) ? parsed.edgeIds : parsed.edges.map((e) => e.id),
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      nodes: normalizeDraftNodes(parsed.nodes as CpdDraftNode[]),
      edges: parsed.edges,
      explain: {
        stocks: parsed.explain?.stocks || "",
        flows: parsed.explain?.flows || "",
        delays: parsed.explain?.delays || "",
        behavior: parsed.explain?.behavior || "",
        intervention: parsed.explain?.intervention || "",
      },
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      level: parsed.level,
    };
    return { ...draft, level: resolveDraftLevel(draft) };
  } catch {
    return null;
  }
}

export function saveCpdDraft(draft: CpdLoopDraft) {
  const withLevel = { ...draft, level: resolveDraftLevel(draft) };
  localStorage.setItem(`${CPD_DRAFT_PREFIX}${withLevel.code}`, JSON.stringify(withLevel));
}

export function listCpdDrafts(): CpdLoopDraft[] {
  const out: CpdLoopDraft[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CPD_DRAFT_PREFIX)) continue;
    const code = key.slice(CPD_DRAFT_PREFIX.length);
    const draft = loadCpdDraft(code);
    if (draft) out.push(normalizeDraftGraph(draft));
  }
  return out;
}

/** 把本地草稿规范化并写回图谱（修复孤立新节点） */
export function resyncAllCpdDraftsToGraph() {
  const drafts = listCpdDrafts();
  for (const draft of drafts) {
    saveCpdDraft(draft);
    syncCpdDraftToLoopGraph(draft);
  }
  return drafts.length;
}

function draftToCpdLoop(draft: CpdLoopDraft): CpdNamedLoop {
  return {
    code: draft.code,
    kind: draft.kind,
    name: draft.name,
    chain: draft.chain,
    polarity: draft.kind === "B" ? "−" : "+",
    leverage: draft.leverage,
    stockPath: draft.nodes.map((n) => n.id),
    edgeIds: draft.edges.map((e) => e.id),
    steps: draft.steps,
    explain: draft.explain,
  };
}

function mergeDraftOntoLoop(base: CpdNamedLoop, draft: CpdLoopDraft): CpdNamedLoop {
  return {
    ...base,
    name: draft.name || base.name,
    kind: draft.kind || base.kind,
    chain: draft.chain || base.chain,
    leverage: draft.leverage || base.leverage,
    stockPath: draft.nodes.length ? draft.nodes.map((n) => n.id) : (draft.stockPath || base.stockPath),
    edgeIds: draft.edges.length ? draft.edges.map((e) => e.id) : (draft.edgeIds || base.edgeIds),
    steps: draft.steps?.length ? draft.steps : base.steps,
    explain: { ...(base.explain || { stocks: "", flows: "", delays: "", behavior: "", intervention: "" }), ...draft.explain },
  };
}

/** 经营回路列表 / 高亮用：目录 + 全部草稿合并（草稿可新增回路） */
export function listMergedCpdLoops(): CpdNamedLoop[] {
  const map = new Map<string, CpdNamedLoop>(CPD_LOOPS.map((l) => [l.code, { ...l }]));
  for (const draft of listCpdDrafts()) {
    const base = map.get(draft.code);
    map.set(draft.code, base ? mergeDraftOntoLoop(base, draft) : draftToCpdLoop(draft));
  }
  return [...map.values()];
}

export function findMergedCpdLoop(code: string): CpdNamedLoop | undefined {
  return listMergedCpdLoops().find((l) => l.code === code);
}

export function cpdLoopsByKindMerged(kind?: CpdLoopKind | "all") {
  const all = listMergedCpdLoops();
  if (!kind || kind === "all") return all;
  return all.filter((l) => l.kind === kind);
}

function readSyncMeta(code: string): GraphSyncMeta {
  try {
    const raw = localStorage.getItem(`${GRAPH_SYNC_PREFIX}${code}`);
    if (!raw) return { stockIds: [], linkIds: [] };
    const parsed = JSON.parse(raw) as GraphSyncMeta;
    return {
      stockIds: Array.isArray(parsed.stockIds) ? parsed.stockIds : [],
      linkIds: Array.isArray(parsed.linkIds) ? parsed.linkIds : [],
    };
  } catch {
    return { stockIds: [], linkIds: [] };
  }
}

function writeSyncMeta(code: string, meta: GraphSyncMeta) {
  localStorage.setItem(`${GRAPH_SYNC_PREFIX}${code}`, JSON.stringify(meta));
}

/**
 * 把草稿结构同步进回路图谱自定义层（支持公司及各层）：
 * - 新节点 → custom.stocks（落在对应层级泳道）
 * - 新连线 → custom.links（id = {level}-{edgeId}）
 * - 已有目录节点改名 → custom.labels
 */
export function syncCpdDraftToLoopGraph(
  draft: CpdLoopDraft,
  levelHint?: LoopLevel,
): LoopGraphCustomState {
  const normalized = normalizeDraftGraph({
    ...draft,
    level: levelHint || draft.level,
  });
  const level = resolveDraftLevel(normalized);
  const knownStocks = levelStockIds(level);
  const knownFlows = levelFlowIds(level);
  const prev = readSyncMeta(normalized.code);
  const custom = loadLoopCustomState();

  const stocks = custom.stocks.filter((s) => !prev.stockIds.includes(s.id));
  const links = custom.links.filter((l) => !prev.linkIds.includes(l.id));
  const labels: Record<string, { code?: string; name?: string }> = {
    ...(custom.labels || {}),
  };

  const nextStockIds: string[] = [];
  const nextLinkIds: string[] = [];

  for (const node of normalized.nodes) {
    const bare = bareStockId(node.id);
    const fullId = graphNodeId(level, bare);
    if (knownStocks.has(bare)) {
      labels[fullId] = { code: node.code, name: node.name };
      continue;
    }
    const existing = stocks.find((s) => s.id === fullId || s.id === bare || s.id === node.id);
    if (existing) {
      existing.code = node.code;
      existing.name = node.name;
      existing.level = level;
      existing.sub = `来自 ${LEVEL_LABEL[level]}·${normalized.code}`;
      const id = existing.id.includes(":") ? existing.id : graphNodeId(level, existing.id);
      existing.id = id;
      nextStockIds.push(id);
      labels[id] = { code: node.code, name: node.name };
      continue;
    }
    const cs: CustomStockNode = {
      id: fullId,
      level,
      code: node.code,
      name: node.name,
      sub: `来自 ${LEVEL_LABEL[level]}·${normalized.code}`,
      dataKind: "derived",
    };
    stocks.push(cs);
    nextStockIds.push(fullId);
    labels[fullId] = { code: node.code, name: node.name };
  }

  for (const edge of normalized.edges) {
    const fromBare = bareStockId(edge.from);
    const toBare = bareStockId(edge.to);
    const linkId = `${level}-${edge.id}`;
    // 目录边已在模型里；自定义边写入 custom.links
    if (knownFlows.has(edge.id)) continue;
    const source = graphNodeId(level, fromBare);
    const target = graphNodeId(level, toBare);
    const existing = links.find((l) => l.id === linkId
      || l.id === `company-${edge.id}`
      || (l.source === source && l.target === target)
      || (l.source === target && l.target === source));
    if (existing) {
      existing.id = linkId;
      existing.label = edge.label;
      existing.polarity = edge.polarity;
      existing.source = source;
      existing.target = target;
      if (!nextLinkIds.includes(existing.id)) nextLinkIds.push(existing.id);
      continue;
    }
    const cl: CustomCausalLink = {
      id: linkId,
      source,
      target,
      label: edge.label,
      polarity: edge.polarity,
    };
    links.push(cl);
    nextLinkIds.push(linkId);
  }

  const next: LoopGraphCustomState = {
    ...custom,
    stocks,
    links,
    labels,
  };
  saveLoopCustomState(next);
  writeSyncMeta(normalized.code, { stockIds: nextStockIds, linkIds: nextLinkIds });
  return next;
}

/** 保存草稿并同步到图谱（各层通用） */
export function persistCpdDraftAndSync(draft: CpdLoopDraft, levelHint?: LoopLevel) {
  const synced = normalizeDraftGraph({
    ...draft,
    level: levelHint || draft.level,
    explain: {
      stocks: draft.explain?.stocks || "",
      flows: draft.explain?.flows || "",
      delays: draft.explain?.delays || "",
      behavior: draft.explain?.behavior || "",
      intervention: draft.explain?.intervention || "",
    },
    notes: Array.isArray(draft.notes) ? draft.notes : [],
  });
  const withLevel = { ...synced, level: resolveDraftLevel({ ...synced, level: levelHint || synced.level }) };
  saveCpdDraft(withLevel);
  syncCpdDraftToLoopGraph(withLevel, withLevel.level);
  return withLevel;
}

/** 重置：删除草稿并撤掉图谱上该回路注入的自定义点线 */
export function resetCpdDraft(code: string) {
  const draft = loadCpdDraft(code);
  const prev = readSyncMeta(code);
  const level = draft ? resolveDraftLevel(draft) : "company";
  localStorage.removeItem(`${CPD_DRAFT_PREFIX}${code}`);
  const custom = loadLoopCustomState();
  const next: LoopGraphCustomState & {
    labels?: Record<string, { code?: string; name?: string }>;
  } = {
    ...custom,
    stocks: custom.stocks.filter((s) => !prev.stockIds.includes(s.id)),
    links: custom.links.filter((l) => !prev.linkIds.includes(l.id)),
    labels: { ...(custom.labels || {}) },
  };
  for (const id of prev.stockIds) delete next.labels![id];
  for (const n of draft?.nodes || []) delete next.labels![graphNodeId(level, bareStockId(n.id))];
  saveLoopCustomState(next);
  localStorage.removeItem(`${GRAPH_SYNC_PREFIX}${code}`);
}

/** 把草稿边/路径合并进图谱侧栏回路，便于高亮与展示 */
export function applyDraftsToGraphLoops<T extends { code: string; level: LoopLevel; edgeIds?: string[] }>(
  loops: T[],
): T[] {
  const drafts = listCpdDrafts();
  if (!drafts.length) return loops;
  return loops.map((loop) => {
    const bare = loop.code.includes("·") ? loop.code.split("·").slice(-1)[0] : loop.code;
    const draft = drafts.find((d) => {
      const lv = resolveDraftLevel(d);
      return lv === loop.level && (d.code === bare || d.code === loop.code);
    });
    if (!draft) return loop;
    const level = resolveDraftLevel(draft);
    return {
      ...loop,
      ...(draft.name ? { name: draft.name } : null),
      ...(draft.nodes.length ? { path: draft.nodes.map((n) => n.code).join("→") } : null),
      edgeIds: draft.edges.map((e) => `${level}-${e.id}`),
    };
  });
}

/** 图谱构建后套用草稿节点改名 */
export function applyDraftLabelsToNodes<T extends { id: string; code: string; name: string }>(
  nodes: T[],
  custom: LoopGraphCustomState & { labels?: Record<string, { code?: string; name?: string }> },
): T[] {
  const labels = custom.labels || {};
  if (!Object.keys(labels).length) {
    const byId = new Map<string, CpdDraftNode>();
    for (const d of listCpdDrafts()) {
      const level = resolveDraftLevel(d);
      for (const n of d.nodes) byId.set(graphNodeId(level, bareStockId(n.id)), n);
    }
    if (!byId.size) return nodes;
    return nodes.map((node) => {
      const hit = byId.get(node.id);
      if (!hit) return node;
      return { ...node, code: hit.code || node.code, name: hit.name || node.name };
    });
  }
  return nodes.map((node) => {
    const hit = labels[node.id];
    if (!hit) return node;
    return { ...node, code: hit.code || node.code, name: hit.name || node.name };
  });
}
