import { useEffect, useMemo, useState } from "react";
import type { UploadFile } from "antd";
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
  Timeline,
  Typography,
  Upload,
} from "antd";
import {
  ArrowLeftOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EyeOutlined,
  FileExcelOutlined,
  FileSearchOutlined,
  InboxOutlined,
  LeftOutlined,
  NodeIndexOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  RightOutlined,
  SettingOutlined,
  SortAscendingOutlined,
} from "@ant-design/icons";
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeFile,
  downloadKnowledgeFile,
  getKnowledgeFileChunks,
  getKnowledgeJob,
  listKnowledgeBases,
  listKnowledgeFiles,
  updateKnowledgeBase,
  uploadKnowledgeFile,
  type KnowledgeBaseItem,
  type KnowledgeChunkItem,
  type KnowledgeFileItem,
} from "../api/client";

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

type TemplateKind = "compiled" | "evidence" | "graph" | "hybrid" | "custom";
type Visibility = "private" | "team" | "company";
type Engine = "naive-rag" | "graph-rag" | "hybrid-rag";
type ReviewPolicy = "none" | "sample" | "required";

type KnowledgeTemplateFile = { id?: number; backend?: KnowledgeFileItem; name: string; kind: string; source: string; status: "ready" | "suggested" | "review" | "failed" | "processing"; chunks: number; charCount?: number; recallCount?: number; uploadedAt?: string; downloadUrl?: string; };

type CreateUploadProgress = {
  percent: number;
  title: string;
  detail: string;
  status?: "normal" | "active" | "success" | "exception";
};

const keywordStopwords = new Set([
  "and", "or", "the", "for", "with", "from", "this", "that", "http", "https", "www", "com", "cn",
  "产品", "商品", "编号", "备案", "系统", "中文名", "使用", "测试", "结果", "说明", "具有", "可以", "通过",
]);

function fallbackKeywords(text: string, limit = 10) {
  const tokens: string[] = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}|\d{4,}/g) ?? [];
  const counts = new Map<string, { count: number; index: number }>();
  tokens.forEach((token, index) => {
    const normalized = token.trim().toLowerCase();
    if (!normalized || keywordStopwords.has(normalized)) return;
    const old = counts.get(normalized);
    counts.set(normalized, { count: (old?.count ?? 0) + 1, index: old?.index ?? index });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1].count - a[1].count || a[1].index - b[1].index)
    .slice(0, limit)
    .map(([word]) => word);
}

function chunkKeywords(chunk: KnowledgeChunkItem, text: string) {
  const raw = chunk.metadata?.keywords;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean).slice(0, 12);
  return fallbackKeywords(text, 12);
}
function apiErrorMessage(error: unknown, fallback: string) {
  const responseData = (error as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
  return responseData?.message || responseData?.error || fallback;
}
type KnowledgeTemplate = {
  id: string;
  name: string;
  category: string;
  kind: TemplateKind;
  owner: string;
  headline: string;
  bestFor: string[];
  inputs: string[];
  files: string[];
  outputs: string[];
  strategy: Engine;
  reviewPolicy: ReviewPolicy;
  visibility: Visibility;
  evidenceCoverage: number;
  readiness: number;
  limitations: string[];
  sampleQuestion: string;
  canEdit?: boolean;
};

type KnowledgeSource = {
  id: string;
  name: string;
  type: string;
  owner: string;
  scope: Visibility;
  freshness: string;
  state: "ready" | "syncing" | "review";
  records: number;
};

const templates: KnowledgeTemplate[] = [
  {
    id: "customer-360",
    name: "客户 360 简报",
    category: "经营分析",
    kind: "hybrid",
    owner: "销售运营",
    headline: "围绕客户名生成会前简报、关系线索、续约风险和下一步动作。",
    bestFor: ["客户档案", "会议记录", "合同", "项目记录"],
    inputs: ["CRM 导出", "会议纪要", "客户关系表", "合同台账"],
    files: ["pdf", "docx", "xlsx", "csv", "txt"],
    outputs: ["客户简报", "风险信号", "机会信号", "行动建议"],
    strategy: "hybrid-rag",
    reviewPolicy: "required",
    visibility: "team",
    evidenceCoverage: 92,
    readiness: 88,
    limitations: ["客户判断依赖 CRM 与会议记录的新鲜度。", "低置信关系需要人工确认。"],
    sampleQuestion: "这个客户当前续约风险和机会是什么？",
  },
  {
    id: "policy-evidence",
    name: "制度政策证据问答",
    category: "制度合规",
    kind: "evidence",
    owner: "知识运营",
    headline: "让员工获得带原文依据的制度、流程、报销和审批答复。",
    bestFor: ["制度 PDF", "流程文档", "公告", "FAQ"],
    inputs: ["制度文档", "审批流程", "公告归档"],
    files: ["pdf", "docx", "xlsx"],
    outputs: ["制度答复", "原文引用", "审批提示"],
    strategy: "naive-rag",
    reviewPolicy: "required",
    visibility: "company",
    evidenceCoverage: 100,
    readiness: 95,
    limitations: ["必须保留引用来源。", "不能替代 HR、法务、财务的最终解释。"],
    sampleQuestion: "一线城市住宿报销标准是多少，需要什么审批？",
  },
  {
    id: "domain-relationship",
    name: "垂域关系知识库",
    category: "图谱分析",
    kind: "graph",
    owner: "风控",
    headline: "为医疗、金融、制造、供应链等资料建立对象、关系和证据链。",
    bestFor: ["领域 PDF", "项目资料", "标准文档", "关系表"],
    inputs: ["领域资料", "对象清单", "关系证据"],
    files: ["pdf", "docx", "xlsx", "csv", "txt"],
    outputs: ["实体关系", "关系线索", "分析报告"],
    strategy: "graph-rag",
    reviewPolicy: "sample",
    visibility: "team",
    evidenceCoverage: 86,
    readiness: 82,
    limitations: ["实体类型需要按领域配置。", "关系抽取应保留证据片段。"],
    sampleQuestion: "这个领域里哪些关系最影响采购决策？",
  },
  {
    id: "support-agent",
    name: "智能客服知识代理",
    category: "客户成功",
    kind: "hybrid",
    owner: "客户成功",
    headline: "把帮助中心和售后流程封装成可嵌入业务系统的客服知识代理。",
    bestFor: ["帮助文档", "售后流程", "FAQ", "工单记录"],
    inputs: ["帮助中心", "客服工单", "售后 SOP"],
    files: ["pdf", "docx", "txt", "html", "csv"],
    outputs: ["客服问答", "转人工建议", "知识缺口"],
    strategy: "hybrid-rag",
    reviewPolicy: "sample",
    visibility: "team",
    evidenceCoverage: 78,
    readiness: 80,
    limitations: ["上线前需要验证拒答和转人工策略。"],
    sampleQuestion: "客户说订单延迟三天，应该怎么回复？",
  },
  {
    id: "data-analyst",
    name: "经营指标分析助手",
    category: "经营分析",
    kind: "hybrid",
    owner: "数据运营",
    headline: "把表格、BI 导出和业务口径说明整理成可追问的指标分析入口。",
    bestFor: ["指标表格", "业务口径", "历史复盘"],
    inputs: ["BI 导出", "指标口径", "月度复盘"],
    files: ["csv", "xlsx", "json", "md", "pdf"],
    outputs: ["指标分析", "异常解释", "行动建议"],
    strategy: "hybrid-rag",
    reviewPolicy: "required",
    visibility: "team",
    evidenceCoverage: 74,
    readiness: 76,
    limitations: ["指标口径需要发布前确认。", "不能跨部门混用未对齐口径。"],
    sampleQuestion: "过去三个季度收入波动最大的原因是什么？",
  },
  {
    id: "blank",
    name: "自定义空白知识应用",
    category: "自建",
    kind: "custom",
    owner: "当前用户",
    headline: "从业务目标、资料范围和输出形态开始配置，让后台选择处理链路。",
    bestFor: ["未归类资料", "试点场景", "跨部门知识包"],
    inputs: ["资料包", "业务目标", "期望产物"],
    files: ["pdf", "docx", "md", "txt", "csv", "xlsx", "json"],
    outputs: ["问答入口", "知识页", "分析报告"],
    strategy: "hybrid-rag",
    reviewPolicy: "sample",
    visibility: "private",
    evidenceCoverage: 40,
    readiness: 55,
    limitations: ["需要管理员复核后才能公司级发布。"],
    sampleQuestion: "这批资料应该整理成什么知识应用？",
  },
];

const templateFileDetails: Record<string, KnowledgeTemplateFile[]> = {
  "customer-360": [
    { name: "CRM客户档案_近90天.xlsx", kind: "结构化表", source: "CRM 客户与商机导出", status: "ready", chunks: 128 },
    { name: "重点客户会议纪要.docx", kind: "会议资料", source: "会议纪要与转写稿", status: "review", chunks: 42 },
    { name: "年度合同与续约台账.csv", kind: "合同台账", source: "业务资料包", status: "suggested", chunks: 76 },
    { name: "客户关系图谱.json", kind: "关系图谱", source: "业务图谱 company_knowledge", status: "ready", chunks: 210 },
  ],
  "policy-evidence": [
    { name: "2026差旅报销制度.pdf", kind: "制度 PDF", source: "制度与 SOP 文档库", status: "ready", chunks: 64 },
    { name: "费用审批流程.xlsx", kind: "流程表", source: "制度与 SOP 文档库", status: "ready", chunks: 28 },
    { name: "财务口径FAQ.docx", kind: "FAQ", source: "知识运营", status: "suggested", chunks: 35 },
  ],
  "domain-relationship": [
    { name: "垂域对象类型定义.md", kind: "本体配置", source: "数据平台", status: "ready", chunks: 18 },
    { name: "项目资料与标准文档.pdf", kind: "领域资料", source: "业务资料包", status: "suggested", chunks: 96 },
    { name: "对象关系证据表.csv", kind: "关系证据", source: "业务图谱 company_knowledge", status: "ready", chunks: 150 },
  ],
  "support-agent": [
    { name: "售后处理SOP.md", kind: "SOP", source: "制度与 SOP 文档库", status: "ready", chunks: 44 },
    { name: "帮助中心订单问题.html", kind: "帮助中心", source: "客服知识库", status: "ready", chunks: 82 },
    { name: "近30天客服工单.csv", kind: "工单记录", source: "业务资料包", status: "review", chunks: 132 },
  ],
  "data-analyst": [
    { name: "经营指标口径说明.md", kind: "指标口径", source: "数据运营", status: "ready", chunks: 26 },
    { name: "季度销售指标导出.xlsx", kind: "指标表格", source: "BI 导出", status: "ready", chunks: 88 },
    { name: "月度经营复盘.pdf", kind: "历史复盘", source: "业务资料包", status: "suggested", chunks: 57 },
  ],
  blank: [
    { name: "待上传资料包", kind: "自定义文件", source: "用户上传", status: "suggested", chunks: 0 },
    { name: "业务目标说明", kind: "配置说明", source: "当前页面", status: "suggested", chunks: 0 },
  ],
};
const sources: KnowledgeSource[] = [
  { id: "policy", name: "制度与 SOP 文档库", type: "文档证据", owner: "知识运营", scope: "company", freshness: "今天 09:20", state: "ready", records: 1260 },
  { id: "graph", name: "业务图谱 company_knowledge", type: "关系图谱", owner: "数据平台", scope: "team", freshness: "今天 10:12", state: "ready", records: 8421 },
  { id: "crm", name: "CRM 客户与商机导出", type: "结构化表", owner: "销售运营", scope: "team", freshness: "昨天 21:30", state: "syncing", records: 3480 },
  { id: "meeting", name: "会议纪要与转写稿", type: "过程资料", owner: "业务团队", scope: "private", freshness: "3 天前", state: "review", records: 214 },
];

const visibilityLabels: Record<Visibility, string> = {
  private: "个人",
  team: "团队",
  company: "公司",
};

const visibilityDescriptions: Record<Visibility, string> = {
  private: "仅自己可见",
  team: "所有成员可见",
  company: "公司范围可见",
};

const visibilityColors: Record<Visibility, string> = {
  private: "blue",
  team: "green",
  company: "purple",
};

const engineLabels: Record<Engine, string> = {
  "naive-rag": "证据优先 RAG",
  "graph-rag": "关系图谱 RAG",
  "hybrid-rag": "混合检索",
};

const reviewLabels: Record<ReviewPolicy, string> = {
  none: "无需复核",
  sample: "抽样复核",
  required: "必须复核",
};

function kindColor(kind: TemplateKind) {
  return kind === "graph" ? "blue" : kind === "hybrid" ? "gold" : kind === "evidence" ? "green" : kind === "compiled" ? "purple" : "default";
}

function normalizeTemplateKind(value?: string): TemplateKind {
  if (value === "graph" || value === "compiled" || value === "evidence" || value === "custom") return value;
  return "hybrid";
}

function normalizeEngine(value?: string): Engine {
  if (value === "naive-rag" || value === "graph-rag" || value === "hybrid-rag") return value;
  return "hybrid-rag";
}

function normalizeReviewPolicy(value?: string): ReviewPolicy {
  if (value === "none" || value === "required") return value;
  return "sample";
}

function mapKnowledgeBase(base: KnowledgeBaseItem): KnowledgeTemplate {
  const config = base.config || {};
  return {
    id: String(base.id),
    name: base.name,
    category: base.category || "Custom",
    kind: normalizeTemplateKind(String(config.kind || base.retrieval_mode || "hybrid")),
    owner: base.owner_username || "Current user",
    headline: base.description || "Knowledge base with parsing, chunking, embedding and semantic search.",
    bestFor: Array.isArray(base.tags) && base.tags.length ? base.tags : [base.category || "Knowledge"],
    inputs: ["Document", "Table", "JSON", "HTML"],
    files: ["docx", "md", "txt", "csv", "xlsx", "json", "html"],
    outputs: ["QA", "Evidence", "Semantic search"],
    strategy: normalizeEngine(base.retrieval_mode),
    reviewPolicy: normalizeReviewPolicy(base.review_policy),
    visibility: base.visibility,
    evidenceCoverage: base.status === "ready" ? 90 : 40,
    readiness: base.status === "ready" ? 90 : base.status === "processing" ? 65 : 45,
    limitations: ["PDF/PPT parser is not connected yet", "Semantic search requires local embedding service"],
    sampleQuestion: `Search key facts in ${base.name}`,
    canEdit: base.can_edit ?? true,
  };
}

function fileStatusToUi(status: KnowledgeFileItem["status"]): KnowledgeTemplateFile["status"] {
  if (status === "ready") return "ready";
  if (status === "failed") return "failed";
  if (status === "processing" || status === "uploaded") return "processing";
  if (status === "review") return "review";
  return "suggested";
}

function mapKnowledgeFile(file: KnowledgeFileItem): KnowledgeTemplateFile {
  const embedding = file.metadata?.embedding as { status?: string } | undefined;
  const source = file.status === "processing"
    ? "\u540e\u53f0\u5165\u5e93\u5904\u7406\u4e2d"
    : embedding?.status && embedding.status !== "ready"
      ? "\u5411\u91cf\u5f85\u8865\u9f50"
      : file.content_hash
        ? `hash ${file.content_hash.slice(0, 10)}`
        : file.storage_path || "backend";
  return {
    id: file.id,
    backend: file,
    name: file.original_filename,
    kind: file.file_type || "file",
    source,
    status: fileStatusToUi(file.status),
    chunks: file.chunk_count,
    charCount: file.char_count,
    recallCount: file.recall_count,
    uploadedAt: file.uploaded_at,
  };
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function displayStatus(status: KnowledgeTemplateFile["status"]) {
  if (status === "ready") return "可用";
  if (status === "review") return "待复核";
  if (status === "processing") return "处理中";
  if (status === "failed") return "失败";
  return "待接入";
}

export default function Knowledge() {
  const { message, modal } = AntApp.useApp();
  const [editForm] = Form.useForm<{ name: string; description: string; visibility: Visibility }>();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [scopeFilter, setScopeFilter] = useState<Visibility | "all">("all");
  const [templateId, setTemplateId] = useState("customer-360");
  const [visibility, setVisibility] = useState<Visibility>("team");
  const [engine, setEngine] = useState<Engine>("hybrid-rag");
  const [reviewPolicy, setReviewPolicy] = useState<ReviewPolicy>("required");
  const [requireCitation, setRequireCitation] = useState(true);
  const [extractGraph, setExtractGraph] = useState(true);
  const [chunkSize] = useState(900);
  const [topK] = useState(8);
  const [selectedSources] = useState<string[]>(["policy", "graph", "crm"]);
  const [projectName] = useState("UNOVE 经营知识中台");
  const [objective, setObjective] = useState("把制度、业务图谱、经营指标和会议资料配置成可追问、可审计、可复用的企业知识应用。");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [createSource, setCreateSource] = useState<"file" | "wecom" | "web">("file");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [detailTemplateId, setDetailTemplateId] = useState<string | null>(null);
  const [detailSearch, setDetailSearch] = useState("");
  const [detailTypeFilter, setDetailTypeFilter] = useState("全部");
  const [detailPageSize, setDetailPageSize] = useState(10);
  const [processedFile, setProcessedFile] = useState<KnowledgeTemplateFile | null>(null);
  const [chunkPageFile, setChunkPageFile] = useState<KnowledgeTemplateFile | null>(null);
  const [deletedTemplateFiles, setDeletedTemplateFiles] = useState<Record<string, string[]>>({});
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [uploadPurpose, setUploadPurpose] = useState("作为当前知识应用的补充资料，进入解析、切块、向量化和权限标注流程。");
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [baseLoading, setBaseLoading] = useState(false);
  const [detailFilesByBase, setDetailFilesByBase] = useState<Record<string, KnowledgeTemplateFile[]>>({});
  const [fileLoading, setFileLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [createUploadProgress, setCreateUploadProgress] = useState<CreateUploadProgress | null>(null);
  const [processedChunks, setProcessedChunks] = useState<KnowledgeChunkItem[]>([]);
  const [chunkCurrentPage, setChunkCurrentPage] = useState(1);
  const [chunkPageSize, setChunkPageSize] = useState(10);
  const [chunkTotalCount, setChunkTotalCount] = useState(0);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [editingKnowledgeBase, setEditingKnowledgeBase] = useState<KnowledgeTemplate | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const chunkTotalPages = Math.max(1, Math.ceil((chunkTotalCount || 0) / chunkPageSize));
  const chunkPageNumbers = useMemo(() => {
    const total = Math.max(1, Math.ceil((chunkTotalCount || 0) / chunkPageSize));
    const start = Math.max(1, Math.min(chunkCurrentPage - 1, total - 2));
    return Array.from({ length: Math.min(3, total) }, (_, index) => start + index).filter((page) => page <= total);
  }, [chunkCurrentPage, chunkPageSize, chunkTotalCount]);

  function changeChunkPage(page: number, pageSize = chunkPageSize) {
    const nextPage = Math.min(Math.max(page, 1), Math.max(1, Math.ceil((chunkTotalCount || 0) / pageSize)));
    setChunkCurrentPage(nextPage);
    setChunkPageSize(pageSize);
    if (chunkPageFile) void loadFileChunks(chunkPageFile, nextPage, pageSize);
  }

  function changeChunkPageSize(pageSize: number) {
    setChunkPageSize(pageSize);
    setChunkCurrentPage(1);
    if (chunkPageFile) void loadFileChunks(chunkPageFile, 1, pageSize);
  }
  const baseTemplates = useMemo(() => knowledgeBases.length ? knowledgeBases.map(mapKnowledgeBase) : templates, [knowledgeBases]);
  const categories = useMemo(() => ["全部", ...Array.from(new Set(baseTemplates.map((item) => item.category)))], [baseTemplates]);
  const visibleTemplates = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return baseTemplates.filter((item) => {
      const categoryOk = category === "全部" || item.category === category;
      const queryOk = !keyword || `${item.name} ${item.headline} ${item.bestFor.join(" ")} ${item.outputs.join(" ")}`.toLowerCase().includes(keyword);
      const scopeOk = scopeFilter === "all" || item.visibility === scopeFilter;
      return categoryOk && queryOk && scopeOk;
    });
  }, [baseTemplates, category, query, scopeFilter]);
  const selectedTemplate = baseTemplates.find((item) => item.id === templateId) ?? baseTemplates[0] ?? templates[0];
  const detailTemplate = baseTemplates.find((item) => item.id === detailTemplateId) ?? null;
  const deletedNames = detailTemplate ? deletedTemplateFiles[detailTemplate.id] ?? [] : [];
  const backendDetailFiles = detailTemplate ? detailFilesByBase[detailTemplate.id] : undefined;
  const detailFiles: KnowledgeTemplateFile[] = detailTemplate
    ? (backendDetailFiles ?? (templateFileDetails[detailTemplate.id] ?? [])).filter((file) => !deletedNames.includes(file.name))
    : [];
  const detailTypeOptions = useMemo(() => ["全部", ...Array.from(new Set(detailFiles.map((file) => file.kind)))], [detailFiles]);
  const filteredDetailFiles = useMemo(() => {
    const keyword = detailSearch.trim().toLowerCase();
    return detailFiles.filter((file) => {
      const typeOk = detailTypeFilter === "全部" || file.kind === detailTypeFilter;
      const keywordOk = !keyword || `${file.name} ${file.kind} ${file.source}`.toLowerCase().includes(keyword);
      return typeOk && keywordOk;
    });
  }, [detailFiles, detailSearch, detailTypeFilter]);
  const detailTotalChars = filteredDetailFiles.reduce((sum, file) => sum + (file.charCount ?? Math.max(file.chunks, 1) * 58), 0);
  const detailReadyCount = filteredDetailFiles.filter((file) => file.status === "ready").length;
  const selectedSourceObjects = sources.filter((item) => selectedSources.includes(item.id));

  async function refreshKnowledgeBases() {
    setBaseLoading(true);
    try {
      const rows = await listKnowledgeBases();
      setKnowledgeBases(rows);
      if (rows.length && !rows.some((item) => String(item.id) === templateId)) {
        setTemplateId(String(rows[0].id));
      }
    } catch (error) {
      console.error(error);
      message.error("Failed to load knowledge bases");
    } finally {
      setBaseLoading(false);
    }
  }

  async function refreshKnowledgeFiles(baseId: string) {
    const numericId = Number(baseId);
    if (!Number.isFinite(numericId)) return;
    setFileLoading(true);
    try {
      const data = await listKnowledgeFiles(numericId, {
        q: detailSearch || undefined,
        file_type: detailTypeFilter !== "全部" ? detailTypeFilter : undefined,
      });
      setDetailFilesByBase((prev) => ({ ...prev, [baseId]: data.results.map(mapKnowledgeFile) }));
    } catch (error) {
      console.error(error);
      message.error("Failed to load knowledge files");
    } finally {
      setFileLoading(false);
    }
  }

  async function pollIngestJobs(baseId: string, jobIds: number[]) {
    const pending = new Set(jobIds.filter((id) => Number.isFinite(id)));
    if (!pending.size) return;
    for (let attempt = 0; attempt < 80 && pending.size; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 600 : 1500));
      const jobs = await Promise.allSettled(Array.from(pending).map((id) => getKnowledgeJob(id)));
      jobs.forEach((result) => {
        if (result.status !== "fulfilled") return;
        const job = result.value;
        if (job.status === "ready") {
          pending.delete(job.id);
        } else if (job.status === "failed") {
          pending.delete(job.id);
          const detail = typeof job.error?.message === "string" ? job.error.message : "\u6587\u4ef6\u5165\u5e93\u5931\u8d25";
          message.error(detail);
        }
      });
      await refreshKnowledgeFiles(baseId);
    }
    if (pending.size) {
      message.info("\u6587\u4ef6\u4ecd\u5728\u540e\u53f0\u5904\u7406\u4e2d\uff0c\u53ef\u4ee5\u7a0d\u540e\u5237\u65b0\u67e5\u770b");
    } else {
      await refreshKnowledgeBases();
      message.success("\u540e\u53f0\u5165\u5e93\u5b8c\u6210");
    }
  }

  function handleCreateKnowledgeBase() {
    setUploadFiles([]);
    setCreateUploadProgress(null);
    setCreateSource("file");
    setCreateName("");
    setCreateDescription("");
    setVisibility("team");
    setCreateMode(true);
  }

  function validateCreateKnowledgeBaseMeta() {
    if (!createName.trim()) {
      message.warning("请输入知识库名称");
      return false;
    }
    return true;
  }

  async function createKnowledgeBaseRecord() {
    return createKnowledgeBase({
      name: createName.trim(),
      description: createDescription.trim(),
      category: "Custom",
      visibility,
      retrieval_mode: engine,
      review_policy: reviewPolicy,
      status: "draft",
      config: { kind: "custom", chunk_size: chunkSize, top_k: topK, source: createSource },
    });
  }

  async function handleCreateEmptyKnowledgeBase() {
    if (!validateCreateKnowledgeBaseMeta()) return;
    setBaseLoading(true);
    try {
      const created = await createKnowledgeBaseRecord();
      await refreshKnowledgeBases();
      setTemplateId(String(created.id));
      setDetailTemplateId(String(created.id));
      setCreateMode(false);
      message.success("Knowledge base created");
    } catch (error) {
      console.error(error);
      message.error("Failed to create knowledge base");
    } finally {
      setBaseLoading(false);
    }
  }

  async function handleCreateWizardNext() {
    const rawFiles = uploadFiles.map((item) => item.originFileObj).filter(Boolean) as File[];
    if (!validateCreateKnowledgeBaseMeta()) return;
    if (createSource !== "file") {
      message.info("This source type is not connected yet");
      return;
    }
    if (!rawFiles.length) {
      message.warning("Choose files first");
      return;
    }
    setUploading(true);
    setCreateUploadProgress({ percent: 3, title: "创建知识库", detail: "正在生成知识库记录...", status: "active" });
    const totalBytes = rawFiles.reduce((sum, file) => sum + Math.max(file.size || 0, 1), 0);
    const uploadedBytesByIndex = new Map<number, number>();
    const updateFileProgress = (fileIndex: number, loaded: number, total: number) => {
      uploadedBytesByIndex.set(fileIndex, Math.min(loaded, total));
      const uploadedBytes = Array.from(uploadedBytesByIndex.values()).reduce((sum, value) => sum + value, 0);
      const uploadPercent = totalBytes ? uploadedBytes / totalBytes : (fileIndex + 1) / rawFiles.length;
      const percent = Math.max(12, Math.min(88, Math.round(10 + uploadPercent * 78)));
      setCreateUploadProgress({
        percent,
        title: "上传文件",
        detail: `正在上传 ${fileIndex + 1}/${rawFiles.length}：${rawFiles[fileIndex].name}`,
        status: "active",
      });
    };
    try {
      const created = await createKnowledgeBaseRecord();
      setCreateUploadProgress({ percent: 10, title: "上传文件", detail: "知识库已创建，开始上传文件...", status: "active" });
      const jobIds: number[] = [];
      for (const [index, file] of rawFiles.entries()) {
        updateFileProgress(index, 0, Math.max(file.size || 0, 1));
        const result = await uploadKnowledgeFile(created.id, file, {
          segment_mode: "general",
          chunk_size: chunkSize,
          chunk_overlap: 160,
          onUploadProgress: (event) => updateFileProgress(index, event.loaded, event.total || Math.max(file.size || 0, 1)),
        });
        uploadedBytesByIndex.set(index, Math.max(file.size || 0, 1));
        if (result.job_id) jobIds.push(result.job_id);
      }
      setCreateUploadProgress({ percent: 92, title: "刷新列表", detail: "文件已上传，正在刷新知识库状态...", status: "active" });
      setUploadFiles([]);
      await refreshKnowledgeBases();
      await refreshKnowledgeFiles(String(created.id));
      setTemplateId(String(created.id));
      setDetailTemplateId(String(created.id));
      setCreateUploadProgress({ percent: 100, title: "上传完成", detail: "入库任务已提交，后台正在解析和向量化。", status: "success" });
      setCreateMode(false);
      message.success(`\u5df2\u4e0a\u4f20 ${rawFiles.length} \u4e2a\u6587\u4ef6\uff0c\u540e\u53f0\u6b63\u5728\u5165\u5e93`);
      void pollIngestJobs(String(created.id), jobIds);
    } catch (error) {
      console.error(error);
      const detail = apiErrorMessage(error, "Create or upload failed");
      setCreateUploadProgress({ percent: 100, title: "上传失败", detail, status: "exception" });
      message.error(detail);
    } finally {
      setUploading(false);
    }
  }

  function openEditKnowledgeBase(template: KnowledgeTemplate) {
    const id = Number(template.id);
    if (!Number.isFinite(id)) {
      message.info("模板知识库不支持编辑，请先创建真实知识库");
      return;
    }
    setEditingKnowledgeBase(template);
    editForm.setFieldsValue({ name: template.name, description: template.headline, visibility: template.visibility });
  }

  async function handleSaveKnowledgeBaseEdit() {
    if (!editingKnowledgeBase) return;
    const id = Number(editingKnowledgeBase.id);
    if (!Number.isFinite(id)) {
      message.info("模板知识库不支持编辑");
      return;
    }
    const values = await editForm.validateFields();
    setEditSaving(true);
    try {
      await updateKnowledgeBase(id, {
        name: values.name.trim(),
        description: values.description?.trim() || "",
        visibility: values.visibility,
      });
      await refreshKnowledgeBases();
      setEditingKnowledgeBase(null);
      message.success("知识库已更新");
    } catch (error) {
      console.error(error);
      message.error("更新知识库失败");
    } finally {
      setEditSaving(false);
    }
  }

  function confirmDeleteKnowledgeBase(template: KnowledgeTemplate) {
    const id = Number(template.id);
    if (!Number.isFinite(id)) {
      message.info("模板知识库不支持删除");
      return;
    }
    modal.confirm({
      title: "删除知识库",
      content: `确定删除「${template.name}」吗？删除后该知识库将从列表中移除。`,
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      async onOk() {
        try {
          await deleteKnowledgeBase(id);
          await refreshKnowledgeBases();
          if (templateId === template.id) {
            const next = baseTemplates.find((item) => item.id !== template.id);
            if (next) setTemplateId(next.id);
          }
          message.success("知识库已删除");
        } catch (error) {
          console.error(error);
          message.error("删除知识库失败");
        }
      },
    });
  }
  async function handleUploadFiles() {
    const targetId = Number(detailTemplate?.id || selectedTemplate.id);
    if (!Number.isFinite(targetId)) {
      message.warning("Create a backend knowledge base first");
      return;
    }
    const rawFiles = uploadFiles.map((item) => item.originFileObj).filter(Boolean) as File[];
    if (!rawFiles.length) {
      message.warning("Choose files first");
      return;
    }
    setUploading(true);
    try {
      const jobIds: number[] = [];
      for (const file of rawFiles) {
        const result = await uploadKnowledgeFile(targetId, file, { segment_mode: "general", chunk_size: chunkSize, chunk_overlap: 160 });
        if (result.job_id) jobIds.push(result.job_id);
      }
      setUploadFiles([]);
      setUploadOpen(false);
      await refreshKnowledgeBases();
      await refreshKnowledgeFiles(String(targetId));
      setDetailTemplateId(String(targetId));
      message.success(`\u5df2\u4e0a\u4f20 ${rawFiles.length} \u4e2a\u6587\u4ef6\uff0c\u540e\u53f0\u6b63\u5728\u5165\u5e93`);
      void pollIngestJobs(String(targetId), jobIds);
    } catch (error) {
      console.error(error);
      message.error(apiErrorMessage(error, "Upload or ingest failed"));
    } finally {
      setUploading(false);
    }
  }

  async function downloadOriginalFile(file: KnowledgeTemplateFile) {
    if (!file.id) {
      message.info("Template sample files are not stored in the backend yet");
      return;
    }
    try {
      const blob = await downloadKnowledgeFile(file.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      message.error("File download failed");
    }
  }

  async function loadFileChunks(file: KnowledgeTemplateFile, page = 1, pageSize = chunkPageSize) {
    setProcessedChunks([]);
    if (!file.id) {
      setChunkTotalCount(0);
      return;
    }
    setChunkLoading(true);
    try {
      const data = await getKnowledgeFileChunks(file.id, { page, page_size: pageSize });
      setProcessedChunks(data.results);
      setChunkTotalCount(data.count);
      setChunkCurrentPage(data.page || page);
      setChunkPageSize(data.page_size || pageSize);
    } catch (error) {
      console.error(error);
      message.error("Failed to load chunks");
    } finally {
      setChunkLoading(false);
    }
  }

  async function openProcessedFile(file: KnowledgeTemplateFile) {
    setProcessedFile(file);
    await loadFileChunks(file);
  }

  async function openChunkPage(file: KnowledgeTemplateFile) {
    setProcessedFile(null);
    setChunkCurrentPage(1);
    setChunkPageFile(file);
    await loadFileChunks(file, 1, chunkPageSize);
  }

  async function removeKnowledgeFile(file: KnowledgeTemplateFile) {
    if (file.id) {
      try {
        await deleteKnowledgeFile(file.id);
        if (detailTemplate) await refreshKnowledgeFiles(detailTemplate.id);
        if (processedFile?.id === file.id) setProcessedFile(null);
        if (chunkPageFile?.id === file.id) setChunkPageFile(null);
        message.success("File deleted");
      } catch (error) {
        console.error(error);
        message.error("Failed to delete file");
      }
      return;
    }
    const isUploaded = uploadFiles.some((item) => item.name === file.name);
    if (isUploaded) {
      setUploadFiles((prev) => prev.filter((item) => item.name !== file.name));
      message.success("File removed");
      return;
    }
    if (!detailTemplate) return;
    setDeletedTemplateFiles((prev) => ({
      ...prev,
      [detailTemplate.id]: [...(prev[detailTemplate.id] ?? []), file.name],
    }));
    if (processedFile?.name === file.name) setProcessedFile(null);
    if (chunkPageFile?.name === file.name) setChunkPageFile(null);
    message.success("File removed");
  }

  useEffect(() => {
    void refreshKnowledgeBases();
  }, []);

  useEffect(() => {
    if (detailTemplateId) void refreshKnowledgeFiles(detailTemplateId);
    setChunkPageFile(null);
    setChunkCurrentPage(1);
    setChunkTotalCount(0);
  }, [detailTemplateId]);


  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(chunkTotalCount / chunkPageSize));
    if (chunkCurrentPage > maxPage) setChunkCurrentPage(maxPage);
  }, [chunkCurrentPage, chunkPageSize, chunkTotalCount]);
  const configDraft = useMemo(() => ({
    project_name: projectName,
    objective,
    template_id: selectedTemplate.id,
    template_name: selectedTemplate.name,
    visibility,
    retrieval: {
      engine,
      top_k: topK,
      chunk_size: chunkSize,
      require_citation: requireCitation,
      graph_extraction: extractGraph,
      rerank: true,
      permission_filter: true,
    },
    governance: {
      owner: selectedTemplate.owner,
      review_policy: reviewPolicy,
      evidence_coverage: selectedTemplate.evidenceCoverage,
      publish_gate: visibility === "company" || reviewPolicy === "required" ? "admin_required" : "team_owner",
    },
    sources: selectedSourceObjects.map((source) => ({
      id: source.id,
      name: source.name,
      type: source.type,
      scope: source.scope,
      state: source.state,
    })),
    uploaded_files: uploadFiles.map((file) => ({
      name: file.name,
      size: file.size ?? 0,
      status: file.status ?? "pending",
      purpose: uploadPurpose,
      target_visibility: visibility,
      ingest_plan: {
        parse: true,
        chunk_size: chunkSize,
        vectorize: true,
        extract_graph: extractGraph,
      },
    })),
    outputs: selectedTemplate.outputs,
    sample_question: selectedTemplate.sampleQuestion,
  }), [chunkSize, deletedTemplateFiles, engine, extractGraph, objective, projectName, requireCitation, reviewPolicy, selectedSourceObjects, selectedTemplate, topK, uploadFiles, uploadPurpose, visibility]);

  function applyTemplate(nextId: string) {
    const next = baseTemplates.find((item) => item.id === nextId) ?? templates.find((item) => item.id === nextId) ?? baseTemplates[0] ?? templates[0];
    setTemplateId(next.id);
    setVisibility(next.visibility);
    setEngine(next.strategy);
    setReviewPolicy(next.reviewPolicy);
    setRequireCitation(next.kind !== "compiled" && next.kind !== "custom");
    setExtractGraph(next.kind === "graph" || next.kind === "hybrid");
    if (next.id !== "blank") {
      setObjective(next.headline);
    }
  }


  return (
    <div className="knowledge-console">
      <style>{styles}</style>
      {createMode ? (
        <section className="kb-create-page">
          <div className="create-topbar">
            <button className="create-back" onClick={() => setCreateMode(false)}><ArrowLeftOutlined /></button>
            <b>新建知识库</b>
          </div>

          <div className="create-body">
            <div className="create-main">
              <div className="create-hero">
                <div>
                  <Text type="secondary">知识库配置</Text>
                  <h2>先定义知识库，再导入文件</h2>
                  <p>名称会显示在知识库列表和文件管理页，描述用于帮助团队理解这个知识库的用途。</p>
                </div>
              </div>

              <div className="create-grid">
                <section className="create-panel create-info-panel">
                  <div className="create-panel-title">
                    <span>基础信息</span>
                    <small>必填</small>
                  </div>
                  <div className="create-form-stack">
                    <label className="create-scope-field">
                      <span>权限标签</span>
                      <Segmented
                        block
                        value={visibility}
                        onChange={(value) => setVisibility(value as Visibility)}
                        options={[
                          { label: "个人", value: "private" },
                          { label: "团队", value: "team" },
                          { label: "公司", value: "company" },
                        ]}
                      />
                      <small className="create-scope-hint">{visibilityDescriptions[visibility]}</small>
                    </label>
                    <label>
                      <span>知识库名称</span>
                      <Input
                        value={createName}
                        onChange={(event) => setCreateName(event.target.value)}
                        placeholder="例如：测试知识库"
                        maxLength={80}
                        showCount
                      />
                    </label>
                    <label>
                      <span>知识库描述</span>
                      <Input.TextArea
                        value={createDescription}
                        onChange={(event) => setCreateDescription(event.target.value)}
                        placeholder="描述这个知识库收录哪些资料、服务哪些场景"
                        autoSize={{ minRows: 5, maxRows: 8 }}
                        maxLength={500}
                        showCount
                      />
                    </label>
                  </div>
                </section>

                <section className="create-panel create-source-panel">
                  <div className="create-panel-title">
                    <span>数据源</span>
                    <small>可先创建空知识库</small>
                  </div>
                  <div className="source-choice-row">
                    <button className={createSource === "file" ? "active" : ""} onClick={() => setCreateSource("file")}>
                      <FileSearchOutlined />
                      <span>导入已有文本</span>
                    </button>
                    <button className={createSource === "wecom" ? "active" : ""} onClick={() => setCreateSource("wecom")}>
                      <DatabaseOutlined />
                      <span>同步自企微内容</span>
                    </button>
                    <button className={createSource === "web" ? "active" : ""} onClick={() => setCreateSource("web")}>
                      <NodeIndexOutlined />
                      <span>同步自 Web 站点</span>
                    </button>
                  </div>

                  {createSource === "file" ? (
                    <>
                      <h3 className="upload-heading">上传文本文件</h3>
                      <Dragger
                        className="create-upload"
                        multiple
                        fileList={uploadFiles}
                        beforeUpload={() => false}
                        onChange={(info) => {
                          setUploadFiles(info.fileList);
                          setCreateUploadProgress(null);
                        }}
                        accept=".md,.markdown,.xml,.eml,.csv,.txt,.epub,.xlsx,.pptx,.vtt,.ppt,.html,.properties,.doc,.docx,.pdf,.msg,.xls,.htm"
                      >
                        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                        <p className="ant-upload-text">拖拽文件至此，或者 <span>选择文件</span></p>
                        <p className="ant-upload-hint">已支持 MDX、XML、EML、CSV、TXT、EPUB、XLSX、PPTX、VTT、PPT、HTML、PROPERTIES、MARKDOWN、DOC、MD、DOCX、PDF、MSG、XLS、HTM，每批最多 1 个文件，每个文件不超过 15 MB。</p>
                      </Dragger>
                    </>
                  ) : createSource === "wecom" ? (
                    <div className="source-connect-card">
                      <div className="source-connect-icon"><DatabaseOutlined /></div>
                      <h3>企微未绑定</h3>
                      <p>同步企微内容前，须先绑定企业微信</p>
                      <Button type="primary" onClick={() => message.info("后续接入企业微信授权绑定")}>去绑定</Button>
                    </div>
                  ) : (
                    <div className="source-connect-card">
                      <div className="source-connect-icon"><NodeIndexOutlined /></div>
                      <h3>Web 站点未配置</h3>
                      <p>同步 Web 站点内容前，须先配置站点地址和抓取规则</p>
                      <Button type="primary" onClick={() => message.info("后续接入 Web 站点同步配置")}>去配置</Button>
                    </div>
                  )}

                  <div className="create-actions">
                    <Button onClick={() => { setCreateUploadProgress(null); setCreateMode(false); }}>取消</Button>
                    <Button icon={<DatabaseOutlined />} loading={baseLoading} onClick={() => void handleCreateEmptyKnowledgeBase()}>
                      创建空知识库
                    </Button>
                    <Button type="primary" disabled={createSource !== "file" || !uploadFiles.length} loading={uploading} onClick={() => void handleCreateWizardNext()}>
                      创建并上传
                    </Button>
                  </div>
                  {createUploadProgress ? (
                    <div className="create-upload-progress">
                      <div className="create-upload-progress-head">
                        <b>{createUploadProgress.title}</b>
                        <span>{createUploadProgress.percent}%</span>
                      </div>
                      <Progress percent={createUploadProgress.percent} status={createUploadProgress.status} showInfo={false} />
                      <p>{createUploadProgress.detail}</p>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          </div>
        </section>
      ) : detailTemplate && chunkPageFile ? (
        <section className="knowledge-chunk-window">
          <div className="doc-window-topbar">
            <Button icon={<ArrowLeftOutlined />} onClick={() => { setChunkPageFile(null); setProcessedChunks([]); }}>返回文档列表</Button>
            <Space wrap>
              <Tag color={chunkPageFile.status === "ready" ? "green" : chunkPageFile.status === "failed" ? "red" : "blue"}>{displayStatus(chunkPageFile.status)}</Tag>
              <Tag>{chunkPageFile.kind || "file"}</Tag>
              <Tag>{chunkPageFile.chunks || processedChunks.length} chunks</Tag>
            </Space>
          </div>

          <div className="chunk-window-header">
            <div>
              <Title level={3}>{chunkPageFile.name}</Title>
              <Paragraph>{chunkPageFile.source}</Paragraph>
            </div>
            <Space>
              <Button icon={<EyeOutlined />} onClick={() => void openProcessedFile(chunkPageFile)}>处理详情</Button>
              <Button icon={<FileSearchOutlined />} onClick={() => void downloadOriginalFile(chunkPageFile)}>下载原文件</Button>
            </Space>
          </div>

          <div className="chunk-page-layout">
            <section className="chunk-list-panel">
              <div className="chunk-list-topbar">
                <b>{chunkLoading ? "正在加载切片" : `${chunkTotalCount || chunkPageFile.chunks || processedChunks.length || 0} 个切片`}</b>
                <span>一行成交明细对应一个 chunk</span>
              </div>
              <div className="chunk-scroll-area">
                <List
                  loading={chunkLoading}
                  dataSource={processedChunks}
                  locale={{ emptyText: chunkPageFile.id ? "暂无切片，可能仍在后台入库" : "示例文件暂无后端切片" }}
                  renderItem={(chunk) => {
                  const text = chunk.text_preview || chunk.chunk_ref;
                  const keywords = chunkKeywords(chunk, text);
                  return (
                    <List.Item className="chunk-row">
                      <div className="chunk-row-main">
                        <div className="chunk-row-title">
                          <span>分段-{String(chunk.chunk_index + 1).padStart(2, "0")}</span>
                          <small>{text.length.toLocaleString()} 字符</small>
                        </div>
                        <Paragraph className="chunk-preview-text">{text}</Paragraph>
                        {keywords.length ? (
                          <Space size={[6, 6]} wrap>
                            {keywords.map((keyword) => <Tag key={keyword}>{keyword}</Tag>)}
                          </Space>
                        ) : null}
                      </div>
                    </List.Item>
                  );
                }}
                />
              </div>
              {chunkTotalCount > 10 ? (
                <div className="chunk-pagination-bar">
                  <div className="chunk-pagination-stepper">
                    <Button
                      aria-label="Previous page"
                      className="chunk-page-nav-button"
                      icon={<LeftOutlined />}
                      disabled={chunkCurrentPage <= 1 || chunkLoading}
                      onClick={() => changeChunkPage(chunkCurrentPage - 1)}
                    />
                    <span>{chunkCurrentPage} / {chunkTotalPages}</span>
                    <Button
                      aria-label="Next page"
                      className="chunk-page-nav-button"
                      icon={<RightOutlined />}
                      disabled={chunkCurrentPage >= chunkTotalPages || chunkLoading}
                      onClick={() => changeChunkPage(chunkCurrentPage + 1)}
                    />
                  </div>
                  <div className="chunk-pagination-pages">
                    {chunkPageNumbers.map((page) => (
                      <button
                        key={page}
                        type="button"
                        className={page === chunkCurrentPage ? "is-active" : ""}
                        disabled={chunkLoading}
                        onClick={() => changeChunkPage(page)}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                  <div className="chunk-page-size-switch">
                    {[10, 25, 50].map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={size === chunkPageSize ? "is-active" : ""}
                        disabled={chunkLoading}
                        onClick={() => changeChunkPageSize(size)}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            <aside className="chunk-meta-panel">
              <Card title="文档信息">
                <List
                  size="small"
                  dataSource={[
                    `原始文件名称：${chunkPageFile.name}`,
                    `文件类型：${chunkPageFile.kind || "file"}`,
                    `上传时间：${formatDateTime(chunkPageFile.uploadedAt)}`,
                    `字符数：${(chunkPageFile.charCount ?? 0).toLocaleString()}`,
                    `切片数量：${chunkTotalCount || chunkPageFile.chunks || processedChunks.length || 0}`,
                    `召回次数：${chunkPageFile.recallCount ?? 0}`,
                  ]}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </Card>
              <Card title="切分方式">
                <p className="chunk-meta-copy">XLSX/CSV 明细表按行切分，一条表格数据生成一个 chunk；普通文档仍按段落和字符长度合并切分。</p>
              </Card>
            </aside>
          </div>
        </section>
      ) : detailTemplate ? (
        <section className="knowledge-doc-window">
          <div className="doc-window-topbar">
            <Button icon={<ArrowLeftOutlined />} onClick={() => setDetailTemplateId(null)}>返回知识库配置</Button>
            <Space wrap>
              <Tag color={kindColor(detailTemplate.kind)}>{detailTemplate.category}</Tag>
              <Tag>{engineLabels[detailTemplate.strategy]}</Tag>
              <Tag>{visibilityLabels[detailTemplate.visibility]}</Tag>
            </Space>
          </div>

          <div className="doc-window-header">
            <div>
              <Title level={3}>文档</Title>
            </div>
            <div className="doc-window-summary">
              <div><b>{filteredDetailFiles.length}</b><span>文件</span></div>
              <div><b>{detailReadyCount}</b><span>可用</span></div>
              <div><b>{(detailTotalChars / 1000).toFixed(1)}k</b><span>字符数</span></div>
            </div>
          </div>

          <div className="doc-toolbar">
            <Select
              value={detailTypeFilter}
              onChange={setDetailTypeFilter}
              options={detailTypeOptions.map((item) => ({ label: item, value: item }))}
              suffixIcon={null}
              className="doc-filter"
            />
            <Input prefix={<SearchOutlined />} value={detailSearch} onChange={(event) => setDetailSearch(event.target.value)} placeholder="搜索" allowClear />
            <Button icon={<SortAscendingOutlined />}>排序：上传时间</Button>
            <span className="doc-toolbar-spacer" />
            <Button icon={<SettingOutlined />}>元数据</Button>
            <Button type="primary" icon={<PlusOutlined />} loading={fileLoading} onClick={() => setUploadOpen(true)}>添加文件</Button>
          </div>

          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th className="check-col"><input type="checkbox" aria-label="选择全部文件" /></th>
                  <th className="index-col">#</th>
                  <th>名称</th>
                  <th>分段模式</th>
                  <th>字符数</th>
                  <th>召回次数 ↓</th>
                  <th>上传时间 ↓</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredDetailFiles.length ? filteredDetailFiles.map((file, index) => {
                  const statusText = displayStatus(file.status);
                  const chars = file.charCount ?? Math.max(file.chunks, 1) * 58;
                  const recallCount = file.recallCount ?? 0;
                  return (
                    <tr key={`${file.name}-${index}`}>
                      <td className="check-col"><input type="checkbox" aria-label={`选择 ${file.name}`} /></td>
                      <td className="index-col">{index + 1}</td>
                      <td>
                        <button className="doc-name" onClick={() => void openChunkPage(file)}>
                          <span className="file-type-icon"><FileExcelOutlined /></span>
                          <span>{file.name}</span>
                        </button>
                        <div className="doc-source">{file.source}</div>
                      </td>
                      <td><span className="segment-pill">通用</span></td>
                      <td>{chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : chars}</td>
                      <td>{recallCount}</td>
                      <td>{formatDateTime(file.uploadedAt)}</td>
                      <td><span className={`doc-status ${file.status}`}>{statusText}</span></td>
                      <td>
                        <Space size={10}>
                          <Switch size="small" checked={file.status !== "suggested"} />
                          <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => void openProcessedFile(file)} />
                          <Popconfirm title="从当前知识库配置中移除这个文件？" okText="移除" cancelText="取消" onConfirm={() => removeKnowledgeFile(file)}>
                            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                          <Button size="small" type="text" icon={<MoreOutlined />} />
                        </Space>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={9}>
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配文件" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="doc-pagination">
            <Space>
              <Button disabled>‹</Button>
              <span>1 / 1</span>
              <Button disabled>›</Button>
            </Space>
            <span className="page-number">1</span>
            <Segmented value={detailPageSize} onChange={(value) => setDetailPageSize(Number(value))} options={[10, 25, 50]} />
          </div>
        </section>
      ) : (
        <>
          <section className="kb-dify-home">
            <div className="dify-topline">
              <Title level={2}>知识库</Title>
              <Space size={22} className="api-status">
                <span><NodeIndexOutlined /> 外部知识库 API</span>
                <span><i /> 服务 API</span>
              </Space>
            </div>

            <div className="dify-toolbar">
              <Select
                value={category}
                onChange={(value) => setCategory(String(value))}
                options={categories.map((item) => ({ label: item === "全部" ? "标签" : item, value: item }))}
                className="tag-filter"
              />
              <Input prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索" allowClear className="dify-search" />
              <Segmented
                value={scopeFilter}
                onChange={(value) => setScopeFilter(value as Visibility | "all")}
                options={[
                  { label: "全部", value: "all" },
                  { label: "个人", value: "private" },
                  { label: "团队", value: "team" },
                  { label: "公司", value: "company" },
                ]}
              />
              <span className="toolbar-spacer" />
              <Button type="primary" icon={<PlusOutlined />} loading={baseLoading} onClick={() => void handleCreateKnowledgeBase()}>创建</Button>
            </div>

            <div className="dify-card-grid">
              {visibleTemplates.map((template) => {
                const templateFiles = detailFilesByBase[template.id] ?? templateFileDetails[template.id] ?? [];
                const fileCount = templateFiles.length + (template.id === selectedTemplate.id ? uploadFiles.length : 0);
                const appCount = template.kind === "hybrid" ? 1 : 0;
                const updatedMinutes = 18 + Math.max(0, baseTemplates.findIndex((item) => item.id === template.id)) * 4;
                return (
                  <article
                    key={template.id}
                    className={`dify-kb-card ${template.id === selectedTemplate.id ? "active" : ""}`}
                    onClick={() => applyTemplate(template.id)}
                    onDoubleClick={() => setDetailTemplateId(template.id)}
                    title="双击打开知识库文档"
                  >
                    {template.canEdit === false ? null : (
                      <Dropdown
                        trigger={["click"]}
                        menu={{
                          items: [
                            { key: "edit", label: "编辑" },
                            { key: "delete", label: "删除", danger: true },
                          ],
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            if (key === "edit") openEditKnowledgeBase(template);
                            if (key === "delete") confirmDeleteKnowledgeBase(template);
                          },
                        }}
                      >
                        <Button
                          className="dify-card-more"
                          type="text"
                          shape="circle"
                          icon={<MoreOutlined />}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </Dropdown>
                    )}
                    <div className="dify-card-mainrow">
                      <div className="dify-kb-icon"><DatabaseOutlined /></div>
                      <div className="dify-title-block">
                        <h3>{template.name}</h3>
                        <div className="dify-subline">
                          <span>通用</span>
                          <Tag color={visibilityColors[template.visibility]}>{visibilityLabels[template.visibility]}</Tag>
                          <span>{visibilityDescriptions[template.visibility]}</span>
                        </div>
                      </div>
                    </div>
                    <p className="dify-desc">{template.headline || `useful for when you want to answer queries about the ${template.name} knowledge base`}</p>
                    <button className="add-tag" onClick={(event) => { event.stopPropagation(); message.info("后续可接入标签管理"); }}>◇ 添加标签</button>
                    <div className="dify-card-footer">
                      <span><FileSearchOutlined /> {fileCount}</span>
                      <span><DatabaseOutlined /> {appCount}</span>
                      <span>/</span>
                      <span>更新于 {updatedMinutes} 分钟前</span>
                    </div>
                  </article>
                );
              })}
              {visibleTemplates.length === 0 ? <Empty description="没有匹配的知识库" /> : null}
            </div>
          </section>
        </>
      )}

      <Modal
        title="编辑知识库"
        open={Boolean(editingKnowledgeBase)}
        okText="保存"
        cancelText="取消"
        confirmLoading={editSaving}
        onOk={() => void handleSaveKnowledgeBaseEdit()}
        onCancel={() => setEditingKnowledgeBase(null)}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" requiredMark={false}>
          <Form.Item
            label="知识库名字"
            name="name"
            rules={[{ required: true, whitespace: true, message: "请输入知识库名字" }]}
          >
            <Input maxLength={160} showCount placeholder="请输入知识库名字" />
          </Form.Item>
          <Form.Item label="知识库描述" name="description">
            <Input.TextArea rows={4} maxLength={500} showCount placeholder="请输入知识库描述" />
          </Form.Item>
          <Form.Item
            label="可见范围"
            name="visibility"
            rules={[{ required: true, message: "请选择可见范围" }]}
          >
            <Segmented
              block
              options={[
                { label: "个人", value: "private" },
                { label: "团队", value: "team" },
                { label: "公司", value: "company" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer title={detailTemplate?.name || "方案模板详情"} width={720} open={false} onClose={() => setDetailTemplateId(null)}>
        {detailTemplate ? (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <div>
              <Tag color={kindColor(detailTemplate.kind)}>{detailTemplate.category}</Tag>
              <Tag>{detailTemplate.owner}</Tag>
              <Tag>{engineLabels[detailTemplate.strategy]}</Tag>
              <Tag>{visibilityLabels[detailTemplate.visibility]}</Tag>
              <Title level={3} style={{ marginTop: 12 }}>{detailTemplate.name}</Title>
              <Paragraph>{detailTemplate.headline}</Paragraph>
            </div>
            <Row gutter={[12, 12]}>
              <Col span={12}><Card><Statistic title="证据覆盖" value={detailTemplate.evidenceCoverage} suffix="%" /></Card></Col>
              <Col span={12}><Card><Statistic title="模板就绪" value={detailTemplate.readiness} suffix="%" /></Card></Col>
            </Row>
            <Card title="适用场景">
              <Space wrap>{detailTemplate.bestFor.map((item) => <Tag key={item}>{item}</Tag>)}</Space>
            </Card>
            <Card title="需要准备的资料">
              <List size="small" dataSource={detailTemplate.inputs} renderItem={(item) => <List.Item>{item}</List.Item>} />
              <Paragraph className="muted">支持格式：{detailTemplate.files.join(" / ")}</Paragraph>
            </Card>
            <Card title="知识库文件明细">
              <List
                size="small"
                dataSource={detailFiles}
                renderItem={(file) => (
                  <List.Item
                    actions={[
                      <Button key="view" size="small" icon={<EyeOutlined />} onClick={() => void openProcessedFile(file)}>处理详情</Button>,
                      <Popconfirm key="delete" title="从当前知识库配置中移除这个文件？" okText="移除" cancelText="取消" onConfirm={() => removeKnowledgeFile(file)}>
                        <Button size="small" danger icon={<DeleteOutlined />}>移除</Button>
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<FileSearchOutlined />}
                      title={<Space wrap><span>{file.name}</span><Tag color={file.status === "ready" ? "green" : file.status === "review" ? "gold" : "blue"}>{file.status === "ready" ? "已就绪" : file.status === "review" ? "待复核" : "建议接入"}</Tag></Space>}
                      description={`${file.kind} / ${file.source} / ${file.chunks ? `${file.chunks} chunks` : "待解析"}`}
                    />
                  </List.Item>
                )}
              />
            </Card>
            <Card title="创建后能输出什么">
              <Space wrap>{detailTemplate.outputs.map((item) => <Tag color="blue" key={item}>{item}</Tag>)}</Space>
            </Card>
            <Card title="默认治理策略">
              <List
                size="small"
                dataSource={[
                  `检索策略：${engineLabels[detailTemplate.strategy]}`,
                  `默认权限：${visibilityLabels[detailTemplate.visibility]}`,
                  `审核策略：${reviewLabels[detailTemplate.reviewPolicy]}`,
                  `样例问题：${detailTemplate.sampleQuestion}`,
                ]}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Card>
            <Card title="限制与注意事项">
              <List size="small" dataSource={detailTemplate.limitations} renderItem={(item) => <List.Item>{item}</List.Item>} />
            </Card>
          </Space>
        ) : null}
      </Drawer>
      <Drawer title="知识中台配置草案" width={620} open={drawerOpen} onClose={() => setDrawerOpen(false)} extra={<Button type="primary" onClick={() => message.success("配置草案已复制到发布流程")}>进入发布流程</Button>}>
        <pre className="config-json">{JSON.stringify(configDraft, null, 2)}</pre>
      </Drawer>


      <Drawer title={processedFile ? `处理后的文件详情 - ${processedFile.name}` : "处理后的文件详情"} width={680} open={Boolean(processedFile)} onClose={() => setProcessedFile(null)}>
        {processedFile ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Card title="文件状态">
              <List
                size="small"
                dataSource={[
                  `文件类型：${processedFile.kind}`,
                  `来源：${processedFile.source}`,
                  `状态：${processedFile.status === "ready" ? "已就绪" : processedFile.status === "review" ? "待复核" : "建议接入"}`,
                  `切块数量：${processedFile.chunks ? `${processedFile.chunks} chunks` : "待解析"}`,
                  `权限范围：${visibilityLabels[visibility]}`,
                  `当前检索策略：${engineLabels[engine]}`,
                ]}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Card>
            <Card title="处理链路">
              <Timeline
                items={[
                  { children: "原文件保存与格式识别" },
                  { children: processedFile.chunks ? `文本解析完成，生成 ${processedFile.chunks} 个 chunks` : "等待解析文本并生成 chunks" },
                  { children: `按 ${chunkSize} 字符切块并写入向量索引` },
                  { children: extractGraph ? "实体与关系抽取已纳入图谱处理计划" : "当前未开启图谱抽取" },
                  { children: requireCitation ? "回答时必须返回引用证据" : "回答可使用摘要模式" },
                ]}
              />
            </Card>
            <Card title={`处理后的切片预览${chunkLoading ? "..." : processedChunks.length ? ` (${processedChunks.length})` : ""}`}>
              <List
                size="small"
                dataSource={processedChunks.length ? processedChunks.map((chunk) => {
                  const text = chunk.text_preview || chunk.chunk_ref;
                  return {
                    title: `chunk_${String(chunk.chunk_index + 1).padStart(3, "0")}`,
                    text,
                    keywords: chunkKeywords(chunk, text),
                  };
                }) : [
                  { title: "chunk_001", text: `${processedFile.name} is waiting for backend chunk preview.`, keywords: [] },
                ]}
                renderItem={(chunk) => (
                  <List.Item>
                    <List.Item.Meta
                      title={chunk.title}
                      description={(
                        <Space direction="vertical" size={8} style={{ width: "100%" }}>
                          {chunk.keywords.length ? (
                            <Space size={[6, 6]} wrap>
                              {chunk.keywords.map((keyword) => <Tag key={keyword}>{keyword}</Tag>)}
                            </Space>
                          ) : null}
                          <Paragraph className="chunk-preview-text">{chunk.text}</Paragraph>
                        </Space>
                      )}
                    />
                  </List.Item>
                )}
              />
            </Card>
            <Card title="可执行操作">
              <Space wrap>
                <Button icon={<EyeOutlined />} onClick={() => message.info("当前为前端预览，后续可接真实 chunk 详情接口")}>打开 chunk 详情</Button>
                <Popconfirm title="从当前知识库配置中移除这个文件？" okText="移除" cancelText="取消" onConfirm={() => { removeKnowledgeFile(processedFile); setProcessedFile(null); }}>
                  <Button danger icon={<DeleteOutlined />}>从知识库移除</Button>
                </Popconfirm>
              </Space>
            </Card>
          </Space>
        ) : null}
      </Drawer>
      <Drawer title="接入知识文件" width={680} open={uploadOpen} onClose={() => setUploadOpen(false)} extra={<Button type="primary" loading={uploading} onClick={() => void handleUploadFiles()}>上传并入库</Button>}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <div>
            <Text strong>上传后会进入哪条链路？</Text>
            <Paragraph className="muted">
              文件会跟随当前模板配置进入解析、切块、向量化、权限标注；如果开启图谱抽取，还会进入实体关系抽取。正式上传接口接通后，这里会把同一份配置通过 multipart/form-data 提交给后端。
            </Paragraph>
          </div>
          <Form layout="vertical">
            <Form.Item label="资料用途">
              <Input.TextArea rows={3} value={uploadPurpose} onChange={(event) => setUploadPurpose(event.target.value)} />
            </Form.Item>
            <Form.Item label="继承权限">
              <Segmented value={visibility} onChange={(value) => setVisibility(value as Visibility)} options={[{ label: "个人", value: "private" }, { label: "团队", value: "team" }, { label: "公司", value: "company" }]} />
            </Form.Item>
          </Form>
          <Dragger
            multiple
            fileList={uploadFiles}
            beforeUpload={() => false}
            onChange={(info) => setUploadFiles(info.fileList)}
            accept=".pdf,.doc,.docx,.md,.txt,.csv,.xlsx,.json,.html,.ppt,.pptx"
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">拖拽知识文件到这里，或点击选择文件</p>
            <p className="ant-upload-hint">支持 PDF、Word、Markdown、TXT、表格、JSON、HTML、PPT。选择后点击上传并入库，会提交到后端解析、切块和向量化。</p>
          </Dragger>
          {uploadFiles.length ? (
            <List
              className="upload-file-list"
              dataSource={uploadFiles}
              renderItem={(file) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<FileSearchOutlined />}
                    title={file.name}
                    description={`${visibilityLabels[visibility]}可见 / ${Math.round((file.size ?? 0) / 1024).toLocaleString()} KB / ${engineLabels[engine]}`}
                  />
                </List.Item>
              )}
            />
          ) : null}
        </Space>
      </Drawer>
    </div>
  );
}

const styles = `
.knowledge-console {
  min-height: calc(100vh - 96px);
  color: #0f1f3a;
}
.knowledge-console::before {
  content: none;
}
.knowledge-console > * { position: relative; z-index: 1; }
.kb-create-page {
  min-height: calc(100vh - 96px);
  margin: 0;
  background: #f7f8fb;
  color: #101828;
}
.create-topbar {
  position: relative;
  display: flex;
  height: 60px;
  align-items: center;
  border-bottom: 1px solid #e7eaf0;
  background: #ffffff;
}
.create-back {
  position: absolute;
  left: 20px;
  top: 16px;
  z-index: 2;
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #111827;
  cursor: pointer;
}
.create-back:hover {
  background: #f2f4f7;
}
.create-topbar > b {
  display: flex;
  align-items: center;
  padding-left: 56px;
  color: #111827;
  font-size: 17px;
  font-weight: 700;
  white-space: nowrap;
}
.create-body {
  display: flex;
  min-height: calc(100vh - 156px);
  align-items: flex-start;
  justify-content: center;
  padding: 34px 24px 56px;
}
.create-main {
  width: min(100%, 1120px);
}
.create-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}
.create-hero h2 {
  margin: 6px 0 8px;
  color: #111827;
  font-size: 28px;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: 0;
}
.create-hero p {
  max-width: 680px;
  margin: 0;
  color: #52637f;
  font-size: 14px;
  line-height: 1.65;
}
.create-grid {
  display: grid;
  grid-template-columns: minmax(300px, 0.86fr) minmax(460px, 1.14fr);
  gap: 18px;
  align-items: start;
}
.create-panel {
  min-width: 0;
  border: 1px solid #e4e7ec;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 12px 34px rgba(15, 23, 42, 0.06);
}
.create-info-panel,
.create-source-panel {
  padding: 22px;
}
.create-panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.create-panel-title span {
  color: #182230;
  font-size: 17px;
  font-weight: 800;
}
.create-panel-title small {
  color: #667085;
  font-size: 13px;
}
.create-form-stack {
  display: grid;
  gap: 18px;
}
.create-form-stack label {
  display: grid;
  gap: 8px;
  color: #344054;
  font-size: 14px;
  font-weight: 700;
}
.create-form-stack .ant-input,
.create-form-stack .ant-input-affix-wrapper,
.create-form-stack .ant-input-textarea-show-count textarea {
  border-radius: 10px;
}
.create-form-stack textarea {
  resize: none;
}
.create-scope-field .ant-segmented { width: 100%; padding: 3px; background: #f3f6fb; }
.create-scope-hint { display: block; margin-top: 8px; color: #667085; font-size: 13px; }
.source-choice-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.source-choice-row button {
  display: flex;
  min-width: 0;
  min-height: 74px;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid #e4e7ec;
  border-radius: 10px;
  background: #ffffff;
  color: #344054;
  font-size: 15px;
  cursor: pointer;
  text-align: left;
  transition: border-color .16s ease, box-shadow .16s ease, background .16s ease;
}
.source-choice-row button:hover {
  border-color: #b9c7ff;
  background: #fbfcff;
}
.source-choice-row button.active {
  border-color: #0646ff;
  box-shadow: inset 0 0 0 1px #0646ff;
}
.source-choice-row .anticon {
  display: inline-flex;
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  align-items: center;
  justify-content: center;
  border: 1px solid #e4e7ec;
  border-radius: 10px;
  color: #0646ff;
  font-size: 19px;
}
.source-choice-row button > span:last-child {
  min-width: 0;
  line-height: 1.35;
  white-space: normal;
  word-break: keep-all;
}
.source-connect-card {
  min-height: 210px;
  padding: 26px;
  border: 1px dashed #d0d5dd;
  border-radius: 12px;
  background: #f8fafc;
}
.source-connect-icon {
  display: inline-flex;
  width: 52px;
  height: 52px;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
  border: 1px solid #e4e7ec;
  border-radius: 10px;
  background: #ffffff;
  color: #111827;
  font-size: 24px;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
}
.source-connect-card h3 {
  margin: 0 0 8px;
  color: #18223b;
  font-size: 19px;
  font-weight: 800;
}
.source-connect-card p {
  margin: 0 0 18px;
  color: #52637f;
  font-size: 15px;
}
.source-connect-card .ant-btn-primary {
  min-width: 84px;
  height: 40px;
  border-radius: 10px;
  background: #0646ff;
  border-color: #0646ff;
}
.upload-heading {
  margin: 0 0 12px;
  color: #1d2939;
  font-size: 16px;
  line-height: 1.2;
}
.create-upload.ant-upload-wrapper .ant-upload-drag {
  min-height: 176px;
  height: auto;
  border-color: #d9dee8;
  border-style: dashed;
  border-radius: 12px;
  background: #ffffff;
}
.create-upload .ant-upload-drag-container {
  padding: 28px 32px;
}
.create-upload .ant-upload-drag-icon {
  margin-bottom: 10px !important;
  color: #344054;
}
.create-upload .ant-upload-text {
  margin: 0 0 10px !important;
  color: #344054 !important;
  font-size: 16px !important;
}
.create-upload .ant-upload-text span {
  color: #0646ff;
}
.create-upload .ant-upload-hint {
  max-width: 800px;
  margin: 0 auto !important;
  color: #52637f !important;
  font-size: 14px !important;
  line-height: 1.55 !important;
  white-space: normal;
  overflow-wrap: anywhere;
}
.create-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid #eaecf0;
}
.create-actions .ant-btn {
  height: 40px;
  border-radius: 10px;
}
.create-actions .ant-btn-primary {
  min-width: 118px;
  background: #0646ff;
  border-color: #0646ff;
}
.create-actions .ant-btn-primary[disabled] {
  background: #dbe4ff !important;
  border-color: #dbe4ff !important;
  color: #ffffff !important;
}
.create-upload-progress {
  margin-top: 16px;
  padding: 14px;
  border: 1px solid #e4e7ec;
  border-radius: 10px;
  background: #f8fafc;
}
.create-upload-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: #1d2939;
}
.create-upload-progress-head span {
  color: #475467;
  font-size: 13px;
  font-weight: 700;
}
.create-upload-progress p {
  margin: 8px 0 0;
  color: #667085;
  font-size: 13px;
  line-height: 1.5;
}
@media (max-width: 980px) {
  .create-grid {
    grid-template-columns: 1fr;
  }
  .source-choice-row {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 720px) {
  .create-body {
    padding: 28px 16px 48px;
  }
  .create-hero h2 {
    font-size: 23px;
  }
  .create-info-panel,
  .create-source-panel {
    padding: 18px;
  }
  .create-actions {
    justify-content: stretch;
  }
  .create-actions .ant-btn {
    flex: 1 1 100%;
  }
}
.kb-dify-home {
  min-height: calc(100vh - 96px);
  padding: 2px 4px 40px;
  background: #f4f6fa;
}
.dify-topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 18px;
}
.dify-topline h2 {
  margin: 0;
  color: #06142a;
  font-size: 26px;
  line-height: 1.2;
  font-weight: 800;
}
.api-status {
  color: #4b5870;
  font-size: 14px;
}
.api-status span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.api-status i {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #20c76f;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.10);
}
.dify-toolbar {
  display: grid;
  grid-template-columns: 140px 250px auto minmax(24px, 1fr) auto;
  gap: 10px;
  align-items: center;
  margin-bottom: 20px;
}
.dify-toolbar .ant-select-selector,
.dify-toolbar .ant-input-affix-wrapper,
.dify-toolbar .ant-btn {
  height: 40px;
  border-radius: 9px !important;
}
.dify-toolbar .ant-select-selector,
.dify-toolbar .ant-input-affix-wrapper {
  border-color: #d9e0eb !important;
  background: #ffffff !important;
  box-shadow: none !important;
}
.tag-filter .ant-select-selector {
  background: #e9eef5 !important;
  border-color: #e9eef5 !important;
}
.dify-search {
  width: 250px;
}
.all-kb-check {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  height: 40px;
  color: #4b5870;
  font-size: 14px;
  white-space: nowrap;
}
.all-kb-check input {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  accent-color: #155eef;
}
.all-kb-check small {
  display: inline-flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid #c7d0df;
  color: #8a95a7;
  font-size: 10px;
}
.toolbar-spacer {
  min-width: 20px;
}
.dify-toolbar .ant-btn-primary {
  min-width: 102px;
  background: #155eef;
  border-color: #155eef;
  box-shadow: 0 10px 20px rgba(21, 94, 239, 0.18);
}
.dify-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 320px));
  gap: 14px;
  align-items: start;
}
.dify-kb-card {
  position: relative;
  min-height: 162px;
  padding: 16px;
  border: 1px solid #e4e9f2;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  cursor: pointer;
  transition: border-color .18s, box-shadow .18s, transform .18s;
}
.dify-kb-card:hover {
  border-color: #b8c7e4;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
  transform: translateY(-1px);
}
.dify-card-more {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
  opacity: 0;
  pointer-events: none;
  color: #52637f;
  background: #ffffff;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  transition: opacity .16s ease, background .16s ease;
}
.dify-kb-card:hover .dify-card-more,
.dify-card-more.ant-dropdown-open {
  opacity: 1;
  pointer-events: auto;
}
.dify-card-more:hover {
  background: #f2f4f7 !important;
}.dify-kb-card.active {
  border-color: #d8e1f1;
}
.dify-card-mainrow {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.dify-kb-icon {
  position: relative;
  display: inline-flex;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #eef4ff;
  color: #155eef;
  font-size: 21px;
}
.dify-kb-icon::after {
  content: "";
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 13px;
  height: 13px;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: #20c76f;
}
.dify-title-block {
  min-width: 0;
  padding-top: 0;
}
.dify-title-block h3 {
  max-width: 220px;
  margin: 0 0 3px;
  overflow: hidden;
  color: #0f1f3a;
  font-size: 16px;
  line-height: 1.3;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dify-subline {
  display: flex;
  gap: 8px;
  color: #506078;
  font-size: 12px;
}
.dify-desc {
  display: -webkit-box;
  min-height: 36px;
  margin: 11px 0 7px;
  overflow: hidden;
  color: #52617a;
  font-size: 13px;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.add-tag {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: #8b95a7;
  font-size: 13px;
  cursor: pointer;
}
.add-tag:hover {
  color: #155eef;
}
.dify-card-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  color: #8a95a7;
  font-size: 12px;
}
.dify-card-footer span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.knowledge-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  align-items: stretch;
  padding: 4px 0 2px;
}
.knowledge-head-copy,
.knowledge-head-panel,
.template-workspace,
.config-section,
.preview-stack > .ant-card,
.preview-stack .ant-card,
.knowledge-console .ant-card {
  border: 1px solid rgba(15, 23, 42, 0.10);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.07);
  backdrop-filter: blur(14px);
}
.knowledge-head-copy { padding: 22px; }
.knowledge-head-copy h2 { margin: 6px 0 8px; color: #102033; font-size: 30px; line-height: 1.16; }
.knowledge-head-copy p { max-width: 760px; margin: 0; color: #5b6575; font-size: 14px; line-height: 1.7; }
.eyebrow {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(14, 116, 144, 0.10);
  color: #0e7490;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0;
}
.hero-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.hero-badges span {
  border: 1px solid rgba(15, 23, 42, 0.10);
  border-radius: 999px;
  padding: 5px 9px;
  background: #ffffff;
  color: #475569;
  font-size: 12px;
}
.knowledge-head-panel { padding: 16px; display: flex; flex-direction: column; justify-content: space-between; gap: 16px; }
.head-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.head-metrics div {
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 8px;
  background: linear-gradient(180deg, #ffffff, #f8fafc);
  padding: 12px;
}
.head-metrics b { display: block; color: #0f172a; font-size: 22px; line-height: 1; }
.head-metrics span { display: block; margin-top: 6px; color: #64748b; font-size: 12px; }
.head-actions { justify-content: flex-end; }
.knowledge-console .ant-btn { border-radius: 8px; box-shadow: none; }
.knowledge-console .ant-btn-primary {
  background: #0f766e;
  border-color: #0f766e;
  box-shadow: 0 8px 18px rgba(15, 118, 110, 0.20);
}
.knowledge-console .ant-tabs-nav { margin-bottom: 12px; }
.knowledge-console .ant-tabs-tab {
  border-radius: 8px;
  padding: 9px 12px;
  margin: 0 6px 0 0 !important;
}
.knowledge-console .ant-tabs-tab-active { background: #ffffff; box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08); }
.template-workspace,
.config-section { padding: 14px; }
.template-toolbar {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;
}
.template-toolbar .ant-input-affix-wrapper,
.knowledge-console .ant-input,
.knowledge-console .ant-input-affix-wrapper,
.knowledge-console .ant-select-selector,
.knowledge-console textarea {
  border-radius: 8px !important;
  border-color: rgba(15, 23, 42, 0.12) !important;
  background: rgba(255,255,255,0.94) !important;
}
.knowledge-console .ant-segmented {
  border-radius: 8px;
  background: #eef2f7;
  padding: 3px;
}
.knowledge-console .ant-segmented-item { border-radius: 7px; }
.custom-file-entry {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  border: 1px solid rgba(15, 118, 110, 0.22);
  background: linear-gradient(135deg, rgba(240, 253, 250, 0.96), rgba(255, 251, 235, 0.82));
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 14px;
}
.custom-file-entry p { margin: 4px 0 6px; color: #64748b; }
.template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 12px; }
.template-card {
  text-align: left;
  border: 1px solid rgba(15, 23, 42, 0.10);
  background: #ffffff;
  border-radius: 8px;
  padding: 14px;
  min-height: 204px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color .18s, box-shadow .18s, transform .18s, background .18s;
}
.template-card:hover {
  border-color: rgba(14, 116, 144, 0.42);
  transform: translateY(-2px);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.10);
}
.template-card.active {
  border-color: #0f766e;
  background: linear-gradient(180deg, #ffffff, #f0fdfa);
  box-shadow: 0 14px 32px rgba(15, 118, 110, 0.14);
}
.template-card b { color: #0f172a; font-size: 16px; line-height: 1.4; }
.template-card small { color: #64748b; line-height: 1.6; }
.template-card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.template-tags { margin-top: auto; display: flex; flex-wrap: wrap; gap: 4px; }
.template-open-hint {
  display: block;
  padding-top: 4px;
  color: #0e7490 !important;
  font-size: 12px;
}
.strategy-grid, .governance-grid, .eval-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.source-list, .upload-file-list {
  background: #ffffff;
  border: 1px solid rgba(15,23,42,0.08);
  border-radius: 8px;
  padding: 4px 12px;
}
.switch-row { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; color: #475569; }
.preview-stack { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 84px; }
.preview-stack h4 { margin: 2px 0 4px; color: #0f172a; }
.preview-stack .ant-statistic-title { color: #64748b; font-size: 12px; }
.preview-stack .ant-statistic-content { color: #0f172a; }
.pipeline { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.pipeline div {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  background: #f8fafc;
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 8px;
}
.pipeline i {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #0f766e;
  color: #fff;
  font-style: normal;
  font-size: 12px;
}
.knowledge-doc-window {
  min-height: calc(100vh - 104px);
  padding: 26px 28px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.08);
}
.doc-window-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
}
.doc-window-header {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: flex-start;
}
.doc-window-header h3 {
  margin: 0 0 4px;
  color: #06142a;
  font-size: 24px;
  line-height: 1.2;
}
.doc-window-header p {
  margin: 0;
  color: #526079;
  font-size: 14px;
}
.doc-window-header a {
  color: #155eef;
  cursor: pointer;
  font-weight: 600;
}
.doc-window-summary {
  display: grid;
  grid-template-columns: repeat(3, 88px);
  gap: 8px;
}
.doc-window-summary div {
  padding: 10px;
  border: 1px solid #e7ebf2;
  border-radius: 8px;
  background: #f8fafc;
}
.doc-window-summary b,
.doc-window-summary span {
  display: block;
}
.doc-window-summary b {
  color: #0f172a;
  font-size: 18px;
  line-height: 1.15;
}
.doc-window-summary span {
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
}
.doc-toolbar {
  display: grid;
  grid-template-columns: 200px minmax(220px, 1fr) auto minmax(12px, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  margin: 22px 0 20px;
}
.doc-toolbar .ant-input-affix-wrapper,
.doc-toolbar .ant-select-selector,
.doc-toolbar .ant-btn {
  height: 40px;
  border-radius: 8px !important;
}
.doc-filter .ant-select-selector {
  min-width: 200px;
}
.doc-toolbar-spacer {
  min-width: 12px;
}
.doc-table-wrap {
  min-height: 520px;
  overflow-x: auto;
  border-top: 1px solid #eef2f7;
}
.doc-table {
  width: 100%;
  min-width: 1080px;
  border-collapse: collapse;
  color: #13213b;
  font-size: 14px;
}
.doc-table th,
.doc-table td {
  padding: 12px 10px;
  border-bottom: 1px solid #eef2f7;
  text-align: left;
  vertical-align: middle;
}
.doc-table th {
  color: #56627a;
  font-weight: 500;
  white-space: nowrap;
}
.doc-table tr:hover td {
  background: #fbfdff;
}
.doc-table input[type="checkbox"] {
  width: 18px;
  height: 18px;
  border: 1px solid #cfd6e1;
  border-radius: 5px;
  accent-color: #155eef;
}
.check-col {
  width: 34px;
}
.index-col {
  width: 36px;
  color: #64748b;
}
.doc-name {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  max-width: 440px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #0f1f3a;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.doc-name:hover span:last-child {
  color: #155eef;
}
.knowledge-chunk-window {
  min-height: calc(100vh - 104px);
  padding: 26px 28px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.08);
}
.chunk-window-header {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 18px;
}
.chunk-window-header h3 { margin: 0 0 4px; }
.chunk-window-header p { margin: 0; color: #64748b; }
.chunk-page-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 18px;
  align-items: start;
}
.chunk-list-panel {
  min-height: 560px;
  border-top: 1px solid #eef2f7;
}
.chunk-list-topbar {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 14px 0;
  color: #0f172a;
}
.chunk-list-topbar span { color: #64748b; font-size: 13px; }
.chunk-scroll-area {
  max-height: calc(100vh - 330px);
  min-height: 420px;
  overflow-y: auto;
  padding-right: 14px;
  scrollbar-gutter: stable;
}
.chunk-scroll-area::-webkit-scrollbar {
  width: 12px;
}
.chunk-scroll-area::-webkit-scrollbar-track {
  background: #f5f7fb;
  border-radius: 999px;
}
.chunk-scroll-area::-webkit-scrollbar-thumb {
  min-height: 76px;
  border: 3px solid #f5f7fb;
  border-radius: 999px;
  background: #8b8f97;
}
.chunk-scroll-area::-webkit-scrollbar-thumb:hover {
  background: #6f747c;
}
.chunk-pagination-bar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  padding: 18px 0 4px;
}
.chunk-pagination-stepper,
.chunk-pagination-pages,
.chunk-page-size-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.chunk-pagination-stepper { justify-self: start; gap: 16px; }
.chunk-pagination-pages { justify-self: center; }
.chunk-page-size-switch { justify-self: end; }
.chunk-page-nav-button.ant-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border-color: #d9dee8;
  border-radius: 11px;
  background: #ffffff;
  color: #0f2748;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.12);
}
.chunk-page-nav-button.ant-btn:hover:not(:disabled) {
  border-color: #b7c4d8;
  color: #155eef;
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.16);
}
.chunk-page-nav-button.ant-btn:disabled {
  background: #f8fafc;
  color: #9aa4b2;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
}
.chunk-page-nav-button .anticon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 17px;
  line-height: 1;
}
.chunk-pagination-stepper span {
  min-width: 54px;
  text-align: center;
  color: #0d2445;
  font-size: 15px;
  font-weight: 700;
  line-height: 44px;
}
.chunk-pagination-pages button,
.chunk-page-size-switch button {
  min-width: 40px;
  height: 38px;
  padding: 0 13px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #1d3154;
  font: inherit;
  cursor: pointer;
}
.chunk-pagination-pages button.is-active,
.chunk-page-size-switch button.is-active {
  background: #f1f4f8;
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.06);
}
.chunk-pagination-pages button:disabled,
.chunk-page-size-switch button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.chunk-page-size-switch {
  padding: 0 6px;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 3px 14px rgba(15, 23, 42, 0.08);
}
.chunk-row {
  align-items: flex-start !important;
  padding: 18px 0 !important;
}
.chunk-row-main { width: 100%; min-width: 0; }
.chunk-row-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.chunk-row-title span { color: #1e293b; font-weight: 700; }
.chunk-row-title small { color: #64748b; }
.chunk-meta-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 84px;
}
.chunk-meta-panel .ant-card {
  border-radius: 8px;
  border-color: rgba(15,23,42,0.08);
  box-shadow: 0 8px 24px rgba(15,23,42,0.06);
}
.chunk-meta-copy {
  margin: 0;
  color: #64748b;
  line-height: 1.65;
}
.file-type-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: #18a957;
  color: #ffffff;
  font-size: 12px;
  flex: 0 0 auto;
}
.doc-source {
  margin-left: 27px;
  margin-top: 3px;
  color: #94a3b8;
  font-size: 12px;
}
.segment-pill {
  display: inline-flex;
  height: 26px;
  align-items: center;
  padding: 0 8px;
  border: 1px solid #dbe3ef;
  border-radius: 7px;
  color: #475569;
  background: #ffffff;
  font-size: 12px;
}
.doc-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #0f9f6e;
  font-weight: 600;
}
.doc-status::before {
  content: "";
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #31c48d;
  box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
}
.doc-status.review { color: #b7791f; }
.doc-status.review::before { background: #f6c453; }
.doc-status.suggested { color: #64748b; }
.doc-status.suggested::before { background: #cbd5e1; }
.doc-pagination {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  margin-top: 18px;
  padding: 18px 30px 0;
}
.doc-pagination > :last-child {
  justify-self: end;
}
.page-number {
  display: inline-flex;
  width: 40px;
  height: 40px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #f1f5f9;
  color: #1e293b;
}
.config-json {
  white-space: pre-wrap;
  background: #0f172a;
  color: #d1fae5;
  border-radius: 8px;
  padding: 14px;
  line-height: 1.55;
  font-size: 12px;
}
.muted { color: #64748b; margin-top: 12px; }
.ok { color: #15803d; }
.warn { color: #b45309; }
.knowledge-console .ant-card-head { border-bottom-color: rgba(15,23,42,0.08); min-height: 44px; }
.knowledge-console .ant-card-head-title { color: #0f172a; font-weight: 700; }
.knowledge-console .ant-list-item { border-block-end-color: rgba(15,23,42,0.07) !important; }
.knowledge-console .ant-tag { border-radius: 999px; margin-inline-end: 4px; }
.ant-drawer .ant-drawer-content { background: #f8fafc; }
.ant-drawer .ant-drawer-header,
.ant-drawer .ant-drawer-body { background: transparent; }
.ant-drawer .ant-card { border-radius: 8px; border-color: rgba(15,23,42,0.08); box-shadow: 0 8px 24px rgba(15,23,42,0.06); }
@media (max-width: 1100px) {
  .kb-home-layout { grid-template-columns: 1fr; }
  .kb-detail-panel { position: static; }
  .kb-overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .kb-home-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.kb-home-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  padding: 22px 24px;
  border: 1px solid rgba(15, 23, 42, 0.10);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
}
.kb-home-header h2 {
  margin: 8px 0 6px;
  color: #0f172a;
  font-size: 28px;
  line-height: 1.2;
}
.kb-home-header p {
  max-width: 760px;
  margin: 0;
  color: #64748b;
}
.kb-overview-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.kb-overview-grid div {
  padding: 16px;
  border: 1px solid rgba(15, 23, 42, 0.09);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
}
.kb-overview-grid b,
.kb-overview-grid span,
.kb-overview-grid small {
  display: block;
}
.kb-overview-grid b {
  color: #0f172a;
  font-size: 24px;
  line-height: 1;
}
.kb-overview-grid span {
  margin-top: 8px;
  color: #334155;
  font-weight: 700;
}
.kb-overview-grid small {
  margin-top: 4px;
  color: #94a3b8;
  line-height: 1.45;
}
.kb-home-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 16px;
  align-items: start;
}
.kb-list-panel,
.kb-detail-panel .ant-card {
  border: 1px solid rgba(15, 23, 42, 0.09);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
}
.kb-list-panel {
  padding: 16px;
}
.kb-list-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 14px;
}
.kb-list-toolbar h4 {
  margin: 0 0 4px;
  color: #0f172a;
}
.kb-toolbar-controls {
  display: grid;
  grid-template-columns: minmax(220px, 320px) auto;
  gap: 10px;
  align-items: center;
}
.kb-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.kb-row-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 10px;
  background: #fbfdff;
  cursor: pointer;
  transition: border-color .18s, box-shadow .18s, background .18s, transform .18s;
}
.kb-row-card:hover {
  border-color: rgba(21, 94, 239, 0.35);
  box-shadow: 0 12px 26px rgba(15, 23, 42, 0.08);
  transform: translateY(-1px);
}
.kb-row-card.active {
  border-color: rgba(15, 118, 110, 0.48);
  background: linear-gradient(180deg, #ffffff, #f0fdfa);
}
.kb-card-icon {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: #eef6ff;
  color: #155eef;
  font-size: 20px;
}
.kb-card-main {
  min-width: 0;
}
.kb-card-titleline {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}
.kb-card-titleline b {
  color: #0f172a;
  font-size: 16px;
}
.kb-row-card p {
  margin: 7px 0 8px;
  color: #64748b;
  line-height: 1.5;
}
.kb-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
  color: #64748b;
  font-size: 12px;
}
.kb-card-meta span::before {
  content: "";
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 6px;
  border-radius: 999px;
  background: #cbd5e1;
  vertical-align: 2px;
}
.kb-health {
  display: inline-flex;
  height: 26px;
  align-items: center;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}
.kb-health.good { background: #dcfce7; color: #15803d; }
.kb-health.warn { background: #fef3c7; color: #b45309; }
.kb-health.draft { background: #e2e8f0; color: #475569; }
.kb-card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.kb-detail-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: sticky;
  top: 84px;
}
.kb-detail-panel h4 {
  margin: 0 0 6px;
}
.kb-mini-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.kb-mini-stats div {
  padding: 10px;
  border: 1px solid rgba(15,23,42,0.08);
  border-radius: 8px;
  background: #f8fafc;
}
.kb-mini-stats b,
.kb-mini-stats span {
  display: block;
}
.kb-mini-stats b {
  color: #0f172a;
  font-size: 18px;
}
.kb-mini-stats span {
  color: #64748b;
  font-size: 12px;
}
.pipeline.compact {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.pipeline.compact div {
  padding: 8px;
}
.knowledge-head { grid-template-columns: 1fr; }
  .knowledge-head-panel { gap: 12px; }
  .head-actions { justify-content: flex-start; }
}
.chunk-preview-text {
  margin-bottom: 0 !important;
  color: #64748b;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}
@media (max-width: 900px) {
  .dify-topline, .dify-toolbar { grid-template-columns: 1fr; align-items: stretch; }
  .dify-search { width: 100%; }
  .dify-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 320px));
  gap: 14px;
  align-items: start;
}
`;