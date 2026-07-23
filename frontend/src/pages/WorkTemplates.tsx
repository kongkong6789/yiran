import {
  BarChartOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  LineChartOutlined,
  PlusOutlined,
  RocketOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Tabs,
} from "antd";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  createTaskTemplate,
  deleteTaskTemplate,
  duplicateTaskTemplate,
  getCatalog,
  getReportOptions,
  listTaskTemplates,
  updateTaskTemplate,
  type ActionContract,
  type TaskTemplateItem,
} from "../api/client";
import SopCenter from "./SopCenter";

type TaskTemplateCategory = TaskTemplateItem["category"];

const CATEGORY_LABELS: Record<TaskTemplateCategory, string> = {
  report: "经营报告",
  operation: "日常运营",
  analysis: "数据分析",
  collab: "协作跟进",
};

const CATEGORY_ICONS: Record<TaskTemplateCategory, ReactNode> = {
  report: <FileTextOutlined />,
  operation: <RocketOutlined />,
  analysis: <LineChartOutlined />,
  collab: <TeamOutlined />,
};

const CATEGORY_COLORS: Record<TaskTemplateCategory, { color: string; soft: string }> = {
  report: { color: "#6d4ed7", soft: "#f0ebff" },
  operation: { color: "#b76b12", soft: "#fff3e2" },
  analysis: { color: "#16806f", soft: "#e5f6f2" },
  collab: { color: "#2563eb", soft: "#eff6ff" },
};

const CATEGORY_OPTIONS = [
  { value: "all", label: "全部" },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
];

type TemplateFormValue = {
  name: string;
  description?: string;
  category: TaskTemplateCategory;
  actionName: string;
  prompt: string;
  tags?: string[];
  visibility: TaskTemplateItem["visibility"];
  estimatedMinutes: number;
  scope?: string;
  outputType?: string;
  brandIds?: string[];
  defaultsJson?: string;
};

function errorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: string; detail?: string } } })?.response?.data;
  return data?.error || data?.detail || fallback;
}

function TaskPresetCenter({
  onUseTemplate,
  createRequestId = 0,
}: {
  onUseTemplate: (templateKey: string) => void;
  createRequestId?: number;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<TemplateFormValue>();
  const actionName = Form.useWatch("actionName", form);
  const [category, setCategory] = useState<"all" | TaskTemplateCategory>("all");
  const [keyword, setKeyword] = useState("");
  const [templates, setTemplates] = useState<TaskTemplateItem[]>([]);
  const [actions, setActions] = useState<ActionContract[]>([]);
  const [brandOptions, setBrandOptions] = useState<Array<{ label: string; value: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TaskTemplateItem>();

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await listTaskTemplates();
      setTemplates(data.results || []);
    } catch (error) {
      message.error(errorMessage(error, "任务模板加载失败"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    getCatalog().then((data) => setActions(data.actions || [])).catch(() => setActions([]));
    getReportOptions().then((data) => setBrandOptions(data.brands || [])).catch(() => setBrandOptions([]));
  }, []);

  const openCreate = () => {
    setEditing(undefined);
    form.resetFields();
    form.setFieldsValue({
      category: "report",
      actionName: "report.generate",
      visibility: "personal",
      estimatedMinutes: 10,
      scope: "all",
      outputType: "weekly_report",
      brandIds: [],
      defaultsJson: "{}",
    });
    setModalOpen(true);
  };

  useEffect(() => {
    if (createRequestId > 0) openCreate();
  }, [createRequestId]);

  const openEdit = (template: TaskTemplateItem) => {
    setEditing(template);
    const defaults = template.defaults || {};
    form.setFieldsValue({
      name: template.name,
      description: template.description,
      category: template.category,
      actionName: template.actionName,
      prompt: template.prompt,
      tags: template.tags,
      visibility: template.visibility,
      estimatedMinutes: template.estimatedMinutes,
      scope: String(defaults.scope || "all"),
      outputType: String(defaults.output_type || "weekly_report"),
      brandIds: Array.isArray(defaults.brand_ids) ? defaults.brand_ids.map(String) : [],
      defaultsJson: JSON.stringify(defaults, null, 2),
    });
    setModalOpen(true);
  };

  const saveTemplate = async (values: TemplateFormValue) => {
    let defaults: Record<string, unknown> = {};
    try {
      defaults = JSON.parse(values.defaultsJson || "{}") as Record<string, unknown>;
      if (!defaults || Array.isArray(defaults) || typeof defaults !== "object") throw new Error();
    } catch {
      message.error("高级默认参数必须是合法的 JSON 对象");
      return;
    }
    if (values.actionName === "report.generate") {
      defaults = {
        ...defaults,
        scope: values.scope || "all",
        output_type: values.outputType || "weekly_report",
        brand_ids: values.brandIds || [],
      };
    }
    setSaving(true);
    try {
      const payload: Partial<TaskTemplateItem> = {
        name: values.name,
        description: values.description || "",
        category: values.category,
        actionName: values.actionName,
        prompt: values.prompt,
        defaults,
        tags: values.tags || [],
        visibility: values.visibility,
        estimatedMinutes: values.estimatedMinutes,
      };
      if (editing) await updateTaskTemplate(editing.key, payload);
      else await createTaskTemplate(payload);
      message.success(editing?.builtin ? "工作区模板配置已保存" : editing ? "任务模板已更新" : "任务模板已创建");
      setModalOpen(false);
      await refresh();
    } catch (error) {
      message.error(errorMessage(error, "任务模板保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async (template: TaskTemplateItem) => {
    try {
      const copy = await duplicateTaskTemplate(template.key);
      message.success(`已创建「${copy.name}」`);
      await refresh();
    } catch (error) {
      message.error(errorMessage(error, "复制模板失败"));
    }
  };

  const remove = async (template: TaskTemplateItem) => {
    try {
      await deleteTaskTemplate(template.key);
      message.success(template.builtin ? "已恢复系统默认模板" : "任务模板已删除");
      await refresh();
    } catch (error) {
      message.error(errorMessage(error, "删除模板失败"));
    }
  };

  const visibleTemplates = useMemo(() => templates.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!keyword.trim()) return true;
    const q = keyword.trim().toLowerCase();
    return `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(q);
  }), [category, keyword, templates]);

  return (
    <div className="work-templates-page">
      <section className="work-templates-notice">
        <span className="work-templates-notice-icon"><ThunderboltOutlined /></span>
        <div>
          <strong>任务模板配置中心</strong>
          <p>保存任务描述、业务动作和默认参数。使用模板后仍可在发起前调整，最终由后端动作契约校验。</p>
        </div>
        <Space>
          <Tag className="work-templates-stage-tag">{templates.length} 个模板</Tag>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建模板</Button>
        </Space>
      </section>

      <section className="work-templates-toolbar">
        <Segmented
          className="work-templates-category-tabs"
          value={category}
          onChange={(value) => setCategory(value as "all" | TaskTemplateCategory)}
          options={CATEGORY_OPTIONS}
        />
        <Input.Search
          allowClear
          value={keyword}
          placeholder="搜索模板名称、场景或标签"
          onChange={(event) => setKeyword(event.target.value)}
        />
      </section>

      <Spin spinning={loading}>
        {visibleTemplates.length === 0 && !loading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的任务模板" className="work-templates-empty">
            <Button type="primary" onClick={openCreate}>创建第一个模板</Button>
          </Empty>
        ) : (
          <div className="work-templates-grid">
            {visibleTemplates.map((template) => (
              <TemplateCard
                key={template.key}
                template={template}
                actionTitle={actions.find((action) => action.name === template.actionName)?.title || template.actionName}
                onUse={() => onUseTemplate(template.key)}
                onEdit={() => openEdit(template)}
                onDuplicate={() => void duplicate(template)}
                onDelete={() => void remove(template)}
              />
            ))}
          </div>
        )}
      </Spin>

      <Modal
        open={modalOpen}
        title={editing?.builtin ? "编辑工作区模板" : editing ? "编辑任务模板" : "新建任务模板"}
        width={720}
        okText={editing ? "保存修改" : "创建模板"}
        cancelText="取消"
        confirmLoading={saving}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
        className="work-template-editor-modal"
      >
        <div className="work-template-editor-intro">
          <strong>{editing?.builtin ? "修改将保存为当前工作区配置" : "模板负责预填，动作契约负责校验"}</strong>
          <span>{editing?.builtin ? "系统原始模板不会被改写，之后可随时恢复默认。" : "这里不能修改角色权限、审批规则和外部写入门禁。"}</span>
        </div>
        <Form form={form} layout="vertical" onFinish={(values) => void saveTemplate(values)}>
          <div className="work-template-form-grid">
            <Form.Item name="name" label="模板名称" rules={[{ required: true, message: "请输入模板名称" }]}>
              <Input maxLength={128} placeholder="例如：品牌 A 销售周报" />
            </Form.Item>
            <Form.Item name="category" label="模板分类" rules={[{ required: true }]}>
              <Select options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item name="actionName" label="绑定任务类型" rules={[{ required: true }]}>
              <Select options={actions.map((action) => ({ value: action.name, label: `${action.title} · ${action.name}` }))} />
            </Form.Item>
            <Form.Item name="visibility" label="可见范围" rules={[{ required: true }]}>
              <Select disabled={editing?.builtin} options={[{ value: "personal", label: "仅自己" }, { value: "workspace", label: "当前工作空间" }]} />
            </Form.Item>
          </div>
          <Form.Item name="description" label="模板说明">
            <Input maxLength={300} placeholder="说明适用场景和输出内容" />
          </Form.Item>
          <Form.Item name="prompt" label="默认任务描述" rules={[{ required: true, message: "请输入默认任务描述" }]}>
            <Input.TextArea rows={3} maxLength={2000} showCount placeholder="使用模板时将自动填入任务描述" />
          </Form.Item>

          {actionName === "report.generate" && (
            <section className="work-template-report-config">
              <div className="work-template-config-title"><strong>报告默认配置</strong><span>不选择品牌时代表全部品牌</span></div>
              <div className="work-template-form-grid is-three">
                <Form.Item name="outputType" label="输出方式">
                  <Select options={[
                    { value: "daily_report", label: "运营日报" },
                    { value: "weekly_report", label: "销售周报" },
                    { value: "monthly_report", label: "经营月报" },
                    { value: "management_summary", label: "管理摘要" },
                  ]} />
                </Form.Item>
                <Form.Item name="scope" label="数据范围">
                  <Select options={[
                    { value: "all", label: "全部平台" },
                    { value: "tmall", label: "天猫" },
                    { value: "douyin", label: "抖音" },
                    { value: "vip", label: "唯品会" },
                  ]} />
                </Form.Item>
                <Form.Item name="brandIds" label="品牌范围">
                  <Select mode="multiple" allowClear options={brandOptions} placeholder="全部品牌" />
                </Form.Item>
              </div>
            </section>
          )}

          <div className="work-template-form-grid">
            <Form.Item name="tags" label="标签">
              <Select mode="tags" maxCount={12} tokenSeparators={[",", "，"]} placeholder="输入标签后回车" />
            </Form.Item>
            <Form.Item name="estimatedMinutes" label="预计耗时（分钟）" rules={[{ required: true }]}>
              <InputNumber min={1} max={240} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item
            name="defaultsJson"
            label="高级默认参数"
            extra="可为其他任务类型填写动作参数 JSON；提交任务时仍会按动作契约重新校验。"
          >
            <Input.TextArea rows={4} className="work-template-json-editor" spellCheck={false} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default function WorkTemplates(props: { onUseTemplate: (templateKey: string) => void; createRequestId?: number }) {
  const [activeTab, setActiveTab] = useState("sops");
  useEffect(() => {
    if ((props.createRequestId || 0) > 0) setActiveTab("presets");
  }, [props.createRequestId]);
  return (
    <Tabs
      className="work-template-root-tabs"
      activeKey={activeTab}
      onChange={setActiveTab}
      items={[
        { key: "sops", label: "SOP 流程", children: <SopCenter /> },
        { key: "presets", label: "快速发起预设", children: <TaskPresetCenter {...props} /> },
      ]}
    />
  );
}

function TemplateCard({
  template,
  actionTitle,
  onUse,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  template: TaskTemplateItem;
  actionTitle: string;
  onUse: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const palette = CATEGORY_COLORS[template.category];
  const brands = Array.isArray(template.defaults?.brand_ids) ? template.defaults.brand_ids.map(String) : [];
  return (
    <article className="work-template-card">
      <div className="work-template-card-head">
        <span className="work-template-card-icon" style={{ color: palette.color, background: palette.soft }}>
          {CATEGORY_ICONS[template.category]}
        </span>
        <div className="work-template-card-meta">
          <strong>{template.name}</strong>
          <span>{CATEGORY_LABELS[template.category]} · {template.builtin ? template.overridden ? "系统内置 · 已自定义" : "系统内置" : template.visibility === "personal" ? "仅自己" : "工作空间共享"}</span>
        </div>
      </div>
      <p>{template.description || template.prompt}</p>
      <div className="work-template-contract"><span>任务类型</span><strong>{actionTitle}</strong></div>
      <div className="work-template-card-tags">
        {template.tags.slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)}
        {brands.length > 0 && <Tag color="gold">{brands.join("、")}</Tag>}
        <span className="work-template-card-duration"><ClockCircleOutlined /> 约 {template.estimatedMinutes} 分钟</span>
      </div>
      <div className="work-template-card-foot">
        <span className="work-template-card-preview"><BarChartOutlined /> 预填描述与执行配置</span>
        <Space size={4}>
          {template.canEdit && <Button type="text" size="small" icon={<EditOutlined />} aria-label={`编辑${template.name}`} onClick={onEdit} />}
          <Button type="text" size="small" icon={<CopyOutlined />} aria-label={`复制${template.name}`} onClick={onDuplicate} />
          {template.canReset && (
            <Popconfirm title="恢复系统默认模板？" description="当前工作区的自定义配置将被移除。" onConfirm={onDelete}>
              <Button type="text" size="small" icon={<UndoOutlined />} aria-label={`恢复${template.name}系统默认`} />
            </Popconfirm>
          )}
          {!template.builtin && template.canEdit && (
            <Popconfirm title="删除这个任务模板？" description="删除后不会影响已创建的任务。" onConfirm={onDelete}>
              <Button type="text" danger size="small" icon={<DeleteOutlined />} aria-label={`删除${template.name}`} />
            </Popconfirm>
          )}
          <Button type="primary" size="small" onClick={onUse}>使用模板</Button>
        </Space>
      </div>
    </article>
  );
}
