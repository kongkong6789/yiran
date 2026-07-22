import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Segmented, Space, Tag, Typography } from "antd";
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { FlowEdge, LevelModel, NamedLoop, StockNode } from "../loopsHierarchy/types";
import { semanticSoftColor, useVisualizationTheme } from "../theme/visualization";

type PosMap = Record<string, { x: number; y: number }>;
type Particle = { flowId: string; t: number; speed: number };

type Props = {
  model: LevelModel;
  entityName?: string;
  onStockActivate?: (stock: StockNode) => void;
};

function port(s: StockNode, side: "n" | "s" | "e" | "w") {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  if (side === "n") return { x: cx, y: s.y };
  if (side === "s") return { x: cx, y: s.y + s.h };
  if (side === "e") return { x: s.x + s.w, y: cy };
  return { x: s.x, y: cy };
}

function pickPorts(from: StockNode, to: StockNode) {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
  if (Math.abs(dx) > Math.abs(dy) * 1.1) {
    return { a: port(from, dx > 0 ? "e" : "w"), b: port(to, dx > 0 ? "w" : "e") };
  }
  return { a: port(from, dy > 0 ? "s" : "n"), b: port(to, dy > 0 ? "n" : "s") };
}

function pathFor(from: StockNode, to: StockNode, bend = 0.16) {
  const { a, b } = pickPorts(from, to);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  return { d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`, a, b, cx, cy };
}

function pointOnQuad(
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

function clampPos(x: number, y: number, w: number, h: number, viewW: number, viewH: number) {
  return {
    x: Math.max(8, Math.min(viewW - w - 8, x)),
    y: Math.max(8, Math.min(viewH - h - 8, y)),
  };
}

export default function HierarchyLoopDiagram({ model, entityName, onStockActivate }: Props) {
  const visualTheme = useVisualizationTheme();
  const [playing, setPlaying] = useState(true);
  const [chain, setChain] = useState("all");
  const [focusLoop, setFocusLoop] = useState<string | null>(model.loops[0]?.code ?? null);
  const [positions, setPositions] = useState<PosMap>(() =>
    Object.fromEntries(model.stocks.map((s) => [s.id, { x: s.x, y: s.y }])),
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [selected, setSelected] = useState<StockNode | null>(null);
  const [frame, setFrame] = useState(0);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  // 换层时重置
  useEffect(() => {
    setPositions(Object.fromEntries(model.stocks.map((s) => [s.id, { x: s.x, y: s.y }])));
    setChain("all");
    setFocusLoop(model.loops[0]?.code ?? null);
    setSelected(null);
    setDragging(null);
    dragRef.current = null;
  }, [model.level]);

  const stocks = useMemo(
    () => model.stocks.map((s) => ({ ...s, x: positions[s.id]?.x ?? s.x, y: positions[s.id]?.y ?? s.y })),
    [model.stocks, positions],
  );
  const byId = useMemo(
    () => Object.fromEntries(stocks.map((s) => [s.id, s])) as Record<string, StockNode>,
    [stocks],
  );

  const focusEdges = useMemo(() => {
    const loop = model.loops.find((l) => l.code === focusLoop);
    return new Set(loop?.edgeIds || []);
  }, [focusLoop, model.loops]);

  const paths = useMemo(
    () =>
      model.flows
        .filter((f) => byId[f.from] && byId[f.to])
        .map((f) => ({ flow: f, ...pathFor(byId[f.from], byId[f.to], f.bend ?? 0.16) })),
    [model.flows, byId],
  );

  const activeChain = model.chains.find((c) => c.id === chain) || model.chains[0];

  const flowActive = (f: FlowEdge) => {
    if (chain !== "all" && !f.chains.includes(chain)) return false;
    if (focusEdges.size && !focusEdges.has(f.id) && chain === "all") {
      // 有聚焦回路时，未命中边淡化但仍显示
      return true;
    }
    return true;
  };

  const flowEmphasis = (f: FlowEdge) => {
    if (focusEdges.size) return focusEdges.has(f.id);
    if (chain === "all") return true;
    return f.chains.includes(chain);
  };

  const clientToSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const onNodePointerDown = (e: ReactPointerEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const node = byId[id];
    const p = clientToSvg(e.clientX, e.clientY);
    dragRef.current = { id, offsetX: p.x - node.x, offsetY: p.y - node.y, moved: false };
    setDragging(id);
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onSvgPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    const p = clientToSvg(e.clientX, e.clientY);
    const base = model.stocks.find((s) => s.id === drag.id);
    if (!base) return;
    const nx = p.x - drag.offsetX;
    const ny = p.y - drag.offsetY;
    if (Math.abs(nx - (positions[drag.id]?.x ?? base.x)) > 3
      || Math.abs(ny - (positions[drag.id]?.y ?? base.y)) > 3) {
      drag.moved = true;
    }
    setPositions((prev) => ({
      ...prev,
      [drag.id]: clampPos(nx, ny, base.w, base.h, model.viewW, model.viewH),
    }));
  };

  const endDrag = (e?: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (e && svgRef.current) {
      try { svgRef.current.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    }
    if (drag && !drag.moved) {
      const stock = byId[drag.id];
      if (stock) {
        setSelected(stock);
        onStockActivate?.(stock);
      }
    }
    dragRef.current = null;
    setDragging(null);
  };

  useEffect(() => {
    particlesRef.current = model.flows.flatMap((f) =>
      Array.from({ length: f.polarity === "-" ? 2 : 3 }, (_, i) => ({
        flowId: f.id,
        t: (i + 0.2) / 3,
        speed: (f.polarity === "-" ? 0.2 : 0.26) + i * 0.025,
      })),
    );
  }, [model.level, model.flows]);

  useEffect(() => {
    if (!playing) {
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
      setFrame((f) => f + 1);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  const reset = () => {
    setPositions(Object.fromEntries(model.stocks.map((s) => [s.id, { x: s.x, y: s.y }])));
    setChain("all");
    setFocusLoop(model.loops[0]?.code ?? null);
    setSelected(null);
  };

  const uid = `hl-${model.level}`;

  return (
    <div className="hl-diagram">
      <div className="hl-diagram-head">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {model.title}
            {entityName ? <span className="hl-entity"> · {entityName}</span> : null}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0", maxWidth: 720 }}>
            {model.subtitle}
          </Typography.Paragraph>
        </div>
        <Space wrap size={8}>
          <Button
            size="small"
            type={playing ? "default" : "primary"}
            icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "暂停" : "播放"}
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={reset}>
            重置布局
          </Button>
        </Space>
      </div>

      <div className="hl-diagram-toolbar">
        <Segmented
          size="small"
          value={chain}
          onChange={(v) => setChain(String(v))}
          options={model.chains.map((c) => ({ label: c.name, value: c.id }))}
        />
        <span className="hl-chain-desc" style={{ color: activeChain?.color }}>
          {activeChain?.desc}
        </span>
      </div>

      <div className="hl-diagram-body">
        <div className="hl-canvas-wrap">
          <svg
            ref={svgRef}
            className={`hl-svg${dragging ? " is-dragging" : ""}`}
            viewBox={`0 0 ${model.viewW} ${model.viewH}`}
            role="img"
            aria-label={model.title}
            onPointerMove={onSvgPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <defs>
              <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={visualTheme.canvas} />
                <stop offset="100%" stopColor={visualTheme.labelBg} />
              </linearGradient>
              <marker id={`${uid}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1.2 L 8 5 L 0 8.8 Z" fill="#7d8aa0" />
              </marker>
              <marker id={`${uid}-arrow-neg`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1.2 L 8 5 L 0 8.8 Z" fill="#c53d3d" />
              </marker>
              <filter id={`${uid}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodOpacity="0.12" />
              </filter>
            </defs>
            <rect width={model.viewW} height={model.viewH} fill={`url(#${uid}-bg)`} rx="12" />

            {paths.map(({ flow, d, a, b, cx, cy }) => {
              const active = flowActive(flow);
              const emph = flowEmphasis(flow);
              const muted = chain !== "all" && !flow.chains.includes(chain);
              const dimmed = focusEdges.size > 0 && !focusEdges.has(flow.id);
              const opacity = muted || dimmed ? 0.18 : emph ? 1 : 0.45;
              if (!active && chain !== "all") return null;
              const stroke = flow.polarity === "-" ? "#c53d3d" : (activeChain && chain !== "all" ? activeChain.color : "#7d8aa0");
              return (
                <g key={flow.id} opacity={opacity}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={emph ? 2.2 : 1.5}
                    strokeDasharray={flow.delay ? "6 4" : undefined}
                    markerEnd={`url(#${uid}-arrow${flow.polarity === "-" ? "-neg" : ""})`}
                  />
                  <circle
                    cx={(a.x + b.x) / 2 * 0 + (cx + a.x + b.x) / 3}
                    cy={(cy + a.y + b.y) / 3}
                    r="9"
                    fill={visualTheme.labelBg}
                    stroke={stroke}
                    strokeWidth="1"
                  />
                  <text
                    x={(cx + a.x + b.x) / 3}
                    y={(cy + a.y + b.y) / 3 + 3.5}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    fill={stroke}
                  >
                    {flow.polarity}
                  </text>
                  {flow.delay ? (
                    <text
                      x={(cx + a.x + b.x) / 3 + 14}
                      y={(cy + a.y + b.y) / 3 + 3}
                      fontSize="9"
                      fill={visualTheme.mutedText}
                    >
                      //
                    </text>
                  ) : null}
                </g>
              );
            })}

            {/* 流动粒子 — frame 触发重绘 */}
            {playing && paths.map(({ flow, a, b, cx, cy }) => {
              const muted = chain !== "all" && !flow.chains.includes(chain);
              const dimmed = focusEdges.size > 0 && !focusEdges.has(flow.id);
              if (muted || dimmed) return null;
              const parts = particlesRef.current.filter((p) => p.flowId === flow.id);
              return parts.map((p, i) => {
                const pt = pointOnQuad(a, { x: cx, y: cy }, b, p.t);
                void frame;
                return (
                  <circle
                    key={`${flow.id}-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r="2.6"
                    fill={flow.polarity === "-" ? "#c53d3d" : "#C4924A"}
                    opacity="0.9"
                  />
                );
              });
            })}

            {stocks.map((s) => {
              const isSel = selected?.id === s.id;
              const canDrill = Boolean(s.drillLevel) || Boolean(s.details?.length);
              return (
                <g
                  key={s.id}
                  className={`hl-node${dragging === s.id ? " is-drag" : ""}`}
                  transform={`translate(${s.x}, ${s.y})`}
                  onPointerDown={(e) => onNodePointerDown(e, s.id)}
                  style={{ cursor: canDrill ? "pointer" : "grab" }}
                >
                  <rect
                    width={s.w}
                    height={s.h}
                    rx="10"
                    fill={semanticSoftColor(s.color, visualTheme.mode, s.soft)}
                    stroke={isSel ? "#C4924A" : s.color}
                    strokeWidth={isSel ? 2.4 : 1.6}
                    filter={`url(#${uid}-shadow)`}
                  />
                  <text x={10} y={20} fontSize="11" fontWeight="700" fill={s.color}>{s.code}</text>
                  <text x={10} y={38} fontSize="12" fontWeight="650" fill={visualTheme.labelText}>{s.label}</text>
                  {s.sub ? (
                    <text x={10} y={54} fontSize="10" fill={visualTheme.mutedText}>{s.sub}</text>
                  ) : null}
                  {canDrill ? (
                    <text x={s.w - 8} y={s.h - 8} textAnchor="end" fontSize="9" fill="#C4924A">↓</text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="hl-side">
          <Typography.Text strong>代表回路</Typography.Text>
          <div className="hl-loop-list">
            {model.loops.map((loop: NamedLoop) => (
              <button
                key={loop.code}
                type="button"
                className={`hl-loop-item${focusLoop === loop.code ? " is-active" : ""}`}
                onClick={() => setFocusLoop(focusLoop === loop.code ? null : loop.code)}
              >
                <Tag color={loop.kind === "R" ? "orange" : loop.kind === "B" ? "blue" : "purple"}>
                  {loop.code}
                </Tag>
                <span className="hl-loop-name">{loop.name}</span>
                <span className="hl-loop-path">{loop.path}</span>
              </button>
            ))}
          </div>

          {selected ? (
            <div className="hl-stock-detail">
              <Typography.Text strong>{selected.code} · {selected.label}</Typography.Text>
              {selected.details?.length ? (
                <ul>
                  {selected.details.map((d) => <li key={d}>{d}</li>)}
                </ul>
              ) : (
                <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0", fontSize: 12 }}>
                  {selected.drillLevel
                    ? `可下钻至下一层（${selected.drillLevel}）`
                    : selected.sub || "本层存量指标"}
                </Typography.Paragraph>
              )}
            </div>
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
              {model.drillHint}
            </Typography.Paragraph>
          )}

          {model.rollupHint ? (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
              {model.rollupHint}
            </Typography.Paragraph>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
