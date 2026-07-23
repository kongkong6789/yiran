import {
  ArrowLeftOutlined,
  BarChartOutlined,
  BranchesOutlined,
  CheckCircleFilled,
  CheckSquareOutlined,
  CloseCircleFilled,
  CodeOutlined,
  CommentOutlined,
  CopyOutlined,
  CustomerServiceOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HistoryOutlined,
  LoadingOutlined,
  MoreOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  SendOutlined,
  ShoppingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { App, Avatar, Button, Dropdown, Empty, Input, Modal, Select, Space, Spin, Table, Tag, Tooltip } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import {
  createSop,
  createSopVersion,
  duplicateSop,
  getCatalog,
  getMe,
  getMetricContracts,
  getSop,
  getSopVersion,
  getSourceSnapshots,
  listKnowledgeBases,
  listSops,
  listSopVersions,
  publishSopVersion,
  rewriteSopWithAi,
  updateSop,
  updateSopVersion,
  type ActionContract,
  type AuthUser,
  type KnowledgeBaseItem,
  type SopDefinitionItem,
  type SopDraftPayload,
  type SopGraphNode,
  type SopVersionItem,
} from "../api/client";
import { authenticatedAvatarUrl } from "../utils/avatar";
import SopBusinessNodePanel, { buildDataAssetOptions, fieldLabel, normalizeFieldKeys, type DataAssetOption } from "./sopBusinessPanel";

const SOP_AI_AVATAR_URL =
  "https://yiran-1301008423.cos.ap-guangzhou.myqcloud.com/media/branding/sop-ai-avatar.png";
const SOP_AI_AVATAR_FALLBACK = "/sop-ai-avatar.png";

const EMPTY_BINDINGS = {
  snapshot_ids: [] as number[],
  metric_ids: [] as string[],
  asset_keys: [] as string[],
  scope: "",
  brand_ids: [] as string[],
};

const EMPTY_KNOWLEDGE = {
  knowledge_base_ids: [] as number[],
  retrieval_hint: "",
};

const EMPTY_NODE_CONFIG = (actionName = "report.generate") => ({
  instruction: "",
  expected_user_info: [] as string[],
  required_fields: [] as string[],
  allowed_actions: ["ask_user", "continue_flow"] as string[],
  knowledge_scope: { ...EMPTY_KNOWLEDGE },
  data_bindings: { ...EMPTY_BINDINGS },
  action_name: actionName,
  detail: "",
  message: "",
});

const EMPTY_GRAPH: SopDraftPayload["graph"] = {
  start: "collect.scope",
  terminals: ["finish"],
  nodes: [
    {
      key: "collect.scope",
      type: "collect_info",
      title: "确认任务所需信息",
      config: {
        ...EMPTY_NODE_CONFIG(),
        instruction: "确认任务日期、品牌和数据范围等必要信息",
        allowed_actions: ["ask_user", "continue_flow"],
      },
    },
    {
      key: "data.bind",
      type: "data_bind",
      title: "选用企业数据",
      config: {
        ...EMPTY_NODE_CONFIG(),
        instruction: "选择本流程要用的销售、库存等可信业务数据",
        allowed_actions: ["continue_flow"],
        action_name: "",
      },
    },
    {
      key: "execute",
      type: "execute_action",
      title: "生成业务结果",
      config: {
        ...EMPTY_NODE_CONFIG("report.generate"),
        instruction: "基于已选企业数据完成分析并产出结果",
        allowed_actions: ["continue_flow", "call_action:report.generate"],
        action_name: "report.generate",
      },
    },
    {
      key: "finish",
      type: "end",
      title: "完成并留存",
      config: {
        ...EMPTY_NODE_CONFIG(""),
        instruction: "把结果写回任务，并留存证据",
        allowed_actions: ["continue_flow"],
        action_name: "",
      },
    },
  ],
  edges: [
    { source: "collect.scope", target: "data.bind", condition: "always", priority: 1 },
    { source: "data.bind", target: "execute", condition: "always", priority: 1 },
    { source: "execute", target: "finish", condition: "decision:allow", priority: 1 },
    { source: "execute", target: "finish", condition: "decision:block", priority: 2 },
  ],
};

const EMPTY_DRAFT: SopDraftPayload = {
  key: "",
  name: "新建 SOP",
  businessDomain: "",
  description: "",
  actionName: "report.generate",
  version: "1.0.0",
  triggerIntents: [],
  utteranceExamples: [],
  graph: EMPTY_GRAPH,
};

type SopToolStep = { name: string; summary: string; status: "ok" | "failed" | "running" };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  images?: string[];
  tools?: SopToolStep[];
  toolsLive?: boolean;
};
type FlowNodeData = {
  kind: "meta" | "step";
  draft: SopDraftPayload;
  step?: SopGraphNode;
  index?: number;
  selected?: boolean;
  connectable?: boolean;
  actionTitles?: Record<string, string>;
  onSelect?: (key: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
};

function mapToolStatus(status?: string): SopToolStep["status"] {
  if (status === "failed" || status === "running") return status;
  return "ok";
}

function SopAiAvatar() {
  const [src, setSrc] = useState(SOP_AI_AVATAR_URL);
  return (
    <Avatar
      size={28}
      className="sop-chat-avatar"
      src={src}
      onError={() => {
        setSrc(SOP_AI_AVATAR_FALLBACK);
        return true;
      }}
    />
  );
}

function SopToolProcess({ tools }: { tools: SopToolStep[] }) {
  if (!tools.length) return null;
  return (
    <ul className="sop-tool-process">
      {tools.map((tool, index) => {
        const label = tool.summary
          ? `调用工具 ${tool.name} · ${tool.summary}`
          : `调用工具 ${tool.name}`;
        return (
          <li key={`${tool.name}-${index}`} className={`is-${tool.status}`}>
            {tool.status === "running" && <LoadingOutlined spin />}
            {tool.status === "ok" && <CheckCircleFilled />}
            {tool.status === "failed" && <CloseCircleFilled />}
            <span>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

const NODE_LABELS: Record<string, string> = {
  collect_info: "收集信息",
  data_bind: "企业数据",
  knowledge_query: "知识检索",
  checkpoint: "人工确认",
  execute_action: "执行动作",
  gate: "安全闸机",
  handoff: "转人工",
  end: "完成",
};

const BASE_ACTION_OPTIONS = [
  { value: "ask_user", label: "询问用户" },
  { value: "continue_flow", label: "继续流转" },
  { value: "query_knowledge", label: "检索知识" },
  { value: "confirm", label: "人工确认" },
  { value: "handoff_human", label: "转人工" },
];

function readExpectedFields(config: Record<string, unknown> | undefined): string[] {
  const expected = config?.expected_user_info;
  if (Array.isArray(expected)) return normalizeFieldKeys(expected.map(String));
  const legacy = config?.required_fields;
  if (Array.isArray(legacy)) return normalizeFieldKeys(legacy.map(String));
  return [];
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function readNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((item) => Number.isFinite(item));
}

function bindingSummary(config: Record<string, unknown> | undefined) {
  const data = (config?.data_bindings || {}) as Record<string, unknown>;
  const knowledge = (config?.knowledge_scope || {}) as Record<string, unknown>;
  const snapshots = readNumberList(data.snapshot_ids).length;
  const metrics = readStringList(data.metric_ids).length;
  const assets = readStringList(data.asset_keys).length;
  const kbs = readNumberList(knowledge.knowledge_base_ids).length;
  const actions = readStringList(config?.allowed_actions).length;
  return { snapshots, metrics, assets, kbs, actions };
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "published", label: "已发布" },
  { value: "draft", label: "草稿" },
];

const DOMAIN_META: Record<string, { label: string; icon: ReactNode; tone: string; tags: string[] }> = {
  "任务处理": { label: "任务处理", icon: <BarChartOutlined />, tone: "purple", tags: ["数据分析", "电商"] },
  "库存管理": { label: "库存管理", icon: <FileTextOutlined />, tone: "green", tags: ["库存", "风险控制"] },
  "采购管理": { label: "采购管理", icon: <CommentOutlined />, tone: "blue", tags: ["采购", "供应商"] },
  "客户服务": { label: "客户服务", icon: <CustomerServiceOutlined />, tone: "orange", tags: ["客服", "工单"] },
  "经营分析": { label: "经营分析", icon: <BarChartOutlined />, tone: "purple", tags: ["数据分析", "经营"] },
};

function sopMeta(row: SopDefinitionItem) {
  const domain = row.businessDomain?.trim();
  if (domain && DOMAIN_META[domain]) return DOMAIN_META[domain];
  if (row.actionName.includes("inventory")) {
    return { label: "库存管理", icon: <FileTextOutlined />, tone: "green", tags: ["库存", "补货"] };
  }
  if (row.actionName.includes("report")) {
    return { label: "任务处理", icon: <BarChartOutlined />, tone: "purple", tags: ["数据分析", "报告"] };
  }
  return { label: domain || "通用流程", icon: <ShoppingOutlined />, tone: "blue", tags: ["流程编排"] };
}

function sopStatusLabel(row: SopDefinitionItem) {
  if (row.hasDraft || row.status === "draft") return "draft";
  return "published";
}

function errorText(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}

function MetaNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const draft = data.draft;
  const fields = draft.graph.nodes
    .flatMap((node) => readExpectedFields(node.config))
    .filter((value, index, list) => list.indexOf(value) === index);
  return <article className="sop-canvas-node sop-canvas-meta-node">
    <div className="sop-canvas-eyebrow">基础信息</div>
    <strong>{draft.name || "未命名流程"}</strong>
    <p>{draft.description || "左边说目标，右边点步骤微调。"}</p>
    <small>业务域</small><span className="sop-node-field">{draft.businessDomain || "未分类"}</span>
    {fields.length > 0 && <><small>需要用户补充</small><div className="sop-node-tags">{fields.map((field) => <em key={field}>{fieldLabel(field)}</em>)}</div></>}
    <Handle type="source" position={Position.Bottom} isConnectable={Boolean(data.connectable)} />
  </article>;
}

function StepNode({ data }: NodeProps<Node<FlowNodeData>>) {
  const step = data.step!;
  const config = step.config || {};
  const fields = readExpectedFields(config);
  const action = String(config.action_name || "");
  const actionTitle = (data.actionTitles && action && data.actionTitles[action]) || "";
  const summary = bindingSummary(config);
  const instruction = String(config.instruction || config.detail || config.message || "按流程配置执行并记录结果。");
  const connectable = Boolean(data.connectable);
  return (
    <article className={`sop-canvas-node sop-canvas-step-node is-${step.type}${data.selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Top} isConnectable={connectable} />
      <div className="sop-canvas-node-head">
        <span className={`sop-node-check${data.selected ? " is-on" : ""}`} aria-hidden>
          {data.selected ? <CheckSquareOutlined /> : <span className="sop-node-check-box" />}
        </span>
        <span>步骤 {(data.index || 0) + 1}</span>
        <Tag>{NODE_LABELS[step.type] || step.type}</Tag>
      </div>
      <strong>{step.title}</strong>
      <p>{instruction}</p>
      {fields.length > 0 && <div className="sop-node-tags">{fields.map((field) => <em key={field}>{fieldLabel(field)}</em>)}</div>}
      {action && <div className="sop-node-action">能力：{actionTitle || "未命名业务能力"}</div>}
      <div className="sop-node-tags">
        {summary.snapshots > 0 && <em>数据 {summary.snapshots}</em>}
        {summary.metrics > 0 && <em>指标 {summary.metrics}</em>}
        {summary.kbs > 0 && <em>知识 {summary.kbs}</em>}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={connectable} />
    </article>
  );
}

const NODE_TYPES = { meta: MetaNode, step: StepNode };

function readLayout(draft: SopDraftPayload): Record<string, { x: number; y: number }> {
  const layout = (draft.graph as { meta?: { layout?: Record<string, { x?: number; y?: number }> } }).meta?.layout;
  if (!layout || typeof layout !== "object") return {};
  const next: Record<string, { x: number; y: number }> = {};
  Object.entries(layout).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    const x = Number(value.x);
    const y = Number(value.y);
    if (Number.isFinite(x) && Number.isFinite(y)) next[key] = { x, y };
  });
  return next;
}

function layoutGraph(
  draft: SopDraftPayload,
  selectedKeys: string[] = [],
  onSelect?: (key: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void,
  connectable = false,
  draggable = false,
  actionTitles: Record<string, string> = {},
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const selected = new Set(selectedKeys);
  const graph = draft.graph;
  const saved = readLayout(draft);
  const depth = new Map<string, number>([[graph.start, 0]]);
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    graph.edges.forEach((edge) => {
      if (depth.has(edge.source)) depth.set(edge.target, Math.max(depth.get(edge.target) || 0, (depth.get(edge.source) || 0) + 1));
    });
  }
  const groups = new Map<number, SopGraphNode[]>();
  graph.nodes.forEach((node) => {
    const level = depth.get(node.key) || 0;
    groups.set(level, [...(groups.get(level) || []), node]);
  });
  const nodes: Node<FlowNodeData>[] = [{
    id: "__meta__", type: "meta", position: saved.__meta__ || { x: 360, y: 20 }, data: { kind: "meta", draft, connectable }, draggable: false, selectable: false,
  }];
  graph.nodes.forEach((step, index) => {
    const level = depth.get(step.key) || 0;
    const peers = groups.get(level) || [step];
    const peerIndex = peers.findIndex((item) => item.key === step.key);
    const totalWidth = (peers.length - 1) * 360;
    const autoPos = { x: 360 - totalWidth / 2 + peerIndex * 360, y: 300 + level * 300 };
    nodes.push({
      id: step.key,
      type: "step",
      position: saved[step.key] || autoPos,
      data: { kind: "step", draft, step, index, selected: selected.has(step.key), connectable, actionTitles, onSelect },
      draggable,
      selected: selected.has(step.key),
    });
  });
  const edges: Edge[] = [
    { id: "meta-start", source: "__meta__", target: graph.start, animated: false, label: "开始", className: "sop-flow-edge", selectable: false },
    ...graph.edges.map((edge, index) => ({
      id: `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.condition === "always" ? "" : edge.condition.replace("decision:", ""),
      className: "sop-flow-edge",
      selectable: true,
    })),
  ];
  return { nodes, edges };
}

function FlowToolbar() {
  const flow = useReactFlow();
  return <div className="sop-flow-quick-tools">
    <Button size="small" onClick={() => flow.zoomOut()}>−</Button>
    <Button size="small" onClick={() => flow.zoomIn()}>＋</Button>
    <Button size="small" onClick={() => flow.fitView({ padding: 0.16 })}>适配</Button>
    <Button size="small" onClick={() => flow.zoomTo(1)}>100%</Button>
  </div>;
}

function SopFlowCanvas({
  draft,
  selectedKeys,
  onSelect,
  onClear,
  readOnly = false,
  actionTitles = {},
  onConnectEdge,
  onDeleteEdge,
  onAddNode,
  onDeleteNodes,
  onMoveNodes,
  onResetLayout,
}: {
  draft: SopDraftPayload;
  selectedKeys: string[];
  onSelect: (key: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  onClear: () => void;
  readOnly?: boolean;
  actionTitles?: Record<string, string>;
  onConnectEdge?: (source: string, target: string) => void;
  onDeleteEdge?: (source: string, target: string) => void;
  onAddNode?: () => void;
  onDeleteNodes?: (keys: string[]) => void;
  onMoveNodes?: (positions: Record<string, { x: number; y: number }>) => void;
  onResetLayout?: () => void;
}) {
  const { message } = App.useApp();
  const connectable = !readOnly;
  const draggable = !readOnly;
  const model = useMemo(
    () => layoutGraph(draft, selectedKeys, onSelect, connectable, draggable, actionTitles),
    [actionTitles, connectable, draft, draggable, onSelect, selectedKeys],
  );
  const [nodes, setNodes] = useState(model.nodes);
  const [edges, setEdges] = useState(model.edges);
  const dragMoved = useRef(false);

  useEffect(() => {
    setNodes(model.nodes);
    setEdges(model.edges);
  }, [model]);

  const handleConnect = useCallback((connection: Connection) => {
    const source = connection.source;
    const target = connection.target;
    if (!source || !target || source === target) return;
    if (source === "__meta__" || target === "__meta__") return;
    onConnectEdge?.(source, target);
  }, [onConnectEdge]);

  const onNodesChange = useCallback((changes: NodeChange<Node<FlowNodeData>>[]) => {
    if (readOnly) return;
    const meaningful = changes.filter((change) => change.type === "position" || change.type === "dimensions");
    if (!meaningful.length) return;
    if (meaningful.some((change) => change.type === "position" && "dragging" in change && change.dragging)) {
      dragMoved.current = true;
    }
    setNodes((current) => applyNodeChanges(meaningful, current));
  }, [readOnly]);

  const persistPositions = useCallback((list: Node<FlowNodeData>[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    list.forEach((node) => {
      if (node.id === "__meta__") return;
      positions[node.id] = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
    });
    onMoveNodes?.(positions);
  }, [onMoveNodes]);

  const deleteSelected = useCallback(() => {
    if (readOnly || !selectedKeys.length) return;
    onDeleteNodes?.(selectedKeys);
  }, [onDeleteNodes, readOnly, selectedKeys]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (readOnly) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedKeys.length) return;
        event.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelected, readOnly, selectedKeys.length]);

  return <ReactFlowProvider><div className="sop-flow-canvas">
    <div className="sop-flow-edit-tools">
      <Button size="small" icon={<PlusOutlined />} disabled={readOnly} onClick={onAddNode}>添加步骤</Button>
      <Button size="small" danger icon={<DeleteOutlined />} disabled={readOnly || selectedKeys.length === 0} onClick={deleteSelected}>
        删除选中{selectedKeys.length > 1 ? `(${selectedKeys.length})` : ""}
      </Button>
      <Button size="small" disabled={readOnly} onClick={onResetLayout}>自动排布</Button>
      <span>拖动卡片移动 · 拖圆点连线 · Del 删除</span>
    </div>
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onInit={(flow) => { void flow.setCenter(555, 150, { zoom: 0.72 }); }}
      onNodesChange={onNodesChange}
      onNodeClick={(event, node) => {
        if (dragMoved.current) {
          dragMoved.current = false;
          return;
        }
        if (node.id === "__meta__") {
          onClear();
          return;
        }
        onSelect(node.id, {
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
        });
      }}
      onNodeDragStop={(_, _node, currentNodes) => {
        dragMoved.current = true;
        persistPositions(currentNodes as Node<FlowNodeData>[]);
      }}
      onPaneClick={() => onClear()}
      onConnect={handleConnect}
      onEdgeClick={(_, edge) => {
        if (readOnly || edge.source === "__meta__") return;
        onDeleteEdge?.(edge.source, edge.target);
        message.success("已删除连线");
      }}
      minZoom={0.28}
      maxZoom={1.45}
      nodesConnectable={connectable}
      elementsSelectable
      nodesDraggable={draggable}
      selectNodesOnDrag={false}
      multiSelectionKeyCode={["Meta", "Control"]}
      deleteKeyCode={null}
    >
      <Background gap={28} size={1} color="rgba(84, 92, 113, .12)" />
      <Controls showInteractive={false} className="sop-native-controls" />
      <MiniMap pannable zoomable nodeStrokeWidth={3} className="sop-flow-minimap" />
      <FlowToolbar />
    </ReactFlow>
  </div></ReactFlowProvider>;
}

const NODE_TYPE_OPTIONS = Object.entries(NODE_LABELS).map(([value, label]) => ({ value, label }));
const CONDITION_OPTIONS = [
  { value: "always", label: "始终流转" },
  { value: "decision:allow", label: "执行通过" },
  { value: "decision:block", label: "执行阻断" },
  { value: "result_ok", label: "结果成功" },
  { value: "result_failed", label: "结果失败" },
];

function SopStructuredSource({ draft, disabled, onChange }: {
  draft: SopDraftPayload;
  disabled: boolean;
  onChange: (next: SopDraftPayload) => void;
}) {
  const [actions, setActions] = useState<ActionContract[]>([]);
  const [snapshots, setSnapshots] = useState<Array<{ id: number; label: string }>>([]);
  const [metrics, setMetrics] = useState<Array<{ value: string; label: string }>>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);

  useEffect(() => {
    getCatalog().then((data) => setActions(data.actions || [])).catch(() => setActions([]));
    getSourceSnapshots().then((data) => {
      const rows = (data as { results?: Array<Record<string, unknown>> }).results || [];
      setSnapshots(rows.map((row) => {
        const scope = (row.scope || {}) as Record<string, unknown>;
        const asset = String(scope.asset_key || row.source_system || row.snapshot_key || row.id);
        return { id: Number(row.id), label: `#${row.id} ${asset}` };
      }).filter((row) => Number.isFinite(row.id)));
    }).catch(() => setSnapshots([]));
    getMetricContracts().then((data) => {
      const rows = (data as { results?: Array<Record<string, unknown>> }).results || [];
      setMetrics(rows.map((row) => ({
        value: String(row.metric_id || ""),
        label: `${row.metric_id} · ${row.name || ""}`,
      })).filter((row) => row.value));
    }).catch(() => setMetrics([]));
    listKnowledgeBases().then((data) => {
      const rows = Array.isArray(data) ? data : (data.results || []);
      setKnowledgeBases(rows);
    }).catch(() => setKnowledgeBases([]));
  }, []);

  const actionOptions = useMemo(
    () => actions.map((action) => ({ value: action.name, label: `${action.title} (${action.name})` })),
    [actions],
  );
  const allowedActionOptions = useMemo(() => [
    ...BASE_ACTION_OPTIONS,
    ...actions.map((action) => ({ value: `call_action:${action.name}`, label: `调用动作：${action.title}` })),
  ], [actions]);

  const updateBase = (patch: Partial<SopDraftPayload>) => onChange({ ...draft, ...patch });
  const updateNode = (index: number, patch: Partial<SopGraphNode>, configPatch?: Record<string, unknown>) => {
    const nodes = draft.graph.nodes.map((node, nodeIndex) => {
      if (nodeIndex !== index) return node;
      const nextConfig = { ...node.config, ...(configPatch || {}) };
      if (configPatch?.expected_user_info) {
        nextConfig.required_fields = configPatch.expected_user_info;
      }
      if (typeof configPatch?.instruction === "string") {
        nextConfig.detail = configPatch.instruction;
        nextConfig.message = configPatch.instruction;
      }
      if (typeof configPatch?.action_name === "string") {
        const token = `call_action:${configPatch.action_name}`;
        const allowed = readStringList(nextConfig.allowed_actions);
        if (configPatch.action_name && !allowed.includes(token)) {
          nextConfig.allowed_actions = [...allowed, token];
        }
      }
      return { ...node, ...patch, config: nextConfig };
    });
    onChange({ ...draft, graph: { ...draft.graph, nodes } });
  };
  const patchDataBindings = (index: number, patch: Record<string, unknown>) => {
    const current = (draft.graph.nodes[index]?.config?.data_bindings || {}) as Record<string, unknown>;
    updateNode(index, {}, { data_bindings: { ...EMPTY_BINDINGS, ...current, ...patch } });
  };
  const patchKnowledgeScope = (index: number, patch: Record<string, unknown>) => {
    const current = (draft.graph.nodes[index]?.config?.knowledge_scope || {}) as Record<string, unknown>;
    updateNode(index, {}, { knowledge_scope: { ...EMPTY_KNOWLEDGE, ...current, ...patch } });
  };
  const addNode = (beforeIndex?: number) => {
    const terminalKey = draft.graph.terminals[0] || "finish";
    const terminalIndex = draft.graph.nodes.findIndex((node) => node.key === terminalKey);
    const insertIndex = beforeIndex ?? (terminalIndex >= 0 ? terminalIndex : draft.graph.nodes.length);
    let suffix = draft.graph.nodes.length + 1;
    let key = `step.${suffix}`;
    while (draft.graph.nodes.some((node) => node.key === key)) { suffix += 1; key = `step.${suffix}`; }
    const node: SopGraphNode = {
      key,
      type: "checkpoint",
      title: "新流程节点",
      config: {
        ...EMPTY_NODE_CONFIG(""),
        instruction: "说明这个节点要完成的工作",
        allowed_actions: ["confirm", "ask_user", "continue_flow"],
        action_name: "",
      },
    };
    const nodes = [...draft.graph.nodes];
    nodes.splice(insertIndex, 0, node);
    const incoming = draft.graph.edges.filter((edge) => edge.target === terminalKey);
    const edges = draft.graph.edges.map((edge) => edge.target === terminalKey ? { ...edge, target: key } : edge);
    if (incoming.length === 0 && nodes.length > 1) {
      const previous = nodes[Math.max(0, insertIndex - 1)];
      if (previous && previous.key !== key) edges.push({ source: previous.key, target: key, condition: "always", priority: 1 });
    }
    edges.push({ source: key, target: terminalKey, condition: "always", priority: 1 });
    onChange({ ...draft, graph: { ...draft.graph, nodes, edges } });
  };
  const deleteNode = (index: number) => {
    const node = draft.graph.nodes[index];
    if (node.key === draft.graph.start || draft.graph.terminals.includes(node.key)) return;
    const incoming = draft.graph.edges.filter((edge) => edge.target === node.key);
    const outgoing = draft.graph.edges.filter((edge) => edge.source === node.key);
    const fallbackTarget = outgoing[0]?.target || draft.graph.terminals[0];
    const edges = draft.graph.edges.filter((edge) => edge.source !== node.key && edge.target !== node.key);
    if (fallbackTarget) incoming.forEach((edge) => edges.push({ ...edge, target: fallbackTarget }));
    onChange({ ...draft, graph: { ...draft.graph, nodes: draft.graph.nodes.filter((_, nodeIndex) => nodeIndex !== index), edges } });
  };
  const updateEdge = (edgeIndex: number, patch: Partial<SopDraftPayload["graph"]["edges"][number]>) => {
    const edges = draft.graph.edges.map((edge, index) => index === edgeIndex ? { ...edge, ...patch } : edge);
    onChange({ ...draft, graph: { ...draft.graph, edges } });
  };
  const addEdge = (source: string) => {
    const fallback = draft.graph.terminals[0] || draft.graph.nodes[0]?.key;
    if (!fallback || fallback === source) return;
    onChange({ ...draft, graph: { ...draft.graph, edges: [...draft.graph.edges, { source, target: fallback, condition: "always", priority: 1 }] } });
  };

  return <div className="sop-structured-source">
    <section className="sop-source-section">
      <h4>基础信息</h4>
      <div className="sop-source-base-card">
        <label><span>SOP 名称</span><Input value={draft.name} disabled={disabled} onChange={(event) => updateBase({ name: event.target.value })} /></label>
        <label><span>SOP ID</span><Input value={draft.key} disabled={disabled || Boolean(draft.key)} onChange={(event) => updateBase({ key: event.target.value })} /></label>
        <label><span>版本</span><Input value={draft.version} disabled /></label>
        <label><span>业务域</span><Input value={draft.businessDomain} disabled={disabled} onChange={(event) => updateBase({ businessDomain: event.target.value })} /></label>
        <label className="is-wide"><span>描述</span><Input.TextArea rows={2} value={draft.description} disabled={disabled} onChange={(event) => updateBase({ description: event.target.value })} /></label>
        <label className="is-wide"><span>触发意图</span><Input value={draft.triggerIntents.join("，")} disabled={disabled} onChange={(event) => updateBase({ triggerIntents: event.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean) })} /></label>
        <label className="is-wide"><span>示例话术</span><Input value={draft.utteranceExamples.join("；")} disabled={disabled} onChange={(event) => updateBase({ utteranceExamples: event.target.value.split(/[；;]/).map((value) => value.trim()).filter(Boolean) })} /></label>
        <label className="is-wide"><span>目标动作</span>
          <Select
            value={draft.actionName || undefined}
            disabled={disabled}
            options={actionOptions}
            showSearch
            optionFilterProp="label"
            placeholder="选择动作契约"
            onChange={(value) => updateBase({ actionName: value })}
          />
        </label>
      </div>
    </section>

    <section className="sop-source-section">
      <div className="sop-source-section-head"><h4>高级节点配置</h4><span className="sop-panel-hint">日常请点流程图步骤；这里只给需要细调的人用</span>{!disabled && <Button size="small" icon={<PlusOutlined />} onClick={() => addNode()}>新增节点</Button>}</div>
      <div className="sop-source-node-list">
        {draft.graph.nodes.map((node, index) => {
          const fields = readExpectedFields(node.config);
          const allowed = readStringList(node.config.allowed_actions);
          const dataBindings = (node.config.data_bindings || {}) as Record<string, unknown>;
          const knowledgeScope = (node.config.knowledge_scope || {}) as Record<string, unknown>;
          const outgoing = draft.graph.edges.map((edge, edgeIndex) => ({ edge, edgeIndex })).filter(({ edge }) => edge.source === node.key);
          const protectedNode = node.key === draft.graph.start || draft.graph.terminals.includes(node.key);
          return <article className="sop-source-node-card" key={`${node.key}-${index}`}>
            <div className="sop-source-node-title">
              <strong>Node {index + 1}：{node.title}</strong>
              {!disabled && !protectedNode && <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => deleteNode(index)}>删除节点</Button>}
            </div>
            <div className="sop-source-node-fields">
              <label><span>节点 ID</span><Input value={node.key} disabled /></label>
              <label><span>节点类型</span><Select value={node.type} disabled={disabled} options={NODE_TYPE_OPTIONS} onChange={(value) => updateNode(index, { type: value as SopGraphNode["type"] })} /></label>
              <label className="is-wide"><span>节点名称</span><Input value={node.title} disabled={disabled} onChange={(event) => updateNode(index, { title: event.target.value })} /></label>
              <label className="is-wide"><span>AI 指令</span><Input.TextArea rows={2} value={String(node.config.instruction || node.config.detail || node.config.message || "")} disabled={disabled} placeholder="告诉 AI 这一步要达成什么目标" onChange={(event) => updateNode(index, {}, { instruction: event.target.value })} /></label>
              <label className="is-wide"><span>需要用户补充</span><Select
                mode="multiple"
                value={fields}
                disabled={disabled}
                options={[
                  { value: "date_range", label: "日期范围" },
                  { value: "brand", label: "品牌" },
                  { value: "scope", label: "数据范围" },
                  { value: "dt", label: "截止日期" },
                  { value: "shop", label: "店铺" },
                  { value: "snapshot_id", label: "库存快照" },
                  { value: "output_type", label: "报告类型" },
                ]}
                optionFilterProp="label"
                optionLabelProp="label"
                placeholder="选择要向用户确认的信息"
                tagRender={(props) => (
                  <Tag closable={props.closable} onClose={props.onClose} style={{ marginInlineEnd: 4 }}>
                    {fieldLabel(String(props.value))}
                  </Tag>
                )}
                onChange={(value) => {
                  const normalized = normalizeFieldKeys(value);
                  updateNode(index, {}, { expected_user_info: normalized, required_fields: normalized });
                }}
              /></label>
              <label className="is-wide"><span>允许动作</span><Select mode="multiple" value={allowed} disabled={disabled} options={allowedActionOptions} placeholder="限制本节点可用能力" onChange={(value) => updateNode(index, {}, { allowed_actions: value })} /></label>
              <label className="is-wide"><span>企业数据 Snapshot</span>
                <Select
                  mode="multiple"
                  value={readNumberList(dataBindings.snapshot_ids)}
                  disabled={disabled}
                  options={snapshots.map((item) => ({ value: item.id, label: item.label }))}
                  placeholder="绑定可信企业数据版本"
                  optionFilterProp="label"
                  onChange={(value) => patchDataBindings(index, { snapshot_ids: value })}
                />
              </label>
              <label className="is-wide"><span>指标契约</span>
                <Select
                  mode="multiple"
                  value={readStringList(dataBindings.metric_ids)}
                  disabled={disabled}
                  options={metrics}
                  placeholder="可选指标"
                  optionFilterProp="label"
                  onChange={(value) => patchDataBindings(index, { metric_ids: value })}
                />
              </label>
              <label className="is-wide"><span>资产 Key</span>
                <Select
                  mode="tags"
                  value={readStringList(dataBindings.asset_keys)}
                  disabled={disabled}
                  placeholder="例如 sales.ledger"
                  tokenSeparators={[",", "，", " "]}
                  onChange={(value) => patchDataBindings(index, { asset_keys: value })}
                />
              </label>
              <label><span>数据范围</span>
                <Input
                  value={String(dataBindings.scope || "")}
                  disabled={disabled}
                  placeholder="all / brand ..."
                  onChange={(event) => patchDataBindings(index, { scope: event.target.value })}
                />
              </label>
              <label><span>品牌</span>
                <Select
                  mode="tags"
                  value={readStringList(dataBindings.brand_ids)}
                  disabled={disabled}
                  placeholder="brand_ids"
                  tokenSeparators={[",", "，", " "]}
                  onChange={(value) => patchDataBindings(index, { brand_ids: value })}
                />
              </label>
              <label className="is-wide"><span>知识库</span>
                <Select
                  mode="multiple"
                  value={readNumberList(knowledgeScope.knowledge_base_ids)}
                  disabled={disabled}
                  options={knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name }))}
                  placeholder="绑定可检索知识库"
                  optionFilterProp="label"
                  onChange={(value) => patchKnowledgeScope(index, { knowledge_base_ids: value })}
                />
              </label>
              <label className="is-wide"><span>检索提示</span>
                <Input
                  value={String(knowledgeScope.retrieval_hint || "")}
                  disabled={disabled}
                  placeholder="给知识检索的提示词"
                  onChange={(event) => patchKnowledgeScope(index, { retrieval_hint: event.target.value })}
                />
              </label>
              {(node.type === "execute_action" || node.type === "gate") && (
                <label className="is-wide"><span>调用动作</span>
                  <Select
                    value={String(node.config.action_name || "") || undefined}
                    disabled={disabled}
                    options={actionOptions}
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择动作契约"
                    onChange={(value) => updateNode(index, {}, { action_name: value })}
                  />
                </label>
              )}
            </div>
            <div className="sop-source-rules">
              <div className="sop-source-rules-head"><span>流转规则</span>{!disabled && <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => addEdge(node.key)}>新增规则</Button>}</div>
              {outgoing.length === 0 ? <p>当前节点为终止节点，流程到此结束。</p> : outgoing.map(({ edge, edgeIndex }) => <div className="sop-source-rule-row" key={`${edge.source}-${edge.target}-${edgeIndex}`}>
                <span>从本节点流转到</span>
                <Select value={edge.target} disabled={disabled} options={draft.graph.nodes.filter((item) => item.key !== node.key).map((item) => ({ value: item.key, label: item.title }))} onChange={(value) => updateEdge(edgeIndex, { target: value })} />
                <Select value={edge.condition} disabled={disabled} options={CONDITION_OPTIONS} onChange={(value) => updateEdge(edgeIndex, { condition: value })} />
                {!disabled && <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => onChange({ ...draft, graph: { ...draft.graph, edges: draft.graph.edges.filter((_, itemIndex) => itemIndex !== edgeIndex) } })} />}
              </div>)}
            </div>
          </article>;
        })}
      </div>
    </section>
  </div>;
}

const PROMPT_CHIPS = [
  "每周一对天猫销售做周报，先确认日期和品牌，用企业销售数据",
  "做库存风险分析，绑定库存数据，结果异常时转人工",
  "生成报告前增加一步人工确认",
];

const NODE_PROMPT_CHIPS = [
  "把这一步改成先确认品牌和日期",
  "这一步改用销售台账数据",
  "这一步需要人工确认后再继续",
  "写清楚这一步要完成的目标",
];

const MULTI_PROMPT_CHIPS = [
  "这几步都改成需要确认品牌和日期",
  "这几步统一改用企业销售数据",
  "这几步都加上人工确认",
];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function SopEditor({ initial, record, openVersionsOnMount = false, onBack, onSaved }: {
  initial: SopDraftPayload;
  record?: SopDefinitionItem;
  openVersionsOnMount?: boolean;
  onBack: () => void;
  onSaved: (item: SopDefinitionItem) => void;
}) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initial);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: "welcome", role: "assistant",
    content: record
      ? `已加载「${initial.name}」。点选步骤可单改；Ctrl/⌘+点可多选统一改；点「整条流程」则整体编辑。支持上传/粘贴图片。`
      : "先说整条流程目标；之后可点选一步或多步局部修改。对话框支持 Ctrl+V 贴图。",
  }]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<"flow" | "source">("flow");
  const [selectedNodeKeys, setSelectedNodeKeys] = useState<string[]>([]);
  const [versions, setVersions] = useState<SopVersionItem[]>(record?.version ? [record.version] : []);
  const [selectedVersion, setSelectedVersion] = useState<SopVersionItem | undefined>(record?.version);
  const [versionOpen, setVersionOpen] = useState(Boolean(openVersionsOnMount && record));
  const [actions, setActions] = useState<ActionContract[]>([]);
  const [assets, setAssets] = useState<DataAssetOption[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const readOnly = Boolean(record && (record.system || selectedVersion?.status !== "draft" || !record.canEdit));
  const selectedNodes = draft.graph.nodes.filter((node) => selectedNodeKeys.includes(node.key));
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const editMode = selectedNodeKeys.length === 0 ? "flow" : selectedNodeKeys.length === 1 ? "node" : "nodes";
  const activeChips = editMode === "flow" ? PROMPT_CHIPS : editMode === "node" ? NODE_PROMPT_CHIPS : MULTI_PROMPT_CHIPS;

  const actionTitles = useMemo(
    () => Object.fromEntries(actions.map((action) => [action.name, action.title])),
    [actions],
  );

  const clearSelection = useCallback(() => setSelectedNodeKeys([]), []);
  const selectNode = useCallback((key: string, event?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
    const multi = Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey);
    setSelectedNodeKeys((current) => {
      if (multi) return current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      return current.length === 1 && current[0] === key ? [] : [key];
    });
  }, []);

  const connectEdge = useCallback((source: string, target: string) => {
    setDraft((cur) => {
      if (cur.graph.edges.some((edge) => edge.source === source && edge.target === target)) return cur;
      return {
        ...cur,
        graph: {
          ...cur.graph,
          edges: [...cur.graph.edges, { source, target, condition: "always", priority: 1 }],
        },
      };
    });
  }, []);

  const deleteEdge = useCallback((source: string, target: string) => {
    setDraft((cur) => ({
      ...cur,
      graph: {
        ...cur.graph,
        edges: cur.graph.edges.filter((edge) => !(edge.source === source && edge.target === target)),
      },
    }));
  }, []);

  const moveCanvasNodes = useCallback((positions: Record<string, { x: number; y: number }>) => {
    setDraft((cur) => {
      const prevMeta = cur.graph.meta || {};
      const prevLayout = { ...(prevMeta.layout || {}) };
      return {
        ...cur,
        graph: {
          ...cur.graph,
          meta: {
            ...prevMeta,
            layout: { ...prevLayout, ...positions },
          },
        },
      };
    });
  }, []);

  const resetCanvasLayout = useCallback(() => {
    setDraft((cur) => ({
      ...cur,
      graph: {
        ...cur.graph,
        meta: {
          ...(cur.graph.meta || {}),
          layout: {},
        },
      },
    }));
    message.success("已按流程层级重新排布");
  }, [message]);

  const deleteCanvasNodes = useCallback((keys: string[]) => {
    let blocked = false;
    let removed = false;
    setDraft((cur) => {
      const protectedKeys = new Set([cur.graph.start, ...(cur.graph.terminals || [])]);
      const removing = keys.filter((key) => !protectedKeys.has(key));
      if (!removing.length) {
        blocked = true;
        return cur;
      }
      const removeSet = new Set(removing);
      const nodes = cur.graph.nodes.filter((node) => !removeSet.has(node.key));
      if (nodes.length === 0) {
        blocked = true;
        return cur;
      }
      let edges = cur.graph.edges.filter((edge) => !removeSet.has(edge.source) && !removeSet.has(edge.target));
      removing.forEach((key) => {
        const incoming = cur.graph.edges.filter((edge) => edge.target === key && !removeSet.has(edge.source));
        const outgoing = cur.graph.edges.filter((edge) => edge.source === key && !removeSet.has(edge.target));
        const fallbackTarget = outgoing[0]?.target || cur.graph.terminals[0];
        if (fallbackTarget && !removeSet.has(fallbackTarget)) {
          incoming.forEach((edge) => {
            if (!edges.some((item) => item.source === edge.source && item.target === fallbackTarget)) {
              edges.push({ ...edge, target: fallbackTarget });
            }
          });
        }
      });
      const prevMeta = ((cur.graph as { meta?: Record<string, unknown> }).meta || {}) as Record<string, unknown>;
      const prevLayout = {
        ...((prevMeta.layout && typeof prevMeta.layout === "object"
          ? prevMeta.layout
          : {}) as Record<string, { x: number; y: number }>),
      };
      removing.forEach((key) => { delete prevLayout[key]; });
      removed = true;
      return {
        ...cur,
        graph: {
          ...cur.graph,
          nodes,
          edges,
          meta: {
            goal: Array.isArray(prevMeta.goal) ? prevMeta.goal.map(String) : [],
            required_info: Array.isArray(prevMeta.required_info) ? prevMeta.required_info.map(String) : [],
            slot_filling_policy: (prevMeta.slot_filling_policy && typeof prevMeta.slot_filling_policy === "object"
              ? prevMeta.slot_filling_policy
              : {}) as Record<string, unknown>,
            layout: prevLayout,
          },
        },
      };
    });
    if (blocked) message.warning("起始/结束步骤不能删除，且流程至少保留一个步骤");
    if (removed) {
      setSelectedNodeKeys((current) => current.filter((key) => !keys.includes(key)));
      message.success("已删除选中步骤");
    }
  }, [message]);

  const addCanvasNode = useCallback(() => {
    let createdKey = "";
    setDraft((cur) => {
      const terminalKey = cur.graph.terminals[0] || "finish";
      const terminalIndex = cur.graph.nodes.findIndex((node) => node.key === terminalKey);
      const insertIndex = terminalIndex >= 0 ? terminalIndex : cur.graph.nodes.length;
      let suffix = cur.graph.nodes.length + 1;
      let key = `step.${suffix}`;
      while (cur.graph.nodes.some((node) => node.key === key)) {
        suffix += 1;
        key = `step.${suffix}`;
      }
      createdKey = key;
      const node: SopGraphNode = {
        key,
        type: "checkpoint",
        title: "新流程节点",
        config: {
          ...EMPTY_NODE_CONFIG(""),
          instruction: "说明这个节点要完成的工作",
          allowed_actions: ["confirm", "ask_user", "continue_flow"],
          action_name: "",
        },
      };
      const nodes = [...cur.graph.nodes];
      nodes.splice(insertIndex, 0, node);
      const incoming = cur.graph.edges.filter((edge) => edge.target === terminalKey);
      const edges = cur.graph.edges.map((edge) => (edge.target === terminalKey ? { ...edge, target: key } : edge));
      if (incoming.length === 0 && nodes.length > 1) {
        const previous = nodes[Math.max(0, insertIndex - 1)];
        if (previous && previous.key !== key) {
          edges.push({ source: previous.key, target: key, condition: "always", priority: 1 });
        }
      }
      edges.push({ source: key, target: terminalKey, condition: "always", priority: 1 });
      return { ...cur, graph: { ...cur.graph, nodes, edges } };
    });
    if (createdKey) setSelectedNodeKeys([createdKey]);
  }, []);

  const addImageFiles = useCallback(async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/")).slice(0, 4);
    if (!images.length) return;
    try {
      const urls = await Promise.all(images.map((file) => fileToDataUrl(file)));
      setPendingImages((current) => [...current, ...urls.filter(Boolean)].slice(0, 4));
    } catch {
      message.error("图片读取失败");
    }
  }, [message]);

  useEffect(() => {
    getMe().then((data) => setUser(data.user)).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    getCatalog().then((data) => setActions(data.actions || [])).catch(() => setActions([]));
    getSourceSnapshots().then((data) => {
      const rows = (data as { results?: Array<Record<string, unknown>> }).results || [];
      setAssets(buildDataAssetOptions(rows));
    }).catch(() => setAssets([]));
    listKnowledgeBases().then((data) => {
      setKnowledgeBases(Array.isArray(data) ? data : (data.results || []));
    }).catch(() => setKnowledgeBases([]));
  }, []);

  const refreshVersions = useCallback(async () => {
    if (!record) return;
    try { setVersions((await listSopVersions(record.key)).results || []); }
    catch (error) { message.error(errorText(error, "版本历史加载失败")); }
  }, [message, record]);

  useEffect(() => { void refreshVersions(); }, [refreshVersions]);

  useEffect(() => {
    if (openVersionsOnMount && record) setVersionOpen(true);
  }, [openVersionsOnMount, record]);

  const updateSelectedNode = (next: SopGraphNode) => {
    setDraft((current) => ({
      ...current,
      graph: {
        ...current.graph,
        nodes: current.graph.nodes.map((node) => node.key === next.key ? next : node),
      },
    }));
  };

  const selectVersion = async (version: string) => {
    if (!record) return;
    try {
      const detail = await getSopVersion(record.key, version);
      setSelectedVersion(detail);
      setDraft({ ...draft, version: detail.version, triggerIntents: detail.triggerIntents || [], utteranceExamples: detail.utteranceExamples || [], graph: detail.graph });
      setSelectedNodeKeys([]);
      setVersionOpen(false);
    } catch (error) { message.error(errorText(error, "版本内容加载失败")); }
  };

  const createEditorVersion = async () => {
    if (!record) return;
    const base = record.currentVersion || selectedVersion?.version || "1.0.0";
    const parts = base.split(".").map(Number);
    const next = `${parts[0] || 1}.${(parts[1] || 0) + 1}.0`;
    try {
      const created = await createSopVersion(record.key, { version: next, changeSummary: `基于 ${base} 创建` });
      setSelectedVersion(created);
      setDraft({ ...draft, version: created.version, graph: created.graph, triggerIntents: created.triggerIntents || [], utteranceExamples: created.utteranceExamples || [] });
      await refreshVersions();
      setVersionOpen(false);
      message.success(`已创建可编辑草稿 ${next}`);
    } catch (error) { message.error(errorText(error, "创建新版本失败")); }
  };

  const send = async (preset?: string) => {
    const text = (preset || input).trim();
    if ((!text && pendingImages.length === 0) || sending || readOnly) return;
    const scopedKeys = [...selectedNodeKeys];
    const scopeLabel = scopedKeys.length === 0
      ? "整条流程"
      : scopedKeys.length === 1
        ? `步骤：${selectedNodes[0]?.title || scopedKeys[0]}`
        : `${scopedKeys.length} 个步骤`;
    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: `【编辑范围：${scopeLabel}】${text || "（见附图）"}`,
      images: pendingImages,
    };
    const assistantId = `a-${Date.now()}`;
    const rewriteName = scopedKeys.length ? "rewrite_nodes" : "rewrite_flow";
    const rewriteSummary = scopedKeys.length
      ? "调用模型修改选中步骤"
      : "调用模型生成/修改整条流程";
    const placeholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      tools: [{ name: "read_graph", summary: "读取当前流程", status: "running" }],
      toolsLive: true,
    };
    const nextMessages = [...messages, userMessage, placeholder];
    setMessages(nextMessages);
    if (!preset) setInput("");
    const images = [...pendingImages];
    setPendingImages([]);
    setSending(true);

    const timers: number[] = [];
    timers.push(window.setTimeout(() => {
      setMessages((current) => current.map((item) => {
        if (item.id !== assistantId || !item.toolsLive) return item;
        return {
          ...item,
          tools: [
            { name: "read_graph", summary: "读取当前流程", status: "ok" },
            { name: rewriteName, summary: rewriteSummary, status: "running" },
          ],
        };
      }));
    }, 400));
    timers.push(window.setTimeout(() => {
      setMessages((current) => current.map((item) => {
        if (item.id !== assistantId || !item.toolsLive) return item;
        const tools = item.tools?.length
          ? item.tools
          : [
              { name: "read_graph", summary: "读取当前流程", status: "ok" as const },
              { name: rewriteName, summary: rewriteSummary, status: "running" as const },
            ];
        return { ...item, tools };
      }));
    }, 900));

    try {
      const response = await rewriteSopWithAi({
        instruction: text || "请根据附图修改",
        draft,
        history: messages.map(({ role, content }) => ({ role, content })),
        targetNodeKeys: scopedKeys,
        images,
      });
      timers.forEach((timer) => window.clearTimeout(timer));
      setDraft(response.draft);
      if (scopedKeys.length) setSelectedNodeKeys(scopedKeys);
      const tools = (response.tools || []).map((tool) => ({
        name: tool.name,
        summary: tool.summary,
        status: mapToolStatus(tool.status),
      }));
      setMessages((current) => current.map((item) => (
        item.id === assistantId
          ? {
              ...item,
              content: response.assistant,
              model: response.model,
              tools: tools.length ? tools : item.tools?.map((tool) => ({ ...tool, status: "ok" as const })),
              toolsLive: false,
            }
          : item
      )));
    } catch (error) {
      timers.forEach((timer) => window.clearTimeout(timer));
      setMessages((current) => current.map((item) => {
        if (item.id !== assistantId) return item;
        const tools = [...(item.tools || [])];
        if (tools.length) {
          const last = tools.length - 1;
          tools[last] = { ...tools[last], status: "failed" };
        } else {
          tools.push({ name: rewriteName, summary: rewriteSummary, status: "failed" });
        }
        return {
          ...item,
          content: errorText(error, "AI 暂时无法修改这个流程，请稍后重试。"),
          tools,
          toolsLive: false,
        };
      }));
    } finally {
      setSending(false);
    }
  };

  const saveDraft = async (): Promise<SopDefinitionItem | null> => {
    if (!draft.key.trim()) {
      message.warning("请先用左侧对话生成流程，或补全 SOP 名称后再保存");
      return null;
    }
    setSaving(true);
    const payload = { ...draft, inputSchema: {}, outputSchema: {} };
    try {
      let saved: SopDefinitionItem;
      if (!record) saved = await createSop(payload);
      else {
        await updateSop(record.key, payload);
        saved = selectedVersion?.status === "draft"
          ? await updateSopVersion(record.key, selectedVersion.version, payload).then(() => getSop(record.key))
          : await getSop(record.key);
      }
      message.success("SOP 草稿已保存");
      setSelectedVersion(saved.version);
      await refreshVersions();
      onSaved(saved);
      return saved;
    } catch (error) {
      message.error(errorText(error, "SOP 草稿保存失败"));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const publishCurrent = async () => {
    if (!record || selectedVersion?.status !== "draft") return;
    const saved = await saveDraft();
    if (!saved) return;
    try {
      const published = await publishSopVersion(record.key, selectedVersion.version);
      setSelectedVersion(published.version);
      await refreshVersions();
      message.success(`SOP ${selectedVersion.version} 已发布`);
      onSaved(published);
    } catch (error) { message.error(errorText(error, "版本发布失败")); }
  };

  const trialRun = async () => {
    const saved = record ? ((await saveDraft()) || record) : await saveDraft();
    if (!saved) return;
    const runnable = saved.status === "published" || Boolean(saved.currentVersion);
    if (!runnable) {
      message.warning("请先「发布」后再试跑，系统只会执行已发布流程");
      return;
    }
    navigate(`/work?view=create&sop=${encodeURIComponent(saved.key)}`);
  };

  return <section className="sop-distill-page">
    <header className="sop-distill-header">
      <div><Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button><span><strong>设计流程</strong><small>{draft.name}</small></span></div>
      <Space>
        {record && <Button icon={<HistoryOutlined />} onClick={() => setVersionOpen(true)}>版本 {selectedVersion?.version || draft.version}</Button>}
        {selectedVersion && <Tag color={selectedVersion.status === "draft" ? "gold" : selectedVersion.status === "published" ? "green" : "default"}>{selectedVersion.status === "draft" ? "草稿" : selectedVersion.status === "published" ? "已发布" : "历史版本"}</Tag>}
        {record?.canEdit && readOnly && <Button onClick={() => void createEditorVersion()}>创建新版本</Button>}
        <Button icon={<PlayCircleOutlined />} onClick={() => void trialRun()}>试跑</Button>
        <Button icon={<SaveOutlined />} loading={saving} disabled={readOnly} onClick={() => void saveDraft()}>保存</Button>
        {record?.canEdit && selectedVersion?.status === "draft" && <Button type="primary" onClick={() => void publishCurrent()}>发布</Button>}
      </Space>
    </header>
    <div className="sop-distill-workbench">
      <section className="sop-chat-panel">
        <div className="sop-panel-title">
          <strong>{editMode === "flow" ? "整条流程编辑" : editMode === "node" ? "改当前步骤" : `统一改 ${selectedNodeKeys.length} 步`}</strong>
          <Space size={4}>
            <Button size="small" type={editMode === "flow" ? "primary" : "default"} onClick={clearSelection}>整条流程</Button>
            <span className="sop-panel-hint">{editMode === "flow" ? "未选步骤" : "Ctrl/⌘+点多选"}</span>
          </Space>
        </div>
        {editMode !== "flow" && (
          <div className="sop-scope-banner">
            <div>
              <strong>
                {editMode === "node"
                  ? `已选中：${selectedNode?.title}`
                  : `已选中 ${selectedNodeKeys.length} 步：${selectedNodes.map((node) => node.title).join("、")}`}
              </strong>
              <span>左边发送只会修改选中范围；点空白或「整条流程」切回整体编辑</span>
            </div>
            <Button size="small" type="link" onClick={clearSelection}>整条流程</Button>
          </div>
        )}
        <div className="sop-chat-messages">
          {messages.map((item) => <div key={item.id} className={`sop-chat-row is-${item.role}`}>
            {item.role === "assistant" ? (
              <SopAiAvatar />
            ) : (
              <Avatar size={28} className="sop-chat-avatar" src={authenticatedAvatarUrl(user?.avatar_url)} />
            )}
            <div className={`sop-chat-bubble${item.toolsLive && !item.content ? " is-thinking" : ""}`}>
              {!!item.tools?.length && <SopToolProcess tools={item.tools} />}
              {item.content ? <p>{item.content}</p> : null}
              {!!item.images?.length && (
                <div className="sop-chat-images">
                  {item.images.map((url) => <img key={url.slice(0, 48)} src={url} alt="附件" />)}
                </div>
              )}
              {item.model && <small>{item.model}</small>}
            </div>
          </div>)}
        </div>
        <div className="sop-chat-composer">
          {!readOnly && (
            <div className="sop-prompt-chips">
              {activeChips.map((chip) => (
                <button type="button" key={chip} disabled={sending} onClick={() => void send(chip)}>{chip}</button>
              ))}
            </div>
          )}
          {pendingImages.length > 0 && (
            <div className="sop-pending-images">
              {pendingImages.map((url, index) => (
                <div className="sop-pending-image" key={`${index}-${url.slice(0, 24)}`}>
                  <img src={url} alt={`待发送图片 ${index + 1}`} />
                  <button type="button" onClick={() => setPendingImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button>
                </div>
              ))}
            </div>
          )}
          <Input.TextArea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onPaste={(event) => {
              const items = event.clipboardData?.items;
              if (!items) return;
              const files: File[] = [];
              for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                if (item.type.startsWith("image/")) {
                  const file = item.getAsFile();
                  if (file) files.push(file);
                }
              }
              if (!files.length) return;
              event.preventDefault();
              void addImageFiles(files);
            }}
            onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void send(); } }}
            placeholder={
              readOnly
                ? "已发布版本不可修改，请先创建新版本"
                : editMode === "flow"
                  ? "编辑整条流程，可 Ctrl+V 粘贴流程图截图"
                  : editMode === "node"
                    ? `针对「${selectedNode?.title}」说明怎么改，也可粘贴图片`
                    : `统一修改这 ${selectedNodeKeys.length} 步，也可粘贴图片`
            }
            autoSize={{ minRows: 3, maxRows: 6 }}
            disabled={readOnly}
          />
          <div>
            <span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  event.target.value = "";
                  void addImageFiles(files);
                }}
              />
              <Button size="small" icon={<PaperClipOutlined />} disabled={readOnly || sending} onClick={() => fileInputRef.current?.click()}>上传图片</Button>
              <em style={{ marginLeft: 8 }}>Ctrl+V 贴图</em>
            </span>
            <Button
              type="primary"
              icon={sending ? <StopOutlined /> : <SendOutlined />}
              disabled={(!input.trim() && pendingImages.length === 0) || readOnly}
              onClick={() => void send()}
            >
              {sending ? "生成中" : editMode === "flow" ? "改整条" : editMode === "node" ? "只改这步" : "改选中步骤"}
            </Button>
          </div>
        </div>
      </section>

      <section className={`sop-design-panel${selectedNode && view === "flow" ? " has-biz-panel" : ""}`}>
        <div className="sop-panel-title">
          <strong>{view === "flow" ? "流程预览" : "高级配置"}</strong>
          <Space>
            <span className="sop-panel-hint">{view === "flow" ? "拖动移动 · 单击选中 · Del 删除" : "仅在需要时打开"}</span>
            <Button icon={view === "flow" ? <CodeOutlined /> : <BranchesOutlined />} onClick={() => { setView(view === "flow" ? "source" : "flow"); clearSelection(); }}>
              {view === "flow" ? "高级配置" : "回到流程"}
            </Button>
          </Space>
        </div>
        <div className="sop-design-body">
          {view === "flow" ? (
            <>
              <SopFlowCanvas
                draft={draft}
                selectedKeys={selectedNodeKeys}
                onSelect={selectNode}
                onClear={clearSelection}
                readOnly={readOnly}
                actionTitles={actionTitles}
                onConnectEdge={connectEdge}
                onDeleteEdge={deleteEdge}
                onAddNode={addCanvasNode}
                onDeleteNodes={deleteCanvasNodes}
                onMoveNodes={moveCanvasNodes}
                onResetLayout={resetCanvasLayout}
              />
              {selectedNode && (
                <SopBusinessNodePanel
                  node={selectedNode}
                  disabled={readOnly}
                  actions={actions}
                  assets={assets}
                  knowledgeBases={knowledgeBases}
                  onChange={updateSelectedNode}
                  onClose={clearSelection}
                  onDelete={
                    readOnly || selectedNode.key === draft.graph.start || draft.graph.terminals.includes(selectedNode.key)
                      ? undefined
                      : () => deleteCanvasNodes([selectedNode.key])
                  }
                />
              )}
            </>
          ) : (
            <SopStructuredSource draft={draft} disabled={readOnly} onChange={setDraft} />
          )}
        </div>
      </section>
    </div>
    <Modal open={versionOpen} title="版本管理" footer={null} width={720} onCancel={() => setVersionOpen(false)}>
      <div className="sop-version-manager">
        <div className="sop-version-manager-head">
          <div><strong>{record?.name}</strong><span>已发布版本不可修改；创建新版本后可继续编辑。</span></div>
          {record?.canEdit && !versions.some((version) => version.status === "draft") && <Button type="primary" icon={<PlusOutlined />} onClick={() => void createEditorVersion()}>创建新版本</Button>}
        </div>
        <div className="sop-version-list">
          {versions.map((version) => <button type="button" className={version.version === selectedVersion?.version ? "is-active" : ""} key={version.id} onClick={() => void selectVersion(version.version)}>
            <span><strong>v{version.version}</strong><Tag color={version.status === "draft" ? "gold" : version.status === "published" ? "green" : "default"}>{version.status === "draft" ? "草稿" : version.status === "published" ? "当前发布" : "历史"}</Tag></span>
            <span>{version.changeSummary || "版本内容更新"}</span>
            <small>{version.publishedAt ? `发布于 ${new Date(version.publishedAt).toLocaleString()}` : `创建于 ${new Date(version.createdAt).toLocaleString()}`}</small>
          </button>)}
        </div>
      </div>
    </Modal>
  </section>;
}

export default function SopCenter() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [items, setItems] = useState<SopDefinitionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editor, setEditor] = useState<{ draft: SopDraftPayload; record?: SopDefinitionItem; openVersions?: boolean }>();

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setItems((await listSops()).results || []); }
    catch (error) { message.error(errorText(error, "SOP 加载失败")); }
    finally { setLoading(false); }
  }, [message]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toDraft = (detail: SopDefinitionItem): SopDraftPayload => ({
    key: detail.key,
    name: detail.name,
    businessDomain: detail.businessDomain,
    description: detail.description,
    actionName: detail.actionName,
    version: detail.version?.version || detail.currentVersion || "1.0.0",
    triggerIntents: detail.version?.triggerIntents || [],
    utteranceExamples: detail.version?.utteranceExamples || [],
    graph: detail.version?.graph || EMPTY_GRAPH,
  });

  const copySystem = async (item: SopDefinitionItem) => {
    try {
      const copy = await duplicateSop(item.key);
      const detail = await getSop(copy.key);
      message.success(`已复制为「${detail.name}」`);
      await refresh();
      setEditor({ draft: toDraft(detail), record: detail });
    } catch (error) { message.error(errorText(error, "复制失败")); }
  };

  const openEdit = async (item: SopDefinitionItem, options?: { openVersions?: boolean }) => {
    if (item.system && !options?.openVersions) {
      message.info("系统画廊模板不可原地编辑，请先复制到当前工作区");
      await copySystem(item);
      return;
    }
    try {
      const detail = await getSop(item.key);
      setEditor({ draft: toDraft(detail), record: detail, openVersions: options?.openVersions });
    }
    catch (error) { message.error(errorText(error, "SOP 详情加载失败")); }
  };

  const createNextVersion = async (item: SopDefinitionItem) => {
    const parts = (item.currentVersion || "1.0.0").split(".").map(Number);
    const next = `${parts[0] || 1}.${(parts[1] || 0) + 1}.0`;
    try { await createSopVersion(item.key, { version: next, changeSummary: `基于 ${item.currentVersion} 创建` }); await refresh(); await openEdit(item); }
    catch (error) { message.error(errorText(error, "创建新版本失败")); }
  };

  const publish = async (item: SopDefinitionItem) => {
    try {
      const detail = await getSop(item.key);
      if (!detail.version || detail.version.status !== "draft") return message.warning("当前没有可发布的草稿版本");
      await publishSopVersion(item.key, detail.version.version);
      message.success(`SOP ${detail.version.version} 已发布`);
      await refresh();
    } catch (error) { message.error(errorText(error, "SOP 发布失败")); }
  };

  const runSopTemplate = (row: SopDefinitionItem) => {
    if (sopStatusLabel(row) === "draft") {
      message.info("草稿 SOP 需先发布后再运行");
      return;
    }
    navigate(`/work?view=create&sop=${encodeURIComponent(row.key)}`);
  };

  const visibleItems = useMemo(() => items.filter((row) => {
    if (statusFilter === "published" && sopStatusLabel(row) !== "published") return false;
    if (statusFilter === "draft" && sopStatusLabel(row) !== "draft") return false;
    if (!keyword.trim()) return true;
    const q = keyword.trim().toLowerCase();
    const meta = sopMeta(row);
    return `${row.name} ${row.description} ${row.key} ${meta.label} ${meta.tags.join(" ")}`.toLowerCase().includes(q);
  }), [items, keyword, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [keyword, statusFilter]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return visibleItems.slice(start, start + pageSize);
  }, [page, pageSize, visibleItems]);

  const columns = [
    {
      title: "模板名称",
      key: "name",
      width: "34%",
      render: (_: unknown, row: SopDefinitionItem) => {
        const meta = sopMeta(row);
        return (
          <div className="sop-template-name-cell">
            <span className={`sop-template-icon is-${meta.tone}`}>{meta.icon}</span>
            <div>
              <strong>{row.name}</strong>
              <p>{row.description || "暂无描述"}</p>
              <div className="sop-template-tags">
                {row.system && <span>画廊模板</span>}
                {meta.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            </div>
          </div>
        );
      },
    },
    { title: "分类", key: "category", width: 110, render: (_: unknown, row: SopDefinitionItem) => sopMeta(row).label },
    { title: "版本", dataIndex: "currentVersion", width: 90 },
    { title: "节点数", dataIndex: "nodeCount", width: 90, render: (value: number) => `${value || 0} 个` },
    {
      title: "状态",
      key: "status",
      width: 100,
      render: (_: unknown, row: SopDefinitionItem) => (
        <span className={`sop-template-status is-${sopStatusLabel(row)}`}>
          {sopStatusLabel(row) === "draft" ? "草稿" : "已发布"}
        </span>
      ),
    },
    { title: "执行次数", dataIndex: "callCount", width: 100, render: (value: number) => `${value || 0} 次` },
    { title: "成功率", dataIndex: "successRate", width: 90, render: (value: number) => `${value || 0}%` },
    {
      title: "操作",
      key: "actions",
      width: 240,
      render: (_: unknown, row: SopDefinitionItem) => {
        const moreItems = row.system
          ? [
            { key: "versions", label: "版本管理", onClick: () => void openEdit(row, { openVersions: true }) },
            { key: "copy", label: "复制后编辑", onClick: () => void copySystem(row) },
          ]
          : [
            { key: "edit", label: row.hasDraft ? "AI 编辑草稿" : "查看流程", onClick: () => void openEdit(row) },
            { key: "versions", label: "版本管理", onClick: () => void openEdit(row, { openVersions: true }) },
            ...(row.status === "published" && !row.hasDraft
              ? [{ key: "version", label: "创建新版本", onClick: () => void createNextVersion(row) }]
              : [{
                key: "publish",
                label: "发布草稿",
                onClick: () => {
                  modal.confirm({
                    title: "发布这个 SOP 草稿？",
                    content: "发布后版本内容与 Hash 将固定。",
                    okText: "发布",
                    onOk: () => publish(row),
                  });
                },
              }]),
            { key: "duplicate", label: "复制模板", onClick: () => void copySystem(row) },
          ];
        return (
          <div className="sop-template-actions">
            <Button className="sop-template-run-btn" size="small" icon={<PlayCircleOutlined />} onClick={() => runSopTemplate(row)}>
              运行
            </Button>
            <Tooltip title="复制">
              <Button
                className="sop-template-copy-btn"
                size="small"
                icon={<CopyOutlined />}
                aria-label={`复制${row.name}`}
                onClick={() => void copySystem(row)}
              />
            </Tooltip>
            <Tooltip title="版本管理">
              <Button
                className="sop-template-version-btn"
                size="small"
                icon={<HistoryOutlined />}
                aria-label={`版本管理${row.name}`}
                onClick={() => void openEdit(row, { openVersions: true })}
              />
            </Tooltip>
            <Dropdown
              menu={{
                items: moreItems.map((item) => ({
                  key: item.key,
                  label: item.label,
                  onClick: () => item.onClick(),
                })),
              }}
              trigger={["click"]}
            >
              <Tooltip title="更多操作">
                <Button className="sop-template-more-btn" size="small" icon={<MoreOutlined />} aria-label="更多操作" />
              </Tooltip>
            </Dropdown>
          </div>
        );
      },
    },
  ];

  if (editor) {
    return (
      <SopEditor
        initial={editor.draft}
        record={editor.record}
        openVersionsOnMount={editor.openVersions}
        onBack={() => setEditor(undefined)}
        onSaved={(item) => { setEditor({ draft: toDraft(item), record: item }); void refresh(); }}
      />
    );
  }

  return (
    <div className="sop-center">
      <section className="sop-create-banner">
        <div className="sop-create-banner-copy">
          <span className="sop-create-banner-icon"><PlusOutlined /></span>
          <div>
            <strong>创建空白 SOP</strong>
            <p>从零开始创建，完全自定义每个步骤和规则</p>
          </div>
        </div>
        <Button type="primary" className="sop-create-banner-btn" icon={<PlusOutlined />} onClick={() => setEditor({ draft: EMPTY_DRAFT })}>
          创建 SOP
        </Button>
      </section>

      <section className="sop-list-panel">
        <div className="sop-list-toolbar">
          <h3>SOP 列表</h3>
          <div className="sop-list-toolbar-actions">
            <Input.Search
              allowClear
              value={keyword}
              placeholder="搜索模板名称或描述"
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={(value) => setStatusFilter(value)}
            />
          </div>
        </div>

        <Spin spinning={loading}>
          {visibleItems.length || loading ? (
            <Table
              className="sop-template-table"
              rowKey="id"
              columns={columns}
              dataSource={pagedItems}
              pagination={{
                current: page,
                pageSize,
                total: visibleItems.length,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50],
                showTotal: (total) => `共 ${total} 条记录`,
                onChange: (nextPage, nextSize) => {
                  setPage(nextPage);
                  setPageSize(nextSize);
                },
              }}
              scroll={{ x: 1080 }}
              locale={{ emptyText: "暂无 SOP" }}
            />
          ) : (
            <Empty description="没有匹配的 SOP 模板" className="sop-template-empty" />
          )}
        </Spin>
      </section>
    </div>
  );
}
