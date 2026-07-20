import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AutoComplete,
  Avatar,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Progress,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import {
  ApartmentOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  createAgent,
  deleteAgent,
  listAgents,
  updateAgent,
  type Agent,
} from "../api/client";

const { Paragraph, Text, Title } = Typography;

const EMOJI_CHOICES = ["🤖", "📈", "🧩", "💰", "🎯", "🧠", "⚙️", "🎨", "📊", "🛡️", "🚀", "🔬"];

const SKILL_OPTIONS = [
  { value: "data-analysis", label: "数据分析与可视化" },
  { value: "daily-report", label: "经营日报生成" },
  { value: "market-insight", label: "市场洞察" },
  { value: "finance-reconcile", label: "财务对账" },
  { value: "risk-approval", label: "风险审批" },
  { value: "knowledge-summary", label: "知识检索与总结" },
];

const KNOWLEDGE_BASE_OPTIONS = [
  { value: "company-policy", label: "公司制度与流程" },
  { value: "product-inventory", label: "商品与库存知识库" },
  { value: "finance-budget", label: "财务制度与预算" },
  { value: "market-competitor", label: "市场与竞品资料" },
  { value: "operations-sop", label: "运营 SOP 知识库" },
  { value: "general-enterprise", label: "通用企业知识库" },
];

interface AgentMockBindings {
  skill_ids?: string[];
  knowledge_base_ids?: string[];
}

const MOCK_BINDINGS_BY_AGENT_NAME: Record<string, Required<AgentMockBindings>> = {
  通用智能体: {
    skill_ids: ["knowledge-summary"],
    knowledge_base_ids: ["general-enterprise", "company-policy"],
  },
  数据分析智能体: {
    skill_ids: ["data-analysis", "knowledge-summary"],
    knowledge_base_ids: ["general-enterprise"],
  },
  市场智能体: {
    skill_ids: ["market-insight", "daily-report"],
    knowledge_base_ids: ["market-competitor"],
  },
  财务智能体: {
    skill_ids: ["finance-reconcile", "risk-approval"],
    knowledge_base_ids: ["finance-budget", "company-policy"],
  },
  运营智能体: {
    skill_ids: ["daily-report", "data-analysis"],
    knowledge_base_ids: ["operations-sop", "product-inventory"],
  },
};

const EMPTY_MOCK_BINDINGS: Required<AgentMockBindings> = {
  skill_ids: [],
  knowledge_base_ids: [],
};

type AgentFormValues = Pick<
  Agent,
  "name" | "group" | "role" | "expertise" | "persona" | "execution_role" | "quota_limit" | "is_active"
> & AgentMockBindings;

type AgentStatusFilter = "all" | Agent["status"];
type AgentSort = "recent" | "name" | "quota";

const STATUS_META: Record<Agent["status"], { label: string; color: string; icon: React.ReactNode }> = {
  available: { label: "任务可用", color: "success", icon: <CheckCircleOutlined /> },
  disabled: { label: "已停用", color: "default", icon: <StopOutlined /> },
  quota_exhausted: { label: "额度已用尽", color: "error", icon: <WarningOutlined /> },
};

const ROLE_LABEL: Record<Agent["execution_role"], string> = {
  operator: "操作员",
  manager: "主管",
  director: "总监",
};

const formatQuota = (value: number) => {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (safeValue >= 10_000 && safeValue % 10_000 === 0) return `${safeValue / 10_000} 万`;
  return safeValue.toLocaleString("zh-CN");
};

const quotaPercent = (agent: Agent) => {
  if (agent.quota_limit <= 0) return agent.quota_used > 0 ? 100 : 0;
  return Math.min(100, Math.round((agent.quota_used / agent.quota_limit) * 100));
};

const errorText = (error: unknown, fallback: string) => {
  if (typeof error === "object" && error) {
    const response = (error as { response?: { data?: { detail?: string; error?: string } } }).response;
    return response?.data?.detail || response?.data?.error || fallback;
  }
  return fallback;
};

interface AgentFormDrawerProps {
  open: boolean;
  editing: Agent | null;
  mockBindings: Required<AgentMockBindings>;
  groupOptions: { value: string }[];
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: AgentFormValues, emoji: string) => Promise<void>;
}

function AgentFormDrawer({
  open,
  editing,
  mockBindings,
  groupOptions,
  submitting,
  onClose,
  onSubmit,
}: AgentFormDrawerProps) {
  const [form] = Form.useForm<AgentFormValues>();
  const [emoji, setEmoji] = useState("🤖");

  const syncForm = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({
      name: editing?.name || "",
      group: editing?.group || "",
      role: editing?.role || "",
      expertise: editing?.expertise || "",
      persona: editing?.persona || "",
      skill_ids: [...mockBindings.skill_ids],
      knowledge_base_ids: [...mockBindings.knowledge_base_ids],
      execution_role: editing?.execution_role || "operator",
      quota_limit: editing?.quota_limit ?? 10_000,
      is_active: editing?.is_active ?? true,
    });
    setEmoji(editing?.emoji || "🤖");
  }, [editing, form, mockBindings]);

  const submit = async () => {
    const values = await form.validateFields();
    await onSubmit(values, emoji);
  };

  useEffect(() => {
    if (open) syncForm();
  }, [open, syncForm]);

  return (
    <Drawer
      className="agents-form-drawer"
      title={editing ? `编辑智能体 · ${editing.name}` : "新建智能体"}
      open={open}
      width="min(720px, 100vw)"
      zIndex={1200}
      forceRender
      maskClosable={!submitting}
      keyboard={!submitting}
      onClose={onClose}
      footer={(
        <div className="agents-form-drawer__footer">
          <Button onClick={onClose} disabled={submitting}>取消</Button>
          <Button type="primary" onClick={submit} loading={submitting}>
            {editing ? "保存修改" : "创建智能体"}
          </Button>
        </div>
      )}
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <div className="agents-form-section">
          <div className="agents-form-section__head">
            <Text strong>身份信息</Text>
            <Text type="secondary">用于列表、会议和任务选择时识别智能体</Text>
          </div>
          <Form.Item label="头像">
            <Space wrap size={[8, 8]}>
              {EMOJI_CHOICES.map((choice) => (
                <Button
                  key={choice}
                  className="agents-emoji-button"
                  shape="circle"
                  type={emoji === choice ? "primary" : "default"}
                  aria-label={`选择头像 ${choice}`}
                  aria-pressed={emoji === choice}
                  onClick={() => setEmoji(choice)}
                >
                  {choice}
                </Button>
              ))}
            </Space>
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item
                name="name"
                label="名称"
                rules={[
                  { required: true, message: "请输入名称" },
                  { max: 64, message: "名称不能超过 64 个字符" },
                ]}
              >
                <Input placeholder="如：增长官 / 产品官 / 财务官" autoFocus />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="group" label="分类">
                <AutoComplete
                  options={groupOptions}
                  placeholder="选择已有分类或输入新分类"
                  filterOption={(input, option) =>
                    String(option?.value ?? "").toLowerCase().includes(input.toLowerCase())
                  }
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="role" label="角色 / 人设">
                <Input placeholder="如：增长专家、谨慎的财务负责人" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="expertise" label="专长">
                <Input placeholder="如：用户增长、财务风控" />
              </Form.Item>
            </Col>
          </Row>
          <div className="agents-form-demo-note">
            <Tag color="gold">演示数据</Tag>
            <Text type="secondary">Skill 与知识库绑定仅保留在本次页面会话，暂不写入后端。</Text>
          </div>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="skill_ids" label="Skill">
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  maxTagCount="responsive"
                  options={SKILL_OPTIONS}
                  placeholder="选择一个或多个 Skill"
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="knowledge_base_ids" label="知识库">
                <Select
                  mode="multiple"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  maxTagCount="responsive"
                  options={KNOWLEDGE_BASE_OPTIONS}
                  placeholder="选择一个或多个知识库"
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="persona" label="人设描述" extra="作为智能体的系统提示，描述立场、说话风格和关注点。">
            <Input.TextArea rows={4} maxLength={2_000} showCount placeholder="描述该智能体如何思考和表达" />
          </Form.Item>
        </div>

        <div className="agents-form-section">
          <div className="agents-form-section__head">
            <Text strong>执行控制</Text>
            <Text type="secondary">权限等级与额度分别配置，避免将风险边界和预算混为一体</Text>
          </div>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="execution_role" label="任务执行权限" rules={[{ required: true }]}>
                <Select options={[
                  { value: "operator", label: "操作员 · 低风险执行" },
                  { value: "manager", label: "主管 · 中风险执行" },
                  { value: "director", label: "总监 · 高风险审批" },
                ]} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="quota_limit"
                label="任务额度上限"
                rules={[{ required: true, message: "请输入额度上限" }]}
              >
                <InputNumber min={0} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="is_active" label="允许用于任务执行" valuePropName="checked">
            <Switch checkedChildren="已启用" unCheckedChildren="已停用" />
          </Form.Item>
        </div>
      </Form>
    </Drawer>
  );
}

function AgentCard({
  agent,
  deleting,
  toggling,
  onEdit,
  onDelete,
  onToggleAvailability,
}: {
  agent: Agent;
  deleting: boolean;
  toggling: boolean;
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  onToggleAvailability: (agent: Agent, active: boolean) => void;
}) {
  const status = STATUS_META[agent.status];
  const percent = quotaPercent(agent);
  const quotaWarning = agent.quota_limit > 0 && agent.quota_remaining / agent.quota_limit <= 0.2;

  return (
    <Card className="agents-card" hoverable>
      <div className="agents-card__top">
        <Avatar size={48} className="agents-card__avatar">{agent.emoji}</Avatar>
        <div className="agents-card__identity">
          <Space size={8} wrap>
            <Title level={5}>{agent.name}</Title>
            <Tag color={status.color} icon={status.icon}>{status.label}</Tag>
          </Space>
          <Text type="secondary">{agent.role || "尚未填写角色"}</Text>
        </div>
        <Switch
          className="agents-card__availability"
          checked={agent.is_active}
          checkedChildren="已启用"
          unCheckedChildren="已停用"
          loading={toggling}
          disabled={deleting}
          aria-label={`${agent.is_active ? "停用" : "启用"} ${agent.name}`}
          onChange={(active) => onToggleAvailability(agent, active)}
        />
      </div>

      <Paragraph className="agents-card__description" ellipsis={{ rows: 2 }}>
        {agent.expertise || agent.persona || "尚未填写能力说明"}
      </Paragraph>

      <Space wrap size={[6, 6]} className="agents-card__tags">
        <Tag>{agent.group || "未分类"}</Tag>
        <Tag color="blue">{ROLE_LABEL[agent.execution_role] || agent.execution_role}</Tag>
      </Space>

      <div className="agents-card__quota">
        <div className="agents-card__quota-head">
          <Text type="secondary">任务额度</Text>
          <Text className={quotaWarning ? "is-warning" : ""}>
            {formatQuota(agent.quota_used)} / {formatQuota(agent.quota_limit)}
          </Text>
        </div>
        <Progress
          percent={percent}
          showInfo={false}
          size="small"
          status={agent.status === "quota_exhausted" ? "exception" : "normal"}
          strokeColor={quotaWarning ? "#d48806" : undefined}
        />
        <Text type="secondary" className="agents-card__remaining">
          剩余 {formatQuota(agent.quota_remaining)}
        </Text>
      </div>

      <div className="agents-card__actions">
        <Button
          type="text"
          icon={<EditOutlined />}
          aria-label={`编辑 ${agent.name}`}
          onClick={() => onEdit(agent)}
        >
          编辑
        </Button>
        <Popconfirm
          title={`删除“${agent.name}”？`}
          description="删除后无法恢复，请确认该智能体不再用于任务或会议。"
          okText="确认删除"
          cancelText="取消"
          okButtonProps={{ danger: true, loading: deleting }}
          onConfirm={() => onDelete(agent)}
        >
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            loading={deleting}
            aria-label={`删除 ${agent.name}`}
          >
            删除
          </Button>
        </Popconfirm>
      </div>
    </Card>
  );
}

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [mockBindingsByAgentId, setMockBindingsByAgentId] = useState<Record<number, Required<AgentMockBindings>>>({});
  const [llm, setLlm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<AgentStatusFilter>("all");
  const [sort, setSort] = useState<AgentSort>("recent");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAgents();
      setAgents(data.results);
      setLlm(data.llm);
    } catch (error) {
      message.error(errorText(error, "智能体列表加载失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () => Array.from(new Set(agents.map((agent) => agent.group || "未分类"))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [agents],
  );

  const groupOptions = useMemo(() => groups.map((group) => ({ value: group })), [groups]);

  const activeMockBindings = useMemo(() => {
    if (!editing) return EMPTY_MOCK_BINDINGS;
    return mockBindingsByAgentId[editing.id]
      || MOCK_BINDINGS_BY_AGENT_NAME[editing.name]
      || EMPTY_MOCK_BINDINGS;
  }, [editing, mockBindingsByAgentId]);

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = agents.filter((agent) => {
      const matchesQuery = !normalizedQuery || [
        agent.name,
        agent.group,
        agent.role,
        agent.expertise,
        agent.persona,
      ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
      const matchesGroup = groupFilter === "all" || (agent.group || "未分类") === groupFilter;
      const matchesStatus = statusFilter === "all" || agent.status === statusFilter;
      return matchesQuery && matchesGroup && matchesStatus;
    });

    return [...result].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "zh-CN");
      if (sort === "quota") return a.quota_remaining - b.quota_remaining;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [agents, groupFilter, query, sort, statusFilter]);

  const groupedAgents = useMemo(() => {
    const map = new Map<string, Agent[]>();
    filteredAgents.forEach((agent) => {
      const group = agent.group || "未分类";
      map.set(group, [...(map.get(group) || []), agent]);
    });
    return Array.from(map.entries());
  }, [filteredAgents]);

  const availableCount = agents.filter((agent) => agent.status === "available").length;
  const disabledCount = agents.filter((agent) => agent.status === "disabled").length;
  const quotaAlertCount = agents.filter((agent) =>
    agent.quota_limit > 0 && agent.quota_remaining / agent.quota_limit <= 0.2,
  ).length;

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (agent: Agent) => {
    setEditing(agent);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (submitting) return;
    setDrawerOpen(false);
    setEditing(null);
  };

  const saveAgent = async (values: AgentFormValues, emoji: string) => {
    setSubmitting(true);
    try {
      const {
        skill_ids: skillIds = [],
        knowledge_base_ids: knowledgeBaseIds = [],
        ...persistedValues
      } = values;
      const nextMockBindings: Required<AgentMockBindings> = {
        skill_ids: skillIds,
        knowledge_base_ids: knowledgeBaseIds,
      };

      if (editing) {
        await updateAgent(editing.id, { ...persistedValues, emoji });
        setMockBindingsByAgentId((current) => ({
          ...current,
          [editing.id]: nextMockBindings,
        }));
        message.success("智能体已更新");
      } else {
        const created = await createAgent({ ...persistedValues, emoji });
        setMockBindingsByAgentId((current) => ({
          ...current,
          [created.id]: nextMockBindings,
        }));
        message.success("智能体已创建");
      }
      setDrawerOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      message.error(errorText(error, editing ? "保存失败，请检查后重试" : "创建失败，请检查后重试"));
    } finally {
      setSubmitting(false);
    }
  };

  const removeAgent = async (agent: Agent) => {
    setDeletingId(agent.id);
    try {
      await deleteAgent(agent.id);
      message.success(`已删除“${agent.name}”`);
      await load();
    } catch (error) {
      message.error(errorText(error, "删除失败，该智能体可能仍被任务或会议引用"));
    } finally {
      setDeletingId(null);
    }
  };

  const toggleAgentAvailability = async (agent: Agent, active: boolean) => {
    setTogglingId(agent.id);
    try {
      await updateAgent(agent.id, { is_active: active });
      setAgents((current) => current.map((row) => {
        if (row.id !== agent.id) return row;
        const status: Agent["status"] = !active
          ? "disabled"
          : row.quota_remaining <= 0
            ? "quota_exhausted"
            : "available";
        return { ...row, is_active: active, status };
      }));
      message.success(`“${agent.name}”已${active ? "启用" : "停用"}`);
    } catch (error) {
      message.error(errorText(error, `${active ? "启用" : "停用"}失败，请稍后重试`));
    } finally {
      setTogglingId(null);
    }
  };

  const hasFilters = Boolean(query.trim()) || groupFilter !== "all" || statusFilter !== "all";

  return (
    <div className="agents-page">
      <header className="agents-page__header page-hero-head">
        <div>
          <div className="page-hero-kicker"><ApartmentOutlined /> Agent Assets</div>
          <Title level={3} className="page-hero-title">智能体</Title>
          <Paragraph className="page-hero-desc" type="secondary">
            管理用于对话、圆桌会议和业务流程的 AI 执行角色，统一查看可用状态与任务额度。
          </Paragraph>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建智能体</Button>
        </Space>
      </header>

      {!llm && !loading && (
        <Alert
          className="agents-page__alert"
          type="warning"
          showIcon
          message="当前未配置 LLM，圆桌会议将使用智能模拟发言。"
          description="配置后可启用真实对话；智能体资料与任务执行权限仍可正常管理。"
        />
      )}

      <Row gutter={[12, 12]} className="agents-stats">
        <Col xs={12} md={6}>
          <Card><Statistic title="智能体总数" value={agents.length} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="任务可用" value={availableCount} valueStyle={{ color: "#389e0d" }} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="已停用" value={disabledCount} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="额度需关注" value={quotaAlertCount} valueStyle={quotaAlertCount ? { color: "#d48806" } : undefined} /></Card>
        </Col>
      </Row>

      <Card className="agents-catalog" title={`智能体目录 · ${filteredAgents.length} 个结果`}>
        <div className="agents-toolbar">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索名称、角色、专长或人设"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            value={groupFilter}
            onChange={setGroupFilter}
            options={[{ value: "all", label: "全部分类" }, ...groups.map((group) => ({ value: group, label: group }))]}
            aria-label="按分类筛选"
          />
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "全部状态" },
              { value: "available", label: "任务可用" },
              { value: "disabled", label: "已停用" },
              { value: "quota_exhausted", label: "额度已用尽" },
            ]}
            aria-label="按状态筛选"
          />
          <Select
            value={sort}
            onChange={setSort}
            options={[
              { value: "recent", label: "最近创建" },
              { value: "name", label: "按名称" },
              { value: "quota", label: "额度从低到高" },
            ]}
            aria-label="智能体排序"
          />
        </div>

        {loading ? (
          <Row gutter={[12, 12]}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Col key={index} xs={24} md={12} xl={8}>
                <Card className="agents-card"><Skeleton active avatar paragraph={{ rows: 3 }} /></Card>
              </Col>
            ))}
          </Row>
        ) : filteredAgents.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={hasFilters ? "没有符合筛选条件的智能体" : "还没有智能体"}
          >
            {hasFilters ? (
              <Button onClick={() => {
                setQuery("");
                setGroupFilter("all");
                setStatusFilter("all");
              }}>
                清除筛选
              </Button>
            ) : (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建智能体</Button>
            )}
          </Empty>
        ) : (
          <div className="agents-groups">
            {groupedAgents.map(([group, rows]) => (
              <section key={group} className="agents-group" aria-labelledby={`agent-group-${group}`}>
                <div className="agents-group__head">
                  <Title level={5} id={`agent-group-${group}`}>{group}</Title>
                  <Tag>{rows.length}</Tag>
                </div>
                <Row gutter={[12, 12]}>
                  {rows.map((agent) => (
                    <Col key={agent.id} xs={24} md={12} xl={8}>
                      <AgentCard
                        agent={agent}
                        deleting={deletingId === agent.id}
                        toggling={togglingId === agent.id}
                        onEdit={openEdit}
                        onDelete={(row) => void removeAgent(row)}
                        onToggleAvailability={(row, active) => void toggleAgentAvailability(row, active)}
                      />
                    </Col>
                  ))}
                </Row>
              </section>
            ))}
          </div>
        )}
      </Card>

      <AgentFormDrawer
        open={drawerOpen}
        editing={editing}
        mockBindings={activeMockBindings}
        groupOptions={groupOptions}
        submitting={submitting}
        onClose={closeDrawer}
        onSubmit={saveAgent}
      />
    </div>
  );
}
