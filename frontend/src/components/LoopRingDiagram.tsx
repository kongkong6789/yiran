import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Space, Typography } from "antd";
import { PauseCircleOutlined, PlayCircleOutlined } from "@ant-design/icons";
import type { FeedbackLoop, LoopMember } from "../api/client";
import { useVisualizationTheme } from "../theme/visualization";

const TYPE_META: Record<string, { label: string; ring: string }> = {
  R: { label: "增强 R", ring: "#cf1322" },
  B: { label: "调节 B", ring: "#1677ff" },
  comp: { label: "复合", ring: "#722ed1" },
};

type Pt = { x: number; y: number };
type NodePos = { id: string; name: string; x: number; y: number };
type EdgePath = {
  id: string;
  from: string;
  to: string;
  label: string;
  polarity: string;
  a: Pt;
  b: Pt;
  cx: number;
  cy: number;
};
type Particle = { edgeId: string; t: number; speed: number };

function buildRingLayout(members: LoopMember[], cx = 220, cy = 200, r = 140) {
  const names: string[] = [];
  for (const m of members) {
    const s = m.relation.source_name || String(m.relation.source);
    const t = m.relation.target_name || String(m.relation.target);
    if (!names.length) names.push(s);
    if (names[names.length - 1] !== s) names.push(s);
    names.push(t);
  }
  if (names.length > 1 && names[0] === names[names.length - 1]) names.pop();

  const nodes: NodePos[] = names.map((name, i) => {
    const ang = (i / Math.max(names.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return {
      id: `${name}__${i}`,
      name,
      x: cx + Math.cos(ang) * r,
      y: cy + Math.sin(ang) * r,
    };
  });

  const edges: EdgePath[] = members.map((m, i) => {
    const from = nodes[i];
    const to = nodes[(i + 1) % nodes.length];
    const a = { x: from.x, y: from.y };
    const b = { x: to.x, y: to.y };
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const bend = 0.12;
    return {
      id: `e-${m.id}`,
      from: from.id,
      to: to.id,
      label: m.relation.label || "",
      polarity: m.relation.polarity || "+",
      a,
      b,
      cx: mx - dy * bend,
      cy: my + dx * bend,
    };
  });
  return { nodes, edges };
}

function pointOnQuad(a: Pt, c: Pt, b: Pt, t: number) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

type Props = {
  loop: Pick<FeedbackLoop, "id" | "name" | "loop_type" | "members">;
  compact?: boolean;
};

/** 闭环环图 + 光点流动（与品牌 Stock–Flow / 代理回路同风格） */
export default function LoopRingDiagram({ loop, compact }: Props) {
  const visualTheme = useVisualizationTheme();
  const members = useMemo(
    () => [...(loop.members || [])].sort((a, b) => a.sequence - b.sequence),
    [loop.members],
  );
  const { nodes, edges } = useMemo(() => buildRingLayout(members), [members]);
  const meta = TYPE_META[loop.loop_type] || TYPE_META.R;
  const markerId = `loop-arrow-${loop.id}`;
  const markerNegId = `loop-arrow-neg-${loop.id}`;

  const [playing, setPlaying] = useState(true);
  const [frame, setFrame] = useState(0);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  useEffect(() => {
    particlesRef.current = edges.flatMap((e) =>
      Array.from({ length: e.polarity === "-" ? 2 : 3 }, (_, i) => ({
        edgeId: e.id,
        t: (i + 0.2) / 3,
        speed: (e.polarity === "-" ? 0.22 : 0.3) + i * 0.035,
      })),
    );
  }, [edges]);

  useEffect(() => {
    if (!playing || !edges.length) {
      cancelAnimationFrame(rafRef.current);
      lastRef.current = 0;
      return;
    }
    const step = (now: number) => {
      if (!lastRef.current) lastRef.current = now;
      const dt = Math.min(0.04, (now - lastRef.current) / 1000);
      lastRef.current = now;
      particlesRef.current = particlesRef.current.map((p) => ({
        ...p,
        t: (p.t + p.speed * dt) % 1,
      }));
      setFrame((n) => n + 1);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, edges.length]);

  if (!members.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="该回路暂无因果成员，无法绘制闭环图"
        style={{ padding: 16 }}
      />
    );
  }

  return (
    <div className={`loop-ring${compact ? " is-compact" : ""}`}>
      <div className="loop-ring-toolbar">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          光点沿因果边流动，表示流量方向
        </Typography.Text>
        <Space size={8}>
          <Button
            size="small"
            type={playing ? "default" : "primary"}
            icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "暂停" : "播放"}
          </Button>
        </Space>
      </div>

      <svg viewBox="0 0 440 400" className="loop-ring-svg" role="img" aria-label={loop.name}>
        <defs>
          <marker id={markerId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#3d6fa8" />
          </marker>
          <marker id={markerNegId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#c53d3d" />
          </marker>
        </defs>
        <circle cx="220" cy="200" r="168" fill="none" stroke={meta.ring} strokeOpacity="0.12" strokeWidth="18" />
        <circle
          cx="220"
          cy="200"
          r="52"
          fill={visualTheme.labelBg}
          stroke={meta.ring}
          strokeOpacity="0.35"
          strokeWidth="2"
        >
          {playing ? (
            <animate attributeName="r" values="50;54;50" dur="2.4s" repeatCount="indefinite" />
          ) : null}
        </circle>
        <text x="220" y="196" textAnchor="middle" fontSize="18" fontWeight="700" fill={meta.ring}>
          {loop.loop_type}
        </text>
        <text x="220" y="216" textAnchor="middle" fontSize="11" fill={visualTheme.mutedText}>
          {meta.label}
        </text>

        {edges.map((e) => {
          const neg = e.polarity === "-";
          const d = `M ${e.a.x} ${e.a.y} Q ${e.cx} ${e.cy} ${e.b.x} ${e.b.y}`;
          const mx = (e.a.x + e.b.x) / 2 * 0.35 + e.cx * 0.65;
          const my = (e.a.y + e.b.y) / 2 * 0.35 + e.cy * 0.65;
          return (
            <g key={e.id}>
              <path
                d={d}
                fill="none"
                stroke={neg ? "#cf1322" : "#3d6fa8"}
                strokeWidth="2.2"
                strokeOpacity="0.85"
                markerEnd={`url(#${neg ? markerNegId : markerId})`}
              />
              {/* 流动虚线底纹 */}
              {playing && (
                <path
                  d={d}
                  fill="none"
                  stroke={neg ? "#cf1322" : "#3d6fa8"}
                  strokeWidth="1.2"
                  strokeOpacity="0.25"
                  strokeDasharray="6 8"
                >
                  <animate
                    attributeName="stroke-dashoffset"
                    from={neg ? "0" : "28"}
                    to={neg ? "28" : "0"}
                    dur="1.1s"
                    repeatCount="indefinite"
                  />
                </path>
              )}
              <rect
                x={mx - 34}
                y={my - 11}
                width="68"
                height="20"
                rx="10"
                fill={visualTheme.labelBg}
                stroke={neg ? "#ffccc7" : "#d6e4ff"}
              />
              <text x={mx} y={my + 4} textAnchor="middle" fontSize="10" fill={neg ? "#ef8585" : visualTheme.labelText}>
                {e.polarity}{e.label.slice(0, 6)}
              </text>
            </g>
          );
        })}

        {playing && particlesRef.current.map((p, i) => {
          const edge = edges.find((x) => x.id === p.edgeId);
          if (!edge) return null;
          const pt = pointOnQuad(edge.a, { x: edge.cx, y: edge.cy }, edge.b, p.t);
          const neg = edge.polarity === "-";
          return (
            <g key={`${p.edgeId}-${i}-${frame % 2}`} style={{ pointerEvents: "none" }}>
              <circle cx={pt.x} cy={pt.y} r={5} fill={neg ? "#c53d3d" : "#3d6fa8"} opacity={0.16} />
              <circle cx={pt.x} cy={pt.y} r={2.6} fill={neg ? "#c53d3d" : "#3d6fa8"} />
            </g>
          );
        })}

        {nodes.map((n) => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r="28" fill={visualTheme.labelBg} stroke={visualTheme.tooltipBorder} strokeWidth="2" />
            <circle cx={n.x} cy={n.y} r="28" fill="rgba(196,146,74,0.08)" stroke="none" />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="11" fontWeight="650" fill={visualTheme.labelText}>
              {n.name.length > 5 ? `${n.name.slice(0, 4)}…` : n.name}
            </text>
          </g>
        ))}
      </svg>

      <Typography.Paragraph type="secondary" className="loop-ring-chain">
        {members.map((m, i) => (
          <span key={m.id}>
            {i === 0 ? m.relation.source_name : ""}
            <em> —[{m.relation.polarity || "?"}{m.relation.label}]→ </em>
            <strong>{m.relation.target_name}</strong>
          </span>
        ))}
      </Typography.Paragraph>

      <style>{`
        .loop-ring {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .loop-ring-toolbar {
          width: min(480px, 100%);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .loop-ring-svg {
          width: min(480px, 100%);
          height: auto;
          background: radial-gradient(circle at 50% 50%, #f7f9fc, #fff 70%);
          border: 1px solid #e8edf5;
          border-radius: 12px;
        }
        .loop-ring.is-compact .loop-ring-svg {
          width: min(420px, 100%);
        }
        .loop-ring-chain {
          max-width: 640px;
          margin: 0 !important;
          font-size: 12px;
          line-height: 1.7;
          text-align: center;
        }
        .loop-ring-chain em {
          font-style: normal;
          color: #8b96a8;
        }
      `}</style>
    </div>
  );
}
