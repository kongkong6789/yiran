import { useMemo } from "react";
import {
  BaseEdge, Background, BackgroundVariant, Controls, EdgeLabelRenderer, getBezierPath,
  Handle, Panel, Position, ReactFlow, ReactFlowProvider, useInternalNode,
  type Edge, type EdgeProps, type InternalNode, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AimOutlined, SyncOutlined } from "@ant-design/icons";
import type { FeedbackLoop, LoopMember } from "../api/client";

const TYPE_META: Record<FeedbackLoop["loop_type"], { label: string; color: string; soft: string }> = {
  R: { label: "增强回路", color: "#7c3aed", soft: "#f3efff" },
  B: { label: "调节回路", color: "#2563eb", soft: "#eef5ff" },
  comp: { label: "复合回路", color: "#b76b12", soft: "#fff6e9" },
};

const NODE_W = 168;
const NODE_H = 66;

type StepData = {
  name: string;
  order: number;
  accent: string;
  soft: string;
  isStart: boolean;
};

function StepNode({ data }: NodeProps) {
  const d = data as unknown as StepData;
  return (
    <div
      className={`loopcycle-node${d.isStart ? " is-start" : ""}`}
      style={{ ["--lc-accent" as string]: d.accent, ["--lc-soft" as string]: d.soft }}
    >
      <Handle type="target" position={Position.Top} className="loopcycle-handle" />
      <span className="loopcycle-node-index">{d.order}</span>
      <span className="loopcycle-node-body">
        <b title={d.name}>{d.name}</b>
        <small>{d.isStart ? "回路起点" : "经营对象"}</small>
      </span>
      <Handle type="source" position={Position.Bottom} className="loopcycle-handle" />
    </div>
  );
}

function CenterNode({ data }: NodeProps) {
  const d = data as unknown as { type: string; label: string; accent: string; soft: string; count: number };
  return (
    <div className="loopcycle-center" style={{ ["--lc-accent" as string]: d.accent, ["--lc-soft" as string]: d.soft }}>
      <SyncOutlined spin />
      <strong>{d.type}</strong>
      <span>{d.label}</span>
      <small>{d.count} 个环节 · 闭环</small>
    </div>
  );
}

const NODE_TYPES = { step: StepNode, center: CenterNode };

function nodeCenter(node: InternalNode) {
  const p = node.internals.positionAbsolute;
  return {
    x: p.x + (node.measured?.width ?? NODE_W) / 2,
    y: p.y + (node.measured?.height ?? NODE_H) / 2,
  };
}

function intersection(source: InternalNode, target: InternalNode) {
  const w = (source.measured?.width ?? NODE_W) / 2;
  const h = (source.measured?.height ?? NODE_H) / 2;
  const c = nodeCenter(source);
  const t = nodeCenter(target);
  const dx = t.x - c.x;
  const dy = t.y - c.y;
  const scale = 1 / (Math.max(Math.abs(dx) / w, Math.abs(dy) / h) || 1);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

function FloatingEdge({ id, source, target, markerEnd, style, data, animated }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (!sourceNode || !targetNode) return null;
  const s = intersection(sourceNode, targetNode);
  const t = intersection(targetNode, sourceNode);
  const [path, labelX, labelY] = getBezierPath({
    sourceX: s.x, sourceY: s.y, targetX: t.x, targetY: t.y,
    sourcePosition: Position.Bottom, targetPosition: Position.Top, curvature: 0.32,
  });
  const d = data as unknown as { label: string; negative: boolean };
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} className={animated ? "animated" : undefined} />
      <EdgeLabelRenderer>
        <div
          className={`loopcycle-edge-label${d.negative ? " is-negative" : ""}`}
          style={{ transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)` }}
        >
          <i>{d.negative ? "−" : "+"}</i>
          {d.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { floating: FloatingEdge };

function buildCycle(loop: FeedbackLoop) {
  const meta = TYPE_META[loop.loop_type];
  const members = [...(loop.members || [])].sort((a, b) => a.sequence - b.sequence);

  const order: number[] = [];
  const nameOf = new Map<number, string>();
  members.forEach((m: LoopMember) => {
    const sid = m.relation.source;
    if (!order.includes(sid)) order.push(sid);
    nameOf.set(sid, m.relation.source_name || `经营对象 ${sid}`);
    nameOf.set(m.relation.target, m.relation.target_name || `经营对象 ${m.relation.target}`);
  });
  const count = Math.max(order.length, 1);
  const radius = Math.max(210, count * 52);
  const ryFactor = 0.82;

  const nodes: Node[] = order.map((sid, i) => {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    return {
      id: String(sid),
      type: "step",
      position: {
        x: Math.cos(angle) * radius - NODE_W / 2,
        y: Math.sin(angle) * radius * ryFactor - NODE_H / 2,
      },
      data: {
        name: nameOf.get(sid) || `对象 ${sid}`,
        order: i + 1,
        accent: meta.color,
        soft: meta.soft,
        isStart: i === 0,
      } as unknown as Record<string, unknown>,
    };
  });

  nodes.push({
    id: "__center",
    type: "center",
    position: { x: -74, y: -46 },
    draggable: false,
    selectable: false,
    data: {
      type: loop.loop_type,
      label: meta.label,
      accent: meta.color,
      soft: meta.soft,
      count: members.length,
    } as unknown as Record<string, unknown>,
  });

  const edges: Edge[] = members.map((m) => {
    const negative = m.relation.polarity === "-";
    const color = negative ? "#d9483b" : meta.color;
    return {
      id: `m-${m.id}`,
      source: String(m.relation.source),
      target: String(m.relation.target),
      type: "floating",
      animated: true,
      data: { label: m.relation.label || "影响", negative },
      style: { stroke: color, strokeWidth: 2.4, strokeDasharray: "8 6" },
      markerEnd: { type: "arrowclosed", color, width: 18, height: 18 } as unknown as Edge["markerEnd"],
    } satisfies Edge;
  });

  return { nodes, edges, meta };
}

function CycleInner({ loop }: { loop: FeedbackLoop }) {
  const { nodes, edges } = useMemo(() => buildCycle(loop), [loop]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.24 }}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      elementsSelectable={false}
      nodesDraggable
    >
      <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="#e6e9f0" />
      <Controls showInteractive={false} className="cflow-controls" />
      <Panel position="top-left" className="loopcycle-legend">
        <div className="loopcycle-legend-title"><AimOutlined /> 闭环因果</div>
        <div className="loopcycle-legend-row"><i className="is-positive" /> 正向促进</div>
        <div className="loopcycle-legend-row"><i className="is-negative" /> 负向抑制</div>
        <div className="loopcycle-legend-hint">编号为因果顺序，末端箭头返回起点闭环</div>
      </Panel>
    </ReactFlow>
  );
}

export default function LoopCycleCanvas({ loop }: { loop: FeedbackLoop }) {
  if (!loop.members?.length) return null;
  return (
    <ReactFlowProvider key={loop.id}>
      <CycleInner loop={loop} />
    </ReactFlowProvider>
  );
}
