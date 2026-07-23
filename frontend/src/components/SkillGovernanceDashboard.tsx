import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Avatar,
  Button,
  ConfigProvider,
  DatePicker,
  Drawer,
  Dropdown,
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
import type { MenuProps, UploadFile, UploadProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import {
  AppstoreOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  ImportOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  LockOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ShareAltOutlined,
  ShopOutlined,
  StarOutlined,
  TeamOutlined,
  ToolOutlined,
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
  updateSkillAssetSop,
  publishSkillAsSop,
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
import { authenticatedAvatarUrl } from "../utils/avatar";
import SkillWorkspaceDrawer from "./SkillWorkspaceDrawer";

type Props = {
  onInvoke?: (skill: UserSkillItem) => void;
};

type SkillCategoryKey = "all" | SkillAssetCategory;
type GovernanceView = "all" | "used" | "idle" | "unowned";
type ScopeFilter = "all" | "mine" | "shared" | "uploaded" | "skillhub";
type StatusFilter = "all" | "enabled" | "disabled";
type SortKey = "recent" | "usage" | "reuse";
type RankingMode = "skills" | "people";
type WorkspaceTab = "manage" | "analytics";
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
const MAX_SKILL_PACKAGE_BYTES = 20 * 1024 * 1024;
const MAX_SKILL_FOLDER_FILES = 200;
const MAX_SKILL_BATCH_FOLDERS = 20;
const MAX_SKILL_BATCH_BYTES = 100 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

function validateSkillFolder(files: File[]): string | null {
  if (files.length > MAX_SKILL_FOLDER_FILES) return `技能文件夹最多包含 ${MAX_SKILL_FOLDER_FILES} 个文件`;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_SKILL_PACKAGE_BYTES) return `技能文件夹总大小不能超过 ${formatFileSize(MAX_SKILL_PACKAGE_BYTES)}`;
  return null;
}

type BatchSkillFolder = {
  root: string;
  name: string;
  files: File[];
  size: number;
};

function normalizeSkillPath(file: File): string {
  return (file.webkitRelativePath || file.name).replace(/\\/g, "/").replace(/^\/+/, "");
}

function groupSkillFolders(files: File[]): { folders: BatchSkillFolder[]; ignoredFiles: number } {
  const entries = files.map((file) => ({ file, path: normalizeSkillPath(file) }));
  const roots = Array.from(new Set(entries
    .filter(({ path }) => path.split("/").pop()?.toLowerCase() === "skill.md")
    .map(({ path }) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")))
    .sort((a, b) => b.length - a.length);
  const grouped = new Map<string, File[]>();

  entries.forEach(({ file, path }) => {
    const root = roots.find((candidate) => (
      candidate ? path === candidate || path.startsWith(`${candidate}/`) : !path.includes("/")
    ));
    if (!root && root !== "") return;
    grouped.set(root, [...(grouped.get(root) || []), file]);
  });

  const folders = roots
    .map((root) => {
      const folderFiles = grouped.get(root) || [];
      return {
        root,
        name: root.split("/").pop() || "Skill",
        files: folderFiles,
        size: folderFiles.reduce((sum, file) => sum + file.size, 0),
      };
    })
    .filter((folder) => folder.files.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  const groupedFileCount = folders.reduce((sum, folder) => sum + folder.files.length, 0);
  return { folders, ignoredFiles: Math.max(0, files.length - groupedFileCount) };
}

function validateSkillFolderBatch(folders: BatchSkillFolder[]): string | null {
  if (!folders.length) return "没有识别到包含 SKILL.md 的技能文件夹";
  if (folders.length > MAX_SKILL_BATCH_FOLDERS) return `一次最多上传 ${MAX_SKILL_BATCH_FOLDERS} 个技能文件夹`;
  const totalSize = folders.reduce((sum, folder) => sum + folder.size, 0);
  if (totalSize > MAX_SKILL_BATCH_BYTES) return `本批技能总大小不能超过 ${formatFileSize(MAX_SKILL_BATCH_BYTES)}`;
  for (const folder of folders) {
    const validationError = validateSkillFolder(folder.files);
    if (validationError) return `${folder.name}：${validationError}`;
  }
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

function rankingBarWidth(value: number, maxValue: number, minimumVisiblePercent: number): string {
  if (value <= 0) return "0%";
  return `${Math.max(minimumVisiblePercent, value / Math.max(1, maxValue) * 100)}%`;
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

function skillScopeLabel(entry: SkillEntry): { label: string; tone: string } {
  if (entry.asset?.source === "skillhub") return { label: "SkillHub", tone: "skillhub" };
  if (entry.asset?.visibility === "shared") return { label: "企业共享", tone: "shared" };
  if (entry.asset?.is_uploader) return { label: "我的上传", tone: "uploaded" };
  if (entry.personal) return { label: "个人", tone: "personal" };
  return { label: "可采用", tone: "available" };
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
  const [loading, setLoading] = useState(false);
  const [trendLoading, setTrendLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadActivity, setUploadActivity] = useState<UploadActivity | null>(null);
  const [batchUploadOpen, setBatchUploadOpen] = useState(false);
  const [batchUploadFiles, setBatchUploadFiles] = useState<UploadFile[]>([]);
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
  const [workspaceAsset, setWorkspaceAsset] = useState<SkillAssetItem | null>(null);
  const [actionSkillId, setActionSkillId] = useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("manage");
  const [governanceView, setGovernanceView] = useState<GovernanceView>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<SkillCategoryKey>("all");
  const [dashboardCategory, setDashboardCategory] = useState<SkillCategoryKey>("all");
  const [uploadCategory, setUploadCategory] = useState<SkillAssetCategory>("general");
  const [ownerId, setOwnerId] = useState<number | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("usage");
  const [rankingMode, setRankingMode] = useState<RankingMode>("skills");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [responsibilityPanelView, setResponsibilityPanelView] = useState<"overview" | "manage">("overview");
  const [trendRange, setTrendRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(6, "day"),
    dayjs(),
  ]);
  const trendRangeRef = useRef(trendRange);
  const batchFolderSelection = useMemo(() => groupSkillFolders(batchUploadFiles
    .map((file) => file.originFileObj)
    .filter((file): file is NonNullable<typeof file> => Boolean(file))), [batchUploadFiles]);
  const batchFolderValidation = useMemo(
    () => batchUploadFiles.length ? validateSkillFolderBatch(batchFolderSelection.folders) : null,
    [batchFolderSelection, batchUploadFiles.length],
  );

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

  const handleFolderUpload = async (files: File[]) => {
    if (!files.length) return;

    const paths = files.map((file) => file.webkitRelativePath || file.name);
    const validationError = validateSkillFolder(files);
    if (validationError) {
      message.error(validationError);
      return;
    }
    if (!paths.some((path) => path.split("/").pop()?.toLowerCase() === "skill.md")) {
      message.error("所选文件夹中没有 SKILL.md，请选择完整的技能目录");
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
      setUploadActivity(null);
      setUploading(false);
    }
  };

  const batchUploadPickerProps: UploadProps = {
    directory: true,
    multiple: true,
    disabled: uploading,
    fileList: batchUploadFiles,
    showUploadList: false,
    beforeUpload: () => false,
    onChange: ({ fileList }) => {
      setBatchUploadFiles(fileList);
    },
  };

  const folderUploadProps: UploadProps = {
    showUploadList: false,
    directory: true,
    multiple: true,
    disabled: uploading,
    beforeUpload: (file, fileList) => {
      if (file.uid === fileList[0]?.uid) void handleFolderUpload(Array.from(fileList));
      return Upload.LIST_IGNORE;
    },
  };

  const handleBatchUploadConfirm = async () => {
    const folders = batchFolderSelection.folders;
    if (!folders.length) {
      message.warning("请选择包含一个或多个 Skill 的根目录");
      return;
    }
    const validationError = validateSkillFolderBatch(folders);
    if (validationError) {
      message.error(validationError);
      return;
    }

    setUploading(true);
    let successCount = 0;
    const failures: Array<{ folder: BatchSkillFolder; message: string }> = [];
    try {
      for (let index = 0; index < folders.length; index += 1) {
        const folder = folders[index];
        setUploadActivity({ mode: "files", stage: "uploading", label: folder.name, current: index + 1, total: folders.length, percent: Math.round(index / folders.length * 100) });
        try {
          await uploadSkillAssetFolder(folder.files, true, uploadCategory, (event) => {
            const folderPercent = event.total ? Math.min(99, event.loaded / event.total * 100) : 0;
            setUploadActivity({
              mode: "files",
              stage: folderPercent >= 99 ? "processing" : "uploading",
              label: folder.name,
              current: index + 1,
              total: folders.length,
              percent: Math.round((index + folderPercent / 100) / folders.length * 100),
            });
          });
          successCount += 1;
        } catch (error: unknown) {
          failures.push({ folder, message: `${folder.name}：${getErrorMessage(error, "上传失败")}` });
        }
      }

      if (successCount > 0) await load();
      if (!failures.length) {
        message.success(`已成功上传 ${successCount} 个技能并加入我的技能`);
      } else if (successCount > 0) {
        message.warning(`成功 ${successCount} 个，失败 ${failures.length} 个：${failures.slice(0, 2).map((item) => item.message).join("；")}`);
      } else {
        message.error(failures.slice(0, 2).map((item) => item.message).join("；"));
      }
    } finally {
      setUploadActivity(null);
      setUploading(false);
    }

    if (!failures.length) {
      setBatchUploadFiles([]);
      setBatchUploadOpen(false);
    } else {
      const failedFiles = new Set(failures.flatMap(({ folder }) => folder.files));
      setBatchUploadFiles((current) => current.filter((file) => file.originFileObj && failedFiles.has(file.originFileObj)));
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

  const rowActionItems = (entry: SkillEntry): MenuProps["items"] => {
    const canEditAsset = Boolean(entry.asset && (entry.asset.can_edit || analytics?.can_manage));
    const items: MenuProps["items"] = [
      ...(entry.asset ? [{
        key: "open",
        icon: <FolderOpenOutlined />,
        label: canEditAsset ? "打开并编辑技能" : "打开技能详情",
      }] : []),
      {
        key: "manage",
        icon: <EditOutlined />,
        label: canEditAsset ? "编辑设置" : "管理设置",
      },
    ];

    if (entry.personal) {
      items.push({
        key: "toggle",
        icon: entry.personal.enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />,
        label: entry.personal.enabled ? "停用技能" : "启用技能",
      });
    } else {
      items.push({ key: "adopt", icon: <ImportOutlined />, label: "添加到我的技能" });
    }

    if (entry.asset?.is_uploader) {
      items.push({
        key: "visibility",
        icon: entry.asset.visibility === "shared" ? <LockOutlined /> : <ShareAltOutlined />,
        label: entry.asset.visibility === "shared" ? "取消共享" : "发布共享",
      });
    }

    if (entry.asset?.is_uploader || entry.personal) {
      items.push({ type: "divider" });
      items.push({
        key: "delete",
        danger: true,
        icon: <DeleteOutlined />,
        label: entry.asset?.is_uploader ? "删除技能资产" : "从我的技能移除",
      });
    }

    return items;
  };

  const handleRowAction = (entry: SkillEntry, key: string) => {
    if (key === "open" && entry.asset) {
      setWorkspaceAsset(entry.asset);
      return;
    }
    if (key === "manage") {
      setSelectedSkillId(entry.skillId);
      setResponsibilityPanelView("manage");
      return;
    }
    if (key === "toggle" && entry.personal) {
      const enabled = !entry.personal.enabled;
      void runAction(entry.skillId, () => toggleSkill(entry.skillId, enabled), enabled ? "技能已启用" : "技能已停用");
      return;
    }
    if (key === "adopt") {
      void runAction(entry.skillId, () => adoptSkillAsset(entry.skillId), "已添加到我的技能");
      return;
    }
    if (key === "visibility" && entry.asset?.is_uploader) {
      const visibility = entry.asset.visibility === "shared" ? "private" : "shared";
      const success = visibility === "shared" ? "已发布到共享仓库，团队成员可主动采用" : "已取消共享，并撤销其他成员的采用入口";
      void runAction(entry.skillId, () => updateSkillAssetVisibility(entry.asset!.id, visibility), success);
      return;
    }
    if (key !== "delete" || (!entry.asset?.is_uploader && !entry.personal)) return;

    const deletesAsset = Boolean(entry.asset?.is_uploader);
    Modal.confirm({
      title: deletesAsset ? `删除“${entry.name}”？` : `从我的技能中移除“${entry.name}”？`,
      content: deletesAsset ? "技能资产及所有成员的采用入口会一并移除，此操作无法撤销。" : "只会移除你的个人入口，不会影响共享技能资产。",
      okText: deletesAsset ? "确认删除" : "确认移除",
      okType: "danger",
      cancelText: "取消",
      centered: true,
      onOk: () => runAction(
        entry.skillId,
        () => deletesAsset ? deleteSkillAsset(entry.skillId) : deleteSkill(entry.skillId),
        deletesAsset ? "技能资产已删除" : "已从我的技能移除",
      ),
    });
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
      message.success(createDraft.adopt
        ? `技能已创建并加入“我的技能”：${result.asset.name}`
        : `技能已创建：${result.asset.name}`);
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
  const activeCategory = SKILL_CATEGORIES.find((item) => item.key === dashboardCategory) || SKILL_CATEGORIES[0];
  const trendSeries = useMemo<SkillTrendSeries>(() => {
    const scoped = analytics?.trend_by_category?.[dashboardCategory];
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
  }, [analytics?.trend, analytics?.trend_by_category, dashboardCategory]);

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

  const dashboardCategoryCounts = useMemo(() => {
    const result = new Map<SkillCategoryKey, number>([["all", libraryEntries.length]]);
    libraryEntries.forEach((entry) => result.set(entry.category, (result.get(entry.category) || 0) + 1));
    return result;
  }, [libraryEntries]);

  const hasManagementFilters = Boolean(query.trim())
    || scope !== "all"
    || category !== "all"
    || governanceView !== "all"
    || status !== "all"
    || ownerId !== "all"
    || sortKey !== "usage";

  const resetManagementFilters = () => {
    setQuery("");
    setScope("all");
    setCategory("all");
    setGovernanceView("all");
    setStatus("all");
    setOwnerId("all");
    setSortKey("usage");
    setPage(1);
  };

  return (
    <div className="skill-governance">
      <section className="skill-workspace-tabs" aria-label="技能工作区">
        <div className="skill-workspace-tabs__list" role="tablist" aria-label="技能页面视图">
          <button
            id="skill-workspace-tab-manage"
            type="button"
            role="tab"
            aria-selected={workspaceTab === "manage"}
            aria-controls="skill-workspace-panel-manage"
            tabIndex={workspaceTab === "manage" ? 0 : -1}
            className={workspaceTab === "manage" ? "is-active" : ""}
            onClick={() => setWorkspaceTab("manage")}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight") return;
              event.preventDefault();
              setWorkspaceTab("analytics");
              event.currentTarget.nextElementSibling instanceof HTMLButtonElement && event.currentTarget.nextElementSibling.focus();
            }}
          >
            <span className="skill-workspace-tabs__icon"><AppstoreOutlined /></span>
            <strong>技能管理</strong>
          </button>
          <button
            id="skill-workspace-tab-analytics"
            type="button"
            role="tab"
            aria-selected={workspaceTab === "analytics"}
            aria-controls="skill-workspace-panel-analytics"
            tabIndex={workspaceTab === "analytics" ? 0 : -1}
            className={workspaceTab === "analytics" ? "is-active" : ""}
            onClick={() => setWorkspaceTab("analytics")}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft") return;
              event.preventDefault();
              setWorkspaceTab("manage");
              event.currentTarget.previousElementSibling instanceof HTMLButtonElement && event.currentTarget.previousElementSibling.focus();
            }}
          >
            <span className="skill-workspace-tabs__icon"><BarChartOutlined /></span>
            <strong>数据看板</strong>
          </button>
        </div>
        <div className="skill-workspace-tabs__context" aria-live="polite">
          <strong>{workspaceTab === "manage" ? `${filteredEntries.length} 项技能` : `${activeCategory.label} · ${trendRange[0].format("MM/DD")}–${trendRange[1].format("MM/DD")}`}</strong>
        </div>
      </section>

      {workspaceTab === "manage" ? (
        <div id="skill-workspace-panel-manage" className="skill-workspace-panel" role="tabpanel" aria-labelledby="skill-workspace-tab-manage">
          <section className="skill-governance-toolbar" aria-label="技能筛选与操作">
            <div className="skill-governance-toolbar__primary">
              <div className="skill-governance-toolbar__scope" role="group" aria-label="技能仓库范围">
                {([
                  ["all", "全部"],
                  ["mine", "我的"],
                  ["shared", "共享"],
                  ["uploaded", "上传"],
                  ["skillhub", "SkillHub"],
                ] as Array<[ScopeFilter, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={scope === value}
                    className={scope === value ? "is-active" : ""}
                    onClick={() => { setScope(value); setPage(1); }}
                  >
                    <span>{label}</span>
                    <b>{repositoryCounts[value]}</b>
                  </button>
                ))}
              </div>
              <div className="skill-governance-toolbar__actions">
                <Button icon={<GlobalOutlined />} onClick={openSkillHub}>技能市场</Button>
                <label className="skill-upload-category">
                  <span>上传至</span>
                  <Select aria-label="上传技能的能力分类" value={uploadCategory} onChange={setUploadCategory} options={SKILL_CATEGORY_OPTIONS} />
                </label>
                <Tooltip title="选择包含多个 Skill 的根目录，或把多个技能文件夹拖入弹窗；最多 20 个 Skill，整批不超过 100MB">
                  <Button
                    icon={<CloudUploadOutlined />}
                    loading={uploading && uploadActivity?.mode === "files"}
                    disabled={uploading && uploadActivity?.mode !== "files"}
                    onClick={() => setBatchUploadOpen(true)}
                  >
                    批量上传
                  </Button>
                </Tooltip>
                <Tooltip title="选择包含 SKILL.md、scripts 等内容的完整技能目录；最多 200 个文件，目录总大小不超过 20MB">
                  <Upload {...folderUploadProps}>
                    <Button
                      icon={<FolderOpenOutlined />}
                      loading={uploading && uploadActivity?.mode === "folder"}
                      disabled={uploading && uploadActivity?.mode !== "folder"}
                    >
                      {uploadActivity?.mode === "folder"
                        ? (uploadActivity.stage === "processing" ? "处理中" : `${uploadActivity.percent}%`)
                        : "上传文件夹"}
                    </Button>
                  </Upload>
                </Tooltip>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建技能</Button>
                <Tooltip title="刷新数据"><Button aria-label="刷新技能数据" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} /></Tooltip>
              </div>
            </div>

            <div className="skill-governance-toolbar__secondary">
              <Input
                className="skill-governance-search"
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜索技能名称、Skill ID、责任人"
                aria-label="搜索技能"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="skill-register-filters">
                <Select aria-label="能力分类筛选" value={category} onChange={setCategory} options={SKILL_CATEGORIES.map((item) => ({ value: item.key, label: `${item.label} ${categoryCounts.get(item.key) || 0}` }))} />
                <Select aria-label="治理状态" value={governanceView} onChange={setGovernanceView} options={[
                  { value: "all", label: `全部治理状态 ${governanceCounts.all}` },
                  { value: "used", label: `近期活跃 ${governanceCounts.used}` },
                  { value: "idle", label: `待激活 ${governanceCounts.idle}` },
                  { value: "unowned", label: `待认领 ${governanceCounts.unowned}` },
                ]} />
                <Select aria-label="启用状态" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "enabled", label: "已启用" }, { value: "disabled", label: "未启用" }]} />
                {analytics?.can_manage && <Select aria-label="责任人筛选" value={ownerId} onChange={setOwnerId} options={[{ value: "all", label: "全部责任人" }, ...(analytics.owner_options || []).map((owner) => ({ value: owner.id, label: owner.name }))]} />}
                <Select aria-label="排序方式" value={sortKey} onChange={setSortKey} options={[{ value: "usage", label: "调用量优先" }, { value: "recent", label: "最近使用" }, { value: "reuse", label: "采用人数" }]} />
                {hasManagementFilters && <Button type="text" className="skill-register-reset" onClick={resetManagementFilters}>重置</Button>}
              </div>
            </div>

            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "create", icon: <PlusOutlined />, label: "创建技能" },
                  { key: "market", icon: <GlobalOutlined />, label: "从技能市场导入" },
                  { key: "refresh", icon: <ReloadOutlined />, label: "刷新数据" },
                ],
                onClick: ({ key }) => {
                  if (key === "create") setCreateOpen(true);
                  if (key === "market") openSkillHub();
                  if (key === "refresh") void load();
                },
              }}
            >
              <Button className="skill-governance-mobile-actions" type="primary" icon={<PlusOutlined />} loading={uploading}>新建 / 导入</Button>
            </Dropdown>
            <div className="skill-governance-mobile-upload-actions" aria-label="上传技能">
              <Tooltip title="选择包含多个 Skill 的根目录，或拖入多个技能文件夹；最多 20 个 Skill，整批不超过 100MB">
                <Button icon={<CloudUploadOutlined />} loading={uploading && uploadActivity?.mode === "files"} disabled={uploading && uploadActivity?.mode !== "files"} onClick={() => setBatchUploadOpen(true)}>批量上传</Button>
              </Tooltip>
              <Upload {...folderUploadProps}>
                <Tooltip title="最多 200 个文件，目录总大小不超过 20MB">
                  <Button icon={<FolderOpenOutlined />} loading={uploading && uploadActivity?.mode === "folder"} disabled={uploading && uploadActivity?.mode !== "folder"}>上传文件夹</Button>
                </Tooltip>
              </Upload>
            </div>
          </section>

          <div className="skill-governance-workspace skill-governance-workspace--manage">
            <section className="skill-governance-row skill-governance-row--management" aria-label="技能治理与责任台账">
          <section className="skill-register" aria-labelledby="skill-register-title">
            <header className="skill-register-head">
              <div>
                <Typography.Title id="skill-register-title" level={4}>技能列表</Typography.Title>
                <Typography.Text type="secondary">{scopeLabel} · 共 {filteredEntries.length} 项</Typography.Text>
              </div>
              <span className="skill-register-head__hint">选择一行，在右侧查看详情与管理设置</span>
            </header>

            <Spin spinning={loading}>
              {pagedEntries.length ? (
                <div className="skill-register-table-wrap">
                  <table className="skill-register-table">
                    <thead><tr><th>技能名称 / Skill ID</th><th>归属</th><th>责任人</th><th>能力分类</th><th>状态</th><th>近 30 日调用</th><th>最近使用</th><th>操作</th></tr></thead>
                    <tbody>
                      {pagedEntries.map((entry) => {
                        const stats = entry.analytics;
                        const enabled = Boolean(entry.personal?.enabled);
                        const scopeMeta = skillScopeLabel(entry);
                        return (
                          <tr
                            key={entry.skillId}
                            className={selectedEntry?.skillId === entry.skillId ? "is-selected" : ""}
                            tabIndex={0}
                            aria-selected={selectedEntry?.skillId === entry.skillId}
                            onClick={() => { setSelectedSkillId(entry.skillId); setResponsibilityPanelView("overview"); }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              setSelectedSkillId(entry.skillId);
                              setResponsibilityPanelView("overview");
                            }}
                          >
                            <td><div className="skill-register-identity"><span className={`skill-register-icon tone-${entry.category}`}>{categoryIcon(entry.category)}</span><div><strong>{entry.name}</strong><code>{entry.skillId}</code></div></div></td>
                            <td><Tag bordered={false} className={`skill-scope-tag tone-${scopeMeta.tone}`}>{scopeMeta.label}</Tag></td>
                            <td><div className="skill-owner-cell"><Avatar size={24} src={authenticatedAvatarUrl(stats?.owner_avatar_url)}>{initials(stats?.owner || "待")}</Avatar><div><strong>{stats?.owner || "待认领"}</strong><span>{stats?.owner_team || "未归属团队"}</span></div></div></td>
                            <td><span className="skill-category-cell">{categoryIcon(entry.category)}{SKILL_CATEGORY_OPTIONS.find((item) => item.value === entry.category)?.label || "通用能力"}</span></td>
                            <td><Tag bordered={false} className={`skill-register-status ${enabled ? "is-enabled" : entry.personal ? "is-paused" : "is-available"}`}>{enabled ? "启用" : entry.personal ? "停用" : "可采用"}</Tag></td>
                            <td><div className="skill-number-cell"><strong>{formatNumber(stats?.usage_count_30d || 0)}</strong><span>{stats?.unique_users_30d || 0} 位使用者</span></div></td>
                            <td><div className="skill-latest-cell"><strong>{formatDateTime(stats?.last_used_at)}</strong><span>{stats?.last_used_by || "暂无调用"}</span></div></td>
                            <td>
                              <Dropdown
                                trigger={["click"]}
                                placement="bottomRight"
                                overlayClassName="skill-row-action-menu"
                                menu={{
                                  items: rowActionItems(entry),
                                  onClick: ({ key, domEvent }) => {
                                    domEvent.stopPropagation();
                                    handleRowAction(entry, key);
                                  },
                                }}
                              >
                                <Button
                                  type="text"
                                  size="small"
                                  className="skill-row-actions"
                                  aria-label={`打开 ${entry.name} 的操作菜单`}
                                  aria-haspopup="menu"
                                  icon={<SettingOutlined />}
                                  loading={actionSkillId === entry.skillId}
                                  onClick={(event) => event.stopPropagation()}
                                  onKeyDown={(event) => event.stopPropagation()}
                                >
                                  操作
                                </Button>
                              </Dropdown>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="skill-register-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前条件下没有匹配的技能"><Button onClick={resetManagementFilters}>清除筛选</Button></Empty></div>
              )}
            </Spin>

            <footer className="skill-register-footer">
              <span>共 {filteredEntries.length} 项技能资产</span>
              <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filteredEntries.length} hideOnSinglePage onChange={setPage} showSizeChanger={false} />
            </footer>
          </section>

          <SkillResponsibilityPanel
            entry={selectedEntry}
            panelView={responsibilityPanelView}
            onPanelViewChange={setResponsibilityPanelView}
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
            onOpenWorkspace={selectedEntry?.asset ? () => setWorkspaceAsset(selectedEntry.asset!) : undefined}
            onVisibilityChange={(visibility) => {
              if (!selectedEntry?.asset) return;
              const success = visibility === "shared" ? "已发布到共享仓库，团队成员可主动采用" : "已取消共享，并撤销其他成员的采用入口";
              void runAction(selectedEntry.skillId, () => updateSkillAssetVisibility(selectedEntry.asset!.id, visibility), success);
            }}
            onSopCallableChange={(enabled) => {
              if (!selectedEntry?.asset) return;
              void runAction(
                selectedEntry.skillId,
                () => updateSkillAssetSop(selectedEntry.asset!.id, { sop_callable: enabled }),
                enabled ? "已允许在 SOP 中调用此技能" : "已取消 SOP 可用",
              );
            }}
            onPublishSop={() => {
              if (!selectedEntry?.asset) return;
              void runAction(
                selectedEntry.skillId,
                async () => {
                  const result = await publishSkillAsSop(selectedEntry.asset!.id);
                  if (!result.ok) throw new Error(result.error || "发布失败");
                  return result;
                },
                "已生成 SOP 草稿，可在流程中心继续编辑",
              );
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
        </div>
      ) : (
        <div id="skill-workspace-panel-analytics" className="skill-workspace-panel skill-workspace-panel--analytics" role="tabpanel" aria-labelledby="skill-workspace-tab-analytics">
          <section className="skill-governance-kpis" aria-label="技能治理核心指标">
            <GovernanceMetric icon={<AppstoreOutlined />} tone="blue" label="技能资产" value={formatNumber(summary?.total_skills ?? libraryEntries.length)} note={`${analytics?.scope_label || "当前范围"} · 已归档`} />
            <GovernanceMetric icon={<BarChartOutlined />} tone="green" label="累计调用" value={formatNumber(summary?.total_invocations || 0)} note={`近 30 日 ${formatNumber(summary?.invocations_30d || 0)} 次`} />
            <GovernanceMetric icon={<CheckCircleFilled />} tone="violet" label="技能使用率" value={`${summary?.utilization_rate || 0}%`} note={`近 30 日活跃 ${summary?.active_skills_30d || 0} 个`} />
            <GovernanceMetric icon={<TeamOutlined />} tone="amber" label="共享采用" value={formatNumber(summary?.shared_adoptions || 0)} note={`${summary?.shared_skills || 0} 个共享技能`} />
            <GovernanceMetric icon={<SafetyCertificateOutlined />} tone="cyan" label="责任覆盖" value={`${summary?.responsibility_coverage || 0}%`} note={`${summary?.owner_count || 0} 位责任人`} />
          </section>

          <section className="skill-dashboard-filterbar" aria-labelledby="skill-dashboard-filter-title">
            <div className="skill-dashboard-filterbar__label">
              <Typography.Title id="skill-dashboard-filter-title" level={4}>数据范围</Typography.Title>
              <Typography.Text type="secondary">分类会同步更新趋势与排行</Typography.Text>
            </div>
            <div className="skill-dashboard-category-tabs" role="group" aria-label="看板能力分类">
              {SKILL_CATEGORIES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={dashboardCategory === item.key}
                  aria-controls="skill-usage-trend"
                  className={dashboardCategory === item.key ? "is-active" : ""}
                  onClick={() => setDashboardCategory(item.key)}
                >
                  <span>{categoryIcon(item.key)}</span>
                  <strong>{item.label}</strong>
                  <b>{dashboardCategoryCounts.get(item.key) || 0}</b>
                </button>
              ))}
            </div>
          </section>

          <div className="skill-dashboard-grid">
            <UsageTrend
              series={trendSeries}
              categoryLabel={activeCategory.label}
              dateRange={trendRange}
              loading={loading || trendLoading}
              onDateRangeChange={handleTrendRangeChange}
            />
            <RankingSwitcher
              mode={rankingMode}
              onModeChange={setRankingMode}
              skillRows={analytics?.ranking || []}
              peopleRows={analytics?.people_ranking || []}
              selectedSkillId={selectedEntry?.skillId}
              onSelectSkill={(skillId) => {
                setScope("all");
                setCategory("all");
                setGovernanceView("all");
                setStatus("all");
                setOwnerId("all");
                setQuery("");
                setSelectedSkillId(skillId);
                setWorkspaceTab("manage");
              }}
            />
          </div>
        </div>
      )}

      <Modal
        title={(
          <span className="skill-batch-upload-title">
            批量上传技能
            <Tooltip title="最多 20 个 Skill；每个目录最多 200 个文件、20MB，整批不超过 100MB">
              <InfoCircleOutlined aria-label="查看上传限制" />
            </Tooltip>
          </span>
        )}
        open={batchUploadOpen}
        okText={batchFolderSelection.folders.length ? `上传 ${batchFolderSelection.folders.length} 个技能` : "开始上传"}
        cancelText="取消"
        confirmLoading={uploading}
        okButtonProps={{ disabled: !batchFolderSelection.folders.length || Boolean(batchFolderValidation) }}
        closable={!uploading}
        maskClosable={!uploading}
        getContainer={false}
        destroyOnHidden
        onCancel={() => {
          if (uploading) return;
          setBatchUploadOpen(false);
          setBatchUploadFiles([]);
        }}
        onOk={() => void handleBatchUploadConfirm()}
      >
        <div className="skill-batch-upload-modal">
          <div className="skill-batch-upload-meta">
            <label>
              <span>上传到</span>
              <Select aria-label="批量上传技能的能力分类" value={uploadCategory} onChange={setUploadCategory} options={SKILL_CATEGORY_OPTIONS} />
            </label>
            <span aria-live="polite">
              已识别 {batchFolderSelection.folders.length} 个技能
              {batchUploadFiles.length > 0 ? ` · ${batchUploadFiles.length} 个文件 · ${formatFileSize(batchUploadFiles.reduce((sum, file) => sum + (file.size || 0), 0))}` : ""}
            </span>
          </div>
          <Upload.Dragger {...batchUploadPickerProps} className="skill-batch-upload-dragger">
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">拖入一个或多个技能文件夹</p>
            <p className="ant-upload-hint">或点击选择共同的上级目录（如 .workbuddy/skills），自动识别其中每个 SKILL.md</p>
          </Upload.Dragger>
          {batchFolderValidation ? <Typography.Text type="danger" className="skill-batch-upload-error">{batchFolderValidation}</Typography.Text> : null}
          {batchFolderSelection.ignoredFiles > 0 ? (
            <Typography.Text type="secondary" className="skill-batch-upload-note">
              已忽略 {batchFolderSelection.ignoredFiles} 个不属于任何 Skill 目录的文件
            </Typography.Text>
          ) : null}
          {batchFolderSelection.folders.length > 0 ? (
            <div className="skill-batch-upload-folders" aria-label="已识别的技能文件夹">
              {batchFolderSelection.folders.map((folder) => (
                <div key={folder.root || folder.name} className="skill-batch-upload-folder">
                  <FolderOpenOutlined />
                  <span>
                    <strong>{folder.name}</strong>
                    <small>{folder.files.length} 个文件 · {formatFileSize(folder.size)}</small>
                  </span>
                  <Button
                    type="text"
                    size="small"
                    danger
                    disabled={uploading}
                    aria-label={`移除 ${folder.name}`}
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      const folderFiles = new Set(folder.files);
                      setBatchUploadFiles((current) => current.filter((file) => !file.originFileObj || !folderFiles.has(file.originFileObj)));
                    }}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        title="创建技能"
        open={createOpen}
        okText={createDraft.adopt ? "创建并加入我的技能" : "创建技能"}
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
                  <Avatar size={34} src={authenticatedAvatarUrl(event.avatar_url)}>{initials(event.user)}</Avatar>
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

      <SkillWorkspaceDrawer
        open={Boolean(workspaceAsset)}
        asset={workspaceAsset}
        onClose={() => setWorkspaceAsset(null)}
        onUpdated={() => void load()}
      />

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
                        {installed && <Tag bordered={false} color="green">已下载 {installed.source_version}</Tag>}
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
                        {isLatest ? "已是最新版" : installed ? "更新到最新版" : "下载并启用"}
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
          <Typography.Title id="skill-trend-title" level={5}>{categoryLabel}调用趋势</Typography.Title>
          <Typography.Text type="secondary">{rangeLabel} · 共 {rangeDays} 天</Typography.Text>
        </div>
        <div className="skill-trend-head-actions">
          <ConfigProvider theme={{ token: {
            colorPrimary: "#2563eb",
            colorPrimaryHover: "#1d4ed8",
            colorPrimaryActive: "#1e40af",
            colorPrimaryBg: "#eff6ff",
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
          <defs><linearGradient id="skillTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity="0.2" /><stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" /></linearGradient></defs>
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
        <div><Typography.Title id="usage-ranking-title" level={5}>使用排行</Typography.Title></div>
        <div className="skill-ranking-switcher__tabs" role="tablist" aria-label="排行维度">
          <button type="button" role="tab" aria-selected={mode === "skills"} className={mode === "skills" ? "is-active" : ""} onClick={() => onModeChange("skills")}>技能</button>
          <button type="button" role="tab" aria-selected={mode === "people"} className={mode === "people" ? "is-active" : ""} onClick={() => onModeChange("people")}>人员</button>
        </div>
      </header>
      <div className="skill-ranking-switcher__period">近 30 日真实调用</div>
      <div className="skill-ranking-switcher__content" role="tabpanel">
        {mode === "skills" ? (
          <div className="skill-ranking-panel">
            {skillRows.length ? <ol>{skillRows.map((row, index) => <li key={row.asset_id} className={selectedSkillId === row.skill_id ? "is-active" : ""}><button type="button" onClick={() => onSelectSkill(row.skill_id)}><b>{index + 1}</b><div><strong>{row.name}</strong><span><i style={{ width: rankingBarWidth(row.usage_count_30d, skillMax, 4) }} /></span></div><em>{formatNumber(row.usage_count_30d)}</em></button></li>)}</ol> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无调用数据" />}
          </div>
        ) : (
          <div className="skill-people-ranking-panel">
            {peopleRows.length ? (
              <ol>
                {peopleRows.map((row, index) => (
                  <li key={row.user_id} aria-label={`第 ${index + 1} 名，${row.user}，调用 ${row.usage_count_30d} 次`}>
                    <b>{index + 1}</b>
                    <Avatar size={30} src={authenticatedAvatarUrl(row.avatar_url)}>{initials(row.user)}</Avatar>
                    <div>
                      <span className="skill-people-ranking-name"><strong>{row.user}</strong><em>{row.skill_count_30d} 项技能</em></span>
                      <span className="skill-people-ranking-bar"><i style={{ width: rankingBarWidth(row.usage_count_30d, peopleMax, 5) }} /></span>
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

function SkillResponsibilityPanel({ entry, panelView, onPanelViewChange, canManage, owners, actionLoading, onOwnerChange, onCategoryChange, onToggle, onAdopt, onInvoke, onViewUsageHistory, onVisibilityChange, onSopCallableChange, onPublishSop, onDelete }: {
  entry: SkillEntry | null;
  panelView: "overview" | "manage";
  onPanelViewChange: (view: "overview" | "manage") => void;
  canManage: boolean;
  owners: Array<{ id: number; name: string; username: string }>;
  actionLoading: boolean;
  onOwnerChange: (ownerId: number | null) => void;
  onCategoryChange: (category: SkillAssetCategory) => void;
  onToggle: (enabled: boolean) => void;
  onAdopt: () => void;
  onInvoke?: () => void;
  onViewUsageHistory: () => void;
  onOpenWorkspace?: () => void;
  onVisibilityChange: (visibility: "shared" | "private") => void;
  onSopCallableChange: (enabled: boolean) => void;
  onPublishSop: () => void;
  onDelete: () => void;
}) {
  if (!entry) return <section className="skill-insight-panel"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择技能查看详情" /></section>;
  const stats = entry.analytics;
  const categoryLabel = SKILL_CATEGORY_OPTIONS.find((item) => item.value === entry.category)?.label || "通用能力";
  return (
    <section className="skill-insight-panel skill-responsibility-panel">
      <header><div><Typography.Title level={5}>技能详情</Typography.Title></div><Tag bordered={false}>{entry.asset?.visibility === "shared" ? "共享" : "仅自己"}</Tag></header>
      <div className="skill-responsibility-title"><span className={`skill-register-icon tone-${entry.category}`}>{categoryIcon(entry.category)}</span><div><strong>{entry.name}</strong><code>{entry.skillId}</code></div></div>
      <div className="skill-responsibility-meta" aria-label="技能责任摘要">
        <span>责任人 <strong>{stats?.owner || entry.asset?.owner || "待认领"}</strong></span>
        <span>分类 <strong>{categoryLabel}</strong></span>
      </div>
      <div className="skill-responsibility-tabs" role="tablist" aria-label="责任详情视图">
        <button type="button" role="tab" aria-selected={panelView === "overview"} className={panelView === "overview" ? "is-active" : ""} onClick={() => onPanelViewChange("overview")}>使用概览</button>
        <button type="button" role="tab" aria-selected={panelView === "manage"} className={panelView === "manage" ? "is-active" : ""} onClick={() => onPanelViewChange("manage")}>管理设置</button>
      </div>
      <div className="skill-responsibility-body">
        {panelView === "overview" ? (
          <>
            <div className="skill-responsibility-stats"><div><span>近 30 日调用</span><strong>{formatNumber(stats?.usage_count_30d || 0)}</strong></div><div><span>独立使用者</span><strong>{stats?.unique_users_30d || 0}</strong></div><div><span>采用人数</span><strong>{stats?.adoption_count || 0}</strong></div><div><span>启用人数</span><strong>{stats?.enabled_count || 0}</strong></div></div>
            <div className="skill-responsibility-progress"><div><span>共用启用率</span><b>{stats?.adoption_count ? Math.round((stats.enabled_count / stats.adoption_count) * 100) : 0}%</b></div><Progress percent={stats?.adoption_count ? Math.round((stats.enabled_count / stats.adoption_count) * 100) : 0} showInfo={false} strokeColor="#2f66d9" trailColor="rgba(47, 102, 217, 0.09)" /></div>
            <div className="skill-recent-usage">
              <div className="skill-insight-subhead"><span>最近使用</span>{entry.asset ? <button type="button" onClick={onViewUsageHistory}>查看全部记录</button> : <small>最近 2 次</small>}</div>
              {stats?.recent_usage?.length ? <ul>{stats.recent_usage.slice(0, 2).map((event) => <li key={event.id}><Avatar size={24} src={authenticatedAvatarUrl(event.avatar_url)}>{initials(event.user)}</Avatar><div><strong>{event.user}</strong><span>{event.source_label}</span></div><time dateTime={event.used_at}>{formatDateTime(event.used_at)}</time></li>)}</ul> : <div className="skill-recent-empty"><ClockCircleOutlined /> 暂无使用记录</div>}
            </div>
          </>
        ) : (
          <div className="skill-responsibility-settings">
            <div className="skill-responsibility-owner">
              <span>技能责任人</span>
              {canManage && entry.asset ? (
                <Select value={stats?.owner_id ?? undefined} allowClear placeholder="指派责任人" loading={actionLoading} onChange={(value) => onOwnerChange(value ?? null)} options={owners.map((owner) => ({ value: owner.id, label: owner.name }))} />
              ) : <div><Avatar size={30} src={authenticatedAvatarUrl(stats?.owner_avatar_url)}>{initials(stats?.owner || entry.asset?.owner || "待")}</Avatar><span><strong>{stats?.owner || entry.asset?.owner || "待认领"}</strong><small>{stats?.owner_team || "未归属团队"}</small></span></div>}
            </div>
            <div className="skill-responsibility-category">
              <span>能力分类</span>
              {entry.asset && (entry.asset.is_uploader || canManage) ? (
                <Select aria-label="调整技能能力分类" value={entry.category} loading={actionLoading} onChange={onCategoryChange} options={SKILL_CATEGORY_OPTIONS} />
              ) : <Tag bordered={false} icon={categoryIcon(entry.category)}>{categoryLabel}</Tag>}
              <small>分类会同步影响左侧筛选与统计</small>
            </div>
            {entry.asset && (entry.asset.is_uploader || canManage) && (
              <div className="skill-responsibility-category">
                <span>可用于 SOP</span>
                <span className="skill-enable-control">
                  <Switch
                    checked={Boolean(entry.asset.sop_callable)}
                    loading={actionLoading}
                    onChange={onSopCallableChange}
                  />
                  {entry.asset.sop_callable ? "已对流程开放" : "未对流程开放"}
                </span>
                <small>开启后，已启用该技能的成员可在 SOP「执行业务能力」里选择它。</small>
                {entry.asset.sop_callable && (
                  <Button size="small" loading={actionLoading} onClick={onPublishSop} style={{ marginTop: 8 }}>
                    发布为 SOP 模板
                  </Button>
                )}
              </div>
            )}
            {entry.asset?.sop_callable && !(entry.asset.is_uploader || canManage) && entry.personal?.enabled && (
              <div className="skill-responsibility-category">
                <span>可用于 SOP</span>
                <Tag bordered={false} color="green">已对流程开放</Tag>
                <Button size="small" loading={actionLoading} onClick={onPublishSop} style={{ marginTop: 8 }}>
                  发布为 SOP 模板
                </Button>
              </div>
            )}
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
        {onOpenWorkspace && <Button size="small" icon={<FolderOpenOutlined />} onClick={onOpenWorkspace}>打开技能</Button>}
        {entry.personal ? <span className="skill-enable-control"><Switch size="small" aria-label={entry.personal.enabled ? "停用技能" : "启用技能"} checked={entry.personal.enabled} loading={actionLoading} onChange={onToggle} />{entry.personal.enabled ? "已启用" : "已停用"}</span> : <Button size="small" type="primary" icon={<ImportOutlined />} loading={actionLoading} onClick={onAdopt}>添加到我的技能</Button>}
        {onInvoke && <Button size="small" onClick={onInvoke} disabled={!entry.personal?.enabled}>调用技能</Button>}
        {entry.asset?.is_uploader && entry.asset.visibility === "private" && <Button size="small" icon={<ShareAltOutlined />} loading={actionLoading} onClick={() => onVisibilityChange("shared")}>发布共享</Button>}
        {entry.asset?.is_uploader && entry.asset.visibility === "shared" && <Popconfirm title="取消共享后，其他成员已采用的入口会被撤销。确定继续？" onConfirm={() => onVisibilityChange("private")}><Button size="small" icon={<LockOutlined />} loading={actionLoading}>取消共享</Button></Popconfirm>}
        {(entry.asset?.is_uploader || entry.personal) && <Popconfirm title={entry.asset?.is_uploader ? "删除技能资产？所有成员的采用入口会一并移除。" : "从我的技能中移除？"} onConfirm={onDelete}><Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={entry.asset?.is_uploader ? "删除技能资产" : "移除我的技能"} /></Popconfirm>}
      </div>
    </section>
  );
}
