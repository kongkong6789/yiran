import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Avatar,
  Button,
  Empty,
  Input,
  Pagination,
  Popconfirm,
  Progress,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from "antd";
import type { UploadProps } from "antd";
import {
  AppstoreOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  LockOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ShareAltOutlined,
  ShopOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  adoptSkillAsset,
  deleteSkill,
  deleteSkillAsset,
  getSkillAnalytics,
  getSkillAssets,
  getSkills,
  toggleSkill,
  updateSkillAssetOwner,
  updateSkillAssetVisibility,
  uploadSkillAsset,
  uploadSkillAssetFolder,
  type SkillAnalyticsResponse,
  type SkillAnalyticsRow,
  type SkillAssetItem,
  type UserSkillItem,
} from "../api/client";

type Props = {
  onInvoke?: (skill: UserSkillItem) => void;
};

type SkillCategoryKey = "all" | "business" | "analysis" | "content" | "automation" | "general";
type GovernanceView = "all" | "used" | "idle" | "unowned";
type ScopeFilter = "all" | "mine" | "shared";
type StatusFilter = "all" | "enabled" | "disabled";
type SortKey = "recent" | "usage" | "reuse";

type SkillCategory = {
  key: SkillCategoryKey;
  label: string;
  description: string;
  keywords: string[];
};

type SkillEntry = {
  skillId: string;
  name: string;
  description: string;
  category: Exclude<SkillCategoryKey, "all">;
  updatedAt: string;
  personal?: UserSkillItem;
  asset?: SkillAssetItem;
  analytics?: SkillAnalyticsRow;
};

const PAGE_SIZE = 8;

const SKILL_CATEGORIES: SkillCategory[] = [
  { key: "all", label: "全部技能", description: "所有能力资产", keywords: [] },
  { key: "business", label: "经营运营", description: "商品、店铺与客户运营", keywords: ["经营", "运营", "电商", "商品", "店铺", "订单", "客服", "零售", "commerce", "shop"] },
  { key: "analysis", label: "数据分析", description: "指标、报表与业务洞察", keywords: ["数据", "分析", "报表", "指标", "sql", "洞察", "统计", "dashboard", "analytics"] },
  { key: "content", label: "内容生产", description: "文案、图片与营销内容", keywords: ["内容", "文案", "图片", "图像", "视频", "营销", "海报", "写作", "image", "content", "copy"] },
  { key: "automation", label: "自动化工具", description: "脚本、连接与工作流", keywords: ["自动化", "脚本", "连接", "工作流", "同步", "批量", "mcp", "workflow", "automation", "script"] },
  { key: "general", label: "通用能力", description: "跨场景复用能力", keywords: [] },
];

function categoryIcon(key: SkillCategoryKey): ReactNode {
  if (key === "business") return <ShopOutlined />;
  if (key === "analysis") return <BarChartOutlined />;
  if (key === "content") return <FileTextOutlined />;
  if (key === "automation") return <RobotOutlined />;
  if (key === "general") return <ToolOutlined />;
  return <AppstoreOutlined />;
}

function classifySkill(...parts: Array<string | undefined>): Exclude<SkillCategoryKey, "all"> {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  const match = SKILL_CATEGORIES.find((item) => (
    item.key !== "all"
    && item.key !== "general"
    && item.keywords.some((keyword) => text.includes(keyword))
  ));
  return (match?.key || "general") as Exclude<SkillCategoryKey, "all">;
}

function initials(name: string): string {
  const normalized = name.trim();
  if (!normalized) return "?";
  return normalized.slice(0, 2).toUpperCase();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "尚未使用";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未使用";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null || !("response" in error)) return fallback;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  return typeof response?.data?.error === "string" ? response.data.error : fallback;
}

export default function SkillGovernanceDashboard({ onInvoke }: Props) {
  const [skills, setSkills] = useState<UserSkillItem[]>([]);
  const [assets, setAssets] = useState<SkillAssetItem[]>([]);
  const [analytics, setAnalytics] = useState<SkillAnalyticsResponse | null>(null);
  const [cosEnabled, setCosEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionSkillId, setActionSkillId] = useState<string | null>(null);
  const [governanceView, setGovernanceView] = useState<GovernanceView>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<SkillCategoryKey>("all");
  const [ownerId, setOwnerId] = useState<number | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("usage");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [personal, repository, insight] = await Promise.all([
        getSkills(),
        getSkillAssets(),
        getSkillAnalytics(),
      ]);
      setSkills(personal.results || []);
      setAssets(repository.results || []);
      setCosEnabled(Boolean(repository.cos_enabled));
      setAnalytics(insight);
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "技能治理数据加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);

  const uploadProps: UploadProps = {
    showUploadList: false,
    accept: ".md,.markdown,.zip",
    beforeUpload: async (file) => {
      setUploading(true);
      try {
        const result = await uploadSkillAsset(file);
        message.success(`已上传为个人技能：${result.asset?.name || result.personal?.name || file.name}，发布后团队成员才能采用`);
        await load();
      } catch (error: unknown) {
        message.error(getErrorMessage(error, "上传失败"));
      } finally {
        setUploading(false);
      }
      return false;
    },
  };

  const handleFolderUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    const paths = files.map((file) => file.webkitRelativePath || file.name);
    if (!paths.some((path) => path.split("/").pop()?.toLowerCase() === "skill.md")) {
      message.error("所选文件夹中没有 SKILL.md，请选择完整的技能目录");
      input.value = "";
      return;
    }

    setUploading(true);
    try {
      const result = await uploadSkillAssetFolder(files);
      const folderName = paths[0]?.split("/")[0] || "技能文件夹";
      message.success(`已上传为个人技能：${result.asset?.name || result.personal?.name || folderName}，发布后团队成员才能采用`);
      await load();
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "文件夹上传失败"));
    } finally {
      input.value = "";
      setUploading(false);
    }
  };

  const runAction = async (skillId: string, action: () => Promise<unknown>, success: string) => {
    setActionSkillId(skillId);
    try {
      await action();
      message.success(success);
      await load();
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "操作失败"));
    } finally {
      setActionSkillId(null);
    }
  };

  const libraryEntries = useMemo<SkillEntry[]>(() => {
    const analyticsByAsset = new Map((analytics?.skills || []).map((row) => [row.asset_id, row]));
    const analyticsBySkill = new Map((analytics?.skills || []).map((row) => [row.skill_id, row]));
    const merged = new Map<string, { personal?: UserSkillItem; asset?: SkillAssetItem }>();
    assets.forEach((asset) => merged.set(asset.skill_id, { asset }));
    skills.forEach((personal) => {
      const current = merged.get(personal.skill_id) || {};
      merged.set(personal.skill_id, { ...current, personal });
    });
    return Array.from(merged.entries()).map(([skillId, value]) => {
      const name = value.personal?.name || value.asset?.name || skillId;
      const description = value.personal?.description
        || value.asset?.description
        || value.personal?.instructions_preview
        || value.asset?.instructions_preview
        || "暂无技能说明";
      return {
        skillId,
        name,
        description,
        category: classifySkill(skillId, name, description),
        updatedAt: value.personal?.updated_at || value.asset?.updated_at || "",
        analytics: value.asset ? analyticsByAsset.get(value.asset.id) : analyticsBySkill.get(skillId),
        ...value,
      };
    });
  }, [analytics?.skills, assets, skills]);

  const categoryCounts = useMemo(() => {
    const result = new Map<SkillCategoryKey, number>([["all", libraryEntries.length]]);
    libraryEntries.forEach((entry) => result.set(entry.category, (result.get(entry.category) || 0) + 1));
    return result;
  }, [libraryEntries]);

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const entries = libraryEntries.filter((entry) => {
      const stats = entry.analytics;
      if (scope === "mine" && !entry.personal) return false;
      if (scope === "shared" && entry.asset?.visibility !== "shared") return false;
      if (status === "enabled" && !entry.personal?.enabled) return false;
      if (status === "disabled" && entry.personal?.enabled) return false;
      if (category !== "all" && entry.category !== category) return false;
      if (ownerId !== "all" && stats?.owner_id !== ownerId) return false;
      if (governanceView === "used" && !(stats && stats.usage_count_30d > 0)) return false;
      if (governanceView === "idle" && (stats?.usage_count_30d || 0) > 0) return false;
      if (governanceView === "unowned" && stats?.owner_id) return false;
      if (!normalized) return true;
      return [entry.name, entry.skillId, entry.description, stats?.owner, stats?.owner_team]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized));
    });
    return entries.sort((left, right) => {
      if (sortKey === "usage") return (right.analytics?.usage_count_30d || 0) - (left.analytics?.usage_count_30d || 0);
      if (sortKey === "reuse") return (right.analytics?.adoption_count || 0) - (left.analytics?.adoption_count || 0);
      return new Date(right.analytics?.last_used_at || right.updatedAt).getTime()
        - new Date(left.analytics?.last_used_at || left.updatedAt).getTime();
    });
  }, [category, governanceView, libraryEntries, ownerId, query, scope, sortKey, status]);

  useEffect(() => {
    setPage(1);
  }, [category, governanceView, ownerId, query, scope, sortKey, status]);

  useEffect(() => {
    if (!filteredEntries.length) {
      setSelectedSkillId(null);
      return;
    }
    if (!filteredEntries.some((entry) => entry.skillId === selectedSkillId)) {
      setSelectedSkillId(filteredEntries[0].skillId);
    }
  }, [filteredEntries, selectedSkillId]);

  const pagedEntries = filteredEntries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedEntry = filteredEntries.find((entry) => entry.skillId === selectedSkillId) || filteredEntries[0] || null;
  const summary = analytics?.summary;
  const scopeLabel = scope === "mine" ? "我的技能" : scope === "shared" ? "共享仓库" : "全部技能";

  const governanceCounts = useMemo(() => ({
    all: libraryEntries.length,
    used: libraryEntries.filter((entry) => (entry.analytics?.usage_count_30d || 0) > 0).length,
    idle: libraryEntries.filter((entry) => (entry.analytics?.usage_count_30d || 0) === 0).length,
    unowned: libraryEntries.filter((entry) => entry.analytics && !entry.analytics.owner_id).length,
  }), [libraryEntries]);

  return (
    <div className="skill-governance">
      <section className="skill-governance-kpis" aria-label="技能治理核心指标">
        <GovernanceMetric icon={<AppstoreOutlined />} tone="blue" label="技能资产" value={formatNumber(summary?.total_skills ?? libraryEntries.length)} note={`${analytics?.scope_label || "当前范围"} · 已归档`} />
        <GovernanceMetric icon={<BarChartOutlined />} tone="green" label="累计调用" value={formatNumber(summary?.total_invocations || 0)} note={`近 30 日 ${formatNumber(summary?.invocations_30d || 0)} 次`} />
        <GovernanceMetric icon={<CheckCircleFilled />} tone="violet" label="技能使用率" value={`${summary?.utilization_rate || 0}%`} note={`近 30 日活跃 ${summary?.active_skills_30d || 0} 个`} />
        <GovernanceMetric icon={<TeamOutlined />} tone="amber" label="共享采用" value={formatNumber(summary?.shared_adoptions || 0)} note={`${summary?.shared_skills || 0} 个共享技能`} />
        <GovernanceMetric icon={<SafetyCertificateOutlined />} tone="cyan" label="责任覆盖" value={`${summary?.responsibility_coverage || 0}%`} note={`${summary?.owner_count || 0} 位责任人`} />
      </section>

      <section className="skill-governance-toolbar" aria-label="技能筛选与操作">
        <div className="skill-governance-toolbar__scope" role="group" aria-label="技能范围">
          {([
            ["all", `全部 ${libraryEntries.length}`],
            ["mine", `我的 ${libraryEntries.filter((entry) => entry.personal).length}`],
            ["shared", `共享 ${assets.filter((asset) => asset.visibility === "shared").length}`],
          ] as Array<[ScopeFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={scope === value} className={scope === value ? "is-active" : ""} onClick={() => { setScope(value); setPage(1); }}>{label}</button>
          ))}
        </div>
        <Input
          className="skill-governance-search"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索技能、Skill ID、责任人或团队"
          aria-label="搜索技能"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="skill-governance-toolbar__actions">
          <Tooltip title="刷新治理数据"><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button></Tooltip>
          <Upload {...uploadProps} disabled={!cosEnabled}>
            <Button icon={<CloudUploadOutlined />} loading={uploading} disabled={!cosEnabled} title="支持 .md、.markdown 和 .zip 完整技能包">上传文件 / ZIP</Button>
          </Upload>
          <input ref={folderInputRef} type="file" multiple hidden tabIndex={-1} aria-hidden="true" onChange={(event) => void handleFolderUpload(event)} />
          <Tooltip title="选择包含 SKILL.md、scripts 等内容的完整技能目录">
            <Button type="primary" icon={<FolderOpenOutlined />} loading={uploading} disabled={!cosEnabled} aria-label="上传技能文件夹" onClick={() => folderInputRef.current?.click()}>上传文件夹</Button>
          </Tooltip>
        </div>
      </section>

      <div className="skill-governance-layout">
        <aside className="skill-governance-sidebar" aria-label="技能治理视图">
          <div className="skill-governance-panel-head">
            <div><span className="skill-governance-eyebrow">Governance</span><Typography.Title level={5}>治理视图</Typography.Title></div>
            <Tag bordered={false}>{analytics?.scope_label || "加载中"}</Tag>
          </div>
          <nav className="skill-governance-view-nav">
            {([
              ["all", <AppstoreOutlined />, "全部资产", "完整技能台账"],
              ["used", <BarChartOutlined />, "近期活跃", "近 30 日有调用"],
              ["idle", <ClockCircleOutlined />, "待激活", "近 30 日无调用"],
              ["unowned", <UserOutlined />, "待认领", "尚未指定责任人"],
            ] as Array<[GovernanceView, ReactNode, string, string]>).map(([value, icon, label, note]) => (
              <button key={value} type="button" className={governanceView === value ? "is-active" : ""} onClick={() => setGovernanceView(value)}>
                <span className="skill-governance-view-icon">{icon}</span>
                <span><strong>{label}</strong><small>{note}</small></span>
                <b>{governanceCounts[value]}</b>
              </button>
            ))}
          </nav>

          <div className="skill-governance-sidebar-section">
            <span className="skill-governance-sidebar-label">能力分类</span>
            <div className="skill-governance-category-list">
              {SKILL_CATEGORIES.map((item) => (
                <button key={item.key} type="button" className={category === item.key ? "is-active" : ""} onClick={() => setCategory(item.key)}>
                  <span>{categoryIcon(item.key)}</span><em>{item.label}</em><b>{categoryCounts.get(item.key) || 0}</b>
                </button>
              ))}
            </div>
          </div>

          <div className={`skill-governance-storage${cosEnabled ? " is-online" : ""}`}>
            <CloudOutlined />
            <div><strong>{cosEnabled ? "共享仓库在线" : "共享仓库未配置"}</strong><span>{cosEnabled ? "团队技能可持续复用" : "配置 COS 后开放上传"}</span></div>
          </div>
        </aside>

        <main className="skill-governance-main">
          <section className="skill-register" aria-labelledby="skill-register-title">
            <header className="skill-register-head">
              <div>
                <span className="skill-governance-eyebrow">Responsibility register</span>
                <Typography.Title id="skill-register-title" level={4}>技能责任台账</Typography.Title>
                <Typography.Text type="secondary">当前：{scopeLabel} · {filteredEntries.length} 个结果 · 指标来自实际启用与调用记录</Typography.Text>
              </div>
              <div className="skill-register-filters">
                <Select aria-label="启用状态" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "enabled", label: "已启用" }, { value: "disabled", label: "未启用" }]} />
                {analytics?.can_manage && (
                  <Select
                    aria-label="责任人筛选"
                    value={ownerId}
                    onChange={setOwnerId}
                    options={[{ value: "all", label: "全部责任人" }, ...(analytics.owner_options || []).map((owner) => ({ value: owner.id, label: owner.name }))]}
                  />
                )}
                <Select aria-label="排序方式" value={sortKey} onChange={setSortKey} options={[{ value: "usage", label: "按调用量" }, { value: "recent", label: "按最近使用" }, { value: "reuse", label: "按共用人数" }]} />
              </div>
            </header>

            <Spin spinning={loading}>
              {pagedEntries.length ? (
                <div className="skill-register-table-wrap">
                  <table className="skill-register-table">
                    <thead><tr><th>技能资产</th><th>责任人</th><th>近 30 日使用</th><th>共用情况</th><th>最近使用</th><th>状态</th></tr></thead>
                    <tbody>
                      {pagedEntries.map((entry) => {
                        const stats = entry.analytics;
                        const enabled = Boolean(entry.personal?.enabled);
                        return (
                          <tr
                            key={entry.skillId}
                            className={selectedEntry?.skillId === entry.skillId ? "is-selected" : ""}
                            tabIndex={0}
                            aria-selected={selectedEntry?.skillId === entry.skillId}
                            onClick={() => setSelectedSkillId(entry.skillId)}
                            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedSkillId(entry.skillId); }}
                          >
                            <td><div className="skill-register-identity"><span className={`skill-register-icon tone-${entry.category}`}>{categoryIcon(entry.category)}</span><div><strong>{entry.name}</strong><code>{entry.skillId}</code></div></div></td>
                            <td><div className="skill-owner-cell"><Avatar size={28}>{initials(stats?.owner || "待")}</Avatar><div><strong>{stats?.owner || "待认领"}</strong><span>{stats?.owner_team || "未归属团队"}</span></div></div></td>
                            <td><div className="skill-number-cell"><strong>{formatNumber(stats?.usage_count_30d || 0)}</strong><span>{stats?.unique_users_30d || 0} 位使用者</span></div></td>
                            <td><div className="skill-number-cell"><strong>{stats?.adoption_count || 0} 人采用</strong><span>{stats?.enabled_count || 0} 人已启用</span></div></td>
                            <td><div className="skill-latest-cell"><strong>{formatDateTime(stats?.last_used_at)}</strong><span>{stats?.last_used_by || "暂无调用"}</span></div></td>
                            <td><Tag bordered={false} className={`skill-register-status ${enabled ? "is-enabled" : entry.personal ? "is-paused" : "is-available"}`}>{enabled ? "启用" : entry.personal ? "停用" : "可采用"}</Tag></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="skill-register-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前条件下没有匹配的技能"><Button onClick={() => { setQuery(""); setCategory("all"); setGovernanceView("all"); setOwnerId("all"); setScope("all"); setStatus("all"); }}>清除筛选</Button></Empty></div>
              )}
            </Spin>

            <footer className="skill-register-footer">
              <span>共 {filteredEntries.length} 项技能资产</span>
              <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filteredEntries.length} hideOnSinglePage onChange={setPage} showSizeChanger={false} />
            </footer>
          </section>

          <UsageTrend points={analytics?.trend || []} />
        </main>

        <aside className="skill-governance-insights" aria-label="技能使用洞察">
          <RankingPanel rows={analytics?.ranking || []} selectedSkillId={selectedEntry?.skillId} onSelect={setSelectedSkillId} />
          <SkillResponsibilityPanel
            entry={selectedEntry}
            canManage={Boolean(analytics?.can_manage)}
            owners={analytics?.owner_options || []}
            actionLoading={Boolean(selectedEntry && actionSkillId === selectedEntry.skillId)}
            onOwnerChange={(nextOwnerId) => {
              if (!selectedEntry?.asset) return;
              void runAction(selectedEntry.skillId, () => updateSkillAssetOwner(selectedEntry.asset!.id, nextOwnerId), "责任人已更新");
            }}
            onToggle={(enabled) => {
              if (!selectedEntry?.personal) return;
              void runAction(selectedEntry.skillId, () => toggleSkill(selectedEntry.skillId, enabled), enabled ? "技能已启用" : "技能已停用");
            }}
            onAdopt={() => selectedEntry && void runAction(selectedEntry.skillId, () => adoptSkillAsset(selectedEntry.skillId), "已添加到我的技能")}
            onInvoke={selectedEntry?.personal && onInvoke ? () => onInvoke(selectedEntry.personal!) : undefined}
            onVisibilityChange={(visibility) => {
              if (!selectedEntry?.asset) return;
              const success = visibility === "shared" ? "已发布到共享仓库，团队成员可主动采用" : "已取消共享，并撤销其他成员的采用入口";
              void runAction(selectedEntry.skillId, () => updateSkillAssetVisibility(selectedEntry.asset!.id, visibility), success);
            }}
            onDelete={() => {
              if (!selectedEntry) return;
              const deletesAsset = Boolean(selectedEntry.asset?.is_uploader);
              void runAction(
                selectedEntry.skillId,
                () => deletesAsset ? deleteSkillAsset(selectedEntry.skillId) : deleteSkill(selectedEntry.skillId),
                deletesAsset ? "技能资产已删除" : "已从我的技能移除",
              );
            }}
          />
        </aside>
      </div>
    </div>
  );
}

function GovernanceMetric({ icon, tone, label, value, note }: { icon: ReactNode; tone: string; label: string; value: string; note: string }) {
  return <article className={`skill-governance-metric tone-${tone}`}><span className="skill-governance-metric__icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

function UsageTrend({ points }: { points: Array<{ date: string; label: string; count: number }> }) {
  const max = Math.max(1, ...points.map((point) => point.count));
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: 24 + index * (592 / Math.max(1, points.length - 1)),
    y: 118 - (point.count / max) * 88,
  }));
  const line = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const area = chartPoints.length ? `M ${chartPoints[0].x} 118 L ${line.split(" ").join(" L ")} L ${chartPoints[chartPoints.length - 1].x} 118 Z` : "";
  return (
    <section className="skill-usage-trend" aria-labelledby="skill-trend-title">
      <header><div><span className="skill-governance-eyebrow">Usage signal</span><Typography.Title id="skill-trend-title" level={5}>近 7 日调用趋势</Typography.Title></div><Tag bordered={false}>真实调用事件</Tag></header>
      <div className="skill-usage-chart">
        <svg viewBox="0 0 640 150" role="img" aria-label={`近七日技能调用趋势，最高单日 ${max} 次`}>
          <defs><linearGradient id="skillTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f66d9" stopOpacity="0.2" /><stop offset="100%" stopColor="#2f66d9" stopOpacity="0" /></linearGradient></defs>
          <line x1="24" y1="118" x2="616" y2="118" className="chart-axis" />
          {area && <path d={area} fill="url(#skillTrendFill)" />}
          {line && <polyline points={line} className="chart-line" />}
          {chartPoints.map((point) => <g key={point.date}><circle cx={point.x} cy={point.y} r="4" className="chart-point" /><text x={point.x} y={point.y - 10} textAnchor="middle" className="chart-value">{point.count}</text><text x={point.x} y="141" textAnchor="middle" className="chart-label">{point.label}</text></g>)}
        </svg>
      </div>
    </section>
  );
}

function RankingPanel({ rows, selectedSkillId, onSelect }: { rows: SkillAnalyticsRow[]; selectedSkillId?: string; onSelect: (skillId: string) => void }) {
  const max = Math.max(1, ...rows.map((row) => row.usage_count_30d));
  return (
    <section className="skill-insight-panel skill-ranking-panel">
      <header><div><span className="skill-governance-eyebrow">Top usage</span><Typography.Title level={5}>调用排行榜</Typography.Title></div><span>近 30 日</span></header>
      {rows.length ? <ol>{rows.map((row, index) => <li key={row.asset_id} className={selectedSkillId === row.skill_id ? "is-active" : ""}><button type="button" onClick={() => onSelect(row.skill_id)}><b>{index + 1}</b><div><strong>{row.name}</strong><span><i style={{ width: `${Math.max(4, row.usage_count_30d / max * 100)}%` }} /></span></div><em>{formatNumber(row.usage_count_30d)}</em></button></li>)}</ol> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用数据" />}
    </section>
  );
}

function SkillResponsibilityPanel({ entry, canManage, owners, actionLoading, onOwnerChange, onToggle, onAdopt, onInvoke, onVisibilityChange, onDelete }: {
  entry: SkillEntry | null;
  canManage: boolean;
  owners: Array<{ id: number; name: string; username: string }>;
  actionLoading: boolean;
  onOwnerChange: (ownerId: number | null) => void;
  onToggle: (enabled: boolean) => void;
  onAdopt: () => void;
  onInvoke?: () => void;
  onVisibilityChange: (visibility: "shared" | "private") => void;
  onDelete: () => void;
}) {
  if (!entry) return <section className="skill-insight-panel"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择技能查看详情" /></section>;
  const stats = entry.analytics;
  return (
    <section className="skill-insight-panel skill-responsibility-panel">
      <header><div><span className="skill-governance-eyebrow">Accountability</span><Typography.Title level={5}>责任与使用详情</Typography.Title></div><Tag bordered={false}>{entry.asset?.visibility === "shared" ? "共享" : "仅自己"}</Tag></header>
      <div className="skill-responsibility-title"><span className={`skill-register-icon tone-${entry.category}`}>{categoryIcon(entry.category)}</span><div><strong>{entry.name}</strong><code>{entry.skillId}</code></div></div>
      <div className="skill-responsibility-owner">
        <span>技能责任人</span>
        {canManage && entry.asset ? (
          <Select
            value={stats?.owner_id ?? undefined}
            allowClear
            placeholder="指派责任人"
            loading={actionLoading}
            onChange={(value) => onOwnerChange(value ?? null)}
            options={owners.map((owner) => ({ value: owner.id, label: owner.name }))}
          />
        ) : <div><Avatar size={30}>{initials(stats?.owner || entry.asset?.owner || "待")}</Avatar><span><strong>{stats?.owner || entry.asset?.owner || "待认领"}</strong><small>{stats?.owner_team || "未归属团队"}</small></span></div>}
      </div>
      <div className="skill-responsibility-stats"><div><span>近 30 日调用</span><strong>{formatNumber(stats?.usage_count_30d || 0)}</strong></div><div><span>独立使用者</span><strong>{stats?.unique_users_30d || 0}</strong></div><div><span>采用人数</span><strong>{stats?.adoption_count || 0}</strong></div><div><span>启用人数</span><strong>{stats?.enabled_count || 0}</strong></div></div>
      <div className="skill-responsibility-progress"><div><span>共用启用率</span><b>{stats?.adoption_count ? Math.round((stats.enabled_count / stats.adoption_count) * 100) : 0}%</b></div><Progress percent={stats?.adoption_count ? Math.round((stats.enabled_count / stats.adoption_count) * 100) : 0} showInfo={false} strokeColor="#2f66d9" trailColor="rgba(47, 102, 217, 0.09)" /></div>
      <div className="skill-recent-usage">
        <div className="skill-insight-subhead"><span>谁使用了这个技能</span><small>最近 5 次</small></div>
        {stats?.recent_usage?.length ? <ul>{stats.recent_usage.map((event) => <li key={event.id}><Avatar size={24}>{initials(event.user)}</Avatar><div><strong>{event.user}</strong><span>{event.source_label}</span></div><time dateTime={event.used_at}>{formatDateTime(event.used_at)}</time></li>)}</ul> : <div className="skill-recent-empty"><ClockCircleOutlined /> 暂无使用记录</div>}
      </div>
      <div className="skill-responsibility-actions">
        {entry.personal ? <span className="skill-enable-control"><Switch checked={entry.personal.enabled} loading={actionLoading} onChange={onToggle} />{entry.personal.enabled ? "已启用" : "已停用"}</span> : <Button type="primary" icon={<ImportOutlined />} loading={actionLoading} onClick={onAdopt}>添加到我的技能</Button>}
        {onInvoke && <Button onClick={onInvoke} disabled={!entry.personal?.enabled}>调用技能</Button>}
        {entry.asset?.is_uploader && entry.asset.visibility === "private" && <Button icon={<ShareAltOutlined />} loading={actionLoading} onClick={() => onVisibilityChange("shared")}>发布共享</Button>}
        {entry.asset?.is_uploader && entry.asset.visibility === "shared" && <Popconfirm title="取消共享后，其他成员已采用的入口会被撤销。确定继续？" onConfirm={() => onVisibilityChange("private")}><Button icon={<LockOutlined />} loading={actionLoading}>取消共享</Button></Popconfirm>}
        {(entry.asset?.is_uploader || entry.personal) && <Popconfirm title={entry.asset?.is_uploader ? "删除技能资产？所有成员的采用入口会一并移除。" : "从我的技能中移除？"} onConfirm={onDelete}><Button type="text" danger icon={<DeleteOutlined />} aria-label={entry.asset?.is_uploader ? "删除技能资产" : "移除我的技能"} /></Popconfirm>}
      </div>
    </section>
  );
}
