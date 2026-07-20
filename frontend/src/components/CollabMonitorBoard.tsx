import { useEffect, useState } from "react";
import { Button, Empty, Select, Tag, Tooltip, Typography } from "antd";
import {
  BarChartOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import type { CollabRoom, CollabRoomStats } from "../api/client";

const RISK_META: Record<string, { color: string; label: string }> = {
  green: { color: "success", label: "正常" },
  yellow: { color: "warning", label: "注意" },
  red: { color: "error", label: "高风险" },
};

type SummaryWindow = "auto" | "latest20" | "30m" | "60m";

type Props = {
  room: CollabRoom | null;
  stats: CollabRoomStats | null;
  loading?: boolean;
  summaryLoading?: boolean;
  onRefresh?: () => void;
  onSummarize?: (windowMode: SummaryWindow) => void;
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

function formatDuration(ms = 0) {
  if (ms < 1000) return "<1秒";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  return `${(minutes / 60).toFixed(1)}小时`;
}

function formatSummaryRange(start?: string | null, end?: string | null) {
  if (!start || !end) return "";
  const fmt = (value: string) => new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function CollabMonitorBoard({
  room,
  stats,
  loading,
  summaryLoading,
  onRefresh,
  onSummarize,
  onJumpEvidence,
}: Props) {
  const [panel, setPanel] = useState<"summary" | "data">("summary");
  const [summaryWindow, setSummaryWindow] = useState<SummaryWindow>("auto");

  useEffect(() => {
    setPanel("summary");
    setSummaryWindow("auto");
  }, [room?.id]);

  if (!room) {
    return (
      <aside className="collab-ai">
        <div className="collab-ai-head">
          <div>
            <Typography.Text strong>
              <FileTextOutlined /> 智能纪要
            </Typography.Text>
            <div className="collab-ai-sub">选择会话后，可智能判断总结范围</div>
          </div>
        </div>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择会话后查看总结" />
      </aside>
    );
  }

  const risk = stats?.risk_level || room.risk_level;
  const riskCounts = stats?.risk_counts || { green: 0, yellow: 0, red: 0 };
  const warnN = (riskCounts.yellow || 0) + (riskCounts.red || 0);
  const latestSummary = stats?.latest_summary;
  const suggestion = stats?.summary_suggestion;
  const summaryModel = stats?.summary_model;
  const modelReady = summaryModel?.configured !== false;
  const readMetrics = stats?.read_metrics;

  return (
    <aside className="collab-ai collab-intelligence">
      <div className="collab-ai-head collab-intelligence-head">
        <div>
          <Typography.Text strong>
            {panel === "summary" ? <FileTextOutlined /> : <BarChartOutlined />}
            {" "}
            {panel === "summary" ? "智能纪要" : "会话数据"}
          </Typography.Text>
          <div className="collab-ai-sub">
            {panel === "summary" ? "按上下文智能取段，不必总结全部历史" : "发言、已读与阅读耗时"}
          </div>
        </div>
        {panel === "data" ? (
          <Tooltip title="重新分析风险">
            <Button
              type="text"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={onRefresh}
            />
          </Tooltip>
        ) : null}
      </div>

      <div className="collab-intelligence-tabs" role="tablist" aria-label="右侧工作区">
        <button
          type="button"
          role="tab"
          aria-selected={panel === "summary"}
          className={panel === "summary" ? "active" : ""}
          onClick={() => setPanel("summary")}
        >
          <FileTextOutlined /> 总结
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === "data"}
          className={panel === "data" ? "active" : ""}
          onClick={() => setPanel("data")}
        >
          <BarChartOutlined /> 数据
        </button>
      </div>

      {panel === "summary" ? (
        <div className="collab-summary-panel">
          <section
            className={`collab-summary-model${summaryModel?.configured === false ? " is-missing" : ""}`}
            aria-live="polite"
          >
            <span className="collab-summary-model-icon"><RobotOutlined /></span>
            <div>
              <strong>
                {summaryModel
                  ? summaryModel.configured
                    ? summaryModel.model || "已配置 AI 模型"
                    : "尚未配置 LLM"
                  : "正在读取模型配置"}
              </strong>
              <p>
                {summaryModel?.configured
                  ? `总结将使用${summaryModel.source === "personal" ? "个人" : "平台"}模型配置`
                  : "请在右上角头像 → 个人信息 → 模型密钥中完成配置"}
              </p>
            </div>
            {summaryModel?.configured ? (
              <Tag color="blue">{summaryModel.source === "personal" ? "个人配置" : "平台模型"}</Tag>
            ) : null}
          </section>

          <section
            className={`collab-summary-nudge${suggestion?.should_summarize && modelReady ? " is-ready" : ""}`}
            aria-live="polite"
          >
            <span className="collab-summary-nudge-icon">
              {suggestion?.should_summarize ? <BulbOutlined /> : <ClockCircleOutlined />}
            </span>
            <div>
              <strong>{suggestion?.should_summarize ? "这段对话值得总结" : "正在判断总结时机"}</strong>
              <p>{suggestion?.reason || "继续对话后，我会提醒你是否需要收拢要点。"}</p>
            </div>
            {suggestion?.should_summarize ? (
              <button
                type="button"
                className="collab-summary-nudge-action"
                disabled={summaryLoading || !modelReady}
                onClick={() => onSummarize?.("auto")}
              >
                AI 总结这段
              </button>
            ) : null}
          </section>

          <section className="collab-summary-controls">
            <label htmlFor="collab-summary-window">上下文范围</label>
            <Select
              id="collab-summary-window"
              value={summaryWindow}
              onChange={setSummaryWindow}
              options={[
                { value: "auto", label: "智能判断（推荐）" },
                { value: "latest20", label: "最近 20 条" },
                { value: "30m", label: "最近 30 分钟" },
                { value: "60m", label: "最近 1 小时" },
              ]}
            />
            <Button
              type="primary"
              icon={<RobotOutlined />}
              loading={summaryLoading}
              disabled={
                !onSummarize
                || !modelReady
                || (stats?.message_count ?? room.message_count ?? 0) < 1
              }
              onClick={() => onSummarize?.(summaryWindow)}
            >
              AI 生成总结
            </Button>
            <span>
              {modelReady
                ? "智能模式会优先取最新连续讨论，并在话题间隔处断开。"
                : "完成 LLM 配置后即可生成真实 AI 纪要，不会使用本地规则代替。"}
            </span>
          </section>

          {!latestSummary ? (
            <div className="collab-summary-empty">
              <FileTextOutlined />
              <strong>还没有聊天纪要</strong>
              <span>点击“AI 生成总结”，可提取要点、结论和待办。</span>
            </div>
          ) : (
            <article className="collab-summary-card">
              <header>
                <div>
                  <span>最新纪要</span>
                  <strong>{latestSummary.content}</strong>
                </div>
                <Tag color={latestSummary.generated_by === "llm" ? "blue" : "default"}>
                  {latestSummary.generated_by === "llm"
                    ? latestSummary.model_name || "AI"
                    : "历史本地"}
                </Tag>
              </header>
              <div className="collab-summary-meta">
                <span>{latestSummary.message_count} 条消息</span>
                <span>{formatSummaryRange(latestSummary.start_at, latestSummary.end_at)}</span>
                {latestSummary.generated_by === "llm" && latestSummary.model_source ? (
                  <span>
                    {latestSummary.model_source === "personal"
                      ? "个人模型"
                      : latestSummary.model_source === "platform_fallback"
                        ? "平台回退"
                        : "平台模型"}
                  </span>
                ) : null}
              </div>
              <p className="collab-summary-selection">{latestSummary.selection_reason}</p>

              {latestSummary.key_points.length ? (
                <section>
                  <h5>关键要点</h5>
                  <ul>
                    {latestSummary.key_points.map((item, index) => (
                      <li key={`point-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {latestSummary.decisions.length ? (
                <section className="is-decision">
                  <h5><CheckCircleOutlined /> 结论与共识</h5>
                  <ul>
                    {latestSummary.decisions.map((item, index) => (
                      <li key={`decision-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {latestSummary.action_items.length ? (
                <section className="is-action">
                  <h5>下一步</h5>
                  <ul>
                    {latestSummary.action_items.map((item, index) => (
                      <li key={`action-${index}`}>{item}</li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {latestSummary.start_message_id && onJumpEvidence ? (
                <button
                  type="button"
                  className="collab-summary-locate"
                  onClick={() => onJumpEvidence(latestSummary.start_message_id!)}
                >
                  定位到总结起点
                </button>
              ) : null}
            </article>
          )}
        </div>
      ) : (
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
              <span>消息总量</span>
              <strong>{stats?.user_message_count ?? room.message_count ?? 0}</strong>
              <em>今日 {stats?.messages_today ?? 0}</em>
            </div>
            <div className="collab-kpi">
              <span>平均已读</span>
              <strong>{formatDuration(readMetrics?.avg_read_latency_ms)}</strong>
              <em>{readMetrics?.receipt_count ?? 0} 次回执</em>
            </div>
            <div className="collab-kpi">
              <span>阅读投入</span>
              <strong>{formatDuration(readMetrics?.total_active_read_ms)}</strong>
              <em>{readMetrics?.session_count ?? 0} 次会话</em>
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

          <section className="collab-monitor-block collab-read-metrics">
            <h5>阅读质量</h5>
            <div>
              <span>
                <em>近 7 天消息</em>
                <strong>{stats?.messages_7d ?? 0}</strong>
              </span>
              <span>
                <em>已读成员</em>
                <strong>{readMetrics?.unique_readers ?? 0}</strong>
              </span>
              <span>
                <em>单次阅读</em>
                <strong>{formatDuration(readMetrics?.avg_session_read_ms)}</strong>
              </span>
            </div>
          </section>

          <section className="collab-monitor-block collab-alert-block">
            <h5>
              <SafetyCertificateOutlined /> 最近告警
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
      )}
    </aside>
  );
}
