import { useMemo, useState } from "react";
import type { UploadFile } from "antd";
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Popconfirm,
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
  NodeIndexOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  SettingOutlined,
  SortAscendingOutlined,
} from "@ant-design/icons";

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

type TemplateKind = "compiled" | "evidence" | "graph" | "hybrid" | "custom";
type Visibility = "private" | "team" | "company";
type Engine = "naive-rag" | "graph-rag" | "hybrid-rag";
type ReviewPolicy = "none" | "sample" | "required";

type KnowledgeTemplateFile = { name: string; kind: string; source: string; status: "ready" | "suggested" | "review"; chunks: number; };

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

export default function Knowledge() {
  const { message } = AntApp.useApp();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
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
  const [detailTemplateId, setDetailTemplateId] = useState<string | null>(null);
  const [detailSearch, setDetailSearch] = useState("");
  const [detailTypeFilter, setDetailTypeFilter] = useState("全部");
  const [detailPageSize, setDetailPageSize] = useState(10);
  const [processedFile, setProcessedFile] = useState<KnowledgeTemplateFile | null>(null);
  const [deletedTemplateFiles, setDeletedTemplateFiles] = useState<Record<string, string[]>>({});
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [uploadPurpose, setUploadPurpose] = useState("作为当前知识应用的补充资料，进入解析、切块、向量化和权限标注流程。");

  const categories = useMemo(() => ["全部", ...Array.from(new Set(templates.map((item) => item.category)))], []);
  const visibleTemplates = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return templates.filter((item) => {
      const categoryOk = category === "全部" || item.category === category;
      const queryOk = !keyword || `${item.name} ${item.headline} ${item.bestFor.join(" ")} ${item.outputs.join(" ")}`.toLowerCase().includes(keyword);
      return categoryOk && queryOk;
    });
  }, [category, query]);
  const selectedTemplate = templates.find((item) => item.id === templateId) ?? templates[0];
  const detailTemplate = templates.find((item) => item.id === detailTemplateId) ?? null;
  const detailUploadedFiles: KnowledgeTemplateFile[] = detailTemplate?.id === selectedTemplate.id
    ? uploadFiles.map((file) => ({ name: file.name, kind: "用户上传", source: uploadPurpose, status: "review" as const, chunks: 0 }))
    : [];
  const deletedNames = detailTemplate ? deletedTemplateFiles[detailTemplate.id] ?? [] : [];
  const detailFiles: KnowledgeTemplateFile[] = detailTemplate
    ? [...(templateFileDetails[detailTemplate.id] ?? []).filter((file) => !deletedNames.includes(file.name)), ...detailUploadedFiles]
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
  const detailTotalChars = filteredDetailFiles.reduce((sum, file) => sum + Math.max(file.chunks, 1) * 58, 0);
  const detailReadyCount = filteredDetailFiles.filter((file) => file.status === "ready").length;
  const selectedSourceObjects = sources.filter((item) => selectedSources.includes(item.id));

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
    const next = templates.find((item) => item.id === nextId) ?? templates[0];
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

  function removeKnowledgeFile(file: KnowledgeTemplateFile) {
    const isUploaded = uploadFiles.some((item) => item.name === file.name);
    if (isUploaded) {
      setUploadFiles((prev) => prev.filter((item) => item.name !== file.name));
      message.success("已从当前知识库配置中移除上传文件");
      return;
    }
    if (!detailTemplate) return;
    setDeletedTemplateFiles((prev) => ({
      ...prev,
      [detailTemplate.id]: [...(prev[detailTemplate.id] ?? []), file.name],
    }));
    if (processedFile?.name === file.name) setProcessedFile(null);
    message.success("已从当前知识库配置中移除该文件");
  }
  return (
    <div className="knowledge-console">
      <style>{styles}</style>
      {detailTemplate ? (
        <section className="knowledge-doc-window">
          <div className="doc-window-topbar">
            <Button icon={<ArrowLeftOutlined />} onClick={() => setDetailTemplateId(null)}>返回知识库配置</Button>
            <Space wrap>
              <Tag color={kindColor(detailTemplate.kind)}>{detailTemplate.category}</Tag>
              <Tag>{engineLabels[detailTemplate.strategy]}</Tag>
              <Tag>{visibilityLabels[detailTemplate.visibility]}</Tag>
              <Button type="primary" onClick={() => { applyTemplate(detailTemplate.id); message.success("已选用该知识库模板"); }}>选用这个模板</Button>
            </Space>
          </div>

          <div className="doc-window-header">
            <div>
              <Title level={3}>文档</Title>
              <Paragraph>
                {detailTemplate.name} 的所有文件都在这里显示，整个知识库都可以链接到 Dify 引用或通过 Chat 插件进行索引。
                <a onClick={() => message.info("后续可跳转到知识库索引说明文档")}> 了解更多↗</a>
              </Paragraph>
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
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setUploadOpen(true)}>添加文件</Button>
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
                  const statusText = file.status === "ready" ? "可用" : file.status === "review" ? "待复核" : "待接入";
                  const chars = Math.max(file.chunks, 1) * 58;
                  const recallCount = file.status === "ready" ? index * 3 : 0;
                  return (
                    <tr key={`${file.name}-${index}`}>
                      <td className="check-col"><input type="checkbox" aria-label={`选择 ${file.name}`} /></td>
                      <td className="index-col">{index + 1}</td>
                      <td>
                        <button className="doc-name" onClick={() => setProcessedFile(file)}>
                          <span className="file-type-icon"><FileExcelOutlined /></span>
                          <span>{file.name}</span>
                        </button>
                        <div className="doc-source">{file.source}</div>
                      </td>
                      <td><span className="segment-pill">通用</span></td>
                      <td>{chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : chars}</td>
                      <td>{recallCount}</td>
                      <td>2026-07-16 14:{String(22 + index).padStart(2, "0")}</td>
                      <td><span className={`doc-status ${file.status}`}>{statusText}</span></td>
                      <td>
                        <Space size={10}>
                          <Switch size="small" checked={file.status !== "suggested"} />
                          <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => setProcessedFile(file)} />
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
              <label className="all-kb-check">
                <input type="checkbox" />
                <span>所有知识库</span>
                <small>?</small>
              </label>
              <span className="toolbar-spacer" />
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { applyTemplate("blank"); setUploadOpen(true); }}>创建</Button>
            </div>

            <div className="dify-card-grid">
              {visibleTemplates.map((template) => {
                const templateFiles = templateFileDetails[template.id] ?? [];
                const fileCount = templateFiles.length + (template.id === selectedTemplate.id ? uploadFiles.length : 0);
                const appCount = template.kind === "hybrid" ? 1 : 0;
                const updatedMinutes = 18 + Math.max(0, templates.findIndex((item) => item.id === template.id)) * 4;
                return (
                  <article
                    key={template.id}
                    className={`dify-kb-card ${template.id === selectedTemplate.id ? "active" : ""}`}
                    onClick={() => applyTemplate(template.id)}
                    onDoubleClick={() => setDetailTemplateId(template.id)}
                    title="双击打开知识库文档"
                  >
                    <div className="dify-card-mainrow">
                      <div className="dify-kb-icon"><DatabaseOutlined /></div>
                      <div className="dify-title-block">
                        <h3>{template.name}</h3>
                        <div className="dify-subline">
                          <span>通用</span>
                          <span>经济 · 倒排索引</span>
                        </div>
                      </div>
                    </div>
                    <p className="dify-desc">useful for when you want to answer queries about the {template.name} knowledge base</p>
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

      <Drawer title={detailTemplate?.name || "方案模板详情"} width={720} open={false} onClose={() => setDetailTemplateId(null)} extra={detailTemplate ? <Button type="primary" onClick={() => { applyTemplate(detailTemplate.id); setDetailTemplateId(null); }}>选用这个模板</Button> : null}>
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
                      <Button key="view" size="small" icon={<EyeOutlined />} onClick={() => setProcessedFile(file)}>处理详情</Button>,
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
            <Card title="示例切片预览">
              <List
                size="small"
                dataSource={[
                  { title: "chunk_001", text: `${processedFile.name} 的核心主题、对象和业务上下文。` },
                  { title: "chunk_002", text: `来源 ${processedFile.source} 中可用于问答引用的证据片段。` },
                  { title: "chunk_003", text: extractGraph ? "可抽取实体、关系、时间和指标口径。" : "当前仅进入文档证据召回。" },
                ]}
                renderItem={(chunk) => (
                  <List.Item>
                    <List.Item.Meta title={chunk.title} description={chunk.text} />
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
      <Drawer title="接入知识文件" width={680} open={uploadOpen} onClose={() => setUploadOpen(false)} extra={<Button type="primary" onClick={() => { setUploadOpen(false); message.success(`已加入 ${uploadFiles.length} 个待入库文件`); }}>加入当前配置</Button>}>
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
            <p className="ant-upload-hint">支持 PDF、Word、Markdown、TXT、表格、JSON、HTML、PPT。当前会先加入配置草案，不会自动上传到服务器。</p>
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
.dify-kb-card.active {
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