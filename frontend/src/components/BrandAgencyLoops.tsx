import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Segmented, Space, Tag, Typography } from "antd";
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { semanticSoftColor, useVisualizationTheme } from "../theme/visualization";

type StockId = "s1" | "s2" | "s3" | "s4" | "s5" | "s6" | "s7" | "s8";
type ChainId = "all" | "A" | "B" | "C" | "D" | "E";

type StockDef = {
  id: StockId;
  code: string;
  label: string;
  sub: string;
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
  polarity: "+" | "-";
  delay?: boolean;
  chains: ChainId[];
  label?: string;
  bend?: number;
};

type LoopRow = {
  code: string;
  kind: "R" | "B" | "C";
  name: string;
  path: string;
};

const VIEW_W = 980;
const VIEW_H = 520;

/** 对齐简图布局：增长链靠上、约束靠左下、资源靠右下 */
const STOCKS: StockDef[] = [
  { id: "s1", code: "S1", label: "代理品牌数", sub: "签约规模", x: 48, y: 188, w: 132, h: 72, color: "#1d4ed8", soft: "#dbe7ff" },
  { id: "s2", code: "S2", label: "渠道覆盖密度", sub: "铺货渗透", x: 260, y: 56, w: 140, h: 72, color: "#0369a1", soft: "#d7eef8" },
  { id: "s3", code: "S3", label: "市场认知", sub: "品牌可见度", x: 500, y: 56, w: 132, h: 72, color: "#0f766e", soft: "#d5efeb" },
  { id: "s4", code: "S4", label: "终端销售额", sub: "出货结果", x: 740, y: 188, w: 132, h: 72, color: "#15803d", soft: "#d9f0e2" },
  { id: "s5", code: "S5", label: "品牌方满意度", sub: "信任 / 续约", x: 420, y: 400, w: 148, h: 72, color: "#b45309", soft: "#f6e6d0" },
  { id: "s6", code: "S6", label: "团队服务产能", sub: "人才密度", x: 48, y: 380, w: 140, h: 72, color: "#6d28d9", soft: "#ebe4ff" },
  { id: "s7", code: "S7", label: "代理运营能力", sub: "服务质量", x: 280, y: 256, w: 140, h: 72, color: "#4338ca", soft: "#e0e3ff" },
  { id: "s8", code: "S8", label: "运营资源健康", sub: "库存/物流/现金", x: 600, y: 360, w: 148, h: 72, color: "#be123c", soft: "#f8dce3" },
];

const FLOWS: FlowDef[] = [
  { id: "e1", from: "s1", to: "s2", polarity: "+", chains: ["A"], label: "扩渠", bend: -0.12 },
  { id: "e2", from: "s2", to: "s3", polarity: "+", chains: ["A"], label: "可见", bend: 0 },
  { id: "e3", from: "s3", to: "s4", polarity: "+", chains: ["A"], label: "转化", bend: 0.12 },
  { id: "e4", from: "s4", to: "s5", polarity: "+", chains: ["A", "C"], label: "业绩", bend: 0.2 },
  { id: "e5", from: "s5", to: "s1", polarity: "+", chains: ["A", "B", "D"], label: "续约/拓品", bend: 0.28 },
  { id: "e6", from: "s1", to: "s6", polarity: "-", chains: ["B"], label: "稀释产能", bend: 0.15 },
  { id: "e7", from: "s6", to: "s7", polarity: "+", chains: ["B", "D"], label: "交付", bend: -0.08 },
  { id: "e8", from: "s7", to: "s5", polarity: "+", chains: ["B", "C", "D"], label: "体验", bend: 0.1 },
  { id: "e9", from: "s7", to: "s4", polarity: "+", chains: ["C", "E"], label: "运营拉动", bend: -0.18 },
  { id: "e10", from: "s8", to: "s7", polarity: "+", chains: ["C", "E"], label: "资源支撑", bend: -0.12 },
  { id: "e11", from: "s4", to: "s8", polarity: "-", delay: true, chains: ["E"], label: "消耗资源", bend: 0.22 },
];

const CHAINS: { id: ChainId; name: string; color: string; desc: string }[] = [
  { id: "all", name: "全貌", color: "#64748b", desc: "8 Stock 因果骨架" },
  { id: "A", name: "A 增长链", color: "#ea580c", desc: "S1→S2→S3→S4→S5→S1 品牌代理飞轮" },
  { id: "B", name: "B 约束链", color: "#2563eb", desc: "S1⊖S6→S7→S5→S1 管理带宽约束" },
  { id: "C", name: "C 资源链", color: "#7c3aed", desc: "S8→S7→S4→S5 运营资源支撑" },
  { id: "D", name: "D 人才链", color: "#0f766e", desc: "S6→S7→S5→S1 人才能力飞轮" },
  { id: "E", name: "E 销资反馈", color: "#be123c", desc: "S4⊖//S8→S7→S4 销售耗资源" },
];

const LOOP_CATALOG: LoopRow[] = [
  { code: "R1", kind: "R", name: "品牌代理飞轮", path: "S1→S2→S3→S4→S5→S1" },
  { code: "R2", kind: "R", name: "渠道‑认知加速", path: "S2→S3→S4→S5→S1→S2" },
  { code: "R3", kind: "R", name: "销售信任扩展", path: "S4→S5→S1→S2→S3→S4" },
  { code: "R4", kind: "R", name: "人才‑续约飞轮", path: "S6→S7→S5→S1→…→S6" },
  { code: "R5", kind: "R", name: "服务质量飞轮", path: "S7→S5→S1→S2→S4→S7" },
  { code: "R6", kind: "R", name: "资源‑销售正循环", path: "S8→S7→S4→S8′" },
  { code: "R7", kind: "R", name: "可见度拉动销量", path: "S3→S4→S5→S1→S2→S3" },
  { code: "R8", kind: "R", name: "满意度拓品", path: "S5→S1→S2→S3→S4→S5" },
  { code: "R9", kind: "R", name: "能力密度复利", path: "S6→S7→S4→S5→S1→S6" },
  { code: "B1", kind: "B", name: "管理带宽约束", path: "S1⊖S6→S7→S5→S1" },
  { code: "B2", kind: "B", name: "服务稀释回落", path: "S1⊖S7→S5→S1" },
  { code: "B3", kind: "B", name: "资源挤兑刹车", path: "S4⊖//S8→S7→S4" },
  { code: "B4", kind: "B", name: "满意度下降劝退", path: "S5↓→S1↓→压力缓解" },
  { code: "B5", kind: "B", name: "产能天花板", path: "S6 上限约束 S7/S1" },
  { code: "B6", kind: "B", name: "质量与增速权衡", path: "冲刺 S1 ↔ 保住 S7" },
  { code: "B7", kind: "B", name: "现金/库存回弹", path: "S8 紧张→收缩节奏" },
  { code: "C1", kind: "C", name: "增长极限", path: "R1 上升遇 B1 封顶" },
  { code: "C2", kind: "C", name: "成功抑制成功", path: "业绩好→扩品→稀释→体验掉" },
  { code: "C3", kind: "C", name: "修好再加速", path: "先补 S6/S8，再推 S1" },
  { code: "C4", kind: "C", name: "资源滞后振荡", path: "S4↑ 滞后挤压 S8" },
  { code: "C5", kind: "C", name: "信任滑坡螺旋", path: "S7↓→S5↓→难招新人/品牌" },
  { code: "C6", kind: "C", name: "双引擎协同", path: "增长链 × 人才链并行" },
  { code: "C7", kind: "C", name: "代理产能陷阱", path: "只加品牌不加团队" },
  { code: "C8", kind: "C", name: "稳态经营走廊", path: "S1 增速匹配 S6/S8" },
];

type Levels = Record<StockId, number>;
type PosMap = Record<StockId, { x: number; y: number }>;
type Particle = { flowId: string; t: number; speed: number };

const INITIAL: Levels = {
  s1: 46, s2: 44, s3: 48, s4: 50, s5: 52, s6: 42, s7: 47, s8: 45,
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function initialPositions(): PosMap {
  return Object.fromEntries(STOCKS.map((s) => [s.id, { x: s.x, y: s.y }])) as PosMap;
}

function clampPos(x: number, y: number, w: number, h: number) {
  return {
    x: Math.max(8, Math.min(VIEW_W - w - 8, x)),
    y: Math.max(8, Math.min(VIEW_H - h - 8, y)),
  };
}

function port(s: StockDef, side: "n" | "s" | "e" | "w") {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  if (side === "n") return { x: cx, y: s.y };
  if (side === "s") return { x: cx, y: s.y + s.h };
  if (side === "e") return { x: s.x + s.w, y: cy };
  return { x: s.x, y: cy };
}

function pickPorts(from: StockDef, to: StockDef) {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
  if (Math.abs(dx) > Math.abs(dy) * 1.1) {
    return { a: port(from, dx > 0 ? "e" : "w"), b: port(to, dx > 0 ? "w" : "e") };
  }
  return { a: port(from, dy > 0 ? "s" : "n"), b: port(to, dy > 0 ? "n" : "s") };
}

function pathFor(from: StockDef, to: StockDef, bend = 0.16) {
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

function chainColor(chain: ChainId) {
  return CHAINS.find((c) => c.id === chain)?.color || "#64748b";
}

export default function BrandAgencyLoops() {
  const visualTheme = useVisualizationTheme();
  const [playing, setPlaying] = useState(true);
  const [levels, setLevels] = useState<Levels>(INITIAL);
  const [positions, setPositions] = useState<PosMap>(initialPositions);
  const [dragging, setDragging] = useState<StockId | null>(null);
  const [chain, setChain] = useState<ChainId>("all");
  const [frame, setFrame] = useState(0);
  const [focusLoop, setFocusLoop] = useState<string | null>("R1");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: StockId; offsetX: number; offsetY: number } | null>(null);
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
    dragRef.current = { id, offsetX: p.x - node.x, offsetY: p.y - node.y };
    setDragging(id);
    svgRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onSvgPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    const p = clientToSvg(e.clientX, e.clientY);
    const node = STOCKS.find((s) => s.id === drag.id)!;
    setPositions((prev) => ({
      ...prev,
      [drag.id]: clampPos(p.x - drag.offsetX, p.y - drag.offsetY, node.w, node.h),
    }));
  };

  const endDrag = (e?: ReactPointerEvent) => {
    if (e && svgRef.current) {
      try { svgRef.current.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    }
    dragRef.current = null;
    setDragging(null);
  };

  useEffect(() => {
    particlesRef.current = FLOWS.flatMap((f) =>
      Array.from({ length: f.polarity === "-" ? 2 : 3 }, (_, i) => ({
        flowId: f.id,
        t: (i + 0.2) / 3,
        speed: (f.polarity === "-" ? 0.2 : 0.26) + i * 0.025,
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
      if (accRef.current > 0.09) {
        accRef.current = 0;
        setLevels((prev) => {
          const L = { ...prev };
          const pulse = 0.5 + 0.5 * Math.sin(now / 1800);
          // A 增长
          L.s2 = clamp(L.s2 + (L.s1 - L.s2) * 0.08 * 0.35);
          L.s3 = clamp(L.s3 + (L.s2 - L.s3) * 0.1 * 0.32);
          L.s4 = clamp(L.s4 + (L.s3 * 0.45 + L.s7 * 0.25 - L.s4 * 0.12) * 0.14);
          L.s5 = clamp(L.s5 + (L.s4 * 0.28 + L.s7 * 0.22 - L.s5 * 0.1) * 0.16);
          L.s1 = clamp(L.s1 + (L.s5 - 50) * 0.08 * 0.2 + pulse * 0.4);
          // B 约束：品牌多稀释产能
          L.s6 = clamp(L.s6 + ((55 - L.s1 * 0.35) - L.s6) * 0.12);
          L.s7 = clamp(L.s7 + (L.s6 * 0.45 + L.s8 * 0.25 - L.s7 * 0.15) * 0.16);
          // E 销售耗资源（滞后感体现在较小增益）
          L.s8 = clamp(L.s8 + (52 - L.s4 * 0.22 - L.s8 * 0.08) * 0.12);
          return L;
        });
        setFrame((f) => f + 1);
      }
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
    setChain("all");
    setFocusLoop("R1");
  };

  const activeChain = CHAINS.find((c) => c.id === chain)!;

  return (
    <div className="brand-agency">
      <div className="brand-sfd-head">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Loops Method · 品牌代理 8 Stock
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0", maxWidth: 720 }}>
            8 个存量 × 增长 / 约束 / 资源 / 人才 / 销资反馈链；右侧对照 R·B·C 共 24 条回路语义。节点可拖动。
          </Typography.Paragraph>
        </div>
        <Space wrap size={8}>
          <Tag color="orange">R 增强 ×9</Tag>
          <Tag color="blue">B 调节 ×7</Tag>
          <Tag color="purple">C 复合 ×8</Tag>
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

      <div className="brand-agency-toolbar">
        <Segmented
          size="small"
          value={chain}
          onChange={(v) => setChain(v as ChainId)}
          options={CHAINS.map((c) => ({ label: c.name, value: c.id }))}
        />
        <span className="brand-agency-chain-desc" style={{ color: activeChain.color }}>
          {activeChain.desc}
        </span>
      </div>

      <div className="brand-agency-layout">
        <div className="brand-sfd-canvas-wrap brand-agency-canvas">
          <svg
            ref={svgRef}
            className={`brand-sfd-svg${dragging ? " is-dragging" : ""}`}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label="品牌代理业务 8 Stock 因果图"
            onPointerMove={onSvgPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <defs>
              <linearGradient id="ba-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={visualTheme.canvas} />
                <stop offset="100%" stopColor={visualTheme.labelBg} />
              </linearGradient>
              <marker id="ba-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1.2 L 8 5 L 0 8.8 Z" fill="#7d8aa0" />
              </marker>
              <marker id="ba-arrow-neg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 1.2 L 8 5 L 0 8.8 Z" fill="#c53d3d" />
              </marker>
              <filter id="ba-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="rgba(11,33,68,0.12)" />
              </filter>
            </defs>

            <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#ba-bg)" />

            {paths.map(({ flow, d, a, b, cx, cy }) => {
              const active = chain === "all" || flow.chains.includes(chain);
              const neg = flow.polarity === "-";
              const stroke = active
                ? (neg ? "#c53d3d" : chain === "all" ? "#7d8aa0" : chainColor(chain))
                : "rgba(148,163,184,0.22)";
              const lx = (a.x + b.x) * 0.35 + cx * 0.3;
              const ly = (a.y + b.y) * 0.35 + cy * 0.3;
              return (
                <g key={flow.id} style={{ pointerEvents: "none" }} opacity={active ? 1 : 0.35}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={active ? 2.2 : 1.4}
                    strokeDasharray={flow.delay ? "6 5" : undefined}
                    markerEnd={`url(#${neg ? "ba-arrow-neg" : "ba-arrow"})`}
                  />
                  {active && flow.label && (
                    <g transform={`translate(${lx}, ${ly})`}>
                      <rect x={-28} y={-9} width={56} height={18} rx={9} fill={visualTheme.labelBg} stroke={visualTheme.tooltipBorder} />
                      <text textAnchor="middle" y={4} className="brand-sfd-flow-label" fill={neg ? "#ef8585" : visualTheme.mutedText}>
                        {flow.polarity}{flow.delay ? "//" : ""}{flow.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {playing && particlesRef.current.map((p, i) => {
              const path = paths.find((x) => x.flow.id === p.flowId);
              if (!path) return null;
              const active = chain === "all" || path.flow.chains.includes(chain);
              if (!active) return null;
              const pt = pointOnQuad(path.a, { x: path.cx, y: path.cy }, path.b, p.t);
              const neg = path.flow.polarity === "-";
              const color = neg ? "#c53d3d" : (chain === "all" ? "#3d6fa8" : chainColor(chain));
              return (
                <g key={`${p.flowId}-${i}-${frame % 2}`} style={{ pointerEvents: "none" }}>
                  <circle cx={pt.x} cy={pt.y} r={4.5} fill={color} opacity={0.18} />
                  <circle cx={pt.x} cy={pt.y} r={2.4} fill={color} />
                </g>
              );
            })}

            {[...stocks]
              .sort((a, b) => Number(a.id === dragging) - Number(b.id === dragging))
              .map((s) => {
                const v = levels[s.id];
                const fillH = (Math.max(6, v) / 100) * (s.h - 34);
                const isDrag = dragging === s.id;
                return (
                  <g
                    key={s.id}
                    filter="url(#ba-shadow)"
                    className={`brand-sfd-node${isDrag ? " is-drag" : ""}`}
                    style={{ cursor: isDrag ? "grabbing" : "grab" }}
                    onPointerDown={(e) => onNodePointerDown(e, s.id)}
                  >
                    <rect
                      x={s.x}
                      y={s.y}
                      width={s.w}
                      height={s.h}
                      rx={14}
                      fill={visualTheme.labelBg}
                      stroke={isDrag ? "#c4924a" : s.color}
                      strokeWidth={isDrag ? 2.2 : 1.6}
                    />
                    <rect
                      x={s.x + 1.5}
                      y={s.y + s.h - 1.5 - fillH}
                      width={s.w - 3}
                      height={fillH}
                      rx={12}
                      fill={semanticSoftColor(s.color, visualTheme.mode, s.soft)}
                      style={{ pointerEvents: "none" }}
                    />
                    <text
                      x={s.x + 12}
                      y={s.y + 20}
                      className="brand-agency-code"
                      fill={s.color}
                      style={{ pointerEvents: "none" }}
                    >
                      {s.code}
                    </text>
                    <text
                      x={s.x + s.w / 2}
                      y={s.y + 36}
                      textAnchor="middle"
                      className="brand-sfd-stock-title"
                      fill={visualTheme.labelText}
                      style={{ pointerEvents: "none" }}
                    >
                      {s.label}
                    </text>
                    <text
                      x={s.x + s.w / 2}
                      y={s.y + 52}
                      textAnchor="middle"
                      className="brand-sfd-stock-sub"
                      fill={visualTheme.mutedText}
                      style={{ pointerEvents: "none" }}
                    >
                      {s.sub}
                    </text>
                    <text
                      x={s.x + s.w / 2}
                      y={s.y + s.h - 10}
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
          </svg>
        </div>

        <aside className="brand-agency-catalog">
          <div className="brand-agency-catalog-head">
            <strong>24 回路索引</strong>
            <span>点选高亮语义 · 与左图链式对照</span>
          </div>
          <div className="brand-agency-catalog-list">
            {LOOP_CATALOG.map((row) => {
              const on = focusLoop === row.code;
              return (
                <button
                  key={row.code}
                  type="button"
                  className={`brand-agency-loop-row kind-${row.kind}${on ? " on" : ""}`}
                  onClick={() => {
                    setFocusLoop(row.code);
                    if (row.code.startsWith("R") && ["R1", "R2", "R3"].includes(row.code)) setChain("A");
                    else if (row.code.startsWith("B")) setChain(row.code === "B3" ? "E" : "B");
                    else if (row.code === "C4" || row.code === "C1") setChain(row.code === "C4" ? "E" : "all");
                    else if (row.code.startsWith("R") && ["R4", "R9"].includes(row.code)) setChain("D");
                    else if (row.code.startsWith("R") && row.code === "R6") setChain("C");
                  }}
                >
                  <em>{row.code}</em>
                  <span>
                    <b>{row.name}</b>
                    <small>{row.path}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      <div className="brand-sfd-legend">
        <div>
          <strong>代表路径 1</strong>
          <span>增长飞轮 R1：签约 → 渠道 → 认知 → 销售 → 信任 → 再签约</span>
        </div>
        <div>
          <strong>代表路径 2</strong>
          <span>管理约束 B1：品牌增多稀释团队产能，服务质量回落拖慢拓品</span>
        </div>
        <div>
          <strong>代表路径 3</strong>
          <span>增长极限 C1：飞轮遇上带宽天花板，需先补人才与资源再加速</span>
        </div>
      </div>
    </div>
  );
}
