import { Button, Empty, Progress, Space, Spin, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listOpsLoops, type OpsLoopItem } from "../../api/opsLoops";
import { PHASE_META, STATUS_LABEL, statusClass } from "./shared";
import "./loopsOps.css";

export default function LoopsMonitor() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<OpsLoopItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await listOpsLoops();
        if (!cancelled) setRows(data.results || []);
      } catch (error) {
        console.error(error);
        if (!cancelled) message.error("加载监控失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const running = useMemo(
    () => rows.filter((row) => row.status === "active" || row.status === "error" || row.latest_run?.status === "running" || row.latest_run?.status === "awaiting_confirm"),
    [rows],
  );

  return (
    <div className="loops-ops-page">
      <div className="ops-topbar">
        <div>
          <h1>运行监控</h1>
          <p>跟踪各 Loop 当前 OODA 阶段与异常</p>
        </div>
        <Button onClick={() => nav("/loops")}>返回列表</Button>
      </div>
      <div className="ops-main">
        {loading ? <Spin /> : null}
        {!loading && !running.length ? <Empty description="暂无运行中的 Loop" /> : null}
        <div style={{ display: "grid", gap: 12 }}>
          {running.map((row) => {
            const phase = row.latest_run?.phase || row.ooda_phase;
            const meta = PHASE_META[phase] || PHASE_META.idle;
            return (
              <div key={row.id} className="ops-card" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center" }}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: 16 }}>{row.name}</strong>
                    <span className={`ops-pill ${statusClass(row.status)}`}>{STATUS_LABEL[row.status]}</span>
                    <span className="ops-pill">{meta.label}</span>
                  </div>
                  <Progress percent={row.latest_run?.progress || 0} size="small" />
                  <div style={{ color: "var(--ops-muted)", fontSize: 12, marginTop: 6 }}>
                    {row.latest_run
                      ? `第 ${row.latest_run.round} 轮 · ${STATUS_LABEL[row.latest_run.status] || row.latest_run.status}`
                      : "等待启动"}
                  </div>
                </div>
                <Space>
                  <Button onClick={() => nav(`/loops/${row.id}/run`)}>详情</Button>
                </Space>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
