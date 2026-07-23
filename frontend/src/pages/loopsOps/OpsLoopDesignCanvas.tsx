import { useCallback, useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type OnNodeDrag,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export type OpsPhaseKey = "observe" | "orient" | "decide" | "act" | "learn";

export type OpsCanvasPhaseCard = {
  id: OpsPhaseKey;
  label: string;
  tone: string;
  subtitle: string;
  bullets: string[];
  selected: boolean;
};

export type OpsCanvasLayout = Record<string, { x: number; y: number }>;

type PhaseNodeData = OpsCanvasPhaseCard & Record<string, unknown>;

type GoalNodeData = {
  condition: string;
  selected: boolean;
} & Record<string, unknown>;

type EndNodeData = {
  title: string;
  hint: string;
  selected: boolean;
} & Record<string, unknown>;

const DEFAULT_LAYOUT: OpsCanvasLayout = {
  observe: { x: 40, y: 48 },
  orient: { x: 300, y: 48 },
  decide: { x: 560, y: 48 },
  act: { x: 820, y: 48 },
  learn: { x: 1080, y: 48 },
  goal: { x: 860, y: 340 },
  monitor: { x: 1180, y: 380 },
};

const PHASE_COLORS: Record<string, string> = {
  obs: "#16a34a",
  ori: "#0f766e",
  dec: "#2563eb",
  act: "#7c3aed",
  learn: "#d97706",
};

function PhaseCardNode({ data }: NodeProps) {
  const d = data as PhaseNodeData;
  return (
    <div className={`ops-flow-node ${d.tone}${d.selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="ops-flow-handle" />
      <Handle type="target" position={Position.Top} id="top" className="ops-flow-handle" />
      <div className={`ops-flow-banner ${d.tone}`}>
        <span>{d.label}</span>
        <em>已配置</em>
      </div>
      <div className="ops-flow-body">
        <div className="ops-flow-sub">{d.subtitle}</div>
        <ul>
          {d.bullets.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <Handle type="source" position={Position.Right} className="ops-flow-handle" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="ops-flow-handle" />
    </div>
  );
}

function GoalDiamondNode({ data }: NodeProps) {
  const d = data as GoalNodeData;
  return (
    <div className={`ops-flow-goal${d.selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Top} className="ops-flow-handle" />
      <div className="ops-flow-diamond">
        <div className="ops-flow-diamond-inner">
          <strong>是否达成目标？</strong>
          <p>{d.condition || "安全库存达标 / 缺货率 < 5%"}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Left} id="no" className="ops-flow-handle" />
      <Handle type="source" position={Position.Right} id="yes" className="ops-flow-handle" />
    </div>
  );
}

function EndMonitorNode({ data }: NodeProps) {
  const d = data as EndNodeData;
  return (
    <div className={`ops-flow-end${d.selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="ops-flow-handle" />
      <strong>{d.title}</strong>
      <span>{d.hint}</span>
    </div>
  );
}

function LabeledEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const label = String((data as { label?: string } | undefined)?.label || "");
  const tone = String((data as { tone?: string } | undefined)?.tone || "");
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className={`ops-flow-edge-label ${tone}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const NODE_TYPES = {
  phase: PhaseCardNode,
  goal: GoalDiamondNode,
  end: EndMonitorNode,
};

const EDGE_TYPES = {
  labeled: LabeledEdge,
};

type Props = {
  phases: OpsCanvasPhaseCard[];
  loopCondition: string;
  layout?: OpsCanvasLayout;
  selectedId: string;
  onSelect: (id: string) => void;
  onLayoutChange: (layout: OpsCanvasLayout) => void;
};

function buildNodes(phases: OpsCanvasPhaseCard[], loopCondition: string, layout: OpsCanvasLayout, selectedId: string): Node[] {
  const phaseNodes: Node[] = phases.map((phase) => ({
    id: phase.id,
    type: "phase",
    position: layout[phase.id] || DEFAULT_LAYOUT[phase.id],
    selected: selectedId === phase.id,
    data: { ...phase, selected: selectedId === phase.id } as PhaseNodeData,
    draggable: true,
  }));

  return [
    ...phaseNodes,
    {
      id: "goal",
      type: "goal",
      position: layout.goal || DEFAULT_LAYOUT.goal,
      selected: selectedId === "goal",
      data: {
        condition: loopCondition,
        selected: selectedId === "goal",
      } as GoalNodeData,
      draggable: true,
    },
    {
      id: "monitor",
      type: "end",
      position: layout.monitor || DEFAULT_LAYOUT.monitor,
      selected: selectedId === "monitor",
      data: {
        title: "保持平衡",
        hint: "持续监控 · 不强制进入下一轮",
        selected: selectedId === "monitor",
      } as EndNodeData,
      draggable: true,
    },
  ];
}

function buildEdges(): Edge[] {
  const arrow = (color: string) => ({
    type: MarkerType.ArrowClosed,
    color,
    width: 16,
    height: 16,
  });
  return [
    { id: "e-obs-ori", source: "observe", target: "orient", type: "labeled", style: { stroke: "#94a3b8", strokeWidth: 2 }, markerEnd: arrow("#94a3b8") },
    { id: "e-ori-dec", source: "orient", target: "decide", type: "labeled", style: { stroke: "#94a3b8", strokeWidth: 2 }, markerEnd: arrow("#94a3b8") },
    { id: "e-dec-act", source: "decide", target: "act", type: "labeled", style: { stroke: "#94a3b8", strokeWidth: 2 }, markerEnd: arrow("#94a3b8") },
    { id: "e-act-learn", source: "act", target: "learn", type: "labeled", style: { stroke: "#94a3b8", strokeWidth: 2 }, markerEnd: arrow("#94a3b8") },
    {
      id: "e-learn-goal",
      source: "learn",
      sourceHandle: "bottom",
      target: "goal",
      type: "labeled",
      style: { stroke: "#818cf8", strokeWidth: 2 },
      markerEnd: arrow("#818cf8"),
    },
    {
      id: "e-goal-no",
      source: "goal",
      sourceHandle: "no",
      target: "observe",
      targetHandle: "top",
      type: "labeled",
      animated: true,
      data: { label: "否 · 问题回溯，进入下一轮", tone: "no" },
      style: { stroke: "#ef4444", strokeWidth: 2 },
      markerEnd: arrow("#ef4444"),
    },
    {
      id: "e-goal-yes",
      source: "goal",
      sourceHandle: "yes",
      target: "monitor",
      type: "labeled",
      data: { label: "是 · 保持平衡", tone: "yes" },
      style: { stroke: "#22c55e", strokeWidth: 2 },
      markerEnd: arrow("#22c55e"),
    },
  ];
}

function CanvasInner({ phases, loopCondition, layout, selectedId, onSelect, onLayoutChange }: Props) {
  const mergedLayout = useMemo(() => ({ ...DEFAULT_LAYOUT, ...(layout || {}) }), [layout]);
  const [nodes, setNodes, onNodesChange] = useNodesState(
    buildNodes(phases, loopCondition, mergedLayout, selectedId),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildEdges());

  useEffect(() => {
    setNodes(buildNodes(phases, loopCondition, mergedLayout, selectedId));
  }, [phases, loopCondition, mergedLayout, selectedId, setNodes]);

  useEffect(() => {
    setEdges(buildEdges());
  }, [setEdges]);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      const first = selectedNodes[0];
      if (first) onSelect(first.id);
    },
    [onSelect],
  );

  const onNodeDragStop: OnNodeDrag = useCallback(
    (_event, _node, allNodes) => {
      const next: OpsCanvasLayout = {};
      allNodes.forEach((n) => {
        next[n.id] = { x: n.position.x, y: n.position.y };
      });
      onLayoutChange(next);
    },
    [onLayoutChange],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onSelectionChange={onSelectionChange}
      onNodeDragStop={onNodeDragStop}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
      minZoom={0.35}
      maxZoom={1.6}
      nodesConnectable={false}
      edgesReconnectable={false}
      elementsSelectable
      panOnScroll
      selectionOnDrag={false}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{ type: "labeled" }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#c9d0e0" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(n) => {
          if (n.type === "goal") return "#818cf8";
          if (n.type === "end") return "#22c55e";
          const tone = String((n.data as { tone?: string } | undefined)?.tone || "");
          return PHASE_COLORS[tone] || "#94a3b8";
        }}
      />
    </ReactFlow>
  );
}

export default function OpsLoopDesignCanvas(props: Props) {
  return (
    <div className="ops-flow-canvas-wrap">
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

export { DEFAULT_LAYOUT };
