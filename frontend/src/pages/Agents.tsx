import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AutoComplete,
  Button,
  Checkbox,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Popover,
  Row,
  Skeleton,
  Tag,
  Typography,
  message,
} from "antd";
import {
  BulbOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  PartitionOutlined,
  EllipsisOutlined,
  MessageOutlined,
  PlusOutlined,
  ProfileOutlined,
  SearchOutlined,
  StopOutlined,
  ToolOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Virtuoso } from "react-virtuoso";
import { useNavigate } from "react-router-dom";
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
  type AgentListPermissions,
  type SopDefinitionItem,
} from "../api/client";
import {
  AGENT_AVATAR_OPTIONS,
  getStoredAgentAvatar,
  persistAgentAvatar,
  resolveAgentAvatar,
} from "../utils/agentAvatars";

const { Text } = Typography;

const PERSONA_TEMPLATE = `【角色定位】你是……
【核心目标】你需要……
【工作边界】不得……；遇到高风险、信息不足或权限不明时先确认。
【表达风格】清晰、稳健、直接给出可执行建议。
【输出格式】先给结论，再列依据、步骤与风险提示。`;

export type AgentFormValues = Pick<
  Agent,
  | "name"
  | "group"
  | "role"
  | "expertise"
  | "persona"
  | "execution_role"
  | "is_active"
  | "skill_ids"
  | "sop_keys"
  | "knowledge_base_ids"
  | "sop_keys"
  | "capability_instructions"
>;

export interface AgentAvatarSelection {
  token: string;
  customDataUrl?: string;
}

export interface CapabilityOption<T extends string | number> {
  value: T;
  label: string;
  description: string;
  meta: string;
}

export function buildSopOptions(rows: SopDefinitionItem[]): CapabilityOption<string>[] {
  const byKey = new Map<string, CapabilityOption<string>>();
  rows
    .filter((sop) => sop.status === "published" && Boolean(sop.currentVersion))
    .sort((a, b) => Number(b.system) - Number(a.system))
    .forEach((sop) => {
      byKey.set(sop.key, {
        value: sop.key,
        label: sop.name,
        description: sop.description || "",
        meta: `${sop.system ? "系统" : "企业"} · ${sop.businessDomain || "未分类"} · ${sop.currentVersion}`,
      });
    });
  return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
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

type DirectoryFilter = "all" | "online" | "offline" | "pending";

const DEMO_AGENTS: Agent[] = [
  {
    id: -1,
    name: "行政",
    emoji: "",
    group: "行政",
    role: "事务管家",
    expertise: "统筹会议室预订、办公用品申领、用章申请等行政事务，把琐碎的事务性沟通标准化，让行政团队从重复问答中解放出来。",
    persona: "",
    execution_role: "operator",
    is_active: true,
    quota_limit: 10000,
    quota_used: 0,
    quota_remaining: 10000,
    status: "available",
    skill_ids: ["meeting"],
    knowledge_base_ids: [1, 2],
    capability_instructions: "行政 SOP",
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: -2,
    name: "财务",
    emoji: "",
    group: "财务",
    role: "报销管家",
    expertise: "熟悉公司报销、差旅、预算与发票全流程，能解答报销政策、核对单据合规性、发起报销与额度查询。",
    persona: "",
    execution_role: "manager",
    is_active: true,
    quota_limit: 10000,
    quota_used: 0,
    quota_remaining: 10000,
    status: "available",
    skill_ids: ["audit", "budget"],
    knowledge_base_ids: [1, 2, 3],
    capability_instructions: "财务 SOP",
    created_at: "2026-01-02T00:00:00Z",
  },
  {
    id: -3,
    name: "法务",
    emoji: "",
    group: "法务",
    role: "合规审查官",
    expertise: "覆盖合同审查、条款风险识别与合规咨询，依据企业合规制度和历史判例给出审查意见，遇到高风险或无先例的条款自动升级。",
    persona: "",
    execution_role: "director",
    is_active: true,
    quota_limit: 10000,
    quota_used: 0,
    quota_remaining: 10000,
    status: "available",
    skill_ids: ["review"],
    knowledge_base_ids: [1, 2, 3, 4],
    capability_instructions: "法务 SOP",
    created_at: "2026-01-03T00:00:00Z",
  },
  {
    id: -4,
    name: "IT",
    emoji: "",
    group: "技术支持",
    role: "内部支持工程师",
    expertise: "处理账号权限、设备申领、常见故障排查等 IT 服务请求，能按 SOP 分流工单、调用内部系统接口开通权限。",
    persona: "",
    execution_role: "operator",
    is_active: true,
    quota_limit: 10000,
    quota_used: 0,
    quota_remaining: 10000,
    status: "available",
    skill_ids: ["ticket", "account", "device"],
    knowledge_base_ids: [1, 2],
    capability_instructions: "IT SOP",
    created_at: "2026-01-04T00:00:00Z",
  },
  {
    id: -5,
    name: "人事",
    emoji: "",
    group: "人力资源",
    role: "员工服务助手",
    expertise: "面向全体在职员工的 HR 服务窗口，解答假期、社保公积金、薪酬福利、考勤等高频制度问题，可发起请假与开具证明等事务申请。",
    persona: "",
    execution_role: "manager",
    is_active: true,
    quota_limit: 10000,
    quota_used: 0,
    quota_remaining: 10000,
    status: "available",
    skill_ids: ["leave", "certificate"],
    knowledge_base_ids: [1, 2, 3],
    capability_instructions: "人事 SOP",
    created_at: "2026-01-05T00:00:00Z",
  },
];

const errorText = (error: unknown, fallback: string) => {
  if (typeof error === "object" && error) {
    const response = (error as { response?: { data?: { detail?: string; error?: string } } }).response;
    return response?.data?.detail || response?.data?.error || fallback;
  }
  return fallback;
};

export interface AgentFormModalProps {
  open: boolean;
  editing: Agent | null;
  groupOptions: { value: string }[];
  skillOptions: CapabilityOption<string>[];
  sopOptions: CapabilityOption<string>[];
  knowledgeBaseOptions: CapabilityOption<number>[];
  sopOptions: CapabilityOption<string>[];
  capabilityOptionsLoading: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: AgentFormValues, avatar: AgentAvatarSelection) => Promise<void>;
}

export function AgentFormModal({
  open,
  editing,
  groupOptions,
  skillOptions,
  sopOptions,
  knowledgeBaseOptions,
  sopOptions,
  capabilityOptionsLoading,
  submitting,
  onClose,
  onSubmit,
}: AgentFormModalProps) {
  const [form] = Form.useForm<AgentFormValues>();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [avatarToken, setAvatarToken] = useState<string>(AGENT_AVATAR_OPTIONS[0].token);
  const [customAvatarPreview, setCustomAvatarPreview] = useState("");
  const personaInstructions = Form.useWatch("persona", form) || "";

  const syncForm = useCallback(() => {
    form.resetFields();
    form.setFieldsValue({
      name: editing?.name || "",
      group: editing?.group || "",
      role: editing?.role || "",
      expertise: editing?.expertise || "",
      persona: editing?.persona || editing?.capability_instructions || "",
      skill_ids: [...(editing?.skill_ids || [])],
      sop_keys: [...(editing?.sop_keys || [])],
      knowledge_base_ids: [...(editing?.knowledge_base_ids || [])],
      sop_keys: [...(editing?.sop_keys || [])],
      capability_instructions: editing?.capability_instructions || "",
      execution_role: editing?.execution_role || "operator",
      is_active: editing?.is_active ?? true,
    });
    const preset = AGENT_AVATAR_OPTIONS.find((item) => item.token === editing?.emoji);
    setAvatarToken(preset?.token || AGENT_AVATAR_OPTIONS[0].token);
    setCustomAvatarPreview(editing ? getStoredAgentAvatar(editing.id) : "");
  }, [editing, form]);

  const submit = async () => {
    const values = await form.validateFields();
    const unifiedPrompt = values.persona?.trim() || "";
    await onSubmit({
      ...values,
      persona: unifiedPrompt,
      capability_instructions: unifiedPrompt,
      execution_role: values.execution_role || "operator",
      is_active: values.is_active ?? true,
    }, {
      token: customAvatarPreview ? "staffdeck:custom" : avatarToken,
      customDataUrl: customAvatarPreview || undefined,
    });
  };

  const selectedAvatar = customAvatarPreview
    || AGENT_AVATAR_OPTIONS.find((item) => item.token === avatarToken)?.src
    || AGENT_AVATAR_OPTIONS[0].src;

  const uploadAvatar = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      message.error("请选择图片文件");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      message.error("头像图片不能超过 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setCustomAvatarPreview(reader.result);
    };
    reader.onerror = () => message.error("头像读取失败，请重新选择");
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (open) syncForm();
  }, [open, syncForm]);

  return (
    <Modal
      className="agent-edit-modal agents-create-modal"
      rootClassName="agent-edit-modal-root"
      title={editing ? `编辑数字员工档案：${editing.name}` : "创建数字员工档案"}
      open={open}
      centered
      width={860}
      zIndex={1200}
      forceRender
      maskClosable={!submitting}
      keyboard={!submitting}
      onCancel={onClose}
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
            <div className="agents-avatar-editor">
              <div className="agents-avatar-editor__preview">
                <img src={selectedAvatar} alt="当前智能体头像" />
                <div>
                  <strong>{customAvatarPreview ? "自定义头像" : "员工插画头像"}</strong>
                  <span>列表和详情页将同步使用该头像</span>
                </div>
              </div>
              <div className="agents-avatar-editor__controls">
                <div className="agents-avatar-presets" aria-label="预设头像">
                  {AGENT_AVATAR_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.token}
                      className={!customAvatarPreview && avatarToken === option.token ? "is-active" : ""}
                      aria-label={`选择${option.label}头像`}
                      aria-pressed={!customAvatarPreview && avatarToken === option.token}
                      onClick={() => {
                        setAvatarToken(option.token);
                        setCustomAvatarPreview("");
                      }}
                    >
                      <img src={option.src} alt="" />
                    </button>
                  ))}
                </div>
                <input
                  ref={uploadInputRef}
                  className="agents-avatar-upload-input"
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    uploadAvatar(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <Button icon={<UploadOutlined />} onClick={() => uploadInputRef.current?.click()}>
                  {customAvatarPreview ? "重新上传" : "上传头像"}
                </Button>
                {customAvatarPreview && (
                  <Button onClick={() => setCustomAvatarPreview("")}>恢复预设</Button>
                )}
              </div>
            </div>
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
          <section className="agents-capability-config" aria-labelledby="agents-capability-config-title">
            <div className="agents-capability-config__head">
              <div>
                <Text strong id="agents-capability-config-title">连接能力</Text>
                <Text type="secondary">按需添加技能、SOP 与知识，保存后立即同步到当前智能体</Text>
              </div>
              <Tag color="green">实时同步</Tag>
            </div>
            <div className="agents-capability-config__list">
              <div className="agents-capability-config__card">
                <div className="agents-capability-config__meta">
                  <span className="agents-capability-config__icon"><ToolOutlined /></span>
                  <div>
                    <Text strong>Skill 技能</Text>
                    <Text type="secondary">提供操作流程与工具指令，适合执行任务和协作动作</Text>
                  </div>
                </div>
                <Form.Item name="skill_ids" noStyle>
                  <CapabilityPicker
                    label="技能"
                    icon={<ToolOutlined />}
                    options={skillOptions}
                    loading={capabilityOptionsLoading}
                    searchPlaceholder="搜索 Skill 名称、说明或来源"
                    emptyText="暂无可用 Skill"
                  />
                </Form.Item>
              </div>
              <div className="agents-capability-config__card">
                <div className="agents-capability-config__meta">
                  <span className="agents-capability-config__icon"><PartitionOutlined /></span>
                  <div>
                    <Text strong>SOP</Text>
                    <Text type="secondary">仅可绑定已发布 SOP；小策 bot 可按绑定列表调用</Text>
                  </div>
                </div>
                <Form.Item name="sop_keys" noStyle>
                  <CapabilityPicker
                    label="SOP"
                    icon={<PartitionOutlined />}
                    options={sopOptions}
                    loading={capabilityOptionsLoading}
                    searchPlaceholder="搜索已发布 SOP 名称或 key"
                    emptyText="暂无已发布 SOP"
                  />
                </Form.Item>
              </div>
              <div className="agents-capability-config__card">
                <div className="agents-capability-config__meta">
                  <span className="agents-capability-config__icon"><DatabaseOutlined /></span>
                  <div>
                    <Text strong>知识库</Text>
                    <Text type="secondary">提供可靠事实依据，运行时仅检索已选择且有权限的内容</Text>
                  </div>
                </div>
                <Form.Item name="knowledge_base_ids" noStyle>
                <CapabilityPicker
                  label="知识库"
                  icon={<DatabaseOutlined />}
                  options={knowledgeBaseOptions}
                  loading={capabilityOptionsLoading}
                  searchPlaceholder="搜索知识库名称、说明或范围"
                  emptyText="暂无可用知识库"
                />
                </Form.Item>
              </div>
              <div className="agents-capability-config__card">
                <div className="agents-capability-config__meta">
                  <span className="agents-capability-config__icon"><ProfileOutlined /></span>
                  <div>
                    <Text strong>SOP 流程</Text>
                    <Text type="secondary">限定该智能体可匹配和执行的已发布标准流程</Text>
                  </div>
                </div>
                <Form.Item name="sop_keys" noStyle>
                  <CapabilityPicker
                    label="SOP"
                    icon={<ProfileOutlined />}
                    options={sopOptions}
                    loading={capabilityOptionsLoading}
                    searchPlaceholder="搜索 SOP 名称、说明或业务域"
                    emptyText="暂无已发布 SOP"
                  />
                </Form.Item>
              </div>
            </div>
          </section>
          <section className="agents-unified-prompt" aria-labelledby="agents-unified-prompt-title">
            <div className="agents-unified-prompt__head">
              <div>
                <span className="agents-unified-prompt__icon"><BulbOutlined /></span>
                <div>
                  <Text strong id="agents-unified-prompt-title">核心提示词</Text>
                  <Text type="secondary">一个提示词统一定义身份、表达方式、能力调用和工作边界</Text>
                </div>
              </div>
              <Button
                size="small"
                icon={<BulbOutlined />}
                disabled={Boolean(personaInstructions.trim())}
                title={personaInstructions.trim() ? "当前内容已填写" : "填入提示词模板"}
                onClick={() => form.setFieldValue("persona", PERSONA_TEMPLATE)}
              >
                使用模板
              </Button>
            </div>
            <Form.Item name="persona" noStyle>
                <Input.TextArea
                  rows={7}
                  maxLength={2_000}
                  aria-label="核心提示词"
                  placeholder="描述智能体是谁、要达成什么目标、如何使用已连接能力，以及遇到风险时如何处理"
                />
            </Form.Item>
            <div className="agents-unified-prompt__foot">
              <Text type="secondary">建议包含：角色定位、核心目标、工作边界、表达风格和输出格式</Text>
              <Text type="secondary">保存后将作为智能体的统一执行指令</Text>
            </div>
          </section>
        </div>

      </Form>
    </Modal>
  );
}

function AgentDirectoryCard({
  agent,
  onOpen,
  onChat,
  onToggleStatus,
  onEdit,
  onDelete,
}: {
  agent: Agent;
  onOpen: (agent: Agent) => void;
  onChat: (agent: Agent) => void;
  onToggleStatus: (agent: Agent) => void;
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
}) {
  const online = agent.status === "available";
  const stats = [
    { value: agent.knowledge_base_ids.length, label: "知识库" },
    { value: agent.skill_ids.length, label: "技能" },
    { value: agent.capability_instructions.trim() ? Math.max(1, Math.min(4, agent.skill_ids.length + 1)) : 0, label: "SOP" },
  ];
  const menuItems = [
    {
      key: "chat",
      icon: <MessageOutlined />,
      label: "发起对话",
      disabled: !online,
    },
    {
      key: "status",
      icon: online ? <StopOutlined /> : <CheckCircleOutlined />,
      label: online ? "下线" : "上线",
      disabled: !agent.can_manage,
    },
    { type: "divider" as const },
    {
      key: "edit",
      icon: <EditOutlined />,
      label: "编辑资料",
      disabled: !agent.can_manage,
    },
    { type: "divider" as const },
    {
      key: "delete",
      icon: <DeleteOutlined />,
      label: "删除",
      danger: true,
      disabled: !agent.can_manage,
    },
  ];

  return (
    <article
      className="agent-directory-card"
      role="link"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        onOpen(agent);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(agent);
        }
      }}
    >
      <Dropdown
        trigger={["click"]}
        placement="bottomRight"
        overlayClassName="agent-directory-card-menu"
        menu={{
          items: menuItems,
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            if (key === "chat") onChat(agent);
            if (key === "status") onToggleStatus(agent);
            if (key === "edit") onEdit(agent);
            if (key === "delete") onDelete(agent);
          },
        }}
      >
        <button
          className="agent-directory-card__more"
          type="button"
          aria-label={`打开 ${agent.name} 操作菜单`}
          onClick={(event) => event.stopPropagation()}
        >
          <EllipsisOutlined />
        </button>
      </Dropdown>

      <div className="agent-directory-card__hero">
        <div className="agent-directory-card__avatar">
          <img src={resolveAgentAvatar(agent)} alt="" />
        </div>
        <div className="agent-directory-card__identity">
          <strong>{agent.name} <span>@{agent.owner?.display_name || agent.created_by?.display_name || "未分配"}</span></strong>
          <p>{agent.role || agent.group || "待补充岗位"}</p>
          <span className={`agent-directory-card__status${online ? " is-online" : ""}`}>
            <i />
            {online ? "在线" : "下线"}
          </span>
        </div>
        <button
          className="agent-directory-card__chat"
          type="button"
          disabled={!online}
          aria-label={`与 ${agent.name} 对话`}
          onClick={(event) => {
            event.stopPropagation();
            onChat(agent);
          }}
        >
          <MessageOutlined />
        </button>
      </div>

      <p
        className="agent-directory-card__description"
        title={agent.expertise || agent.persona || "暂无描述"}
      >
        <span>{agent.expertise || agent.persona || "暂无描述"}</span>
      </p>

      <div className="agent-directory-card__stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function Agents() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skillOptions, setSkillOptions] = useState<CapabilityOption<string>[]>([]);
  const [sopOptions, setSopOptions] = useState<CapabilityOption<string>[]>([]);
  const [knowledgeBaseOptions, setKnowledgeBaseOptions] = useState<CapabilityOption<number>[]>([]);
  const [sopOptions, setSopOptions] = useState<CapabilityOption<string>[]>([]);
  const [capabilityOptionsLoading, setCapabilityOptionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DirectoryFilter>("all");
  const [permissions, setPermissions] = useState<AgentListPermissions>({
    can_create: false,
    can_manage_all: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listAgents();
      setAgents(data.results);
      setPermissions(data.permissions);
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
      setSopOptions(buildSopOptions(sops.results || []));
    } catch (error) {
      message.error(errorText(error, "Skill 库或知识库加载失败，请稍后重试"));
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
    return agents.filter((agent) => {
      const pending = agent.status === "pending";
      const matchesQuery = !normalizedQuery || [
        agent.name,
        agent.group,
        agent.role,
        agent.expertise,
        agent.persona,
      ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "online" && agent.status === "available")
        || (statusFilter === "offline" && agent.status !== "available" && !pending)
        || (statusFilter === "pending" && pending);
      return matchesQuery && matchesStatus;
    });
  }, [agents, query, statusFilter]);

  const availableCount = agents.filter((agent) => agent.status === "available").length;
  const pendingCount = agents.filter((agent) => agent.status === "pending").length;
  const disabledCount = agents.length - availableCount - pendingCount;

  const openCreate = () => {
    if (!permissions.can_create) {
      message.warning("仅企业所有者或管理员可以创建智能体");
      return;
    }
    void loadCapabilityOptions();
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (agent: Agent) => {
    if (!agent.can_manage) {
      message.warning("只有智能体负责人或企业管理员可以编辑");
      return;
    }
    void loadCapabilityOptions();
    setEditing(agent);
    setModalOpen(true);
  };

  const toggleAgentStatus = async (agent: Agent) => {
    const nextActive = !agent.is_active;
    try {
      await updateAgent(agent.id, { is_active: nextActive });
      await load();
      message.success(`${agent.name}已${nextActive ? "上线" : "下线"}`);
    } catch (error) {
      message.error(errorText(error, `${nextActive ? "上线" : "下线"}失败，请稍后重试`));
    }
  };

  const confirmDeleteAgent = (agent: Agent) => {
    Modal.confirm({
      title: `归档智能体“${agent.name}”？`,
      content: "归档后将从智能体列表隐藏，并停止继续执行任务。",
      okText: "归档",
      cancelText: "取消",
      okButtonProps: { danger: true },
      async onOk() {
        try {
          await deleteAgent(agent.id);
          await load();
          message.success("智能体已归档");
        } catch (error) {
          message.error(errorText(error, "归档失败，请稍后重试"));
          throw error;
        }
      },
    });
  };

  const closeModal = () => {
    if (submitting) return;
    setModalOpen(false);
    setEditing(null);
  };

  const saveAgent = async (values: AgentFormValues, avatar: AgentAvatarSelection) => {
    setSubmitting(true);
    try {
      if (editing) {
        await updateAgent(editing.id, { ...values, emoji: avatar.token });
        persistAgentAvatar(editing.id, avatar.customDataUrl);
        message.success("智能体已更新");
      } else {
        const created = await createAgent({ ...values, emoji: avatar.token });
        persistAgentAvatar(created.id, avatar.customDataUrl);
        message.success("智能体已创建");
      }
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      message.error(errorText(error, editing ? "保存失败，请检查后重试" : "创建失败，请检查后重试"));
    } finally {
      setSubmitting(false);
    }
  };

  const hasFilters = Boolean(query.trim()) || statusFilter !== "all";

  return (
    <div className="agents-directory-page" aria-busy={loading}>
      <section className="agents-directory-workspace" aria-label="智能体管理工作区">
        <header className="agents-directory-header">
          <label className="agents-directory-search">
            <SearchOutlined />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索"
              aria-label="搜索员工"
            />
          </label>
        </header>

        <section className="agents-directory-summary" aria-label="数字员工统计">
          <button
            type="button"
            className="is-total"
            aria-pressed={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          >
            <strong>{agents.length}</strong>
            <span><b>智能体总数</b><small>全部智能体</small></span>
          </button>
          <button
            type="button"
            className="is-online"
            aria-pressed={statusFilter === "online"}
            onClick={() => setStatusFilter("online")}
          >
            <strong>{availableCount}</strong>
            <span><b>在线智能体</b><small>运行中</small></span>
          </button>
          <button
            type="button"
            className="is-offline"
            aria-pressed={statusFilter === "offline"}
            onClick={() => setStatusFilter("offline")}
          >
            <strong>{disabledCount}</strong>
            <span><b>下线智能体</b><small>已暂停</small></span>
          </button>
          <button
            type="button"
            className="is-pending"
            aria-pressed={statusFilter === "pending"}
            onClick={() => setStatusFilter("pending")}
          >
            <strong>{pendingCount}</strong>
            <span><b>待审批智能体</b><small>等待处理</small></span>
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="is-create"
            disabled={!permissions.can_create}
            title={permissions.can_create ? "" : "仅企业所有者或管理员可以创建"}
          >
            <PlusOutlined />
            <span><b>创建智能体</b><small>快速创建数字员工</small></span>
          </button>
        </section>

        <nav className="agents-directory-tabs" aria-label="员工状态筛选">
          {([
            ["all", "全部智能体"],
            ["online", "在线智能体"],
            ["offline", "下线智能体"],
          ] as Array<[DirectoryFilter, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={statusFilter === value ? "is-active" : ""}
              onClick={() => setStatusFilter(value)}
            >
              {label}
            </button>
          ))}
        </nav>

        {filteredAgents.length ? (
          <section className="agents-directory-grid" aria-label="数字员工列表">
            {filteredAgents.map((agent) => (
              <AgentDirectoryCard
                key={agent.id}
                agent={agent}
                onOpen={(row) => navigate(`/agent-dashboard?agent=${row.id}`)}
                onChat={(row) => navigate(`/agent?agent=${row.id}`)}
                onToggleStatus={(row) => void toggleAgentStatus(row)}
                onEdit={openEdit}
                onDelete={confirmDeleteAgent}
              />
            ))}
          </section>
        ) : (
          <div className="agents-directory-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={hasFilters ? "没有符合筛选条件的数字员工" : "还没有数字员工"}
            >
              {hasFilters ? (
                <Button onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}>
                  清除筛选
                </Button>
              ) : permissions.can_create ? (
                <Button type="primary" onClick={openCreate}>创建第一个智能体</Button>
              ) : null}
            </Empty>
          </div>
        )}
      </section>

      <AgentFormModal
        open={modalOpen}
        editing={editing}
        groupOptions={groupOptions}
        skillOptions={skillOptions}
        sopOptions={sopOptions}
        knowledgeBaseOptions={knowledgeBaseOptions}
        sopOptions={sopOptions}
        capabilityOptionsLoading={capabilityOptionsLoading}
        submitting={submitting}
        onClose={closeModal}
        onSubmit={saveAgent}
      />
    </div>
  );
}
