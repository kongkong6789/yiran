export type LoopLevel =
  | "fact"
  | "sku"
  | "link"
  | "channel"
  | "platform"
  | "brand"
  | "company";

export type Polarity = "+" | "-";

export type StockNode = {
  id: string;
  code: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  soft: string;
  /** 点击下钻到的层（公司 S4 → brand 销售额等） */
  drillLevel?: LoopLevel;
  /** SKU 层细项说明，点击展开 */
  details?: string[];
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  polarity: Polarity;
  delay?: boolean;
  chains: string[];
  label?: string;
  bend?: number;
};

export type NamedLoop = {
  code: string;
  kind: "R" | "B" | "C";
  name: string;
  path: string;
  chains?: string[];
  /** 高亮对应边 id */
  edgeIds?: string[];
};

export type ChainMeta = {
  id: string;
  name: string;
  color: string;
  desc: string;
};

export type LevelModel = {
  level: LoopLevel;
  title: string;
  subtitle: string;
  viewW: number;
  viewH: number;
  stocks: StockNode[];
  flows: FlowEdge[];
  chains: ChainMeta[];
  loops: NamedLoop[];
  /** 本层向上聚合说明 */
  rollupHint?: string;
  /** 向下钻取说明 */
  drillHint?: string;
};

export type HierarchyNode = {
  id: string;
  name: string;
  level: LoopLevel;
  children?: HierarchyNode[];
};

export const LEVEL_ORDER: LoopLevel[] = [
  "company",
  "brand",
  "platform",
  "channel",
  "link",
  "sku",
  "fact",
];

export const LEVEL_LABEL: Record<LoopLevel, string> = {
  company: "公司",
  brand: "品牌",
  platform: "平台",
  channel: "渠道",
  link: "链接",
  sku: "SKU",
  fact: "基础数据",
};

/** 从粗到细：下一层（可下钻） */
export const CHILD_LEVEL: Partial<Record<LoopLevel, LoopLevel>> = {
  company: "brand",
  brand: "platform",
  platform: "channel",
  channel: "link",
  link: "sku",
  sku: "fact",
};

/** 从细到粗：上一层 */
export const PARENT_LEVEL: Partial<Record<LoopLevel, LoopLevel>> = {
  brand: "company",
  platform: "brand",
  channel: "platform",
  link: "channel",
  sku: "link",
  fact: "sku",
};
