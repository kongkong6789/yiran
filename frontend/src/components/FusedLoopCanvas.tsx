import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Segmented, Space, Tag, Typography } from "antd";
import { PauseCircleOutlined, PlayCircleOutlined, AimOutlined } from "@ant-design/icons";
import {
  buildFusedScene,
  FUSED_ROLLUP_CHAIN,
  type FusedFlow,
  type FusedStock,
} from "../loopsHierarchy/fusedLayout";
import { LEVEL_LABEL, LEVEL_ORDER, type LoopLevel } from "../loopsHierarchy/types";
import { useVisualizationTheme } from "../theme/visualization";

type Props = {
  focusLevel: LoopLevel | "all";
  onFocusLevel: (lv: LoopLevel | "all") => void;
};

function port(s: FusedStock, side: "n" | "s" | "e" | "w") {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  if (side === "n") return { x: cx, y: s.y };
  if (side === "s") return { x: cx, y: s.y + s.h };
  if (side === "e") return { x: s.x + s.w, y: cy };
  return { x: s.x, y: cy };
}

function pathFor(from: FusedStock, to: FusedStock, bend = 0.12, cross?: boolean) {
  let a = port(from, "s");
  let b = port(to, "n");
  if (!cross) {
    const dx = (to.x + to.w / 2) - (from.x + from.w / 2);
    const dy = (to.y + to.h / 2) - (from.y + from.h / 2);
    if (Math.abs(dx) > Math.abs(dy) * 1.05) {
      a = port(from, dx > 0 ? "e" : "w");
      b = port(to, dx > 0 ? "w" : "e");
    } else {
      a = port(from, dy > 0 ? "s" : "n");
      b = port(to, dy > 0 ? "n" : "s");
    }
  } else {
    // 跨层：从下层往上卷，方向可能是 sku→link（y 减小）
    if (to.y < from.y) {
      a = port(from, "n");
      b = port(to, "s");
    } else {
      a = port(from, "s");
      b = port(to, "n");
    }
  }
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

export default function FusedLoopCanvas({ focusLevel, onFocusLevel }: Props) {
  const visualTheme = useVisualizationTheme();
  const scene = useMemo(() => buildFusedScene(), []);
  const [playing, setPlaying] = useState(true);
  const [mode, setMode] = useState<"all" | "ROLLUP" | "layer">("all");
  const [selected, setSelected] = useState<FusedStock | null>(null);
  const [focusLoop, setFocusLoop] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  const byGid = useMemo(
    () => Object.fromEntries(scene.stocks.map((s) => [s.gid, s])) as Record<string, FusedStock>,
    [scene.stocks],
  );

  const focusEdges = useMemo(() => {
    const loop = scene.loops.find((l) => l.code === focusLoop);
    return new Set(loop?.edgeIds || []);
  }, [focusLoop, scene.loops]);

  const paths = useMemo(
    () =>
      scene.flows
        .filter((f) => byGid[f.fromGid] && byGid[f.toGid])
        .map((f) => ({
          flow: f,
          ...pathFor(byGid[f.fromGid], byGid[f.toGid], f.cross ? 0.06 : (f.bend ?? 0.12), f.cross),
        })),
    [scene.flows, byGid],
  );

  const laneVisible = (level: LoopLevel) =>
    focusLevel === "all" || focusLevel === level;

  const flowVisible = (f: FusedFlow) => {
    if (mode === "ROLLUP") return Boolean(f.cross);
    if (focusLevel !== "all") {
      if (f.cross) {
        const a = byGid[f.fromGid];
        const b = byGid[f.toGid];
        return a?.level === focusLevel || b?.level === focusLevel;
      }
      return f.level === focusLevel;
    }
    return true;
  };

  useEffect(() => {
    particlesRef.current = scene.flows.flatMap((f) =>
      Array.from({ length: f.cross ? 2 : 2 }, (_, i) => ({
        flowId: f.id,
        t: (i + 0.25) / 2,
        speed: f.cross ? 0.18 : 0.22 + i * 0.02,
      })),
    );
  }, [scene.flows]);

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
      setFrame((x) => x + 1);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  // 聚焦层时滚动到对应泳道
  useEffect(() => {
    if (focusLevel === "all" || !wrapRef.current) return;
    const lane = scene.lanes.find((l) => l.level === focusLevel);
    if (!lane) return;
    const el = wrapRef.current;
    const ratio = lane.y / scene.viewH;
    el.scrollTo({ top: Math.max(0, ratio * el.scrollHeight - 80), behavior: "smooth" });
  }, [focusLevel, scene.lanes, scene.viewH]);

  const sideLoops = useMemo(() => {
    if (focusLevel === "all") {
      return scene.loops.filter((l) => l.level === "company" || l.level === "sku").slice(0, 8);
    }
    return scene.loops.filter((l) => l.level === focusLevel);
  }, [scene.loops, focusLevel]);

  return (
    <div className="fused-root">
      <div className="fused-toolbar">
        <Segmented
          size="small"
          value={focusLevel}
          onChange={(v) => onFocusLevel(v as LoopLevel | "all")}
          options={[
            { value: "all", label: "全融合" },
            ...LEVEL_ORDER.map((lv) => ({ value: lv, label: LEVEL_LABEL[lv] })),
          ]}
        />
        <Space wrap size={8}>
          <Segmented
            size="small"
            value={mode}
            onChange={(v) => setMode(v as typeof mode)}
            options={[
              { value: "all", label: "层内+上卷" },
              { value: "ROLLUP", label: "只看上卷" },
            ]}
          />
          <Button
            size="small"
            type={playing ? "default" : "primary"}
            icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "暂停" : "播放"}
          </Button>
          <Button size="small" icon={<AimOutlined />} onClick={() => onFocusLevel("all")}>
            看全貌
          </Button>
        </Space>
      </div>

      <Typography.Paragraph type="secondary" className="fused-hint">
        六层画在同一幅图里：金色虚线是「层间上卷」。点泳道标签或节点可聚焦，不跳页。
        {mode === "ROLLUP" ? ` · ${FUSED_ROLLUP_CHAIN.desc}` : null}
      </Typography.Paragraph>

      <div className="fused-body">
        <div className="fused-scroll" ref={wrapRef}>
          <svg
            className="fused-svg"
            viewBox={`0 0 ${scene.viewW} ${scene.viewH}`}
            role="img"
            aria-label="分层融合回路全景"
          >
            <defs>
              <marker id="fu-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.2 L 8 5 L 0 8.8 Z" fill="#7d8aa0" />
              </marker>
              <marker id="fu-arrow-gold" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.2 L 8 5 L 0 8.8 Z" fill="#C4924A" />
              </marker>
              <marker id="fu-arrow-neg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1.2 L 8 5 L 0 8.8 Z" fill="#c53d3d" />
              </marker>
            </defs>

            {scene.lanes.map((lane) => {
              const on = laneVisible(lane.level);
              return (
                <g key={lane.level} opacity={on ? 1 : 0.18}>
                  <rect
                    x={12}
                    y={lane.y}
                    width={scene.viewW - 24}
                    height={lane.h}
                    rx={14}
                    fill={visualTheme.mode === "dark" ? visualTheme.labelBg : lane.color}
                    stroke={focusLevel === lane.level ? "#C4924A" : visualTheme.grid}
                    strokeWidth={focusLevel === lane.level ? 2 : 1}
                  />
                  <text
                    x={28}
                    y={lane.y + 22}
                    fontSize="13"
                    fontWeight="700"
                    fill={visualTheme.labelText}
                    style={{ cursor: "pointer" }}
                    onClick={() => onFocusLevel(focusLevel === lane.level ? "all" : lane.level)}
                  >
                    {lane.label}
                  </text>
                  <text x={76} y={lane.y + 22} fontSize="11" fill={visualTheme.mutedText}>
                    {lane.level === "company" ? "多品牌聚合" : lane.level === "sku" ? "单规格经济" : "上卷至上层 · 下钻自下层"}
                  </text>
                </g>
              );
            })}

            {paths.map(({ flow, d, a, b, cx, cy }) => {
              if (!flowVisible(flow)) return null;
              const from = byGid[flow.fromGid];
              const to = byGid[flow.toGid];
              if (!from || !to) return null;
              if (!laneVisible(from.level) && !laneVisible(to.level)) return null;

              const dim = focusEdges.size > 0 && !focusEdges.has(flow.id);
              const stroke = flow.cross
                ? "#C4924A"
                : flow.polarity === "-"
                  ? "#c53d3d"
                  : "#7d8aa0";
              return (
                <g key={flow.id} opacity={dim ? 0.12 : flow.cross ? 0.95 : 0.55}>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={flow.cross ? 2.4 : 1.4}
                    strokeDasharray={flow.cross || flow.delay ? "7 5" : undefined}
                    markerEnd={`url(#${flow.cross ? "fu-arrow-gold" : flow.polarity === "-" ? "fu-arrow-neg" : "fu-arrow"})`}
                  />
                  {!flow.cross ? (
                    <>
                      <circle cx={(cx + a.x + b.x) / 3} cy={(cy + a.y + b.y) / 3} r="8" fill={visualTheme.labelBg} stroke={stroke} />
                      <text
                        x={(cx + a.x + b.x) / 3}
                        y={(cy + a.y + b.y) / 3 + 3}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="700"
                        fill={stroke}
                      >
                        {flow.polarity}
                      </text>
                    </>
                  ) : (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 6}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#8A6A35"
                      fontWeight="600"
                    >
                      {flow.label}
                    </text>
                  )}
                </g>
              );
            })}

            {playing
              && paths.map(({ flow, a, b, cx, cy }) => {
                if (!flowVisible(flow)) return null;
                const from = byGid[flow.fromGid];
                if (from && !laneVisible(from.level) && !laneVisible(byGid[flow.toGid]?.level)) return null;
                void frame;
                return particlesRef.current
                  .filter((p) => p.flowId === flow.id)
                  .map((p, i) => {
                    const pt = pointOnQuad(a, { x: cx, y: cy }, b, p.t);
                    return (
                      <circle
                        key={`${flow.id}-${i}`}
                        cx={pt.x}
                        cy={pt.y}
                        r={flow.cross ? 3 : 2.2}
                        fill={flow.cross ? "#C4924A" : flow.polarity === "-" ? "#c53d3d" : "#5c6b84"}
                        opacity={0.85}
                      />
                    );
                  });
              })}

            {scene.stocks.map((s) => {
              const on = laneVisible(s.level);
              const isSel = selected?.gid === s.gid;
              return (
                <g
                  key={s.gid}
                  opacity={on ? 1 : 0.15}
                  transform={`translate(${s.x}, ${s.y})`}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setSelected(s);
                    if (focusLevel === "all") onFocusLevel(s.level);
                  }}
                >
                  <rect
                    width={s.w}
                    height={s.h}
                    rx={9}
                    fill={visualTheme.labelBg}
                    stroke={isSel ? "#C4924A" : s.color}
                    strokeWidth={isSel ? 2.2 : 1.4}
                  />
                  <text x={8} y={18} fontSize="10" fontWeight="700" fill={s.color}>{s.code}</text>
                  <text x={8} y={34} fontSize="11" fontWeight="650" fill={visualTheme.labelText}>
                    {s.label.length > 8 ? `${s.label.slice(0, 8)}…` : s.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <aside className="fused-side">
          <Typography.Text strong>融合说明</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 6 }}>
            自上而下是经营粒度变细；金色虚线把下层利润/销售/库存拧到公司层 S4 / S8。
          </Typography.Paragraph>

          <Typography.Text strong style={{ display: "block", marginTop: 8 }}>代表回路</Typography.Text>
          <div className="fused-loop-list">
            {sideLoops.map((loop) => (
              <button
                key={loop.code}
                type="button"
                className={`fused-loop-item${focusLoop === loop.code ? " is-active" : ""}`}
                onClick={() => {
                  setFocusLoop(focusLoop === loop.code ? null : loop.code);
                  onFocusLevel(loop.level);
                }}
              >
                <Tag color={loop.kind === "R" ? "orange" : loop.kind === "B" ? "blue" : "purple"}>
                  {loop.kind}
                </Tag>
                <span className="fused-loop-name">{loop.name}</span>
                <span className="fused-loop-path">{loop.path}</span>
              </button>
            ))}
          </div>

          {selected ? (
            <div className="fused-stock-detail">
              <Typography.Text strong>
                {LEVEL_LABEL[selected.level]} · {selected.code} {selected.label}
              </Typography.Text>
              {selected.sub ? (
                <Typography.Paragraph type="secondary" style={{ margin: "4px 0", fontSize: 12 }}>
                  {selected.sub}
                </Typography.Paragraph>
              ) : null}
              {selected.details?.length ? (
                <ul>{selected.details.map((d) => <li key={d}>{d}</li>)}</ul>
              ) : null}
            </div>
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
              点击任意 Stock 查看细项；在「全融合」下点击会顺便聚焦该层泳道。
            </Typography.Paragraph>
          )}
        </aside>
      </div>
    </div>
  );
}
