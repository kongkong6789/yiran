import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAgeStats, listAgents, listMeetings, getAuditLogs } from "../api/client";
import { BRAND_LOGO_SRC } from "../components/BrandLogo";

type Domain = {
  name: string;
  sub: string;
  desc: string;
  color: string;
  route: string;
  countLabel: string;
  samples: string[];
  share: number;
};

const DOMAINS: Domain[] = [
  {
    name: "知识库", sub: "Knowledge", desc: "文档 · 检索 · 注入",
    color: "#9c7cff", route: "/knowledge", countLabel: "1,248 个节点",
    samples: ["客服话术规范", "品牌 FAQ", "交付标准", "售后指南"], share: 26,
  },
  {
    name: "技能", sub: "Skills", desc: "上传 · 启用 · 调用",
    color: "#4e84ff", route: "/skills", countLabel: "342 个节点",
    samples: ["蝉妈妈分析", "日报汇总", "价格监控", "企微同步"], share: 18,
  },
  {
    name: "圆桌会议", sub: "Council", desc: "多个专家一起研讨方案",
    color: "#5bd5f2", route: "/collab?view=roundtable", countLabel: "128 个节点",
    samples: ["运营分析专家", "客服优化", "财务对账", "私域增长"], share: 14,
  },
  {
    name: "AI 问答", sub: "Chat", desc: "直接提问、读文档、调工具",
    color: "#315efb", route: "/agent", countLabel: "核心入口",
    samples: ["问答会话", "文档解读", "Skill 调度", "MCP 调用"], share: 12,
  },
  {
    name: "连接", sub: "Connectors", desc: "企微 · 金蝶 · MCP",
    color: "#ef5ba5", route: "/connectors", countLabel: "64 个节点",
    samples: ["企业微信", "金蝶云", "向量库", "接口清单"], share: 8,
  },
  {
    name: "数据", sub: "Data", desc: "指标 · 维度 · 汇总",
    color: "#31caa1", route: "/datalake", countLabel: "256 个节点",
    samples: ["订单明细", "用户标签", "GMV 指标", "退款率"], share: 10,
  },
  {
    name: "办流程", sub: "Tasks", desc: "提交需求、自动执行、审批",
    color: "#f2a23c", route: "/console", countLabel: "198 个节点",
    samples: ["审批流", "编排任务", "执行记录", "审计"], share: 7,
  },
  {
    name: "图谱", sub: "Graph", desc: "实体关系 · 因果推理",
    color: "#8b63ff", route: "/ontology", countLabel: "关系中枢",
    samples: ["实体节点", "关系边", "因果链", "图谱查询"], share: 5,
  },
];

type GraphNode = {
  id: number;
  type: "center" | "core" | "item";
  group?: number;
  name: string;
  color: string;
  route?: string;
  desc?: string;
  count?: string;
  size: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
};

type GraphEdge = { source: number; target: number; type: "main" | "cluster" | "mesh" };

type Mode = "star" | "relation";

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function buildGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  let id = 0;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push({
    id: id++,
    type: "center",
    name: "良策 AI 知识中枢",
    color: "#315efb",
    desc: "良策 AI 的知识中枢，连接文档、技能、专家、流程与应用。",
    size: 28,
    x: 0, y: 0, tx: 0, ty: 0,
  });

  DOMAINS.forEach((domain, gi) => {
    const coreId = id++;
    nodes.push({
      id: coreId,
      type: "core",
      group: gi,
      name: domain.name,
      color: domain.color,
      route: domain.route,
      desc: domain.desc,
      count: domain.countLabel,
      size: 16,
      x: 0, y: 0, tx: 0, ty: 0,
    });
    edges.push({ source: 0, target: coreId, type: "main" });

    domain.samples.forEach((item, idx) => {
      const nid = id++;
      nodes.push({
        id: nid,
        type: "item",
        group: gi,
        name: item,
        color: domain.color,
        route: domain.route,
        desc: `${domain.name} · ${item}`,
        size: 3.4 + (idx % 3) * 0.8,
        x: 0, y: 0, tx: 0, ty: 0,
      });
      edges.push({ source: coreId, target: nid, type: "cluster" });
      if (idx > 0) edges.push({ source: nid, target: nid - 1, type: "mesh" });
      if (idx > 1 && idx % 2 === 0) edges.push({ source: nid, target: nid - 2, type: "mesh" });
    });
  });

  return { nodes, edges };
}

const LABEL_OFFSETS: [number, number][] = [
  [-12, -34], [0, -42], [22, -36], [30, -4],
  [28, 18], [0, 36], [-18, 28], [-34, -8],
];

export default function Home() {
  const nav = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const logoRef = useRef<HTMLImageElement | null>(null);
  const graphRef = useRef(buildGraph());
  const stateRef = useRef({
    mode: "star" as Mode,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    hoveredId: null as number | null,
    selectedId: null as number | null,
    width: 0,
    height: 0,
    sparks: [] as { x: number; y: number; r: number; a: number }[],
  });

  const [mode, setMode] = useState<Mode>("star");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [edgeCount] = useState(() => buildGraph().edges.length);
  const [stats, setStats] = useState({ vertices: 1336, edges: 3158, agents: 128, meetings: 0 });
  const [feed, setFeed] = useState<{ text: string; meta: string }[]>([]);

  useEffect(() => {
    const img = new Image();
    img.src = BRAND_LOGO_SRC;
    img.onload = () => { logoRef.current = img; draw(); };
  }, []);

  useEffect(() => {
    getAgeStats().then((d) => {
      setStats((s) => ({
        ...s,
        vertices: d.vertices ?? s.vertices,
        edges: d.edges ?? s.edges,
      }));
    }).catch(() => undefined);
    listAgents().then((d: any) => {
      const n = d?.count ?? d?.results?.length;
      if (n != null) setStats((s) => ({ ...s, agents: n }));
    }).catch(() => undefined);
    listMeetings().then((d: any) => {
      const n = d?.count ?? d?.results?.length;
      if (n != null) setStats((s) => ({ ...s, meetings: n }));
    }).catch(() => undefined);
    getAuditLogs().then((d: any) => {
      const rows = (d?.results || []).slice(0, 4).map((r: any) => ({
        text: String(r.action || r.intent || "系统动作"),
        meta: `${r.decision || "记录"} · ${(r.created_at || "").slice(11, 16) || "刚刚"}`,
      }));
      if (rows.length) setFeed(rows);
    }).catch(() => undefined);
  }, []);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const st = stateRef.current;
    const { nodes, edges } = graphRef.current;
    const { width, height, offsetX, offsetY, scale, mode: m, hoveredId, selectedId, sparks } = st;
    if (!width || !height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // grid
    ctx.strokeStyle = "rgba(78,105,170,.045)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 34) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += 34) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    sparks.forEach((s) => {
      ctx.beginPath();
      ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(144,162,220,${s.a})`;
      ctx.fill();
    });

    const byId = (id: number) => nodes.find((n) => n.id === id)!;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    if (m === "star") {
      const center = nodes[0];
      for (let r = 90; r <= Math.min(width, height) * 0.3; r += 32) {
        ctx.beginPath();
        ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(100,121,190,.08)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    edges.forEach((edge) => {
      const a = byId(edge.source);
      const b = byId(edge.target);
      let color = a.color || "#96a6d8";
      let alpha = 0.18;
      let lw = 0.9;
      let curved = false;
      if (edge.type === "main") {
        color = "#d6e0ff";
        alpha = m === "star" ? 0.78 : 0.24;
        lw = m === "star" ? 1.5 : 1.2;
        curved = m === "star";
      } else if (edge.type === "cluster") {
        color = a.color;
        alpha = m === "star" ? 0.24 : 0.2;
        lw = 0.85;
      } else {
        color = a.color;
        alpha = m === "star" ? 0.12 : 0.15;
        lw = 0.7;
      }
      ctx.strokeStyle = hexToRgba(color, alpha);
      ctx.lineWidth = lw;
      ctx.beginPath();
      if (curved) {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const nx = (b.y - a.y) * 0.06;
        const ny = -(b.x - a.x) * 0.06;
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx + nx, cy + ny, b.x, b.y);
      } else {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    });

    const drawStarBurst = (x: number, y: number, color: string, size: number) => {
      ctx.save();
      ctx.shadowBlur = 24;
      ctx.shadowColor = color;
      ctx.strokeStyle = hexToRgba(color, 0.82);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(ang) * size * 0.15, y - Math.sin(ang) * size * 0.15);
        ctx.lineTo(x + Math.cos(ang) * size, y + Math.sin(ang) * size);
        ctx.stroke();
      }
      const g = ctx.createRadialGradient(x, y, 0, x, y, size * 1.8);
      g.addColorStop(0, "rgba(255,255,255,.98)");
      g.addColorStop(0.28, hexToRgba(color, 0.85));
      g.addColorStop(1, hexToRgba(color, 0));
      ctx.beginPath();
      ctx.arc(x, y, size * 0.72, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    };

    nodes.forEach((node) => {
      const hovered = hoveredId === node.id;
      const selectedN = selectedId === node.id;

      if (node.type === "center") {
        // Soft glow only — no hard white disc (avoids logo looking off-center in a ring)
        const halo = ctx.createRadialGradient(node.x, node.y, 8, node.x, node.y, 96);
        halo.addColorStop(0, "rgba(255,255,255,.72)");
        halo.addColorStop(0.4, "rgba(228,235,255,.42)");
        halo.addColorStop(1, "rgba(177,194,255,0)");
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, 96, 0, Math.PI * 2);
        ctx.fillStyle = halo;
        ctx.fill();
        const logo = logoRef.current;
        if (logo) {
          const size = 64;
          ctx.shadowBlur = 18;
          ctx.shadowColor = "rgba(26,39,64,.12)";
          ctx.drawImage(logo, node.x - size / 2, node.y - size / 2, size, size);
        }
        ctx.restore();
        return;
      }

      if (node.type === "core") {
        drawStarBurst(node.x, node.y, node.color, 13 + (selectedN ? 4 : hovered ? 2 : 0));
        ctx.beginPath();
        ctx.arc(node.x, node.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
      } else {
        ctx.save();
        ctx.shadowBlur = selectedN ? 14 : hovered ? 10 : 5;
        ctx.shadowColor = node.color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, selectedN ? node.size + 1.2 : node.size, 0, Math.PI * 2);
        ctx.fillStyle = hovered || selectedN ? "#ffffff" : node.color;
        ctx.fill();
        if (hovered || selectedN) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = hexToRgba(node.color, 0.72);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (hovered || selectedN) {
        ctx.fillStyle = "#56627a";
        ctx.font = "600 12px PingFang SC, Microsoft YaHei, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y - 15);
      }
    });

    if (m === "star") {
      ctx.font = "600 13px PingFang SC, Microsoft YaHei, sans-serif";
      ctx.textAlign = "center";
      nodes.filter((n) => n.type === "core").forEach((core) => {
        const [dx, dy] = LABEL_OFFSETS[core.group || 0];
        ctx.fillStyle = core.color;
        ctx.fillText(core.name, core.x + dx, core.y + dy);
        ctx.fillStyle = "#66738a";
        ctx.font = "600 11px PingFang SC, Microsoft YaHei, sans-serif";
        ctx.fillText(core.count || "", core.x + dx, core.y + dy + 18);
        ctx.font = "600 13px PingFang SC, Microsoft YaHei, sans-serif";
      });
    }

    ctx.restore();
  };

  const applyLayout = (nextMode: Mode, animate = true) => {
    const st = stateRef.current;
    st.mode = nextMode;
    setMode(nextMode);
    const { nodes } = graphRef.current;
    const { width, height } = st;
    const cx = width * 0.5;
    const cy = height * 0.53;

    if (nextMode === "star") {
      const ringX = Math.min(width, height) * 0.32;
      const ringY = Math.min(width, height) * 0.26;
      nodes.forEach((node) => {
        if (node.type === "center") {
          node.tx = cx; node.ty = cy;
        } else if (node.type === "core") {
          const angle = -Math.PI / 2 + (node.group || 0) * Math.PI * 2 / 8;
          node.tx = cx + Math.cos(angle) * ringX;
          node.ty = cy + Math.sin(angle) * ringY;
        } else {
          const core = nodes.find((n) => n.type === "core" && n.group === node.group)!;
          const groupItems = nodes.filter((n) => n.type === "item" && n.group === node.group);
          const localIndex = groupItems.findIndex((n) => n.id === node.id);
          const angle = (-Math.PI / 2 + (node.group || 0) * Math.PI * 2 / 8) + (localIndex - groupItems.length / 2) * 0.12;
          const rr = 38 + (localIndex % 4) * 16 + Math.floor(localIndex / 4) * 7;
          node.tx = core.tx + Math.cos(angle) * rr + Math.cos(localIndex * 1.8) * 4;
          node.ty = core.ty + Math.sin(angle) * rr * 0.92 + Math.sin(localIndex * 1.7) * 4;
        }
      });
    } else {
      const corePos = [
        [0.24, 0.27], [0.45, 0.2], [0.69, 0.27], [0.79, 0.47],
        [0.67, 0.73], [0.47, 0.81], [0.25, 0.72], [0.16, 0.49],
      ];
      nodes.forEach((node) => {
        if (node.type === "center") {
          node.tx = cx; node.ty = cy;
        } else if (node.type === "core") {
          const p = corePos[node.group || 0];
          node.tx = width * p[0];
          node.ty = height * p[1];
        } else {
          const core = nodes.find((n) => n.type === "core" && n.group === node.group)!;
          const groupItems = nodes.filter((n) => n.type === "item" && n.group === node.group);
          const localIndex = groupItems.findIndex((n) => n.id === node.id);
          const angle = localIndex * 0.75 + (node.group || 0);
          const rr = 28 + (localIndex % 5) * 16 + Math.floor(localIndex / 5) * 10;
          node.tx = core.tx + Math.cos(angle) * rr;
          node.ty = core.ty + Math.sin(angle) * rr * 0.8;
        }
      });
    }

    if (!animate) {
      nodes.forEach((n) => { n.x = n.tx; n.y = n.ty; });
      draw();
      return;
    }

    const start = performance.now();
    const duration = 520;
    const starts = nodes.map((n) => ({ x: n.x, y: n.y }));
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      nodes.forEach((n, i) => {
        n.x = starts[i].x + (n.tx - starts[i].x) * ease;
        n.y = starts[i].y + (n.ty - starts[i].y) * ease;
      });
      draw();
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  const resize = () => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    stateRef.current.width = rect.width;
    stateRef.current.height = rect.height;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    stateRef.current.sparks = Array.from({ length: 110 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.8 + Math.random() * 1.8,
      a: 0.14 + Math.random() * 0.35,
    }));
    applyLayout(stateRef.current.mode, false);
  };

  useEffect(() => {
    resize();
    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const st = stateRef.current;
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;

    const worldPoint = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - st.offsetX) / st.scale,
        y: (clientY - rect.top - st.offsetY) / st.scale,
      };
    };

    const hitTest = (clientX: number, clientY: number) => {
      const p = worldPoint(clientX, clientY);
      const ordered = [...graphRef.current.nodes].sort((a, b) => {
        const ra = a.type === "center" ? 58 : a.type === "core" ? 18 : a.size + 5;
        const rb = b.type === "center" ? 58 : b.type === "core" ? 18 : b.size + 5;
        return rb - ra;
      });
      for (const n of ordered) {
        const r = n.type === "center" ? 58 : n.type === "core" ? 18 : n.size + 5;
        const dx = p.x - n.x;
        const dy = p.y - n.y;
        if (dx * dx + dy * dy <= r * r) return n;
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        st.offsetX += dx;
        st.offsetY += dy;
        lastX = e.clientX;
        lastY = e.clientY;
        draw();
        return;
      }
      const hit = hitTest(e.clientX, e.clientY);
      const next = hit?.id ?? null;
      if (next !== st.hoveredId) {
        st.hoveredId = next;
        draw();
      }
      canvas.style.cursor = hit ? "pointer" : dragging ? "grabbing" : "grab";
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (!moved) {
        const hit = hitTest(e.clientX, e.clientY);
        st.selectedId = hit?.id ?? null;
        setSelected(hit);
        draw();
      }
    };
    const onDbl = (e: MouseEvent) => {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit?.route) nav(hit.route);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const before = 1 / st.scale;
      const next = Math.min(2.2, Math.max(0.55, st.scale * (e.deltaY < 0 ? 1.08 : 0.92)));
      const wx = (mx - st.offsetX) * before;
      const wy = (my - st.offsetY) * before;
      st.scale = next;
      st.offsetX = mx - wx * next;
      st.offsetY = my - wy * next;
      draw();
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDbl);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [nav]);

  const fallbackFeed = useMemo(() => [
    { text: "智能客服解决方案知识库", meta: "知识库 · 今天 14:30" },
    { text: "客户需求 → 解决方案", meta: "流程 · 今天 11:20" },
    { text: "数据分析专家", meta: "圆桌会议 · 昨天 16:45" },
    { text: "蝉妈妈分析 Skill", meta: "技能库 · 昨天 09:10" },
  ], []);
  const feedRows = feed.length ? feed : fallbackFeed;

  const zoomBy = (factor: number) => {
    const st = stateRef.current;
    st.scale = Math.min(2.2, Math.max(0.55, st.scale * factor));
    draw();
  };

  const resetView = () => {
    const st = stateRef.current;
    st.offsetX = 0;
    st.offsetY = 0;
    st.scale = 1;
    applyLayout(st.mode, true);
  };

  return (
    <div className="kgv3-page">
      <style>{css}</style>

      <main className="kgv3-workspace">
        <section className="kgv3-graph-card" ref={wrapRef}>
          <div className="kgv3-toolbar">
            <button type="button" className="kgv3-tool-btn">
              <span className="kgv3-stack" />
              全部知识域
            </button>
            <div className={`kgv3-mode ${mode}`}>
              <div className="kgv3-mode-pill" />
              <button
                type="button"
                className={mode === "relation" ? "active" : ""}
                onClick={() => applyLayout("relation", true)}
              >
                关系图谱
              </button>
              <button
                type="button"
                className={mode === "star" ? "active" : ""}
                onClick={() => applyLayout("star", true)}
              >
                星图模式
              </button>
            </div>
            <div className="kgv3-toolbar-right">
              <button type="button" className="kgv3-tool-btn" onClick={resetView}>重置视图</button>
            </div>
          </div>

          <canvas ref={canvasRef} className="kgv3-canvas" />

          <div className="kgv3-zoom">
            <button type="button" onClick={() => zoomBy(1.12)} aria-label="放大">+</button>
            <button type="button" onClick={() => zoomBy(0.9)} aria-label="缩小">−</button>
            <button type="button" onClick={resetView}>重置</button>
          </div>

          <div className="kgv3-legend">
            <span><i style={{ background: "#315efb" }} />知识域</span>
            <span><i style={{ background: "#8b63ff" }} />核心节点</span>
            <span><i style={{ background: "#2dc0d5" }} />关联节点</span>
            <span><i style={{ background: "#f2a23c" }} />强关联</span>
            <span><i style={{ background: "#ef5ba5" }} />跨域关系</span>
          </div>
        </section>
      </main>

      <aside className="kgv3-right">
        <div className="kgv3-card">
          <div className="kgv3-card-head">
            <h2>良策 AI</h2>
            <span className="kgv3-badge">{mode === "star" ? "星图模式" : "关系图谱"}</span>
          </div>
          <p className="kgv3-desc">
            {mode === "star"
              ? "星图模式突出「中心—星团—星点」分层结构，适合总览知识宇宙分布。双击星团可进入对应模块。"
              : "关系图谱强调节点之间的连接网络，更适合查看依赖与跨域关联。"}
          </p>
          <div className="kgv3-metrics">
            <div className="kgv3-metric"><span>知识域</span><strong>8</strong></div>
            <div className="kgv3-metric"><span>核心节点</span><strong>{stats.vertices.toLocaleString("zh-CN")}</strong></div>
            <div className="kgv3-metric"><span>关联节点</span><strong>{Math.max(stats.edges, 3158).toLocaleString("zh-CN")}</strong></div>
            <div className="kgv3-metric"><span>关系总数</span><strong>{edgeCount}</strong></div>
          </div>
        </div>

        <div className="kgv3-card">
          <h3>节点详情</h3>
          {!selected ? (
            <div className="kgv3-hint">点击任意星点，可查看所属知识域与入口；双击核心星团直接进入模块。</div>
          ) : (
            <div className="kgv3-node-meta">
              <div className="kgv3-node-title">
                <i className="kgv3-node-dot" style={{ background: selected.color }} />
                <b>{selected.name}</b>
              </div>
              <div className="kgv3-node-line"><span>类型</span><b>{selected.type === "center" ? "系统中心" : selected.type === "core" ? "知识域" : "关联节点"}</b></div>
              <div className="kgv3-node-line"><span>说明</span><b>{selected.desc || selected.count || "—"}</b></div>
              {selected.route && (
                <div className="kgv3-actions">
                  <button type="button" className="primary" onClick={() => nav(selected.route!)}>进入模块</button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="kgv3-card">
          <h3>星团分布</h3>
          <div className="kgv3-bars">
            {DOMAINS.map((d) => (
              <div className="kgv3-bar-row" key={d.name}>
                <span>{d.name}</span>
                <div className="kgv3-bar"><b style={{ width: `${d.share * 3.2}%`, background: `linear-gradient(90deg, ${d.color}, ${hexToRgba(d.color, 0.55)})` }} /></div>
                <em>{d.share}%</em>
              </div>
            ))}
          </div>
        </div>

        <div className="kgv3-card">
          <h3>最近更新</h3>
          {feedRows.map((row, i) => (
            <div className="kgv3-update" key={`${row.text}-${i}`}>
              <div className="kgv3-update-icon" style={{ color: DOMAINS[i % DOMAINS.length].color }}>◈</div>
              <div>
                <b>{row.text}</b>
                <span>{row.meta}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="kgv3-card muted">
          <div className="kgv3-mini-stats">
            <div><span>专家</span><strong>{stats.agents}</strong></div>
            <div><span>会议</span><strong>{stats.meetings}</strong></div>
          </div>
        </div>
      </aside>
    </div>
  );
}

const css = `
.kgv3-page {
  --kg-bg: #f6f8fc;
  --kg-line: #e8edf5;
  --kg-text: #172033;
  --kg-muted: #7e8aa3;
  --kg-brand: #315efb;
  --kg-brand-soft: #edf3ff;
  --kg-shadow: 0 18px 60px rgba(31,51,94,.08);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 344px;
  height: calc(100vh - 68px);
  margin: 0;
  background: var(--kg-bg);
  color: var(--kg-text);
  overflow: hidden;
}
.kgv3-workspace {
  min-width: 0;
  min-height: 0;
  padding: 16px;
}
.kgv3-graph-card {
  position: relative;
  height: 100%;
  border-radius: 22px;
  border: 1px solid var(--kg-line);
  background: rgba(255,255,255,.88);
  box-shadow: var(--kg-shadow);
  overflow: hidden;
}
.kgv3-graph-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(rgba(65,95,160,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(65,95,160,.035) 1px, transparent 1px),
    radial-gradient(circle at 50% 50%, rgba(130,155,255,.06), transparent 44%);
  background-size: 34px 34px, 34px 34px, auto;
  pointer-events: none;
}
.kgv3-toolbar {
  position: absolute;
  left: 14px; right: 14px; top: 12px;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.kgv3-tool-btn {
  height: 40px;
  border-radius: 14px;
  border: 1px solid var(--kg-line);
  background: #fff;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #44526a;
  cursor: pointer;
  box-shadow: 0 5px 14px rgba(31,51,94,.04);
}
.kgv3-stack {
  position: relative;
  width: 16px; height: 12px;
  display: inline-block;
}
.kgv3-stack::before, .kgv3-stack::after {
  content: "";
  position: absolute; left: 0; right: 0; height: 6px;
  border: 1.5px solid #9aa6ba; border-radius: 2px; background: #fff;
}
.kgv3-stack::before { top: 0; }
.kgv3-stack::after { top: 4px; background: #f7f9fd; }
.kgv3-mode {
  position: relative;
  display: flex;
  padding: 4px;
  background: #f7f9fd;
  border: 1px solid var(--kg-line);
  border-radius: 16px;
  box-shadow: 0 4px 12px rgba(31,51,94,.04);
}
.kgv3-mode-pill {
  position: absolute; top: 4px; left: 4px;
  height: 36px; width: 104px; border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 18px rgba(49,94,251,.12);
  transition: .28s ease;
}
.kgv3-mode.star .kgv3-mode-pill { transform: translateX(104px); }
.kgv3-mode button {
  position: relative; z-index: 1;
  width: 104px; height: 36px;
  border: 0; background: transparent; border-radius: 12px;
  color: #778299; cursor: pointer; font-weight: 600;
}
.kgv3-mode button.active { color: var(--kg-brand); }
.kgv3-toolbar-right { display: flex; gap: 8px; }
.kgv3-canvas {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  cursor: grab;
}
.kgv3-zoom {
  position: absolute; left: 14px; bottom: 14px; z-index: 8;
  background: #fff; border: 1px solid var(--kg-line); border-radius: 14px; overflow: hidden;
  box-shadow: 0 8px 20px rgba(31,51,94,.06);
}
.kgv3-zoom button {
  width: 40px; height: 38px; border: 0; border-bottom: 1px solid var(--kg-line);
  background: #fff; cursor: pointer; font-size: 20px; color: #4b5870;
}
.kgv3-zoom button:last-child { border-bottom: 0; font-size: 12px; }
.kgv3-legend {
  position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%);
  z-index: 8; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 10px 14px; background: rgba(255,255,255,.86);
  border: 1px solid var(--kg-line); border-radius: 20px;
  box-shadow: 0 10px 26px rgba(31,51,94,.06); color: #6c7890; font-size: 12px;
}
.kgv3-legend i {
  width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 6px;
}

.kgv3-right {
  min-width: 0; min-height: 0;
  border-left: 1px solid var(--kg-line);
  background: #fff;
  padding: 16px;
  overflow: auto;
}
.kgv3-card {
  background: #fff;
  border: 1px solid var(--kg-line);
  border-radius: 18px;
  padding: 18px;
  box-shadow: 0 8px 24px rgba(31,51,94,.04);
  margin-bottom: 14px;
}
.kgv3-card.muted { background: #f8faff; }
.kgv3-card h2, .kgv3-card h3 { margin: 0 0 8px; color: var(--kg-text); }
.kgv3-card h3 { font-size: 15px; }
.kgv3-card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.kgv3-badge {
  display: inline-flex; align-items: center; height: 24px; padding: 0 10px;
  border-radius: 999px; background: var(--kg-brand-soft); color: var(--kg-brand);
  font-size: 12px; font-weight: 600;
}
.kgv3-desc { font-size: 13px; line-height: 1.75; color: #7b879c; margin: 0; }
.kgv3-metrics {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;
}
.kgv3-metric {
  padding: 12px; border-radius: 14px; background: #f8faff;
}
.kgv3-metric span { display: block; font-size: 11px; color: #8c97a9; }
.kgv3-metric strong { display: block; font-size: 19px; margin-top: 5px; color: var(--kg-text); }
.kgv3-hint {
  font-size: 12px; color: #8d99ac; padding: 10px 12px; border-radius: 12px; background: #f8faff;
}
.kgv3-node-meta { display: grid; gap: 10px; margin-top: 4px; }
.kgv3-node-title { display: flex; align-items: center; gap: 10px; }
.kgv3-node-dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.kgv3-node-line {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 10px 12px; border-radius: 12px; background: #f8faff; font-size: 13px;
}
.kgv3-node-line span { color: #8995aa; }
.kgv3-node-line b { color: var(--kg-text); font-weight: 600; text-align: right; }
.kgv3-actions { display: flex; gap: 10px; margin-top: 4px; }
.kgv3-actions button {
  height: 38px; border-radius: 12px; border: 1px solid var(--kg-line);
  background: #fff; padding: 0 14px; cursor: pointer;
}
.kgv3-actions .primary {
  background: var(--kg-brand); border-color: var(--kg-brand); color: #fff;
}
.kgv3-bars { display: grid; gap: 10px; }
.kgv3-bar-row {
  display: grid; grid-template-columns: 64px 1fr 42px; gap: 8px;
  align-items: center; font-size: 12px; color: #66738a;
}
.kgv3-bar {
  height: 7px; border-radius: 999px; background: #edf1f8; overflow: hidden;
}
.kgv3-bar > b { display: block; height: 100%; border-radius: 999px; }
.kgv3-bar-row em { font-style: normal; text-align: right; color: #56627a; font-weight: 600; }
.kgv3-update {
  display: flex; gap: 10px; padding: 10px 0;
  border-bottom: 1px dashed #edf0f6; font-size: 12px;
}
.kgv3-update:last-child { border-bottom: 0; }
.kgv3-update-icon {
  width: 32px; height: 32px; border-radius: 10px; background: #f4f7fd;
  display: grid; place-items: center; flex: none;
}
.kgv3-update b { display: block; margin-bottom: 4px; color: var(--kg-text); }
.kgv3-update span { color: #9aa4b5; }
.kgv3-mini-stats {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.kgv3-mini-stats span { display: block; font-size: 11px; color: #8c97a9; }
.kgv3-mini-stats strong { display: block; font-size: 18px; margin-top: 4px; }

@media (max-width: 1100px) {
  .kgv3-page { grid-template-columns: 1fr; height: auto; min-height: calc(100vh - 68px); }
  .kgv3-workspace { height: 62vh; min-height: 420px; }
  .kgv3-right { border-left: 0; border-top: 1px solid var(--kg-line); }
  .kgv3-legend { display: none; }
}
`;
