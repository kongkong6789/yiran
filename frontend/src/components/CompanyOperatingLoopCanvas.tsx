import { useEffect, useMemo } from "react";
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, Panel, Position, ReactFlow,
  ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ApartmentOutlined, BankOutlined, DatabaseOutlined, DollarOutlined,
  InboxOutlined, ShopOutlined, ShoppingCartOutlined, TagsOutlined, TeamOutlined,
} from "@ant-design/icons";

import type { FeedbackLoop, OntGraph, OntObject } from "../api/client";
import { semanticSoftColor, useVisualizationTheme } from "../theme/visualization";

export type CompanyDomainKey =
  | "company"
  | "market"
  | "product"
  | "supply"
  | "sales"
  | "customer"
  | "finance"
  | "organization";

export type CompanyDataStatus = "ready" | "partial" | "pending";

export type CompanyNodeDatum = {
  key: CompanyDomainKey;
  name: string;
  sub: string;
  status: CompanyDataStatus;
  objectIds: number[];
  sources: string[];
  missing: string[];
};

type CompanyCardData = CompanyNodeDatum & {
  selected: boolean;
  loopActive: boolean;
  loopMuted: boolean;
};

export const COMPANY_DOMAIN_META: Record<CompanyDomainKey, {
  label: string;
  color: string;
  soft: string;
  icon: React.ReactNode;
}> = {
  company: { label: "公司经营目标", color: "#1f3d6b", soft: "#eaf1fb", icon: <BankOutlined /> },
  market: { label: "市场与渠道", color: "#7c53c4", soft: "#f2ecfd", icon: <ShopOutlined /> },
  product: { label: "商品与品牌", color: "#b07d2b", soft: "#fbf1de", icon: <TagsOutlined /> },
  supply: { label: "供应链与库存", color: "#16806f", soft: "#e4f6f2", icon: <InboxOutlined /> },
  sales: { label: "销售与履约", color: "#3d6fa8", soft: "#e8f1fc", icon: <ShoppingCartOutlined /> },
  customer: { label: "客户经营", color: "#b75b72", soft: "#fbeaf0", icon: <TeamOutlined /> },
  finance: { label: "资金与利润", color: "#a76821", soft: "#fff3e2", icon: <DollarOutlined /> },
  organization: { label: "组织与数据能力", color: "#5a6b82", soft: "#eef1f6", icon: <ApartmentOutlined /> },
};

export const COMPANY_STATUS_META: Record<CompanyDataStatus, { label: string; className: string }> = {
  ready: { label: "已识别", className: "is-ready" },
  partial: { label: "部分接入", className: "is-partial" },
  pending: { label: "待接入", className: "is-pending" },
};

const POSITION: Record<CompanyDomainKey, { x: number; y: number }> = {
  company: { x: 555, y: 20 },
  product: { x: 300, y: 175 },
  supply: { x: 680, y: 175 },
  market: { x: 30, y: 340 },
  sales: { x: 950, y: 340 },
  organization: { x: 170, y: 555 },
  finance: { x: 555, y: 555 },
  customer: { x: 940, y: 555 },
};

const DOMAIN_KEYS: Exclude<CompanyDomainKey, "company">[] = [
  "market", "product", "supply", "sales", "customer", "finance", "organization",
];

function text(value: unknown) {
  return value == null ? "" : String(value).trim();
}

function tableOf(object: OntObject) {
  return text(object.attributes?._table).toLowerCase();
}

function matchesAny(object: OntObject, words: string[]) {
  const haystack = `${object.otype} ${object.name} ${tableOf(object)}`.toLowerCase();
  return words.some((word) => haystack.includes(word.toLowerCase()));
}

function uniqueSources(objects: OntObject[]) {
  const labels = objects.map((object) => tableOf(object) || object.otype).filter(Boolean);
  return [...new Set(labels)].slice(0, 5);
}

function domainNode(
  graph: OntGraph,
  key: Exclude<CompanyDomainKey, "company">,
  words: string[],
  status: (objects: OntObject[]) => CompanyDataStatus,
  missing: string[],
): CompanyNodeDatum {
  const objects = graph.objects.filter((object) => matchesAny(object, words));
  const state = status(objects);
  const sources = uniqueSources(objects);
  return {
    key,
    name: COMPANY_DOMAIN_META[key].label,
    sub: state === "pending"
      ? "尚无可映射数据"
      : `${objects.length} 个对象 · ${sources.length} 类来源`,
    status: state,
    objectIds: objects.map((object) => object.id),
    sources,
    missing,
  };
}

export function buildCompanyOperatingModel(graph: OntGraph): CompanyNodeDatum[] {
  const market = domainNode(
    graph,
    "market",
    ["店铺", "平台", "dim_shop", "广告", "投放", "流量", "曝光", "点击"],
    (objects) => objects.some((object) => matchesAny(object, ["广告", "投放", "流量", "曝光", "点击"]))
      ? "ready" : objects.length ? "partial" : "pending",
    ["广告消耗", "曝光/点击", "渠道活动"],
  );
  const product = domainNode(
    graph,
    "product",
    ["商品", "sku", "spu", "品牌", "dim_product"],
    (objects) => objects.length ? "partial" : "pending",
    ["价格变更", "产品质量", "商品生命周期"],
  );
  const supply = domainNode(
    graph,
    "supply",
    ["库存", "采购", "供应", "inventory", "purchase", "procurement"],
    (objects) => objects.some((object) => matchesAny(object, ["库存日", "stock_daily", "采购单", "purchase_order"]))
      ? "ready" : objects.length ? "partial" : "pending",
    ["每日可用库存", "采购/生产", "缺货与周转"],
  );
  const sales = domainNode(
    graph,
    "sales",
    ["销售明细", "店铺日汇总", "商品日汇总", "指标快照", "异常预警", "dwd_sales", "dws_sales", "ads_metric", "ads_anomaly"],
    (objects) => objects.length ? "ready" : "pending",
    ["真实连续历史", "履约时效", "订单级状态"],
  );
  const customer = domainNode(
    graph,
    "customer",
    ["客户", "会员", "复购", "售后", "customer", "member", "crm", "repurchase"],
    (objects) => objects.length > 1 ? "partial" : "pending",
    ["客户ID", "复购/留存", "评价与服务体验"],
  );
  const finance = domainNode(
    graph,
    "finance",
    ["利润", "现金", "成本", "费用", "预算", "毛利", "gmv", "客单价", "退款率", "finance", "cash", "profit", "cost", "budget", "ads_metric_def"],
    (objects) => objects.some((object) => matchesAny(object, ["现金", "cash", "利润表", "profit_statement"]))
      ? "ready" : objects.length ? "partial" : "pending",
    ["毛利与费用", "现金流水", "预算分配"],
  );
  const organization = domainNode(
    graph,
    "organization",
    ["组织", "岗位", "员工", "任务", "流程", "动作留痕", "organization", "employee", "workflow"],
    (objects) => objects.some((object) => matchesAny(object, ["执行效率", "绩效", "performance"]))
      ? "ready" : objects.length ? "partial" : "pending",
    ["部门与岗位", "任务周期", "决策与执行效率"],
  );
  const domains = [market, product, supply, sales, customer, finance, organization];
  const mappedIds = [...new Set(domains.flatMap((domain) => domain.objectIds))];
  const readyCount = domains.filter((domain) => domain.status === "ready").length;
  const partialCount = domains.filter((domain) => domain.status === "partial").length;
  const company: CompanyNodeDatum = {
    key: "company",
    name: "公司经营目标",
    sub: `${readyCount} 已识别 · ${partialCount} 部分接入`,
    status: readyCount === domains.length ? "ready" : mappedIds.length ? "partial" : "pending",
    objectIds: mappedIds,
    sources: [...new Set(domains.flatMap((domain) => domain.sources))],
    missing: domains.filter((domain) => domain.status !== "ready").map((domain) => domain.name),
  };
  return [company, ...domains];
}

export function summarizeCompanyOperatingGraph(graph: OntGraph | null) {
  if (!graph) return { ready: 0, partial: 0, pending: 7, total: 7, mappedObjects: 0, sources: 0 };
  const domains = buildCompanyOperatingModel(graph).filter((node) => node.key !== "company");
  return {
    ready: domains.filter((node) => node.status === "ready").length,
    partial: domains.filter((node) => node.status === "partial").length,
    pending: domains.filter((node) => node.status === "pending").length,
    total: domains.length,
    mappedObjects: new Set(domains.flatMap((node) => node.objectIds)).size,
    sources: new Set(domains.flatMap((node) => node.sources)).size,
  };
}

function CompanyNode({ data, selected }: NodeProps) {
  const node = data as unknown as CompanyCardData;
  const meta = COMPANY_DOMAIN_META[node.key];
  const status = COMPANY_STATUS_META[node.status];
  const visualTheme = useVisualizationTheme();
  return (
    <div
      className={`company-operating-node ${status.className}${selected ? " is-selected" : ""}${node.loopActive ? " is-loop-active" : ""}${node.loopMuted ? " is-loop-muted" : ""}`}
      style={{
        ["--company-node-accent" as string]: meta.color,
        ["--company-node-soft" as string]: semanticSoftColor(meta.color, visualTheme.mode, meta.soft),
      }}
    >
      <Handle id="target-top" type="target" position={Position.Top} className="company-operating-handle" />
      <Handle id="target-right" type="target" position={Position.Right} className="company-operating-handle" />
      <Handle id="target-bottom" type="target" position={Position.Bottom} className="company-operating-handle" />
      <Handle id="target-left" type="target" position={Position.Left} className="company-operating-handle" />
      <span className="company-operating-node-icon">{meta.icon}</span>
      <span className="company-operating-node-copy">
        <b>{node.name}</b>
        <small>{node.sub}</small>
      </span>
      <em className={status.className}>{status.label}</em>
      <Handle id="source-top" type="source" position={Position.Top} className="company-operating-handle" />
      <Handle id="source-right" type="source" position={Position.Right} className="company-operating-handle" />
      <Handle id="source-bottom" type="source" position={Position.Bottom} className="company-operating-handle" />
      <Handle id="source-left" type="source" position={Position.Left} className="company-operating-handle" />
      {node.key === "company" && DOMAIN_KEYS.map((key, index) => (
        <Handle
          key={key}
          id={`structure-${key}`}
          type="source"
          position={Position.Bottom}
          className="company-operating-handle company-operating-structure-handle"
          style={{ left: `${12.5 + index * 12.5}%` }}
        />
      ))}
    </div>
  );
}

const NODE_TYPES = { companyOperating: CompanyNode };

type ModelEdge = {
  id: string;
  source: CompanyDomainKey;
  target: CompanyDomainKey;
  label: string;
  polarity?: "+" | "-";
  kind: "structure";
};

const MODEL_EDGES: ModelEdge[] = [
  ...DOMAIN_KEYS.map((target) => ({
    id: `structure:${target}`,
    source: "company" as const,
    target,
    label: "经营协同",
    kind: "structure" as const,
  })),
];

const MASTER_LOOP_EDGES: Array<{
  id: string;
  source: Exclude<CompanyDomainKey, "company">;
  target: Exclude<CompanyDomainKey, "company">;
  label: string;
  sourceHandle: string;
  targetHandle: string;
}> = [
  { id: "master:market-product", source: "market", target: "product", label: "需求洞察", sourceHandle: "source-top", targetHandle: "target-top" },
  { id: "master:product-supply", source: "product", target: "supply", label: "商品计划", sourceHandle: "source-top", targetHandle: "target-top" },
  { id: "master:supply-sales", source: "supply", target: "sales", label: "供需协同", sourceHandle: "source-top", targetHandle: "target-top" },
  { id: "master:sales-customer", source: "sales", target: "customer", label: "履约反馈", sourceHandle: "source-right", targetHandle: "target-right" },
  { id: "master:customer-finance", source: "customer", target: "finance", label: "价值沉淀", sourceHandle: "source-bottom", targetHandle: "target-bottom" },
  { id: "master:finance-organization", source: "finance", target: "organization", label: "利润回流", sourceHandle: "source-bottom", targetHandle: "target-bottom" },
  { id: "master:organization-market", source: "organization", target: "market", label: "组织迭代", sourceHandle: "source-left", targetHandle: "target-left" },
];

export type CompanyLoopSegment = {
  id: string;
  source: Exclude<CompanyDomainKey, "company">;
  target: Exclude<CompanyDomainKey, "company">;
  label: string;
  polarity: string;
  sequence: number;
};

export function projectLoopToCompanyDomains(
  loop: FeedbackLoop | null,
  graph: OntGraph,
  model = buildCompanyOperatingModel(graph),
): CompanyLoopSegment[] {
  if (!loop?.members?.length) return [];
  const domainByObject = new Map<number, Exclude<CompanyDomainKey, "company">>();
  DOMAIN_KEYS.forEach((key) => {
    model.find((node) => node.key === key)?.objectIds.forEach((id) => {
      if (!domainByObject.has(id)) domainByObject.set(id, key);
    });
  });
  return [...loop.members]
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((member) => {
      const source = domainByObject.get(member.relation.source);
      const target = domainByObject.get(member.relation.target);
      if (!source || !target || source === target) return [];
      return [{
        id: `loop:${loop.id}:${member.id}`,
        source,
        target,
        label: member.relation.label || "影响",
        polarity: member.relation.polarity || "+",
        sequence: member.sequence,
      }];
    });
}

function edgeHandles(source: CompanyDomainKey, target: CompanyDomainKey) {
  const from = POSITION[source];
  const to = POSITION[target];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) < 90) {
    return dx >= 0
      ? { sourceHandle: "source-bottom", targetHandle: "target-bottom" }
      : { sourceHandle: "source-top", targetHandle: "target-top" };
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "source-right", targetHandle: "target-left" }
      : { sourceHandle: "source-left", targetHandle: "target-right" };
  }
  return dy >= 0
    ? { sourceHandle: "source-bottom", targetHandle: "target-top" }
    : { sourceHandle: "source-top", targetHandle: "target-bottom" };
}

type Props = {
  graph: OntGraph;
  loops: FeedbackLoop[];
  showAllConnections: boolean;
  selectedLoop: FeedbackLoop | null;
  selectedNodeKey: CompanyDomainKey | null;
  onSelectNode: (node: CompanyNodeDatum | null) => void;
};

function Canvas({ graph, loops, showAllConnections, selectedLoop, selectedNodeKey, onSelectNode }: Props) {
  const visualTheme = useVisualizationTheme();
  const model = useMemo(() => buildCompanyOperatingModel(graph), [graph]);
  const nodeMap = useMemo(() => new Map(model.map((node) => [node.key, node])), [model]);
  const loopSegments = useMemo(
    () => projectLoopToCompanyDomains(selectedLoop, graph, model),
    [graph, model, selectedLoop],
  );
  const activeDomains = useMemo(
    () => new Set(loopSegments.flatMap((edge) => [edge.source, edge.target])),
    [loopSegments],
  );
  const aggregateSegments = useMemo(() => {
    const aggregate = new Map<string, CompanyLoopSegment & { loopIds: Set<number> }>();
    loops.forEach((loop) => {
      projectLoopToCompanyDomains(loop, graph, model).forEach((segment) => {
        const key = `${segment.source}>${segment.target}`;
        const existing = aggregate.get(key);
        if (existing) {
          existing.loopIds.add(loop.id);
          return;
        }
        aggregate.set(key, { ...segment, id: `aggregate:${key}`, loopIds: new Set([loop.id]) });
      });
    });
    return [...aggregate.values()];
  }, [graph, loops, model]);
  const rfNodes = useMemo<Node[]>(() => model.map((node) => ({
    id: node.key,
    type: "companyOperating",
    position: POSITION[node.key],
    data: {
      ...node,
      selected: node.key === selectedNodeKey,
      loopActive: node.key !== "company" && activeDomains.has(node.key),
      loopMuted: node.key !== "company" && loopSegments.length > 0 && !activeDomains.has(node.key),
    } as unknown as Record<string, unknown>,
    selected: node.key === selectedNodeKey,
  })), [activeDomains, loopSegments.length, model, selectedNodeKey]);
  const rfEdges = useMemo<Edge[]>(() => {
    const structureEdges = MODEL_EDGES.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: `structure-${edge.target}`,
      targetHandle: "target-top",
      type: "smoothstep",
      animated: false,
      style: { stroke: "#aab3c0", strokeWidth: 1.1, strokeOpacity: loopSegments.length ? 0.18 : 0.34 },
      markerEnd: { type: "arrowclosed", color: "#aab3c0", width: 12, height: 12 } as unknown as Edge["markerEnd"],
    } satisfies Edge));
    const masterLoopEdges = MASTER_LOOP_EDGES.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      type: "smoothstep",
      animated: false,
      labelShowBg: true,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 7,
      labelBgStyle: { fill: visualTheme.labelBg, fillOpacity: 0.94 },
      labelStyle: { fill: "#8b68d4", fontSize: 9.5, fontWeight: 550 },
      style: { stroke: "#9b79e5", strokeWidth: 1.8, strokeDasharray: "7 6", strokeOpacity: 0.62 },
      markerEnd: { type: "arrowclosed", color: "#9b79e5", width: 13, height: 13 } as unknown as Edge["markerEnd"],
      zIndex: 2,
    } satisfies Edge));
    const aggregateEdges = showAllConnections ? aggregateSegments.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...edgeHandles(edge.source, edge.target),
      label: edge.loopIds.size > 1 ? `${edge.loopIds.size} 条回路` : undefined,
      type: "smoothstep",
      animated: false,
      labelShowBg: true,
      labelBgPadding: [5, 3] as [number, number],
      labelBgBorderRadius: 6,
      labelBgStyle: { fill: visualTheme.labelBg, fillOpacity: 0.92 },
      labelStyle: { fill: "#71809d", fontSize: 9.5, fontWeight: 550 },
      style: { stroke: "#7f8da8", strokeWidth: 1.45, strokeOpacity: 0.38 },
      markerEnd: { type: "arrowclosed", color: "#7f8da8", width: 12, height: 12 } as unknown as Edge["markerEnd"],
      zIndex: 3,
    } satisfies Edge)) : [];
    const loopColor = selectedLoop?.loop_type === "B" ? "#2563eb" : selectedLoop?.loop_type === "comp" ? "#b76b12" : "#7c3aed";
    const selectedEdges = loopSegments.map((edge, index) => {
      const negative = edge.polarity === "-";
      const color = negative ? "#d34d55" : loopColor;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...edgeHandles(edge.source, edge.target),
        label: `${index + 1} · ${edge.label}`,
        type: "smoothstep",
        animated: false,
        labelShowBg: true,
        labelBgPadding: [7, 4] as [number, number],
        labelBgBorderRadius: 7,
        labelBgStyle: { fill: visualTheme.labelBg, fillOpacity: 0.98 },
        labelStyle: { fill: color, fontSize: 11, fontWeight: 650 },
        style: { stroke: color, strokeWidth: 2.8, strokeOpacity: 0.92 },
        markerEnd: { type: "arrowclosed", color, width: 16, height: 16 } as unknown as Edge["markerEnd"],
        zIndex: 5,
      } satisfies Edge;
    });
    return [...structureEdges, ...masterLoopEdges, ...aggregateEdges, ...selectedEdges];
  }, [aggregateSegments, loopSegments, selectedLoop, showAllConnections, visualTheme]);
  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);
  const { fitView } = useReactFlow();

  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);
  useEffect(() => {
    const timer = window.setTimeout(() => fitView({ padding: 0.14, duration: 450 }), 80);
    return () => window.clearTimeout(timer);
  }, [fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onSelectNode(nodeMap.get(node.id as CompanyDomainKey) || null)}
      onPaneClick={() => onSelectNode(null)}
      fitView
      fitViewOptions={{ padding: 0.14 }}
      minZoom={0.42}
      maxZoom={1.7}
      nodesConnectable={false}
      nodesDraggable
      elementsSelectable
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={28} size={1} color={visualTheme.grid} />
      <Controls showInteractive className="cflow-controls" />
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={2}
        nodeColor={(node) => COMPANY_DOMAIN_META[(node.data as unknown as CompanyCardData).key].color}
        maskColor={visualTheme.loadingMask}
        className="cflow-minimap"
      />
      <Panel position="top-left" className="company-operating-legend">
        <strong>数据接入状态</strong>
        <span><i className="is-ready" /> 已识别数据表</span>
        <span><i className="is-partial" /> 部分数据可映射</span>
        <span><i className="is-pending" /> 待补充数据</span>
        <span><b className="is-master-loop" /> 紫色虚线为公司总循环</span>
        <span><b className="is-all-loops" /> 浅色实线为全部回路聚合</span>
        <span><b className="is-selected-loop" /> 彩色实线为当前单条回路</span>
      </Panel>
      <Panel position="top-right" className="company-operating-model-note">
        <DatabaseOutlined /> {selectedLoop
          ? `${selectedLoop.name} · ${loopSegments.length} 条跨系统关系`
          : "请选择右侧回路查看系统投影"}
      </Panel>
    </ReactFlow>
  );
}

export default function CompanyOperatingLoopCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
