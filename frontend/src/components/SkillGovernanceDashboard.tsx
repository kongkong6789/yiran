import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Avatar,
  Button,
  ConfigProvider,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Modal,
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
import dayjs, { type Dayjs } from "dayjs";
import {
  AppstoreOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  ImportOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  ShareAltOutlined,
  ShopOutlined,
  StarOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  adoptSkillAsset,
  createSkillAsset,
  deleteSkill,
  deleteSkillAsset,
  getSkillAnalytics,
  getSkillAssetUsage,
  getSkillAssets,
  getSkills,
  importSkillHubSkill,
  searchSkillHub,
  toggleSkill,
  updateSkillAssetCategory,
  updateSkillAssetOwner,
  updateSkillAssetVisibility,
  uploadSkillAsset,
  uploadSkillAssetFolder,
  type SkillAnalyticsResponse,
  type SkillAnalyticsRow,
  type SkillAssetCategory,
  type SkillAssetItem,
  type SkillHubSkillItem,
  type SkillHubApiKeyFilter,
  type SkillHubCategoryFilter,
  type SkillHubSourceFilter,
  type SkillHubSortKey,
  type SkillPeopleRankingItem,
  type SkillTrendSeries,
  type SkillUsageEventItem,
  type UserSkillItem,
} from "../api/client";

type Props = {
  onInvoke?: (skill: UserSkillItem) => void;
};

type SkillCategoryKey = "all" | SkillAssetCategory;
type GovernanceView = "all" | "used" | "idle" | "unowned";
type ScopeFilter = "all" | "mine" | "shared" | "uploaded" | "skillhub";
type StatusFilter = "all" | "enabled" | "disabled";
type SortKey = "recent" | "usage" | "reuse";
type RankingMode = "skills" | "people";
type UploadActivity = {
  mode: "files" | "folder";
  stage: "uploading" | "processing";
  label: string;
  current: number;
  total: number;
  percent: number;
};

type CreateSkillDraft = {
  skillId: string;
  name: string;
  description: string;
  instructions: string;
  category: SkillAssetCategory;
  adopt: boolean;
};

const EMPTY_CREATE_SKILL: CreateSkillDraft = {
  skillId: "",
  name: "",
  description: "",
  instructions: "",
  category: "general",
  adopt: true,
};

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
  category: SkillAssetCategory;
  updatedAt: string;
  personal?: UserSkillItem;
  asset?: SkillAssetItem;
  analytics?: SkillAnalyticsRow;
};

const PAGE_SIZE = 8;
const MAX_SKILL_MARKDOWN_BYTES = 512_000;
const MAX_SKILL_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_SKILL_FOLDER_FILES = 200;
const MAX_SKILL_BATCH_FILES = 20;
const MAX_SKILL_BATCH_BYTES = 100 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

function validateSkillFiles(files: File[]): string | null {
  if (files.length > MAX_SKILL_BATCH_FILES) return `一次最多上传 ${MAX_SKILL_BATCH_FILES} 个技能文件`;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_SKILL_BATCH_BYTES) return `本批文件总大小不能超过 ${formatFileSize(MAX_SKILL_BATCH_BYTES)}`;
  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".md") && !lowerName.endsWith(".markdown") && !lowerName.endsWith(".zip")) {
      return `${file.name} 格式不支持，仅支持 .md、.markdown 和 .zip`;
    }
    const limit = lowerName.endsWith(".zip") ? MAX_SKILL_PACKAGE_BYTES : MAX_SKILL_MARKDOWN_BYTES;
    if (file.size > limit) return `${file.name} 超过 ${formatFileSize(limit)} 上限`;
  }
  return null;
}

function validateSkillFolder(files: File[]): string | null {
  if (files.length > MAX_SKILL_FOLDER_FILES) return `技能文件夹最多包含 ${MAX_SKILL_FOLDER_FILES} 个文件`;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_SKILL_PACKAGE_BYTES) return `技能文件夹总大小不能超过 ${formatFileSize(MAX_SKILL_PACKAGE_BYTES)}`;
  return null;
}

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

const SKILL_CATEGORY_OPTIONS = SKILL_CATEGORIES
  .filter((item): item is SkillCategory & { key: SkillAssetCategory } => item.key !== "all")
  .map((item) => ({ value: item.key, label: item.label }));

const SKILLHUB_SORT_OPTIONS: Array<{ value: SkillHubSortKey; label: string }> = [
  { value: "score", label: "全部" },
  { value: "curated_score", label: "推荐精选" },
  { value: "rank", label: "近期飙升" },
  { value: "downloads", label: "下载量" },
  { value: "stars", label: "收藏量" },
  { value: "updated_at", label: "最近上新" },
];

const SKILLHUB_CATEGORY_FILTER_OPTIONS: Array<{ value: SkillHubCategoryFilter; label: string }> = [
  { value: "", label: "所有场景分类" },
  { value: "office-efficiency", label: "办公效率" },
  { value: "content-creation", label: "内容创作" },
  { value: "dev-programming", label: "开发编程" },
  { value: "data-analysis", label: "数据分析" },
  { value: "design-media", label: "设计多媒体" },
  { value: "ai-agent", label: "AI Agent" },
  { value: "knowledge-management", label: "知识管理" },
  { value: "business-ops", label: "商业运营" },
  { value: "education", label: "教育学习" },
  { value: "professional", label: "行业专业" },
  { value: "it-ops-security", label: "IT 运维与安全" },
  { value: "life-service", label: "生活服务" },
];

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
  if (typeof error !== "object" || error === null) return fallback;
  if ("code" in error && (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT")) {
    return "上传超时，请检查网络或缩小技能包后重试";
  }
  if (!("response" in error)) return fallback;
  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  return typeof response?.data?.error === "string" ? response.data.error : fallback;
}

export default function SkillGovernanceDashboard({ onInvoke }: Props) {
  const [skills, setSkills] = useState<UserSkillItem[]>([]);
  const [assets, setAssets] = useState<SkillAssetItem[]>([]);
  const [analytics, setAnalytics] = useState<SkillAnalyticsResponse | null>(null);
  const [cosEnabled, setCosEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [trendLoading, setTrendLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadActivity, setUploadActivity] = useState<UploadActivity | null>(null);
  const [skillHubOpen, setSkillHubOpen] = useState(false);
  const [skillHubLoading, setSkillHubLoading] = useState(false);
  const [skillHubImporting, setSkillHubImporting] = useState<string | null>(null);
  const [skillHubQuery, setSkillHubQuery] = useState("");
  const [skillHubSort, setSkillHubSort] = useState<SkillHubSortKey>("score");
  const [skillHubSource, setSkillHubSource] = useState<SkillHubSourceFilter>("");
  const [skillHubCategory, setSkillHubCategory] = useState<SkillHubCategoryFilter>("");
  const [skillHubApiKey, setSkillHubApiKey] = useState<SkillHubApiKeyFilter>("");
  const [skillHubPage, setSkillHubPage] = useState(1);
  const [skillHubTotal, setSkillHubTotal] = useState(0);
  const [skillHubResults, setSkillHubResults] = useState<SkillHubSkillItem[]>([]);
  const [skillHubError, setSkillHubError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateSkillDraft>(EMPTY_CREATE_SKILL);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageRows, setUsageRows] = useState<SkillUsageEventItem[]>([]);
  const [usageTotal, setUsageTotal] = useState(0);
  const [usagePage, setUsagePage] = useState(1);
  const [usageAsset, setUsageAsset] = useState<{ id: number; name: string } | null>(null);
  const [actionSkillId, setActionSkillId] = useState<string | null>(null);
  const [governanceView, setGovernanceView] = useState<GovernanceView>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<SkillCategoryKey>("all");
  const [uploadCategory, setUploadCategory] = useState<SkillAssetCategory>("general");
  const [ownerId, setOwnerId] = useState<number | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("usage");
  const [rankingMode, setRankingMode] = useState<RankingMode>("skills");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [trendRange, setTrendRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(6, "day"),
    dayjs(),
  ]);
  const trendRangeRef = useRef(trendRange);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [personal, repository, insight] = await Promise.all([
        getSkills(),
        getSkillAssets(),
        getSkillAnalytics({
          trend_start: trendRangeRef.current[0].format("YYYY-MM-DD"),
          trend_end: trendRangeRef.current[1].format("YYYY-MM-DD"),
        }),
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

  const handleTrendRangeChange = useCallback(async (nextRange: [Dayjs, Dayjs]) => {
    setTrendLoading(true);
    try {
      const insight = await getSkillAnalytics({
        trend_start: nextRange[0].format("YYYY-MM-DD"),
        trend_end: nextRange[1].format("YYYY-MM-DD"),
      });
      trendRangeRef.current = nextRange;
      setTrendRange(nextRange);
      setAnalytics(insight);
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "趋势数据加载失败"));
    } finally {
      setTrendLoading(false);
    }
  }, []);

  const handleSkillFileBatch = async (files: File[]) => {
    if (uploading || !files.length) return;
    const validationError = validateSkillFiles(files);
    if (validationError) {
      message.error(validationError);
      return;
    }

    setUploading(true);
    let successCount = 0;
    const failures: string[] = [];
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadActivity({ mode: "files", stage: "uploading", label: file.name, current: index + 1, total: files.length, percent: Math.round(index / files.length * 100) });
        try {
          await uploadSkillAsset(file, true, uploadCategory, (event) => {
            const filePercent = event.total ? Math.min(99, event.loaded / event.total * 100) : 0;
            setUploadActivity({
              mode: "files",
              stage: filePercent >= 99 ? "processing" : "uploading",
              label: file.name,
              current: index + 1,
              total: files.length,
              percent: Math.round((index + filePercent / 100) / files.length * 100),
            });
          });
          successCount += 1;
        } catch (error: unknown) {
          failures.push(`${file.name}：${getErrorMessage(error, "上传失败")}`);
        }
      }

      if (successCount > 0) await load();
      if (!failures.length) {
        message.success(`已成功上传 ${successCount} 个技能并加入我的技能`);
      } else if (successCount > 0) {
        message.warning(`成功 ${successCount} 个，失败 ${failures.length} 个：${failures.slice(0, 2).join("；")}`);
      } else {
        message.error(failures.slice(0, 2).join("；"));
      }
    } finally {
      setUploadActivity(null);
      setUploading(false);
    }
  };

  const uploadProps: UploadProps = {
    showUploadList: false,
    accept: ".md,.markdown,.zip",
    multiple: true,
    beforeUpload: (file, fileList) => {
      if (file.uid === fileList[0]?.uid) void handleSkillFileBatch(Array.from(fileList));
      return false;
    },
  };

  const handleFolderUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    const paths = files.map((file) => file.webkitRelativePath || file.name);
    const validationError = validateSkillFolder(files);
    if (validationError) {
      message.error(validationError);
      input.value = "";
      return;
    }
    if (!paths.some((path) => path.split("/").pop()?.toLowerCase() === "skill.md")) {
      message.error("所选文件夹中没有 SKILL.md，请选择完整的技能目录");
      input.value = "";
      return;
    }

    setUploading(true);
    const folderName = paths[0]?.split("/")[0] || "技能文件夹";
    setUploadActivity({ mode: "folder", stage: "uploading", label: folderName, current: files.length, total: files.length, percent: 0 });
    try {
      const result = await uploadSkillAssetFolder(files, true, uploadCategory, (progressEvent) => {
        const percent = progressEvent.total ? Math.min(99, Math.round(progressEvent.loaded / progressEvent.total * 100)) : 0;
        setUploadActivity({ mode: "folder", stage: percent >= 99 ? "processing" : "uploading", label: folderName, current: files.length, total: files.length, percent });
      });
      message.success(`已上传为个人技能：${result.asset?.name || result.personal?.name || folderName}，发布后团队成员才能采用`);
      await load();
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "文件夹上传失败"));
    } finally {
      input.value = "";
      setUploadActivity(null);
      setUploading(false);
    }
  };

  const loadSkillHub = async (
    nextPage = 1,
    overrides: Partial<{
      sort: SkillHubSortKey;
      source: SkillHubSourceFilter;
      category: SkillHubCategoryFilter;
      apiKey: SkillHubApiKeyFilter;
    }> = {},
  ) => {
    const nextSort = overrides.sort ?? skillHubSort;
    const nextSource = overrides.source ?? skillHubSource;
    const nextCategory = overrides.category ?? skillHubCategory;
    const nextApiKey = overrides.apiKey ?? skillHubApiKey;
    setSkillHubLoading(true);
    setSkillHubError("");
    try {
      const result = await searchSkillHub({
        q: skillHubQuery.trim() || undefined,
        page: nextPage,
        page_size: 10,
        sort_by: nextSort,
        source: nextSource || undefined,
        category: nextCategory || undefined,
        api_key: nextApiKey || undefined,
      });
      setSkillHubResults(result.results || []);
      setSkillHubTotal(result.total || 0);
      setSkillHubPage(nextPage);
    } catch (error: unknown) {
      const detail = getErrorMessage(error, "SkillHub 暂时无法访问，请稍后重试");
      setSkillHubError(detail);
      message.error(detail);
    } finally {
      setSkillHubLoading(false);
    }
  };

  const openSkillHub = () => {
    setSkillHubOpen(true);
    if (!skillHubResults.length) void loadSkillHub(1);
  };

  const handleSkillHubImport = async (skill: SkillHubSkillItem) => {
    setSkillHubImporting(skill.slug);
    try {
      const result = await importSkillHubSkill({
        slug: skill.slug,
        version: skill.version,
        category: uploadCategory,
        adopt: true,
      });
      message.success(
        result.verification?.verified
          ? `已下载并验签：${skill.name}，已加入我的技能`
          : `已下载：${skill.name}，该版本未提供平台签名`,
      );
      await load();
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "SkillHub 技能导入失败"));
    } finally {
      setSkillHubImporting(null);
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

  const handleCreateSkill = async () => {
    const skillId = createDraft.skillId.trim();
    const name = createDraft.name.trim();
    const instructions = createDraft.instructions.trim();
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(skillId)) {
      message.error("Skill ID 需为 2-64 位小写字母、数字或连字符");
      return;
    }
    if (!name) {
      message.error("请填写技能名称");
      return;
    }
    if (!instructions) {
      message.error("请填写技能执行说明");
      return;
    }
    setCreateSaving(true);
    try {
      const result = await createSkillAsset({
        skill_id: skillId,
        name,
        description: createDraft.description,
        instructions,
        category: createDraft.category,
        adopt: createDraft.adopt,
      });
      message.success(`已创建并纳管技能：${result.asset.name}`);
      setCreateOpen(false);
      setCreateDraft(EMPTY_CREATE_SKILL);
      setScope("uploaded");
      await load();
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "创建技能失败"));
    } finally {
      setCreateSaving(false);
    }
  };

  const loadUsageHistory = async (assetId: number, nextPage = 1) => {
    setUsageLoading(true);
    try {
      const result = await getSkillAssetUsage(assetId, { page: nextPage, page_size: 20 });
      setUsageRows(result.results || []);
      setUsageTotal(result.count || 0);
      setUsagePage(result.page || nextPage);
      setUsageAsset({ id: result.asset.id, name: result.asset.name });
    } catch (error: unknown) {
      message.error(getErrorMessage(error, "调用记录加载失败"));
    } finally {
      setUsageLoading(false);
    }
  };

  const openUsageHistory = (entry: SkillEntry) => {
    if (!entry.asset) return;
    setUsageOpen(true);
    setUsageRows([]);
    setUsageTotal(0);
    setUsageAsset({ id: entry.asset.id, name: entry.name });
    void loadUsageHistory(entry.asset.id, 1);
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
        category: value.asset?.category || classifySkill(skillId, name, description),
        updatedAt: value.personal?.updated_at || value.asset?.updated_at || "",
        analytics: value.asset ? analyticsByAsset.get(value.asset.id) : analyticsBySkill.get(skillId),
        ...value,
      };
    });
  }, [analytics?.skills, assets, skills]);

  const scopedEntries = useMemo(() => libraryEntries.filter((entry) => {
    if (scope === "mine") return Boolean(entry.personal);
    if (scope === "shared") return entry.asset?.visibility === "shared";
    if (scope === "uploaded") return Boolean(entry.asset?.is_uploader && entry.asset.source === "upload");
    if (scope === "skillhub") return entry.asset?.source === "skillhub";
    return true;
  }), [libraryEntries, scope]);

  const categoryCounts = useMemo(() => {
    const result = new Map<SkillCategoryKey, number>([["all", scopedEntries.length]]);
    scopedEntries.forEach((entry) => result.set(entry.category, (result.get(entry.category) || 0) + 1));
    return result;
  }, [scopedEntries]);

  const filteredEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const entries = scopedEntries.filter((entry) => {
      const stats = entry.analytics;
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
  }, [category, governanceView, ownerId, query, scopedEntries, sortKey, status]);

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
  const scopeLabel = scope === "mine"
    ? "我的技能"
    : scope === "shared"
      ? "企业共享仓库"
      : scope === "uploaded"
        ? "我的上传"
        : scope === "skillhub"
          ? "SkillHub 仓库"
          : "全部技能";
  const activeCategory = SKILL_CATEGORIES.find((item) => item.key === category) || SKILL_CATEGORIES[0];
  const trendSeries = useMemo<SkillTrendSeries>(() => {
    const scoped = analytics?.trend_by_category?.[category];
    if (scoped) return scoped;
    const points = (analytics?.trend || []).map((point) => ({
      ...point,
      unique_users: point.unique_users || 0,
      active_skills: point.active_skills || 0,
    }));
    const total = points.reduce((sum, point) => sum + point.count, 0);
    const peak = points.reduce((current, point) => point.count > current.count ? point : current, points[0] || { date: "", label: "暂无峰值", count: 0, unique_users: 0, active_skills: 0 });
    return {
      points,
      total,
      unique_users: 0,
      active_skills: 0,
      daily_average: points.length ? Number((total / points.length).toFixed(1)) : 0,
      peak_date: peak.count ? peak.date : null,
      peak_label: peak.count ? peak.label : "暂无峰值",
      peak_count: peak.count,
    };
  }, [analytics?.trend, analytics?.trend_by_category, category]);

  const governanceCounts = useMemo(() => ({
    all: scopedEntries.length,
    used: scopedEntries.filter((entry) => (entry.analytics?.usage_count_30d || 0) > 0).length,
    idle: scopedEntries.filter((entry) => (entry.analytics?.usage_count_30d || 0) === 0).length,
    unowned: scopedEntries.filter((entry) => entry.analytics && !entry.analytics.owner_id).length,
  }), [scopedEntries]);

  const repositoryCounts = useMemo<Record<ScopeFilter, number>>(() => ({
    all: libraryEntries.length,
    mine: libraryEntries.filter((entry) => Boolean(entry.personal)).length,
    shared: libraryEntries.filter((entry) => entry.asset?.visibility === "shared").length,
    uploaded: libraryEntries.filter((entry) => Boolean(entry.asset?.is_uploader && entry.asset.source === "upload")).length,
    skillhub: libraryEntries.filter((entry) => entry.asset?.source === "skillhub").length,
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
          <label className="skill-upload-category">
            <span>上传归类</span>
            <Select aria-label="上传技能的能力分类" value={uploadCategory} onChange={setUploadCategory} options={SKILL_CATEGORY_OPTIONS} />
          </label>
          <Button icon={<GlobalOutlined />} onClick={openSkillHub}>SkillHub 技能库</Button>
          <Button icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建技能</Button>
          <Tooltip title="刷新治理数据"><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button></Tooltip>
          <Tooltip title={uploadActivity?.mode === "files" ? `正在上传 ${uploadActivity.label}` : "支持批量选择；Markdown 最大 512KB，ZIP 单个最大 20MB，一次最多 20 个"}>
            <Upload {...uploadProps}>
              <Button icon={<CloudUploadOutlined />} loading={uploading}>
                {uploadActivity?.mode === "files"
                  ? `${uploadActivity.current}/${uploadActivity.total} · ${uploadActivity.stage === "processing" ? "处理中" : `${uploadActivity.percent}%`}`
                  : "批量上传 · 20MB/个"}
              </Button>
            </Upload>
          </Tooltip>
          <input ref={folderInputRef} type="file" multiple hidden disabled={uploading} tabIndex={-1} aria-hidden="true" onChange={(event) => void handleFolderUpload(event)} />
          <Tooltip title={uploadActivity?.mode === "folder" ? `正在上传 ${uploadActivity.label}，共 ${uploadActivity.total} 个文件` : "选择包含 SKILL.md、scripts 等内容的完整技能目录；最大 20MB、200 个文件"}>
            <Button type="primary" icon={<FolderOpenOutlined />} loading={uploading} aria-label="上传技能文件夹" onClick={() => folderInputRef.current?.click()}>
              {uploadActivity?.mode === "folder"
                ? (uploadActivity.stage === "processing" ? "处理中" : `${uploadActivity.percent}%`)
                : "上传文件夹 · 20MB"}
            </Button>
          </Tooltip>
        </div>
      </section>

      <div className="skill-governance-workspace">
        <section className="skill-governance-row skill-governance-row--primary" aria-label="技能治理与责任台账">
          <aside className="skill-governance-sidebar skill-governance-view-panel" aria-label="技能仓库">
            <div className="skill-governance-panel-head">
              <div><span className="skill-governance-eyebrow">Repository</span><Typography.Title level={5}>技能仓库</Typography.Title></div>
              <Tag bordered={false}>{repositoryCounts[scope]} 项</Tag>
            </div>
            <nav className="skill-governance-view-nav">
              {([
                ["all", <AppstoreOutlined />, "全部技能", "跨仓库完整台账"],
                ["shared", <TeamOutlined />, "企业共享仓库", "成员可主动采用"],
                ["mine", <UserOutlined />, "我的技能", "我已启用或采用"],
                ["uploaded", <CloudUploadOutlined />, "我的上传", "由我创建和维护"],
                ["skillhub", <GlobalOutlined />, "SkillHub 仓库", "在线下载并纳管"],
              ] as Array<[ScopeFilter, ReactNode, string, string]>).map(([value, icon, label, note]) => (
                <button key={value} type="button" className={scope === value ? "is-active" : ""} onClick={() => { setScope(value); setPage(1); }}>
                  <span className="skill-governance-view-icon">{icon}</span>
                  <span><strong>{label}</strong><small>{note}</small></span>
                  <b>{repositoryCounts[value]}</b>
                </button>
              ))}
            </nav>
          </aside>

          <section className="skill-register" aria-labelledby="skill-register-title">
            <header className="skill-register-head">
              <div>
                <span className="skill-governance-eyebrow">Responsibility register</span>
                <Typography.Title id="skill-register-title" level={4}>仓库技能列表</Typography.Title>
                <Typography.Text type="secondary">当前：{scopeLabel} · {filteredEntries.length} 个结果 · 指标来自实际启用与调用记录</Typography.Text>
              </div>
              <div className="skill-register-filters">
                <Select
                  aria-label="治理状态"
                  value={governanceView}
                  onChange={setGovernanceView}
                  options={[
                    { value: "all", label: `全部治理状态 ${governanceCounts.all}` },
                    { value: "used", label: `近期活跃 ${governanceCounts.used}` },
                    { value: "idle", label: `待激活 ${governanceCounts.idle}` },
                    { value: "unowned", label: `待认领 ${governanceCounts.unowned}` },
                  ]}
                />
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
                            <td><div className="skill-register-identity"><span className={`skill-register-icon tone-${entry.category}`}>{categoryIcon(entry.category)}</span><div><strong>{entry.name}{entry.asset?.source === "skillhub" && <em className="skill-source-badge">SkillHub</em>}</strong><code>{entry.skillId}</code></div></div></td>
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

          <RankingSwitcher
            mode={rankingMode}
            onModeChange={setRankingMode}
            skillRows={analytics?.ranking || []}
            peopleRows={analytics?.people_ranking || []}
            selectedSkillId={selectedEntry?.skillId}
            onSelectSkill={setSelectedSkillId}
          />
        </section>

        <section className="skill-governance-row skill-governance-row--secondary" aria-label="能力分类与使用洞察">
          <aside className="skill-governance-sidebar skill-governance-category-panel" aria-label="技能能力分类">
            <div className="skill-governance-panel-head">
              <div><span className="skill-governance-eyebrow">Capability taxonomy</span><Typography.Title level={5}>能力分类</Typography.Title></div>
              <Tag bordered={false}>{categoryCounts.get(category) || 0} 项</Tag>
            </div>
            <div className="skill-governance-sidebar-section">
              <div className="skill-governance-category-list">
                {SKILL_CATEGORIES.map((item) => (
                  <button key={item.key} type="button" aria-pressed={category === item.key} aria-controls="skill-usage-trend" className={category === item.key ? "is-active" : ""} onClick={() => setCategory(item.key)}>
                    <span>{categoryIcon(item.key)}</span><em>{item.label}</em><b>{categoryCounts.get(item.key) || 0}</b>
                  </button>
                ))}
              </div>
            </div>
            <div className={`skill-governance-storage${cosEnabled ? " is-online" : ""}`}>
              <CloudOutlined />
              <div><strong>{cosEnabled ? "共享仓库在线" : "本地仓库在线"}</strong><span>{cosEnabled ? "团队技能可持续复用" : "上传可用，配置 COS 后开放共享存储"}</span></div>
            </div>
          </aside>

          <UsageTrend
            series={trendSeries}
            categoryLabel={activeCategory.label}
            dateRange={trendRange}
            loading={loading || trendLoading}
            onDateRangeChange={handleTrendRangeChange}
          />

          <SkillResponsibilityPanel
            entry={selectedEntry}
            canManage={Boolean(analytics?.can_manage)}
            owners={analytics?.owner_options || []}
            actionLoading={Boolean(selectedEntry && actionSkillId === selectedEntry.skillId)}
            onOwnerChange={(nextOwnerId) => {
              if (!selectedEntry?.asset) return;
              void runAction(selectedEntry.skillId, () => updateSkillAssetOwner(selectedEntry.asset!.id, nextOwnerId), "责任人已更新");
            }}
            onCategoryChange={(nextCategory) => {
              if (!selectedEntry?.asset) return;
              void runAction(selectedEntry.skillId, () => updateSkillAssetCategory(selectedEntry.asset!.id, nextCategory), "能力分类已更新");
            }}
            onToggle={(enabled) => {
              if (!selectedEntry?.personal) return;
              void runAction(selectedEntry.skillId, () => toggleSkill(selectedEntry.skillId, enabled), enabled ? "技能已启用" : "技能已停用");
            }}
            onAdopt={() => selectedEntry && void runAction(selectedEntry.skillId, () => adoptSkillAsset(selectedEntry.skillId), "已添加到我的技能")}
            onInvoke={selectedEntry?.personal && onInvoke ? () => onInvoke(selectedEntry.personal!) : undefined}
            onViewUsageHistory={() => selectedEntry && openUsageHistory(selectedEntry)}
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
        </section>
      </div>

      <Modal
        title="创建技能"
        open={createOpen}
        okText="创建并纳管"
        cancelText="取消"
        confirmLoading={createSaving}
        destroyOnHidden
        onCancel={() => { setCreateOpen(false); setCreateDraft(EMPTY_CREATE_SKILL); }}
        onOk={() => void handleCreateSkill()}
      >
        <div className="skill-create-form">
          <label><span>技能名称</span><Input value={createDraft.name} maxLength={128} placeholder="例如：经营日报分析" onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label><span>Skill ID</span><Input value={createDraft.skillId} maxLength={64} placeholder="例如：daily-ops-report" onChange={(event) => setCreateDraft((current) => ({ ...current, skillId: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))} /></label>
          <label><span>能力分类</span><Select value={createDraft.category} options={SKILL_CATEGORY_OPTIONS} onChange={(value) => setCreateDraft((current) => ({ ...current, category: value }))} /></label>
          <label><span>技能说明</span><Input value={createDraft.description} maxLength={240} placeholder="说明这个技能解决什么问题" onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="skill-create-form__instructions"><span>执行说明</span><Input.TextArea value={createDraft.instructions} rows={8} maxLength={8000} showCount placeholder="描述触发条件、执行步骤、输入输出与边界……" onChange={(event) => setCreateDraft((current) => ({ ...current, instructions: event.target.value }))} /></label>
          <label className="skill-create-form__adopt"><Switch checked={createDraft.adopt} onChange={(checked) => setCreateDraft((current) => ({ ...current, adopt: checked }))} /><span>创建后同时加入“我的技能”并启用</span></label>
        </div>
      </Modal>

      <Drawer
        rootClassName="skill-usage-drawer"
        width={560}
        open={usageOpen}
        title={<div><strong>完整调用记录</strong><small>{usageAsset?.name || "当前技能"}</small></div>}
        onClose={() => setUsageOpen(false)}
      >
        <Spin spinning={usageLoading}>
          {usageRows.length ? (
            <div className="skill-usage-history-list">
              {usageRows.map((event) => (
                <article key={event.id}>
                  <Avatar size={34}>{initials(event.user)}</Avatar>
                  <div><strong>{event.user}</strong><span>{event.source_label} · {event.skill_name || event.skill_id}</span></div>
                  <time dateTime={event.used_at}>{formatDateTime(event.used_at)}</time>
                </article>
              ))}
            </div>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={usageLoading ? "正在加载调用记录" : "暂无调用记录"} />}
        </Spin>
        {usageTotal > 20 && usageAsset && (
          <Pagination current={usagePage} pageSize={20} total={usageTotal} showSizeChanger={false} onChange={(nextPage) => void loadUsageHistory(usageAsset.id, nextPage)} />
        )}
      </Drawer>

      <SkillHubDrawer
        open={skillHubOpen}
        loading={skillHubLoading}
        importingSlug={skillHubImporting}
        query={skillHubQuery}
        sort={skillHubSort}
        source={skillHubSource}
        marketCategory={skillHubCategory}
        apiKey={skillHubApiKey}
        page={skillHubPage}
        total={skillHubTotal}
        results={skillHubResults}
        error={skillHubError}
        category={uploadCategory}
        assets={assets}
        onClose={() => setSkillHubOpen(false)}
        onQueryChange={setSkillHubQuery}
        onSearch={() => void loadSkillHub(1)}
        onSortChange={(nextSort) => {
          setSkillHubSort(nextSort);
          void loadSkillHub(1, { sort: nextSort });
        }}
        onSourceChange={(nextSource) => {
          setSkillHubSource(nextSource);
          void loadSkillHub(1, { source: nextSource });
        }}
        onMarketCategoryChange={(nextCategory) => {
          setSkillHubCategory(nextCategory);
          void loadSkillHub(1, { category: nextCategory });
        }}
        onApiKeyChange={(nextApiKey) => {
          setSkillHubApiKey(nextApiKey);
          void loadSkillHub(1, { apiKey: nextApiKey });
        }}
        onResetFilters={() => {
          setSkillHubSource("");
          setSkillHubCategory("");
          setSkillHubApiKey("");
          void loadSkillHub(1, { source: "", category: "", apiKey: "" });
        }}
        onPageChange={(nextPage) => void loadSkillHub(nextPage)}
        onCategoryChange={setUploadCategory}
        onImport={(skill) => void handleSkillHubImport(skill)}
      />
    </div>
  );
}

function SkillHubDrawer({
  open,
  loading,
  importingSlug,
  query,
  sort,
  source,
  marketCategory,
  apiKey,
  page,
  total,
  results,
  error,
  category,
  assets,
  onClose,
  onQueryChange,
  onSearch,
  onSortChange,
  onSourceChange,
  onMarketCategoryChange,
  onApiKeyChange,
  onResetFilters,
  onPageChange,
  onCategoryChange,
  onImport,
}: {
  open: boolean;
  loading: boolean;
  importingSlug: string | null;
  query: string;
  sort: SkillHubSortKey;
  source: SkillHubSourceFilter;
  marketCategory: SkillHubCategoryFilter;
  apiKey: SkillHubApiKeyFilter;
  page: number;
  total: number;
  results: SkillHubSkillItem[];
  error: string;
  category: SkillAssetCategory;
  assets: SkillAssetItem[];
  onClose: () => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSortChange: (value: SkillHubSortKey) => void;
  onSourceChange: (value: SkillHubSourceFilter) => void;
  onMarketCategoryChange: (value: SkillHubCategoryFilter) => void;
  onApiKeyChange: (value: SkillHubApiKeyFilter) => void;
  onResetFilters: () => void;
  onPageChange: (page: number) => void;
  onCategoryChange: (value: SkillAssetCategory) => void;
  onImport: (skill: SkillHubSkillItem) => void;
}) {
  const installedBySlug = new Map(
    assets
      .filter((asset) => asset.source === "skillhub")
      .map((asset) => [String(asset.source_metadata?.slug || asset.skill_id), asset]),
  );
  const activeFilterCount = [source, marketCategory, apiKey].filter(Boolean).length;
  return (
    <Drawer
      rootClassName="skillhub-drawer"
      width={840}
      open={open}
      onClose={onClose}
      title={(
        <div className="skillhub-drawer__title">
          <span><GlobalOutlined /></span>
          <div><strong>SkillHub 在线技能库</strong><small>发现公开 Skill，验签后下载到企业技能治理中心</small></div>
        </div>
      )}
    >
      <section className="skillhub-discovery" aria-label="SkillHub 技能发现">
        <div className="skillhub-discovery__sort-tabs" role="tablist" aria-label="SkillHub 发现排序">
          {SKILLHUB_SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={sort === option.value}
              className={sort === option.value ? "is-active" : ""}
              onClick={() => onSortChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="skillhub-discovery__search-row">
          <Input.Search
            allowClear
            enterButton="搜索"
            loading={loading}
            value={query}
            placeholder="搜索技能名称、用途或粘贴 SkillHub 链接"
            aria-label="搜索 SkillHub 技能"
            onChange={(event) => onQueryChange(event.target.value)}
            onSearch={onSearch}
          />
        </div>

        <div className="skillhub-discovery__filters">
          <div className="skillhub-discovery__market-filters">
            <label>
              <span>来源</span>
              <Select<SkillHubSourceFilter>
                aria-label="SkillHub 来源筛选"
                value={source}
                onChange={onSourceChange}
                options={[
                  { value: "", label: "所有来源" },
                  { value: "clawhub", label: "ClawHub" },
                  { value: "community", label: "SkillHub" },
                ]}
              />
            </label>
            <label>
              <span>场景分类</span>
              <Select<SkillHubCategoryFilter>
                aria-label="SkillHub 场景分类筛选"
                value={marketCategory}
                onChange={onMarketCategoryChange}
                options={SKILLHUB_CATEGORY_FILTER_OPTIONS}
              />
            </label>
            <label>
              <span>API Key</span>
              <Select<SkillHubApiKeyFilter>
                aria-label="SkillHub API Key 筛选"
                value={apiKey}
                onChange={onApiKeyChange}
                options={[
                  { value: "", label: "不限 API Key" },
                  { value: "required", label: "需要 API Key" },
                  { value: "not_required", label: "无需 API Key" },
                ]}
              />
            </label>
            {activeFilterCount > 0 && <Button type="link" onClick={onResetFilters}>清除筛选 · {activeFilterCount}</Button>}
          </div>
          <label className="skillhub-discovery__category">
            <span>下载后归类</span>
            <Select<SkillAssetCategory> value={category} onChange={onCategoryChange} options={SKILL_CATEGORY_OPTIONS} />
          </label>
        </div>

        <div className="skillhub-discovery__trust">
          <SafetyCertificateOutlined />
          <span><strong>安全导入链路</strong> 下载时检查平台安全报告、Ed25519 数字签名、内容指纹和 ZIP 路径；导入后默认仅自己可见。</span>
        </div>

        <div className="skillhub-discovery__meta" aria-live="polite">
          <span>{loading ? "正在连接 SkillHub…" : `找到 ${formatNumber(total)} 个公开技能`}</span>
          <a href="https://www.skillhub.cn/skills" target="_blank" rel="noreferrer">打开 SkillHub 官网</a>
        </div>

        <Spin spinning={loading}>
          {error ? (
            <div className="skillhub-discovery__empty" role="alert">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={error}>
                <Button onClick={onSearch}>重新加载</Button>
              </Empty>
            </div>
          ) : results.length ? (
            <div className="skillhub-result-list">
              {results.map((skill) => {
                const installed = installedBySlug.get(skill.slug);
                const isLatest = installed?.source_version === skill.version;
                const marketCategoryLabel = SKILLHUB_CATEGORY_FILTER_OPTIONS.find((option) => option.value === skill.category)?.label;
                const sourceLabel = skill.source === "clawhub" ? "ClawHub" : "SkillHub";
                return (
                  <article className="skillhub-result-card" key={skill.slug}>
                    <div className="skillhub-result-card__icon" aria-hidden="true">
                      {skill.icon_url ? <img src={skill.icon_url} alt="" loading="lazy" /> : <ToolOutlined />}
                    </div>
                    <div className="skillhub-result-card__body">
                      <header>
                        <div><strong>{skill.name}</strong><code>{skill.slug}</code></div>
                        <span>v{skill.version || "latest"}</span>
                      </header>
                      <p>{skill.description || "该技能暂未提供说明"}</p>
                      <div className="skillhub-result-card__tags">
                        <Tag bordered={false}>{marketCategoryLabel || sourceLabel}</Tag>
                        <Tag bordered={false}>{sourceLabel}</Tag>
                        <Tag bordered={false} icon={<DownloadOutlined />}>{formatNumber(skill.downloads)}</Tag>
                        <Tag bordered={false} icon={<StarOutlined />}>{formatNumber(skill.stars)}</Tag>
                        {skill.requires_api_key && <Tag bordered={false} color="gold">需要 API Key</Tag>}
                        {skill.verified && <Tag bordered={false} color="blue" icon={<SafetyCertificateOutlined />}>认证作者</Tag>}
                        {installed && <Tag bordered={false} color="green">已纳管 {installed.source_version}</Tag>}
                      </div>
                    </div>
                    <div className="skillhub-result-card__actions">
                      <a href={skill.detail_url} target="_blank" rel="noreferrer">查看详情</a>
                      <Button
                        type={installed ? "default" : "primary"}
                        icon={<DownloadOutlined />}
                        loading={importingSlug === skill.slug}
                        disabled={Boolean(importingSlug) || isLatest}
                        onClick={() => onImport(skill)}
                      >
                        {isLatest ? "已是最新版" : installed ? "更新纳管" : "下载并纳管"}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="skillhub-discovery__empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的技能，试试用途词或英文关键词" />
            </div>
          )}
        </Spin>

        {total > 10 && (
          <Pagination
            className="skillhub-discovery__pagination"
            current={page}
            pageSize={10}
            total={total}
            showSizeChanger={false}
            onChange={onPageChange}
          />
        )}
      </section>
    </Drawer>
  );
}

function GovernanceMetric({ icon, tone, label, value, note }: { icon: ReactNode; tone: string; label: string; value: string; note: string }) {
  return <article className={`skill-governance-metric tone-${tone}`}><span className="skill-governance-metric__icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></article>;
}

function UsageTrend({ series, categoryLabel, dateRange, loading, onDateRangeChange }: {
  series: SkillTrendSeries;
  categoryLabel: string;
  dateRange: [Dayjs, Dayjs];
  loading: boolean;
  onDateRangeChange: (range: [Dayjs, Dayjs]) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 720;
  const plotLeft = 46;
  const plotRight = 702;
  const plotTop = 18;
  const plotBottom = 112;
  const maxCount = Math.max(1, ...series.points.map((point) => point.count));
  const yMax = maxCount <= 3 ? 3 : maxCount <= 6 ? 6 : maxCount <= 10 ? 10 : Math.ceil(maxCount / 10) * 10;
  const yTicks = [0, yMax / 3, yMax * 2 / 3, yMax];
  const chartPoints = series.points.map((point, index) => ({
    ...point,
    x: plotLeft + index * ((plotRight - plotLeft) / Math.max(1, series.points.length - 1)),
    y: plotBottom - (point.count / yMax) * (plotBottom - plotTop),
  }));
  const line = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const area = chartPoints.length ? `M ${chartPoints[0].x} ${plotBottom} L ${line.split(" ").join(" L ")} L ${chartPoints[chartPoints.length - 1].x} ${plotBottom} Z` : "";
  const activePoint = activeIndex === null ? null : chartPoints[activeIndex];
  const tooltipX = activePoint ? Math.min(width - 168, Math.max(plotLeft + 4, activePoint.x - 76)) : 0;
  const peakSummary = series.peak_count ? `${series.peak_label} · ${series.peak_count} 次` : "暂无调用";
  const rangeDays = dateRange[1].diff(dateRange[0], "day") + 1;
  const rangeLabel = `${dateRange[0].format("MM/DD")}–${dateRange[1].format("MM/DD")}`;
  const labelStep = Math.max(1, Math.ceil(series.points.length / 7));
  const denseSeries = series.points.length > 31;
  return (
    <section id="skill-usage-trend" className="skill-usage-trend" aria-labelledby="skill-trend-title">
      <header>
        <div>
          <span className="skill-governance-eyebrow">Usage signal · {categoryLabel}</span>
          <Typography.Title id="skill-trend-title" level={5}>调用趋势</Typography.Title>
          <Typography.Text type="secondary">已跟随左侧能力分类筛选 · {rangeLabel}，共 {rangeDays} 天</Typography.Text>
        </div>
        <div className="skill-trend-head-actions">
          <ConfigProvider theme={{ token: {
            colorPrimary: "#2f66d9",
            colorPrimaryHover: "#4b7de1",
            colorPrimaryActive: "#2758be",
            colorPrimaryBg: "#edf3ff",
          } }}>
            <DatePicker.RangePicker
              className="skill-trend-range"
              classNames={{ popup: { root: "skill-trend-picker-popup" } }}
              aria-label="调整调用趋势日期范围"
              allowClear={false}
              disabled={loading}
              format="MM-DD"
              size="small"
              value={dateRange}
              presets={[
                { label: "近 7 日", value: [dayjs().subtract(6, "day"), dayjs()] },
                { label: "近 30 日", value: [dayjs().subtract(29, "day"), dayjs()] },
                { label: "近 90 日", value: [dayjs().subtract(89, "day"), dayjs()] },
              ]}
              disabledDate={(current) => current.isAfter(dayjs(), "day") || current.isBefore(dayjs().subtract(89, "day"), "day")}
              onChange={(dates) => {
                if (dates?.[0] && dates[1]) onDateRangeChange([dates[0], dates[1]]);
              }}
            />
          </ConfigProvider>
          <Tag bordered={false} icon={categoryIcon(SKILL_CATEGORIES.find((item) => item.label === categoryLabel)?.key || "all")}>{categoryLabel}</Tag>
        </div>
      </header>
      <dl className="skill-trend-summary" aria-label={`${categoryLabel}${rangeLabel}使用摘要`}>
        <div><dt>区间调用</dt><dd>{formatNumber(series.total)}</dd><small>日均 {series.daily_average} 次</small></div>
        <div><dt>独立使用者</dt><dd>{formatNumber(series.unique_users)}</dd><small>去重用户数</small></div>
        <div><dt>活跃技能</dt><dd>{formatNumber(series.active_skills)}</dd><small>产生调用的技能</small></div>
        <div><dt>峰值日</dt><dd>{peakSummary}</dd><small>{series.peak_count ? "单日最高调用" : "当前分类暂无事件"}</small></div>
      </dl>
      <div className="skill-usage-chart">
        <div className="skill-usage-chart__legend"><span><i />调用次数</span><span>悬停或聚焦数据点查看当日明细</span></div>
        <svg viewBox={`0 0 ${width} 160`} role="img" aria-label={`${categoryLabel}${rangeLabel}调用趋势，共 ${series.total} 次，峰值 ${peakSummary}`}>
          <defs><linearGradient id="skillTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f66d9" stopOpacity="0.24" /><stop offset="100%" stopColor="#2f66d9" stopOpacity="0.015" /></linearGradient></defs>
          {yTicks.map((tick) => {
            const y = plotBottom - (tick / yMax) * (plotBottom - plotTop);
            return <g key={tick}><line x1={plotLeft} y1={y} x2={plotRight} y2={y} className="chart-grid" /><text x={plotLeft - 10} y={y + 3} textAnchor="end" className="chart-tick">{Number.isInteger(tick) ? tick : tick.toFixed(1)}</text></g>;
          })}
          <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} className="chart-axis" />
          {area && <path className="chart-area" d={area} fill="url(#skillTrendFill)" />}
          {line && <polyline points={line} className="chart-line" />}
          {activePoint && <line x1={activePoint.x} y1={plotTop} x2={activePoint.x} y2={plotBottom} className="chart-guide" />}
          {chartPoints.map((point, index) => (
            <g key={`${point.date}-labels`} className="chart-point-labels">
              {point.count > 0 && (!denseSeries || point.count === series.peak_count || activePoint?.date === point.date) && <text x={point.x} y={point.y - 9} textAnchor="middle" className="chart-value">{point.count}</text>}
              {(index === chartPoints.length - 1 || index % labelStep === 0) && <text x={point.x} y="142" textAnchor="middle" className="chart-label">{point.label}</text>}
            </g>
          ))}
          {chartPoints.map((point, index) => (
            <g
              key={point.date}
              className={`chart-point-group${activeIndex === index ? " is-active" : ""}`}
              tabIndex={0}
              role="button"
              aria-label={`${point.label}，调用 ${point.count} 次，${point.unique_users} 位使用者，${point.active_skills} 个活跃技能`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
            >
              <circle cx={point.x} cy={point.y} r={denseSeries ? 7 : 14} className="chart-point-hit" />
              <circle cx={point.x} cy={point.y} r={activeIndex === index ? 5 : denseSeries ? 2.2 : 3.5} className="chart-point" />
            </g>
          ))}
          {activePoint && (
            <g className="chart-tooltip" pointerEvents="none">
              <rect x={tooltipX} y="4" width="160" height="58" rx="9" />
              <text x={tooltipX + 12} y="22" className="chart-tooltip-title">{activePoint.label}</text>
              <text x={tooltipX + 12} y="40">调用 {activePoint.count} 次</text>
              <text x={tooltipX + 86} y="40">使用者 {activePoint.unique_users} 人</text>
              <text x={tooltipX + 12} y="54">活跃技能 {activePoint.active_skills} 个</text>
            </g>
          )}
        </svg>
      </div>
      <table className="skill-chart-sr-table">
        <caption>{categoryLabel}{rangeLabel}调用明细</caption>
        <thead><tr><th>日期</th><th>调用次数</th><th>独立使用者</th><th>活跃技能</th></tr></thead>
        <tbody>{series.points.map((point) => <tr key={point.date}><td>{point.date}</td><td>{point.count}</td><td>{point.unique_users}</td><td>{point.active_skills}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function RankingSwitcher({ mode, onModeChange, skillRows, peopleRows, selectedSkillId, onSelectSkill }: {
  mode: RankingMode;
  onModeChange: (mode: RankingMode) => void;
  skillRows: SkillAnalyticsRow[];
  peopleRows: SkillPeopleRankingItem[];
  selectedSkillId?: string;
  onSelectSkill: (skillId: string) => void;
}) {
  const skillMax = Math.max(1, ...skillRows.map((row) => row.usage_count_30d));
  const peopleMax = Math.max(1, ...peopleRows.map((row) => row.usage_count_30d));
  return (
    <section className="skill-insight-panel skill-ranking-switcher" aria-labelledby="usage-ranking-title">
      <header className="skill-ranking-switcher__head">
        <div><span className="skill-governance-eyebrow">Usage ranking</span><Typography.Title id="usage-ranking-title" level={5}>使用排行</Typography.Title></div>
        <div className="skill-ranking-switcher__tabs" role="tablist" aria-label="排行维度">
          <button type="button" role="tab" aria-selected={mode === "skills"} className={mode === "skills" ? "is-active" : ""} onClick={() => onModeChange("skills")}>技能</button>
          <button type="button" role="tab" aria-selected={mode === "people"} className={mode === "people" ? "is-active" : ""} onClick={() => onModeChange("people")}>人员</button>
        </div>
      </header>
      <div className="skill-ranking-switcher__period">近 30 日真实调用</div>
      <div className="skill-ranking-switcher__content" role="tabpanel">
        {mode === "skills" ? (
          <div className="skill-ranking-panel">
            {skillRows.length ? <ol>{skillRows.map((row, index) => <li key={row.asset_id} className={selectedSkillId === row.skill_id ? "is-active" : ""}><button type="button" onClick={() => onSelectSkill(row.skill_id)}><b>{index + 1}</b><div><strong>{row.name}</strong><span><i style={{ width: `${Math.max(4, row.usage_count_30d / skillMax * 100)}%` }} /></span></div><em>{formatNumber(row.usage_count_30d)}</em></button></li>)}</ol> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用数据" />}
          </div>
        ) : (
          <div className="skill-people-ranking-panel">
            {peopleRows.length ? (
              <ol>
                {peopleRows.map((row, index) => (
                  <li key={row.user_id} aria-label={`第 ${index + 1} 名，${row.user}，调用 ${row.usage_count_30d} 次`}>
                    <b>{index + 1}</b>
                    <Avatar size={30}>{initials(row.user)}</Avatar>
                    <div>
                      <span className="skill-people-ranking-name"><strong>{row.user}</strong><em>{row.skill_count_30d} 项技能</em></span>
                      <span className="skill-people-ranking-bar"><i style={{ width: `${Math.max(5, row.usage_count_30d / peopleMax * 100)}%` }} /></span>
                      <small>{row.team || `最近使用 ${formatDateTime(row.last_used_at)}`}</small>
                    </div>
                    <span className="skill-people-ranking-value"><strong>{formatNumber(row.usage_count_30d)}</strong><small>次</small></span>
                  </li>
                ))}
              </ol>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无人员使用数据" />}
          </div>
        )}
      </div>
    </section>
  );
}

function SkillResponsibilityPanel({ entry, canManage, owners, actionLoading, onOwnerChange, onCategoryChange, onToggle, onAdopt, onInvoke, onViewUsageHistory, onVisibilityChange, onDelete }: {
  entry: SkillEntry | null;
  canManage: boolean;
  owners: Array<{ id: number; name: string; username: string }>;
  actionLoading: boolean;
  onOwnerChange: (ownerId: number | null) => void;
  onCategoryChange: (category: SkillAssetCategory) => void;
  onToggle: (enabled: boolean) => void;
  onAdopt: () => void;
  onInvoke?: () => void;
  onViewUsageHistory: () => void;
  onVisibilityChange: (visibility: "shared" | "private") => void;
  onDelete: () => void;
}) {
  const [panelView, setPanelView] = useState<"overview" | "manage">("overview");
  if (!entry) return <section className="skill-insight-panel"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择技能查看详情" /></section>;
  const stats = entry.analytics;
  const categoryLabel = SKILL_CATEGORY_OPTIONS.find((item) => item.value === entry.category)?.label || "通用能力";
  return (
    <section className="skill-insight-panel skill-responsibility-panel">
      <header><div><span className="skill-governance-eyebrow">Accountability</span><Typography.Title level={5}>责任与使用详情</Typography.Title></div><Tag bordered={false}>{entry.asset?.visibility === "shared" ? "共享" : "仅自己"}</Tag></header>
      <div className="skill-responsibility-title"><span className={`skill-register-icon tone-${entry.category}`}>{categoryIcon(entry.category)}</span><div><strong>{entry.name}</strong><code>{entry.skillId}</code></div></div>
      <div className="skill-responsibility-meta" aria-label="技能责任摘要">
        <span>责任人 <strong>{stats?.owner || entry.asset?.owner || "待认领"}</strong></span>
        <span>分类 <strong>{categoryLabel}</strong></span>
      </div>
      <div className="skill-responsibility-tabs" role="tablist" aria-label="责任详情视图">
        <button type="button" role="tab" aria-selected={panelView === "overview"} className={panelView === "overview" ? "is-active" : ""} onClick={() => setPanelView("overview")}>使用概览</button>
        <button type="button" role="tab" aria-selected={panelView === "manage"} className={panelView === "manage" ? "is-active" : ""} onClick={() => setPanelView("manage")}>管理设置</button>
      </div>
      <div className="skill-responsibility-body">
        {panelView === "overview" ? (
          <>
            <div className="skill-responsibility-stats"><div><span>近 30 日调用</span><strong>{formatNumber(stats?.usage_count_30d || 0)}</strong></div><div><span>独立使用者</span><strong>{stats?.unique_users_30d || 0}</strong></div><div><span>采用人数</span><strong>{stats?.adoption_count || 0}</strong></div><div><span>启用人数</span><strong>{stats?.enabled_count || 0}</strong></div></div>
            <div className="skill-responsibility-progress"><div><span>共用启用率</span><b>{stats?.adoption_count ? Math.round((stats.enabled_count / stats.adoption_count) * 100) : 0}%</b></div><Progress percent={stats?.adoption_count ? Math.round((stats.enabled_count / stats.adoption_count) * 100) : 0} showInfo={false} strokeColor="#2f66d9" trailColor="rgba(47, 102, 217, 0.09)" /></div>
            <div className="skill-recent-usage">
              <div className="skill-insight-subhead"><span>最近使用</span>{entry.asset ? <button type="button" onClick={onViewUsageHistory}>查看全部记录</button> : <small>最近 2 次</small>}</div>
              {stats?.recent_usage?.length ? <ul>{stats.recent_usage.slice(0, 2).map((event) => <li key={event.id}><Avatar size={24}>{initials(event.user)}</Avatar><div><strong>{event.user}</strong><span>{event.source_label}</span></div><time dateTime={event.used_at}>{formatDateTime(event.used_at)}</time></li>)}</ul> : <div className="skill-recent-empty"><ClockCircleOutlined /> 暂无使用记录</div>}
            </div>
          </>
        ) : (
          <div className="skill-responsibility-settings">
            <div className="skill-responsibility-owner">
              <span>技能责任人</span>
              {canManage && entry.asset ? (
                <Select value={stats?.owner_id ?? undefined} allowClear placeholder="指派责任人" loading={actionLoading} onChange={(value) => onOwnerChange(value ?? null)} options={owners.map((owner) => ({ value: owner.id, label: owner.name }))} />
              ) : <div><Avatar size={30}>{initials(stats?.owner || entry.asset?.owner || "待")}</Avatar><span><strong>{stats?.owner || entry.asset?.owner || "待认领"}</strong><small>{stats?.owner_team || "未归属团队"}</small></span></div>}
            </div>
            <div className="skill-responsibility-category">
              <span>能力分类</span>
              {entry.asset && (entry.asset.is_uploader || canManage) ? (
                <Select aria-label="调整技能能力分类" value={entry.category} loading={actionLoading} onChange={onCategoryChange} options={SKILL_CATEGORY_OPTIONS} />
              ) : <Tag bordered={false} icon={categoryIcon(entry.category)}>{categoryLabel}</Tag>}
              <small>分类会同步影响左侧筛选与统计</small>
            </div>
            {entry.asset?.source === "skillhub" && (
              <div className="skill-responsibility-source">
                <span><GlobalOutlined /> SkillHub · v{entry.asset.source_version || "未知版本"}</span>
                <Tag bordered={false} color={entry.asset.source_verified ? "green" : "gold"} icon={<SafetyCertificateOutlined />}>{entry.asset.source_verified ? "签名与内容已验证" : "平台未提供签名"}</Tag>
                {entry.asset.source_url && <a href={entry.asset.source_url} target="_blank" rel="noreferrer">查看来源</a>}
              </div>
            )}
          </div>
        )}
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
