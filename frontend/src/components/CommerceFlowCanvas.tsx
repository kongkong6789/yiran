import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, Panel, Position, ReactFlow,
  ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AppstoreOutlined, BankOutlined, BarcodeOutlined, CrownOutlined, DatabaseOutlined,
  ShopOutlined, TagsOutlined,
} from "@ant-design/icons";
import type { FeedbackLoop, OntGraph, OntObject } from "../api/client";
import { filterCommerceObjects } from "../utils/commerceGraphFilter";

type Level = "company" | "brand" | "platform" | "channel" | "link" | "sku" | "fact";

export type FlowNodeDatum = {
  key: string;
  name: string;
  sub: string;
  level: Level;
  objectIds: number[];
  metrics: { label: string; value: string }[];
};

type CardData = FlowNodeDatum & { focused: boolean; dimmed: boolean };

const LEVELS: Level[] = ["company", "brand", "platform", "channel", "link", "sku", "fact"];

export const LEVEL_META: Record<Level, { label: string; color: string; soft: string; icon: React.ReactNode }> = {
  company: { label: "公司", color: "#1f3d6b", soft: "#eaf1fb", icon: <BankOutlined /> },
  brand: { label: "品牌", color: "#b07d2b", soft: "#fbf1de", icon: <CrownOutlined /> },
  platform: { label: "平台", color: "#3d6fa8", soft: "#e8f1fc", icon: <AppstoreOutlined /> },
  channel: { label: "店铺", color: "#7c53c4", soft: "#f2ecfd", icon: <ShopOutlined /> },
  link: { label: "SPU", color: "#16806f", soft: "#e4f6f2", icon: <TagsOutlined /> },
  sku: { label: "SKU", color: "#d4642a", soft: "#fdeee3", icon: <BarcodeOutlined /> },
  fact: { label: "基础数据", color: "#5a6b82", soft: "#eef1f6", icon: <DatabaseOutlined /> },
};

const PLATFORM_LABEL: Record<string, string> = {
  tmall: "天猫", douyin: "抖音", jd: "京东", pdd: "拼多多", xhs: "小红书",
};

const NODE_W = 210;
const ROW_GAP = 168;
const COL_GAP = 250;

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function preferred(objects: OntObject[], keyOf: (o: OntObject) => string) {
  const map = new Map<string, OntObject>();
  objects.forEach((o) => {
    const key = keyOf(o);
    if (!key) return;
    const prev = map.get(key);
    const prevJk = text(prev?.attributes?._db_key).includes("JK-");
    const curJk = text(o.attributes?._db_key).includes("JK-");
    if (!prev || (prevJk && !curJk)) map.set(key, o);
  });
  return [...map.values()];
}

function CommerceNode({ data, selected }: NodeProps) {
  const d = data as unknown as CardData;
  const meta = LEVEL_META[d.level];
  return (
    <div
      className={`cflow-node${selected || d.focused ? " is-active" : ""}${d.dimmed ? " is-dim" : ""}`}
      style={{ ["--cflow-accent" as string]: meta.color, ["--cflow-soft" as string]: meta.soft }}
    >
      <Handle type="target" position={Position.Top} className="cflow-handle" />
      <span className="cflow-node-badge">{meta.icon}</span>
      <span className="cflow-node-body">
        <b title={d.name}>{d.name}</b>
        <small>{d.sub || meta.label}</small>
      </span>
      <Handle type="source" position={Position.Bottom} className="cflow-handle" />
    </div>
  );
}

const NODE_TYPES = { commerce: CommerceNode };

function buildFlow(graph: OntGraph, loops: FeedbackLoop[], selectedLoop: FeedbackLoop | null) {
  const objects = filterCommerceObjects(graph.objects);
  const objectToKey = new Map<number, string>();
  const nodeMap = new Map<string, FlowNodeDatum>();
  const addNode = (n: FlowNodeDatum) => {
    if (!nodeMap.has(n.key)) nodeMap.set(n.key, n);
    const node = nodeMap.get(n.key)!;
    n.objectIds.forEach((id) => {
      objectToKey.set(id, n.key);
      if (!node.objectIds.includes(id)) node.objectIds.push(id);
    });
    return node;
  };

  const shops = preferred(
    objects.filter((o) => o.otype === "店铺"),
    (o) => text(o.attributes.shop_id).replace(/^JK-/, "") || o.name,
  );
  const products = preferred(
    objects.filter((o) => o.otype === "商品" || o.otype === "SKU"),
    (o) => text(o.attributes.sku).replace(/^JK-/, "") || o.name,
  );
  const companies = objects.filter((o) => o.otype === "公司");
  const spuCount = new Set(products.map((p) => text(p.attributes.spu) || p.name)).size;

  addNode({
    key: "company:root",
    name: companies[0]?.name || "公司经营全景",
    sub: `${shops.length} 店铺 · ${spuCount} SPU · ${products.length} SKU`,
    level: "company",
    objectIds: companies.map((o) => o.id),
    metrics: [
      { label: "店铺数", value: String(shops.length) },
      { label: "SPU 数", value: String(spuCount) },
      { label: "SKU 数", value: String(products.length) },
    ],
  });

  const brandName = (o: OntObject) => text(o.attributes.brand) || "未归属品牌";
  [...shops, ...products].forEach((o) => {
    addNode({
      key: `brand:${brandName(o)}`, name: brandName(o), sub: "品牌经营单元",
      level: "brand", objectIds: [o.id], metrics: [],
    });
  });

  shops.forEach((shop) => {
    const platformKey = text(shop.attributes.platform) || "other";
    const b = brandName(shop);
    addNode({
      key: `platform:${b}:${platformKey}`,
      name: PLATFORM_LABEL[platformKey] || platformKey,
      sub: "销售平台", level: "platform", objectIds: [], metrics: [],
    });
    addNode({
      key: `shop:${text(shop.attributes.shop_id).replace(/^JK-/, "") || shop.id}`,
      name: shop.name, sub: text(shop.attributes.shop_id) || "店铺",
      level: "channel", objectIds: [shop.id], metrics: [],
    });
  });

  products.forEach((product) => {
    const b = brandName(product);
    const spu = text(product.attributes.spu) || product.name;
    addNode({
      key: `link:${b}:${spu}`, name: spu, sub: "商品款 · SPU（含多个 SKU）",
      level: "link", objectIds: [], metrics: [],
    });
    addNode({
      key: `sku:${text(product.attributes.sku).replace(/^JK-/, "") || product.id}`,
      name: product.name, sub: `${text(product.attributes.sku) || "SKU"} · 单品`,
      level: "sku", objectIds: [product.id], metrics: [],
    });
  });

  const factObjects = objects.filter((o) => (
    ["指标定义", "指标快照", "销售明细", "店铺日汇总", "商品日汇总", "异常预警"].includes(o.otype)
  ));
  const factGroups = new Map<string, OntObject[]>();
  factObjects.forEach((o) => {
    const key = o.otype === "指标定义" ? `metric:${o.name}` : `group:${o.otype}`;
    factGroups.set(key, [...(factGroups.get(key) || []), o]);
  });
  [...factGroups.entries()].slice(0, 8).forEach(([key, objs]) => {
    const first = objs[0];
    addNode({
      key: `fact:${key}`,
      name: key.startsWith("metric:") ? first.name : first.otype,
      sub: key.startsWith("metric:") ? text(first.attributes.formula) || "经营指标" : `${objs.length} 条真实数据`,
      level: "fact", objectIds: objs.map((o) => o.id), metrics: [],
    });
  });

  type FlowEdge = { id: string; source: string; target: string; label: string; kind: "hierarchy" | "loop"; polarity?: string; emphasized?: boolean };
  const edges: FlowEdge[] = [];
  const addEdge = (e: FlowEdge) => {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target) || e.source === e.target) return;
    if (!edges.some((x) => x.id === e.id)) edges.push(e);
  };

  [...nodeMap.values()].filter((n) => n.level === "brand").forEach((brand) => {
    addEdge({ id: `h:company:${brand.key}`, source: "company:root", target: brand.key, label: "经营品牌", kind: "hierarchy" });
  });
  shops.forEach((shop) => {
    const b = brandName(shop);
    const platformKey = text(shop.attributes.platform) || "other";
    addEdge({ id: `h:${b}:${platformKey}`, source: `brand:${b}`, target: `platform:${b}:${platformKey}`, label: "经营平台", kind: "hierarchy" });
    addEdge({
      id: `h:plat:${shop.id}`, source: `platform:${b}:${platformKey}`,
      target: `shop:${text(shop.attributes.shop_id).replace(/^JK-/, "") || shop.id}`, label: "包含店铺", kind: "hierarchy",
    });
  });
  products.forEach((product) => {
    const b = brandName(product);
    const spu = text(product.attributes.spu) || product.name;
    const linkKey = `link:${b}:${spu}`;
    shops.filter((s) => brandName(s) === b).forEach((shop) => {
      addEdge({
        id: `h:shop:${shop.id}:${linkKey}`,
        source: `shop:${text(shop.attributes.shop_id).replace(/^JK-/, "") || shop.id}`,
        target: linkKey, label: "在售链接", kind: "hierarchy",
      });
    });
    addEdge({
      id: `h:${linkKey}:sku:${product.id}`, source: linkKey,
      target: `sku:${text(product.attributes.sku).replace(/^JK-/, "") || product.id}`, label: "包含 SKU", kind: "hierarchy",
    });
  });
  const factKeys = [...nodeMap.values()].filter((n) => n.level === "fact");
  [...nodeMap.values()].filter((n) => n.level === "sku").forEach((sku, i) => {
    if (!factKeys.length) return;
    const target = factKeys[i % factKeys.length];
    addEdge({ id: `h:data:${sku.key}:${target.key}`, source: sku.key, target: target.key, label: "数据支撑", kind: "hierarchy" });
  });

  objects.forEach((o) => {
    if (objectToKey.has(o.id)) return;
    const match = [...nodeMap.values()].find((n) => n.name === o.name && (
      (o.otype === "店铺" && n.level === "channel")
      || ((o.otype === "商品" || o.otype === "SKU") && n.level === "sku")
      || (o.otype === "指标定义" && n.level === "fact")
    ));
    if (match) objectToKey.set(o.id, match.key);
  });
  // 默认叠加全部回路的因果边；被选中的回路加粗强调
  const selectedId = selectedLoop?.id ?? null;
  const seenLoopEdge = new Map<string, string>();
  loops.forEach((loop) => {
    const emphasized = loop.id === selectedId;
    (loop.members || []).forEach((m) => {
      const s = objectToKey.get(m.relation.source);
      const t = objectToKey.get(m.relation.target);
      if (!s || !t || s === t) return;
      const polarity = m.relation.polarity || "+";
      const key = `${s}->${t}:${polarity}`;
      const existingId = seenLoopEdge.get(key);
      if (existingId) {
        if (emphasized) {
          const prev = edges.find((x) => x.id === existingId);
          if (prev) prev.emphasized = true;
        }
        return;
      }
      const id = `loop:${loop.id}:${m.id}`;
      seenLoopEdge.set(key, id);
      addEdge({
        id, source: s, target: t,
        label: m.relation.label || "因果影响", kind: "loop", polarity, emphasized,
      });
    });
  });

  // 分层布局：每层一行，行内均匀展开并居中
  const byLevel = new Map<Level, FlowNodeDatum[]>();
  LEVELS.forEach((lv) => byLevel.set(lv, [...nodeMap.values()].filter((n) => n.level === lv)));
  const maxRow = Math.max(1, ...LEVELS.map((lv) => byLevel.get(lv)!.length));
  const canvasW = maxRow * COL_GAP;

  const positions = new Map<string, { x: number; y: number }>();
  LEVELS.forEach((lv, rowIdx) => {
    const row = byLevel.get(lv)!;
    const rowW = row.length * COL_GAP;
    const startX = (canvasW - rowW) / 2 + (COL_GAP - NODE_W) / 2;
    row.forEach((n, i) => {
      positions.set(n.key, { x: startX + i * COL_GAP, y: rowIdx * ROW_GAP });
    });
  });

  return { nodeMap, edges, positions };
}

type Props = {
  graph: OntGraph;
  loops: FeedbackLoop[];
  selectedLoop: FeedbackLoop | null;
  selectedNodeKey: string | null;
  onSelectNode: (node: FlowNodeDatum | null) => void;
};

function FlowInner({ graph, loops, selectedLoop, selectedNodeKey, onSelectNode }: Props) {
  const built = useMemo(() => buildFlow(graph, loops, selectedLoop), [graph, loops, selectedLoop]);
  const [visibleLevels, setVisibleLevels] = useState<Set<Level>>(new Set(LEVELS));
  const hasSelectedLoop = !!selectedLoop;
  const { fitView } = useReactFlow();

  const loopNodeKeys = useMemo(() => {
    const set = new Set<string>();
    built.edges.forEach((e) => {
      if (e.kind !== "loop") return;
      set.add(e.source);
      set.add(e.target);
    });
    return set;
  }, [built.edges]);

  const rfNodes = useMemo<Node[]>(() => (
    [...built.nodeMap.values()]
      .filter((n) => visibleLevels.has(n.level))
      .map((n) => ({
        id: n.key,
        type: "commerce",
        position: built.positions.get(n.key) || { x: 0, y: 0 },
        data: {
          ...n,
          focused: loopNodeKeys.has(n.key),
          dimmed: false,
        } as unknown as Record<string, unknown>,
        selected: n.key === selectedNodeKey,
      }))
  ), [built, visibleLevels, loopNodeKeys, selectedNodeKey]);

  const rfEdges = useMemo<Edge[]>(() => (
    built.edges
      .filter((e) => visibleLevels.has(built.nodeMap.get(e.source)!.level) && visibleLevels.has(built.nodeMap.get(e.target)!.level))
      .map((e) => {
        const negative = e.polarity === "-";
        const loopColor = negative ? "#d44b4b" : "#7c3aed";
        const hierColor = LEVEL_META[built.nodeMap.get(e.source)!.level].color;
        const isLoop = e.kind === "loop";
        // 有选中回路时：非选中回路的边略微弱化，让选中回路更突出；无选中则全部同等展示
        const dimOthers = hasSelectedLoop && !e.emphasized;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          type: "smoothstep",
          animated: isLoop && (!hasSelectedLoop || !!e.emphasized),
          labelShowBg: true,
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 6,
          labelBgStyle: { fill: "#ffffff", fillOpacity: 0.94 },
          labelStyle: {
            fill: isLoop ? loopColor : hierColor,
            fontSize: 11,
            fontWeight: isLoop ? 600 : 500,
            opacity: isLoop ? (dimOthers ? 0.5 : 1) : 0.72,
          },
          style: isLoop
            ? { stroke: loopColor, strokeWidth: e.emphasized ? 3.2 : 2.2, strokeDasharray: "7 5", strokeOpacity: dimOthers ? 0.42 : 1 }
            : { stroke: hierColor, strokeWidth: 1.6, strokeOpacity: 0.42 },
          markerEnd: { type: "arrowclosed", color: isLoop ? loopColor : hierColor, width: 15, height: 15 } as unknown as Edge["markerEnd"],
        } satisfies Edge;
      })
  ), [built, visibleLevels, hasSelectedLoop]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);
  useEffect(() => {
    const t = window.setTimeout(() => fitView({ padding: 0.18, duration: 500 }), 80);
    return () => window.clearTimeout(t);
  }, [visibleLevels, selectedLoop, fitView]);

  const toggleLevel = useCallback((lv: Level) => {
    setVisibleLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) {
        if (next.size > 1) next.delete(lv);
      } else next.add(lv);
      return next;
    });
  }, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onSelectNode(built.nodeMap.get(node.id) || null)}
      onPaneClick={() => onSelectNode(null)}
      fitView
      fitViewOptions={{ padding: 0.18 }}
      minZoom={0.25}
      maxZoom={2.2}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable
      defaultEdgeOptions={{ type: "smoothstep" }}
    >
      <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="#e2e7ee" />
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={2}
        nodeColor={(n) => LEVEL_META[(n.data as unknown as CardData).level].color}
        maskColor="rgba(244,246,249,0.72)"
        className="cflow-minimap"
      />
      <Controls showInteractive className="cflow-controls" />
      <Panel position="top-left" className="cflow-legend-panel">
        <div className="cflow-legend-title">经营层级</div>
        <div className="cflow-legend-list">
          {LEVELS.map((lv) => {
            const meta = LEVEL_META[lv];
            const on = visibleLevels.has(lv);
            return (
              <button
                key={lv}
                type="button"
                className={`cflow-legend-item${on ? " is-on" : ""}`}
                onClick={() => toggleLevel(lv)}
                aria-pressed={on}
              >
                <span className="cflow-legend-check" style={{ borderColor: meta.color, background: on ? meta.color : "transparent" }} />
                <span className="cflow-legend-icon" style={{ color: meta.color, background: meta.soft }}>{meta.icon}</span>
                <span className="cflow-legend-label">{meta.label}</span>
              </button>
            );
          })}
          <div className="cflow-legend-divider" />
          <div className="cflow-legend-hint">
            <i className="cflow-legend-loop" /> 回路因果（默认叠加全部）
          </div>
        </div>
      </Panel>
    </ReactFlow>
  );
}

export default function CommerceFlowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <FlowInner {...props} />
    </ReactFlowProvider>
  );
}
