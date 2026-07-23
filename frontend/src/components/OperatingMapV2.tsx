import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircleOutlined,
  RightOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import companyGoalBase from "../assets/business-map-v3/bases/company-goal.png";
import customerValueBase from "../assets/business-map-v3/bases/customer-value.png";
import knowledgeHub from "../assets/business-map-v3/core/ai-knowledge-hub.png";
import graphModule from "../assets/business-map-v3/modules/graph.png";
import knowledgeModule from "../assets/business-map-v3/modules/knowledge.png";
import skillModule from "../assets/business-map-v3/modules/skill.png";
import roundtableModule from "../assets/business-map-v3/modules/roundtable.png";
import connectModule from "../assets/business-map-v3/modules/connect.png";
import workflowModule from "../assets/business-map-v3/modules/workflow.png";
import planStage from "../assets/business-map-v3/stages/plan.png";
import executeStage from "../assets/business-map-v3/stages/execute.png";
import checkStage from "../assets/business-map-v3/stages/check.png";
import reviewStage from "../assets/business-map-v3/stages/review.png";
import "./OperatingMapV2.css";

type Props = {
  themeMode: "light" | "dark";
  onSelectDomain: (group: number) => void;
  onNavigate: (route: string) => void;
};

type Point = { x: number; y: number };
type StageId = "plan" | "execute" | "check" | "review";
type NodeKind = "module" | "stage" | "base" | "core";

type MapModule = {
  id: string;
  label: string;
  english: string;
  summary: string;
  color: string;
  route: string;
  group: number;
  stage: StageId;
  capabilities: string[];
  related: string[];
  image: string;
  position: Point;
  width: number;
};

type Stage = {
  id: StageId;
  order: string;
  label: string;
  summary: string;
  color: string;
  image: string;
  position: Point;
  width: number;
};

type Base = {
  id: "company-goal" | "customer-value";
  label: string;
  subtitle: string;
  summary: string;
  path: string;
  capabilities: string[];
  related: string[];
  image: string;
  position: Point;
  width: number;
};

const STAGES: Stage[] = [
  { id: "plan", order: "01", label: "计划", summary: "从战略目标出发，明确本轮经营重点与行动策略。", color: "#7d8cff", image: planStage, position: { x: .5, y: .31 }, width: 7.8 },
  { id: "execute", order: "02", label: "执行", summary: "调度组织能力，让任务、技能与协作形成可交付结果。", color: "#4e9cff", image: executeStage, position: { x: .66, y: .5 }, width: 7.8 },
  { id: "check", order: "03", label: "检查", summary: "持续评估执行效果，识别偏差、风险与客户价值。", color: "#31c6e7", image: checkStage, position: { x: .5, y: .69 }, width: 7.8 },
  { id: "review", order: "04", label: "复盘", summary: "沉淀经验与判断，让成果和问题进入下一轮学习。", color: "#7c6cf2", image: reviewStage, position: { x: .34, y: .5 }, width: 7.8 },
];

const MODULES: MapModule[] = [
  {
    id: "graph", label: "图谱", english: "Graph", color: "#6d63ef", route: "/ontology", group: 5, stage: "review",
    summary: "建立知识实体、关系与因果链路，让组织经验形成可理解、可追溯的网络。",
    capabilities: ["实体关系建模", "因果链路追踪", "知识关联发现", "跨域关系查询"],
    related: ["复盘", "知识库", "连接"], image: graphModule, position: { x: .21, y: .27 }, width: 9.4,
  },
  {
    id: "knowledge", label: "知识库", english: "Knowledge", color: "#3276f4", route: "/knowledge", group: 0, stage: "plan",
    summary: "集中沉淀与管理组织的知识资产，支持计划制定、执行落地与持续优化。",
    capabilities: ["知识沉淀与结构化管理", "知识检索与智能推荐", "版本管理与权限控制", "知识应用与场景映射", "知识运营与价值洞察"],
    related: ["计划", "执行", "检查", "复盘", "图谱", "连接", "技能", "圆桌会议"], image: knowledgeModule, position: { x: .5, y: .145 }, width: 10,
  },
  {
    id: "skill", label: "技能", english: "Skill", color: "#357df4", route: "/skills", group: 1, stage: "execute",
    summary: "把方法与工具封装为可复用能力，让知识能够被稳定调用并转化为行动。",
    capabilities: ["技能上传与管理", "能力启用与调用", "执行权限控制", "调用效果追踪"],
    related: ["执行", "知识库", "办流程"], image: skillModule, position: { x: .79, y: .27 }, width: 9.4,
  },
  {
    id: "roundtable", label: "圆桌会议", english: "Council", color: "#2686d9", route: "/collab?view=roundtable", group: 2, stage: "check",
    summary: "汇集多个专家共同研讨关键议题，把分散判断转化为可执行的集体决策。",
    capabilities: ["多专家协同研讨", "议题与材料汇聚", "结论共识沉淀", "决策行动追踪"],
    related: ["检查", "知识库", "图谱"], image: roundtableModule, position: { x: .79, y: .73 }, width: 9.5,
  },
  {
    id: "connect", label: "连接", english: "Connect", color: "#a8589f", route: "/connectors", group: 3, stage: "review",
    summary: "连接企微、业务系统与外部数据源，让经营闭环获得稳定、可控的上下文。",
    capabilities: ["外部系统接入", "身份与权限映射", "数据同步与回流", "连接状态监控"],
    related: ["复盘", "知识库", "图谱"], image: connectModule, position: { x: .5, y: .82 }, width: 9.4,
  },
  {
    id: "workflow", label: "办流程", english: "Workflow", color: "#e59432", route: "/work", group: 4, stage: "execute",
    summary: "把目标拆解为任务、审批与自动化流程，推动经营动作持续落地。",
    capabilities: ["流程编排与发起", "任务协同与交付", "审批规则管理", "执行记录审计"],
    related: ["执行", "技能", "连接"], image: workflowModule, position: { x: .21, y: .73 }, width: 9.4,
  },
];

const BASES: Base[] = [
  {
    id: "company-goal", label: "公司目标基地", subtitle: "愿景 · 战略 · 目标",
    summary: "以愿景、战略与目标牵引计划，定义每一轮经营闭环的方向。",
    path: "公司目标基地 → 计划 → AI 知识库中枢", capabilities: ["愿景与战略对齐", "目标拆解与校准", "经营优先级管理"],
    related: ["计划", "知识库", "图谱"], image: companyGoalBase, position: { x: .095, y: .5 }, width: 13.6,
  },
  {
    id: "customer-value", label: "客户价值基地", subtitle: "价值 · 成果 · 增长",
    summary: "承接价值、成果与增长，让执行结果回流并进入下一轮复盘。",
    path: "AI 知识库中枢 → 检查 → 客户价值基地", capabilities: ["客户价值验证", "经营成果衡量", "增长机会识别"],
    related: ["检查", "复盘", "圆桌会议"], image: customerValueBase, position: { x: .905, y: .5 }, width: 13.6,
  },
];

const HUB = {
  id: "knowledge-hub",
  label: "AI 知识库中枢",
  summary: "让目标、知识、行动与反馈在同一套经营语境中循环协同。",
  capabilities: ["统一经营上下文", "跨模块知识调度", "过程反馈回流", "闭环经验沉淀"],
  related: ["计划", "执行", "检查", "复盘"],
  image: knowledgeHub,
  position: { x: .5, y: .5 },
  width: 11.4,
};

const STAGE_NEXT: Record<StageId, StageId> = { plan: "execute", execute: "check", check: "review", review: "plan" };

type RoadPoint = [number, number];

// The operating loop is drawn in the same orbital language as Star Mode. All
// geometry stays in normalized coordinates so the constellation scales with the
// available desktop workspace.
const ROAD_PATHS: Record<string, RoadPoint[]> = {
  "loop:plan-execute": [[.5, .31], [.57, .325], [.625, .39], [.66, .5]],
  "loop:execute-check": [[.66, .5], [.64, .59], [.58, .67], [.5, .69]],
  "loop:check-review": [[.5, .69], [.42, .67], [.36, .59], [.34, .5]],
  "loop:review-plan": [[.34, .5], [.36, .41], [.42, .33], [.5, .31]],
  "spoke:plan": [[.5, .31], [.5, .405], [.5, .5]],
  "spoke:execute": [[.66, .5], [.58, .5], [.5, .5]],
  "spoke:check": [[.5, .69], [.5, .595], [.5, .5]],
  "spoke:review": [[.34, .5], [.42, .5], [.5, .5]],
  "module:knowledge": [[.5, .145], [.5, .225], [.5, .31]],
  "module:graph": [[.21, .27], [.28, .29], [.37, .30], [.5, .31]],
  "module:skill": [[.79, .27], [.72, .29], [.63, .30], [.5, .31]],
  "module:roundtable": [[.79, .73], [.72, .71], [.62, .70], [.5, .69]],
  "module:connect": [[.5, .82], [.5, .755], [.5, .69]],
  "module:workflow": [[.21, .73], [.28, .71], [.38, .70], [.5, .69]],
  "base:company-goal": [[.095, .5], [.2, .5], [.34, .5], [.42, .405], [.5, .31]],
  "base:customer-value": [[.5, .69], [.58, .595], [.66, .5], [.8, .5], [.905, .5]],
};

export default function OperatingMapV2({ themeMode, onSelectDomain, onNavigate }: Props) {
  const artboardRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedId, setSelectedId] = useState<string>("knowledge");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const selectedModule = MODULES.find((item) => item.id === selectedId);
  const selectedStage = STAGES.find((item) => item.id === selectedId);
  const selectedBase = BASES.find((item) => item.id === selectedId);
  const activeModule = MODULES.find((item) => item.id === (hoveredId || selectedId));
  const activeStageId: StageId | null = selectedStage?.id || activeModule?.stage || null;
  const selectedBaseStageId: StageId | null = selectedBase?.id === "company-goal"
    ? "plan"
    : selectedBase?.id === "customer-value"
      ? "check"
      : null;

  const panel = useMemo(() => {
    if (selectedModule) return {
      id: selectedModule.id, label: selectedModule.label, english: selectedModule.english, kind: "业务模块" as const,
      color: selectedModule.color, image: selectedModule.image, summary: selectedModule.summary,
      capabilities: selectedModule.capabilities,
      path: `${selectedModule.label} → ${STAGES.find((stage) => stage.id === selectedModule.stage)?.label} → AI 知识库中枢`,
      related: selectedModule.related, route: selectedModule.route, action: `进入${selectedModule.label}`,
    };
    if (selectedStage) return {
      id: selectedStage.id, label: selectedStage.label, english: `LOOP ${selectedStage.order}`, kind: "经营阶段" as const,
      color: selectedStage.color, image: selectedStage.image, summary: selectedStage.summary,
      capabilities: MODULES.filter((item) => item.stage === selectedStage.id).map((item) => `${item.label}参与${selectedStage.label}`).concat(["连接 AI 知识库中枢", `完成后进入${STAGES.find((stage) => stage.id === STAGE_NEXT[selectedStage.id])?.label}`]),
      path: `${selectedStage.label} → ${STAGES.find((stage) => stage.id === STAGE_NEXT[selectedStage.id])?.label} → AI 知识库中枢`,
      related: MODULES.filter((item) => item.stage === selectedStage.id).map((item) => item.label), route: "", action: "",
    };
    if (selectedBase) return {
      id: selectedBase.id, label: selectedBase.label, english: selectedBase.subtitle, kind: "经营基地" as const,
      color: "#3578d7", image: selectedBase.image, summary: selectedBase.summary,
      capabilities: selectedBase.capabilities, path: selectedBase.path, related: selectedBase.related, route: "", action: "",
    };
    return {
      id: HUB.id, label: HUB.label, english: "KNOWLEDGE CORE", kind: "知识中枢" as const,
      color: "#2f78e7", image: HUB.image, summary: HUB.summary,
      capabilities: HUB.capabilities, path: "目标 → LOOP 闭环 → 客户价值", related: HUB.related, route: "/knowledge", action: "进入知识库",
    };
  }, [selectedBase, selectedModule, selectedStage]);

  useEffect(() => {
    const artboard = artboardRef.current;
    const canvas = canvasRef.current;
    if (!artboard || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    const dark = themeMode === "dark";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => {
      const rect = artboard.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    };

    const toPixel = (point: Point) => ({ x: point.x * width, y: point.y * height });

    const drawStarfield = (time: number) => {
      const centerX = width * .5;
      const centerY = height * .5;

      const nebula = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * .62);
      nebula.addColorStop(0, dark ? "rgba(44,88,180,.18)" : "rgba(115,153,230,.15)");
      nebula.addColorStop(.42, dark ? "rgba(49,57,139,.09)" : "rgba(181,196,238,.11)");
      nebula.addColorStop(1, dark ? "rgba(4,10,28,0)" : "rgba(248,251,255,0)");
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, width, height);

      for (let index = 0; index < 150; index += 1) {
        const x = ((index * 89) % 997) / 997 * width;
        const y = ((index * 163 + 47) % 991) / 991 * height;
        const radius = .45 + (index % 5) * .18;
        const pulse = reduceMotion ? .7 : .52 + Math.sin(time * .0012 + index * 1.71) * .24;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = dark
          ? `rgba(137,181,255,${Math.max(.08, pulse)})`
          : `rgba(89,130,208,${Math.max(.06, pulse * .48)})`;
        ctx.fill();
      }

      ctx.save();
      ctx.translate(centerX, centerY);
      for (let ring = 0; ring < 12; ring += 1) {
        const radius = 54 + ring * Math.min(width * .037, 46);
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 1.46, radius * .66, -.02, 0, Math.PI * 2);
        ctx.strokeStyle = dark
          ? `rgba(105,139,212,${.055 + ring * .005})`
          : `rgba(103,129,190,${.065 + ring * .005})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.setLineDash([3, 8]);
      ctx.strokeStyle = dark ? "rgba(105,150,237,.13)" : "rgba(92,126,197,.18)";
      ctx.beginPath();
      ctx.ellipse(0, 0, width * .405, height * .36, -.02, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      const anchors = [
        ...BASES.map((item) => ({ id: item.id, ...item.position, color: "#4e9cff", radius: 48 })),
        ...MODULES.map((item) => ({ id: item.id, ...item.position, color: item.color, radius: 35 })),
        ...STAGES.map((item) => ({ id: item.id, ...item.position, color: item.color, radius: 29 })),
        { id: HUB.id, ...HUB.position, color: "#4f8dff", radius: 48 },
      ];

      anchors.forEach((anchor) => {
        const point = toPixel(anchor);
        const active = selectedId === anchor.id || hoveredId === anchor.id;
        const halo = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, anchor.radius * 2.2);
        halo.addColorStop(0, active
          ? (dark ? "rgba(89,153,255,.26)" : "rgba(76,129,232,.18)")
          : (dark ? "rgba(67,113,210,.11)" : "rgba(105,143,215,.08)"));
        halo.addColorStop(1, dark ? "rgba(5,12,31,0)" : "rgba(248,251,255,0)");
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.ellipse(point.x, point.y, anchor.radius * 2.1, anchor.radius * .74, -.02, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = active
          ? (dark ? "rgba(117,177,255,.62)" : "rgba(68,119,220,.5)")
          : (dark ? "rgba(105,145,223,.22)" : "rgba(101,133,198,.18)");
        ctx.lineWidth = active ? 1.4 : .8;
        ctx.beginPath();
        ctx.ellipse(point.x, point.y, anchor.radius * 1.52, anchor.radius * .55, -.02, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });
    };

    const pixelRoad = (key: string) => ROAD_PATHS[key].map(([x, y]) => ({ x: x * width, y: y * height }));

    const traceRoad = (key: string) => {
      const points = pixelRoad(key);
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    };

    const pointAlongRoad = (key: string, progress: number) => {
      const points = pixelRoad(key);
      const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
      const total = lengths.reduce((sum, length) => sum + length, 0);
      let distance = total * progress;
      for (let index = 0; index < lengths.length; index += 1) {
        if (distance <= lengths[index]) {
          const ratio = lengths[index] ? distance / lengths[index] : 0;
          return {
            x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
            y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
          };
        }
        distance -= lengths[index];
      }
      return points[points.length - 1];
    };

    const strokeRoad = (key: string, active: boolean, strong = false) => {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = active
        ? (dark ? "rgba(79,145,255,.25)" : "rgba(57,119,230,.2)")
        : (dark ? "rgba(116,151,221,.13)" : "rgba(111,139,196,.15)");
      ctx.lineWidth = active ? (strong ? 12 : 9) : 1;
      ctx.beginPath();
      traceRoad(key);
      ctx.stroke();
      if (active) {
        ctx.shadowBlur = 16;
        ctx.shadowColor = dark ? "rgba(79,150,255,.72)" : "rgba(66,125,226,.38)";
        ctx.strokeStyle = dark ? "rgba(91,159,255,.96)" : "rgba(55,113,219,.82)";
        ctx.lineWidth = strong ? 3.8 : 3.1;
        ctx.beginPath();
        traceRoad(key);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.setLineDash([4, 8]);
        ctx.strokeStyle = dark ? "rgba(217,237,255,.94)" : "rgba(255,255,255,.96)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        traceRoad(key);
        ctx.stroke();
      }
      ctx.restore();
    };

    const draw = (time = 0) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      drawStarfield(time);

      STAGES.forEach((stage) => {
        const next = STAGE_NEXT[stage.id];
        strokeRoad(`loop:${stage.id}-${next}`, selectedStage?.id === stage.id, true);
      });

      STAGES.forEach((stage) => {
        strokeRoad(`spoke:${stage.id}`, activeStageId === stage.id || selectedBaseStageId === stage.id, true);
      });

      strokeRoad("base:company-goal", selectedId === "company-goal");
      strokeRoad("base:customer-value", selectedId === "customer-value");

      MODULES.forEach((item) => {
        const isActive = activeModule?.id === item.id;
        strokeRoad(`module:${item.id}`, isActive);
      });

      const animatedRoads: string[] = [];
      if (activeModule) animatedRoads.push(`module:${activeModule.id}`, `spoke:${activeModule.stage}`);
      else if (selectedStage) animatedRoads.push(`loop:${selectedStage.id}-${STAGE_NEXT[selectedStage.id]}`);
      else if (selectedBase) animatedRoads.push(`base:${selectedBase.id}`, `spoke:${selectedBaseStageId}`);

      animatedRoads.forEach((key, index) => {
        const progress = reduceMotion ? .55 : ((time * .00024) + index * .34) % 1;
        const { x, y } = pointAlongRoad(key, progress);
        ctx.save();
        ctx.shadowBlur = 15;
        ctx.shadowColor = dark ? "#64b4ff" : "#457fd8";
        ctx.fillStyle = "#f5fbff";
        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = dark ? "#5da7ff" : "#3d72c7";
        ctx.stroke();
        ctx.restore();
      });

      if (!reduceMotion) frame = window.requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(() => { resize(); if (reduceMotion) draw(); });
    observer.observe(artboard);
    frame = window.requestAnimationFrame(draw);
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame); };
  }, [activeModule, activeStageId, selectedBase, selectedBaseStageId, selectedId, selectedStage, themeMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedId("knowledge");
        setHoveredId(null);
        onSelectDomain(0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSelectDomain]);

  const selectModule = (item: MapModule) => {
    setSelectedId(item.id);
    onSelectDomain(item.group);
  };

  const selectNodeByLabel = (label: string) => {
    const module = MODULES.find((item) => item.label === label);
    if (module) return selectModule(module);
    const stage = STAGES.find((item) => item.label === label);
    if (stage) {
      setSelectedId(stage.id);
    }
  };

  const nodeClass = (id: string, kind: NodeKind, stage?: StageId) => {
    const isSelected = selectedId === id;
    const isRelatedStage = selectedStage && stage === selectedStage.id;
    const isPathNode = (kind === "stage" && (selectedModule?.stage === id || selectedBaseStageId === id))
      || (kind === "core" && Boolean(selectedModule || selectedStage || selectedBase));
    const shouldDim = hoveredId && kind === "module" && hoveredId !== id;
    return ["operating-map-v2__node", `is-${kind}`, isSelected ? "is-selected" : "", isRelatedStage ? "is-related" : "", isPathNode ? "is-path" : "", shouldDim ? "is-dimmed" : ""].filter(Boolean).join(" ");
  };

  return (
    <section className={`operating-map-v2 is-${themeMode}`} aria-label="AI 驱动的公司经营地图">
      <div className="operating-map-v2__map">
        <header className="operating-map-v2__title">
          <strong>AI 驱动的经营闭环</strong>
          <span>目标牵引 · 知识驱动 · 行动反馈 · 持续进化</span>
        </header>

        <div className="operating-map-v2__map-shell">
          <div className="operating-map-v2__artboard" ref={artboardRef}>
            <canvas ref={canvasRef} className="operating-map-v2__canvas" aria-hidden="true" />

            {BASES.map((base) => (
            <button
              type="button"
              key={base.id}
              className={nodeClass(base.id, "base")}
              style={{ "--node-x": `${base.position.x * 100}%`, "--node-y": `${base.position.y * 100}%`, "--node-width": `${base.width}%` } as React.CSSProperties}
              onClick={() => { setSelectedId(base.id); }}
              aria-label={`查看${base.label}`}
            >
              <img src={base.image} alt="" />
              <span className="operating-map-v2__label"><b>{base.label}</b><em>{base.subtitle}</em></span>
            </button>
          ))}

          <button
            type="button"
            className={nodeClass(HUB.id, "core")}
            style={{ "--node-x": `${HUB.position.x * 100}%`, "--node-y": `${HUB.position.y * 100}%`, "--node-width": `${HUB.width}%` } as React.CSSProperties}
            onClick={() => { setSelectedId(HUB.id); }}
            aria-label="查看 AI 知识库中枢"
          >
            <img src={HUB.image} alt="" />
            <span className="operating-map-v2__label"><b>{HUB.label}</b></span>
          </button>

          {STAGES.map((stage) => (
            <button
              type="button"
              className={nodeClass(stage.id, "stage")}
              style={{ "--node-x": `${stage.position.x * 100}%`, "--node-y": `${stage.position.y * 100}%`, "--node-width": `${stage.width}%`, "--node-color": stage.color } as React.CSSProperties}
              onClick={() => { setSelectedId(stage.id); }}
              key={stage.id}
              aria-label={`经营闭环第${stage.order}阶段：${stage.label}`}
            >
              <span className="operating-map-v2__order">{stage.order}</span>
              <img src={stage.image} alt="" />
              <span className="operating-map-v2__label"><b>{stage.label}</b></span>
            </button>
          ))}

          {MODULES.map((item) => (
            <button
              type="button"
              className={nodeClass(item.id, "module", item.stage)}
              style={{ "--node-x": `${item.position.x * 100}%`, "--node-y": `${item.position.y * 100}%`, "--node-width": `${item.width}%`, "--node-color": item.color } as React.CSSProperties}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(item.id)}
              onBlur={() => setHoveredId(null)}
              onClick={() => selectModule(item)}
              onDoubleClick={() => onNavigate(item.route)}
              aria-label={`${item.label}模块，单击查看，双击进入`}
              key={item.id}
            >
              <img src={item.image} alt="" />
              <span className="operating-map-v2__label"><b>{item.label}</b></span>
            </button>
          ))}
          </div>
        </div>

        <div className="operating-map-v2__motto"><i /><TrophyOutlined /><b>让组织像一支会学习、会协同、会进化的战队</b><i /></div>
      </div>

      <aside className="operating-map-v2__panel" aria-live="polite">
        <div className="operating-map-v2__panel-head">
          <span className="operating-map-v2__panel-icon"><img src={panel.image} alt="" /></span>
          <div><h2>{panel.label}</h2><span>{panel.kind}</span></div>
        </div>
        <p className="operating-map-v2__panel-summary">{panel.summary}</p>

        <section>
          <h3>主要能力</h3>
          <ul>{panel.capabilities.map((capability) => <li key={capability}><CheckCircleOutlined />{capability}</li>)}</ul>
        </section>

        <section>
          <h3>当前关联路径</h3>
          <div className="operating-map-v2__path">
            {panel.path.split(" → ").map((item, index, list) => (
              <span key={`${item}-${index}`}><b className={index === 1 ? "active" : ""}>{item}</b>{index < list.length - 1 && <RightOutlined />}</span>
            ))}
          </div>
        </section>

        <section>
          <h3>关联模块</h3>
          <div className="operating-map-v2__related">
            {panel.related.map((item) => <button type="button" key={item} onClick={() => selectNodeByLabel(item)}>{item}</button>)}
          </div>
        </section>

        <div className="operating-map-v2__panel-action">
          {panel.route ? (
            <button type="button" onClick={() => onNavigate(panel.route)}>{panel.action}<RightOutlined /></button>
          ) : (
            <p>继续点击地图节点，查看它在经营闭环中的位置与协作关系。</p>
          )}
          <small>单击查看详情 · 双击业务模块直接进入</small>
        </div>
      </aside>
    </section>
  );
}
