import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApartmentOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  DownOutlined,
  ExclamationCircleFilled,
  FundOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from "@ant-design/icons";

import {
  getAuditOverview,
  getCommerceFactsHealth,
  getGraph,
  listAgents,
  listKnowledgeBases,
  listLoops,
  listWorkAutomations,
  type Agent,
  type AuditOverview,
  type FeedbackLoop,
  type KnowledgeBaseItem,
  type OntGraph,
  type WorkAutomationStats,
} from "../api/client";
import { getPublishedTasks, type PublishedTask } from "../features/task-console/mockTasks";
import "./VisualInterface.css";

type IconComponent = ComponentType<{ className?: string }>;
type Tone = "blue" | "cyan" | "violet" | "orange";
type FactsHealth = Awaited<ReturnType<typeof getCommerceFactsHealth>>;
type DashboardData = {
  agents: Agent[];
  tasks: PublishedTask[];
  loops: FeedbackLoop[];
  graph: OntGraph | null;
  audit: AuditOverview | null;
  automations: WorkAutomationStats | null;
  knowledgeBases: KnowledgeBaseItem[];
  facts: FactsHealth | null;
};

const EMPTY_DATA: DashboardData = {
  agents: [], tasks: [], loops: [], graph: null, audit: null,
  automations: null, knowledgeBases: [], facts: null,
};
const COLORS = { blue: "#2678f2", cyan: "#20c4bd", violet: "#8b52ed", orange: "#ff941d" };
const LOOP_COLORS = [COLORS.blue, COLORS.cyan, COLORS.violet, COLORS.orange, "#93a1b8"];
const ONTOLOGY_TYPE_LABELS: Record<string, string> = {
  auth_permission: "系统权限",
  auth_user: "系统用户",
  authtoken_token: "访问令牌",
  dim_sku_inventory_map: "SKU 库存映射",
};

function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
  dependencies: unknown[] = [],
) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const paint = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      draw(ctx, width, height);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    const themeObserver = new MutationObserver(paint);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  return ref;
}

function canvasThemeColor(ctx: CanvasRenderingContext2D, token: string, fallback: string) {
  return getComputedStyle(ctx.canvas).getPropertyValue(token).trim() || fallback;
}

function EmptyState({ text = "暂无真实数据" }: { text?: string }) {
  return <div className="lc-dashboard__empty"><DatabaseOutlined /><span>{text}</span></div>;
}

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const ref = useCanvas((ctx, width, height) => {
    if (points.length < 2) return;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = Math.max(1, max - min);
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = 3 + index * ((width - 6) / (points.length - 1));
      const y = height - 4 - ((point - min) / range) * (height - 10);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [points, color]);
  return points.length > 1
    ? <canvas ref={ref} className="lc-dashboard__spark" aria-label="真实数据趋势" />
    : <small className="lc-dashboard__no-trend">暂无历史趋势</small>;
}

function MetricCard({ label, value, suffix, detail, icon: Icon, tone, points }: {
  label: string; value: string; suffix?: string; detail: string; icon: IconComponent; tone: Tone; points: number[];
}) {
  return (
    <article className="lc-dashboard__metric">
      <div className={`lc-dashboard__metric-icon is-${tone}`}><Icon /></div>
      <div className="lc-dashboard__metric-body">
        <span className="lc-dashboard__metric-label">{label}</span>
        <strong>{value}<small>{suffix}</small></strong>
        <div className="lc-dashboard__metric-foot"><span>{detail}</span><Sparkline points={points} color={COLORS[tone]} /></div>
      </div>
    </article>
  );
}

function buildTaskTrend(tasks: PublishedTask[], days: number) {
  const now = new Date();
  return Array.from({ length: Math.min(days, 14) }, (_, offset) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (Math.min(days, 14) - offset - 1));
    const next = new Date(date); next.setDate(next.getDate() + 1);
    const rows = tasks.filter((task) => {
      const timestamp = new Date(task.updatedAt).getTime();
      return timestamp >= date.getTime() && timestamp < next.getTime();
    });
    return {
      label: `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
      count: rows.length,
      rate: rows.length ? Math.round((rows.filter((task) => task.status === "completed").length / rows.length) * 100) : 0,
    };
  });
}

function TrendChart({ points }: { points: ReturnType<typeof buildTaskTrend> }) {
  const ref = useCanvas((ctx, width, height) => {
    if (!points.length) return;
    const pad = { left: 42, right: 34, top: 18, bottom: 34 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;
    const maxCount = Math.max(1, ...points.map((point) => point.count));
    ctx.font = '10px Inter, "PingFang SC", sans-serif';
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y);
      ctx.strokeStyle = canvasThemeColor(ctx, "--db-chart-grid", "#e8eef7"); ctx.stroke();
      ctx.fillStyle = canvasThemeColor(ctx, "--db-chart-label", "#75829a"); ctx.textAlign = "right";
      ctx.fillText(String(Math.round(maxCount * (1 - i / 4))), pad.left - 8, y + 3);
    }
    const xFor = (index: number) => pad.left + index * (chartW / Math.max(1, points.length - 1));
    const drawLine = (values: number[], max: number, color: string) => {
      ctx.beginPath();
      values.forEach((value, index) => {
        const y = pad.top + chartH - (value / Math.max(1, max)) * chartH;
        if (index === 0) ctx.moveTo(xFor(index), y); else ctx.lineTo(xFor(index), y);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    };
    drawLine(points.map((point) => point.count), maxCount, COLORS.blue);
    drawLine(points.map((point) => point.rate), 100, COLORS.cyan);
    ctx.textAlign = "center"; ctx.fillStyle = canvasThemeColor(ctx, "--db-chart-label", "#75829a");
    points.forEach((point, index) => {
      if (points.length <= 7 || index % 2 === 0 || index === points.length - 1) ctx.fillText(point.label, xFor(index), height - 9);
    });
  }, [points]);
  return <canvas ref={ref} className="lc-dashboard__trend-canvas" aria-label="真实任务执行数与完成率趋势图" />;
}

function DonutChart({ values, total }: { values: number[]; total: number }) {
  const ref = useCanvas((ctx, width, height) => {
    const cx = width * 0.38; const cy = height * 0.5; const radius = Math.min(width, height) * 0.31;
    let start = -Math.PI / 2;
    values.forEach((value, index) => {
      if (!value || !total) return;
      const end = start + Math.PI * 2 * (value / total);
      ctx.beginPath(); ctx.arc(cx, cy, radius, start, end);
      ctx.strokeStyle = LOOP_COLORS[index]; ctx.lineWidth = 22; ctx.stroke(); start = end + 0.02;
    });
    if (!total) { ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.strokeStyle = canvasThemeColor(ctx, "--db-chart-track", "#edf2f8"); ctx.lineWidth = 22; ctx.stroke(); }
    ctx.textAlign = "center"; ctx.fillStyle = canvasThemeColor(ctx, "--db-chart-label", "#536179"); ctx.font = '12px Inter, "PingFang SC", sans-serif'; ctx.fillText("Loop 总数", cx, cy - 5);
    ctx.fillStyle = canvasThemeColor(ctx, "--db-ink", "#101a33"); ctx.font = '700 20px Inter, "PingFang SC", sans-serif'; ctx.fillText(String(total), cx, cy + 20);
  }, [values, total]);
  return <canvas ref={ref} className="lc-dashboard__donut" aria-label={`真实经营回路总数 ${total}`} />;
}

function HealthGauge({ score }: { score: number | null }) {
  const ref = useCanvas((ctx, width, height) => {
    const cx = width / 2; const cy = height * 0.72; const radius = Math.min(width * 0.37, height * 0.58);
    ctx.beginPath(); ctx.arc(cx, cy, radius, Math.PI, Math.PI * 2); ctx.strokeStyle = canvasThemeColor(ctx, "--db-chart-track", "#e8eef7"); ctx.lineWidth = 13; ctx.lineCap = "round"; ctx.stroke();
    if (score !== null) {
      const gradient = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy); gradient.addColorStop(0, COLORS.blue); gradient.addColorStop(1, COLORS.cyan);
      ctx.beginPath(); ctx.arc(cx, cy, radius, Math.PI, Math.PI + Math.PI * (score / 100)); ctx.strokeStyle = gradient; ctx.lineWidth = 13; ctx.stroke();
    }
    ctx.fillStyle = canvasThemeColor(ctx, "--db-ink", "#101a33"); ctx.textAlign = "center"; ctx.font = "700 34px Inter, sans-serif"; ctx.fillText(score === null ? "—" : String(score), cx, cy - 16);
    ctx.fillStyle = score === null ? canvasThemeColor(ctx, "--db-chart-label", "#7d899d") : canvasThemeColor(ctx, "--db-success-text", "#19a96c"); ctx.font = '600 12px Inter, "PingFang SC", sans-serif'; ctx.fillText(score === null ? "暂无数据" : "健康", cx, cy + 8);
  }, [score]);
  return <canvas ref={ref} className="lc-dashboard__gauge" aria-label={score === null ? "系统健康度暂无数据" : `系统健康度 ${score} 分`} />;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date).replace(/\//g, "-");
}

export default function VisualInterface() {
  const navigate = useNavigate();
  const [range, setRange] = useState("7");
  const [activeStage, setActiveStage] = useState("do");
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true); setErrors([]);
    const end = new Date(); const start = new Date(); start.setDate(end.getDate() - Number(range) + 1);
    const results = await Promise.allSettled([
      listAgents(), getPublishedTasks("all"), listLoops(), getGraph({ scope: "all" }),
      getAuditOverview({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), pageSize: 30 }),
      listWorkAutomations(), listKnowledgeBases(), getCommerceFactsHealth(),
    ]);
    const failures: string[] = [];
    const read = <T,>(index: number, fallback: T): T => {
      const result = results[index];
      if (result.status === "fulfilled") return result.value as T;
      failures.push(result.reason?.response?.data?.detail || result.reason?.message || `数据源 ${index + 1} 加载失败`);
      return fallback;
    };
    const agents = read<Awaited<ReturnType<typeof listAgents>>>(0, { results: [], llm: false });
    const loops = read<Awaited<ReturnType<typeof listLoops>>>(2, { results: [] });
    const automations = read<Awaited<ReturnType<typeof listWorkAutomations>> | null>(5, null);
    setData({
      agents: agents.results, tasks: read(1, []), loops: loops.results, graph: read(3, null),
      audit: read(4, null), automations: automations?.stats || null, knowledgeBases: read(6, []), facts: read(7, null),
    });
    setErrors([...new Set(failures)]); setUpdatedAt(new Date()); setLoading(false);
  }, [range]);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);
  useEffect(() => { const previous = document.title; document.title = "良策 AI · 可视化经营驾驶舱"; return () => { document.title = previous; }; }, []);

  const taskTrend = useMemo(() => buildTaskTrend(data.tasks, Number(range)), [data.tasks, range]);
  const pendingTasks = useMemo(() => data.tasks.filter((task) => !["completed", "failed"].includes(task.status)).slice(0, 4), [data.tasks]);
  const alerts = useMemo(() => data.audit?.rows.filter((row) => ["failed", "error", "warning", "denied"].includes(row.status.key.toLowerCase())).slice(0, 3) || [], [data.audit]);
  const ontologyBars = useMemo(() => {
    const groups = new Map<string, number>();
    data.graph?.objects.forEach((object) => groups.set(object.otype || object.category, (groups.get(object.otype || object.category) || 0) + 1));
    return [...groups.entries()]
      .map(([type, count]) => ({ type, label: ONTOLOGY_TYPE_LABELS[type] || type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [data.graph]);
  const loopGroups = useMemo(() => {
    const groups = [data.loops.filter((loop) => loop.loop_type === "R").length, data.loops.filter((loop) => loop.loop_type === "B").length, data.loops.filter((loop) => loop.loop_type === "comp").length, data.loops.filter((loop) => loop.status === "candidate").length, data.loops.filter((loop) => loop.status === "archived").length];
    return groups;
  }, [data.loops]);
  const confirmedLoops = data.loops.filter((loop) => loop.status === "confirmed").length;
  const activeAgents = data.agents.filter((agent) => agent.is_active && agent.status === "available").length;
  const completedTasks = data.tasks.filter((task) => task.status === "completed").length;
  const latestTask = data.tasks[0];
  const flowStages = [
    { key: "check", title: "信号洞察", sub: "CHECK", icon: FundOutlined, threshold: 10 },
    { key: "plan", title: "任务规划", sub: "PLAN", icon: ApartmentOutlined, threshold: 30 },
    { key: "do", title: "安全执行", sub: "DO", icon: RobotOutlined, threshold: 60 },
    { key: "verify", title: "结果验证", sub: "CHECK", icon: SafetyCertificateOutlined, threshold: 90 },
    { key: "feedback", title: "回流反馈", sub: "LOOP", icon: SyncOutlined, threshold: 100 },
  ].map((stage, index, stages) => {
    const previousThreshold = index ? stages[index - 1].threshold : 0;
    const completed = Boolean(latestTask && (latestTask.status === "completed" || latestTask.progress >= stage.threshold));
    const running = Boolean(latestTask && !completed && latestTask.progress >= previousThreshold && latestTask.status !== "failed");
    return { ...stage, status: completed ? "已完成" : running ? "进行中" : "等待中", tone: completed ? "green" : running ? "blue" : "gray" };
  });
  const serviceRows = useMemo(() => {
    if (!data.facts) return [];
    return [
      { name: "DuckDB", ok: data.facts.duckdb.available, detail: `${data.facts.duckdb.table_count} 张表` },
      { name: "PostgreSQL", ok: data.facts.postgres.available, detail: `${data.facts.postgres.table_count} 张表` },
      ...data.facts.connectors.slice(0, 3).map((connector) => ({ name: connector.name, ok: ["ok", "connected", "available", "enabled"].includes(connector.status.toLowerCase()), detail: connector.note || connector.status })),
    ];
  }, [data.facts]);
  const healthScore = serviceRows.length ? Math.round((serviceRows.filter((row) => row.ok).length / serviceRows.length) * 100) : null;
  const assetRows = [
    ["Ontology 对象", data.graph?.objects.length ?? null], ["Ontology 关系", data.graph?.relations.length ?? null],
    ["知识库", data.knowledgeBases.length], ["知识文件", data.knowledgeBases.reduce((sum, base) => sum + base.file_count, 0)],
  ] as const;
  const maxAsset = Math.max(1, ...assetRows.map(([, value]) => value || 0));
  const metrics = [
    { label: "活跃智能体", value: String(activeAgents), detail: `${data.agents.length} 个已配置`, icon: RobotOutlined, tone: "blue" as Tone, points: [] },
    { label: "任务执行总数", value: data.tasks.length.toLocaleString(), detail: `${completedTasks} 个已完成`, icon: CheckCircleFilled, tone: "cyan" as Tone, points: taskTrend.map((point) => point.count) },
    { label: "Loop 闭环率", value: data.loops.length ? `${((confirmedLoops / data.loops.length) * 100).toFixed(1)}%` : "—", detail: `${confirmedLoops}/${data.loops.length} 已确认`, icon: SyncOutlined, tone: "violet" as Tone, points: [] },
    { label: "今日自动化运行", value: String(data.automations?.todayRuns ?? 0), detail: `${data.automations?.enabled ?? 0} 个流程已启用`, icon: ClockCircleOutlined, tone: "orange" as Tone, points: [] },
  ];

  return (
    <main className="lc-dashboard">
      <section className="lc-dashboard__workspace">
        <header className="lc-dashboard__header">
          <div className="lc-dashboard__title"><div><span>WORKSPACE INTELLIGENCE</span><h1>可视化经营驾驶舱</h1></div></div>
          <div className="lc-dashboard__header-tools">
            <span className={`lc-dashboard__live${errors.length ? " is-partial" : ""}`} title={errors.join("；")}><i />{loading ? "正在同步真实数据" : errors.length ? `${errors.length} 个数据源异常` : "真实数据已同步"}</span>
            <span className="lc-dashboard__date">更新于 {updatedAt ? updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
            <label className="lc-dashboard__range"><span>数据范围</span><select value={range} onChange={(event) => setRange(event.target.value)} aria-label="选择数据范围"><option value="7">近 7 天</option><option value="30">近 30 天</option></select><DownOutlined /></label>
            <button type="button" className="lc-dashboard__refresh" onClick={() => void loadDashboard()} disabled={loading}><ReloadOutlined spin={loading} /> 刷新</button>
          </div>
        </header>

        <div className="lc-dashboard__content" aria-busy={loading}>
          <div className="lc-dashboard__main-column">
            <section className="lc-dashboard__metrics" aria-label="真实经营核心指标">{metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}</section>
            <section className="lc-dashboard__chart-grid">
              <article className="lc-dashboard__panel lc-dashboard__trend-panel">
                <div className="lc-dashboard__panel-head"><div><h2>CPD 任务执行趋势</h2><span className="lc-dashboard__legend"><i className="is-blue" />任务数 <i className="is-cyan" />完成率</span></div><span className="lc-dashboard__chip">近 {range} 天</span></div>
                {data.tasks.length ? <TrendChart points={taskTrend} /> : <EmptyState text="当前范围内暂无任务数据" />}
              </article>
              <article className="lc-dashboard__panel lc-dashboard__bars-panel">
                <div className="lc-dashboard__panel-head"><h2>Ontology 对象分布</h2><button type="button" className="lc-dashboard__text-link" onClick={() => navigate("/ontology")}>查看图谱 ›</button></div>
                {ontologyBars.length ? <div className="lc-dashboard__bars" role="img" aria-label="Ontology 真实对象类型分布">{ontologyBars.map(({ type, label, count }) => <div className="lc-dashboard__bar-row" key={type}><span title={`${label}（${type}）`}>{label}</span><div><i style={{ width: `${(count / ontologyBars[0].count) * 100}%` }} /></div><b>{count.toLocaleString()}</b></div>)}</div> : <EmptyState text="Ontology 暂无对象" />}
              </article>
            </section>

            <section className="lc-dashboard__insight-grid">
              <article className="lc-dashboard__panel lc-dashboard__loop-panel"><div className="lc-dashboard__panel-head"><h2>经营 Loop 分布</h2></div><div className="lc-dashboard__loop-content"><DonutChart values={loopGroups} total={data.loops.length} /><ul>{[["R 强化环", loopGroups[0]], ["B 平衡环", loopGroups[1]], ["复合回路", loopGroups[2]], ["候选回路", loopGroups[3]], ["已归档", loopGroups[4]]].map(([label, value], index) => <li key={String(label)}><i style={{ background: LOOP_COLORS[index] }} /><span>{label}</span><b>{value}</b></li>)}</ul></div></article>
              <article className="lc-dashboard__panel lc-dashboard__flow-panel">
                <div className="lc-dashboard__panel-head"><div><h2>智能体 CPD 闭环流程</h2><small className="lc-dashboard__task-context">{latestTask ? `映射任务：${latestTask.title}` : "暂无可映射任务"}</small></div><span className="lc-dashboard__flow-legend"><i className="is-green" />已完成 <i className="is-blue" />进行中 <i />等待中</span></div>
                <div className="lc-dashboard__flow" role="list">{flowStages.map((stage, index) => { const Icon = stage.icon; return <div className="lc-dashboard__flow-item-wrap" role="listitem" key={stage.key}><button type="button" className={`lc-dashboard__flow-item is-${stage.tone}${activeStage === stage.key ? " is-active" : ""}`} onClick={() => setActiveStage(stage.key)} aria-pressed={activeStage === stage.key}><Icon /><strong>{stage.title}</strong><small>{stage.sub}</small><span>{stage.status}</span><em>{latestTask ? `${latestTask.progress}%` : "—"}</em></button>{index < flowStages.length - 1 && <span className="lc-dashboard__flow-arrow">→</span>}</div>; })}</div>
              </article>
            </section>

            <section className="lc-dashboard__table-grid">
              <article className="lc-dashboard__panel lc-dashboard__table-panel"><div className="lc-dashboard__panel-head"><h2>实时告警 <b className="lc-dashboard__count is-red">{alerts.length}</b></h2></div>{alerts.length ? <table><thead><tr><th>级别</th><th>告警内容</th><th>发生时间</th><th>状态</th></tr></thead><tbody>{alerts.map((alert) => <tr key={alert.id}><td><span className="lc-dashboard__level is-error"><ExclamationCircleFilled /> 异常</span></td><td title={alert.detail}>{alert.content || alert.detail}</td><td>{formatDateTime(alert.time)}</td><td><span className="lc-dashboard__status is-red">{alert.status.label}</span></td></tr>)}</tbody></table> : <EmptyState text="当前没有异常审计记录" />}</article>
              <article className="lc-dashboard__panel lc-dashboard__table-panel"><div className="lc-dashboard__panel-head"><h2>待处理任务 <b className="lc-dashboard__count">{pendingTasks.length}</b></h2></div>{pendingTasks.length ? <table><thead><tr><th>任务名称</th><th>所属智能体</th><th>更新时间</th><th>优先级</th><th>操作</th></tr></thead><tbody>{pendingTasks.map((task) => <tr key={task.id}><td title={task.title}>{task.title}</td><td>{task.agentName || task.assignees.join("、") || "—"}</td><td>{formatDateTime(task.updatedAt)}</td><td><span className={`lc-dashboard__priority is-${task.priority === "urgent" || task.priority === "high" ? "high" : "mid"}`}>{task.priorityLabel}</span></td><td><button type="button" onClick={() => navigate(`/work?task=${task.id}`)}>查看</button></td></tr>)}</tbody></table> : <EmptyState text="当前没有待处理任务" />}</article>
            </section>
          </div>

          <aside className="lc-dashboard__right-rail">
            <section className="lc-dashboard__rail-section"><h2>系统健康度</h2><div className="lc-dashboard__health"><HealthGauge score={healthScore} /><ul><li><i className={data.facts?.duckdb.available ? "" : "is-off"} />DuckDB <b>{data.facts ? data.facts.duckdb.available ? "在线" : "异常" : "—"}</b></li><li><i className={data.facts?.postgres.available ? "" : "is-off"} />PostgreSQL <b>{data.facts ? data.facts.postgres.available ? "在线" : "异常" : "—"}</b></li><li><i className={errors.length ? "is-off" : ""} />API 数据源 <b>{errors.length ? "部分异常" : loading ? "同步中" : "正常"}</b></li></ul></div></section>
            <section className="lc-dashboard__rail-section"><div className="lc-dashboard__rail-head"><h2>数据连接状态</h2><button type="button" onClick={() => navigate("/connectors")}>查看全部 ›</button></div>{serviceRows.length ? <div className="lc-dashboard__nodes">{serviceRows.map((row) => <div key={row.name}><i className={row.ok ? "is-ok" : "is-warn"} /><span>{row.name}</span><b className={row.ok ? "is-ok" : "is-warn"}>{row.ok ? "运行中" : "异常"}</b><em title={row.detail}>{row.detail}</em></div>)}</div> : <EmptyState text="暂无连接健康数据" />}</section>
            <section className="lc-dashboard__rail-section lc-dashboard__resources"><div className="lc-dashboard__rail-head"><h2>真实数据资产</h2><button type="button" onClick={() => navigate("/knowledge")}>查看详情 ›</button></div>{assetRows.map(([name, value]) => <div className="lc-dashboard__resource" key={name}><span>{name}<b>{value === null ? "—" : value.toLocaleString()}</b></span><div><i style={{ width: `${value === null ? 0 : (value / maxAsset) * 100}%` }} /></div></div>)}</section>
            <section className={`lc-dashboard__rail-callout${healthScore !== null && healthScore < 100 ? " is-warning" : ""}`}><CloudServerOutlined /><div><strong>{healthScore === null ? "等待服务巡检数据" : healthScore === 100 ? "所有已检测服务在线" : "部分服务需要关注"}</strong><span>{updatedAt ? `最后巡检于 ${updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "尚未完成巡检"}</span></div><DatabaseOutlined /></section>
          </aside>
        </div>
      </section>
    </main>
  );
}
