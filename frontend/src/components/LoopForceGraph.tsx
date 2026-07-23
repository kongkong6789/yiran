import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";
import { forceCollide, forceLink } from "d3-force";
import { useNavigate } from "react-router-dom";
import {
  App, Button, Form, Input, Modal, Radio, Segmented, Select, Space, Tag, Typography,
} from "antd";
import { CpdExplainTiles } from "./CpdExplainTiles";
import {
  buildLoopForceGraph,
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
import {
  applyDraftLabelsToNodes,
  applyDraftsToGraphLoops,
  cpdLoopsByKindMerged as cpdLoopsByKind,
  findMergedCpdLoop as findCpdLoop,
  listCpdDrafts,
  resolveDraftLevel,
  resyncAllCpdDraftsToGraph,
} from "../loopsHierarchy/cpdDraftStore";
import type { CpdLoopKind } from "../loopsHierarchy/cpdCatalog";
import { getCpdExplain } from "../loopsHierarchy/cpdLoopExplain";
import { getLevelModel } from "../loopsHierarchy/data";
import { graphTooltipStyle, useVisualizationTheme } from "../theme/visualization";

type FgData = { nodes: LoopGNode[]; links: LoopGLink[] };
type EdgeMode = "all" | "causal" | "rollup";
type EditMode = "view" | "link";
type RollupChain = "sales" | "profit" | "resource" | "source";
type PathHop = {
  edgeId: string;
  fromCode: string;
  fromName: string;
  toCode: string;
  toName: string;
  label: string;
  polarity: "+" | "-";
  delay?: boolean;
  step: string;
};
type FgApi = ForceGraphMethods<LoopGNode, LoopGLink> & {
  centerAt?: (x: number, y: number, ms?: number) => void;
  zoom?: (z: number, ms?: number) => void;
  zoomToFit?: (ms?: number, padding?: number) => void;
};

const VIEW_LEVELS = [...LEVEL_ORDER];

const KIND_LABEL: Record<CpdLoopKind | "all", string> = {
  all: "全部",
  R: "增强",
  B: "调节",
  C: "复合",
};

function buildLoopHops(loop: {
  code?: string;
  edgeIds?: string[];
  steps?: string[];
}, nodes: LoopGNode[]): PathHop[] {
  const flows = getLevelModel("company").flows;
  const draft = loop.code ? listCpdDrafts().find((d) => d.code === loop.code) : null;
  const draftEdges = new Map((draft?.edges || []).map((e) => [e.id, e]));
  const byStock = new Map(nodes.filter((n) => n.level === "company").map((n) => [n.id, n]));
  // 子图模式下 nodes 已过滤；用 code 再兜底一次
  const byCode = new Map(nodes.map((n) => [n.code.toLowerCase(), n]));

  return (loop.edgeIds || []).map((eid, index) => {
    const flow = flows.find((f) => f.id === eid);
    const dedge = draftEdges.get(eid);
    const fromId = flow?.from || dedge?.from || "";
    const toId = flow?.to || dedge?.to || "";
    const from = byStock.get(`company:${fromId}`)
      || byCode.get((fromId || "").toUpperCase())
      || byCode.get(fromId || "");
    const to = byStock.get(`company:${toId}`)
      || byCode.get((toId || "").toUpperCase())
      || byCode.get(toId || "");
    const fromCode = from?.code || (fromId || "?").toUpperCase();
    const toCode = to?.code || (toId || "?").toUpperCase();
    const fromName = from?.name || fromCode;
    const toName = to?.name || toCode;
    const label = dedge?.label || flow?.label || "因果";
    const polarity = dedge?.polarity || flow?.polarity || "+";
    const step = loop.steps?.[index]
      || `${fromName} 因「${label}」${polarity === "-" ? "削弱" : "增强"} ${toName}`;
    return {
      edgeId: `company-${eid}`,
      fromCode,
      fromName,
      toCode,
      toName,
      label,
      polarity,
      delay: flow?.delay,
      step,
    };
  });
}

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
  const navigate = useNavigate();
  const { message } = App.useApp();
  const visualTheme = useVisualizationTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<FgApi | undefined>(undefined);
  const didFitRef = useRef(false);
  const hoverIdRef = useRef<string | null>(null);
  const animRef = useRef(0);
  const leaveRef = useRef(false);
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
  /** false=全图高亮定位；true=双击进入回路子图 */
  const [immerseLoop, setImmerseLoop] = useState(false);
  const [focusChain, setFocusChain] = useState<RollupChain | null>(null);
  const [cpdKind, setCpdKind] = useState<CpdLoopKind | "all">("all");
  const [tick, setTick] = useState(0);
  const [frame, setFrame] = useState(0);
  const [flashLabel, setFlashLabel] = useState("");
  const [custom, setCustom] = useState<LoopGraphCustomState>(() => loadLoopCustomState());
  const [editMode, setEditMode] = useState<EditMode>("view");
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm<{
    level: LoopLevel;
    code: string;
    name: string;
    sub?: string;
    dataKind: LoopDataKind;
  }>();

  customRef.current = custom;
  linkFromRef.current = linkFrom;

  // 把已有 CPD 草稿同步进图谱（含补齐孤立新节点的连线）
  useEffect(() => {
    if (!resyncAllCpdDraftsToGraph()) return;
    setCustom(loadLoopCustomState());
    setTick((t) => t + 1);
  }, []);

  // 仅结构变化时重建图谱；拖拽只改 positions，避免整图重算导致“一松手就还原”
  const bundle = useMemo(() => {
    const raw = buildLoopForceGraph(filterLevel, custom);
    const nodes = applyDraftLabelsToNodes(raw.nodes, custom);
    const drafts = listCpdDrafts();
    const draftEdgeLabels = new Map<string, { label: string; polarity: "+" | "-" }>();
    for (const d of drafts) {
      const level = resolveDraftLevel(d);
      for (const e of d.edges) {
        draftEdgeLabels.set(`${level}-${e.id}`, { label: e.label, polarity: e.polarity });
        // 兼容旧版只写了 company- 前缀的同步结果
        if (level === "company") {
          draftEdgeLabels.set(`company-${e.id}`, { label: e.label, polarity: e.polarity });
        }
      }
    }
    const links = raw.links.map((l) => {
      const hit = draftEdgeLabels.get(l.id);
      if (!hit) return l;
      return { ...l, label: hit.label || l.label, polarity: hit.polarity || l.polarity };
    });
    const loops = applyDraftsToGraphLoops(raw.loops);
    return { ...raw, nodes, links, loops };
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- positions 由拖拽直接钉在节点上
  [filterLevel, custom.stocks, custom.links, custom.labels, tick]);

  const focusEdgeSet = useMemo(() => {
    if (!focusLoop) return new Set<string>();
    const cpd = findCpdLoop(focusLoop);
    if (cpd?.edgeIds?.length) {
      return new Set(cpd.edgeIds.map((eid) => `company-${eid}`));
    }
    const loop = bundle.loops.find(
      (l) => l.code === focusLoop || l.code.endsWith(`·${focusLoop}`),
    );
    return new Set(loop?.edgeIds || []);
  }, [bundle.loops, focusLoop]);

  /** 路径节点：stockPath ∪ 高亮边端点，避免漏掉中间 Stock */
  const focusStockSet = useMemo(() => {
    if (!focusLoop) return null as Set<string> | null;
    const ids = new Set<string>();
    const cpd = findCpdLoop(focusLoop);
    (cpd?.stockPath || []).forEach((id) => {
      ids.add(id.includes(":") ? id : `company:${id}`);
    });
    bundle.links.forEach((l) => {
      if (!focusEdgeSet.has(l.id)) return;
      const { s, t } = linkEnds(l);
      ids.add(s);
      ids.add(t);
    });
    return ids.size ? ids : null;
  }, [bundle.links, focusEdgeSet, focusLoop]);

  const activeCpdLoop = useMemo(
    () => (focusLoop ? findCpdLoop(focusLoop) : undefined),
    [focusLoop],
  );

  const activeExplain = useMemo(
    () => (activeCpdLoop ? (activeCpdLoop.explain || getCpdExplain(activeCpdLoop.code)) : undefined),
    [activeCpdLoop],
  );

  const cpdSideLoops = useMemo(() => cpdLoopsByKind(cpdKind), [cpdKind, tick]);
  const editedLoopCodes = useMemo(
    () => new Set(listCpdDrafts().map((d) => d.code)),
    [tick],
  );

  const focusPathHops = useMemo(() => {
    if (!activeCpdLoop?.edgeIds?.length) return [] as PathHop[];
    return buildLoopHops(activeCpdLoop, bundle.nodes);
  }, [activeCpdLoop, bundle.nodes]);

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
    const modeLinks = bundle.links.filter((l) => {
      if (edgeMode === "all") return true;
      if (edgeMode === "causal") return l.kind === "causal";
      if (edgeMode === "rollup") return l.kind === "rollup";
      return true;
    });

    // 双击进入后才裁成回路子图；单击只在全图上高亮定位
    if (immerseLoop && focusLoop && focusStockSet?.size && focusEdgeSet.size) {
      const cpd = findCpdLoop(focusLoop);
      const orderedIds: string[] = [];
      const seen = new Set<string>();
      (cpd?.stockPath || []).forEach((id) => {
        const full = id.includes(":") ? id : `company:${id}`;
        if (!focusStockSet.has(full) || seen.has(full)) return;
        seen.add(full);
        orderedIds.push(full);
      });
      focusStockSet.forEach((id) => {
        if (seen.has(id)) return;
        seen.add(id);
        orderedIds.push(id);
      });

      const n = Math.max(orderedIds.length, 1);
      const cx = 420;
      const cy = 260;
      // 半径随节点数放大，保证 zoomToFit 后仍铺满可视区
      const radius = Math.max(200, 70 + n * 48);
      const pos = new Map<string, { x: number; y: number }>();
      orderedIds.forEach((id, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        pos.set(id, { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
      });

      return {
        nodes: bundle.nodes
          .filter((node) => focusStockSet.has(node.id))
          .map((node) => {
            const p = pos.get(node.id);
            if (!p) return { ...node };
            return { ...node, fx: p.x, fy: p.y, x: p.x, y: p.y };
          }),
        links: modeLinks
          .filter((l) => focusEdgeSet.has(l.id))
          .map((l) => ({ ...l })),
      };
    }

    return {
      nodes: bundle.nodes.map((n) => ({ ...n })),
      links: modeLinks.map((l) => ({ ...l })),
    };
  }, [bundle, edgeMode, focusEdgeSet, focusLoop, focusStockSet, immerseLoop, tick]);

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

  // 仅在入场/闪标动画期间 setState；若每帧都 setFrame，会把
  // BrowserRouter v7_startTransition 的路由跳转饿死（表现为点编辑不跳转、刷新才行）
  useEffect(() => {
    let alive = true;
    let id = 0;
    const step = () => {
      if (!alive || leaveRef.current) return;
      const t = performance.now();
      animRef.current = t;
      const revealing = t - revealAtRef.current < 750;
      const flashing = flashAtRef.current > 0 && t - flashAtRef.current < 900;
      if (revealing || flashing) {
        setFrame((f) => (f + 1) % 1_000_000);
        id = requestAnimationFrame(step);
      } else {
        id = 0;
      }
    };
    id = requestAnimationFrame(step);
    return () => {
      alive = false;
      if (id) cancelAnimationFrame(id);
    };
  }, []);

  const kickAnimLoop = useCallback(() => {
    if (leaveRef.current) return;
    const step = () => {
      if (leaveRef.current) return;
      const t = performance.now();
      animRef.current = t;
      const revealing = t - revealAtRef.current < 750;
      const flashing = flashAtRef.current > 0 && t - flashAtRef.current < 900;
      if (!revealing && !flashing) return;
      setFrame((f) => (f + 1) % 1_000_000);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const triggerReveal = useCallback((label: string) => {
    revealAtRef.current = performance.now();
    flashAtRef.current = performance.now();
    setFlashLabel(label);
    kickAnimLoop();
    window.setTimeout(() => setFlashLabel(""), 900);
  }, [kickAnimLoop]);

  useEffect(() => {
    didFitRef.current = false;
    setSelected(null);
    triggerReveal(
      filterLevel === "all" ? "全景" : `聚焦 · ${LEVEL_LABEL[filterLevel]}`,
    );
  }, [filterLevel, triggerReveal]);

  // 全图且未聚焦闭环时，强制露出上卷边（避免此前点回路把 edgeMode 切成 causal）
  useEffect(() => {
    if (filterLevel === "all" && !focusLoop && edgeMode !== "all") {
      setEdgeMode("all");
    }
  }, [edgeMode, filterLevel, focusLoop]);

  useEffect(() => {
    if (edgeMode === "causal") setFocusChain(null);
    triggerReveal(
      edgeMode === "rollup" ? "上卷贯通" : edgeMode === "causal" ? "层内因果" : "全部边",
    );
  }, [edgeMode, triggerReveal]);

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
    // 单层已环形铺开，与全图一样用 zoomToFit，避免压成一条扁线
    fg.zoomToFit?.(ms, level === "all" ? 70 : 100);
  }, []);

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
    if (tourTimerRef.current) {
      window.clearTimeout(tourTimerRef.current);
      tourTimerRef.current = null;
    }
  }, []);

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
    customRef.current = next;
    setCustom(next);
    saveLoopCustomState(next);
  }, []);

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
    message.success("已添加连线");
    triggerReveal("新连线");
  };

  const onChangeLevel = (v: LoopLevel | "all") => {
    stopTour();
    setFocusLoop(null);
    setImmerseLoop(false);
    setFocusChain(null);
    setFilterLevel(v);
    // 全图必须露出上卷链；层内因果模式下会把 rollup 滤掉
    setEdgeMode(v === "all" ? "all" : "causal");
  };

  const focusRollupChain = useCallback((chain: RollupChain) => {
    const next = focusChain === chain ? null : chain;
    setFocusChain(next);
    setFocusLoop(null);
    setImmerseLoop(false);
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
        : focusStockSet
          ? !focusStockSet.has(n.id)
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
      const inCpdPath = Boolean(focusStockSet?.has(n.id));

      ctx.save();
      ctx.globalAlpha = alpha;

      const selectedHub = selected?.id === n.id || (n.kind === "hub" && filterLevel === n.level) || inCpdPath;
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
        grd.addColorStop(0, visualTheme.nodeHover);
        grd.addColorStop(0.35, fill);
        grd.addColorStop(1, fill);
      } else if (n.dataKind === "fact") {
        grd.addColorStop(0, visualTheme.nodeHover);
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
        ctx.strokeStyle = n.custom ? "#C4924A" : visualTheme.nodeHover;
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


      const fontSize = Math.max(n.kind === "hub" ? 13 : 11, (n.kind === "hub" ? 14 : 11) / globalScale);
      ctx.font = `${n.kind === "hub" ? 700 : 600} ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = n.kind === "hub" ? n.name : `${n.code} ${n.name}`;
      const lines = wrapLabel(label, n.kind === "hub" ? 8 : 8);
      const baseY = y + r + 3;
      lines.forEach((line, i) => {
        const w = ctx.measureText(line).width;
        ctx.fillStyle = visualTheme.labelBg;
        ctx.fillRect(x - w / 2 - 2, baseY + i * (fontSize + 2) - 1, w + 4, fontSize + 3);
        ctx.fillStyle = muted ? visualTheme.mutedText : visualTheme.labelText;
        ctx.fillText(line, x, baseY + i * (fontSize + 2));
      });

      ctx.restore();
    },
    [
      neighborIds,
      focusStockSet,
      focusLevelIdx,
      filterLevel,
      reveal,
      selected,
      now,
      editMode,
      linkFrom,
      focusChain,
      chainNodeIds,
      visualTheme,
    ],
  );

  const sideLoops = useMemo(() => {
    if (filterLevel === "company") return [];
    if (filterLevel === "all") {
      return bundle.loops.filter((l) => l.level !== "company");
    }
    return bundle.loops.filter((l) => l.level === filterLevel);
  }, [bundle.loops, filterLevel]);

  const sideLoopsByLevel = useMemo(() => {
    const groups: { level: LoopLevel; label: string; loops: typeof sideLoops }[] = [];
    for (const level of LEVEL_ORDER) {
      if (level === "company") continue;
      const loops = sideLoops.filter((l) => l.level === level);
      if (!loops.length) continue;
      groups.push({ level, label: LEVEL_LABEL[level], loops });
    }
    return groups;
  }, [sideLoops]);

  const focusLoopRef = useRef<string | null>(null);
  focusLoopRef.current = focusLoop;

  const fitNodesInView = useCallback((nodes: LoopGNode[], label?: string) => {
    const positioned = nodes.filter((n) => {
      const x = n.x ?? n.fx;
      const y = n.y ?? n.fy;
      return x != null && y != null;
    });
    if (!positioned.length) {
      fitOverviewRef.current();
      return;
    }
    // 小 padding + 贴近画布边缘，消除左右留白
    fgRef.current?.zoomToFit?.(480, 28);
    if (label) triggerReveal(label);
  }, [triggerReveal]);

  const focusLoopByCode = useCallback((code: string) => {
    const cpd = findCpdLoop(code);
    const loop = bundle.loops.find((l) => l.code === code || l.code.endsWith(`·${code}`));
    const edgeIds = new Set(
      cpd?.edgeIds?.map((eid) => `company-${eid}`) || loop?.edgeIds || [],
    );
    const ids = new Set<string>();
    (cpd?.stockPath || []).forEach((id) => {
      ids.add(id.includes(":") ? id : `company:${id}`);
    });
    bundle.links.forEach((l) => {
      if (!edgeIds.has(l.id)) return;
      const { s, t } = linkEnds(l);
      ids.add(s);
      ids.add(t);
    });
    if (!ids.size) return;

    window.setTimeout(() => {
      const fromGraph = (fgData.nodes || []).filter((n) => ids.has(n.id));
      const fallback = bundle.nodes.filter((n) => ids.has(n.id));
      fitNodesInView(
        fromGraph.length ? fromGraph : fallback,
        `回路 · ${cpd?.name || loop?.name || code}`,
      );
    }, 180);
  }, [bundle.links, bundle.loops, bundle.nodes, fgData.nodes, fitNodesInView]);

  const openLoopEdit = (
    loopCode: string,
    e?: { preventDefault(): void; stopPropagation(): void },
    level?: LoopLevel,
  ) => {
    e?.preventDefault();
    e?.stopPropagation();
    // 立刻停掉动画帧 setState，再同步提交路由，避免被 startTransition 饿死
    leaveRef.current = true;
    const parts = loopCode.includes("·") ? loopCode.split("·") : [loopCode];
    const bare = parts.slice(-1)[0];
    const label = parts.length > 1 ? parts[0] : null;
    const fromLabel = label
      ? (Object.entries(LEVEL_LABEL) as [LoopLevel, string][]).find(([, v]) => v === label)?.[0]
      : undefined;
    const lv = level || fromLabel || "company";
    flushSync(() => {
      navigate(`/loops/graph/edit/${encodeURIComponent(bare)}?level=${encodeURIComponent(lv)}`);
    });
  };

  const loopClickTimerRef = useRef<number | null>(null);

  /** 单击：留在全图，高亮并缩放到该回路所在位置（多为公司层） */
  const highlightCpdLoop = (code: string) => {
    setFocusChain(null);
    setImmerseLoop(false);
    if (focusLoop === code) {
      setFocusLoop(null);
      setEdgeMode("all");
      window.setTimeout(() => fitOverviewRef.current(), 80);
      return;
    }
    if (filterLevel !== "all") setFilterLevel("all");
    setEdgeMode("all");
    setFocusLoop(code);
    window.setTimeout(() => focusLoopByCode(code), 140);
  };

  /** 双击：进入回路子图 */
  const immerseCpdLoop = (code: string) => {
    setFocusChain(null);
    if (filterLevel !== "company" && filterLevel !== "all") {
      setFilterLevel("company");
    }
    setFocusLoop(code);
    setImmerseLoop(true);
    window.setTimeout(() => focusLoopByCode(code), 140);
  };

  const onCpdLoopClick = (code: string) => {
    if (loopClickTimerRef.current) {
      window.clearTimeout(loopClickTimerRef.current);
      loopClickTimerRef.current = null;
    }
    loopClickTimerRef.current = window.setTimeout(() => {
      loopClickTimerRef.current = null;
      highlightCpdLoop(code);
    }, 260);
  };

  const onCpdLoopDoubleClick = (code: string) => {
    if (loopClickTimerRef.current) {
      window.clearTimeout(loopClickTimerRef.current);
      loopClickTimerRef.current = null;
    }
    immerseCpdLoop(code);
  };

  const particleCount = (l: object) => {
    const link = l as LoopGLink;
    if (link.kind === "member" || link.kind === "contain") return 0;
    if (focusChain) return chainEdgeSet.has(link.id) ? 5 : 0;
    if (edgeMode === "rollup" && link.kind === "rollup") return 4;
    if (link.kind === "rollup") return 2;
    if (focusEdgeSet.size) return focusEdgeSet.has(link.id) ? 4 : 0;
    // 单层默认不撒粒子，悬停邻边时才动，避免满屏乱闪
    if (filterLevel !== "all" && link.kind === "causal" && neighborIds) {
      const { s, t } = linkEnds(link);
      if (neighborIds.has(s) && neighborIds.has(t)) return 3;
      return 0;
    }
    if (neighborIds) {
      const { s, t } = linkEnds(link);
      return neighborIds.has(s) && neighborIds.has(t) ? 3 : 0;
    }
    return 0;
  };

  return (
    <div className="loop-kg">
      <div className="loop-kg-legend">
        <button
          type="button"
          className={`loop-kg-leg-item is-btn${filterLevel === "all" ? " is-active" : ""}`}
          onClick={() => onChangeLevel("all")}
        >
          <i style={{ background: "linear-gradient(135deg,#64748b,#c4924a)" }} />
          全图
        </button>
        {VIEW_LEVELS.map((lv) => (
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
        <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
          点击上卷线突出贯通链 · 点空白处返回
        </Typography.Text>
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
          {editMode === "link" ? (
            <Typography.Text type="secondary" className="loop-kg-hint">
              【连线中】先点起点，再点终点
            </Typography.Text>
          ) : null}
          <ForceGraph2D
            ref={fgRef}
            width={size.w}
            height={size.h}
            graphData={fgData}
            backgroundColor={visualTheme.canvas}
            enableNodeDrag
            nodeId="id"
            nodeVal={(n) => (n as LoopGNode).val}
            nodeLabel={(n) => {
              const node = n as LoopGNode;
              const title = `${node.code} · ${node.name}`;
              return `<div style="${graphTooltipStyle(visualTheme)}">
                <b style="color:${visualTheme.tooltipText}">${title}</b><br/>
                <span style="color:${visualTheme.mutedText}">${node.levelLabel}${node.sub ? ` · ${node.sub}` : ""}</span>
              </div>`;
            }}
            nodeCanvasObjectMode={() => "replace"}
            nodeCanvasObject={paintNode}
            linkColor={(link) => {
              const l = link as LoopGLink;
              const { s, t } = linkEnds(l);
              const levelFocus = filterLevel !== "all";
              const hot = Boolean(neighborIds && neighborIds.has(s) && neighborIds.has(t));
              if (focusChain) {
                return chainEdgeSet.has(l.id)
                  ? CHAIN_META[focusChain].color
                  : "rgba(148,163,184,0.08)";
              }
              if (focusEdgeSet.size && l.kind === "causal" && !focusEdgeSet.has(l.id)) {
                return "rgba(180,190,205,0.1)";
              }
              if (focusStockSet && !focusStockSet.has(s) && !focusStockSet.has(t)) {
                return "rgba(180,190,205,0.08)";
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
              if (l.kind === "rollup") {
                if (edgeMode === "causal") return "rgba(196,146,74,0)";
                return focusChain ? "rgba(196,146,74,0.28)" : "rgba(196,146,74,0.7)";
              }
              if (l.polarity === "-") {
                if (focusEdgeSet.size) return "#c53d3d";
                if (levelFocus) return hot ? "#c53d3d" : "rgba(197,61,61,0.28)";
                return "rgba(197,61,61,0.35)";
              }
              if (focusEdgeSet.size) return "rgba(61,111,168,0.75)";
              if (levelFocus) return hot ? "rgba(61,111,168,0.85)" : "rgba(61,111,168,0.22)";
              return "rgba(61,111,168,0.22)";
            }}
            linkWidth={(link) => {
              const l = link as LoopGLink;
              const levelFocus = filterLevel !== "all";
              const { s, t } = linkEnds(l);
              const hot = Boolean(neighborIds && neighborIds.has(s) && neighborIds.has(t));
              if (focusChain) return chainEdgeSet.has(l.id) ? 4.2 : 0.6;
              if (l.custom) return 2.2;
              if (focusEdgeSet.has(l.id)) return 2.8;
              if (l.kind === "rollup") return focusChain ? 1.2 : 2.2;
              // 单层：默认细线，悬停/选中邻边才加粗（像回路）
              if (levelFocus && l.kind === "causal") return hot ? 2.8 : 1.15;
              return focusEdgeSet.size ? 0.7 : 1.05;
            }}
            linkCurvature={(link) => {
              const l = link as LoopGLink;
              // 仅回路高亮时轻微弯曲；单层用直线，减少乱麻
              if (!focusEdgeSet.has(l.id)) return 0;
              let hash = 0;
              for (let i = 0; i < l.id.length; i += 1) hash = (hash + l.id.charCodeAt(i) * (i + 1)) % 7;
              const amp = l.polarity === "-" ? 0.28 : 0.18;
              return ((hash % 2 === 0 ? 1 : -1) * amp);
            }}
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
              const { s, t } = linkEnds(l);
              const hop = focusPathHops.find((h) => h.edgeId === l.id);
              const hot = Boolean(neighborIds && neighborIds.has(s) && neighborIds.has(t));
              const showCausalLabel = focusEdgeSet.has(l.id)
                || (filterLevel !== "all" && l.kind === "causal" && hot && Boolean(selected || hoverNode));
              const showRollupLabel = l.kind === "rollup"
                && Boolean(focusChain)
                && chainEdgeSet.has(l.id);
              if (!showCausalLabel && !showRollupLabel) return;
              const src = typeof l.source === "object" ? l.source : null;
              const tgt = typeof l.target === "object" ? l.target : null;
              if (!src || !tgt || src.x == null || tgt.x == null) return;
              const x = ((src.x || 0) + (tgt.x || 0)) / 2;
              const y = ((src.y || 0) + (tgt.y || 0)) / 2 - 6;
              const fontSize = Math.max(10, 12 / globalScale);
              ctx.font = `600 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              const text = hop
                ? `${hop.fromCode}${hop.polarity === "-" ? "⊖" : "→"}${hop.toCode} ${hop.label}`
                : (l.label || (l.polarity === "-" ? "抑制" : "促进"));
              const w = ctx.measureText(text).width;
              ctx.fillStyle = visualTheme.labelBg;
              ctx.fillRect(x - w / 2 - 4, y - fontSize / 2 - 2, w + 8, fontSize + 4);
              ctx.fillStyle = showCausalLabel
                ? (l.polarity === "-" ? "#b91c1c" : "#1d4ed8")
                : "#8A6A35";
              ctx.fillText(text, x, y);
            }}
            onLinkClick={(link) => {
              const l = link as LoopGLink;
              if (l.kind !== "rollup") return;
              const chain = rollupChainOf(l);
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
              // 全图才画层级分隔线；单层聚焦用环形布局，不再画水平扁线
              if (filterLevel !== "all") {
                const fontSize = Math.max(14, 18 / globalScale);
                ctx.save();
                ctx.font = `700 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
                ctx.textAlign = "left";
                ctx.textBaseline = "top";
                ctx.fillStyle = LEVEL_COLOR[filterLevel];
                ctx.globalAlpha = 0.9;
                ctx.fillText(LEVEL_LABEL[filterLevel], 12, 12);
                ctx.restore();
                return;
              }
              const fontSize = Math.max(12, 14 / globalScale);
              ctx.save();
              ctx.font = `700 ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
              ctx.textAlign = "right";
              ctx.textBaseline = "middle";
              LEVEL_ORDER.forEach((lv) => {
                const y = ROW_Y[lv];
                const label = LEVEL_LABEL[lv];
                ctx.fillStyle = LEVEL_COLOR[lv];
                ctx.fillText(label, -36, y);
                ctx.strokeStyle = "rgba(148,163,184,0.28)";
                ctx.lineWidth = Math.max(0.5, 0.8 / Math.max(globalScale, 0.25));
                ctx.setLineDash([4 / Math.max(globalScale, 0.25), 7 / Math.max(globalScale, 0.25)]);
                ctx.beginPath();
                ctx.moveTo(-4, y);
                ctx.lineTo(2100, y);
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
              saveLoopCustomState(next);
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
              if (immerseLoop) {
                setImmerseLoop(false);
                if (focusLoop) {
                  window.setTimeout(() => focusLoopByCode(focusLoop), 100);
                } else {
                  window.setTimeout(() => fitOverviewRef.current(), 60);
                }
                return;
              }
              if (focusLoop) {
                setFocusLoop(null);
                window.setTimeout(() => fitOverviewRef.current(), 60);
                return;
              }
              if (focusChain) {
                setFocusChain(null);
                window.setTimeout(() => fitOverviewRef.current(), 60);
              }
            }}
            warmupTicks={30}
            cooldownTicks={50}
            d3AlphaDecay={0.06}
            d3VelocityDecay={0.42}
            onEngineStop={() => {
              if (didFitRef.current) return;
              didFitRef.current = true;
              if (focusLoopRef.current) return;
              fitOverview();
            }}
          />
        </div>

        <aside className="loop-kg-side">
          {selected ? (
            <div className="loop-kg-detail loop-kg-detail--top">
              <Space wrap size={4}>
                <Tag>{selected.levelLabel}</Tag>
                {selected.code ? <Tag color="blue">{selected.code}</Tag> : null}
              </Space>
              <Typography.Title level={5} style={{ margin: "6px 0 2px", fontSize: 15 }}>
                {selected.name}
              </Typography.Title>
              {selected.sub ? (
                <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>
                  {selected.sub}
                </Typography.Paragraph>
              ) : null}
            </div>
          ) : null}

          {focusChain ? (
            <div className="loop-kg-chain-detail">
              <Typography.Text strong>{CHAIN_META[focusChain].name}</Typography.Text>
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

          <div className="loop-kg-cpd-head">
            <Typography.Text strong>经营回路</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              单击定位全图 · 双击进入回路
            </Typography.Text>
          </div>
          <Segmented
            size="small"
            block
            value={cpdKind}
            onChange={(v) => setCpdKind(v as CpdLoopKind | "all")}
            options={[
              { value: "all", label: KIND_LABEL.all },
              { value: "R", label: KIND_LABEL.R },
              { value: "B", label: KIND_LABEL.B },
              { value: "C", label: KIND_LABEL.C },
            ]}
          />
          {activeCpdLoop ? (
            <div className="loop-kg-cpd-detail">
              <Space wrap size={4} style={{ width: "100%", justifyContent: "space-between" }}>
                <Space wrap size={4}>
                  <Tag color={activeCpdLoop.kind === "R" ? "orange" : activeCpdLoop.kind === "B" ? "blue" : "purple"}>
                    {activeCpdLoop.code}
                  </Tag>
                  <Typography.Text strong style={{ fontSize: 13 }}>{activeCpdLoop.name}</Typography.Text>
                  <button
                    type="button"
                    className="loop-kg-loop-edit"
                    title="编辑闭环 SOP"
                    aria-label={`编辑 ${activeCpdLoop.code}`}
                    onClick={(e) => openLoopEdit(activeCpdLoop.code, e, "company")}
                  >
                    🖊
                  </button>
                </Space>
                <Button size="small" type="link" onClick={() => {
                  setFocusLoop(null);
                  setImmerseLoop(false);
                  setEdgeMode("all");
                  if (filterLevel !== "all") setFilterLevel("all");
                  window.setTimeout(() => fitOverviewRef.current(), 60);
                }}>
                  清除
                </Button>
              </Space>
              {immerseLoop ? (
                <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
                  已进入回路子图 · 点空白返回全图定位
                </Typography.Text>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>
                  已在全图定位（多为公司层）· 双击可进入
                </Typography.Text>
              )}
              <div className="loop-kg-cpd-pathline">
                {(activeCpdLoop.stockPath || [])
                  .map((s) => s.toUpperCase())
                  .filter((s, i, arr) => i === 0 || s !== arr[i - 1])
                  .join(" → ")}
              </div>

              {activeExplain ? (
                <CpdExplainTiles explain={activeExplain} seed={activeCpdLoop?.code || "loop"} compact />
              ) : null}
            </div>
          ) : null}
          <div className="loop-kg-loops" style={{ marginTop: 8 }}>
            {cpdSideLoops.map((loop) => (
              <div
                key={loop.code}
                className={`loop-kg-loop${focusLoop === loop.code ? " is-active" : ""}${focusLoop === loop.code && immerseLoop ? " is-immerse" : ""}`}
              >
                <button
                  type="button"
                  className="loop-kg-loop-main"
                  onClick={() => onCpdLoopClick(loop.code)}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    onCpdLoopDoubleClick(loop.code);
                  }}
                >
                  <Tag color={loop.kind === "R" ? "orange" : loop.kind === "B" ? "blue" : "purple"}>
                    {loop.code}
                  </Tag>
                  <span className="loop-kg-loop-name">{loop.name}</span>
                  {editedLoopCodes.has(loop.code) ? (
                    <Tag color="gold" style={{ marginInlineStart: 4 }}>已改</Tag>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="loop-kg-loop-edit"
                  title="编辑闭环 SOP"
                  aria-label={`编辑 ${loop.code}`}
                  onClick={(e) => openLoopEdit(loop.code, e, "company")}
                >
                  🖊
                </button>
              </div>
            ))}
          </div>

          {sideLoopsByLevel.length ? (
            <>
              <Typography.Text strong style={{ display: "block", marginTop: 14, fontSize: 12 }}>
                {filterLevel === "all" ? "各层经营回路" : "本层回路"}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", marginBottom: 6 }}>
                单击定位该层路径
              </Typography.Text>
              {sideLoopsByLevel.map((group) => (
                <div key={group.level} style={{ marginBottom: 8 }}>
                  {filterLevel === "all" ? (
                    <Typography.Text type="secondary" style={{ fontSize: 11, display: "block", margin: "6px 0 4px" }}>
                      {group.label}
                      <span style={{ marginLeft: 6, opacity: 0.7 }}>{group.loops.length}</span>
                    </Typography.Text>
                  ) : null}
                  <div className="loop-kg-loops">
                    {group.loops.map((loop) => (
                      <div
                        key={loop.code}
                        className={`loop-kg-loop${focusLoop === loop.code ? " is-active" : ""}`}
                      >
                        <button
                          type="button"
                          className="loop-kg-loop-main"
                          onClick={() => {
                            const next = focusLoop === loop.code ? null : loop.code;
                            setFocusChain(null);
                            setImmerseLoop(false);
                            setFocusLoop(next);
                            if (next) {
                              if (filterLevel !== "all" && filterLevel !== loop.level) {
                                setFilterLevel(loop.level);
                              }
                              focusLoopByCode(next);
                            } else {
                              setEdgeMode("all");
                              window.setTimeout(() => fitOverviewRef.current(), 60);
                            }
                          }}
                        >
                          <Tag color={loop.kind === "R" ? "orange" : loop.kind === "B" ? "blue" : "purple"}>
                            {loop.kind}
                          </Tag>
                          <span className="loop-kg-loop-name">{loop.name}</span>
                          <span className="loop-kg-loop-path">{loop.path}</span>
                        </button>
                        <button
                          type="button"
                          className="loop-kg-loop-edit"
                          title="编辑闭环回路"
                          aria-label={`编辑 ${loop.code}`}
                          onClick={(e) => openLoopEdit(loop.code, e, loop.level)}
                        >
                          🖊
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : null}
        </aside>
      </div>

      <Modal
        title="新增指标节点"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void handleAddNode()}
        okText="加入"
        destroyOnHidden
      >
        <Form
          form={addForm}
          layout="vertical"
          initialValues={{ level: "sku", dataKind: "fact" }}
        >
          <Form.Item name="level" label="所属层级" rules={[{ required: true }]}>
            <Select
              options={VIEW_LEVELS.map((lv) => ({
                value: lv,
                label: LEVEL_LABEL[lv],
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
