import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  AutoComplete,
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Popover,
  Progress,
  Row,
  Segmented,
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
  BulbOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PartitionOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
  ToolOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Virtuoso } from "react-virtuoso";
import {
  createAgent,
  deleteAgent,
  getSkillAssets,
  getSkills,
  listKnowledgeBases,
  listAgents,
  listSops,
  updateAgent,
  type Agent,
} from "../api/client";

const { Paragraph, Text, Title } = Typography;

const EMOJI_CHOICES = ["🤖", "📈", "🧩", "💰", "🎯", "🧠", "⚙️", "🎨", "📊", "🛡️", "🚀", "🔬"];

const CAPABILITY_RULE_TEMPLATE = `【触发条件】
- 涉及事实、制度或历史资料时，先检索已选知识库。
- 涉及可执行操作时，调用最匹配的 Skill。
- 用户明确要求跑流程/周报/SOP 时，优先走已绑定的已发布 SOP。

【调用顺序】
1. 先确认用户意图与必要参数。
2. 先检索取证，再执行操作；能力冲突时优先使用更具体的 Skill 或已绑定 SOP。

【失败与边界】
- 无结果时说明检索范围，并请求补充信息。
- 调用失败时说明原因并给出替代方案，不得假装成功。
- 未绑定或不在白名单的 SOP 不得执行。
- 高风险或越权操作必须停止并请求确认。`;

const PERSONA_TEMPLATE = `【角色定位】你是……
【核心目标】你需要……
【工作边界】不得……；遇到高风险、信息不足或权限不明时先确认。
【表达风格】清晰、稳健、直接给出可执行建议。
【输出格式】先给结论，再列依据、步骤与风险提示。`;

type AgentFormValues = Pick<
  Agent,
  | "name"
  | "group"
  | "role"
  | "expertise"
  | "persona"
  | "execution_role"
  | "quota_limit"
  | "is_active"
  | "skill_ids"
  | "sop_keys"
  | "knowledge_base_ids"
  | "capability_instructions"
>;

interface CapabilityOption<T extends string | number> {
  value: T;
  label: string;
  description: string;
  meta: string;
}

interface CapabilityPickerProps<T extends string | number> {
  label: string;
  searchPlaceholder: string;
  emptyText: string;
  icon: React.ReactNode;
  options: CapabilityOption<T>[];
  value?: T[];
  loading?: boolean;
  onChange?: (value: T[]) => void;
}

function CapabilityPicker<T extends string | number>({
  label,
  searchPlaceholder,
  emptyText,
  icon,
  options,
  value = [],
  loading = false,
  onChange,
}: CapabilityPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((option) => [option.label, option.description, option.meta]
      .some((text) => text.toLocaleLowerCase("zh-CN").includes(normalizedQuery)));
  }, [normalizedQuery, options]);
  const selected = new Set(value);

  const toggleOption = (optionValue: T) => {
    if (selected.has(optionValue)) {
      onChange?.(value.filter((item) => item !== optionValue));
    } else {
      onChange?.([...value, optionValue]);
    }
  };

  const renderOption = (option: CapabilityOption<T>) => (
    <div
      className={`agents-capability-picker__item${selected.has(option.value) ? " is-selected" : ""}`}
      key={String(option.value)}
      role="checkbox"
      aria-checked={selected.has(option.value)}
      tabIndex={0}
      onClick={() => toggleOption(option.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleOption(option.value);
        }
      }}
    >
      <Checkbox checked={selected.has(option.value)} tabIndex={-1} aria-hidden="true" />
      <span className="agents-capability-picker__copy">
        <Text strong>{option.label}</Text>
        <Text type="secondary">{option.description || "暂无说明"}</Text>
        <Text className="agents-capability-option__meta">{option.meta}</Text>
      </span>
    </div>
  );

  const panel = (
    <div className="agents-capability-picker" role="dialog" aria-label={`选择${label}`}>
      <div className="agents-capability-picker__head">
        <div>
          <Text strong>选择{label}</Text>
          <Text type="secondary">已选 {value.length} / 共 {options.length}</Text>
        </div>
        <Button
          type="link"
          size="small"
          disabled={value.length === 0}
          onClick={() => onChange?.([])}
        >
          清空
        </Button>
      </div>
      <Input
        autoFocus
        allowClear
        prefix={<SearchOutlined />}
        value={query}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="agents-capability-picker__results" aria-live="polite">
        {loading ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : filteredOptions.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? "没有匹配结果" : emptyText} />
        ) : filteredOptions.length > 12 ? (
          <Virtuoso
            data={filteredOptions}
            style={{ height: 304 }}
            itemContent={(_, option) => renderOption(option)}
          />
        ) : (
          <div className="agents-capability-picker__short-list">
            {filteredOptions.map(renderOption)}
          </div>
        )}
      </div>
      <div className="agents-capability-picker__foot">
        <Text type="secondary">可搜索名称、说明和来源</Text>
        <Button size="small" type="primary" onClick={() => setOpen(false)}>完成</Button>
      </div>
    </div>
  );

  return (
    <Popover
      content={panel}
      trigger="click"
      placement="bottomLeft"
      open={open}
      zIndex={1300}
      overlayClassName="agents-capability-popover"
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <Button
        className={`agents-capability-trigger${open ? " is-open" : ""}`}
        disabled={loading}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="agents-capability-trigger__icon">{icon}</span>
        <span className="agents-capability-trigger__label">{label}</span>
        <span className="agents-capability-trigger__summary">
          {loading ? "加载中" : value.length ? `已选 ${value.length} 项` : "点击选择"}
        </span>
        <DownOutlined className="agents-capability-trigger__arrow" />
      </Button>
    </Popover>
  );
}

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
  groupOptions: { value: string }[];
  skillOptions: CapabilityOption<string>[];
  sopOptions: CapabilityOption<string>[];
  knowledgeBaseOptions: CapabilityOption<number>[];
  capabilityOptionsLoading: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: AgentFormValues, emoji: string) => Promise<void>;
}

function AgentFormDrawer({
  open,
  editing,
  groupOptions,
  skillOptions,
  sopOptions,
  knowledgeBaseOptions,
  capabilityOptionsLoading,
  submitting,
  onClose,
  onSubmit,
}: AgentFormDrawerProps) {
  const [form] = Form.useForm<AgentFormValues>();
  const [emoji, setEmoji] = useState("🤖");
  const [activeInstructionSection, setActiveInstructionSection] = useState<"persona" | "capability">("persona");
  const capabilityInstructions = Form.useWatch("capability_instructions", form) || "";
  const personaInstructions = Form.useWatch("persona", form) || "";
  const activeInstruction = activeInstructionSection === "persona" ? personaInstructions : capabilityInstructions;

  const syncForm = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({
      name: editing?.name || "",
      group: editing?.group || "",
      role: editing?.role || "",
      expertise: editing?.expertise || "",
      persona: editing?.persona || "",
      skill_ids: [...(editing?.skill_ids || [])],
      sop_keys: [...(editing?.sop_keys || [])],
      knowledge_base_ids: [...(editing?.knowledge_base_ids || [])],
      capability_instructions: editing?.capability_instructions || "",
      execution_role: editing?.execution_role || "operator",
      quota_limit: editing?.quota_limit ?? 10_000,
      is_active: editing?.is_active ?? true,
    });
    setEmoji(editing?.emoji || "🤖");
    setActiveInstructionSection("persona");
  }, [editing, form]);

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
            <Tag color="green">实时同步</Tag>
            <Text type="secondary">选项来自 Skill 库、已发布 SOP 和知识库；保存后会同步到当前智能体。</Text>
          </div>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="skill_ids" label="Skill">
                <CapabilityPicker
                  label="技能"
                  icon={<ToolOutlined />}
                  options={skillOptions}
                  loading={capabilityOptionsLoading}
                  searchPlaceholder="搜索 Skill 名称、说明或来源"
                  emptyText="暂无可用 Skill"
                />
              </Form.Item>
              <Text type="secondary" className="agents-field-help">
                Skill 提供操作流程和工具指令；执行任务或会议发言时会加载当前账号有权限的绑定项。
              </Text>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="sop_keys" label="SOP">
                <CapabilityPicker
                  label="SOP"
                  icon={<PartitionOutlined />}
                  options={sopOptions}
                  loading={capabilityOptionsLoading}
                  searchPlaceholder="搜索已发布 SOP 名称或 key"
                  emptyText="暂无已发布 SOP"
                />
              </Form.Item>
              <Text type="secondary" className="agents-field-help">
                仅可绑定已发布 SOP。名称设为「小策」或 employee_code=`xiaoce` 时，协作小策 bot 可按绑定列表调用。
              </Text>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="knowledge_base_ids" label="知识库">
                <CapabilityPicker
                  label="知识库"
                  icon={<DatabaseOutlined />}
                  options={knowledgeBaseOptions}
                  loading={capabilityOptionsLoading}
                  searchPlaceholder="搜索知识库名称、说明或范围"
                  emptyText="暂无可用知识库"
                />
              </Form.Item>
              <Text type="secondary" className="agents-field-help">
                知识库提供事实依据；运行时只检索已选项，并继续校验当前账号的可见范围。
              </Text>
            </Col>
          </Row>
          <div className="agents-instruction-editor">
            <div className="agents-instruction-editor__head">
              <div>
                <Text strong>智能体指令</Text>
                <Text type="secondary">定义人设与能力调用方式</Text>
              </div>
              <Button
                size="small"
                icon={<BulbOutlined />}
                disabled={Boolean(activeInstruction.trim())}
                title={activeInstruction.trim() ? "当前内容已填写" : "填入当前部分的模板"}
                onClick={() => {
                  if (activeInstructionSection === "persona") form.setFieldValue("persona", PERSONA_TEMPLATE);
                  else form.setFieldValue("capability_instructions", CAPABILITY_RULE_TEMPLATE);
                }}
              >
                使用模板
              </Button>
            </div>
            <Segmented
              block
              value={activeInstructionSection}
              onChange={(value) => setActiveInstructionSection(value as "persona" | "capability")}
              options={[
                { label: "人设与表达", value: "persona" },
                { label: "能力调度", value: "capability" },
              ]}
            />
            <div className="agents-instruction-editor__body">
              {activeInstructionSection === "persona" ? (
              <Form.Item name="persona" noStyle>
                <Input.TextArea
                  rows={6}
                  maxLength={2_000}
                  showCount
                  aria-label="角色与表达指令"
                  placeholder={PERSONA_TEMPLATE}
                />
              </Form.Item>
              ) : (
              <Form.Item name="capability_instructions" noStyle>
                <Input.TextArea
                  rows={6}
                  maxLength={1_000}
                  showCount
                  aria-label="能力调度指令"
                  placeholder={CAPABILITY_RULE_TEMPLATE}
                />
              </Form.Item>
              )}
            </div>
            <Text type="secondary" className="agents-instruction-editor__help">
              {activeInstructionSection === "persona"
                ? "用于控制智能体的身份、边界、语气和输出方式。"
                : "用于控制何时调用已绑定能力，以及失败或越权时如何处理。"}
            </Text>
          </div>
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
  const [skillOptions, setSkillOptions] = useState<CapabilityOption<string>[]>([]);
  const [sopOptions, setSopOptions] = useState<CapabilityOption<string>[]>([]);
  const [knowledgeBaseOptions, setKnowledgeBaseOptions] = useState<CapabilityOption<number>[]>([]);
  const [capabilityOptionsLoading, setCapabilityOptionsLoading] = useState(false);
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

  const loadCapabilityOptions = useCallback(async () => {
    setCapabilityOptionsLoading(true);
    try {
      const [personalSkills, skillAssets, knowledgeBases, sops] = await Promise.all([
        getSkills(),
        getSkillAssets(),
        listKnowledgeBases(),
        listSops(),
      ]);
      const skillMap = new Map<string, CapabilityOption<string>>();
      (skillAssets.results || []).forEach((skill) => {
        skillMap.set(skill.skill_id, {
          value: skill.skill_id,
          label: skill.name || skill.skill_id,
          description: skill.description || "",
          meta: `${skill.visibility === "shared" ? "全员共享" : "个人"} · ${skill.has_scripts ? "含执行脚本" : "指令型"}`,
        });
      });
      (personalSkills.results || []).filter((skill) => skill.enabled).forEach((skill) => {
        const previous = skillMap.get(skill.skill_id);
        skillMap.set(skill.skill_id, {
          value: skill.skill_id,
          label: skill.name || skill.skill_id,
          description: skill.description || previous?.description || "",
          meta: "个人已启用 · 运行时直接加载",
        });
      });
      setSkillOptions(Array.from(skillMap.values())
        .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")));
      setSopOptions(
        (sops.results || [])
          .filter((sop) => sop.status === "published")
          .map((sop) => ({
            value: sop.key,
            label: sop.name || sop.key,
            description: sop.description || sop.actionName || "",
            meta: `已发布 · ${sop.key}${sop.currentVersion ? ` · v${sop.currentVersion}` : ""}`,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, "zh-CN")),
      );
      setKnowledgeBaseOptions(knowledgeBases.map((knowledgeBase) => ({
        value: knowledgeBase.id,
        label: knowledgeBase.name,
        description: knowledgeBase.description || "",
        meta: `${knowledgeBase.visibility === "private" ? "个人" : knowledgeBase.visibility === "company" ? "公司" : "团队"} · ${knowledgeBase.file_count} 个文件 · ${knowledgeBase.status === "ready" ? "可用" : `状态：${knowledgeBase.status}`}`,
      })));
    } catch (error) {
      message.error(errorText(error, "Skill / SOP / 知识库加载失败，请稍后重试"));
    } finally {
      setCapabilityOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadCapabilityOptions();
  }, [load, loadCapabilityOptions]);

  const groups = useMemo(
    () => Array.from(new Set(agents.map((agent) => agent.group || "未分类"))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [agents],
  );

  const groupOptions = useMemo(() => groups.map((group) => ({ value: group })), [groups]);

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
    void loadCapabilityOptions();
    setEditing(null);
    setDrawerOpen(true);
  };

  const openEdit = (agent: Agent) => {
    void loadCapabilityOptions();
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
      if (editing) {
        await updateAgent(editing.id, { ...values, emoji });
        message.success("智能体已更新");
      } else {
        await createAgent({ ...values, emoji });
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
        groupOptions={groupOptions}
        skillOptions={skillOptions}
        sopOptions={sopOptions}
        knowledgeBaseOptions={knowledgeBaseOptions}
        capabilityOptionsLoading={capabilityOptionsLoading}
        submitting={submitting}
        onClose={closeDrawer}
        onSubmit={saveAgent}
      />
    </div>
  );
}
