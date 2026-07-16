import { getLevelModel } from "./data";
import type { LoopLevel, NamedLoop } from "./types";
import { LEVEL_LABEL, LEVEL_ORDER } from "./types";
import { CONTAINMENT_LABELS, hubDisplayName, LOOP_LEVEL_ONTOLOGY } from "./commerceLevels";

export type LoopNodeKind = "hub" | "stock";

export type LoopGNode = {
  id: string;
  name: string;
  code: string;
  level: LoopLevel;
  levelLabel: string;
  kind: LoopNodeKind;
  sub?: string;
  details?: string[];
  color: string;
  val: number;
  /** 固定层级列布局 */
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
};

export type LoopGraphBundle = {
  nodes: LoopGNode[];
  links: LoopGLink[];
  loops: (NamedLoop & { level: LoopLevel })[];
};

const LEVEL_COLOR: Record<LoopLevel, string> = {
  company: "#0B2144",
  brand: "#B8863B",
  platform: "#3D6FA8",
  channel: "#6d28d9",
  link: "#0f766e",
  sku: "#ea580c",
};

const FOCUS_IDS: Record<LoopLevel, string[]> = {
  company: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
  brand: ["b1", "b2", "b3", "b4", "b5", "b6", "b7"],
  platform: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  channel: ["c1", "c2", "c3", "c5", "c7", "c8", "c9"],
  link: ["l1", "l2", "l3", "l4", "l6", "l7", "l8"],
  sku: ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k11", "k12", "k13"],
};

const COL_X: Record<LoopLevel, number> = {
  company: 0,
  brand: 220,
  platform: 440,
  channel: 660,
  link: 880,
  sku: 1120,
};

const HUB_Y = 0;
const STOCK_START_Y = 110;
const STOCK_GAP = 58;

function nid(level: LoopLevel, id: string) {
  return `${level}:${id}`;
}

function hubId(level: LoopLevel) {
  return `hub:${level}`;
}

const BRIDGES: {
  from: [LoopLevel, string];
  to: [LoopLevel, string];
  label: string;
  polarity: "+" | "-";
}[] = [
  { from: ["sku", "k3"], to: ["link", "l4"], label: "上卷销售", polarity: "+" },
  { from: ["link", "l4"], to: ["channel", "c2"], label: "上卷销售", polarity: "+" },
  { from: ["channel", "c2"], to: ["platform", "p3"], label: "上卷销售", polarity: "+" },
  { from: ["platform", "p3"], to: ["brand", "b3"], label: "上卷销售", polarity: "+" },
  { from: ["brand", "b3"], to: ["company", "s4"], label: "上卷销售", polarity: "+" },
  { from: ["sku", "k13"], to: ["channel", "c5"], label: "上卷库存", polarity: "+" },
  { from: ["channel", "c5"], to: ["platform", "p6"], label: "上卷占用", polarity: "+" },
  { from: ["platform", "p6"], to: ["brand", "b7"], label: "上卷资源", polarity: "+" },
  { from: ["brand", "b7"], to: ["company", "s8"], label: "上卷资源", polarity: "+" },
  { from: ["sku", "k11"], to: ["link", "l7"], label: "上卷利润", polarity: "+" },
  { from: ["link", "l7"], to: ["channel", "c3"], label: "上卷贡献", polarity: "+" },
  { from: ["channel", "c3"], to: ["platform", "p5"], label: "上卷利润", polarity: "+" },
  { from: ["platform", "p5"], to: ["brand", "b4"], label: "上卷利润池", polarity: "+" },
];

export function buildLoopForceGraph(filterLevel: LoopLevel | "all" = "all"): LoopGraphBundle {
  const nodes: LoopGNode[] = [];
  const links: LoopGLink[] = [];
  const loops: (NamedLoop & { level: LoopLevel })[] = [];
  const nodeSet = new Set<string>();

  const levels = filterLevel === "all" ? LEVEL_ORDER : [filterLevel];

  // 层级壳节点：公司（公司）/ 品牌（品牌）…
  for (const level of levels) {
    const id = hubId(level);
    const ont = LOOP_LEVEL_ONTOLOGY[level];
    nodes.push({
      id,
      name: hubDisplayName(level),
      code: ont.otype,
      level,
      levelLabel: LEVEL_LABEL[level],
      kind: "hub",
      sub: `${ont.typeKey} · ${ont.description}`,
      color: LEVEL_COLOR[level],
      val: level === "company" ? 28 : 22,
      fx: COL_X[level],
      fy: HUB_Y,
    });
    nodeSet.add(id);
  }

  // 包含关系：公司 → 品牌 → … → SKU（与 Ontology contains 对齐）
  if (filterLevel === "all") {
    for (const edge of CONTAINMENT_LABELS) {
      links.push({
        id: `contain-${edge.from}-${edge.to}`,
        source: hubId(edge.from),
        target: hubId(edge.to),
        label: edge.label,
        polarity: "+",
        cross: false,
        kind: "contain",
        chains: ["CONTAIN"],
      });
    }
  }

  for (const level of levels) {
    const model = getLevelModel(level);
    const ids = FOCUS_IDS[level];
    const idSet = new Set(ids);

    ids.forEach((id, idx) => {
      const s = model.stocks.find((x) => x.id === id);
      if (!s) return;
      const idFull = nid(level, id);
      nodeSet.add(idFull);
      // 奇偶微错开，避免竖线完全重叠
      const xJitter = (idx % 2 === 0 ? -28 : 28);
      nodes.push({
        id: idFull,
        name: s.label,
        code: s.code,
        level,
        levelLabel: LEVEL_LABEL[level],
        kind: "stock",
        sub: s.sub,
        details: s.details,
        color: LEVEL_COLOR[level],
        val: 10,
        fx: COL_X[level] + xJitter,
        fy: STOCK_START_Y + idx * STOCK_GAP,
      });

      // 层级壳「包含」本层指标
      links.push({
        id: `member-${idFull}`,
        source: hubId(level),
        target: idFull,
        label: "含指标",
        polarity: "+",
        cross: false,
        kind: "member",
        level,
        chains: ["MEMBER"],
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

    for (const lp of model.loops.slice(0, 4)) {
      loops.push({
        ...lp,
        level,
        code: `${LEVEL_LABEL[level]}·${lp.code}`,
        edgeIds: (lp.edgeIds || [])
          .filter((eid) => {
            const fl = model.flows.find((x) => x.id === eid);
            return fl && idSet.has(fl.from) && idSet.has(fl.to);
          })
          .map((eid) => `${level}-${eid}`),
      });
    }
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
        chains: ["ROLLUP"],
      });
    });
  }

  return { nodes, links, loops };
}

export { LEVEL_COLOR, COL_X };
