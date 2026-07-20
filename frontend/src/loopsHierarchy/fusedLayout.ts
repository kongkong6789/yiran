import { getLevelModel } from "./data";
import type { FlowEdge, LoopLevel, NamedLoop, StockNode } from "./types";
import { LEVEL_LABEL, LEVEL_ORDER } from "./types";

export type FusedStock = StockNode & {
  level: LoopLevel;
  /** 全局唯一 id：level:id */
  gid: string;
};

export type FusedFlow = FlowEdge & {
  level?: LoopLevel;
  /** 跨层边 */
  cross?: boolean;
  fromGid: string;
  toGid: string;
};

export type LaneBand = {
  level: LoopLevel;
  label: string;
  y: number;
  h: number;
  color: string;
};

export type FusedScene = {
  viewW: number;
  viewH: number;
  lanes: LaneBand[];
  stocks: FusedStock[];
  flows: FusedFlow[];
  loops: (NamedLoop & { level: LoopLevel })[];
};

const LANE_H = 220;
const LANE_GAP = 28;
const PAD_TOP = 36;
const VIEW_W = 1080;

const LANE_TINT: Record<LoopLevel, string> = {
  company: "#eef2ff",
  brand: "#f5f0e8",
  platform: "#eef6fb",
  channel: "#f3f0fa",
  link: "#eef8f4",
  sku: "#faf6f0",
  fact: "#f1f5f9",
};

/** 每层保留关键节点，便于一屏融合（完整细项点开仍可见 details） */
const FOCUS_IDS: Record<LoopLevel, string[]> = {
  company: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"],
  brand: ["b1", "b2", "b3", "b4", "b5", "b6", "b7"],
  platform: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
  channel: ["c1", "c2", "c3", "c5", "c7", "c8", "c9"],
  link: ["l1", "l2", "l3", "l4", "l6", "l7", "l8"],
  sku: ["k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k11", "k12", "k13"],
  fact: ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"],
};

/** 层内节点在泳道内的相对排布（紧凑一行/两行） */
function layoutInLane(level: LoopLevel, ids: string[], laneY: number): Record<string, { x: number; y: number; w: number; h: number }> {
  const model = getLevelModel(level);
  const byId = Object.fromEntries(model.stocks.map((s) => [s.id, s]));
  const n = ids.length;
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};

  // 公司层：近似原图 8 点环位
  if (level === "company") {
    const map: Record<string, { x: number; y: number }> = {
      s1: { x: 60, y: 70 },
      s2: { x: 250, y: 28 },
      s3: { x: 460, y: 28 },
      s4: { x: 720, y: 70 },
      s5: { x: 430, y: 150 },
      s6: { x: 60, y: 150 },
      s7: { x: 280, y: 110 },
      s8: { x: 620, y: 145 },
    };
    for (const id of ids) {
      const base = byId[id];
      const p = map[id] || { x: 40, y: 40 };
      out[id] = { x: p.x, y: laneY + p.y, w: base?.w ?? 120, h: 52 };
    }
    return out;
  }

  // 其它层：两行网格
  const cols = Math.ceil(n / 2);
  const cellW = Math.min(150, (VIEW_W - 80) / cols);
  ids.forEach((id, i) => {
    const base = byId[id];
    const row = i < cols ? 0 : 1;
    const col = i < cols ? i : i - cols;
    const w = Math.min(base?.w ?? 120, cellW - 10);
    out[id] = {
      x: 48 + col * cellW,
      y: laneY + 36 + row * 78,
      w,
      h: 52,
    };
  });
  return out;
}

function gid(level: LoopLevel, id: string) {
  return `${level}:${id}`;
}

export function buildFusedScene(): FusedScene {
  const lanes: LaneBand[] = [];
  const stocks: FusedStock[] = [];
  const flows: FusedFlow[] = [];
  const loops: (NamedLoop & { level: LoopLevel })[] = [];

  LEVEL_ORDER.forEach((level, idx) => {
    const y = PAD_TOP + idx * (LANE_H + LANE_GAP);
    lanes.push({
      level,
      label: LEVEL_LABEL[level],
      y,
      h: LANE_H,
      color: LANE_TINT[level],
    });

    const model = getLevelModel(level);
    const ids = FOCUS_IDS[level];
    const pos = layoutInLane(level, ids, y);
    const idSet = new Set(ids);

    for (const id of ids) {
      const base = model.stocks.find((s) => s.id === id)!;
      const p = pos[id];
      stocks.push({
        ...base,
        ...p,
        level,
        gid: gid(level, id),
        label: base.label,
      });
    }

    for (const f of model.flows) {
      if (!idSet.has(f.from) || !idSet.has(f.to)) continue;
      flows.push({
        ...f,
        id: `${level}-${f.id}`,
        level,
        fromGid: gid(level, f.from),
        toGid: gid(level, f.to),
        cross: false,
      });
    }

    for (const lp of model.loops.slice(0, 3)) {
      loops.push({
        ...lp,
        level,
        code: `${LEVEL_LABEL[level]}·${lp.code}`,
        edgeIds: (lp.edgeIds || [])
          .filter((eid) => model.flows.some((f) => f.id === eid && idSet.has(f.from) && idSet.has(f.to)))
          .map((eid) => `${level}-${eid}`),
      });
    }
  });

  // 跨层上卷桥：销售链 + 资源链
  const bridges: { from: [LoopLevel, string]; to: [LoopLevel, string]; label: string; polarity: "+" | "-" }[] = [
    { from: ["fact", "f1"], to: ["sku", "k3"], label: "订单→SKU销售", polarity: "+" },
    { from: ["fact", "f2"], to: ["sku", "k4"], label: "退款→SKU退款", polarity: "+" },
    { from: ["fact", "f5"], to: ["sku", "k13"], label: "库存→SKU周转", polarity: "+" },
    { from: ["sku", "k3"], to: ["link", "l4"], label: "SKU→页销售", polarity: "+" },
    { from: ["link", "l4"], to: ["channel", "c2"], label: "页→店销售", polarity: "+" },
    { from: ["channel", "c2"], to: ["platform", "p3"], label: "店→平台销售", polarity: "+" },
    { from: ["platform", "p3"], to: ["brand", "b3"], label: "平台→品牌销售", polarity: "+" },
    { from: ["brand", "b3"], to: ["company", "s4"], label: "品牌→公司销售", polarity: "+" },
    { from: ["sku", "k13"], to: ["channel", "c5"], label: "SKU库存→渠道", polarity: "+" },
    { from: ["channel", "c5"], to: ["platform", "p6"], label: "渠道→平台占用", polarity: "+" },
    { from: ["platform", "p6"], to: ["brand", "b7"], label: "平台→品牌资源", polarity: "+" },
    { from: ["brand", "b7"], to: ["company", "s8"], label: "品牌→公司资源", polarity: "+" },
    { from: ["sku", "k11"], to: ["link", "l7"], label: "SKU利润→页", polarity: "+" },
    { from: ["link", "l7"], to: ["channel", "c3"], label: "页→渠道贡献", polarity: "+" },
    { from: ["channel", "c3"], to: ["platform", "p5"], label: "渠道→平台利润", polarity: "+" },
    { from: ["platform", "p5"], to: ["brand", "b4"], label: "平台→品牌利润池", polarity: "+" },
  ];

  bridges.forEach((b, i) => {
    const fromG = gid(b.from[0], b.from[1]);
    const toG = gid(b.to[0], b.to[1]);
    if (!stocks.some((s) => s.gid === fromG) || !stocks.some((s) => s.gid === toG)) return;
    flows.push({
      id: `cross-${i}`,
      from: b.from[1],
      to: b.to[1],
      fromGid: fromG,
      toGid: toG,
      polarity: b.polarity,
      chains: ["ROLLUP"],
      label: b.label,
      bend: 0.08,
      cross: true,
    });
  });

  const viewH = PAD_TOP + LEVEL_ORDER.length * (LANE_H + LANE_GAP) + 24;

  return { viewW: VIEW_W, viewH, lanes, stocks, flows, loops };
}

export const FUSED_ROLLUP_CHAIN = {
  id: "ROLLUP",
  name: "层间上卷",
  color: "#C4924A",
  desc: "SKU→链接→渠道→平台→品牌→公司：销售 / 利润 / 资源贯通",
};
