import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { forceCollide, forceLink } from "d3-force";
import {
  App, Button, Form, Input, Modal, Radio, Segmented, Select, Space, Tag, Typography,
} from "antd";
import {
  AimOutlined,
  CaretRightOutlined,
  DeleteOutlined,
  LinkOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import {
  buildLoopForceGraph,
  emptyCustomState,
  LEVEL_COLOR,
  loadLoopCustomState,
  nodeColorFor,
  ROW_Y,
  saveLoopCustomState,
  shadeLevelColor,
  type CustomCausalLink,
  type CustomStockNode,
  type LoopDataKind,
  type LoopGLink,
  type LoopGNode,
  type LoopGraphCustomState,
} from "../loopsHierarchy/forceGraphData";
import { LEVEL_LABEL, LEVEL_ORDER, type LoopLevel } from "../loopsHierarchy/types";
import { LOOP_LEVEL_ONTOLOGY } from "../loopsHierarchy/commerceLevels";
import { getCommerceFactsHealth, type FactTableHealth } from "../api/client";

type FgData = { nodes: LoopGNode[]; links: LoopGLink[] };
type EdgeMode = "all" | "causal" | "rollup";
type EditMode = "view" | "link";
type RollupChain = "sales" | "profit" | "resource" | "source";
type FactAvailability = FactTableHealth["status"];
type FgApi = ForceGraphMethods<LoopGNode, LoopGLink> & {
  centerAt?: (x: number, y: number, ms?: number) => void;
  zoom?: (z: number, ms?: number) => void;
  zoomToFit?: (ms?: number, padding?: number) => void;
};

const FACT_STATUS_META: Record<FactAvailability, { label: string; color: string; tag: string }> = {
  ok: { label: "已接入", color: "#15803d", tag: "green" },
  partial: { label: "部分接入", color: "#b45309", tag: "gold" },
  empty: { label: "表空无数据", color: "#b45309", tag: "orange" },
  missing: { label: "数据缺失", color: "#b91c1c", tag: "red" },
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

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

const CHAIN_META: Record<RollupChain, { name: string; desc: string; color: string }> = {
  sales: { name: "销售上卷链", desc: "订单事实一路汇总到公司终端销售额", color: "#B8863B" },
  profit: { name: "利润上卷链", desc: "SKU 利润逐层汇总到品牌利润池", color: "#9A6B2F" },
  resource: { name: "资源上卷链", desc: "库存与资金占用逐层汇总到运营资源健康", color: "#C4924A" },
  source: { name: "基础数据支撑", desc: "退款、推广、价盘、成本及费用事实支撑 SKU 指标", color: "#64748B" },
};

const CHAIN_PATH_IDS: Partial<Record<RollupChain, string[]>> = {
  sales: ["fact:f1", "sku:k3", "link:l4", "channel:c2", "platform:p3", "brand:b3", "company:s4"],
  profit: ["sku:k11", "link:l7", "channel:c3", "platform:p5", "brand:b4"],
  resource: ["fact:f5", "sku:k13", "channel:c5", "platform:p6", "brand:b7", "company:s8"],
};

function rollupChainOf(link: LoopGLink): RollupChain | null {
  const chain = link.chains.find((value) => value in CHAIN_META);
  return chain ? (chain as RollupChain) : null;
}

export default function LoopForceGraph() {
  const { message, modal } = App.useApp();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<FgApi | undefined>(undefined);
  const didFitRef = useRef(false);
  const hoverIdRef = useRef<string | null>(null);
  const animRef = useRef(0);
  const revealAtRef = useRef(performance.now());
  const flashAtRef = useRef(0);
  const tourTimerRef = useRef<number | null>(null);
  const customRef = useRef<LoopGraphCustomState>(loadLoopCustomState());
  const linkFromRef = useRef<string | null>(null);

  const [size, setSize] = useState({ w: 800, h: 560 });
  const [filterLevel, setFilterLevel] = useState<LoopLevel | "all">("all");
  const [edgeMode, setEdgeMode] = useState<EdgeMode>("all");
  const [selected, setSelected] = useState<LoopGNode | null>(null);
  const [hoverNode, setHoverNode] = useState<LoopGNode | null>(null);
  const [focusLoop, setFocusLoop] = useState<string | null>(null);
  const [focusChain, setFocusChain] = useState<RollupChain | null>(null);
  const [tick, setTick] = useState(0);
  const [frame, setFrame] = useState(0);
  const [touring, setTouring] = useState(false);
  const [flashLabel, setFlashLabel] = useState("");
  const [custom, setCustom] = useState<LoopGraphCustomState>(() => loadLoopCustomState());
  const [editMode, setEditMode] = useState<EditMode>("view");
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [factHealth, setFactHealth] = useState<FactTableHealth[]>([]);
  const [factSummary, setFactSummary] = useState<{ total: number; ok: number; partial: number; missing: number } | null>(null);
  const [addForm] = Form.useForm<{
    level: LoopLevel;
    code: string;
    name: string;
    sub?: string;
    dataKind: LoopDataKind;
  }>();

  customRef.current = custom;
  linkFromRef.current = linkFrom;

  useEffect(() => {
    let alive = true;
    getCommerceFactsHealth()
      .then((h) => {
        if (!alive) return;
        setFactHealth(h.facts || []);
        setFactSummary(h.facts_summary || null);
      })
      .catch(() => {
        if (!alive) return;
        setFactHealth([]);
        setFactSummary(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const factById = useMemo(() => {
    const m = new Map<string, FactTableHealth>();
    factHealth.forEach((f) => m.set(f.id, f));
    return m;
  }, [factHealth]);

  const factStatusOf = useCallback((node: LoopGNode): FactTableHealth | null => {
    if (node.level !== "fact" || node.kind !== "stock") return null;
    const sid = node.id.includes(":") ? node.id.split(":").pop()! : node.id;
    return factById.get(sid) || factById.get(node.code.toLowerCase()) || null;
  }, [factById]);

  // 仅结构变化时重建图谱；拖拽只改 positions，避免整图重算导致“一松手就还原”
  const bundle = useMemo(
    () => buildLoopForceGraph(filterLevel, custom),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- positions 由拖拽直接钉在节点上
    [filterLevel, custom.stocks, custom.links, tick],
  );

  const focusEdgeSet = useMemo(() => {
    const loop = bundle.loops.find((l) => l.code === focusLoop);
    return new Set(loop?.edgeIds || []);
  }, [bundle.loops, focusLoop]);

  const chainEdgeSet = useMemo(() => {
    if (!focusChain) return new Set<string>();
    return new Set(
      bundle.links
        .filter((l) => l.kind === "rollup" && l.chains.includes(focusChain))
        .map((l) => l.id),
    );
  }, [bundle.links, focusChain]);

  const chainNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!focusChain) return ids;
    bundle.links.forEach((l) => {
      if (l.kind !== "rollup" || !l.chains.includes(focusChain)) return;
      const { s, t } = linkEnds(l);
      ids.add(s);
      ids.add(t);
    });
    return ids;
  }, [bundle.links, focusChain]);

  const chainSteps = useMemo(() => {
    if (!focusChain) return [];
    const preferred = CHAIN_PATH_IDS[focusChain];
    if (preferred) {
      return preferred
        .map((id) => bundle.nodes.find((node) => node.id === id))
        .filter((node): node is LoopGNode => Boolean(node));
    }
    return [...LEVEL_ORDER]
      .reverse()
      .map((level) => bundle.nodes.find((n) => n.level === level && chainNodeIds.has(n.id)))
      .filter((n): n is LoopGNode => Boolean(n));
  }, [bundle.nodes, chainNodeIds, focusChain]);

  const fgData: FgData = useMemo(() => {
    const links = bundle.links.filter((l) => {
      if (edgeMode === "all") return true;
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
    if (filterLevel !== "all") setFocusChain(null);
    const label =
      filterLevel === "all"
        ? edgeMode === "rollup"
          ? "上卷贯通"
          : edgeMode === "causal"
            ? "层内因果"
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
      if (kind === "rollup") return 200;
      return 110;
    });
    linkForce?.strength((l) => {
      const kind = (l as unknown as LoopGLink).kind;
      if (kind === "rollup") return 0.04;
      return 0.08;
    });
    fg.d3Force("charge")?.strength?.(-28);
    fg.d3Force(
      "collide",
      forceCollide(() => 28),
    );
  }, [fgData]);

  const flyToLevel = useCallback((level: LoopLevel | "all", ms = 900) => {
    const fg = fgRef.current;
    if (!fg) return;
    if (level === "all") {
      fg.zoomToFit?.(ms, 70);
      return;
    }
    const y = ROW_Y[level];
    const hubs = fgData.nodes.filter((n) => n.level === level);
    const cx =
      hubs.length
        ? hubs.reduce((a, n) => a + (n.fx ?? n.x ?? 0), 0) / hubs.length
        : 320;
    fg.centerAt?.(cx, y, ms);
    fg.zoom?.(level === "sku" || level === "fact" || level === "company" ? 1.55 : 1.75, ms);
  }, [fgData.nodes]);

  const fitOverview = useCallback(() => {
    flyToLevel("all", 700);
  }, [flyToLevel]);

  const flyToLevelRef = useRef(flyToLevel);
  const fitOverviewRef = useRef(fitOverview);
  flyToLevelRef.current = flyToLevel;
  fitOverviewRef.current = fitOverview;

  // 只在层级/边模式/显式 tick 时适配镜头，拖拽改坐标不触发 zoomToFit
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (filterLevel === "all") {
        didFitRef.current = true;
        fitOverviewRef.current();
      } else {
        didFitRef.current = true;
        flyToLevelRef.current(filterLevel, 1100);
      }
    }, 180);
    return () => window.clearTimeout(t);
  }, [filterLevel, edgeMode, tick]);

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
    setEdgeMode("causal");
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

  const markDirty = useCallback((next: LoopGraphCustomState) => {
    setCustom(next);
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    setSaving(true);
    try {
      // 同步拖拽后的坐标
      const positions = { ...customRef.current.positions };
      fgData.nodes.forEach((n) => {
        if (n.x == null || n.y == null) return;
        positions[n.id] = { x: n.x, y: n.y };
      });
      const next: LoopGraphCustomState = { ...customRef.current, positions };
      saveLoopCustomState(next);
      setCustom(next);
      setDirty(false);
      message.success("回路图谱已保存到本机");
      triggerReveal("已保存");
    } catch {
      message.error("保存失败");
    } finally {
      setSaving(false);
    }
  }, [fgData.nodes, message, triggerReveal]);

  const handleAddNode = async () => {
    try {
      const values = await addForm.validateFields();
      const stockId = values.code.trim().toLowerCase().replace(/\s+/g, "_");
      const idFull = `${values.level}:${stockId}`;
      if (fgData.nodes.some((n) => n.id === idFull || n.code === values.code.trim())) {
        message.warning("该编码已存在");
        return;
      }
      const stock: CustomStockNode = {
        id: idFull,
        level: values.level,
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        sub: values.sub?.trim() || undefined,
        dataKind: values.dataKind,
      };
      markDirty({
        ...custom,
        stocks: [...custom.stocks, stock],
      });
      setAddOpen(false);
      addForm.resetFields();
      setFilterLevel(values.level);
      setTick((t) => t + 1);
      message.success(`已加入节点 ${stock.code}`);
      triggerReveal(`新增 · ${stock.code}`);
    } catch {
      /* validate */
    }
  };

  const handleDeleteSelected = () => {
    if (!selected) return;
    if (selected.kind === "hub") {
      message.info("层级壳不可删除");
      return;
    }
    if (!selected.custom) {
      modal.confirm({
        title: "隐藏内置节点？",
        content: "内置节点暂不支持删除，可拖动位置后保存；自定义节点才可删除。",
        okText: "知道了",
        cancelButtonProps: { style: { display: "none" } },
      });
      return;
    }
    modal.confirm({
      title: `删除节点 ${selected.code}？`,
      content: "将同时移除与它相连的自定义连线。",
      okText: "删除",
      okButtonProps: { danger: true },
      onOk: () => {
        const id = selected.id;
        const positions = { ...custom.positions };
        delete positions[id];
        markDirty({
          ...custom,
          stocks: custom.stocks.filter((s) => s.id !== id),
          links: custom.links.filter((l) => l.source !== id && l.target !== id),
          positions,
        });
        setSelected(null);
        setTick((t) => t + 1);
        message.success("已删除");
      },
    });
  };

  const finishLink = (fromId: string, toId: string) => {
    if (fromId === toId) {
      message.warning("不能连到自身");
      return;
    }
    const exists = fgData.links.some((l) => {
      const { s, t } = linkEnds(l);
      return (s === fromId && t === toId) || (s === toId && t === fromId);
    });
    if (exists) {
      message.warning("这两点之间已有连线");
      setLinkFrom(null);
      return;
    }
    const link: CustomCausalLink = {
      id: uid("cl"),
      source: fromId,
      target: toId,
      label: "自定义",
      polarity: "+",
    };
    markDirty({
      ...custom,
      links: [...custom.links, link],
    });
    setLinkFrom(null);
    setEditMode("view");
    setTick((t) => t + 1);
    message.success("已添加连线（记得点保存）");
    triggerReveal("新连线");
  };

  const onChangeLevel = (v: LoopLevel | "all") => {
    stopTour();
    setFilterLevel(v);
  };

  const onChangeEdge = (v: EdgeMode) => {
    stopTour();
    setEdgeMode(v);
    if (v === "causal") setFocusChain(null);
  };

  const focusRollupChain = useCallback((chain: RollupChain) => {
    const next = focusChain === chain ? null : chain;
    setFocusChain(next);
    setFocusLoop(null);
    setSelected(null);
    setEdgeMode("all");
    if (!next) {
      fitOverview();
      return;
    }
    const nextNodeIds = new Set<string>();
    bundle.links.forEach((l) => {
      if (l.kind !== "rollup" || !l.chains.includes(next)) return;
      const { s, t } = linkEnds(l);
      nextNodeIds.add(s);
      nextNodeIds.add(t);
    });
    window.setTimeout(() => {
      const nodes = fgData.nodes.filter(
        (n) => nextNodeIds.has(n.id) && n.x != null && n.y != null,
      );
      if (!nodes.length) return;
      const minX = Math.min(...nodes.map((n) => n.x || 0));
      const maxX = Math.max(...nodes.map((n) => n.x || 0));
      const minY = Math.min(...nodes.map((n) => n.y || 0));
      const maxY = Math.max(...nodes.map((n) => n.y || 0));
      fgRef.current?.centerAt?.((minX + maxX) / 2, (minY + maxY) / 2, 600);
      const worldW = Math.max(280, maxX - minX + 240);
      const worldH = Math.max(360, maxY - minY + 180);
      const zoom = Math.min(size.w / worldW, size.h / worldH) * 0.9;
      fgRef.current?.zoom?.(Math.max(0.65, Math.min(2.1, zoom)), 600);
      triggerReveal(CHAIN_META[next].name);
    }, 80);
  }, [
    bundle.links,
    fgData.nodes,
    fitOverview,
    focusChain,
    size.h,
    size.w,
    triggerReveal,
  ]);

  const paintNode = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as LoopGNode;
      const muted = focusChain
        ? !chainNodeIds.has(n.id)
        : Boolean(neighborIds && !neighborIds.has(n.id));
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
      const r = Math.max(1.2, baseR * scale);
      const x = n.x || 0;
      const y = n.y || 0;
      const linking = editMode === "link" && linkFrom === n.id;

      ctx.save();
      ctx.globalAlpha = alpha;

      const selectedHub = selected?.id === n.id || (n.kind === "hub" && filterLevel === n.level);
      if (selectedHub || n.kind === "hub" || linking) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 420 + idx);
        const ringR = Math.max(r + 1, r + 4 + pulse * (n.kind === "hub" ? 10 : 5));
        ctx.beginPath();
        ctx.arc(x, y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = linking ? "#C4924A" : n.color;
        ctx.globalAlpha = alpha * (0.25 + 0.35 * pulse);
        ctx.lineWidth = (n.kind === "hub" || linking ? 2.4 : 1.4) / Math.max(globalScale, 0.25);
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }

      // 基础=浅、衍生=深
      const fill = n.color;
      const grd = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, Math.max(0.2, r * 0.1), x, y, r);
      if (n.kind === "hub") {
        grd.addColorStop(0, "#ffffff");
        grd.addColorStop(0.35, fill);
        grd.addColorStop(1, fill);
      } else if (n.dataKind === "fact") {
        grd.addColorStop(0, "#ffffff");
        grd.addColorStop(0.45, shadeLevelColor(LEVEL_COLOR[n.level], 0.12));
        grd.addColorStop(1, fill);
      } else {
        grd.addColorStop(0, shadeLevelColor(LEVEL_COLOR[n.level], 0.35));
        grd.addColorStop(0.55, fill);
        grd.addColorStop(1, shadeLevelColor(LEVEL_COLOR[n.level], 0.95));
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = muted ? "rgba(180,190,205,0.55)" : grd;
      ctx.fill();
      if (n.kind === "hub" || n.custom) {
        ctx.lineWidth = (n.custom ? 1.6 : 2.2) / Math.max(globalScale, 0.25);
        ctx.strokeStyle = n.custom ? "#C4924A" : "#fff";
        ctx.stroke();
      }
      // 衍生节点外圈更深一圈提示（缩放时避免半径为负）
      if (n.kind === "stock" && n.dataKind === "derived" && !muted) {
        const inset = Math.min(r * 0.35, 1.5 / Math.max(globalScale, 0.5));
        const innerR = Math.max(0.5, r - inset);
        ctx.beginPath();
        ctx.arc(x, y, innerR, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = 1.2 / Math.max(globalScale, 0.25);
        ctx.stroke();
      }

      const factAvail = factStatusOf(n);
      if (factAvail && !muted) {
        const meta = FACT_STATUS_META[factAvail.status];
        ctx.beginPath();
        ctx.arc(x, y, r + 2.2 / Math.max(globalScale, 0.25), 0, Math.PI * 2);
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = (factAvail.status === "ok" ? 1.2 : 2) / Math.max(globalScale, 0.25);
        if (factAvail.status === "missing" || factAvail.status === "empty") {
          ctx.setLineDash([3.5 / Math.max(globalScale, 0.25), 3 / Math.max(globalScale, 0.25)]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const fontSize = Math.max(n.kind === "hub" ? 13 : 11, (n.kind === "hub" ? 14 : 11) / globalScale);
      ctx.font = `${n.kind === "hub" ? 700 : 600} ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = n.kind === "hub" ? n.name : `${n.code} ${n.name}`;
      const lines = wrapLabel(label, n.kind === "hub" ? 8 : 8);
      const baseY = y + r + 3;
      lines.forEach((line, i) => {
        const w = ctx.measureText(line).width;
        ctx.fillStyle = "rgba(245,247,251,0.9)";
        ctx.fillRect(x - w / 2 - 2, baseY + i * (fontSize + 2) - 1, w + 4, fontSize + 3);
        ctx.fillStyle = muted ? "rgba(90,100,120,0.55)" : "#0B2144";
        ctx.fillText(line, x, baseY + i * (fontSize + 2));
      });
      if (factAvail && (factAvail.status === "missing" || factAvail.status === "empty" || factAvail.status === "partial")) {
        const badge = FACT_STATUS_META[factAvail.status].label;
        const badgeSize = Math.max(9, 10 / globalScale);
        ctx.font = `600 ${badgeSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
        const bw = ctx.measureText(badge).width;
        const by = baseY + lines.length * (fontSize + 2) + 2;
        ctx.fillStyle = "rgba(255,255,255,0.94)";
        ctx.fillRect(x - bw / 2 - 3, by - 1, bw + 6, badgeSize + 3);
        ctx.fillStyle = FACT_STATUS_META[factAvail.status].color;
        ctx.fillText(badge, x, by);
      }

      ctx.restore();
    },
    [
      neighborIds,
      focusLevelIdx,
      filterLevel,
      reveal,
      selected,
      now,
      editMode,
      linkFrom,
      focusChain,
      chainNodeIds,
      factStatusOf,
    ],
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
    if (link.kind === "member" || link.kind === "contain") return 0;
    if (focusChain) return chainEdgeSet.has(link.id) ? 5 : 0;
    if (edgeMode === "rollup" && link.kind === "rollup") return 4;
    if (link.kind === "rollup") return 2;
    if (focusEdgeSet.size) return focusEdgeSet.has(link.id) ? 4 : 0;
    if (neighborIds) {
      const { s, t } = linkEnds(link);
      return neighborIds.has(s) && neighborIds.has(t) ? 3 : 0;
    }
    return 1;
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
              { value: "all", label: "因果+上卷" },
              { value: "causal", label: "层内因果" },
              { value: "rollup", label: "只看上卷" },
            ]}
          />
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              stopTour();
              addForm.setFieldsValue({
                level: filterLevel === "all" ? "sku" : filterLevel,
                dataKind: "fact",
                code: "",
                name: "",
                sub: "",
              });
              setAddOpen(true);
            }}
          >
            加节点
          </Button>
          <Button
            size="small"
            type={editMode === "link" ? "primary" : "default"}
            icon={<LinkOutlined />}
            onClick={() => {
              stopTour();
              if (editMode === "link") {
                setEditMode("view");
                setLinkFrom(null);
              } else {
                setEditMode("link");
                setLinkFrom(null);
                message.info("连线模式：先点起点，再点终点");
              }
            }}
          >
            {editMode === "link" ? (linkFrom ? "再选终点…" : "选起点…") : "连线"}
          </Button>
          <Button
            size="small"
            danger
            disabled={!selected || selected.kind === "hub" || !selected.custom}
            icon={<DeleteOutlined />}
            onClick={handleDeleteSelected}
          >
            删除
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
          >
            保存{dirty ? " *" : ""}
          </Button>
          <Button
            size="small"
            type={touring ? "default" : "default"}
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
              modal.confirm({
                title: "重置自定义？",
                content: "将清除本机保存的自定义节点、连线与位置，恢复默认自上而下布局。",
                okText: "重置",
                okButtonProps: { danger: true },
                onOk: () => {
                  const empty = emptyCustomState();
                  saveLoopCustomState(empty);
                  setCustom(empty);
                  setDirty(false);
                  didFitRef.current = false;
                  setTick((t) => t + 1);
                  triggerReveal("已重置");
                },
              });
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
        <span className="loop-kg-leg-item">
          <i style={{ background: shadeLevelColor("#3D6FA8", 0.08), border: "1px solid #3D6FA8" }} />
          基础数据（浅）
        </span>
        <span className="loop-kg-leg-item">
          <i style={{ background: shadeLevelColor("#3D6FA8", 0.9) }} />
          衍生数据（深）
        </span>
        <span className="loop-kg-leg-item"><b style={{ color: "#15803d" }}>●</b> 已接入</span>
        <span className="loop-kg-leg-item"><b style={{ color: "#b45309" }}>◌</b> 部分接入</span>
        <span className="loop-kg-leg-item"><b style={{ color: "#b91c1c" }}>◌</b> 数据缺失</span>
        {factSummary ? (
          <span className="loop-kg-leg-item" style={{ opacity: 0.85 }}>
            F1–F8 · 接入{factSummary.ok}/部分{factSummary.partial}/缺失{factSummary.missing}
          </span>
        ) : null}
        <span className="loop-kg-leg-item"><b style={{ color: "#3D6FA8" }}>—</b> 层内因果</span>
        <span className="loop-kg-leg-item"><b style={{ color: "#C4924A" }}>—</b> 上卷</span>
        <span className="loop-kg-legend-divider" />
        {(["sales", "profit", "resource"] as RollupChain[]).map((chain) => (
          <button
            key={chain}
            type="button"
            className={`loop-kg-chain-chip${focusChain === chain ? " is-active" : ""}`}
            aria-pressed={focusChain === chain}
            onClick={() => focusRollupChain(chain)}
          >
            <i style={{ background: CHAIN_META[chain].color }} />
            {CHAIN_META[chain].name}
          </button>
        ))}
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
            点击任意金色跨层线可查看整条链路；再次点击取消。浅=基础、深=衍生。
            {editMode === "link" ? " 【连线中】" : ""}
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
              const kindLabel = node.kind === "hub" ? "层级壳" : node.dataKind === "fact" ? "基础数据" : "衍生数据";
              return `<div style="padding:6px 10px;background:#fff;border:1px solid #d7e0ec;border-radius:8px;font-size:12px;color:#1a2740;max-width:280px;box-shadow:0 4px 16px rgba(26,39,64,0.12);">
                <b style="color:#0b2144">${title}</b><br/>
                <span style="color:#5c6b84">${node.levelLabel} · ${kindLabel}${node.sub ? ` · ${node.sub}` : ""}${node.custom ? " · 自定义" : ""}</span>
              </div>`;
            }}
            nodeCanvasObjectMode={() => "replace"}
            nodeCanvasObject={paintNode}
            linkColor={(link) => {
              const l = link as LoopGLink;
              const { s, t } = linkEnds(l);
              if (focusChain) {
                return chainEdgeSet.has(l.id)
                  ? CHAIN_META[focusChain].color
                  : "rgba(148,163,184,0.08)";
              }
              if (focusEdgeSet.size && l.kind === "causal" && !focusEdgeSet.has(l.id)) {
                return "rgba(180,190,205,0.1)";
              }
              if (neighborIds && !neighborIds.has(s) && !neighborIds.has(t)) {
                return "rgba(180,190,205,0.08)";
              }
              if (focusLevelIdx >= 0) {
                const a = typeof l.source === "object" ? l.source.level : undefined;
                const b = typeof l.target === "object" ? l.target.level : undefined;
                if (a && b && a !== filterLevel && b !== filterLevel) {
                  return "rgba(180,190,205,0.08)";
                }
              }
              if (l.custom) return "#C4924A";
              if (l.kind === "rollup") return edgeMode === "causal" ? "rgba(196,146,74,0)" : "#C4924A";
              if (l.polarity === "-") return "#c53d3d";
              return "rgba(61,111,168,0.42)";
            }}
            linkWidth={(link) => {
              const l = link as LoopGLink;
              if (focusChain) return chainEdgeSet.has(l.id) ? 4.2 : 0.6;
              if (l.custom) return 2.2;
              if (focusEdgeSet.has(l.id)) return 2.6;
              if (l.kind === "rollup") return edgeMode === "rollup" ? 2.6 : 2.0;
              return 1.15;
            }}
            linkCurvature={0}
            linkDirectionalParticles={particleCount}
            linkDirectionalParticleWidth={(l) => ((l as LoopGLink).kind === "rollup" ? 3 : 2)}
            linkDirectionalParticleSpeed={0.006}
            linkDirectionalParticleColor={(l) => {
              const link = l as LoopGLink;
              if (focusChain && chainEdgeSet.has(link.id)) return CHAIN_META[focusChain].color;
              if (link.kind === "rollup" || link.custom) return "#C4924A";
              if (link.polarity === "-") return "#c53d3d";
              return "#8ab4ff";
            }}
            linkDirectionalArrowLength={5}
            linkDirectionalArrowRelPos={0.9}
            linkDirectionalArrowColor={(l) => {
              const link = l as LoopGLink;
              if (link.kind === "rollup" || link.custom) return "#C4924A";
              if (link.polarity === "-") return "#c53d3d";
              return "rgba(61,111,168,0.7)";
            }}
            linkCanvasObjectMode={() => "after"}
            linkCanvasObject={(link, ctx, globalScale) => {
              const l = link as LoopGLink;
              // 默认保持简洁；选中链路后展示该链全部边标签
              if (
                l.kind !== "rollup"
                || edgeMode === "causal"
                || (focusChain && !chainEdgeSet.has(l.id))
                || (!focusChain && edgeMode !== "rollup")
              ) return;
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
              ctx.fillStyle = "#8A6A35";
              ctx.fillText(text, x, y);
            }}
            onLinkClick={(link) => {
              const chain = rollupChainOf(link as LoopGLink);
              if (chain) focusRollupChain(chain);
            }}
            linkPointerAreaPaint={(link, color, ctx) => {
              const l = link as LoopGLink;
              if (l.kind !== "rollup") return;
              const src = typeof l.source === "object" ? l.source : null;
              const tgt = typeof l.target === "object" ? l.target : null;
              if (!src || !tgt || src.x == null || src.y == null || tgt.x == null || tgt.y == null) return;
              ctx.strokeStyle = color;
              ctx.lineWidth = 18;
              ctx.beginPath();
              ctx.moveTo(src.x, src.y);
              ctx.lineTo(tgt.x, tgt.y);
              ctx.stroke();
            }}
            onRenderFramePre={(ctx, globalScale) => {
              // 仅用轻量分隔线标识层级，避免大面积白色泳道框遮挡图谱
              const fontSize = Math.max(12, 14 / globalScale);
              ctx.save();
              ctx.font = `700 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
              ctx.textAlign = "right";
              ctx.textBaseline = "middle";
              LEVEL_ORDER.forEach((lv) => {
                if (filterLevel !== "all" && filterLevel !== lv) return;
                const y = ROW_Y[lv];
                const label = LEVEL_LABEL[lv];
                ctx.fillStyle = LEVEL_COLOR[lv];
                ctx.fillText(label, -36, y);
                ctx.strokeStyle = "rgba(148,163,184,0.28)";
                ctx.lineWidth = Math.max(0.5, 0.8 / Math.max(globalScale, 0.25));
                ctx.setLineDash([4 / Math.max(globalScale, 0.25), 7 / Math.max(globalScale, 0.25)]);
                ctx.beginPath();
                ctx.moveTo(-4, y);
                ctx.lineTo(1400, y);
                ctx.stroke();
              });
              ctx.restore();
            }}
            onNodeDrag={(n) => {
              const node = n as LoopGNode;
              if (node.x == null || node.y == null) return;
              // 拖拽过程中钉住，避免力导向把节点拽回去
              node.fx = node.x;
              node.fy = node.y;
            }}
            onNodeDragEnd={(n) => {
              const node = n as LoopGNode;
              if (node.x == null || node.y == null) return;
              node.fx = node.x;
              node.fy = node.y;
              // 只更新 positions，不 bump tick / 不重建 graphData
              const next: LoopGraphCustomState = {
                ...customRef.current,
                positions: {
                  ...customRef.current.positions,
                  [node.id]: { x: node.x, y: node.y },
                },
              };
              customRef.current = next;
              setCustom(next);
              setDirty(true);
            }}
            onNodeHover={(n) => {
              const id = (n as LoopGNode | null)?.id ?? null;
              if (hoverIdRef.current === id) return;
              hoverIdRef.current = id;
              setHoverNode((n as LoopGNode) || null);
            }}
            onNodeClick={(n) => {
              const node = n as LoopGNode;
              if (editMode === "link") {
                const from = linkFromRef.current;
                if (!from) {
                  setLinkFrom(node.id);
                  setSelected(node);
                  message.info(`起点：${node.code || node.name}，请再点终点`);
                  return;
                }
                finishLink(from, node.id);
                return;
              }
              setFocusChain(null);
              setSelected(node);
              flyToLevel(node.level, 800);
              triggerReveal(`${node.code} · ${node.name}`);
            }}
            onBackgroundClick={() => {
              hoverIdRef.current = null;
              setHoverNode(null);
              setSelected(null);
              if (editMode === "link") {
                setLinkFrom(null);
              }
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
          <Typography.Text strong>层级 ↔ Ontology（上→下）</Typography.Text>
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

          {factHealth.length ? (
            <>
              <Typography.Text strong style={{ display: "block", marginTop: 14 }}>
                基础数据接入
              </Typography.Text>
              <div className="loop-kg-map" style={{ marginTop: 6 }}>
                {factHealth.map((f) => {
                  const meta = FACT_STATUS_META[f.status];
                  return (
                    <button
                      key={f.id}
                      type="button"
                      className="loop-kg-map-row is-btn"
                      onClick={() => {
                        onChangeLevel("fact");
                        const node = fgData.nodes.find((n) => n.id === `fact:${f.id}` || n.code === f.code);
                        if (node) setSelected(node);
                        triggerReveal(`${f.code} · ${meta.label}`);
                      }}
                    >
                      <span className="loop-kg-map-lv" style={{ color: meta.color }}>{f.code}</span>
                      <span className="loop-kg-map-ot">{f.name}</span>
                      <span className="loop-kg-map-key" style={{ color: meta.color }}>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {focusChain ? (
            <div className="loop-kg-chain-detail">
              <Space align="center" style={{ width: "100%", justifyContent: "space-between" }}>
                <Typography.Text strong>{CHAIN_META[focusChain].name}</Typography.Text>
                <Button size="small" type="text" onClick={() => focusRollupChain(focusChain)}>
                  退出聚焦
                </Button>
              </Space>
              <Typography.Paragraph type="secondary" style={{ margin: "4px 0 10px", fontSize: 12 }}>
                {CHAIN_META[focusChain].desc}
              </Typography.Paragraph>
              <div className="loop-kg-chain-steps">
                {chainSteps.map((node, index) => (
                  <div className="loop-kg-chain-step" key={node.id}>
                    <span style={{ borderColor: LEVEL_COLOR[node.level], color: LEVEL_COLOR[node.level] }}>
                      {node.code}
                    </span>
                    <div>
                      <small>{node.levelLabel}</small>
                      <b>{node.name}</b>
                    </div>
                    {index < chainSteps.length - 1 ? <i>↑</i> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <Typography.Text strong style={{ display: "block", marginTop: 14 }}>选中说明</Typography.Text>
          {selected ? (
            <div className="loop-kg-detail">
              <div style={{ marginTop: 8 }}>
                <Tag color={selected.kind === "hub" ? "gold" : selected.dataKind === "fact" ? "blue" : "purple"}>
                  {selected.kind === "hub" ? "层级壳" : selected.dataKind === "fact" ? "基础·浅" : "衍生·深"}
                </Tag>
                <Tag>{selected.levelLabel}</Tag>
                {selected.kind === "stock" ? <Tag color="blue">{selected.code}</Tag> : null}
                {selected.custom ? <Tag color="gold">自定义</Tag> : null}
                {(() => {
                  const fh = factStatusOf(selected);
                  if (!fh) return null;
                  const meta = FACT_STATUS_META[fh.status];
                  return <Tag color={meta.tag}>{meta.label}</Tag>;
                })()}
              </div>
              <Typography.Title level={5} style={{ margin: "8px 0 4px" }}>
                {selected.name}
              </Typography.Title>
              {selected.sub ? (
                <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
                  {selected.sub}
                </Typography.Paragraph>
              ) : null}
              {(() => {
                const fh = factStatusOf(selected);
                if (!fh) return null;
                return (
                  <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.6 }}>
                    <div>
                      <Typography.Text type="secondary">数据源 </Typography.Text>
                      {fh.source || "—"}
                    </div>
                    <div>
                      <Typography.Text type="secondary">粒度 </Typography.Text>
                      {fh.grain || "—"}
                    </div>
                    <div>
                      <Typography.Text type="secondary">行数 </Typography.Text>
                      {fh.rows == null ? "—" : fh.rows}
                    </div>
                    <div>
                      <Typography.Text type="secondary">命中表 </Typography.Text>
                      {fh.matched_tables.length
                        ? fh.matched_tables.map((t) => t.table).join(", ")
                        : "无"}
                    </div>
                    <Typography.Paragraph
                      style={{
                        margin: "8px 0 0",
                        fontSize: 12,
                        color: FACT_STATUS_META[fh.status].color,
                      }}
                    >
                      {fh.note}
                    </Typography.Paragraph>
                  </div>
                );
              })()}
              {selected.details?.length ? (
                <ul>{selected.details.map((d) => <li key={d}>{d}</li>)}</ul>
              ) : null}
              {selected.kind === "hub" ? (
                <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
                  再点一次该层可回到全图；布局已改为自上而下。
                </Typography.Paragraph>
              ) : null}
            </div>
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
              点层级球飞入该行；浅色为基础数据，深色为衍生计算。
            </Typography.Paragraph>
          )}

          <Typography.Text strong style={{ display: "block", marginTop: 16 }}>
            自定义
          </Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0", fontSize: 12 }}>
            节点 {custom.stocks.length} · 连线 {custom.links.length}
            {dirty ? " · 未保存" : " · 已同步本机"}
          </Typography.Paragraph>

          <Typography.Text strong style={{ display: "block", marginTop: 16 }}>代表回路</Typography.Text>
          <div className="loop-kg-loops">
            {sideLoops.map((loop) => (
              <button
                key={loop.code}
                type="button"
                className={`loop-kg-loop${focusLoop === loop.code ? " is-active" : ""}`}
                onClick={() => {
                  const next = focusLoop === loop.code ? null : loop.code;
                  setFocusChain(null);
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

      <Modal
        title="新增指标节点"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void handleAddNode()}
        okText="加入"
        destroyOnClose
      >
        <Form
          form={addForm}
          layout="vertical"
          initialValues={{ level: "sku", dataKind: "fact" }}
        >
          <Form.Item name="level" label="所属层级" rules={[{ required: true }]}>
            <Select
              options={LEVEL_ORDER.map((lv) => ({
                value: lv,
                label: `${LEVEL_LABEL[lv]}（${LOOP_LEVEL_ONTOLOGY[lv].otype}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="code" label="编码" rules={[{ required: true, message: "如 X1" }]}>
            <Input placeholder="例如 X1" maxLength={12} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="指标名称" maxLength={32} />
          </Form.Item>
          <Form.Item name="sub" label="副标题">
            <Input placeholder="可选说明" maxLength={40} />
          </Form.Item>
          <Form.Item name="dataKind" label="数据类型" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio.Button value="fact">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <i style={{
                    width: 10, height: 10, borderRadius: "50%", display: "inline-block",
                    background: nodeColorFor("platform", "fact", "stock"),
                  }} />
                  基础（浅）
                </span>
              </Radio.Button>
              <Radio.Button value="derived">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <i style={{
                    width: 10, height: 10, borderRadius: "50%", display: "inline-block",
                    background: nodeColorFor("platform", "derived", "stock"),
                  }} />
                  衍生（深）
                </span>
              </Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
