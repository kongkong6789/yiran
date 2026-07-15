import { Button, Empty, Tag, Tooltip, Typography } from "antd";
import { ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import type { CollabRoom, CollabRoomStats } from "../api/client";

const RISK_META: Record<string, { color: string; label: string }> = {
  green: { color: "success", label: "正常" },
  yellow: { color: "warning", label: "注意" },
  red: { color: "error", label: "高风险" },
};

type Props = {
  room: CollabRoom | null;
  stats: CollabRoomStats | null;
  loading?: boolean;
  onRefresh?: () => void;
  onJumpEvidence?: (messageId: number) => void;
};

function MiniBars({ hourly }: { hourly: CollabRoomStats["hourly"] }) {
  const max = Math.max(1, ...hourly.map((h) => h.count));
  return (
    <div className="collab-mini-bars" aria-hidden>
      {hourly.map((h) => (
        <Tooltip key={h.hour} title={`${h.label} · ${h.count} 条`}>
          <span className="collab-mini-bar-wrap">
            <i style={{ height: `${Math.max(8, (h.count / max) * 100)}%` }} />
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

function SpeakerBars({ rows }: { rows: CollabRoomStats["speaker_top"] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) {
    return <div className="collab-hint">暂无发言统计</div>;
  }
  return (
    <ul className="collab-speaker-list">
      {rows.map((r) => (
        <li key={r.name}>
          <span className="name" title={r.name}>{r.name}</span>
          <span className="track">
            <i style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <em>{r.count}</em>
        </li>
      ))}
    </ul>
  );
}

export default function CollabMonitorBoard({
  room,
  stats,
  loading,
  onRefresh,
  onJumpEvidence,
}: Props) {
  if (!room) {
    return (
      <aside className="collab-ai">
        <div className="collab-ai-head">
          <div>
            <Typography.Text strong>
              <SafetyCertificateOutlined /> 监控看板
            </Typography.Text>
            <div className="collab-ai-sub">选择会话查看当前房间指标</div>
          </div>
        </div>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择会话后查看监控" />
      </aside>
    );
  }

  const risk = stats?.risk_level || room.risk_level;
  const riskCounts = stats?.risk_counts || { green: 0, yellow: 0, red: 0 };
  const warnN = (riskCounts.yellow || 0) + (riskCounts.red || 0);

  return (
    <aside className="collab-ai">
      <div className="collab-ai-head">
        <div>
          <Typography.Text strong>
            <SafetyCertificateOutlined /> 监控看板
          </Typography.Text>
          <div className="collab-ai-sub">当前会话 · 风险旁路；日常问答请 @AI</div>
        </div>
        <Tooltip title="重新分析">
          <Button
            type="text"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={onRefresh}
          />
        </Tooltip>
      </div>

      <div className="collab-monitor">
        <section className="collab-kpi-grid">
          <div className={`collab-kpi risk-${risk}`}>
            <span>当前风险</span>
            <strong>
              <Tag color={RISK_META[risk]?.color}>{RISK_META[risk]?.label || risk}</Tag>
            </strong>
            <em>近次黄/红 {warnN}</em>
          </div>
          <div className="collab-kpi">
            <span>活跃度</span>
            <strong>{stats?.user_message_count ?? room.message_count ?? 0}</strong>
            <em>用户消息</em>
          </div>
          <div className="collab-kpi">
            <span>AI 互动</span>
            <strong>
              {(stats?.ai_reply_count || 0) + (stats?.ai_interject_count || 0)}
            </strong>
            <em>
              应答 {stats?.ai_reply_count ?? 0} · 插嘴 {stats?.ai_interject_count ?? 0}
            </em>
          </div>
          <div className="collab-kpi">
            <span>附件</span>
            <strong>{stats?.attachment_count ?? 0}</strong>
            <em>本会话累计</em>
          </div>
        </section>

        <section className="collab-monitor-block">
          <h5>近 24h 发言</h5>
          {stats?.hourly?.length ? (
            <MiniBars hourly={stats.hourly} />
          ) : (
            <div className="collab-hint">暂无时段数据</div>
          )}
        </section>

        <section className="collab-monitor-block">
          <h5>成员发言占比</h5>
          <SpeakerBars rows={stats?.speaker_top || []} />
        </section>

        <section className="collab-monitor-block collab-alert-block">
          <h5>
            最近告警
            {stats?.alerts?.length ? (
              <span className="collab-alert-count">{stats.alerts.length}</span>
            ) : null}
          </h5>
          {!stats?.alerts?.length ? (
            <div className="collab-hint">暂无黄/红告警</div>
          ) : (
            <div className="collab-alert-list">
              {stats.alerts.map((a) => {
                const mid = a.evidence_message_ids?.[0];
                const canJump = Boolean(mid && onJumpEvidence);
                const time = new Date(a.created_at).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`collab-alert-row risk-${a.risk_level}${canJump ? "" : " disabled"}`}
                    title={canJump ? `定位到 #${mid}` : a.title}
                    disabled={!canJump}
                    onClick={() => {
                      if (mid) onJumpEvidence?.(mid);
                    }}
                  >
                    <i className="collab-alert-dot" aria-hidden />
                    <span className="collab-alert-title">{a.title || "风险告警"}</span>
                    <em>{time}</em>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
