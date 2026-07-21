import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AimOutlined,
  AppstoreOutlined,
  CompassOutlined,
  DeploymentUnitOutlined,
  DownOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { getAgeStats, listAgents, listMeetings, getAuditLogs } from "../api/client";
import { useVisualizationTheme } from "../theme/visualization";
import OperatingMapV2 from "../components/OperatingMapV2";

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
    samples: ["客服话术规范", "品牌 FAQ", "交付标准", "售后指南"], share: 29,
  },
  {
    name: "技能", sub: "Skills", desc: "上传 · 启用 · 调用",
    color: "#4e84ff", route: "/skills", countLabel: "342 个节点",
    samples: ["蝉妈妈分析", "日报汇总", "价格监控", "企微同步"], share: 21,
  },
  {
    name: "圆桌会议", sub: "Council", desc: "多个专家一起研讨方案",
    color: "#5bd5f2", route: "/collab?view=roundtable", countLabel: "128 个节点",
    samples: ["运营分析专家", "客服优化", "财务对账", "私域增长"], share: 17,
  },
  {
    name: "连接", sub: "Connectors", desc: "企微 · 金蝶 · MCP",
    color: "#ef5ba5", route: "/connectors", countLabel: "64 个节点",
    samples: ["企业微信", "金蝶云", "向量库", "接口清单"], share: 12,
  },
  {
    name: "办流程", sub: "Tasks", desc: "提交需求、自动执行、审批",
    color: "#f2a23c", route: "/console", countLabel: "198 个节点",
    samples: ["审批流", "编排任务", "执行记录", "审计"], share: 12,
  },
  {
    name: "图谱", sub: "Graph", desc: "实体关系 · 因果推理",
    color: "#8b63ff", route: "/ontology", countLabel: "关系中枢",
    samples: ["实体节点", "关系边", "因果链", "图谱查询"], share: 9,
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

type Mode = "star" | "relation" | "map";

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
  const visualTheme = useVisualizationTheme();
  const visualThemeRef = useRef(visualTheme);
  visualThemeRef.current = visualTheme;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef(buildGraph());
  const stateRef = useRef({
    mode: "map" as Mode,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    hoveredId: null as number | null,
    selectedId: null as number | null,
    width: 0,
    height: 0,
    sparks: [] as { x: number; y: number; r: number; a: number; phase: number; speed: number }[],
    motionTime: 0,
  });

  const [mode, setMode] = useState<Mode>("map");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [edgeCount] = useState(() => buildGraph().edges.length);
  const [stats, setStats] = useState({ vertices: 1336, edges: 3158, agents: 128, meetings: 0 });
  const [feed, setFeed] = useState<{ text: string; meta: string }[]>([]);

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
    const visual = visualThemeRef.current;
    const { nodes, edges } = graphRef.current;
    const { width, height, offsetX, offsetY, scale, mode: m, hoveredId, selectedId, sparks, motionTime } = st;
    if (!width || !height) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const backdrop = ctx.createLinearGradient(0, 0, width, height);
    backdrop.addColorStop(0, visual.canvas);
    backdrop.addColorStop(0.48, visual.canvas);
    backdrop.addColorStop(1, visual.labelBg);
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, width, height);

    const dome = ctx.createRadialGradient(width * 0.48, height * 0.5, 30, width * 0.48, height * 0.5, width * 0.62);
    dome.addColorStop(0, visual.mode === "dark" ? "rgba(21,21,21,.96)" : "rgba(255,255,255,.96)");
    dome.addColorStop(0.45, visual.mode === "dark" ? "rgba(61,111,168,.12)" : "rgba(233,240,255,.32)");
    dome.addColorStop(0.78, visual.mode === "dark" ? "rgba(124,83,196,.08)" : "rgba(238,232,255,.18)");
    dome.addColorStop(1, visual.mode === "dark" ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)");
    ctx.fillStyle = dome;
    ctx.fillRect(0, 0, width, height);

    if (m === "map") return;

    [
      [0.02, 0.13, "rgba(119,184,255,.10)"],
      [0.08, 0.08, "rgba(255,198,116,.07)"],
      [0.96, 0.1, "rgba(163,124,255,.08)"],
      [0.98, 0.83, "rgba(100,219,224,.07)"],
    ].forEach(([px, py, color]) => {
      const leak = ctx.createRadialGradient(width * Number(px), height * Number(py), 0, width * Number(px), height * Number(py), 180);
      leak.addColorStop(0, String(color));
      leak.addColorStop(1, visual.mode === "dark" ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)");
      ctx.fillStyle = leak;
      ctx.fillRect(0, 0, width, height);
    });

    sparks.forEach((s) => {
      const twinkle = 0.72 + Math.sin(motionTime * s.speed + s.phase) * 0.28;
      ctx.beginPath();
      ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(126,153,221,${Math.max(0.04, s.a * twinkle)})`;
      ctx.fill();
    });

    ctx.save();
    ctx.fillStyle = "rgba(117,139,195,.36)";
    ctx.font = "500 10px Inter, PingFang SC, Microsoft YaHei, sans-serif";
    ctx.fillText("270°", 12, height * 0.54);
    ctx.fillText("315°", width * 0.12, height * 0.13);
    ctx.fillText("90°", width - 34, height * 0.54);
    ctx.fillText("135°", width * 0.9, height * 0.87);
    ctx.restore();

    const byId = (id: number) => nodes.find((n) => n.id === id)!;
    const focusNode = byId(selectedId ?? hoveredId ?? 0);
    const focusGroup = selectedId != null || hoveredId != null ? focusNode.group : undefined;

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    if (m === "star") {
      const center = nodes[0];
      const maxRing = Math.min(width * 0.58, height * 0.72);
      for (let r = 70; r <= maxRing; r += 34) {
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, r * 1.45, r * 0.72, -0.03, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(97,121,184,${0.052 + (r / maxRing) * 0.035})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const well = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, 126);
      well.addColorStop(0, visual.mode === "dark" ? "rgba(21,21,21,.96)" : "rgba(255,255,255,.96)");
      well.addColorStop(0.42, visual.mode === "dark" ? "rgba(126,183,232,.12)" : "rgba(225,233,252,.26)");
      well.addColorStop(0.78, visual.mode === "dark" ? "rgba(126,183,232,.04)" : "rgba(190,204,238,.09)");
      well.addColorStop(1, visual.mode === "dark" ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)");
      ctx.fillStyle = well;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, 154, 74, -0.03, 0, Math.PI * 2);
      ctx.fill();

      for (let ring = 0; ring < 10; ring += 1) {
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, 36 + ring * 10, 12 + ring * 4.4, -0.03, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(109,133,191,${0.11 - ring * 0.008})`;
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
    }

    edges.forEach((edge) => {
      const a = byId(edge.source);
      const b = byId(edge.target);
      let color = a.color || "#96a6d8";
      const connectedToFocus = focusGroup == null
        || a.group === focusGroup
        || b.group === focusGroup
        || a.id === focusNode.id
        || b.id === focusNode.id;
      let alpha = connectedToFocus ? 0.18 : 0.035;
      let lw = 0.9;
      let curved = false;
      let activeMain = false;
      if (edge.type === "main") {
        activeMain = focusGroup != null && b.group === focusGroup;
        color = activeMain ? b.color : "#a9bae3";
        alpha = activeMain ? 0.82 : m === "star" ? 0.14 : 0.18;
        lw = activeMain ? 2.15 : 0.85;
        curved = m === "star";
      } else if (edge.type === "cluster") {
        color = a.color;
        alpha = connectedToFocus ? (m === "star" ? 0.24 : 0.2) : 0.035;
        lw = connectedToFocus ? 0.9 : 0.6;
      } else {
        color = a.color;
        alpha = connectedToFocus ? (m === "star" ? 0.12 : 0.15) : 0.025;
        lw = 0.7;
      }
      ctx.strokeStyle = hexToRgba(color, alpha);
      ctx.lineWidth = lw;
      if (activeMain) {
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = hexToRgba(color, 0.45);
      }
      ctx.beginPath();
      if (curved) {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const nx = (b.y - a.y) * 0.14;
        const ny = -(b.x - a.x) * 0.14;
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(cx + nx, cy + ny, b.x, b.y);
      } else {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      if (activeMain) ctx.restore();

      if (edge.type === "main" && focusGroup != null && b.group === focusGroup) {
        const t = (motionTime * 0.00018) % 1;
        const cx = (a.x + b.x) / 2 + (b.y - a.y) * 0.14;
        const cy = (a.y + b.y) / 2 - (b.x - a.x) * 0.14;
        const mt = 1 - t;
        const px = mt * mt * a.x + 2 * mt * t * cx + t * t * b.x;
        const py = mt * mt * a.y + 2 * mt * t * cy + t * t * b.y;
        ctx.save();
        ctx.shadowBlur = 12;
        ctx.shadowColor = b.color;
        ctx.fillStyle = visual.nodeHover;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    const drawStarBurst = (x: number, y: number, color: string, size: number) => {
      ctx.save();
      const pulse = 1 + Math.sin(motionTime * 0.0015 + x * 0.01) * 0.05;
      ctx.translate(x, y);
      ctx.scale(pulse, pulse);
      ctx.shadowBlur = 22;
      ctx.shadowColor = color;
      ctx.strokeStyle = hexToRgba(color, 0.62);
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(-size * 2.1, 0); ctx.lineTo(size * 2.1, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -size * 2.3); ctx.lineTo(0, size * 2.3); ctx.stroke();
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.4);
      g.addColorStop(0, visual.nodeHover);
      g.addColorStop(0.24, hexToRgba(color, 0.9));
      g.addColorStop(1, hexToRgba(color, 0));
      ctx.beginPath();
      for (let i = 0; i < 16; i += 1) {
        const angle = -Math.PI / 2 + i * Math.PI / 8;
        const radius = i % 4 === 0 ? size * 1.2 : i % 2 === 0 ? size * 0.56 : size * 0.2;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    };

    nodes.forEach((node) => {
      const hovered = hoveredId === node.id;
      const selectedN = selectedId === node.id;

      if (node.type === "center") {
        const centerSize = m === "star" ? 34 : 30;
        ctx.save();
        ctx.translate(node.x, node.y);
        ctx.shadowBlur = hovered || selectedN ? 34 : 24;
        ctx.shadowColor = hexToRgba(node.color, .45);

        const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, centerSize * 2.8);
        halo.addColorStop(0, hexToRgba(node.color, .24));
        halo.addColorStop(.48, hexToRgba(node.color, .08));
        halo.addColorStop(1, hexToRgba(node.color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, centerSize * 2.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = hexToRgba(node.color, .3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, centerSize * 1.75, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = visual.nodeHover;
        ctx.strokeStyle = hexToRgba(node.color, .75);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, centerSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = node.color;
        ctx.font = "800 13px Inter, PingFang SC, Microsoft YaHei, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("AI", 0, -3);
        ctx.font = "600 8px Inter, PingFang SC, Microsoft YaHei, sans-serif";
        ctx.fillText("KNOWLEDGE", 0, 10);
        ctx.restore();

        ctx.fillStyle = visual.mutedText;
        ctx.font = "650 12px Inter, PingFang SC, Microsoft YaHei, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("良策 AI 知识中枢", node.x, node.y + centerSize + 24);
        return;
      }

      if (node.type === "core") {
        const groupAngle = -0.25 + (node.group || 0) * 0.22;
        ctx.save();
        ctx.translate(node.x, node.y);
        ctx.rotate(groupAngle);
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = hexToRgba(node.color, selectedN || hovered ? 0.42 : 0.24);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.ellipse(0, 0, 68, 27, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        drawStarBurst(node.x, node.y, node.color, 20 + (selectedN ? 6 : hovered ? 3 : 0));
      } else {
        const dimmed = focusGroup != null && node.group !== focusGroup;
        ctx.save();
        ctx.shadowBlur = selectedN ? 14 : hovered ? 10 : 5;
        ctx.shadowColor = node.color;
        ctx.globalAlpha = dimmed ? 0.34 : 1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, selectedN ? node.size + 1.2 : node.size, 0, Math.PI * 2);
        ctx.fillStyle = hovered || selectedN ? visual.nodeHover : node.color;
        ctx.fill();
        if (hovered || selectedN) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = hexToRgba(node.color, 0.72);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (hovered || selectedN) {
        ctx.fillStyle = visual.mutedText;
        ctx.font = "600 12px PingFang SC, Microsoft YaHei, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(node.name, node.x, node.y - 15);
      }
    });

    if (m === "star") {
      ctx.font = "650 14px Inter, PingFang SC, Microsoft YaHei, sans-serif";
      ctx.textAlign = "center";
      nodes.filter((n) => n.type === "core").forEach((core) => {
        const [dx, dy] = LABEL_OFFSETS[core.group || 0];
        ctx.fillStyle = core.color;
        ctx.fillText(core.name, core.x + dx, core.y + dy);
        ctx.fillStyle = visual.mutedText;
        ctx.font = "600 11.5px Inter, PingFang SC, Microsoft YaHei, sans-serif";
        ctx.fillText(core.count || "", core.x + dx, core.y + dy + 18);
        ctx.font = "650 14px Inter, PingFang SC, Microsoft YaHei, sans-serif";
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
    const cx = width * 0.49;
    const cy = height * 0.52;

    if (nextMode === "star") {
      const ringX = Math.min(width * 0.34, height * 0.56);
      const ringY = Math.min(height * 0.31, width * 0.18);
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
      r: 0.45 + Math.random() * 1.55,
      a: 0.1 + Math.random() * 0.28,
      phase: Math.random() * Math.PI * 2,
      speed: 0.00035 + Math.random() * 0.00065,
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
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return undefined;
    let animationFrame = 0;
    let lastDraw = 0;
    const tick = (time: number) => {
      if (time - lastDraw >= 42) {
        stateRef.current.motionTime = time;
        draw();
        lastDraw = time;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
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
      const ordered = graphRef.current.nodes.filter((node) => node.type !== "center").sort((a, b) => {
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

  const selectDomain = (group: number) => {
    const node = graphRef.current.nodes.find((item) => item.type === "core" && item.group === group);
    if (!node) return;
    stateRef.current.selectedId = node.id;
    setSelected(node);
    draw();
  };

  const selectedDomain = selected?.group != null ? DOMAINS[selected.group] : null;
  const selectedPopoverStyle = selected ? {
    left: Math.min(
      stateRef.current.width - 238,
      Math.max(18, selected.x * stateRef.current.scale + stateRef.current.offsetX + 32),
    ),
    top: Math.min(
      stateRef.current.height - 152,
      Math.max(72, selected.y * stateRef.current.scale + stateRef.current.offsetY - 88),
    ),
  } : undefined;

  return (
    <div className={`kgv3-page ${mode === "map" ? "map-mode" : ""}`}>
      <style>{css}</style>

      <main className="kgv3-workspace">
        <section className="kgv3-graph-card" ref={wrapRef}>
          <div className="kgv3-toolbar">
            <button type="button" className="kgv3-tool-btn">
              <AppstoreOutlined />
              全部知识域
              <DownOutlined className="kgv3-tool-chevron" />
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
              <button
                type="button"
                className={mode === "map" ? "active" : ""}
                onClick={() => applyLayout("map", true)}
              >
                经营地图
              </button>
            </div>
            <div className="kgv3-toolbar-right">
              <button type="button" className="kgv3-tool-btn" onClick={resetView}>
                <ReloadOutlined />
                重置视图
              </button>
            </div>
          </div>

          <canvas ref={canvasRef} className="kgv3-canvas" />

          {mode === "map" && (
            <OperatingMapV2 onSelectDomain={selectDomain} onNavigate={nav} />
          )}

          {mode !== "map" && selected && selectedDomain && (
            <div className="kgv3-node-popover" style={selectedPopoverStyle}>
              <div className="kgv3-node-popover__head">
                <span className="kgv3-node-popover__signal" style={{ color: selected.color }}>
                  <CompassOutlined />
                </span>
                <div>
                  <b>{selected.name}</b>
                  <span>{selected.count || selectedDomain.countLabel}</span>
                </div>
              </div>
              <p>{selected.desc || selectedDomain.desc}</p>
              {selected.route && (
                <button type="button" onClick={() => nav(selected.route!)}>
                  进入模块 <RightOutlined />
                </button>
              )}
            </div>
          )}

          <div className="kgv3-zoom">
            <button type="button" onClick={() => zoomBy(1.12)} aria-label="放大"><PlusOutlined /></button>
            <button type="button" onClick={() => zoomBy(0.9)} aria-label="缩小"><MinusOutlined /></button>
            <button type="button" onClick={resetView} aria-label="重置"><AimOutlined /></button>
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

      {mode !== "map" && <aside className="kgv3-right">
        <div className="kgv3-card">
          <div className="kgv3-card-head">
            <h2>良策 AI</h2>
            <span className="kgv3-badge">
              {mode === "star" ? "星图模式" : "关系图谱"}
            </span>
          </div>
          <p className="kgv3-desc">
            {mode === "star"
              ? "星图模式突出「中心—星团—星点」分层结构，适合总览知识宇宙分布。双击星团可进入对应模块。"
              : "关系图谱强调节点之间的连接网络，更适合查看依赖与跨域关联。"}
          </p>
          <div className="kgv3-metrics">
            <div className="kgv3-metric"><span>知识域</span><strong>6</strong></div>
            <div className="kgv3-metric"><span>核心节点</span><strong>{stats.vertices.toLocaleString("zh-CN")}</strong></div>
            <div className="kgv3-metric"><span>关联节点</span><strong>{Math.max(stats.edges, 3158).toLocaleString("zh-CN")}</strong></div>
            <div className="kgv3-metric"><span>关系总数</span><strong>{edgeCount}</strong></div>
          </div>
        </div>

        <>
            <div className="kgv3-card">
              <h3>{selected ? "选中节点详情" : "节点详情"}</h3>
              {!selected ? (
                <div className="kgv3-hint">点击任意星点，可查看所属知识域与入口；双击核心星团直接进入模块。</div>
              ) : (
                <div className="kgv3-node-meta">
                  <div className="kgv3-node-title">
                    <span className="kgv3-node-symbol" style={{ color: selected.color }}><CompassOutlined /></span>
                    <b>{selected.name}</b>
                  </div>
                  <div className="kgv3-node-line"><span>类型</span><b>{selected.type === "center" ? "系统中心" : selected.type === "core" ? "知识域" : "关联节点"}</b></div>
                  <div className="kgv3-node-line"><span>说明</span><b>{selected.desc || selected.count || "—"}</b></div>
                  {selected.route && (
                    <div className="kgv3-actions">
                      <button type="button" className="primary" onClick={() => nav(selected.route!)}>
                        进入模块 <RightOutlined />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="kgv3-card">
              <h3>星团分布</h3>
              <div className="kgv3-bars">
                {DOMAINS.map((d, index) => (
                  <button
                    type="button"
                    className={`kgv3-bar-row ${selected?.group === index ? "active" : ""}`}
                    key={d.name}
                    onClick={() => selectDomain(index)}
                    aria-label={`查看${d.name}星团`}
                  >
                    <span>{d.name}</span>
                    <div className="kgv3-bar"><b style={{ width: `${d.share * 3.2}%`, background: `linear-gradient(90deg, ${d.color}, ${hexToRgba(d.color, 0.55)})` }} /></div>
                    <em>{d.share}%</em>
                  </button>
                ))}
              </div>
            </div>

            <div className="kgv3-card">
              <h3>最近更新</h3>
              {feedRows.map((row, i) => (
                <div className="kgv3-update" key={`${row.text}-${i}`}>
                  <div className="kgv3-update-icon" style={{ color: DOMAINS[i % DOMAINS.length].color }}>
                    <DeploymentUnitOutlined />
                  </div>
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
        </>
      </aside>}
    </div>
  );
}

const css = `
.kgv3-page {
  --kg-bg: #fbfcff;
  --kg-line: rgba(137,157,204,.18);
  --kg-text: #17243c;
  --kg-muted: #7d8ba6;
  --kg-brand: #376dff;
  --kg-brand-soft: #edf3ff;
  --kg-shadow: 0 16px 48px rgba(66,88,140,.07);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 268px;
  height: calc(100vh - 68px);
  margin: 0;
  background: var(--kg-bg);
  color: var(--kg-text);
  overflow: hidden;
}
.kgv3-workspace {
  min-width: 0;
  min-height: 0;
  padding: 0;
}
.kgv3-graph-card {
  position: relative;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: #fbfcff;
  box-shadow: none;
  overflow: hidden;
}
.kgv3-graph-card::before {
  display: none;
}
.kgv3-toolbar {
  position: absolute;
  left: 20px; right: 20px; top: 18px;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.kgv3-tool-btn {
  height: 38px;
  border-radius: 15px;
  border: 1px solid var(--kg-line);
  background: rgba(255,255,255,.78);
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #44536d;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(65,87,139,.06);
  backdrop-filter: blur(14px);
  font-weight: 600;
  transition: border-color .2s ease, box-shadow .2s ease, transform .2s ease;
}
.kgv3-tool-btn:hover {
  border-color: rgba(78,111,214,.3);
  box-shadow: 0 10px 28px rgba(65,87,139,.1);
  transform: translateY(-1px);
}
.kgv3-tool-chevron { color: #9aa7bd; font-size: 10px; }
.kgv3-mode {
  position: relative;
  display: flex;
  padding: 4px;
  background: rgba(245,248,254,.76);
  border: 1px solid var(--kg-line);
  border-radius: 17px;
  box-shadow: 0 8px 24px rgba(65,87,139,.05);
  backdrop-filter: blur(14px);
}
.kgv3-mode-pill {
  position: absolute; top: 4px; left: 4px;
  height: 36px; width: 104px; border-radius: 12px;
  background: rgba(255,255,255,.94);
  box-shadow: 0 8px 20px rgba(49,94,251,.11), inset 0 0 0 1px rgba(255,255,255,.8);
  transition: .28s ease;
}
.kgv3-mode.star .kgv3-mode-pill { transform: translateX(104px); }
.kgv3-mode.map .kgv3-mode-pill { transform: translateX(208px); }
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
  position: absolute; left: 20px; bottom: 20px; z-index: 8;
  display: flex;
  background: rgba(255,255,255,.84); border: 1px solid var(--kg-line); border-radius: 16px; overflow: hidden;
  box-shadow: 0 10px 26px rgba(58,82,136,.07);
  backdrop-filter: blur(12px);
}
.kgv3-zoom button {
  width: 40px; height: 38px; border: 0; border-right: 1px solid var(--kg-line);
  background: transparent; cursor: pointer; font-size: 14px; color: #4b5870;
  transition: background .2s ease, color .2s ease;
}
.kgv3-zoom button:hover { background: #f3f7ff; color: var(--kg-brand); }
.kgv3-zoom button:last-child { border-right: 0; }
.kgv3-legend {
  position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%);
  z-index: 8; display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 9px 16px; background: rgba(255,255,255,.78);
  border: 1px solid var(--kg-line); border-radius: 18px;
  box-shadow: 0 10px 28px rgba(58,82,136,.06); color: #6c7890; font-size: 11px;
  backdrop-filter: blur(14px);
}
.kgv3-legend i {
  width: 9px; height: 9px; border-radius: 50%; display: inline-block; margin-right: 6px;
}
.kgv3-page.map-mode .kgv3-zoom,
.kgv3-page.map-mode .kgv3-legend { display: none; }
.kgv3-page.map-mode .kgv3-canvas { display: none; }
.kgv3-page.map-mode { grid-template-columns: minmax(0, 1fr); }
.kgv3-page.map-mode .kgv3-toolbar { right: 346px; }
.kgv3-page.map-mode .kgv3-tool-btn { visibility: hidden; }

.kgv3-right {
  min-width: 0; min-height: 0;
  border-left: 1px solid var(--kg-line);
  background: rgba(255,255,255,.9);
  padding: 0 22px;
  overflow: auto;
  box-shadow: -16px 0 48px rgba(81,100,145,.035);
}
.kgv3-card {
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--kg-line);
  border-radius: 0;
  padding: 22px 0;
  box-shadow: none;
  margin: 0;
}
.kgv3-card.muted { background: transparent; border-bottom: 0; }
.kgv3-card h2, .kgv3-card h3 { margin: 0 0 8px; color: var(--kg-text); }
.kgv3-card h2 { font-size: 20px; letter-spacing: -.02em; }
.kgv3-card h3 { font-size: 13px; letter-spacing: .02em; }
.kgv3-card-head {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
}
.kgv3-badge {
  display: inline-flex; align-items: center; height: 24px; padding: 0 10px;
  border-radius: 999px; background: var(--kg-brand-soft); color: var(--kg-brand);
  font-size: 12px; font-weight: 600;
}
.kgv3-page.map-mode .kgv3-badge { color: #2f7896; background: rgba(224,242,244,.72); }
.kgv3-desc { font-size: 13px; line-height: 1.75; color: #7b879c; margin: 0; }
.kgv3-metrics {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 16px;
}
.kgv3-metric {
  padding: 10px 0 12px;
  border-bottom: 1px solid rgba(137,157,204,.12);
}
.kgv3-metric:nth-child(odd) { border-right: 1px solid rgba(137,157,204,.12); }
.kgv3-metric:nth-child(even) { padding-left: 20px; }
.kgv3-metric span { display: block; font-size: 11px; color: #8c97a9; }
.kgv3-metric strong { display: block; font-size: 20px; margin-top: 5px; color: var(--kg-text); letter-spacing: -.02em; }
.kgv3-hint {
  font-size: 12px; line-height: 1.7; color: #8d99ac; padding: 8px 0;
}
.kgv3-node-meta { display: grid; gap: 10px; margin-top: 4px; }
.kgv3-node-title { display: flex; align-items: center; gap: 10px; }
.kgv3-node-symbol,
.kgv3-node-popover__signal {
  width: 28px; height: 28px; border-radius: 50%; flex: none;
  display: grid; place-items: center; background: #f3f7ff;
}
.kgv3-node-line {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 8px 0; border-bottom: 1px solid rgba(137,157,204,.12); font-size: 12px;
}
.kgv3-node-line span { color: #8995aa; }
.kgv3-node-line b { color: var(--kg-text); font-weight: 600; text-align: right; }
.kgv3-actions { display: flex; gap: 10px; margin-top: 4px; }
.kgv3-actions button {
  height: 34px; border-radius: 12px; border: 1px solid var(--kg-line);
  background: #fff; padding: 0 12px; cursor: pointer;
  display: inline-flex; align-items: center; gap: 8px;
}
.kgv3-actions .primary {
  background: #f3f7ff; border-color: #e4ebff; color: var(--kg-brand);
}
.kgv3-route-card { padding-top: 20px; }
.kgv3-route-list { display: grid; margin-top: 12px; }
.kgv3-route-step {
  position: relative;
  display: grid;
  grid-template-columns: 40px 1fr;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 58px;
  padding: 7px 5px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--kg-text);
  text-align: left;
  cursor: pointer;
}
.kgv3-route-step:hover,
.kgv3-route-step.active { background: rgba(237,243,255,.72); }
.kgv3-route-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 17px;
}
.kgv3-route-copy b,
.kgv3-route-copy em { display: block; }
.kgv3-route-copy b { font-size: 12px; }
.kgv3-route-copy em { margin-top: 3px; color: #8995aa; font-size: 10px; font-style: normal; }
.kgv3-route-arrow { position: absolute; left: 18px; bottom: -5px; color: #abc0e7; font-size: 9px; }
.kgv3-route-primary {
  width: 100%;
  height: 36px;
  margin-top: 14px;
  border: 1px solid #315efb;
  border-radius: 10px;
  background: #fff;
  color: #315efb;
  font-weight: 650;
  cursor: pointer;
}
.kgv3-bars { display: grid; gap: 10px; }
.kgv3-bar-row {
  display: grid; grid-template-columns: 64px 1fr 42px; gap: 8px;
  width: 100%; padding: 3px 4px; margin: -3px -4px;
  border: 0; border-radius: 8px; background: transparent;
  align-items: center; text-align: left; font: inherit; font-size: 12px; color: #66738a;
  cursor: pointer; transition: background .18s ease, color .18s ease;
}
.kgv3-bar-row:hover, .kgv3-bar-row:focus-visible, .kgv3-bar-row.active { background: rgba(237,243,255,.82); color: #315efb; }
.kgv3-bar-row:focus-visible { outline: 2px solid rgba(49,94,251,.28); outline-offset: 2px; }
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
  width: 28px; height: 28px; border-radius: 50%; background: #f4f7fd;
  display: grid; place-items: center; flex: none;
}
.kgv3-update b { display: block; margin-bottom: 4px; color: var(--kg-text); }
.kgv3-update span { color: #9aa4b5; }
.kgv3-mini-stats {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
}
.kgv3-mini-stats span { display: block; font-size: 11px; color: #8c97a9; }
.kgv3-mini-stats strong { display: block; font-size: 18px; margin-top: 4px; }

.kgv3-node-popover {
  position: absolute;
  z-index: 9;
  width: 220px;
  padding: 14px;
  border: 1px solid rgba(143,164,210,.2);
  border-radius: 16px;
  background: rgba(255,255,255,.86);
  box-shadow: 0 18px 50px rgba(71,94,146,.12);
  backdrop-filter: blur(18px);
  color: var(--kg-text);
  animation: kgv3-popover-in .28s ease both;
}
.kgv3-node-popover__head { display: flex; align-items: center; gap: 10px; }
.kgv3-node-popover__head b { display: block; font-size: 14px; }
.kgv3-node-popover__head span:not(.kgv3-node-popover__signal) { display: block; margin-top: 2px; color: #8490a5; font-size: 11px; }
.kgv3-node-popover p { margin: 10px 0; color: #72809a; font-size: 11px; line-height: 1.6; }
.kgv3-node-popover button {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0; border: 0; background: transparent; color: var(--kg-brand);
  font-size: 11px; font-weight: 650; cursor: pointer;
}
@keyframes kgv3-popover-in {
  from { opacity: 0; transform: translateY(6px) scale(.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@media (max-width: 1500px) {
  .kgv3-page.map-mode .kgv3-toolbar { right: 322px; }
}
@media (max-width: 1250px) {
  .kgv3-page.map-mode .kgv3-toolbar { right: 300px; }
}
@media (max-width: 1100px) {
  .kgv3-page { grid-template-columns: 1fr; height: auto; min-height: calc(100vh - 68px); }
  .kgv3-workspace { height: 62vh; min-height: 420px; }
  .kgv3-right { border-left: 0; border-top: 1px solid var(--kg-line); padding: 0 20px; }
  .kgv3-legend { display: none; }
}
@media (max-width: 640px) {
  .kgv3-workspace { height: 66vh; min-height: 480px; }
  .kgv3-toolbar { left: 12px; right: 12px; top: 12px; }
  .kgv3-page.map-mode .kgv3-toolbar { right: 12px; }
  .kgv3-tool-btn { padding: 0 11px; font-size: 12px; }
  .kgv3-toolbar-right { display: none; }
  .kgv3-mode button, .kgv3-mode-pill { width: 82px; }
  .kgv3-mode.star .kgv3-mode-pill { transform: translateX(82px); }
  .kgv3-mode.map .kgv3-mode-pill { transform: translateX(164px); }
  .kgv3-zoom { left: 12px; bottom: 12px; }
  .kgv3-node-popover { width: 190px; }
}
@media (prefers-reduced-motion: reduce) {
  .kgv3-node-popover { animation: none; }
  .kgv3-mode-pill, .kgv3-tool-btn { transition: none; }
}
`;
