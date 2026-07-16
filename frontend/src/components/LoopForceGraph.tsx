import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { forceCollide, forceLink } from "d3-force";
import { Button, Segmented, Space, Tag, Typography } from "antd";
import {
  AimOutlined, CaretRightOutlined, PauseCircleOutlined, ReloadOutlined,
} from "@ant-design/icons";
import {
  buildLoopForceGraph,
  COL_X,
  LEVEL_COLOR,
  type LoopGLink,
  type LoopGNode,
} from "../loopsHierarchy/forceGraphData";
import { LEVEL_LABEL, LEVEL_ORDER, type LoopLevel } from "../loopsHierarchy/types";
import { LOOP_LEVEL_ONTOLOGY } from "../loopsHierarchy/commerceLevels";

type FgData = { nodes: LoopGNode[]; links: LoopGLink[] };
type EdgeMode = "all" | "structure" | "causal" | "rollup";
type FgApi = ForceGraphMethods<LoopGNode, LoopGLink> & {
  centerAt?: (x: number, y: number, ms?: number) => void;
  zoom?: (z: number, ms?: number) => void;
  zoomToFit?: (ms?: number, padding?: number) => void;
};

function linkEnds(link: LoopGLink): { s: string; t: string } {
  const s = typeof link.source === "object" ? link.source.id : String(link.source);
  const t = typeof link.target === "object" ? link.target.id : String(link.target);
  return { s, t };
}

function wrapLabel(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const lines: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    lines.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars);
    if (lines.length >= 2) {
      lines[1] = `${lines[1].slice(0, maxChars - 1)}…`;
      return lines;
    }
  }
  if (rest) lines.push(rest);
  return lines;
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function levelIndex(level: LoopLevel | "all") {
  if (level === "all") return -1;
  return LEVEL_ORDER.indexOf(level);
}

export default function LoopForceGraph() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<FgApi | undefined>(undefined);
  const didFitRef = useRef(false);
  const hoverIdRef = useRef<string | null>(null);
  const animRef = useRef(0);
  const revealAtRef = useRef(performance.now());
  const flashAtRef = useRef(0);
  const tourTimerRef = useRef<number | null>(null);

  const [size, setSize] = useState({ w: 800, h: 560 });
  const [filterLevel, setFilterLevel] = useState<LoopLevel | "all">("all");
  const [edgeMode, setEdgeMode] = useState<EdgeMode>("all");
  const [selected, setSelected] = useState<LoopGNode | null>(null);
  const [hoverNode, setHoverNode] = useState<LoopGNode | null>(null);
  const [focusLoop, setFocusLoop] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [frame, setFrame] = useState(0);
  const [touring, setTouring] = useState(false);
  const [flashLabel, setFlashLabel] = useState("");

  const bundle = useMemo(() => buildLoopForceGraph(filterLevel), [filterLevel]);

  const focusEdgeSet = useMemo(() => {
    const loop = bundle.loops.find((l) => l.code === focusLoop);
    return new Set(loop?.edgeIds || []);
  }, [bundle.loops, focusLoop]);

  const fgData: FgData = useMemo(() => {
    const links = bundle.links.filter((l) => {
      if (edgeMode === "all") return true;
      if (edgeMode === "structure") return l.kind === "contain" || l.kind === "member";
      if (edgeMode === "causal") return l.kind === "causal";
      if (edgeMode === "rollup") return l.kind === "rollup";
      return true;
    });
    return {
      nodes: bundle.nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    };
  }, [bundle, edgeMode, tick]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, Math.floor(r.width)), h: Math.max(420, Math.floor(r.height)) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(320, Math.floor(r.width)), h: Math.max(420, Math.floor(r.height)) });
    return () => ro.disconnect();
  }, []);

  // 持续动画时钟：光晕 / 粒子节奏
  useEffect(() => {
    let alive = true;
    const step = () => {
      if (!alive) return;
      animRef.current = performance.now();
      setFrame((f) => (f + 1) % 1_000_000);
      requestAnimationFrame(step);
    };
    const id = requestAnimationFrame(step);
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, []);

  const triggerReveal = useCallback((label: string) => {
    revealAtRef.current = performance.now();
    flashAtRef.current = performance.now();
    setFlashLabel(label);
    window.setTimeout(() => setFlashLabel(""), 900);
  }, []);

  useEffect(() => {
    didFitRef.current = false;
    setSelected(null);
    setFocusLoop(null);
    const label =
      filterLevel === "all"
        ? edgeMode === "rollup"
          ? "上卷贯通"
          : edgeMode === "structure"
            ? "包含结构"
            : "全景"
        : `聚焦 · ${LEVEL_LABEL[filterLevel]}`;
    triggerReveal(label);
  }, [filterLevel, edgeMode, triggerReveal]);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const linkForce = fg.d3Force("link") as ReturnType<typeof forceLink> | undefined;
    linkForce?.distance((l) => {
      const kind = (l as unknown as LoopGLink).kind;
      if (kind === "contain") return 200;
      if (kind === "member") return 90;
      return 70;
    });
    linkForce?.strength((l) => {
      const kind = (l as unknown as LoopGLink).kind;
      if (kind === "contain") return 0.4;
      if (kind === "member") return 0.15;
      return 0.05;
    });
    fg.d3Force("charge")?.strength?.(-40);
    fg.d3Force(
      "collide",
      forceCollide((n: LoopGNode) => (n.kind === "hub" ? 36 : 22)),
    );
  }, [fgData]);

  const flyToLevel = useCallback((level: LoopLevel | "all", ms = 900) => {
    const fg = fgRef.current;
    if (!fg) return;
    if (level === "all") {
      fg.zoomToFit?.(ms, 70);
      return;
    }
    const x = COL_X[level];
    const hubs = fgData.nodes.filter((n) => n.level === level);
    const cy =
      hubs.length
        ? hubs.reduce((a, n) => a + (n.fy ?? n.y ?? 0), 0) / hubs.length
        : 200;
    fg.centerAt?.(x, cy, ms);
    fg.zoom?.(level === "sku" || level === "company" ? 1.65 : 1.85, ms);
  }, [fgData.nodes]);

  const fitOverview = useCallback(() => {
    flyToLevel("all", 700);
  }, [flyToLevel]);

  // 切换层级后镜头飞入
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (filterLevel === "all") {
        if (!didFitRef.current) {
          didFitRef.current = true;
          fitOverview();
        } else {
          fitOverview();
        }
      } else {
        didFitRef.current = true;
        flyToLevel(filterLevel, 1100);
      }
    }, 180);
    return () => window.clearTimeout(t);
  }, [filterLevel, edgeMode, fitOverview, flyToLevel, tick]);

  const stopTour = useCallback(() => {
    setTouring(false);
    if (tourTimerRef.current) {
      window.clearTimeout(tourTimerRef.current);
      tourTimerRef.current = null;
    }
  }, []);

  const startTour = useCallback(() => {
    stopTour();
    setTouring(true);
    setEdgeMode("structure");
    const sequence: (LoopLevel | "all")[] = ["all", ...LEVEL_ORDER, "all"];
    let i = 0;
    const play = () => {
      const lv = sequence[i];
      setFilterLevel(lv);
      if (lv === "all" && i === sequence.length - 1) {
        setEdgeMode("rollup");
        window.setTimeout(() => {
          setEdgeMode("all");
          setTouring(false);
        }, 1600);
        return;
      }
      i += 1;
      tourTimerRef.current = window.setTimeout(play, i === 1 ? 1400 : 1600);
    };
    play();
  }, [stopTour]);

  useEffect(() => () => stopTour(), [stopTour]);

  const neighborIds = useMemo(() => {
    const id = selected?.id || hoverNode?.id;
    if (!id) return null as Set<string> | null;
    const set = new Set<string>([id]);
    fgData.links.forEach((l) => {
      const { s, t } = linkEnds(l);
      if (s === id || t === id) {
        set.add(s);
        set.add(t);
      }
    });
    return set;
  }, [selected, hoverNode, fgData.links]);

  const focusLevelIdx = levelIndex(filterLevel);
  const now = animRef.current || performance.now();
  const revealT = Math.min(1, (now - revealAtRef.current) / 700);
  const reveal = easeOutCubic(revealT);
  const flashT = Math.min(1, (now - flashAtRef.current) / 850);
  void frame;

  const onChangeLevel = (v: LoopLevel | "all") => {
    stopTour();
    setFilterLevel(v);
  };

  const onChangeEdge = (v: EdgeMode) => {
    stopTour();
    setEdgeMode(v);
  };

  const paintNode = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as LoopGNode;
      const muted = Boolean(neighborIds && !neighborIds.has(n.id));
      const focusDim =
        focusLevelIdx >= 0 && n.level !== filterLevel
          ? 0.22
          : 1;
      const idx = LEVEL_ORDER.indexOf(n.level);
      const stagger = focusLevelIdx < 0 ? idx * 0.06 : 0;
      const appear = Math.max(0, Math.min(1, (reveal - stagger) / 0.55));
      const scale = 0.35 + 0.65 * easeOutCubic(appear);
      const alpha = (muted ? 0.35 : 1) * focusDim * (0.25 + 0.75 * appear);

      const baseR = Math.sqrt(Math.max(n.val, 4)) * 2.2;
      const r = baseR * scale;
      const x = n.x || 0;
      const y = n.y || 0;

      ctx.save();
      ctx.globalAlpha = alpha;

      // 选中 / Hub 呼吸光环
      const selectedHub = selected?.id === n.id || (n.kind === "hub" && filterLevel === n.level);
      if (selectedHub || n.kind === "hub") {
        const pulse = 0.5 + 0.5 * Math.sin(now / 420 + idx);
        const ringR = r + 4 + pulse * (n.kind === "hub" ? 10 : 5);
        ctx.beginPath();
        ctx.arc(x, y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = n.color;
        ctx.globalAlpha = alpha * (0.25 + 0.35 * pulse);
        ctx.lineWidth = (n.kind === "hub" ? 2.4 : 1.4) / globalScale;
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }

      // 主体
      const grd = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      grd.addColorStop(0, "#ffffff");
      grd.addColorStop(0.35, n.color);
      grd.addColorStop(1, n.color);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = muted ? "rgba(180,190,205,0.55)" : grd;
      ctx.fill();
      if (n.kind === "hub") {
        ctx.lineWidth = 2.2 / globalScale;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }

      // 标签
      const fontSize = Math.max(n.kind === "hub" ? 13 : 11, (n.kind === "hub" ? 14 : 11) / globalScale);
      ctx.font = `${n.kind === "hub" ? 700 : 600} ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = n.kind === "hub" ? n.name : `${n.code} ${n.name}`;
      const lines = wrapLabel(label, n.kind === "hub" ? 6 : 8);
      const baseY = y + r + 3;
      lines.forEach((line, i) => {
        const w = ctx.measureText(line).width;
        ctx.fillStyle = "rgba(245,247,251,0.9)";
        ctx.fillRect(x - w / 2 - 2, baseY + i * (fontSize + 2) - 1, w + 4, fontSize + 3);
        ctx.fillStyle = muted ? "rgba(90,100,120,0.55)" : "#0B2144";
        ctx.fillText(line, x, baseY + i * (fontSize + 2));
      });

      ctx.restore();
    },
    [neighborIds, focusLevelIdx, filterLevel, reveal, selected, now],
  );

  const sideLoops = useMemo(() => {
    if (filterLevel === "all") {
      return bundle.loops.filter((l) => l.level === "company" || l.level === "sku").slice(0, 10);
    }
    return bundle.loops.filter((l) => l.level === filterLevel);
  }, [bundle.loops, filterLevel]);

  const focusLoopByCode = (code: string) => {
    const loop = bundle.loops.find((l) => l.code === code);
    if (!loop?.edgeIds?.length) return;
    const ids = new Set<string>();
    bundle.links.forEach((l) => {
      if (!loop.edgeIds!.includes(l.id)) return;
      ids.add(typeof l.source === "string" ? l.source : l.source.id);
      ids.add(typeof l.target === "string" ? l.target : l.target.id);
    });
    window.setTimeout(() => {
      const nodes = (fgData.nodes || []).filter((n) => ids.has(n.id) && n.x != null);
      if (!nodes.length) {
        fitOverview();
        return;
      }
      const fg = fgRef.current;
      const cx = nodes.reduce((a, n) => a + (n.x || 0), 0) / nodes.length;
      const cy = nodes.reduce((a, n) => a + (n.y || 0), 0) / nodes.length;
      fg?.centerAt?.(cx, cy, 700);
      fg?.zoom?.(2.1, 700);
      triggerReveal(`回路 · ${loop.name}`);
    }, 120);
  };

  const particleCount = (l: object) => {
    const link = l as LoopGLink;
    if (link.kind === "member") return 0;
    if (edgeMode === "rollup" && link.kind === "rollup") return 5;
    if (edgeMode === "structure" && link.kind === "contain") return 4;
    if (link.kind === "contain") return 2;
    if (focusEdgeSet.size) return focusEdgeSet.has(link.id) ? 5 : 0;
    if (neighborIds) {
      const { s, t } = linkEnds(link);
      return neighborIds.has(s) && neighborIds.has(t) ? 4 : 0;
    }
    return link.kind === "rollup" ? 3 : 1;
  };

  return (
    <div className="loop-kg">
      <div className="loop-kg-toolbar">
        <Segmented
          size="small"
          value={filterLevel}
          onChange={(v) => onChangeLevel(v as LoopLevel | "all")}
          options={[
            { value: "all", label: "全图" },
            ...LEVEL_ORDER.map((lv) => ({ value: lv, label: LEVEL_LABEL[lv] })),
          ]}
        />
        <Space wrap size={8}>
          <Segmented
            size="small"
            value={edgeMode}
            onChange={(v) => onChangeEdge(v as EdgeMode)}
            options={[
              { value: "all", label: "全部边" },
              { value: "structure", label: "只看包含" },
              { value: "causal", label: "只看因果" },
              { value: "rollup", label: "只看上卷" },
            ]}
          />
          <Button
            size="small"
            type={touring ? "default" : "primary"}
            icon={touring ? <PauseCircleOutlined /> : <CaretRightOutlined />}
            onClick={() => (touring ? stopTour() : startTour())}
          >
            {touring ? "停止巡游" : "镜头巡游"}
          </Button>
          <Button size="small" icon={<AimOutlined />} onClick={fitOverview}>适应画布</Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => {
              didFitRef.current = false;
              setTick((t) => t + 1);
              triggerReveal("重新排布");
            }}
          >
            重置
          </Button>
        </Space>
      </div>

      <div className="loop-kg-legend">
        {LEVEL_ORDER.map((lv) => (
          <button
            key={lv}
            type="button"
            className={`loop-kg-leg-item is-btn${filterLevel === lv ? " is-active" : ""}`}
            onClick={() => onChangeLevel(filterLevel === lv ? "all" : lv)}
          >
            <i style={{ background: LEVEL_COLOR[lv] }} />
            {LEVEL_LABEL[lv]}
          </button>
        ))}
        <span className="loop-kg-leg-item"><b style={{ color: "#0B2144" }}>—</b> 包含</span>
        <span className="loop-kg-leg-item"><b style={{ color: "#C4924A" }}>—</b> 上卷</span>
      </div>

      <div className="loop-kg-body">
        <div className="loop-kg-canvas" ref={wrapRef}>
          <div
            className={`loop-kg-flash${flashLabel && flashT < 1 ? " is-on" : ""}`}
            style={{ opacity: flashLabel ? (1 - flashT) * 0.9 : 0 }}
          >
            <span>{flashLabel}</span>
          </div>
          <div className="loop-kg-vignette" />
          <Typography.Text type="secondary" className="loop-kg-hint">
            切换层级会镜头飞入该列；「镜头巡游」自动公司→SKU，再亮上卷金线。
          </Typography.Text>
          <ForceGraph2D
            ref={fgRef}
            width={size.w}
            height={size.h}
            graphData={fgData}
            backgroundColor="transparent"
            enableNodeDrag
            nodeId="id"
            nodeVal={(n) => (n as LoopGNode).val}
            nodeLabel={(n) => {
              const node = n as LoopGNode;
              const title = node.kind === "hub" ? `层级 · ${node.name}` : `${node.code} · ${node.name}`;
              return `<div style="padding:6px 10px;background:#fff;border:1px solid #d7e0ec;border-radius:8px;font-size:12px;color:#1a2740;max-width:280px;box-shadow:0 4px 16px rgba(26,39,64,0.12);">
                <b style="color:#0b2144">${title}</b><br/>
                <span style="color:#5c6b84">${node.levelLabel}${node.sub ? ` · ${node.sub}` : ""}</span>
              </div>`;
            }}
            nodeCanvasObjectMode={() => "replace"}
            nodeCanvasObject={paintNode}
            linkColor={(link) => {
              const l = link as LoopGLink;
              const { s, t } = linkEnds(l);
              if (focusEdgeSet.size && l.kind === "causal" && !focusEdgeSet.has(l.id)) {
                return "rgba(180,190,205,0.1)";
              }
              if (neighborIds && !neighborIds.has(s) && !neighborIds.has(t)) {
                return "rgba(180,190,205,0.08)";
              }
              if (focusLevelIdx >= 0) {
                const a = typeof l.source === "object" ? l.source.level : undefined;
                const b = typeof l.target === "object" ? l.target.level : undefined;
                if (a && b && a !== filterLevel && b !== filterLevel && l.kind !== "contain") {
                  return "rgba(180,190,205,0.08)";
                }
              }
              if (l.kind === "contain") return "#0B2144";
              if (l.kind === "member") return "rgba(92,107,132,0.28)";
              if (l.kind === "rollup") return "#C4924A";
              if (l.polarity === "-") return "#c53d3d";
              return "rgba(61,111,168,0.5)";
            }}
            linkWidth={(link) => {
              const l = link as LoopGLink;
              if (l.kind === "contain") return edgeMode === "structure" ? 4 : 3.2;
              if (focusEdgeSet.has(l.id)) return 2.8;
              if (l.kind === "rollup") return edgeMode === "rollup" ? 3 : 2;
              if (l.kind === "member") return 1;
              return 1.2;
            }}
            linkCurvature={0}
            linkDirectionalParticles={particleCount}
            linkDirectionalParticleWidth={(l) => ((l as LoopGLink).kind === "rollup" ? 3 : 2)}
            linkDirectionalParticleSpeed={0.006}
            linkDirectionalParticleColor={(l) => {
              const link = l as LoopGLink;
              if (link.kind === "contain") return "#0B2144";
              if (link.kind === "rollup") return "#C4924A";
              if (link.polarity === "-") return "#c53d3d";
              return "#8ab4ff";
            }}
            linkDirectionalArrowLength={(l) => ((l as LoopGLink).kind === "member" ? 3 : 5)}
            linkDirectionalArrowRelPos={0.9}
            linkDirectionalArrowColor={(l) => {
              const link = l as LoopGLink;
              if (link.kind === "contain") return "#0B2144";
              if (link.kind === "rollup") return "#C4924A";
              if (link.polarity === "-") return "#c53d3d";
              return "rgba(61,111,168,0.7)";
            }}
            linkCanvasObjectMode={() => "after"}
            linkCanvasObject={(link, ctx, globalScale) => {
              const l = link as LoopGLink;
              if (l.kind !== "contain" && l.kind !== "rollup") return;
              if (edgeMode === "causal") return;
              const src = typeof l.source === "object" ? l.source : null;
              const tgt = typeof l.target === "object" ? l.target : null;
              if (!src || !tgt || src.x == null || tgt.x == null) return;
              const x = ((src.x || 0) + (tgt.x || 0)) / 2;
              const y = ((src.y || 0) + (tgt.y || 0)) / 2 - 6;
              const fontSize = Math.max(10, 12 / globalScale);
              ctx.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              const text = l.label;
              const w = ctx.measureText(text).width;
              ctx.fillStyle = "rgba(255,255,255,0.92)";
              ctx.fillRect(x - w / 2 - 4, y - fontSize / 2 - 2, w + 8, fontSize + 4);
              ctx.fillStyle = l.kind === "contain" ? "#0B2144" : "#8A6A35";
              ctx.fillText(text, x, y);
            }}
            onNodeHover={(n) => {
              const id = (n as LoopGNode | null)?.id ?? null;
              if (hoverIdRef.current === id) return;
              hoverIdRef.current = id;
              setHoverNode((n as LoopGNode) || null);
            }}
            onNodeClick={(n) => {
              const node = n as LoopGNode;
              setSelected(node);
              if (node.kind === "hub") {
                onChangeLevel(filterLevel === node.level ? "all" : node.level);
              } else {
                flyToLevel(node.level, 800);
                triggerReveal(`${node.code} · ${node.name}`);
              }
            }}
            onBackgroundClick={() => {
              hoverIdRef.current = null;
              setHoverNode(null);
              setSelected(null);
            }}
            warmupTicks={30}
            cooldownTicks={50}
            d3AlphaDecay={0.06}
            d3VelocityDecay={0.42}
            onEngineStop={() => {
              if (didFitRef.current) return;
              didFitRef.current = true;
              fitOverview();
            }}
          />
        </div>

        <aside className="loop-kg-side">
          <Typography.Text strong>层级 ↔ Ontology</Typography.Text>
          <div className="loop-kg-map">
            {LEVEL_ORDER.map((lv) => {
              const ont = LOOP_LEVEL_ONTOLOGY[lv];
              return (
                <button
                  key={lv}
                  type="button"
                  className={`loop-kg-map-row is-btn${filterLevel === lv ? " is-active" : ""}`}
                  onClick={() => onChangeLevel(filterLevel === lv ? "all" : lv)}
                >
                  <span className="loop-kg-map-lv">{LEVEL_LABEL[lv]}</span>
                  <span className="loop-kg-map-ot">{ont.otype}</span>
                  <span className="loop-kg-map-key">{ont.typeKey}</span>
                </button>
              );
            })}
          </div>

          <Typography.Text strong style={{ display: "block", marginTop: 14 }}>选中说明</Typography.Text>
          {selected ? (
            <div className="loop-kg-detail">
              <div style={{ marginTop: 8 }}>
                <Tag color={selected.kind === "hub" ? "gold" : "default"}>
                  {selected.kind === "hub" ? "层级壳" : "指标"}
                </Tag>
                <Tag>{selected.levelLabel}</Tag>
                {selected.kind === "stock" ? <Tag color="blue">{selected.code}</Tag> : null}
              </div>
              <Typography.Title level={5} style={{ margin: "8px 0 4px" }}>
                {selected.name}
              </Typography.Title>
              {selected.sub ? (
                <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
                  {selected.sub}
                </Typography.Paragraph>
              ) : null}
              {selected.details?.length ? (
                <ul>{selected.details.map((d) => <li key={d}>{d}</li>)}</ul>
              ) : null}
              {selected.kind === "hub" ? (
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
                  再点一次该层可回到全图；「镜头巡游」可看完整飞行动画。
                </Typography.Paragraph>
              ) : null}
            </div>
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
              点顶部大球飞入该层级；点图例/右侧对照表同样触发镜头转换。
            </Typography.Paragraph>
          )}

          <Typography.Text strong style={{ display: "block", marginTop: 16 }}>代表回路</Typography.Text>
          <div className="loop-kg-loops">
            {sideLoops.map((loop) => (
              <button
                key={loop.code}
                type="button"
                className={`loop-kg-loop${focusLoop === loop.code ? " is-active" : ""}`}
                onClick={() => {
                  const next = focusLoop === loop.code ? null : loop.code;
                  setFocusLoop(next);
                  if (next) {
                    setEdgeMode("causal");
                    if (filterLevel !== "all" && filterLevel !== loop.level) {
                      setFilterLevel(loop.level);
                    }
                    focusLoopByCode(next);
                  }
                }}
              >
                <Tag color={loop.kind === "R" ? "orange" : loop.kind === "B" ? "blue" : "purple"}>
                  {loop.kind}
                </Tag>
                <span className="loop-kg-loop-name">{loop.name}</span>
                <span className="loop-kg-loop-path">{loop.path}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
