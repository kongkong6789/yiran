import { Button, Empty, Space, Spin, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listOpsLoops,
  startOpsLoopRun,
  type OpsLoopItem,
} from "../../api/opsLoops";
import { PHASE_META, STATUS_LABEL, statusClass } from "./shared";
import "./loopsOps.css";

export default function LoopsHome() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OpsLoopItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const data = await listOpsLoops();
      setRows(data.results || []);
      if (!selectedId && data.results?.[0]) setSelectedId(data.results[0].id);
    } catch (error) {
      console.error(error);
      message.error("加载 Loops 失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) || null,
    [rows, selectedId],
  );

  async function handleRun(loop: OpsLoopItem) {
    try {
      const run = await startOpsLoopRun(loop.id);
      message.success("已启动一轮 OODA");
      nav(`/loops/${loop.id}/run?runId=${run.id}`);
    } catch (error) {
      console.error(error);
      message.error("启动失败");
    }
  }

  return (
    <div className="loops-ops-page">
      <div className="ops-topbar">
        <div>
          <h1>Loops 运营中心</h1>
          <p>持续观察 → 理解 → 决策 → 执行 → 学习的业务闭环</p>
        </div>
        <Space>
          <Button onClick={() => void refresh()}>刷新</Button>
          <Button type="primary" onClick={() => nav("/loops/discover")}>AI 发现 Loop</Button>
        </Space>
      </div>
      <div className="ops-shell with-right">
        <aside className="ops-side">
          <div className="ops-side-title">我的 Loops</div>
          {loading ? <Spin /> : null}
          {!loading && !rows.length ? (
            <div className="ops-empty">暂无 Loop，先去 AI 发现</div>
          ) : null}
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`ops-loop-item ${selectedId === row.id ? "active" : ""}`}
              onClick={() => setSelectedId(row.id)}
            >
              <strong>{row.name}</strong>
              <span className={`ops-pill ${statusClass(row.status)}`}>
                {STATUS_LABEL[row.status] || row.status}
              </span>
            </button>
          ))}
          <Button block style={{ marginTop: 12 }} onClick={() => nav("/loops/discover")}>
            + 创建 Loop
          </Button>
        </aside>
        <main className="ops-main">
          {!selected ? (
            <Empty description="选择一个 Loop" />
          ) : (
            <>
              <div className="ops-card">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ fontSize: 18 }}>{selected.name}</h3>
                    <p style={{ margin: 0, color: "var(--ops-muted)" }}>{selected.description || "暂无描述"}</p>
                  </div>
                  <Space wrap>
                    <Button onClick={() => nav(`/loops/${selected.id}/design`)}>设计</Button>
                    <Button onClick={() => nav(`/loops/${selected.id}/run`)}>运行详情</Button>
                    <Button type="primary" onClick={() => void handleRun(selected)}>跑一轮</Button>
                  </Space>
                </div>
              </div>
              <div className="ops-card">
                <h3>当前阶段</h3>
                <div className="ooda-strip">
                  {(["observe", "orient", "decide", "act", "learn"] as const).map((phase) => {
                    const meta = PHASE_META[phase];
                    const current = selected.ooda_phase === phase;
                    const latestPhase = selected.latest_run?.phase;
                    const done = latestPhase
                      ? ["observe", "orient", "decide", "act", "learn"].indexOf(latestPhase) > ["observe", "orient", "decide", "act", "learn"].indexOf(phase)
                      : false;
                    return (
                      <div
                        key={phase}
                        className={`ooda-node ${meta.tone} ${current ? "running" : done ? "done" : "wait"}`}
                      >
                        <div className="phase">{meta.label}</div>
                        <p>
                          {current
                            ? "进行中"
                            : done
                              ? "已完成"
                              : (selected.definition?.phases?.[phase] as { description?: string } | undefined)?.description || "待执行"}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="ops-card">
                <h3>最近运行</h3>
                {selected.latest_run ? (
                  <p style={{ margin: 0 }}>
                    第 {selected.latest_run.round} 轮 ·{" "}
                    <span className={`ops-pill ${statusClass(selected.latest_run.status)}`}>
                      {STATUS_LABEL[selected.latest_run.status] || selected.latest_run.status}
                    </span>
                    {" · "}进度 {selected.latest_run.progress}%
                  </p>
                ) : (
                  <p style={{ margin: 0, color: "var(--ops-muted)" }}>尚未运行</p>
                )}
              </div>
            </>
          )}
        </main>
        <aside className="ops-right">
          <h3 style={{ marginTop: 0 }}>快捷说明</h3>
          <p style={{ color: "var(--ops-muted)", fontSize: 13, lineHeight: 1.6 }}>
            第一期 Act 阶段会生成可执行计划并默认等待确认，不会自动改广告预算等外部写操作。
          </p>
          <Button block type="default" onClick={() => nav("/loops/monitor")}>
            打开运行监控
          </Button>
        </aside>
      </div>
    </div>
  );
}
