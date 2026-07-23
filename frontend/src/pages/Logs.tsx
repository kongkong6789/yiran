import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, DatePicker, Empty, Input, Modal, Pagination, Select, Spin, Table, Tag } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SafetyOutlined,
  SearchOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import {
  getAuditOverview,
  type AuditDistribution,
  type AuditLogCategory,
  type AuditOverview,
  type AuditRow,
  type AuditTrendPoint,
} from "../api/client";
import { authenticatedAvatarUrl } from "../utils/avatar";
import { TopRankBadge, TopRankWatermark } from "../components/TopRankBadge";

const TABS: { key: AuditLogCategory; label: string }[] = [
  { key: "operation", label: "操作日志" },
  { key: "login", label: "登录日志" },
  { key: "system", label: "系统日志" },
  { key: "security", label: "安全日志" },
  { key: "data_change", label: "数据变更日志" },
];

const KPI_META: { key: keyof AuditOverview["kpis"]; label: string; icon: JSX.Element; tone: string }[] = [
  { key: "totalOps", label: "操作总数", icon: <SafetyCertificateOutlined />, tone: "violet" },
  { key: "totalUsers", label: "用户总数", icon: <TeamOutlined />, tone: "blue" },
  { key: "errorOps", label: "错误日志", icon: <WarningOutlined />, tone: "red" },
  { key: "sensitiveOps", label: "敏感操作", icon: <SafetyOutlined />, tone: "amber" },
  { key: "activeUsers", label: "活跃用户", icon: <ThunderboltOutlined />, tone: "green" },
];

const DONUT_COLORS = ["#7c6cf6", "#a78bfa", "#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#94a3b8"];
const TYPE_TAG_COLOR: Record<string, string> = {
  skill: "purple", knowledge: "geekblue", app: "blue", user: "green", role: "gold", system: "cyan", other: "default",
};
const STATUS_TAG_COLOR: Record<string, string> = {
  success: "success", failed: "error", pending: "warning", dryrun: "default",
};

function avatarColor(name: string) {
  const palette = ["#7c6cf6", "#f97316", "#0ea5e9", "#10b981", "#ef4444", "#eab308", "#ec4899"];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

function fmtNumber(value: number) {
  return value.toLocaleString("zh-CN");
}

function smoothLine(points: { x: number; y: number }[]) {
  if (points.length < 2) return points.length ? `M${points[0].x},${points[0].y}` : "";
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function TrendChart({ data }: { data: AuditTrendPoint[] }) {
  const w = 660, h = 220, padL = 38, padR = 16, padT = 16, padB = 30;
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.count));
  const niceMax = Math.max(4, Math.ceil(max / 4) * 4);
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (w - padL - padR));
  const y = (v: number) => padT + (1 - v / niceMax) * (h - padT - padB);
  const pts = data.map((d, i) => ({ x: x(i), y: y(d.count) }));
  const line = smoothLine(pts);
  const area = n > 1 ? `${line} L${pts[n - 1].x.toFixed(1)},${h - padB} L${pts[0].x.toFixed(1)},${h - padB} Z` : "";
  const yTicks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];
  const labelEvery = Math.max(1, Math.round(n / 6));
  const peakIdx = data.reduce((best, d, i) => (d.count > data[best].count ? i : best), 0);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="logs-trend-svg" role="img" aria-label="操作趋势">
      <defs>
        <linearGradient id="logsTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.24" />
          <stop offset="70%" stopColor="#8b5cf6" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="logsTrendLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL} x2={w - padR} y1={y(t)} y2={y(t)}
            stroke="#eef0f5" strokeWidth={1} strokeDasharray={i === 0 ? "0" : "4 5"}
          />
          <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" className="logs-axis-text">{Math.round(t)}</text>
        </g>
      ))}
      {area && <path d={area} fill="url(#logsTrendFill)" />}
      {line && <path d={line} fill="none" stroke="url(#logsTrendLine)" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />}
      {n > 0 && (
        <g>
          <circle cx={pts[peakIdx].x} cy={pts[peakIdx].y} r={7} fill="#8b5cf6" opacity={0.14} />
          <circle cx={pts[peakIdx].x} cy={pts[peakIdx].y} r={3.6} fill="#fff" stroke="#6d28d9" strokeWidth={2} />
        </g>
      )}
      {data.map((d, i) => (i % labelEvery === 0 || i === n - 1 ? (
        <text key={d.date} x={x(i)} y={h - 9} textAnchor="middle" className="logs-axis-text">
          {d.date.slice(5)}
        </text>
      ) : null))}
    </svg>
  );
}

function Donut({ data }: { data: AuditDistribution[] }) {
  const size = 176, stroke = 26, r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;
  const total = data.reduce((sum, d) => sum + d.count, 0);
  let acc = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="logs-donut-svg" role="img" aria-label="操作类型分布">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f2f6" strokeWidth={stroke} />
      {total > 0 && data.map((d, i) => {
        const frac = d.count / total;
        const dash = frac * C;
        const seg = (
          <circle
            key={d.key}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${C - dash}`}
            strokeDashoffset={-acc}
            transform={`rotate(-90 ${cx} ${cy})`}
            strokeLinecap="butt"
          />
        );
        acc += dash;
        return seg;
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" className="logs-donut-total">{fmtNumber(total)}</text>
      <text x={cx} y={cy + 15} textAnchor="middle" className="logs-donut-sub">总操作</text>
    </svg>
  );
}

export default function Logs() {
  const [category, setCategory] = useState<AuditLogCategory>("operation");
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().subtract(29, "day"), dayjs()]);
  const [typeF, setTypeF] = useState("all");
  const [statusF, setStatusF] = useState("all");
  const [userF, setUserF] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<AuditOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [detailRow, setDetailRow] = useState<AuditRow | null>(null);
  const kwTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (kwTimer.current) clearTimeout(kwTimer.current);
    kwTimer.current = setTimeout(() => { setDebouncedKeyword(keyword); setPage(1); }, 350);
    return () => { if (kwTimer.current) clearTimeout(kwTimer.current); };
  }, [keyword]);

  const queryParams = useMemo(() => ({
    category,
    start: range?.[0]?.format("YYYY-MM-DD"),
    end: range?.[1]?.format("YYYY-MM-DD"),
    type: typeF,
    status: statusF,
    user: userF,
    q: debouncedKeyword,
    page,
    pageSize,
  }), [category, range, typeF, statusF, userF, debouncedKeyword, page, pageSize]);

  const load = useCallback(() => {
    setLoading(true);
    getAuditOverview(queryParams)
      .then((res) => { setData(res); setDenied(false); })
      .catch((err) => {
        if (err?.response?.status === 403) setDenied(true);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [queryParams]);

  useEffect(() => { load(); }, [load]);

  const resetFilters = () => {
    setRange([dayjs().subtract(29, "day"), dayjs()]);
    setTypeF("all"); setStatusF("all"); setUserF("all"); setKeyword(""); setDebouncedKeyword(""); setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await getAuditOverview({ ...queryParams, page: 1, pageSize: 1000 });
      const header = ["时间", "用户名", "角色", "操作类型", "操作内容", "资源类型", "资源名称", "IP地址", "状态"];
      const lines = res.rows.map((r) => [
        r.time, r.user.name, r.user.roleLabel, r.operationType.label, r.content,
        r.resourceType, r.resourceName, r.ip, r.status.label,
      ].map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","));
      const csv = "\uFEFF" + [header.join(","), ...lines].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `操作日志_${dayjs().format("YYYYMMDD_HHmm")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const activeTabLabel = TABS.find((t) => t.key === category)?.label || "操作日志";

  const columns = [
    {
      title: "时间", dataIndex: "time", width: 170,
      render: (v: string) => <span className="logs-cell-time">{v}</span>,
    },
    {
      title: "用户名", dataIndex: "user", width: 150,
      render: (u: AuditRow["user"]) => (
        <div className="logs-cell-user">
          <Avatar size={30} src={authenticatedAvatarUrl(u.avatarUrl)} style={{ background: avatarColor(u.name), flex: "none" }}>{u.name.slice(0, 1)}</Avatar>
          <div>
            <div className="logs-cell-user-name">{u.name}</div>
            <div className="logs-cell-user-role">{u.roleLabel}</div>
          </div>
        </div>
      ),
    },
    {
      title: "操作类型", dataIndex: "operationType", width: 120,
      render: (t: AuditRow["operationType"]) => (
        <Tag color={TYPE_TAG_COLOR[t.key] || "default"} className="logs-type-tag">{t.label}</Tag>
      ),
    },
    {
      title: "操作内容", dataIndex: "content",
      render: (v: string, row: AuditRow) => (
        <div className="logs-cell-content">
          <div className="logs-cell-content-main">{v}</div>
          {row.detail ? <div className="logs-cell-content-sub">{row.detail}</div> : null}
        </div>
      ),
    },
    { title: "资源类型", dataIndex: "resourceType", width: 110 },
    { title: "资源名称", dataIndex: "resourceName", width: 130, render: (v: string) => <span className="logs-cell-muted">{v}</span> },
    { title: "IP 地址", dataIndex: "ip", width: 130, render: (v: string) => <span className="logs-cell-mono">{v}</span> },
    {
      title: "状态", dataIndex: "status", width: 90,
      render: (s: AuditRow["status"]) => <Tag color={STATUS_TAG_COLOR[s.key] || "default"} className="logs-status-tag">{s.label}</Tag>,
    },
    {
      title: "操作", key: "op", width: 76,
      render: (_: unknown, row: AuditRow) => (
        <button type="button" className="logs-detail-link" onClick={() => setDetailRow(row)}>详情</button>
      ),
    },
  ];

  if (denied) {
    return (
      <div className="logs-page">
        <Empty description="仅超级管理员可查看日志中心" style={{ marginTop: 120 }} />
      </div>
    );
  }

  return (
    <div className="logs-page">
      <div className="logs-breadcrumb">日志管理 <span>/</span> {activeTabLabel}</div>

      <div className="logs-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={category === t.key}
            className={category === t.key ? "is-on" : ""}
            onClick={() => { setCategory(t.key); setPage(1); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Spin spinning={loading}>
        <div className="logs-kpi-row">
          {KPI_META.map((meta) => {
            const kpi = data?.kpis?.[meta.key];
            const up = kpi?.trend === "up";
            const down = kpi?.trend === "down";
            return (
              <div className={`logs-kpi-card tone-${meta.tone}`} key={meta.key}>
                <div className="logs-kpi-head">
                  <span className="logs-kpi-label">{meta.label}</span>
                  <span className="logs-kpi-icon">{meta.icon}</span>
                </div>
                <div className="logs-kpi-value">{fmtNumber(kpi?.value ?? 0)}</div>
                <div className={`logs-kpi-delta ${up ? "is-up" : down ? "is-down" : ""}`}>
                  较上一周期 {up ? <ArrowUpOutlined /> : down ? <ArrowDownOutlined /> : null}
                  {kpi ? ` ${kpi.deltaPct}%` : " —"}
                </div>
              </div>
            );
          })}
        </div>

        <div className="logs-filter-bar">
          <DatePicker.RangePicker
            value={range}
            onChange={(v) => { setRange(v as [Dayjs, Dayjs] | null); setPage(1); }}
            allowClear={false}
          />
          <Select
            className="logs-filter-select"
            value={typeF}
            onChange={(v) => { setTypeF(v); setPage(1); }}
            options={[{ value: "all", label: "全部操作类型" }, ...(data?.filters?.operationTypes || [])]}
          />
          <Select
            className="logs-filter-select"
            value={statusF}
            onChange={(v) => { setStatusF(v); setPage(1); }}
            options={[{ value: "all", label: "全部状态" }, ...(data?.filters?.statuses || [])]}
          />
          <Select
            className="logs-filter-select"
            value={userF}
            showSearch
            optionFilterProp="label"
            onChange={(v) => { setUserF(v); setPage(1); }}
            options={[{ value: "all", label: "全部用户" }, ...(data?.filters?.users || [])]}
          />
          <Input
            className="logs-filter-search"
            prefix={<SearchOutlined />}
            placeholder="搜索用户名、操作内容、IP"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            allowClear
          />
          <Button icon={<ReloadOutlined />} onClick={resetFilters}>重置</Button>
          <Button
            className="logs-export-btn"
            type="primary"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={exportCsv}
          >
            导出日志
          </Button>
        </div>

        <div className="logs-analytics-row">
          <section className="logs-panel logs-trend-panel">
            <div className="logs-panel-head"><h3>操作趋势</h3><span className="logs-panel-badge">按天</span></div>
            <TrendChart data={data?.trend || []} />
          </section>

          <section className="logs-panel logs-dist-panel">
            <div className="logs-panel-head"><h3>操作类型分布</h3></div>
            <div className="logs-dist-body">
              <Donut data={data?.distribution || []} />
              <ul className="logs-dist-legend">
                {(data?.distribution || []).slice(0, 6).map((d, i) => (
                  <li key={d.key}>
                    <span className="logs-legend-dot" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                    <span className="logs-legend-label">{d.label}</span>
                    <span className="logs-legend-pct">{d.pct}%</span>
                    <span className="logs-legend-count">({fmtNumber(d.count)})</span>
                  </li>
                ))}
                {!data?.distribution?.length && <li className="logs-legend-empty">暂无数据</li>}
              </ul>
            </div>
          </section>

          <section className="logs-panel logs-top-panel">
            <div className="logs-panel-head logs-top-panel-head">
              <h3><TrophyOutlined className="logs-top-title-icon" /> TOP 操作用户</h3>
            </div>
            <ul className="logs-top-list">
              {(data?.topUsers || []).map((u, i) => {
                const rank = i + 1;
                return (
                <li key={u.actor} className={rank <= 3 ? `logs-top-item rank-${rank}` : "logs-top-item"}>
                  {rank <= 3 ? <TopRankWatermark rank={rank as 1 | 2 | 3} /> : null}
                  <TopRankBadge rank={rank} />
                  <Avatar size={30} src={authenticatedAvatarUrl(u.avatarUrl)} style={{ background: avatarColor(u.name), flex: "none" }}>{u.name.slice(0, 1)}</Avatar>
                  <div className="logs-top-meta">
                    <div className="logs-top-name">{u.name}</div>
                    <div className="logs-top-role">{u.roleLabel}</div>
                  </div>
                  <span className="logs-top-count">{fmtNumber(u.count)} 次</span>
                </li>
                );
              })}
              {!data?.topUsers?.length && <li className="logs-top-empty">暂无数据</li>}
            </ul>
          </section>
        </div>

        <div className="logs-table-wrap">
          <Table<AuditRow>
            rowKey="id"
            columns={columns as any}
            dataSource={data?.rows || []}
            pagination={false}
            size="middle"
            locale={{ emptyText: <Empty description="暂无日志记录" /> }}
          />
          <div className="logs-table-foot">
            <span className="logs-total-text">共 {fmtNumber(data?.pagination?.total ?? 0)} 条记录</span>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={data?.pagination?.total ?? 0}
              showSizeChanger
              pageSizeOptions={[10, 20, 50, 100]}
              onChange={(p, ps) => { setPage(p); setPageSize(ps); }}
            />
          </div>
        </div>
      </Spin>

      <Modal
        title="日志详情"
        open={!!detailRow}
        onCancel={() => setDetailRow(null)}
        footer={null}
        destroyOnClose
        width={560}
        className="logs-detail-modal"
      >
        {detailRow ? (
          <div className="logs-detail-body">
            <div className="logs-detail-hero">
              <Avatar
                size={44}
                src={authenticatedAvatarUrl(detailRow.user.avatarUrl)}
                style={{ background: avatarColor(detailRow.user.name), flex: "none" }}
              >
                {detailRow.user.name.slice(0, 1)}
              </Avatar>
              <div className="logs-detail-hero-meta">
                <strong>{detailRow.user.name}</strong>
                <span>{detailRow.user.roleLabel}</span>
              </div>
              <Tag color={STATUS_TAG_COLOR[detailRow.status.key] || "default"} className="logs-status-tag">
                {detailRow.status.label}
              </Tag>
            </div>

            <dl className="logs-detail-grid">
              <div>
                <dt>时间</dt>
                <dd>{detailRow.time}</dd>
              </div>
              <div>
                <dt>操作类型</dt>
                <dd>
                  <Tag color={TYPE_TAG_COLOR[detailRow.operationType.key] || "default"} className="logs-type-tag">
                    {detailRow.operationType.label}
                  </Tag>
                </dd>
              </div>
              <div className="logs-detail-span">
                <dt>操作内容</dt>
                <dd>{detailRow.content || "—"}</dd>
              </div>
              {detailRow.detail ? (
                <div className="logs-detail-span">
                  <dt>补充说明</dt>
                  <dd className="logs-detail-note">{detailRow.detail}</dd>
                </div>
              ) : null}
              <div>
                <dt>资源类型</dt>
                <dd>{detailRow.resourceType || "—"}</dd>
              </div>
              <div>
                <dt>资源名称</dt>
                <dd>{detailRow.resourceName || "—"}</dd>
              </div>
              <div>
                <dt>IP 地址</dt>
                <dd className="logs-cell-mono">{detailRow.ip || "—"}</dd>
              </div>
              <div>
                <dt>Trace ID</dt>
                <dd className="logs-cell-mono">{detailRow.traceId || "—"}</dd>
              </div>
            </dl>
            <details className="logs-raw-detail">
              <summary>原始审计与门禁详情</summary>
              <pre className="audit-debug">
                {JSON.stringify({
                  decision: detailRow.decision,
                  payload: detailRow.payload,
                  checks: detailRow.checks,
                  result: detailRow.result,
                }, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
