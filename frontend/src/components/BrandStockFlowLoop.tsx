import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Space, Tag, Typography } from "antd";
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";

type StockId =
  | "promo"
  | "voice"
  | "sales"
  | "profit"
  | "cost"
  | "comp"
  | "festival"
  | "trend"
  | "news";

type StockDef = {
  id: StockId;
  label: string;
  sub: string;
  kind: "stock" | "driver";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  soft: string;
};

type FlowDef = {
  id: string;
  from: StockId;
  to: StockId;
  label: string;
  polarity: "+" | "-";
  loop?: "R1" | "R2" | "B1" | "B2";
  bend?: number;
  showLabel?: boolean;
};

/** 分层布局：上驱动 → 中飞轮 → 下闭环，减少交叉 */
const STOCKS: StockDef[] = [
  { id: "festival", label: "节日", sub: "外部驱动", kind: "driver", x: 210, y: 28, w: 96, h: 52, color: "#b8863b", soft: "#f3e6d0" },
  { id: "trend", label: "趋势", sub: "外部驱动", kind: "driver", x: 332, y: 28, w: 96, h: 52, color: "#3d6fa8", soft: "#d9e6f5" },
  { id: "news", label: "新闻", sub: "外部驱动", kind: "driver", x: 454, y: 28, w: 96, h: 52, color: "#5c6b84", soft: "#e2e7ef" },

  { id: "promo", label: "推广投入", sub: "Stock", kind: "stock", x: 48, y: 168, w: 128, h: 78, color: "#2a4a78", soft: "#dce6f4" },
  { id: "voice", label: "市场声量", sub: "Stock", kind: "stock", x: 316, y: 148, w: 128, h: 78, color: "#0f766e", soft: "#d5efeb" },
  { id: "sales", label: "销量", sub: "Stock", kind: "stock", x: 584, y: 168, w: 128, h: 78, color: "#2f9e6c", soft: "#d8f0e4" },
  { id: "comp", label: "竞品压力", sub: "Stock", kind: "stock", x: 780, y: 148, w: 128, h: 78, color: "#b42318", soft: "#f8d9d6" },

  { id: "profit", label: "利润", sub: "Stock", kind: "stock", x: 316, y: 360, w: 128, h: 78, color: "#0b2144", soft: "#d6deea" },
  { id: "cost", label: "成本", sub: "Stock", kind: "stock", x: 584, y: 360, w: 128, h: 78, color: "#c27a1a", soft: "#f5e6cf" },
];

const FLOWS: FlowDef[] = [
  { id: "f1", from: "festival", to: "voice", label: "旺季", polarity: "+", loop: "R2", bend: 0.08, showLabel: true },
  { id: "f2", from: "trend", to: "voice", label: "放大", polarity: "+", loop: "R2", bend: 0, showLabel: false },
  { id: "f3", from: "news", to: "voice", label: "舆论", polarity: "+", loop: "R2", bend: -0.08, showLabel: true },
  { id: "f4", from: "promo", to: "voice", label: "曝光", polarity: "+", loop: "R1", bend: -0.12, showLabel: true },
  { id: "f5", from: "voice", to: "sales", label: "转化", polarity: "+", loop: "R1", bend: 0.1, showLabel: true },
  { id: "f6", from: "sales", to: "profit", label: "收入", polarity: "+", loop: "R1", bend: 0.28, showLabel: true },
  { id: "f7", from: "profit", to: "promo", label: "再投入", polarity: "+", loop: "R1", bend: 0.35, showLabel: true },
  { id: "f8", from: "sales", to: "cost", label: "履约成本", polarity: "+", loop: "B1", bend: 0, showLabel: true },
  { id: "f9", from: "cost", to: "profit", label: "成本侵蚀", polarity: "-", loop: "B1", bend: 0.05, showLabel: true },
  { id: "f10", from: "comp", to: "sales", label: "分流", polarity: "-", loop: "B2", bend: -0.12, showLabel: true },
  { id: "f11", from: "comp", to: "voice", label: "抢声量", polarity: "-", loop: "B2", bend: -0.22, showLabel: true },
  { id: "f12", from: "promo", to: "comp", label: "跟投", polarity: "+", loop: "B2", bend: -0.45, showLabel: true },
];

type Levels = Record<StockId, number>;

const INITIAL: Levels = {
  festival: 42,
  trend: 48,
  news: 36,
  promo: 52,
  voice: 46,
  sales: 50,
  profit: 44,
  cost: 40,
  comp: 38,
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function port(s: StockDef, side: "n" | "s" | "e" | "w" | "c") {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  if (side === "n") return { x: cx, y: s.y };
  if (side === "s") return { x: cx, y: s.y + s.h };
  if (side === "e") return { x: s.x + s.w, y: cy };
  if (side === "w") return { x: s.x, y: cy };
  return { x: cx, y: cy };
}

function pickPorts(from: StockDef, to: StockDef) {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
  if (Math.abs(dx) > Math.abs(dy) * 1.15) {
    return {
      a: port(from, dx > 0 ? "e" : "w"),
      b: port(to, dx > 0 ? "w" : "e"),
    };
  }
  return {
    a: port(from, dy > 0 ? "s" : "n"),
    b: port(to, dy > 0 ? "n" : "s"),
  };
}

function pathFor(from: StockDef, to: StockDef, bend = 0.18) {
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

type Particle = { flowId: string; t: number; speed: number };

type PosMap = Record<StockId, { x: number; y: number }>;

const VIEW_W = 940;
const VIEW_H = 480;

function initialPositions(): PosMap {
  return Object.fromEntries(STOCKS.map((s) => [s.id, { x: s.x, y: s.y }])) as PosMap;
}

function clampPos(x: number, y: number, w: number, h: number) {
  return {
    x: Math.max(8, Math.min(VIEW_W - w - 8, x)),
    y: Math.max(8, Math.min(VIEW_H - h - 8, y)),
  };
}

export default function BrandStockFlowLoop() {
  const [playing, setPlaying] = useState(true);
  const [levels, setLevels] = useState<Levels>(INITIAL);
  const [positions, setPositions] = useState<PosMap>(initialPositions);
  const [dragging, setDragging] = useState<StockId | null>(null);
  const [frame, setFrame] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    id: StockId;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  const accRef = useRef(0);

  const stocks = useMemo(
    () => STOCKS.map((s) => ({ ...s, x: positions[s.id].x, y: positions[s.id].y })),
    [positions],
  );

  const byId = useMemo(
    () => Object.fromEntries(stocks.map((s) => [s.id, s])) as Record<StockId, StockDef>,
    [stocks],
  );

  const paths = useMemo(
    () => FLOWS.map((f) => ({ flow: f, ...pathFor(byId[f.from], byId[f.to], f.bend ?? 0.16) })),
    [byId],
  );

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

  const onNodePointerDown = (e: ReactPointerEvent, id: StockId) => {
    e.preventDefault();
    e.stopPropagation();
    const node = byId[id];
    const p = clientToSvg(e.clientX, e.clientY);
    dragRef.current = {
      id,
      offsetX: p.x - node.x,
      offsetY: p.y - node.y,
    };
    setDragging(id);
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onSvgPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    const p = clientToSvg(e.clientX, e.clientY);
    const node = STOCKS.find((s) => s.id === drag.id)!;
    const next = clampPos(p.x - drag.offsetX, p.y - drag.offsetY, node.w, node.h);
    setPositions((prev) => ({ ...prev, [drag.id]: next }));
  };

  const endDrag = (e?: ReactPointerEvent) => {
    if (e && svgRef.current) {
      try {
        svgRef.current.releasePointerCapture?.(e.pointerId);
      } catch { /* ignore */ }
    }
    dragRef.current = null;
    setDragging(null);
  };

  useEffect(() => {
    particlesRef.current = FLOWS.flatMap((f) =>
      Array.from({ length: f.polarity === "-" ? 2 : 3 }, (_, i) => ({
        flowId: f.id,
        t: (i + 0.15) / 3,
        speed: (f.polarity === "-" ? 0.22 : 0.28) + i * 0.03,
      })),
    );
  }, []);

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

      accRef.current += dt;
      if (accRef.current > 0.08) {
        accRef.current = 0;
        setLevels((prev) => {
          const L = { ...prev };
          const pulse = 0.5 + 0.5 * Math.sin(now / 1700);
          L.festival = clamp(L.festival + (pulse - 0.48) * 22 * 0.08);
          L.trend = clamp(L.trend + Math.sin(now / 2300) * 10 * 0.08);
          L.news = clamp(L.news + Math.cos(now / 1900) * 12 * 0.08);
          L.comp = clamp(L.comp + (L.promo - 50) * 0.07 * 0.08 + 1.2 * 0.08);
          const voiceIn = L.promo * 0.22 + L.festival * 0.18 + L.trend * 0.14 + L.news * 0.12 - L.comp * 0.16;
          L.voice = clamp(L.voice + (voiceIn - L.voice) * 0.5 * 0.08);
          L.sales = clamp(L.sales + (L.voice * 0.35 - L.comp * 0.12 - L.sales * 0.08) * 0.18);
          L.cost = clamp(L.cost + (L.sales * 0.28 - L.cost * 0.12) * 0.16);
          L.profit = clamp(L.profit + (L.sales * 0.32 - L.cost * 0.28 - L.promo * 0.06) * 0.2);
          L.promo = clamp(L.promo + (L.profit * 0.22 - L.promo * 0.1) * 0.16);
          return L;
        });
      }

      setFrame((n) => n + 1);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  const reset = () => {
    setLevels(INITIAL);
    setPositions(initialPositions());
    setDragging(null);
    dragRef.current = null;
  };

  return (
    <div className="brand-sfd">
      <div className="brand-sfd-head">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            品牌经营 Stock–Flow 回路
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0", maxWidth: 640 }}>
            可拖动任意节点调整布局；连线会跟随更新。存量升降表示累积，光点表示流量方向。
          </Typography.Paragraph>
        </div>
        <Space wrap size={8}>
          <Tag className="brand-sfd-chip r1">R1 增长飞轮</Tag>
          <Tag className="brand-sfd-chip r2">R2 时事放大</Tag>
          <Tag className="brand-sfd-chip b1">B1 成本调节</Tag>
          <Tag className="brand-sfd-chip b2">B2 竞品对冲</Tag>
          <Button
            size="small"
            type={playing ? "default" : "primary"}
            icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "暂停" : "播放"}
          </Button>
          <Button size="small" icon={<ReloadOutlined />} onClick={reset}>
            重置
          </Button>
        </Space>
      </div>

      <div className="brand-sfd-canvas-wrap">
        <svg
          ref={svgRef}
          className={`brand-sfd-svg${dragging ? " is-dragging" : ""}`}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          role="img"
          aria-label="品牌因果回路动态图，可拖动节点"
          onPointerMove={onSvgPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <defs>
            <linearGradient id="sf-bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="55%" stopColor="#f3f6fb" />
              <stop offset="100%" stopColor="#eef3f8" />
            </linearGradient>
            <marker id="sf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1.2 L 8 5 L 0 8.8 Z" fill="#7d8aa0" />
            </marker>
            <marker id="sf-arrow-neg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1.2 L 8 5 L 0 8.8 Z" fill="#c53d3d" />
            </marker>
            <filter id="sf-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="rgba(11,33,68,0.12)" />
            </filter>
          </defs>

          <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#sf-bg)" />
          <ellipse cx="380" cy="268" rx="210" ry="148" fill="none" stroke="rgba(184,134,59,0.12)" strokeWidth="1.5" strokeDasharray="6 8" />

          {paths.map(({ flow, d, a, b, cx, cy }) => {
            const neg = flow.polarity === "-";
            const lx = (a.x + b.x) * 0.35 + cx * 0.3;
            const ly = (a.y + b.y) * 0.35 + cy * 0.3;
            return (
              <g key={flow.id} style={{ pointerEvents: "none" }}>
                <path
                  d={d}
                  fill="none"
                  stroke={neg ? "rgba(197,61,61,0.38)" : "rgba(61,111,168,0.34)"}
                  strokeWidth={neg ? 1.8 : 2.1}
                  strokeDasharray={neg ? "5 5" : undefined}
                  markerEnd={neg ? "url(#sf-arrow-neg)" : "url(#sf-arrow)"}
                />
                {flow.showLabel !== false && (
                  <g transform={`translate(${lx}, ${ly})`}>
                    <rect
                      x={-28}
                      y={-9}
                      width={56}
                      height={18}
                      rx={9}
                      fill={neg ? "rgba(254,242,242,0.95)" : "rgba(255,255,255,0.94)"}
                      stroke={neg ? "rgba(197,61,61,0.25)" : "rgba(61,111,168,0.2)"}
                    />
                    <text
                      textAnchor="middle"
                      y={4}
                      className="brand-sfd-flow-label"
                      fill={neg ? "#b42318" : "#4a5b74"}
                    >
                      {flow.polarity}{flow.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {playing && particlesRef.current.map((p, i) => {
            const path = paths.find((x) => x.flow.id === p.flowId);
            if (!path) return null;
            const pt = pointOnQuad(path.a, { x: path.cx, y: path.cy }, path.b, p.t);
            const neg = path.flow.polarity === "-";
            return (
              <g key={`${p.flowId}-${i}-${frame % 2}`} style={{ pointerEvents: "none" }}>
                <circle cx={pt.x} cy={pt.y} r={5} fill={neg ? "#c53d3d" : "#3d6fa8"} opacity={0.16} />
                <circle cx={pt.x} cy={pt.y} r={2.6} fill={neg ? "#c53d3d" : "#3d6fa8"} />
              </g>
            );
          })}

          {[...stocks]
            .sort((a, b) => Number(a.id === dragging) - Number(b.id === dragging))
            .map((s) => {
            const v = levels[s.id];
            const fillH = ((Math.max(6, v) / 100) * (s.h - (s.kind === "driver" ? 28 : 36)));
            const isDriver = s.kind === "driver";
            const isDrag = dragging === s.id;
            return (
              <g
                key={s.id}
                filter="url(#sf-shadow)"
                className={`brand-sfd-node${isDrag ? " is-drag" : ""}`}
                style={{ cursor: isDrag ? "grabbing" : "grab" }}
                onPointerDown={(e) => onNodePointerDown(e, s.id)}
              >
                <rect
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                  rx={isDriver ? 16 : 14}
                  fill="#ffffff"
                  stroke={isDrag ? "#c4924a" : s.color}
                  strokeWidth={isDrag ? 2.2 : 1.5}
                />
                <rect
                  x={s.x + 1.5}
                  y={s.y + s.h - 1.5 - fillH}
                  width={s.w - 3}
                  height={fillH}
                  rx={isDriver ? 14 : 12}
                  fill={s.soft}
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={s.x + s.w / 2}
                  y={s.y + (isDriver ? 22 : 24)}
                  textAnchor="middle"
                  className="brand-sfd-stock-title"
                  fill="#172033"
                  style={{ pointerEvents: "none" }}
                >
                  {s.label}
                </text>
                <text
                  x={s.x + s.w / 2}
                  y={s.y + (isDriver ? 40 : 44)}
                  textAnchor="middle"
                  className="brand-sfd-stock-sub"
                  fill="#8b96a8"
                  style={{ pointerEvents: "none" }}
                >
                  {isDriver ? "Driver · 拖动" : "Stock · 拖动"}
                </text>
                <text
                  x={s.x + s.w / 2}
                  y={s.y + s.h - 12}
                  textAnchor="middle"
                  className="brand-sfd-stock-value"
                  fill={s.color}
                  style={{ pointerEvents: "none" }}
                >
                  {Math.round(v)}
                </text>
              </g>
            );
          })}

          <g style={{ pointerEvents: "none" }}>
            <rect x="42" y="270" width="86" height="24" rx="12" fill="rgba(196,146,74,0.12)" stroke="rgba(184,134,59,0.35)" />
            <text x="85" y="286" textAnchor="middle" className="brand-sfd-badge" fill="#8a6a35">R1 飞轮</text>
            <rect x="520" y="92" width="86" height="24" rx="12" fill="rgba(61,111,168,0.1)" stroke="rgba(61,111,168,0.28)" />
            <text x="563" y="108" textAnchor="middle" className="brand-sfd-badge" fill="#3d6fa8">R2 放大</text>
            <rect x="700" y="420" width="96" height="24" rx="12" fill="rgba(49,94,251,0.08)" stroke="rgba(49,94,251,0.25)" />
            <text x="748" y="436" textAnchor="middle" className="brand-sfd-badge" fill="#315efb">B1 成本</text>
            <rect x="800" y="92" width="96" height="24" rx="12" fill="rgba(180,35,24,0.08)" stroke="rgba(180,35,24,0.25)" />
            <text x="848" y="108" textAnchor="middle" className="brand-sfd-badge" fill="#b42318">B2 竞品</text>
          </g>
        </svg>
      </div>

      <div className="brand-sfd-legend">
        <div>
          <strong>R1 增长飞轮</strong>
          <span>推广 → 声量 → 销量 → 利润 → 再推广</span>
        </div>
        <div>
          <strong>R2 时事放大</strong>
          <span>节日 / 趋势 / 新闻抬升市场声量</span>
        </div>
        <div>
          <strong>拖动提示</strong>
          <span>按住节点拖动；点「重置」恢复默认布局与数值</span>
        </div>
      </div>
    </div>
  );
}
