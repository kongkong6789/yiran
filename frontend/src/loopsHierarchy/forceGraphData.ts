import { getLevelModel } from "./data";
import type { LoopLevel, NamedLoop } from "./types";
import { LEVEL_LABEL, LEVEL_ORDER } from "./types";

export type LoopNodeKind = "hub" | "stock";
/** 基础数据（采集/事实表）浅色；衍生数据（计算/上卷）深色 */
export type LoopDataKind = "fact" | "derived";

export type LoopGNode = {
  id: string;
  name: string;
  code: string;
  level: LoopLevel;
  levelLabel: string;
  kind: LoopNodeKind;
  dataKind: LoopDataKind;
  sub?: string;
  details?: string[];
  color: string;
  softColor: string;
  val: number;
  custom?: boolean;
  /** 固定层级行布局（自上而下） */
  fx?: number;
  fy?: number;
  x?: number;
  y?: number;
};

export type LoopLinkKind = "contain" | "member" | "causal" | "rollup";

export type LoopGLink = {
  id: string;
  source: string | LoopGNode;
  target: string | LoopGNode;
  label: string;
  polarity: "+" | "-";
  delay?: boolean;
  cross: boolean;
  kind: LoopLinkKind;
  level?: LoopLevel;
  chains: string[];
  custom?: boolean;
};

export type LoopGraphBundle = {
  nodes: LoopGNode[];
  links: LoopGLink[];
  loops: (NamedLoop & { level: LoopLevel })[];
};

export type CustomStockNode = {
  id: string;
  level: LoopLevel;
  code: string;
  name: string;
  sub?: string;
  dataKind: LoopDataKind;
  /** 相对本层横向索引偏移，可选 */
  col?: number;
};

export type CustomCausalLink = {
  id: string;
  source: string;
  target: string;
  label: string;
  polarity: "+" | "-";
};

export type LoopGraphCustomState = {
  version: 1;
  stocks: CustomStockNode[];
  links: CustomCausalLink[];
  /** 节点位置覆盖 id → {x,y} */
  positions: Record<string, { x: number; y: number }>;
  /** CPD 草稿同步的节点改名 */
  labels?: Record<string, { code?: string; name?: string }>;
};

export const LOOP_CUSTOM_STORAGE_KEY = "lc-loop-graph-custom-v4";

export const LEVEL_COLOR: Record<LoopLevel, string> = {
  company: "#0B2144",
  brand: "#B8863B",
  platform: "#3D6FA8",
  channel: "#6d28d9",
  link: "#0f766e",
  sku: "#ea580c",
  fact: "#64748b",
};

/** 基础数据（浅）— 直接来自事实表或主数据 */
const FACT_IDS: Record<LoopLevel, Set<string>> = {
  company: new Set(["s1", "s2", "s4", "s6", "s8", "s10", "s13"]),
  brand: new Set(["b1", "b3", "b7"]),
  platform: new Set(["p1", "p2", "p3", "p4", "p6", "p7"]),
  channel: new Set(["c1", "c2", "c4", "c5", "c6", "c7", "c8", "c9", "c10"]),
  link: new Set(["l1", "l2", "l4", "l6", "l8"]),
  sku: new Set(["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k10"]),
  fact: new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"]),
};

const FOCUS_IDS: Record<LoopLevel, string[]> = {
  company: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11", "s12", "s13", "s14"],
  brand: ["b1", "b2", "b3", "b4", "b5", "b6", "b7"],
  platform: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  channel: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10"],
  link: ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"],
  sku: ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k10", "k11", "k12", "k13", "k14"],
  fact: ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"],
};

/** 自上而下：公司在上，基础数据在最下 */
export const ROW_Y: Record<LoopLevel, number> = {
  company: 0,
  brand: 260,
  platform: 520,
  channel: 780,
  link: 1040,
  sku: 1300,
  fact: 1560,
};

/** @deprecated 兼容旧引用 */
export const COL_X = ROW_Y;

/** 语义泳道：上卷链纵向对齐，减少交叉（整体横向约 1.5 倍） */
const LANE_X = {
  scale: 60, // 规模/矩阵
  traffic: 330, // 流量/认知
  sales: 630, // 销售主链
  profit: 960, // 利润主链
  cost: 1290, // 费用/成本
  inventory: 1620, // 库存/资源
  extra: 1920, // 其余
} as const;

type LaneKey = keyof typeof LANE_X;

const STOCK_LANE: Record<string, LaneKey> = {
  s1: "scale", s2: "traffic", s3: "traffic", s4: "sales", s5: "scale", s6: "cost", s7: "cost", s8: "inventory",
  s9: "traffic", s10: "traffic", s11: "cost", s12: "scale", s13: "extra", s14: "extra",
  b1: "scale", b2: "traffic", b3: "sales", b4: "profit", b5: "scale", b6: "cost", b7: "inventory",
  p1: "scale", p2: "traffic", p3: "sales", p4: "cost", p5: "profit", p6: "inventory", p7: "traffic",
  c1: "scale", c2: "sales", c3: "profit", c5: "inventory", c7: "cost", c8: "cost", c9: "traffic",
  l1: "scale", l2: "traffic", l3: "traffic", l4: "sales", l6: "cost", l7: "profit", l8: "cost",
  k1: "scale", k2: "traffic", k3: "sales", k4: "cost", k5: "cost", k6: "cost", k7: "traffic",
  k8: "inventory", k9: "inventory", k11: "profit", k12: "extra", k13: "inventory",
  f1: "sales", f2: "cost", f3: "traffic", f4: "traffic", f5: "inventory", f6: "scale", f7: "cost", f8: "scale",
};

/** 各层横向微错开，直线上卷不会叠成一条竖线 */
const LEVEL_X_NUDGE: Record<LoopLevel, number> = {
  company: 0,
  brand: 42,
  platform: -27,
  channel: 51,
  link: -21,
  sku: 33,
  fact: -12,
};

const LANE_SLOT: Record<string, number> = {};

function layoutStockXY(level: LoopLevel, stockId: string, fallbackIdx: number): { x: number; y: number } {
  const lane = STOCK_LANE[stockId] || "extra";
  const slotKey = `${level}:${lane}`;
  const used = LANE_SLOT[slotKey] ?? 0;
  LANE_SLOT[slotKey] = used + 1;
  // 同泳道内再错开一点，避免标签重叠
  const x = LANE_X[lane] + LEVEL_X_NUDGE[level] + used * 117;
  const y = ROW_Y[level] + (fallbackIdx % 2 === 0 ? -14 : 14);
  return { x, y };
}

/** 单层聚焦：椭圆排布 + 邻接重排减交叉，避免环形乱麻 */
function applyLevelFocusLayout(nodes: LoopGNode[], links: LoopGLink[]) {
  const stocks = nodes.filter((n) => n.kind === "stock");
  const n = Math.max(stocks.length, 1);
  const idToIdx = new Map(stocks.map((node, i) => [node.id, i]));
  let order = stocks.map((_, i) => i);

  // 几次重心法重排，让相连节点在圆周上更靠近
  for (let iter = 0; iter < 10; iter += 1) {
    const score = stocks.map(() => ({ sum: 0, cnt: 0 }));
    const posOf = (idx: number) => order.indexOf(idx);
    links.forEach((l) => {
      if (l.kind !== "causal") return;
      const s = typeof l.source === "object" ? l.source.id : String(l.source);
      const t = typeof l.target === "object" ? l.target.id : String(l.target);
      const si = idToIdx.get(s);
      const ti = idToIdx.get(t);
      if (si == null || ti == null) return;
      score[si].sum += posOf(ti);
      score[si].cnt += 1;
      score[ti].sum += posOf(si);
      score[ti].cnt += 1;
    });
    order = [...order].sort((a, b) => {
      const sa = score[a].cnt ? score[a].sum / score[a].cnt : posOf(a);
      const sb = score[b].cnt ? score[b].sum / score[b].cnt : posOf(b);
      return sa - sb || a - b;
    });
  }

  const cx = 780;
  const cy = 340;
  const rx = Math.max(450, 150 + n * 36);
  const ry = Math.max(220, 80 + n * 18);

  order.forEach((stockIdx, i) => {
    const node = stocks[stockIdx];
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    // 基础略靠内、衍生略靠外，幅度克制，避免内外圈交叉更乱
    const ring = node.dataKind === "fact" ? 0.82 : 1;
    const x = cx + rx * ring * Math.cos(a);
    const y = cy + ry * ring * Math.sin(a);
    node.fx = x;
    node.fy = y;
    node.x = x;
    node.y = y;
  });
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number) {
  const to = (v: number) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** t=0 浅（基础），t=1 深（衍生） */
export function shadeLevelColor(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = clamp01(t);
  // 浅：与白混合；深：略压暗
  const light = {
    r: r + (255 - r) * 0.55,
    g: g + (255 - g) * 0.55,
    b: b + (255 - b) * 0.55,
  };
  const dark = {
    r: r * 0.72,
    g: g * 0.72,
    b: b * 0.72,
  };
  return rgbToHex(
    light.r + (dark.r - light.r) * mix,
    light.g + (dark.g - light.g) * mix,
    light.b + (dark.b - light.b) * mix,
  );
}

export function softLevelColor(hex: string, dataKind: LoopDataKind): string {
  return shadeLevelColor(hex, dataKind === "fact" ? 0.08 : 0.78);
}

export function nodeColorFor(level: LoopLevel, dataKind: LoopDataKind, kind: LoopNodeKind): string {
  const base = LEVEL_COLOR[level];
  if (kind === "hub") return base;
  return softLevelColor(base, dataKind);
}

function resolveDataKind(level: LoopLevel, stockId: string): LoopDataKind {
  return FACT_IDS[level].has(stockId) ? "fact" : "derived";
}

function nid(level: LoopLevel, id: string) {
  return `${level}:${id}`;
}

const BRIDGES: {
  from: [LoopLevel, string];
  to: [LoopLevel, string];
  label: string;
  polarity: "+" | "-";
  chain: "sales" | "profit" | "resource" | "source";
}[] = [
  { from: ["fact", "f1"], to: ["sku", "k2"], label: "支撑销量", polarity: "+", chain: "sales" },
  { from: ["fact", "f1"], to: ["sku", "k3"], label: "支撑销售", polarity: "+", chain: "sales" },
  { from: ["fact", "f2"], to: ["sku", "k4"], label: "支撑退款", polarity: "+", chain: "source" },
  { from: ["fact", "f3"], to: ["sku", "k7"], label: "支撑推广", polarity: "+", chain: "source" },
  { from: ["fact", "f4"], to: ["sku", "k2"], label: "支撑流量转化", polarity: "+", chain: "sales" },
  { from: ["fact", "f5"], to: ["sku", "k13"], label: "支撑库存", polarity: "+", chain: "resource" },
  { from: ["fact", "f6"], to: ["sku", "k1"], label: "支撑价盘", polarity: "+", chain: "source" },
  { from: ["fact", "f6"], to: ["sku", "k5"], label: "支撑成本", polarity: "+", chain: "source" },
  { from: ["fact", "f7"], to: ["sku", "k6"], label: "支撑平台费", polarity: "+", chain: "source" },
  { from: ["sku", "k3"], to: ["link", "l4"], label: "上卷销售", polarity: "+", chain: "sales" },
  { from: ["link", "l4"], to: ["channel", "c2"], label: "上卷销售", polarity: "+", chain: "sales" },
  { from: ["channel", "c2"], to: ["platform", "p3"], label: "上卷销售", polarity: "+", chain: "sales" },
  { from: ["platform", "p3"], to: ["brand", "b3"], label: "上卷销售", polarity: "+", chain: "sales" },
  { from: ["brand", "b3"], to: ["company", "s4"], label: "上卷销售", polarity: "+", chain: "sales" },
  { from: ["sku", "k13"], to: ["channel", "c5"], label: "上卷库存", polarity: "+", chain: "resource" },
  { from: ["channel", "c5"], to: ["platform", "p6"], label: "上卷占用", polarity: "+", chain: "resource" },
  { from: ["platform", "p6"], to: ["brand", "b7"], label: "上卷资源", polarity: "+", chain: "resource" },
  { from: ["brand", "b7"], to: ["company", "s8"], label: "上卷资源", polarity: "+", chain: "resource" },
  { from: ["sku", "k11"], to: ["link", "l7"], label: "上卷利润", polarity: "+", chain: "profit" },
  { from: ["link", "l7"], to: ["channel", "c3"], label: "上卷贡献", polarity: "+", chain: "profit" },
  { from: ["channel", "c3"], to: ["platform", "p5"], label: "上卷利润", polarity: "+", chain: "profit" },
  { from: ["platform", "p5"], to: ["brand", "b4"], label: "上卷利润池", polarity: "+", chain: "profit" },
];

export function emptyCustomState(): LoopGraphCustomState {
  return { version: 1, stocks: [], links: [], positions: {}, labels: {} };
}

export function loadLoopCustomState(): LoopGraphCustomState {
  try {
    const rawCur = localStorage.getItem(LOOP_CUSTOM_STORAGE_KEY);
    const rawPrev =
      localStorage.getItem("lc-loop-graph-custom-v3")
      || localStorage.getItem("lc-loop-graph-custom-v2")
      || localStorage.getItem("lc-loop-graph-custom-v1");
    const raw = rawCur || rawPrev;
    if (!raw) return emptyCustomState();
    const parsed = JSON.parse(raw) as LoopGraphCustomState;
    if (!parsed) return emptyCustomState();
    return {
      version: 1,
      stocks: Array.isArray(parsed.stocks) ? parsed.stocks : [],
      links: Array.isArray(parsed.links) ? parsed.links : [],
      positions: rawCur && parsed.positions && typeof parsed.positions === "object"
        ? parsed.positions
        : {},
      labels: parsed.labels && typeof parsed.labels === "object" ? parsed.labels : {},
    };
  } catch {
    return emptyCustomState();
  }
}

export function saveLoopCustomState(state: LoopGraphCustomState) {
  localStorage.setItem(LOOP_CUSTOM_STORAGE_KEY, JSON.stringify(state));
}

export function buildLoopForceGraph(
  filterLevel: LoopLevel | "all" = "all",
  custom: LoopGraphCustomState = emptyCustomState(),
): LoopGraphBundle {
  const nodes: LoopGNode[] = [];
  const links: LoopGLink[] = [];
  const loops: (NamedLoop & { level: LoopLevel })[] = [];
  const nodeSet = new Set<string>();

  // 每次重建清空泳道占用
  for (const k of Object.keys(LANE_SLOT)) delete LANE_SLOT[k];

  const levels = filterLevel === "all"
    ? [...LEVEL_ORDER]
    : [filterLevel];

  // 不再绘制左侧「层级壳 + 包含」脊柱，只保留各层指标节点

  for (const level of levels) {
    const model = getLevelModel(level);
    const ids = FOCUS_IDS[level];
    const idSet = new Set(ids);

    ids.forEach((id, idx) => {
      const s = model.stocks.find((x) => x.id === id);
      if (!s) return;
      const idFull = nid(level, id);
      nodeSet.add(idFull);
      const dataKind = resolveDataKind(level, id);
      const color = nodeColorFor(level, dataKind, "stock");
      const laid = layoutStockXY(level, id, idx);
      const pos = custom.positions[idFull];
      nodes.push({
        id: idFull,
        name: s.label,
        code: s.code,
        level,
        levelLabel: LEVEL_LABEL[level],
        kind: "stock",
        dataKind,
        sub: s.sub,
        details: s.details,
        color,
        softColor: shadeLevelColor(LEVEL_COLOR[level], dataKind === "fact" ? 0.05 : 0.55),
        val: dataKind === "fact" ? 8 : 10,
        fx: pos?.x ?? laid.x,
        fy: pos?.y ?? laid.y,
      });
    });

    for (const f of model.flows) {
      if (!idSet.has(f.from) || !idSet.has(f.to)) continue;
      links.push({
        id: `${level}-${f.id}`,
        source: nid(level, f.from),
        target: nid(level, f.to),
        label: f.label || (f.polarity === "-" ? "抑制" : "促进"),
        polarity: f.polarity,
        delay: f.delay,
        cross: false,
        kind: "causal",
        level,
        chains: f.chains,
      });
    }

    // 公司层保留 CPD 原始编码（R1/B1/C1…）；其它层加层级前缀避免冲突
    for (const lp of model.loops) {
      loops.push({
        ...lp,
        level,
        code: level === "company" ? lp.code : `${LEVEL_LABEL[level]}·${lp.code}`,
        edgeIds: (lp.edgeIds || [])
          .filter((eid) => {
            const fl = model.flows.find((x) => x.id === eid);
            return fl && idSet.has(fl.from) && idSet.has(fl.to);
          })
          .map((eid) => `${level}-${eid}`),
      });
    }
  }

  // 自定义节点
  for (const cs of custom.stocks) {
    if (filterLevel !== "all" && cs.level !== filterLevel) continue;
    const idFull = cs.id.startsWith(`${cs.level}:`) ? cs.id : nid(cs.level, cs.id);
    if (nodeSet.has(idFull)) continue;
    nodeSet.add(idFull);
    const dataKind = cs.dataKind || "fact";
    const color = nodeColorFor(cs.level, dataKind, "stock");
    const siblings = nodes.filter((n) => n.level === cs.level && n.kind === "stock").length;
    const col = cs.col ?? siblings;
    const pos = custom.positions[idFull];
    nodes.push({
      id: idFull,
      name: cs.name,
      code: cs.code,
      level: cs.level,
      levelLabel: LEVEL_LABEL[cs.level],
      kind: "stock",
      dataKind,
      sub: cs.sub,
      color,
      softColor: shadeLevelColor(LEVEL_COLOR[cs.level], dataKind === "fact" ? 0.05 : 0.55),
      val: 10,
      custom: true,
      fx: pos?.x ?? (LANE_X.extra + col * 56),
      fy: pos?.y ?? (ROW_Y[cs.level] + (col % 2 === 0 ? -10 : 10)),
    });
  }

  // 自定义因果边
  for (const cl of custom.links) {
    if (!nodeSet.has(cl.source) || !nodeSet.has(cl.target)) continue;
    links.push({
      id: cl.id,
      source: cl.source,
      target: cl.target,
      label: cl.label || (cl.polarity === "-" ? "抑制" : "促进"),
      polarity: cl.polarity,
      cross: false,
      kind: "causal",
      chains: ["CUSTOM"],
      custom: true,
    });
  }

  if (filterLevel === "all") {
    BRIDGES.forEach((b, i) => {
      const s = nid(b.from[0], b.from[1]);
      const t = nid(b.to[0], b.to[1]);
      if (!nodeSet.has(s) || !nodeSet.has(t)) return;
      links.push({
        id: `cross-${i}`,
        source: s,
        target: t,
        label: b.label,
        polarity: b.polarity,
        cross: true,
        kind: "rollup",
        chains: ["ROLLUP", b.chain],
      });
    });
  } else {
    applyLevelFocusLayout(nodes, links);
  }

  return { nodes, links, loops };
}

export { FACT_IDS };
