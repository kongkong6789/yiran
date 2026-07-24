/**
 * 一键充实全部经营回路：补齐关联存量维度 + 自动接入数据源，并回写图谱。
 */
import type { KnowledgeBaseItem } from "../api/client";
import { CPD_LOOPS } from "./cpdCatalog";
import {
  autoBindNodesLocal,
  type MetricContractOption,
} from "./cpdAutoBind";
import {
  loadCpdDraft,
  normalizeDraftGraph,
  persistCpdDraftAndSync,
  type CpdDraftEdge,
  type CpdDraftNode,
  type CpdLoopDraft,
} from "./cpdDraftStore";
import { getLevelModel } from "./data";
import { LEVEL_LABEL, LEVEL_ORDER, type LoopLevel } from "./types";

const ANALYSIS_DIMENSIONS = ["shop", "warehouse", "sku"] as const;
const MAX_EXTRA_STOCKS = 3;

export type BulkEnrichReport = {
  loops: number;
  nodesAdded: number;
  nodesBound: number;
  details: string[];
};

type LoopSeed = {
  level: LoopLevel;
  code: string;
  name: string;
  kind: "R" | "B" | "C";
  chain: string;
  leverage: string;
  edgeIds: string[];
  stockPath: string[];
};

function listAllLoopSeeds(): LoopSeed[] {
  const out: LoopSeed[] = [];

  for (const loop of CPD_LOOPS) {
    out.push({
      level: "company",
      code: loop.code,
      name: loop.name,
      kind: loop.kind,
      chain: loop.chain,
      leverage: loop.leverage,
      edgeIds: [...(loop.edgeIds || [])],
      stockPath: [...(loop.stockPath || [])],
    });
  }

  for (const level of LEVEL_ORDER) {
    if (level === "company") continue;
    const model = getLevelModel(level);
    for (const loop of model.loops) {
      out.push({
        level,
        code: loop.code,
        name: loop.name,
        kind: loop.kind,
        chain: loop.path,
        leverage: `${LEVEL_LABEL[level]}层杠杆优化`,
        edgeIds: [...(loop.edgeIds || [])],
        stockPath: [],
      });
    }
  }
  return out;
}

function draftFromSeed(seed: LoopSeed): CpdLoopDraft {
  const model = getLevelModel(seed.level);
  const byId = new Map(model.stocks.map((s) => [s.id, s]));
  const edgeIds = seed.edgeIds.filter((eid) => model.flows.some((f) => f.id === eid));

  let ids = (seed.stockPath || []).filter((id) => byId.has(id));
  if (!ids.length) {
    ids = [...new Set(edgeIds.flatMap((eid) => {
      const f = model.flows.find((x) => x.id === eid);
      return f ? [f.from, f.to] : [];
    }))];
  }

  const nodes: CpdDraftNode[] = ids.map((id) => {
    const stock = byId.get(id);
    return {
      id,
      code: stock?.code || id.toUpperCase(),
      name: stock?.label || id,
    };
  });
  const idSet = new Set(ids);
  const edges: CpdDraftEdge[] = edgeIds
    .map((eid) => model.flows.find((f) => f.id === eid))
    .filter((f): f is NonNullable<typeof f> => Boolean(f && idSet.has(f.from) && idSet.has(f.to)))
    .map((f) => ({
      id: f.id,
      from: f.from,
      to: f.to,
      label: f.label || (f.polarity === "-" ? "抑制" : "促进"),
      polarity: f.polarity,
    }));

  return {
    code: seed.code,
    name: seed.name,
    kind: seed.kind,
    chain: seed.chain,
    leverage: seed.leverage,
    stockPath: nodes.map((n) => n.id),
    edgeIds: edges.map((e) => e.id),
    steps: [],
    nodes,
    edges,
    explain: {
      stocks: nodes.map((n) => n.name).join("、"),
      flows: edges.map((e) => e.label).join("、"),
      delays: "",
      behavior: seed.chain,
      intervention: seed.leverage,
    },
    notes: [],
    level: seed.level,
  };
}

/** 从同层同链补齐关联存量，作为结构扩充 */
function enrichWithRelatedStocks(draft: CpdLoopDraft, level: LoopLevel): { draft: CpdLoopDraft; added: number } {
  const model = getLevelModel(level);
  const have = new Set(draft.nodes.map((n) => n.id));
  const loopEdgeSet = new Set(draft.edges.map((e) => e.id));
  const chainIds = new Set<string>();
  for (const f of model.flows) {
    if (loopEdgeSet.has(f.id)) f.chains.forEach((c) => chainIds.add(c));
  }

  const candidates: { id: string; score: number }[] = [];
  for (const f of model.flows) {
    const share = f.chains.some((c) => chainIds.has(c));
    if (!share) continue;
    for (const sid of [f.from, f.to]) {
      if (have.has(sid)) continue;
      const hit = candidates.find((c) => c.id === sid);
      if (hit) hit.score += 1;
      else candidates.push({ id: sid, score: 1 });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  let added = 0;
  const nodes = [...draft.nodes];
  const edges = [...draft.edges];
  const seenEdge = new Set(edges.map((e) => `${e.from}->${e.to}`));

  for (const cand of candidates) {
    if (added >= MAX_EXTRA_STOCKS) break;
    const stock = model.stocks.find((s) => s.id === cand.id);
    if (!stock) continue;
    nodes.push({
      id: stock.id,
      code: stock.code,
      name: stock.label,
    });
    have.add(stock.id);
    added += 1;

    const bridge = model.flows.find((f) => (
      (f.from === stock.id && have.has(f.to) && f.to !== stock.id)
      || (f.to === stock.id && have.has(f.from) && f.from !== stock.id)
    ));
    if (bridge) {
      const from = bridge.from;
      const to = bridge.to;
      const key = `${from}->${to}`;
      if (!seenEdge.has(key) && !seenEdge.has(`${to}->${from}`)) {
        seenEdge.add(key);
        edges.push({
          id: bridge.id,
          from,
          to,
          label: bridge.label || (bridge.polarity === "-" ? "抑制" : "促进"),
          polarity: bridge.polarity,
        });
      }
    }
  }

  return {
    draft: normalizeDraftGraph({
      ...draft,
      nodes,
      edges,
      notes: [
        `一键充实：补齐 ${added} 个关联维度存量；分析切片 ${ANALYSIS_DIMENSIONS.join("/")}`,
        ...draft.notes,
      ],
    }),
    added,
  };
}

function attachAnalysisDimensions(nodes: CpdDraftNode[]): CpdDraftNode[] {
  return nodes.map((n) => {
    const b = n.binding;
    if (!b || b.bind_type === "none") return n;
    if (b.bind_type === "knowledge") return n;
    const note = b.note?.includes("维度")
      ? b.note
      : [b.note, `分析维度:${ANALYSIS_DIMENSIONS.join(",")}`].filter(Boolean).join(" · ");
    return { ...n, binding: { ...b, note } };
  });
}

function mergeBaseAndExisting(seed: LoopSeed): CpdLoopDraft {
  const base = draftFromSeed(seed);
  const existing = loadCpdDraft(seed.code);
  if (!existing) return { ...base, level: seed.level };
  return normalizeDraftGraph({
    ...base,
    ...existing,
    level: existing.level || seed.level,
    name: existing.name || base.name,
    nodes: existing.nodes?.length ? existing.nodes : base.nodes,
    edges: existing.edges?.length ? existing.edges : base.edges,
    explain: { ...base.explain, ...(existing.explain || {}) },
    notes: existing.notes || [],
  });
}

/** 对目录内全部回路：补维度/关联点 → 本地自动接入数据 → 持久化并同步全图 */
export function enrichAllLoopsAndBind(opts?: {
  metrics?: MetricContractOption[];
  knowledgeBases?: KnowledgeBaseItem[];
  overwriteBind?: boolean;
}): BulkEnrichReport {
  const metrics = opts?.metrics || [];
  const knowledgeBases = opts?.knowledgeBases || [];
  const overwriteBind = opts?.overwriteBind !== false;

  const seeds = listAllLoopSeeds();
  let nodesAdded = 0;
  let nodesBound = 0;
  const details: string[] = [];

  for (const seed of seeds) {
    let draft = mergeBaseAndExisting(seed);
    const enriched = enrichWithRelatedStocks(draft, seed.level);
    draft = enriched.draft;
    nodesAdded += enriched.added;

    const bound = autoBindNodesLocal(draft.nodes, metrics, knowledgeBases, { overwrite: overwriteBind });
    draft = {
      ...draft,
      nodes: attachAnalysisDimensions(bound.nodes),
      notes: [
        `一键接入数据源：${bound.bound} 个节点`,
        ...bound.summary.slice(0, 4),
        ...draft.notes,
      ],
    };
    nodesBound += bound.bound;
    persistCpdDraftAndSync(draft, seed.level);
    details.push(`${LEVEL_LABEL[seed.level]}·${seed.code} +${enriched.added}维 / 绑${bound.bound}`);
  }

  return {
    loops: seeds.length,
    nodesAdded,
    nodesBound,
    details,
  };
}
