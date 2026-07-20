import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Button,
  Collapse,
  Drawer,
  Empty,
  Input,
  List,
  Popconfirm,
  Segmented,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from "antd";
import {
  AppstoreOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  ShopOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { UploadProps } from "antd";
import {
  adoptSkillAsset,
  deleteSkill,
  deleteSkillAsset,
  getSkillAssets,
  getSkills,
  toggleSkill,
  uploadSkillAsset,
  type SkillAssetItem,
  type UserSkillItem,
} from "../api/client";
import { brand } from "../theme/brand";

type Props = {
  onInvoke?: (skill: UserSkillItem) => void;
  variant?: "sidebar" | "page";
};

type SkillScope = "all" | "mine" | "repo";
type SkillStatus = "all" | "enabled" | "disabled";
type SkillCategoryKey = "all" | "business" | "analysis" | "content" | "automation" | "general";

type SkillCategory = {
  key: SkillCategoryKey;
  label: string;
  description: string;
  keywords: string[];
};

type SkillLibraryEntry = {
  skillId: string;
  name: string;
  description: string;
  category: Exclude<SkillCategoryKey, "all">;
  updatedAt: string;
  personal?: UserSkillItem;
  asset?: SkillAssetItem;
};

const SKILL_CATEGORIES: SkillCategory[] = [
  { key: "all", label: "全部技能", description: "查看所有能力", keywords: [] },
  { key: "business", label: "经营运营", description: "商品、店铺与客户运营", keywords: ["经营", "运营", "电商", "商品", "店铺", "订单", "客服", "零售", "commerce", "shop"] },
  { key: "analysis", label: "数据分析", description: "指标、报表与数据洞察", keywords: ["数据", "分析", "报表", "指标", "sql", "洞察", "统计", "dashboard", "analytics"] },
  { key: "content", label: "内容生产", description: "文案、图片与营销内容", keywords: ["内容", "文案", "图片", "图像", "视频", "营销", "海报", "写作", "image", "content", "copy"] },
  { key: "automation", label: "自动化工具", description: "脚本、连接与工作流", keywords: ["自动化", "脚本", "连接", "工作流", "同步", "批量", "mcp", "workflow", "automation", "script"] },
  { key: "general", label: "通用能力", description: "跨场景通用技能", keywords: [] },
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
  const match = SKILL_CATEGORIES.find((category) => (
    category.key !== "all"
    && category.key !== "general"
    && category.keywords.some((keyword) => text.includes(keyword))
  ));
  return (match?.key || "general") as Exclude<SkillCategoryKey, "all">;
}

function formatUpdatedAt(value: string): string {
  if (!value) return "暂无更新时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无更新时间";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFileSize(value?: number): string {
  if (!value) return "单文件";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null || !("response" in error)) return fallback;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  return typeof response?.data?.error === "string" ? response.data.error : fallback;
}

export default function UserSkills({ onInvoke, variant = "sidebar" }: Props) {
  const [skills, setSkills] = useState<UserSkillItem[]>([]);
  const [assets, setAssets] = useState<SkillAssetItem[]>([]);
  const [cosEnabled, setCosEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionSkillId, setActionSkillId] = useState<string | null>(null);
  const [scope, setScope] = useState<SkillScope>("all");
  const [status, setStatus] = useState<SkillStatus>("all");
  const [category, setCategory] = useState<SkillCategoryKey>("all");
  const [query, setQuery] = useState("");
  const [detailEntry, setDetailEntry] = useState<SkillLibraryEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [personal, repo] = await Promise.all([getSkills(), getSkillAssets()]);
      setSkills(personal.results || []);
      setAssets(repo.results || []);
      setCosEnabled(!!repo.cos_enabled);
    } catch {
      message.error("加载 Skill 失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const uploadProps: UploadProps = {
    showUploadList: false,
    accept: ".md,.markdown,.zip",
    beforeUpload: async (file) => {
      setUploading(true);
      try {
        const res = await uploadSkillAsset(file);
        if (res.asset) {
          message.success(`已上传到技能仓库：${res.asset.name}`);
        } else if (res.personal) {
          message.success(`已保存到个人 Skill：${res.personal.name}`);
        } else {
          message.success("上传成功");
        }
        await load();
      } catch (error: unknown) {
        message.error(getErrorMessage(error, "上传失败"));
      } finally {
        setUploading(false);
      }
      return false;
    },
  };

  const handleAdopt = async (skillId: string) => {
    setActionSkillId(skillId);
    try {
      await adoptSkillAsset(skillId);
      message.success("已添加到我的技能");
      await load();
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "添加失败"));
    } finally {
      setActionSkillId(null);
    }
  };

  const handleDeletePersonal = async (skillId: string) => {
    setActionSkillId(skillId);
    try {
      await deleteSkill(skillId);
      message.success("已从我的技能中移除");
      if (detailEntry?.skillId === skillId) setDetailEntry(null);
      await load();
    } catch {
      message.error("移除失败");
    } finally {
      setActionSkillId(null);
    }
  };

  const handleDeleteAsset = async (skillId: string) => {
    setActionSkillId(skillId);
    try {
      await deleteSkillAsset(skillId);
      message.success("已从共享仓库删除");
      if (detailEntry?.skillId === skillId) setDetailEntry(null);
      await load();
    } catch {
      message.error("删除失败，请确认你是该技能的上传者");
    } finally {
      setActionSkillId(null);
    }
  };

  const handleToggle = async (skill: UserSkillItem, enabled: boolean) => {
    setActionSkillId(skill.skill_id);
    try {
      await toggleSkill(skill.skill_id, enabled);
      setSkills((prev) => prev.map((item) => (
        item.skill_id === skill.skill_id ? { ...item, enabled } : item
      )));
      setDetailEntry((prev) => (
        prev?.skillId === skill.skill_id && prev.personal
          ? { ...prev, personal: { ...prev.personal, enabled } }
          : prev
      ));
      message.success(enabled ? "技能已启用" : "技能已停用");
    } catch {
      message.error("更新失败");
    } finally {
      setActionSkillId(null);
    }
  };

  const libraryEntries = useMemo<SkillLibraryEntry[]>(() => {
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
        || "暂无说明，可打开详情查看技能标识与来源信息。";
      return {
        skillId,
        name,
        description,
        category: classifySkill(skillId, name, description),
        updatedAt: value.personal?.updated_at || value.asset?.updated_at || "",
        ...value,
      };
    }).sort((left, right) => {
      const enabledDelta = Number(Boolean(right.personal?.enabled)) - Number(Boolean(left.personal?.enabled));
      if (enabledDelta) return enabledDelta;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [assets, skills]);

  const scopedEntries = useMemo(() => libraryEntries.filter((entry) => {
    if (scope === "mine") return Boolean(entry.personal);
    if (scope === "repo") return Boolean(entry.asset);
    return true;
  }), [libraryEntries, scope]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<SkillCategoryKey, number>([["all", scopedEntries.length]]);
    scopedEntries.forEach((entry) => counts.set(entry.category, (counts.get(entry.category) || 0) + 1));
    return counts;
  }, [scopedEntries]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return scopedEntries.filter((entry) => {
      if (category !== "all" && entry.category !== category) return false;
      if (status === "enabled" && !entry.personal?.enabled) return false;
      if (status === "disabled" && entry.personal?.enabled) return false;
      if (!normalizedQuery) return true;
      return [entry.name, entry.skillId, entry.description, entry.asset?.uploader]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery));
    });
  }, [category, query, scopedEntries, status]);

  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const scriptedCount = assets.filter((asset) => asset.has_scripts).length;
  const currentCategory = SKILL_CATEGORIES.find((item) => item.key === category) || SKILL_CATEGORIES[0];
  const panelClass = variant === "page" ? "user-skills-panel user-skills-page" : "user-skills-panel";

  if (variant === "page") {
    return (
      <div className={panelClass}>
        <section className="skill-library-overview" aria-label="技能库概览">
          <MetricCard icon={<AppstoreOutlined />} label="技能总数" value={libraryEntries.length} note="已归档能力" />
          <MetricCard icon={<CheckCircleFilled />} label="已启用" value={enabledCount} note="可在 Agent 中调用" />
          <MetricCard icon={<CloudOutlined />} label="共享仓库" value={assets.length} note={cosEnabled ? "COS 已连接" : "本地模式"} />
          <MetricCard icon={<CodeOutlined />} label="含脚本技能" value={scriptedCount} note="具备自动化能力" />
        </section>

        <section className="skill-library-commandbar" aria-label="技能筛选工具栏">
          <Segmented
            className="skill-library-scope"
            value={scope}
            onChange={(value) => {
              setScope(value as SkillScope);
              setCategory("all");
            }}
            options={[
              { label: `全部 ${libraryEntries.length}`, value: "all" },
              { label: `我的技能 ${skills.length}`, value: "mine" },
              { label: `共享仓库 ${assets.length}`, value: "repo" },
            ]}
          />
          <Input
            className="skill-library-search"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索名称、Skill ID 或描述"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="skill-library-command-actions">
            <Tooltip title="刷新技能列表">
              <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
            </Tooltip>
            <Upload {...uploadProps} disabled={!cosEnabled}>
              <Button type="primary" icon={<CloudUploadOutlined />} loading={uploading} disabled={!cosEnabled}>
                上传技能
              </Button>
            </Upload>
          </div>
        </section>

        <div className="skill-library-layout">
          <aside className="skill-library-sidebar" aria-label="技能分类">
            <div className="skill-library-sidebar-head">
              <Typography.Text strong>技能分类</Typography.Text>
              <Typography.Text type="secondary">自动归类</Typography.Text>
            </div>
            <nav className="skill-category-nav">
              {SKILL_CATEGORIES.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`skill-category-item${category === item.key ? " is-active" : ""}`}
                  onClick={() => setCategory(item.key)}
                >
                  <span className="skill-category-icon">{categoryIcon(item.key)}</span>
                  <span className="skill-category-copy">
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="skill-category-count">{categoryCounts.get(item.key) || 0}</span>
                </button>
              ))}
            </nav>
            <div className={`skill-storage-status${cosEnabled ? " is-online" : ""}`}>
              <span className="skill-storage-status-icon"><CloudOutlined /></span>
              <div>
                <strong>{cosEnabled ? "共享仓库已连接" : "共享仓库未配置"}</strong>
                <small>{cosEnabled ? "上传后团队成员可复用" : "配置 COS 后可上传共享技能"}</small>
              </div>
            </div>
          </aside>

          <main className="skill-library-main">
            <div className="skill-library-list-head">
              <div>
                <Typography.Title level={4}>{currentCategory.label}</Typography.Title>
                <Typography.Text type="secondary">
                  {filteredEntries.length} 个结果 · {currentCategory.description}
                </Typography.Text>
              </div>
              <Segmented
                size="small"
                value={status}
                onChange={(value) => setStatus(value as SkillStatus)}
                options={[
                  { label: "全部状态", value: "all" },
                  { label: "已启用", value: "enabled" },
                  { label: "未启用", value: "disabled" },
                ]}
              />
            </div>

            <Spin spinning={loading}>
              {filteredEntries.length > 0 ? (
                <div className="skill-card-grid">
                  {filteredEntries.map((entry) => (
                    <SkillCard
                      key={entry.skillId}
                      entry={entry}
                      actionLoading={actionSkillId === entry.skillId}
                      onDetail={() => setDetailEntry(entry)}
                      onAdopt={() => handleAdopt(entry.skillId)}
                      onDeleteAsset={() => handleDeleteAsset(entry.skillId)}
                      onDeletePersonal={() => handleDeletePersonal(entry.skillId)}
                      onInvoke={onInvoke && entry.personal ? () => onInvoke(entry.personal!) : undefined}
                      onToggle={(enabled) => entry.personal && handleToggle(entry.personal, enabled)}
                    />
                  ))}
                </div>
              ) : (
                <LibraryEmpty
                  hasFilters={Boolean(query) || category !== "all" || status !== "all"}
                  cosEnabled={cosEnabled}
                  uploadProps={uploadProps}
                  uploading={uploading}
                  onReset={() => {
                    setQuery("");
                    setCategory("all");
                    setStatus("all");
                  }}
                />
              )}
            </Spin>
          </main>
        </div>

        <SkillDetailDrawer
          entry={detailEntry}
          actionLoading={Boolean(detailEntry && actionSkillId === detailEntry.skillId)}
          onClose={() => setDetailEntry(null)}
          onAdopt={(skillId) => handleAdopt(skillId)}
          onDeleteAsset={(skillId) => handleDeleteAsset(skillId)}
          onDeletePersonal={(skillId) => handleDeletePersonal(skillId)}
          onToggle={(skill, enabled) => handleToggle(skill, enabled)}
        />
      </div>
    );
  }

  const collapseItems = [
    {
      key: "repo",
      label: (
        <Space>
          <CloudUploadOutlined />
          <span>Skill 仓库 {cosEnabled ? "(COS)" : "(未启用)"}</span>
        </Space>
      ),
      children: (
        <>
          <div className="user-skills-head">
            <Typography.Paragraph type="secondary" className="user-skills-hint">
              技能仓库全员共享。请上传 <strong>.zip 完整包</strong>（含 SKILL.md + scripts/）。
            </Typography.Paragraph>
            <Upload {...uploadProps} disabled={!cosEnabled}>
              <Button type="primary" size="small" icon={<CloudUploadOutlined />} disabled={!cosEnabled}>上传</Button>
            </Upload>
          </div>
          <List
            size="small"
            loading={loading}
            locale={{ emptyText: cosEnabled ? "暂无仓库 Skill" : "请配置 COS" }}
            dataSource={assets}
            renderItem={(item) => (
              <List.Item
                className="user-skill-item"
                actions={[
                  <Tooltip key="adopt" title="添加到我的技能">
                    <Button type="text" size="small" icon={<ImportOutlined />} onClick={() => handleAdopt(item.skill_id)} />
                  </Tooltip>,
                  <Popconfirm key="del" title="从 COS 删除此 Skill？" onConfirm={() => handleDeleteAsset(item.skill_id)}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={item.name}
                  description={(
                    <>
                      <Typography.Text code style={{ fontSize: 11 }}>{item.skill_id}</Typography.Text>
                      {item.package_kind === "package" ? (
                        <TagMini>{item.has_scripts ? `完整包 · ${item.package_file_count || 0} 文件 · 含脚本` : `完整包 · ${item.package_file_count || 0} 文件`}</TagMini>
                      ) : (
                        <TagMini style={{ color: brand.textMuted }}>仅 SKILL.md（无脚本）</TagMini>
                      )}
                    </>
                  )}
                />
              </List.Item>
            )}
          />
        </>
      ),
    },
    {
      key: "personal",
      label: "我的 Skill（可 @ 调用）",
      extra: <Button type="text" size="small" icon={<ReloadOutlined />} loading={loading} onClick={(event) => { event.stopPropagation(); load(); }} />,
      children: (
        <List
          size="small"
          loading={loading}
          locale={{ emptyText: "请从仓库添加 Skill" }}
          dataSource={skills}
          renderItem={(item) => (
            <List.Item
              className="user-skill-item"
              actions={[
                <Tooltip key="invoke" title={`插入 @${item.skill_id}`}>
                  <Button type="text" size="small" icon={<PlayCircleOutlined />} disabled={!item.enabled} onClick={() => onInvoke?.(item)} />
                </Tooltip>,
                <Popconfirm key="del" title="从个人列表移除？" onConfirm={() => handleDeletePersonal(item.skill_id)}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={(
                  <Space size={6}>
                    <span>{item.name}</span>
                    <Switch size="small" checked={item.enabled} onChange={(checked) => handleToggle(item, checked)} />
                  </Space>
                )}
                description={(
                  <>
                    <Typography.Text code style={{ fontSize: 11 }}>@{item.skill_id}</Typography.Text>
                    {item.storage === "cos" && <TagMini>来自 COS</TagMini>}
                  </>
                )}
              />
            </List.Item>
          )}
        />
      ),
    },
  ];

  return (
    <div className={panelClass}>
      <Collapse ghost size="small" defaultActiveKey={["repo", "personal"]} items={collapseItems} />
    </div>
  );
}

function MetricCard({ icon, label, value, note }: { icon: ReactNode; label: string; value: number; note: string }) {
  return (
    <div className="skill-metric-card">
      <span className="skill-metric-icon">{icon}</span>
      <div className="skill-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

function SkillCard({
  entry,
  actionLoading,
  onDetail,
  onAdopt,
  onDeleteAsset,
  onDeletePersonal,
  onInvoke,
  onToggle,
}: {
  entry: SkillLibraryEntry;
  actionLoading: boolean;
  onDetail: () => void;
  onAdopt: () => void;
  onDeleteAsset: () => void;
  onDeletePersonal: () => void;
  onInvoke?: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const installed = Boolean(entry.personal);
  const enabled = Boolean(entry.personal?.enabled);
  const category = SKILL_CATEGORIES.find((item) => item.key === entry.category);
  return (
    <article className={`skill-library-card${enabled ? " is-enabled" : ""}`}>
      <div className="skill-library-card-top">
        <span className="skill-library-card-icon">{categoryIcon(entry.category)}</span>
        <div className="skill-library-card-tags">
          <Tag bordered={false}>{category?.label}</Tag>
          <Tag bordered={false} className={`skill-state-tag ${enabled ? "is-enabled" : installed ? "is-paused" : "is-available"}`}>
            {enabled ? <CheckCircleFilled /> : <ClockCircleOutlined />}
            {enabled ? "已启用" : installed ? "已停用" : "可添加"}
          </Tag>
        </div>
      </div>
      <div className="skill-library-card-title">
        <Typography.Title level={5}>{entry.name}</Typography.Title>
        <Typography.Text code>@{entry.skillId}</Typography.Text>
      </div>
      <Typography.Paragraph className="skill-library-card-desc" ellipsis={{ rows: 3 }}>
        {entry.description}
      </Typography.Paragraph>
      <div className="skill-library-card-meta">
        <span><FolderOpenOutlined /> {entry.asset?.package_kind === "package" ? `${entry.asset.package_file_count || 0} 个文件` : formatFileSize(entry.asset?.file_size)}</span>
        <span><CodeOutlined /> {entry.asset?.has_scripts ? "含执行脚本" : "指令型技能"}</span>
        <span><ClockCircleOutlined /> {formatUpdatedAt(entry.updatedAt)}</span>
      </div>
      <div className="skill-library-card-footer">
        <Button type="link" onClick={onDetail}>查看详情</Button>
        <div className="skill-library-card-actions">
          {entry.personal ? (
            <>
              {onInvoke && <Tooltip title={`调用 @${entry.skillId}`}><Button icon={<PlayCircleOutlined />} onClick={onInvoke} disabled={!enabled} /></Tooltip>}
              <span className="skill-toggle-control"><Switch size="small" checked={enabled} loading={actionLoading} onChange={onToggle} /> {enabled ? "启用" : "停用"}</span>
              <Popconfirm title="从我的技能中移除？" okText="移除" cancelText="取消" onConfirm={onDeletePersonal}>
                <Button danger type="text" icon={<DeleteOutlined />} aria-label="移除个人技能" />
              </Popconfirm>
            </>
          ) : (
            <Button type="primary" icon={<ImportOutlined />} loading={actionLoading} onClick={onAdopt}>添加到我的技能</Button>
          )}
          {entry.asset && (
            <Popconfirm title="从共享仓库删除？仅上传者可执行。" okText="删除" cancelText="取消" onConfirm={onDeleteAsset}>
              <Button danger type="text" icon={<DeleteOutlined />} aria-label="删除共享技能" />
            </Popconfirm>
          )}
        </div>
      </div>
    </article>
  );
}

function LibraryEmpty({
  hasFilters,
  cosEnabled,
  uploadProps,
  uploading,
  onReset,
}: {
  hasFilters: boolean;
  cosEnabled: boolean;
  uploadProps: UploadProps;
  uploading: boolean;
  onReset: () => void;
}) {
  if (hasFilters) {
    return (
      <div className="skill-library-empty is-filtered">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前筛选条件下没有匹配的技能">
          <Button onClick={onReset}>清除筛选</Button>
        </Empty>
      </div>
    );
  }
  return (
    <div className="skill-library-empty">
      <div className="skill-empty-hero">
        <span><ThunderboltOutlined /></span>
        <div>
          <Typography.Title level={4}>开始搭建团队技能目录</Typography.Title>
          <Typography.Paragraph type="secondary">
            上传标准 Skill 包，系统会提取名称与说明，并自动归入合适分类。
          </Typography.Paragraph>
        </div>
        <Upload {...uploadProps} disabled={!cosEnabled}>
          <Button type="primary" icon={<CloudUploadOutlined />} loading={uploading} disabled={!cosEnabled}>上传第一个技能</Button>
        </Upload>
      </div>
      <div className="skill-empty-steps">
        <div><b>01</b><span><strong>准备技能包</strong><small>SKILL.md 或包含 scripts/ 的 ZIP</small></span></div>
        <div><b>02</b><span><strong>进入共享仓库</strong><small>统一沉淀并自动分类</small></span></div>
        <div><b>03</b><span><strong>添加并启用</strong><small>在 Agent 对话中通过 @ 调用</small></span></div>
      </div>
    </div>
  );
}

function SkillDetailDrawer({
  entry,
  actionLoading,
  onClose,
  onAdopt,
  onDeleteAsset,
  onDeletePersonal,
  onToggle,
}: {
  entry: SkillLibraryEntry | null;
  actionLoading: boolean;
  onClose: () => void;
  onAdopt: (skillId: string) => void;
  onDeleteAsset: (skillId: string) => void;
  onDeletePersonal: (skillId: string) => void;
  onToggle: (skill: UserSkillItem, enabled: boolean) => void;
}) {
  const category = entry ? SKILL_CATEGORIES.find((item) => item.key === entry.category) : null;
  return (
    <Drawer
      className="skill-detail-drawer"
      width={520}
      open={Boolean(entry)}
      onClose={onClose}
      title="技能详情"
      extra={entry?.personal ? (
        <Switch checked={entry.personal.enabled} loading={actionLoading} onChange={(enabled) => onToggle(entry.personal!, enabled)} checkedChildren="启用" unCheckedChildren="停用" />
      ) : null}
    >
      {entry && (
        <div className="skill-detail-content">
          <div className="skill-detail-title-row">
            <span className="skill-detail-icon">{categoryIcon(entry.category)}</span>
            <div>
              <Typography.Title level={3}>{entry.name}</Typography.Title>
              <Typography.Text code>@{entry.skillId}</Typography.Text>
            </div>
          </div>
          <div className="skill-detail-tags">
            <Tag>{category?.label}</Tag>
            <Tag>{entry.personal?.enabled ? "已启用" : entry.personal ? "已停用" : "尚未添加"}</Tag>
            <Tag>{entry.asset ? "团队共享" : "个人技能"}</Tag>
          </div>
          <section>
            <Typography.Title level={5}>技能说明</Typography.Title>
            <Typography.Paragraph>{entry.description}</Typography.Paragraph>
          </section>
          <section className="skill-detail-info">
            <Typography.Title level={5}>管理信息</Typography.Title>
            <dl>
              <div><dt>Skill ID</dt><dd>{entry.skillId}</dd></div>
              <div><dt>技能分类</dt><dd>{category?.label}</dd></div>
              <div><dt>存储来源</dt><dd>{entry.asset ? "COS 共享仓库" : "个人本地"}</dd></div>
              <div><dt>包类型</dt><dd>{entry.asset?.package_kind === "package" ? `完整包（${entry.asset.package_file_count || 0} 个文件）` : "单文件 SKILL.md"}</dd></div>
              <div><dt>执行脚本</dt><dd>{entry.asset?.has_scripts ? "包含 scripts/" : "无脚本"}</dd></div>
              <div><dt>上传者</dt><dd>{entry.asset?.uploader || "当前用户"}</dd></div>
              <div><dt>最近更新</dt><dd>{formatUpdatedAt(entry.updatedAt)}</dd></div>
            </dl>
          </section>
          {entry.asset?.instructions_preview && (
            <section>
              <Typography.Title level={5}>指令预览</Typography.Title>
              <pre className="skill-instructions-preview">{entry.asset.instructions_preview}</pre>
            </section>
          )}
          <div className="skill-detail-tip">
            <InfoCircleOutlined />
            <span>启用后，在 Agent 对话中输入 <code>@{entry.skillId}</code> 即可调用该技能。</span>
          </div>
          <div className="skill-detail-actions">
            {!entry.personal && <Button type="primary" icon={<ImportOutlined />} loading={actionLoading} onClick={() => onAdopt(entry.skillId)}>添加到我的技能</Button>}
            {entry.personal && (
              <Popconfirm title="从我的技能中移除？" onConfirm={() => onDeletePersonal(entry.skillId)}>
                <Button danger icon={<DeleteOutlined />}>从我的技能移除</Button>
              </Popconfirm>
            )}
            {entry.asset && (
              <Popconfirm title="从共享仓库删除？仅上传者可执行。" onConfirm={() => onDeleteAsset(entry.skillId)}>
                <Button danger type="text" icon={<DeleteOutlined />}>删除共享文件</Button>
              </Popconfirm>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}

function TagMini({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ marginLeft: 6, fontSize: 10, color: brand.gold, ...style }}>{children}</span>;
}
