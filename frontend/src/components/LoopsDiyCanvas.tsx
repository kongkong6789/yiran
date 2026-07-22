import { useCallback, useEffect, useMemo } from "react";
import {
  Background, BackgroundVariant, BaseEdge, ConnectionMode, Controls, EdgeLabelRenderer, Handle,
  MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider,
  getBezierPath, useEdgesState, useNodesState,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { semanticSoftColor, useVisualizationTheme } from "../theme/visualization";

export type DiyKind = "stock" | "flow" | "datapath" | "decision";

export type DiyBinding = {
  data_path?: string;
  metric_code?: string;
  source?: string;
  note?: string;
  ont_object_id?: number;
};

export type DiyNode = {
  id: string;
  kind: DiyKind;
  name: string;
  x: number;
  y: number;
  binding: DiyBinding;
  persistedObjectId?: number;
};

export type DiyEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label: string;
  polarity: "+" | "-" | "";
  delay_days?: number | null;
  evidence_score?: number | null;
  persistedRelationId?: number;
};

export type DiyDraft = {
  nodes: DiyNode[];
  edges: DiyEdge[];
  updatedAt: string;
};

export const DRAFT_STORAGE_KEY = "loops-diy-draft-v2";

export const DIY_KIND_META: Record<DiyKind, {
  label: string;
  otype: string;
  color: string;
  soft: string;
  hint: string;
}> = {
  stock: {
    label: "Stock",
    otype: "Stock",
    color: "#1f3d6b",
    soft: "#eaf1fb",
    hint: "存量",
  },
  flow: {
    label: "Flow",
    otype: "Flow",
    color: "#16806f",
    soft: "#e4f6f2",
    hint: "流量",
  },
  datapath: {
    label: "数据路径",
    otype: "DataPath",
    color: "#d4642a",
    soft: "#fdeee3",
    hint: "绑定取数",
  },
  decision: {
    label: "决策",
    otype: "Decision",
    color: "#7c53c4",
    soft: "#f2ecfd",
    hint: "动作/闸门",
  },
};

export function emptyDraft(): DiyDraft {
  return { nodes: [], edges: [], updatedAt: new Date().toISOString() };
}

export function loadDraft(): DiyDraft {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw) as DiyDraft;
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return emptyDraft();
    }
    return {
      ...parsed,
      edges: parsed.edges.map((e) => ({
        ...e,
        sourceHandle: normalizeHandleId(e.sourceHandle),
        targetHandle: normalizeHandleId(e.targetHandle),
      })),
    };
  } catch {
    return emptyDraft();
  }
}

function normalizeHandleId(id?: string | null): string | null {
  if (!id) return null;
  const base = id.replace(/-(in|out)$/, "");
  if (base === "top" || base === "right" || base === "bottom" || base === "left") {
    return base;
  }
  return null;
}

export function saveDraft(draft: DiyDraft) {
  try {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // ignore quota
  }
}

export function newDiyNode(x: number, y: number, kind: DiyKind = "stock"): DiyNode {
  return {
    id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    kind,
    name: "新节点",
    x,
    y,
    binding: {},
  };
}

export function newDiyEdge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): DiyEdge {
  return {
    id: `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    source,
    target,
    sourceHandle: sourceHandle || null,
    targetHandle: targetHandle || null,
    label: "影响",
    polarity: "+",
    delay_days: null,
    evidence_score: null,
  };
}

function isBound(binding: DiyBinding) {
  return Boolean(binding.data_path || binding.metric_code || binding.ont_object_id);
}

function evidenceBadge(score: number | null | undefined) {
  if (score == null || Number.isNaN(score)) return null;
  return `证${score}`;
}

type CardData = {
  kind: DiyKind;
  name: string;
  binding: DiyBinding;
  accent: string;
  soft: string;
};

function DiyNodeCard({ data, selected }: NodeProps) {
  const d = data as unknown as CardData;
  const meta = DIY_KIND_META[d.kind];
  const visualTheme = useVisualizationTheme();
  const bound = isBound(d.binding);
  const pathHint = d.binding.data_path || d.binding.metric_code || "";
  return (
    <div
      className={`loops-diy-node${selected ? " is-selected" : ""}`}
      style={{
        ["--diy-accent" as string]: meta.color,
        ["--diy-soft" as string]: semanticSoftColor(meta.color, visualTheme.mode, meta.soft),
      }}
    >
      <Handle type="source" position={Position.Top} id="top" className="loops-diy-handle" />
      <Handle type="source" position={Position.Right} id="right" className="loops-diy-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="loops-diy-handle" />
      <Handle type="source" position={Position.Left} id="left" className="loops-diy-handle" />
      <div className="loops-diy-node-top">
        <span className="loops-diy-node-kind">{meta.label}</span>
        <span className={`loops-diy-node-bind${bound ? " is-bound" : ""}`}>
          {bound ? "已绑定" : "未绑定"}
        </span>
      </div>
      <strong className="loops-diy-node-name" title={d.name}>{d.name}</strong>
      {pathHint ? (
        <small className="loops-diy-node-path" title={pathHint}>{pathHint}</small>
      ) : null}
    </div>
  );
}

function DiyCausalEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  markerEnd, style, data, selected,
}: EdgeProps) {
  const d = data as unknown as {
    label: string;
    polarity: string;
    evidence_score?: number | null;
    delay_days?: number | null;
  };
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.28,
  });
  const negative = d.polarity === "-";
  const badge = evidenceBadge(d.evidence_score);
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          ...style,
          strokeWidth: selected ? 2.8 : 2.2,
          strokeDasharray: d.delay_days && d.delay_days > 0 ? "7 5" : undefined,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`loops-diy-edge-label${negative ? " is-negative" : ""}`}
          style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}
        >
          <i>{d.polarity === "-" ? "−" : d.polarity === "+" ? "+" : "·"}</i>
          <span>{d.label || "影响"}</span>
          {badge ? <em>{badge}</em> : null}
          {d.delay_days && d.delay_days > 0 ? <em>{d.delay_days}d</em> : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const NODE_TYPES = { diy: DiyNodeCard };
const EDGE_TYPES = { causal: DiyCausalEdge };

type Props = {
  draft: DiyDraft;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onConnect: (
    source: string,
    target: string,
    sourceHandle?: string | null,
    targetHandle?: string | null,
  ) => void;
  onNodesPositions: (positions: Record<string, { x: number; y: number }>) => void;
  onDeleteEdge: (id: string) => void;
};

function CanvasInner({
  draft, selectedNodeId, selectedEdgeId,
  onSelectNode, onSelectEdge, onConnect, onNodesPositions, onDeleteEdge,
}: Props) {
  const visualTheme = useVisualizationTheme();

  const rfNodes = useMemo<Node[]>(() => draft.nodes.map((n) => {
    const meta = DIY_KIND_META[n.kind];
    return {
      id: n.id,
      type: "diy",
      position: { x: n.x, y: n.y },
      selected: n.id === selectedNodeId,
      data: {
        kind: n.kind,
        name: n.name,
        binding: n.binding,
        accent: meta.color,
        soft: meta.soft,
      } as unknown as Record<string, unknown>,
    };
  }), [draft.nodes, selectedNodeId]);

  const rfEdges = useMemo<Edge[]>(() => draft.edges.map((e) => {
    const negative = e.polarity === "-";
    const color = negative ? "#d9483b" : "#3d6fa8";
    const sourceHandle = normalizeHandleId(e.sourceHandle) || undefined;
    const targetHandle = normalizeHandleId(e.targetHandle) || undefined;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      type: "causal",
      selected: e.id === selectedEdgeId,
      data: {
        label: e.label,
        polarity: e.polarity,
        evidence_score: e.evidence_score,
        delay_days: e.delay_days,
      },
      style: { stroke: color },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 16,
        height: 16,
      },
    };
  }), [draft.edges, selectedEdgeId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    onConnect(
      connection.source,
      connection.target,
      normalizeHandleId(connection.sourceHandle),
      normalizeHandleId(connection.targetHandle),
    );
  }, [onConnect]);

  const isValidConnection = useCallback((connection: Connection | null) => {
    if (!connection?.source || !connection?.target) return false;
    return connection.source !== connection.target;
  }, []);

  const handleNodeDragStop = useCallback((_event: unknown, node: Node) => {
    onNodesPositions({ [node.id]: { x: node.position.x, y: node.position.y } });
  }, [onNodesPositions]);

  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    onNodesChange(changes);
  }, [onNodesChange]);

  const handleEdgesChange = useCallback((changes: Parameters<typeof onEdgesChange>[0]) => {
    // 连线由 onConnect → draft 驱动，忽略 React Flow 自带的 add，避免状态打架
    onEdgesChange(changes.filter((change) => change.type !== "add"));
  }, [onEdgesChange]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={handleConnect}
      isValidConnection={isValidConnection}
      onNodeClick={(_, node) => onSelectNode(node.id)}
      onEdgeClick={(_, edge) => onSelectEdge(edge.id)}
      onPaneClick={() => { onSelectNode(null); onSelectEdge(null); }}
      onNodeDragStop={handleNodeDragStop}
      onEdgesDelete={(deleted) => deleted.forEach((e) => onDeleteEdge(e.id))}
      fitView
      fitViewOptions={{ padding: 0.22 }}
      minZoom={0.25}
      maxZoom={2.2}
      proOptions={{ hideAttribution: true }}
      nodesDraggable
      nodesConnectable
      elementsSelectable
      connectionMode={ConnectionMode.Loose}
      deleteKeyCode={["Backspace", "Delete"]}
      defaultEdgeOptions={{ type: "causal" }}
      connectionLineStyle={{ stroke: visualTheme.edgeActive, strokeWidth: 2 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={visualTheme.grid} />
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={2}
        nodeColor={(n) => DIY_KIND_META[(n.data as unknown as CardData).kind]?.color || "#888"}
        maskColor={visualTheme.loadingMask}
      />
      <Controls showInteractive />
    </ReactFlow>
  );
}

export default function LoopsDiyCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
