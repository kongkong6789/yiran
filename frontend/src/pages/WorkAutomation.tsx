import {
  BellOutlined, CheckCircleOutlined, ClockCircleOutlined, DatabaseOutlined,
  FileTextOutlined, PlayCircleOutlined, PlusOutlined,
  RobotOutlined, SafetyCertificateOutlined, StopOutlined, ThunderboltOutlined,
  UserOutlined, WechatWorkOutlined,
} from "@ant-design/icons";
import {
  App, Button, Empty, Form, Input, Modal, Segmented, Select,
  Space, Switch, Tag,
} from "antd";
import { useEffect, useMemo, useState } from "react";

import {
  api, createWorkAutomation, listWorkAutomations, runSop, updateWorkAutomation,
  type WorkAutomationInput, type WorkAutomationItem, type WorkAutomationStats,
} from "../api/client";
import { getWeComUsers, type WeComMember } from "../features/task-console/mockWeCom";
import { createTaskTraceId } from "../utils/traceId";

type TriggerType = WorkAutomationInput["triggerType"];
type NotificationChannel = WorkAutomationInput["channel"];

type AutomationTemplate = {
  key: string;
  name: string;
  description: string;
  triggerType: TriggerType;
  triggerRule: string;
  action: string;
  channel: NotificationChannel;
  icon: React.ReactNode;
  color: string;
  soft: string;
};

type AutomationFormValues = WorkAutomationInput;

const TRIGGER_RULE_OPTIONS: Record<TriggerType, Array<{ value: string; label: React.ReactNode }>> = {
  schedule: [
    { value: "每天 09:00", label: <span className="work-automation-select-label"><ClockCircleOutlined />每天 09:00</span> },
    { value: "每天 18:00", label: <span className="work-automation-select-label"><ClockCircleOutlined />每天 18:00</span> },
    { value: "工作日 10:00", label: <span className="work-automation-select-label"><ClockCircleOutlined />工作日 10:00</span> },
    { value: "每 2 小时", label: <span className="work-automation-select-label"><ClockCircleOutlined />每 2 小时</span> },
  ],
  data: [
    { value: "经营数据更新时", label: <span className="work-automation-select-label"><DatabaseOutlined />经营数据更新时</span> },
    { value: "库存低于安全阈值时", label: <span className="work-automation-select-label"><DatabaseOutlined />库存低于安全阈值时</span> },
    { value: "待办状态变化时", label: <span className="work-automation-select-label"><DatabaseOutlined />待办状态变化时</span> },
  ],
  manual: [
    { value: "仅手动或测试执行", label: <span className="work-automation-select-label"><PlayCircleOutlined />仅手动或测试执行</span> },
  ],
};

const TEMPLATES: AutomationTemplate[] = [
  {
    key: "daily-report", name: "每日经营日报", triggerType: "schedule", triggerRule: "每天 09:00",
    description: "汇总昨日销售、退款、库存异常并生成经营摘要。",
    action: "读取经营数据，生成日报并标记需要关注的异常。", channel: "wecom",
    icon: <FileTextOutlined />, color: "#6d4ed7", soft: "#f0ebff",
  },
  {
    key: "inventory-watch", name: "库存异常巡检", triggerType: "data", triggerRule: "库存低于安全阈值时",
    description: "检查低库存、断货风险与异常周转商品。",
    action: "扫描库存数据，发现异常时生成处理建议并通知负责人。", channel: "in_app",
    icon: <DatabaseOutlined />, color: "#16806f", soft: "#e5f6f2",
  },
  {
    key: "todo-reminder", name: "企业微信待办提醒", triggerType: "schedule", triggerRule: "工作日 10:00",
    description: "对临期和逾期待办进行集中提醒，减少遗漏。",
    action: "查找 24 小时内到期及已逾期待办，向相关成员发送提醒。", channel: "wecom",
    icon: <BellOutlined />, color: "#b76b12", soft: "#fff3e2",
  },
];

const TRIGGER_LABELS: Record<TriggerType, string> = {
  schedule: "定时触发", data: "数据变化", manual: "手动触发",
};
const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  none: "不通知", in_app: "站内通知", wecom: "企业微信",
};

const errorDetail = (error: any) => String(
  error?.response?.data?.detail || error?.response?.data?.error || error?.message || "操作失败，请稍后重试",
);

export default function WorkAutomation({ createRequestId = 0 }: { createRequestId?: number }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<AutomationFormValues>();
  const triggerType = Form.useWatch("triggerType", form) || "schedule";
  const channel = Form.useWatch("channel", form) || "none";
  const enabled = Form.useWatch("enabled", form) || false;
  const [automations, setAutomations] = useState<WorkAutomationItem[]>([]);
  const [stats, setStats] = useState<WorkAutomationStats>({ saved: 0, enabled: 0, nextRunAt: null, todayRuns: 0 });
  const [members, setMembers] = useState<WeComMember[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [view, setView] = useState<"all" | "enabled">("all");

  const loadAutomations = async () => {
    setLoading(true);
    try {
      const response = await listWorkAutomations();
      setAutomations(response.results);
      setStats(response.stats);
    } catch (error) {
      message.error(errorDetail(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadAutomations(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = async (template?: AutomationTemplate) => {
    form.setFieldsValue({
      name: template?.name || "",
      triggerType: template?.triggerType || "schedule",
      triggerRule: template?.triggerRule || "每天 09:00",
      action: template?.action || "",
      channel: template?.channel || "wecom",
      recipientContactIds: [],
      enabled: false,
    });
    setModalOpen(true);
    try {
      setMembers(await getWeComUsers());
    } catch (error) {
      message.warning(errorDetail(error));
    }
  };

  useEffect(() => {
    if (createRequestId > 0) void openCreate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequestId]);

  const visibleAutomations = useMemo(() => automations.filter((item) => (
    (view === "all" || item.enabled)
    && (!keyword || `${item.name} ${item.action}`.toLowerCase().includes(keyword.toLowerCase()))
  )), [automations, keyword, view]);

  const saveConfiguration = async (values: AutomationFormValues) => {
    setSaving(true);
    try {
      const response = await createWorkAutomation({
        ...values,
        name: values.name.trim(),
        triggerRule: values.triggerRule.trim(),
        action: values.action.trim(),
        recipientContactIds: values.channel === "wecom" ? values.recipientContactIds : [],
      });
      setAutomations((current) => [response.automation, ...current]);
      setStats((current) => ({
        ...current,
        saved: current.saved + 1,
        enabled: current.enabled + (response.automation.enabled ? 1 : 0),
        nextRunAt: response.automation.nextRunAt && (!current.nextRunAt || response.automation.nextRunAt < current.nextRunAt)
          ? response.automation.nextRunAt : current.nextRunAt,
      }));
      setModalOpen(false);
      form.resetFields();
      message.success(values.enabled ? "配置已保存并标记为启用" : "自动化配置已保存");
    } catch (error) {
      message.error(errorDetail(error));
    } finally {
      setSaving(false);
    }
  };

  const testExecution = async () => {
    const values = await form.validateFields();
    setTesting(true);
    const traceId = createTaskTraceId();
    try {
      const result = await runSop({
        text: values.action.trim(),
        payload: { automation_test: true, trigger_type: values.triggerType, trigger_rule: values.triggerRule },
        trace_id: traceId,
      });
      if (result.decision === "block" || (result.decision === "allow" && result.result?.ok === false)) {
        throw new Error(String(result.result?.user_message || result.result?.error || "测试执行被业务规则阻止"));
      }
      if (values.channel === "wecom") {
        const selected = members.filter((member) => values.recipientContactIds.includes(member.contactId));
        await api.post("/wecom/notifications/", {
          mode: "person",
          recipientContactIds: values.recipientContactIds,
          task: `[自动化测试] ${values.name}\n${values.action}`,
          agentName: "自动化助手",
          targetLabel: selected.map((member) => member.name).join("、"),
          taskTraceId: traceId,
          idempotencyKey: `${traceId}:automation-test`,
        });
      }
      message.success(values.channel === "wecom" ? "测试执行成功，企业微信通知已提交" : "测试执行成功");
    } catch (error) {
      message.error(`测试执行失败：${errorDetail(error)}`);
    } finally {
      setTesting(false);
    }
  };

  const toggleEnabled = async (item: WorkAutomationItem, enabled: boolean) => {
    try {
      const response = await updateWorkAutomation(item.id, { enabled });
      setAutomations((current) => current.map((row) => row.id === item.id ? response.automation : row));
      await loadAutomations();
      message.success(enabled ? "已启用，后台调度器将按规则执行" : "已停用自动执行");
    } catch (error) {
      message.error(errorDetail(error));
    }
  };

  return (
    <div className="work-automation-page">
      <section className="work-automation-notice">
        <span><SafetyCertificateOutlined /></span>
        <div>
          <strong>自动化配置中心</strong>
          <p>配置、执行计划和运行记录均已持久化；启用后由后台常驻调度器执行真实任务，并按配置发送通知。</p>
        </div>
        <Tag className="work-automation-stage-tag">调度已接入</Tag>
      </section>

      <section className="work-automation-stats" aria-label="自动化概览">
        <div><span>已保存</span><strong>{stats.saved}</strong><small>账号自动化配置</small></div>
        <div><span>已启用</span><strong>{stats.enabled}</strong><small>由后台调度器持续监听</small></div>
        <div><span>下次运行</span><strong>{stats.nextRunAt ? new Date(stats.nextRunAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "—"}</strong><small>{stats.nextRunAt ? new Date(stats.nextRunAt).toLocaleDateString("zh-CN") : "没有待执行计划"}</small></div>
        <div><span>今日执行</span><strong>{stats.todayRuns}</strong><small>来自真实调度运行记录</small></div>
      </section>

      <section className="work-automation-toolbar">
        <Segmented value={view} onChange={(value) => setView(value as "all" | "enabled")} options={[
          { label: "全部", value: "all" },
          { label: `已启用 ${automations.filter((item) => item.enabled).length}`, value: "enabled" },
        ]} />
        <Input.Search allowClear value={keyword} placeholder="搜索自动化名称或动作" onChange={(event) => setKeyword(event.target.value)} />
        <Button icon={<PlusOutlined />} onClick={() => void openCreate()}>新建配置</Button>
      </section>

      <div className="work-automation-layout">
        <section className="work-automation-list-panel">
          <div className="work-automation-section-title">
            <div><strong>我的自动化</strong><span>集中管理触发规则、执行动作和通知方式</span></div>
            <Tag>{visibleAutomations.length} 项</Tag>
          </div>
          {loading ? <div className="work-automation-loading">正在加载配置…</div> : visibleAutomations.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={keyword ? "没有匹配的自动化配置" : "还没有自动化配置"}>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => void openCreate()}>创建第一个自动化</Button>
            </Empty>
          ) : (
            <div className="work-automation-draft-list">
              {visibleAutomations.map((item) => (
                <article key={item.id} className="work-automation-draft-card">
                  <span className="work-automation-draft-icon"><PlayCircleOutlined /></span>
                  <div className="work-automation-draft-copy">
                    <Space size={8} wrap><strong>{item.name}</strong><Tag color={item.enabled ? "green" : "default"}>{item.enabled ? "已启用" : "未启用"}</Tag></Space>
                    <p>{item.action}</p>
                    <div>
                      <span><ClockCircleOutlined /> {TRIGGER_LABELS[item.triggerType]} · {item.triggerRule}</span>
                      <span><BellOutlined /> {CHANNEL_LABELS[item.channel]}</span>
                    </div>
                  </div>
                  <div className="work-automation-card-switch"><small>执行</small><Switch size="small" checked={item.enabled} onChange={(checked) => void toggleEnabled(item, checked)} /></div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="work-automation-template-panel">
          <div className="work-automation-section-title"><div><strong>快捷模板</strong><span>选择模板后仍需确认接收人与执行状态</span></div></div>
          <div className="work-automation-template-list">
            {TEMPLATES.map((template) => (
              <button type="button" key={template.key} onClick={() => void openCreate(template)}>
                <span style={{ color: template.color, background: template.soft }}>{template.icon}</span>
                <div><strong>{template.name}</strong><p>{template.description}</p><small>{template.triggerRule} · {CHANNEL_LABELS[template.channel]}</small></div>
                <ThunderboltOutlined />
              </button>
            ))}
          </div>
        </aside>
      </div>

      <Modal
        className="work-automation-modal" width={820} centered open={modalOpen}
        title={<div className="work-automation-modal-heading"><span><RobotOutlined /></span><div><strong>新建自动化配置</strong><small>保存配置、设置执行状态，并可在启用前进行一次真实测试。</small></div></div>}
        onCancel={() => setModalOpen(false)} forceRender destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setModalOpen(false)}>取消</Button>,
          <Button key="test" className="work-automation-test-button" icon={<ThunderboltOutlined />} loading={testing} disabled={saving} onClick={() => void testExecution()}>测试执行</Button>,
          <Button key="save" type="primary" icon={<CheckCircleOutlined />} loading={saving} disabled={testing} onClick={() => form.submit()}>保存配置</Button>,
        ]}
      >
        <Form className="work-automation-modal-form" form={form} layout="vertical" onFinish={saveConfiguration} initialValues={{ triggerType: "schedule", triggerRule: "每天 09:00", channel: "wecom", recipientContactIds: [], enabled: false }}>
          <Form.Item label="自动化名称" name="name" rules={[{ required: true, message: "请输入自动化名称" }]}><Input placeholder="例如：每日经营日报" maxLength={60} /></Form.Item>
          <div className="work-automation-form-grid">
            <Form.Item label="触发方式" name="triggerType" rules={[{ required: true }]}>
              <Select onChange={(value: TriggerType) => form.setFieldValue("triggerRule", TRIGGER_RULE_OPTIONS[value][0].value)} options={[
                { value: "schedule", label: "定时触发" }, { value: "data", label: "数据变化" }, { value: "manual", label: "手动触发" },
              ]} />
            </Form.Item>
            <Form.Item label="触发规则" name="triggerRule" rules={[{ required: true, message: "请选择触发规则" }]}>
              <Select options={TRIGGER_RULE_OPTIONS[triggerType as TriggerType]} />
            </Form.Item>
          </div>
          <Form.Item label="执行动作" name="action" rules={[{ required: true, message: "请描述要执行的动作" }]}>
            <Input.TextArea rows={4} placeholder="描述 AI 需要读取什么数据、完成什么动作、输出什么结果" maxLength={500} showCount />
          </Form.Item>
          <div className="work-automation-form-grid">
            <Form.Item label="完成后通知" name="channel" rules={[{ required: true }]}>
              <Select options={[
                { value: "none", label: <span className="work-automation-select-label is-none"><StopOutlined />不通知</span> },
                { value: "in_app", label: <span className="work-automation-select-label is-in-app"><BellOutlined />站内通知</span> },
                { value: "wecom", label: <span className="work-automation-select-label is-wecom"><WechatWorkOutlined />企业微信</span> },
              ]} />
            </Form.Item>
            <Form.Item label="保存后执行" name="enabled" valuePropName="checked">
              <div className="work-automation-enable-field"><Switch checked={enabled} onChange={(checked) => form.setFieldValue("enabled", checked)} /><span>{enabled ? "启用" : "暂不启用"}</span></div>
            </Form.Item>
          </div>
          {channel === "wecom" && (
            <Form.Item label="企业微信接收人" name="recipientContactIds" rules={[{ required: true, type: "array", min: 1, message: "请选择至少一位企业微信接收人" }]}>
              <Select mode="multiple" showSearch optionFilterProp="label" placeholder="选择接收测试结果和正式通知的成员" maxTagCount="responsive" options={members.map((member) => ({
                value: member.contactId,
                label: `${member.name}${member.department ? ` · ${member.department}` : ""}`,
                disabled: !member.available,
              }))} suffixIcon={<UserOutlined />} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
