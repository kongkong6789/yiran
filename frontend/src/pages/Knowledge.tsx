import { useMemo, useState } from "react";
import type { UploadFile } from "antd";
import {
  App as AntApp,
  Badge,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  List,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Slider,
  Space,
  Statistic,
  Switch,
  Tabs,
  Tag,
  Timeline,
  Typography,
  Upload,
} from "antd";
import {
  ApiOutlined,
  AuditOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  ControlOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  EyeOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  GoldOutlined,
  LockOutlined,
  NodeIndexOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
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

function stateBadge(state: KnowledgeSource["state"]) {
  if (state === "ready") return <Badge status="success" text="可召回" />;
  if (state === "syncing") return <Badge status="processing" text="同步中" />;
  return <Badge status="warning" text="待复核" />;
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
  const [chunkSize, setChunkSize] = useState(900);
  const [topK, setTopK] = useState(8);
  const [selectedSources, setSelectedSources] = useState<string[]>(["policy", "graph", "crm"]);
  const [projectName, setProjectName] = useState("UNOVE 经营知识中台");
  const [objective, setObjective] = useState("把制度、业务图谱、经营指标和会议资料配置成可追问、可审计、可复用的企业知识应用。");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailTemplateId, setDetailTemplateId] = useState<string | null>(null);
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
  const selectedSourceObjects = sources.filter((item) => selectedSources.includes(item.id));
  const readiness = Math.round((selectedTemplate.readiness + selectedTemplate.evidenceCoverage + (requireCitation ? 8 : 0) + (selectedSources.length * 6) + (uploadFiles.length * 4)) / 3);

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
      <section className="knowledge-head">
        <div className="knowledge-head-copy">
          <span className="eyebrow">Knowledge Platform</span>
          <Title level={2}>企业知识中台配置</Title>
          <Paragraph>
            用方案模板组织资料、权限、检索策略和发布审核，把知识库从“文件夹”变成可治理的业务应用。
          </Paragraph>
          <div className="hero-badges">
            <span>模板驱动</span>
            <span>权限继承</span>
            <span>RAG / GraphRAG</span>
            <span>可审计发布</span>
          </div>
        </div>
        <div className="knowledge-head-panel">
          <div className="head-metrics">
            <div><b>{templates.length}</b><span>方案模板</span></div>
            <div><b>{selectedSourceObjects.length}</b><span>资料源</span></div>
            <div><b>{uploadFiles.length}</b><span>上传文件</span></div>
          </div>
          <Space wrap className="head-actions">
            <Button icon={<CloudUploadOutlined />} onClick={() => setUploadOpen(true)}>接入资料</Button>
            <Button icon={<PlayCircleOutlined />} onClick={() => setDrawerOpen(true)}>配置草案</Button>
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => message.success("配置已保存为本地草案")}>保存</Button>
          </Space>
        </div>
      </section>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Tabs
            defaultActiveKey="templates"
            items={[
              {
                key: "templates",
                label: <span><GoldOutlined /> 方案模板</span>,
                children: (
                  <div className="template-workspace">
                    <div className="template-toolbar">
                      <Input prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客户、制度、客服、图谱、指标..." />
                      <Segmented value={category} onChange={(value) => setCategory(String(value))} options={categories} />
                    </div>
                    <div className="custom-file-entry">
                      <div>
                        <Text strong>自定义资料包</Text>
                        <Paragraph className="muted">没有合适模板时，先上传自己的知识文件，系统会沿用当前检索、权限和审核策略生成入库草案。</Paragraph>
                        {uploadFiles.length ? <Text type="secondary">已选择 {uploadFiles.length} 个文件：{uploadFiles.slice(0, 3).map((file) => file.name).join("、")}{uploadFiles.length > 3 ? "..." : ""}</Text> : <Text type="secondary">还没有选择自定义文件</Text>}
                      </div>
                      <Space wrap>
                        <Button icon={<GoldOutlined />} onClick={() => applyTemplate("blank")}>使用空白模板</Button>
                        <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => setUploadOpen(true)}>选择自定义文件</Button>
                      </Space>
                    </div>
                    <div className="template-grid">
                      {visibleTemplates.map((template) => (
                        <article
                          key={template.id}
                          className={`template-card ${template.id === selectedTemplate.id ? "active" : ""}`}
                          onClick={() => applyTemplate(template.id)}
                          onDoubleClick={() => setDetailTemplateId(template.id)}
                          title="单击选用，双击查看详情"
                        >
                          <span className="template-card-head">
                            <Tag color={kindColor(template.kind)}>{template.category}</Tag>
                            <Text type="secondary">{template.owner}</Text>
                          </span>
                          <b>{template.name}</b>
                          <small>{template.headline}</small>
                          <span className="template-tags">
                            {template.outputs.slice(0, 3).map((item) => <Tag key={item}>{item}</Tag>)}
                          </span>
                          <Text type="secondary" className="template-open-hint">双击查看详情和文件</Text>
                        </article>
                      ))}
                    </div>
                    {visibleTemplates.length === 0 ? <Empty description="没有匹配的方案模板" /> : null}
                  </div>
                ),
              },
              {
                key: "scope",
                label: <span><FolderOpenOutlined /> 知识范围</span>,
                children: (
                  <div className="config-section">
                    <Row gutter={[16, 16]}>
                      <Col xs={24} md={12}>
                        <Form layout="vertical">
                          <Form.Item label="应用名称">
                            <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
                          </Form.Item>
                          <Form.Item label="业务目标">
                            <Input.TextArea rows={4} value={objective} onChange={(event) => setObjective(event.target.value)} />
                          </Form.Item>
                          <Form.Item label="发布范围">
                            <Segmented value={visibility} onChange={(value) => setVisibility(value as Visibility)} options={[{ label: "个人", value: "private" }, { label: "团队", value: "team" }, { label: "公司", value: "company" }]} />
                          </Form.Item>
                        </Form>
                      </Col>
                      <Col xs={24} md={12}>
                        <List
                          className="source-list"
                          dataSource={sources}
                          renderItem={(source) => (
                            <List.Item
                              actions={[<Switch key="select" checked={selectedSources.includes(source.id)} onChange={(checked) => setSelectedSources((prev) => checked ? [...prev, source.id] : prev.filter((id) => id !== source.id))} />]}
                            >
                              <List.Item.Meta
                                avatar={<DatabaseOutlined />}
                                title={<Space><span>{source.name}</span>{stateBadge(source.state)}</Space>}
                                description={`${source.type} / ${visibilityLabels[source.scope]} / ${source.records.toLocaleString()} 条 / ${source.freshness}`}
                              />
                            </List.Item>
                          )}
                        />
                      </Col>
                    </Row>
                  </div>
                ),
              },
              {
                key: "strategy",
                label: <span><ControlOutlined /> 检索策略</span>,
                children: (
                  <div className="config-section strategy-grid">
                    <Card title="召回引擎" extra={<ApiOutlined />}>
                      <Select value={engine} onChange={setEngine} style={{ width: "100%" }} options={Object.entries(engineLabels).map(([value, label]) => ({ value, label }))} />
                      <div className="switch-row"><span>回答必须带引用</span><Switch checked={requireCitation} onChange={setRequireCitation} /></div>
                      <div className="switch-row"><span>抽取实体关系</span><Switch checked={extractGraph} onChange={setExtractGraph} /></div>
                    </Card>
                    <Card title="切块与召回" extra={<FileSearchOutlined />}>
                      <Text>Chunk Size: {chunkSize}</Text>
                      <Slider min={300} max={1600} step={100} value={chunkSize} onChange={(value) => setChunkSize(Number(value))} />
                      <Text>Top K: {topK}</Text>
                      <Slider min={3} max={20} value={topK} onChange={(value) => setTopK(Number(value))} />
                    </Card>
                    <Card title="推荐处理链路" extra={<BranchesOutlined />}>
                      <Timeline
                        items={["资料解析", "权限标注", "切块入库", extractGraph ? "实体关系抽取" : "跳过图谱抽取", "向量召回", requireCitation ? "引用校验" : "摘要生成"].map((step) => ({ children: step }))}
                      />
                    </Card>
                  </div>
                ),
              },
              {
                key: "governance",
                label: <span><SafetyCertificateOutlined /> 权限与审核</span>,
                children: (
                  <div className="config-section governance-grid">
                    <Card title="发布治理" extra={<AuditOutlined />}>
                      <Form layout="vertical">
                        <Form.Item label="审核策略">
                          <Select value={reviewPolicy} onChange={setReviewPolicy} options={Object.entries(reviewLabels).map(([value, label]) => ({ value, label }))} />
                        </Form.Item>
                        <Form.Item label="负责人">
                          <Input value={selectedTemplate.owner} readOnly />
                        </Form.Item>
                      </Form>
                    </Card>
                    <Card title="发布门禁" extra={<LockOutlined />}>
                      <List
                        dataSource={[
                          { label: "公司级发布", ok: visibility !== "company" || reviewPolicy === "required" },
                          { label: "证据引用", ok: requireCitation || selectedTemplate.kind === "compiled" },
                          { label: "来源可见性", ok: selectedSourceObjects.length > 0 },
                          { label: "审计留痕", ok: true },
                        ]}
                        renderItem={(item) => <List.Item><Space><CheckCircleOutlined className={item.ok ? "ok" : "warn"} />{item.label}</Space></List.Item>}
                      />
                    </Card>
                  </div>
                ),
              },
              {
                key: "eval",
                label: <span><DeploymentUnitOutlined /> 评测发布</span>,
                children: (
                  <div className="config-section eval-grid">
                    <Card title="样例问题">
                      <Input.TextArea rows={3} value={selectedTemplate.sampleQuestion} readOnly />
                    </Card>
                    <Card title="发布检查">
                      <Progress percent={Math.min(100, readiness)} status={readiness >= 85 ? "success" : "active"} />
                      <Paragraph className="muted">综合模板成熟度、证据覆盖、资料接入和治理策略生成。达到 85 分建议进入团队试运行。</Paragraph>
                    </Card>
                  </div>
                ),
              },
            ]}
          />
        </Col>

        <Col xs={24} xl={8}>
          <div className="preview-stack">
            <Card title="当前知识应用" extra={<SettingOutlined />}>
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                <div>
                  <Text type="secondary">模板</Text>
                  <Title level={4}>{selectedTemplate.name}</Title>
                  <Paragraph>{selectedTemplate.headline}</Paragraph>
                </div>
                <Flex gap={8} wrap="wrap">
                  <Tag color="blue">{engineLabels[engine]}</Tag>
                  <Tag color="green">{visibilityLabels[visibility]}</Tag>
                  <Tag color="gold">{reviewLabels[reviewPolicy]}</Tag>
                  {requireCitation ? <Tag>引用必需</Tag> : null}
                  {extractGraph ? <Tag>图谱抽取</Tag> : null}
                </Flex>
              </Space>
            </Card>

            <Row gutter={[12, 12]}>
              <Col span={8}><Card><Statistic title="资料源" value={selectedSourceObjects.length} /></Card></Col>
              <Col span={8}><Card><Statistic title="上传" value={uploadFiles.length} /></Card></Col>
              <Col span={8}><Card><Statistic title="就绪" value={Math.min(100, readiness)} suffix="%" /></Card></Col>
            </Row>

            <Card title="召回链路" extra={<NodeIndexOutlined />}>
              <div className="pipeline">
                {["上传/同步", "解析切块", "向量化", extractGraph ? "图谱抽取" : "权限标注", "检索重排", "答案引用"].map((step, index) => (
                  <div key={step}>
                    <i>{index + 1}</i>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="输出能力" extra={<ThunderboltOutlined />}>
              <Space wrap>{selectedTemplate.outputs.map((item) => <Tag key={item}>{item}</Tag>)}</Space>
              <Paragraph className="muted">限制：{selectedTemplate.limitations.join(" ")}</Paragraph>
            </Card>
          </div>
        </Col>
      </Row>

      <Drawer title={detailTemplate?.name || "方案模板详情"} width={720} open={Boolean(detailTemplate)} onClose={() => setDetailTemplateId(null)} extra={detailTemplate ? <Button type="primary" onClick={() => { applyTemplate(detailTemplate.id); setDetailTemplateId(null); }}>选用这个模板</Button> : null}>
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
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: #172033;
}
.knowledge-console::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(14, 116, 144, 0.08), rgba(255,255,255,0) 32%),
    linear-gradient(90deg, rgba(245, 158, 11, 0.08), rgba(255,255,255,0) 42%);
  z-index: 0;
}
.knowledge-console > * { position: relative; z-index: 1; }
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
  .knowledge-head { grid-template-columns: 1fr; }
  .knowledge-head-panel { gap: 12px; }
  .head-actions { justify-content: flex-start; }
}
@media (max-width: 900px) {
  .custom-file-entry { flex-direction: column; align-items: stretch; }
  .template-toolbar { grid-template-columns: 1fr; }
  .preview-stack { position: static; }
  .head-metrics { grid-template-columns: 1fr; }
}
`;