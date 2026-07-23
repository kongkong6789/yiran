import { Button, Empty, Progress, Space, Spin, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  confirmOpsLoopAct,
  getOpsLoop,
  getOpsLoopRun,
  listOpsLoopRuns,
  startOpsLoopRun,
  type OpsLoopItem,
  type OpsLoopRunItem,
} from "../../api/opsLoops";
import { PHASE_META, STATUS_LABEL, statusClass } from "./shared";
import "./loopsOps.css";

const PHASES = ["observe", "orient", "decide", "act", "learn"] as const;

export default function LoopRunWorkspace() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const loopId = Number(id);
  const nav = useNavigate();
  const [loop, setLoop] = useState<OpsLoopItem | null>(null);
  const [run, setRun] = useState<OpsLoopRunItem | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<string>("act");
  const [loading, setLoading] = useState(true);

  async function load(preferredRunId?: number) {
    if (!Number.isFinite(loopId)) return;
    const loopData = await getOpsLoop(loopId);
    setLoop(loopData);
    let runId = preferredRunId || Number(params.get("runId") || 0);
    if (!runId && loopData.latest_run?.id) runId = loopData.latest_run.id;
    if (!runId) {
      const listed = await listOpsLoopRuns(loopId);
      runId = listed.results?.[0]?.id || 0;
    }
    if (runId) {
      const runData = await getOpsLoopRun(runId);
      setRun(runData);
      setSelectedPhase(runData.phase || "observe");
    } else {
      setRun(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (error) {
        console.error(error);
        if (!cancelled) message.error("加载运行详情失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loopId]);

  useEffect(() => {
    if (!run?.id) return;
    if (run.status === "completed" || run.status === "failed") return;
    const timer = window.setInterval(() => {
      void getOpsLoopRun(run.id)
        .then((data) => {
          setRun(data);
          setSelectedPhase(data.phase || selectedPhase);
        })
        .catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [run?.id, run?.status]);

  const phaseResult = useMemo(() => {
    if (!run) return null;
    return (run.phase_results || {})[selectedPhase] as Record<string, unknown> | undefined;
  }, [run, selectedPhase]);

  const metrics = useMemo(() => {
    const raw = (run?.metrics || {}) as Record<string, { value?: number; delta_pp?: number; delta_pct?: number; unit?: string }>;
    return Object.entries(raw);
  }, [run]);

  async function startRound() {
    try {
      const created = await startOpsLoopRun(loopId);
      setRun(created);
      message.success("已启动新一轮");
      nav(`/loops/${loopId}/run?runId=${created.id}`, { replace: true });
    } catch (error) {
      console.error(error);
      message.error("启动失败");
    }
  }

  async function confirmAct() {
    if (!run) return;
    try {
      const updated = await confirmOpsLoopAct(run.id);
      setRun(updated);
      message.success("已确认执行计划");
    } catch (error) {
      console.error(error);
      message.error("确认失败");
    }
  }

  if (loading) {
    return (
      <div className="loops-ops-page">
        <div className="ops-main"><Spin /></div>
      </div>
    );
  }

  if (!loop) {
    return (
      <div className="loops-ops-page">
        <div className="ops-main"><Empty description="Loop 不存在" /></div>
      </div>
    );
  }

  return (
    <div className="loops-ops-page">
      <div className="ops-topbar">
        <div>
          <h1>{loop.name} · 执行流</h1>
          <p>
            {run ? `第 ${run.round} 轮` : "尚未运行"}
            {run ? (
              <>
                {" · "}
                <span className={`ops-pill ${statusClass(run.status)}`}>{STATUS_LABEL[run.status]}</span>
              </>
            ) : null}
          </p>
        </div>
        <Space>
          <Button onClick={() => nav("/loops")}>返回列表</Button>
          <Button onClick={() => nav(`/loops/${loop.id}/design`)}>设计</Button>
          <Button type="primary" onClick={() => void startRound()}>跑一轮</Button>
        </Space>
      </div>
      <div className="ops-shell with-right">
        <aside className="ops-side">
          <div className="ops-side-title">阶段</div>
          {PHASES.map((phase) => {
            const active = selectedPhase === phase;
            const current = run?.phase === phase;
            return (
              <button
                key={phase}
                type="button"
                className={`ops-loop-item ${active ? "active" : ""}`}
                onClick={() => setSelectedPhase(phase)}
              >
                <strong>{PHASE_META[phase].label}</strong>
                <span className={`ops-pill ${current ? "ok" : ""}`}>
                  {current ? "当前" : "查看"}
                </span>
              </button>
            );
          })}
        </aside>
        <main className="ops-main">
          {!run ? (
            <div className="ops-card">
              <Empty description="还没有运行记录">
                <Button type="primary" onClick={() => void startRound()}>启动第一轮</Button>
              </Empty>
            </div>
          ) : (
            <>
              <div className="ops-card">
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>OODA 执行流</h3>
                  <span>{run.progress}%</span>
                </div>
                <Progress percent={run.progress} style={{ marginBottom: 14 }} />
                <div className="ooda-strip">
                  {PHASES.map((phase) => {
                    const order = PHASES.indexOf(phase);
                    const currentOrder = PHASES.indexOf(run.phase as typeof PHASES[number]);
                    const done = currentOrder > order || run.status === "completed";
                    const running = run.phase === phase && run.status !== "completed";
                    const result = (run.phase_results || {})[phase] as { summary?: string } | undefined;
                    return (
                      <button
                        key={phase}
                        type="button"
                        className={`ooda-node ${PHASE_META[phase].tone} ${running ? "running" : done ? "done" : "wait"}`}
                        style={{ cursor: "pointer", textAlign: "left" }}
                        onClick={() => setSelectedPhase(phase)}
                      >
                        <div className="phase">{PHASE_META[phase].label}</div>
                        <p>{result?.summary || (running ? "进行中…" : done ? "完成" : "等待")}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="ops-card">
                <h3>关键指标</h3>
                {metrics.length ? (
                  <div className="ops-metrics">
                    {metrics.map(([key, value]) => (
                      <div key={key} className="ops-metric">
                        <span>{key}</span>
                        <strong>
                          {value?.value ?? "-"}
                          {value?.unit === "%" ? "%" : ""}
                        </strong>
                        <div style={{ fontSize: 12, color: "var(--ops-muted)", marginTop: 4 }}>
                          {value?.delta_pp != null
                            ? `${value.delta_pp > 0 ? "+" : ""}${value.delta_pp}pp`
                            : value?.delta_pct != null
                              ? `${value.delta_pct > 0 ? "+" : ""}${value.delta_pct}%`
                              : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: 0, color: "var(--ops-muted)" }}>观察阶段完成后显示指标</p>
                )}
              </div>

              <div className="ops-card">
                <h3>实时日志</h3>
                <div className="ops-log">
                  {(run.logs || []).length ? (
                    (run.logs || []).map((item, index) => (
                      <div key={`${item.ts}-${index}`}>
                        [{item.ts?.slice(11, 19) || "--:--:--"}] [{item.phase || "-"}] {item.message}
                      </div>
                    ))
                  ) : (
                    <div>暂无日志</div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
        <aside className="ops-right">
          <h3 style={{ marginTop: 0 }}>节点详情 · {PHASE_META[selectedPhase]?.label || selectedPhase}</h3>
          {!phaseResult ? (
            <p style={{ color: "var(--ops-muted)" }}>该阶段尚未产出结果</p>
          ) : (
            <>
              <p style={{ lineHeight: 1.6 }}>{String(phaseResult.summary || "")}</p>
              {selectedPhase === "act" && run?.status === "awaiting_confirm" ? (
                <Button type="primary" block onClick={() => void confirmAct()}>
                  确认执行计划
                </Button>
              ) : null}
              {selectedPhase === "decide" && Array.isArray(phaseResult.strategies) ? (
                <div style={{ marginTop: 12 }}>
                  {(phaseResult.strategies as Array<{ title?: string; score?: number }>).map((item, idx) => (
                    <div key={idx} className="ops-loop-item active" style={{ cursor: "default" }}>
                      <strong>{item.title}</strong>
                      <span className="ops-pill">{item.score ?? "-"}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {selectedPhase === "orient" && Array.isArray(phaseResult.related_objects) ? (
                <div className="ops-meta" style={{ marginTop: 12 }}>
                  {(phaseResult.related_objects as string[]).map((obj) => (
                    <span key={obj}>{obj}</span>
                  ))}
                </div>
              ) : null}
              {selectedPhase === "learn" && phaseResult.score != null ? (
                <div className="ops-score" style={{ marginTop: 12 }}>{String(phaseResult.score)} 分</div>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
