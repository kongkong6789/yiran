import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Avatar, Button, Card, DatePicker, Empty, Form, Input, List, message, Modal, Popconfirm, Popover, Select, Segmented,
  Radio, Space, Spin, Switch, Tag, Tooltip, Typography,
} from "antd";
import {
  CheckCircleOutlined, CheckSquareOutlined, ClockCircleOutlined, DeleteOutlined, DownOutlined, FileTextOutlined,
  PlusOutlined, ReloadOutlined, SettingOutlined, SyncOutlined, TeamOutlined, UserOutlined, WechatOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";

import {
  createWeComTodo, deleteWeComTodo, getWeComCliConfig, getWeComTodoMembers, listWeComTodos,
  retryWeComTodoSync, setWeComTodoStatus, type WeComCliConfig, type WeComTodoMember, type WorkTodoItem,
} from "../api/client";
import {
  getWeComApiError, getWeComUsers, type WeComMember,
} from "../features/task-console/mockWeCom";

const errorText = (error: unknown) =>
  (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "操作失败，请稍后重试。";

const syncTag = (item: WorkTodoItem) => {
  if (item.syncStatus === "failed") return <Tag color="error">企微同步失败</Tag>;
  if (item.syncStatus === "pending") return <Tag color="processing">企微同步中</Tag>;
  if (item.syncStatus === "synced") return <Tag color="success">已同步企微</Tag>;
  if (item.syncStatus === "partial") return <Tag color="warning">部分同步企微</Tag>;
  return <Tag>仅平台</Tag>;
};

const RecipientSummary = ({ item }: { item: WorkTodoItem }) => {
  const recipients: NonNullable<WorkTodoItem["recipients"]> = item.recipients?.length
    ? item.recipients
    : item.assigneeNames.map((name) => ({
      name, type: "platform" as const, avatar: "", syncStatus: "not_requested" as const,
    }));
  if (!recipients.length) return <span>负责人：未指定</span>;

  const visibleRecipients = recipients.slice(0, 2);
  const remainingCount = recipients.length - visibleRecipients.length;
  const recipientList = (
    <div className="work-todo-recipient-popover">
      <div className="work-todo-recipient-popover-title">全部负责人（{recipients.length}）</div>
      {recipients.map((recipient, index) => (
        <div className="work-todo-recipient-detail" key={`${recipient.type}-${recipient.name}-${index}`}>
          <Avatar size={30} src={recipient.avatar || undefined} icon={!recipient.avatar ? <UserOutlined /> : undefined} />
          <span className="work-todo-recipient-detail-name">{recipient.name}</span>
          <Tag>{recipient.type === "wecom" ? "企微通讯录" : "平台成员"}</Tag>
        </div>
      ))}
    </div>
  );

  return (
    <span className="work-todo-recipient-summary">
      <span className="work-todo-recipient-label">负责人：</span>
      {visibleRecipients.map((recipient, index) => (
        <span className="work-todo-recipient-chip" key={`${recipient.type}-${recipient.name}-${index}`}>
          <Avatar size={20} src={recipient.avatar || undefined} icon={!recipient.avatar ? <UserOutlined /> : undefined} />
          <span>{recipient.name}</span>
          {recipient.type === "wecom" && <em>企微</em>}
        </span>
      ))}
      {remainingCount > 0 && (
        <Popover content={recipientList} trigger="click" placement="bottomLeft">
          <button type="button" className="work-todo-recipient-more" aria-label={`查看全部 ${recipients.length} 位负责人`}>
            +{remainingCount} 位
          </button>
        </Popover>
      )}
    </span>
  );
};

export default function WorkTodos() {
  const navigate = useNavigate();
  const [view, setView] = useState<"assigned" | "created">("assigned");
  const [status, setStatus] = useState<"pending" | "completed" | "all">("pending");
  const [items, setItems] = useState<WorkTodoItem[]>([]);
  const [members, setMembers] = useState<WeComTodoMember[]>([]);
  const [weComContacts, setWeComContacts] = useState<WeComMember[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const [config, setConfig] = useState<WeComCliConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retryingId, setRetryingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [form] = Form.useForm();
  const syncToWeCom = Form.useWatch("syncToWeCom", form) ?? false;

  const loadConfig = useCallback(async () => {
    try { setConfig(await getWeComCliConfig()); } catch { setConfig(null); } finally { setConfigLoaded(true); }
  }, []);
  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const result = await listWeComTodos(view, status === "all" ? undefined : status);
      setItems(result.results);
    } catch (error) {
      if (showLoading) {
        setItems([]);
        message.error(errorText(error));
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [status, view]);

  useEffect(() => {
    void loadConfig();
    void getWeComTodoMembers().then((r) => setMembers(r.results)).catch(() => setMembers([]));
  }, [loadConfig]);
  useEffect(() => {
    if (!createOpen || !syncToWeCom || contactsLoaded || contactsLoading) return;
    setContactsLoading(true);
    setContactsError("");
    void getWeComUsers()
      .then((results) => setWeComContacts(results.filter((item) => item.available)))
      .catch((error) => setContactsError(getWeComApiError(error)))
      .finally(() => { setContactsLoading(false); setContactsLoaded(true); });
  }, [contactsLoaded, contactsLoading, createOpen, syncToWeCom]);
  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    if (!items.some((item) => item.syncStatus === "pending")) return undefined;
    const timer = window.setTimeout(() => void load(false), 5000);
    return () => window.clearTimeout(timer);
  }, [items, load]);

  const openConfig = () => navigate("/connectors?section=wecom&tab=cli");
  const memberOptions = useMemo(() => members.map((member) => ({
    label: `${member.name}${member.department ? ` · ${member.department}` : ""}${member.bound ? " · 可同步企微" : " · 仅平台"}`,
    value: member.id,
  })), [members]);
  const platformMemberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const weComContactById = useMemo(
    () => new Map(weComContacts.map((member) => [member.contactId, member])),
    [weComContacts],
  );
  const contactOptions = useMemo(() => weComContacts.map((member) => ({
    label: member.name,
    value: member.contactId,
    searchText: `${member.name} ${member.department} ${member.position}`,
    option: member,
  })), [weComContacts]);
  const connectionState = !configLoaded
    ? "checking"
    : !config
      ? "error"
      : config.canUse
        ? "connected"
        : config.configured
          ? "restricted"
          : "unconfigured";
  const connectionLabel = connectionState === "checking"
    ? "正在检查企业微信连接"
    : connectionState === "connected"
      ? "企业微信待办已配置"
      : connectionState === "restricted"
        ? "企业微信待办暂无权限"
        : connectionState === "error"
          ? "企业微信连接状态异常"
          : "企业微信待办未配置";
  const connectionHint = connectionState === "checking"
    ? "正在读取当前企业的连接状态"
    : connectionState === "connected"
      ? "可创建并同步企业微信原生待办"
      : connectionState === "restricted"
        ? "请联系企业管理员调整使用范围"
        : connectionState === "error"
          ? "暂时无法读取连接状态"
          : "企业管理员可在企业微信连接中配置";

  const submitTodo = async () => {
    const values = await form.validateFields();
    const platformAssigneeIds: number[] = values.platformAssigneeIds || [];
    const wecomContactIds: number[] = values.wecomContactIds || [];
    if (!platformAssigneeIds.length && !wecomContactIds.length) {
      form.setFields([{ name: "platformAssigneeIds", errors: ["请至少选择一位平台负责人或企业微信负责人"] }]);
      return;
    }
    if (values.syncToWeCom && !wecomContactIds.length) {
      form.setFields([{ name: "wecomContactIds", errors: ["请选择至少一位需要同步的企业微信负责人"] }]);
      return;
    }
    setSaving(true);
    try {
      const response = await createWeComTodo({
        title: values.title, description: values.description, platformAssigneeIds, wecomContactIds,
        dueAt: values.dueAt?.toISOString(), priority: values.priority,
        syncToWeCom: Boolean(values.syncToWeCom),
      });
      if (response.syncStatus === "failed") message.warning("平台待办已创建，企业微信同步失败，可在列表中重新同步");
      else if (response.syncStatus === "synced") message.success("平台待办已创建并同步到企业微信");
      else if (response.syncStatus === "pending") message.success("平台待办已创建，正在同步企业微信");
      else message.success("平台待办已创建");
      form.resetFields(); setDescriptionOpen(false); setCreateOpen(false); setView("created");
    } catch (error) { message.error(errorText(error)); } finally { setSaving(false); }
  };

  return (
    <div className="work-todos-page">
      <div className="work-todos-head">
        <div>
          <Typography.Title level={3}>工作待办</Typography.Title>
          <Typography.Text type="secondary">平台统一记录待办，可按需同步到企业微信并持续更新状态。</Typography.Text>
        </div>
        <div className="work-todos-head-actions">
          <Tooltip title={connectionHint}>
            <div className={`work-todos-connection is-${connectionState}`} role="status" tabIndex={0}>
              <span className={`work-todos-connection-dot is-${connectionState}`} />
              <span className="work-todos-connection-copy">
                <strong>{connectionLabel}</strong>
              </span>
            </div>
          </Tooltip>
          <Space wrap>
            <Button icon={<SettingOutlined />} onClick={openConfig}>企业微信连接</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>创建待办</Button>
          </Space>
        </div>
      </div>

      <Card className="work-todos-card">
        <div className="work-todos-toolbar">
          <Segmented value={view} onChange={(value) => setView(value as typeof view)} options={[
            { label: "我的待办", value: "assigned", icon: <CheckCircleOutlined /> },
            { label: "我创建的", value: "created", icon: <TeamOutlined /> },
          ]} />
          <Space wrap>
            <Segmented
              className="work-todos-status-tabs"
              value={status}
              onChange={(value) => setStatus(value as typeof status)}
              options={[
                { label: "进行中", value: "pending" },
                { label: "历史待办", value: "completed" },
                { label: "全部", value: "all" },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void load(true)}>刷新</Button>
          </Space>
        </div>
        <Spin spinning={loading}>
          <List
            locale={{ emptyText: <Empty description={status === "completed" ? "暂无历史待办" : status === "all" ? "暂无待办记录" : "暂无进行中的待办"} /> }}
            dataSource={items}
            renderItem={(item) => (
              <List.Item className="work-todo-row" actions={[
                ...(item.syncStatus === "failed" ? [
                  <Button key="retry" type="link" icon={<SyncOutlined />} loading={retryingId === item.id} onClick={async () => {
                    setRetryingId(item.id);
                    try {
                      const result = await retryWeComTodoSync(item.id);
                      result.ok ? message.success("企业微信待办已重新同步") : message.warning(result.detail);
                      await load();
                    } catch (error) { message.error(errorText(error)); }
                    finally { setRetryingId(""); }
                  }}>重新同步</Button>,
                ] : []),
                ...(view === "assigned" && item.status !== "completed" ? [
                  <Button key="done" type="link" icon={<CheckCircleOutlined />} onClick={async () => {
                    try {
                      const result = await setWeComTodoStatus(item.id, "completed");
                      result.syncStatus === "failed"
                        ? message.warning("平台待办已完成，但企业微信状态同步失败")
                        : message.success("待办已完成，可在“历史待办”中查看");
                      await load();
                    } catch (error) { message.error(errorText(error)); }
                  }}>完成</Button>,
                ] : []),
                ...(view === "created" ? [
                  <Popconfirm
                    key="delete"
                    title="删除这个待办？"
                    description={item.syncRequested ? "将同时删除平台记录和企业微信待办，删除后无法恢复。" : "删除后无法恢复。"}
                    okText="确认删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={async () => {
                      setDeletingId(item.id);
                      try {
                        const result = await deleteWeComTodo(item.id);
                        message.success(result.detail);
                        await load(false);
                      } catch (error) {
                        message.error(errorText(error));
                      } finally {
                        setDeletingId("");
                      }
                    }}
                  >
                    <Button danger type="link" icon={<DeleteOutlined />} loading={deletingId === item.id}>删除</Button>
                  </Popconfirm>,
                ] : []),
              ]}>
                <List.Item.Meta
                  avatar={<Avatar className={item.status === "completed" ? "done" : ""} icon={item.status === "completed" ? <CheckCircleOutlined /> : <ClockCircleOutlined />} />}
                  title={<Space wrap><span>{item.title}</span><Tag color={item.status === "completed" ? "green" : "gold"}>{item.status === "completed" ? "已完成" : "进行中"}</Tag>{syncTag(item)}{item.priority === "urgent" && <Tag color="red">紧急</Tag>}</Space>}
                  description={<div><Space size={18} wrap><span>创建人：{item.creatorName}</span><RecipientSummary item={item} />{item.dueAt && <span>截止：{dayjs(item.dueAt).format("YYYY-MM-DD HH:mm")}</span>}</Space>{item.syncErrorReason && <Typography.Text className="work-todo-sync-error" type="danger">{item.syncErrorReason}</Typography.Text>}</div>}
                />
              </List.Item>
            )}
          />
        </Spin>
      </Card>

      <Modal
        className="work-todo-create-modal"
        width={740}
        centered
        title={(
          <div className="work-todo-create-title">
            <span className="work-todo-create-title-icon"><CheckSquareOutlined /></span>
            <span>
              <strong>创建待办</strong>
              <small>分配任务并按需同步至企业微信</small>
            </span>
          </div>
        )}
        open={createOpen}
        onCancel={() => { if (!saving) { setCreateOpen(false); setDescriptionOpen(false); } }}
        footer={[
          <Button key="cancel" className="work-todo-create-cancel" disabled={saving} onClick={() => { setCreateOpen(false); setDescriptionOpen(false); }}>取消</Button>,
          <Button key="submit" className="work-todo-create-submit" type="primary" loading={saving} onClick={() => void submitTodo()}>创建待办</Button>,
        ]}
      >
        <Form
          form={form}
          layout="vertical"
          className="work-todo-create-form"
          initialValues={{ priority: "normal", syncToWeCom: false, platformAssigneeIds: [], wecomContactIds: [] }}
        >
          <Form.Item name="title" label="待办内容" rules={[{ required: true, message: "请输入待办内容" }]}>
            <Input maxLength={200} placeholder="请输入待办内容" />
          </Form.Item>

          <Form.Item name="platformAssigneeIds" label="平台负责人" required>
            <Select
              mode="multiple"
              showSearch
              allowClear
              optionFilterProp="label"
              options={memberOptions}
              placeholder="选择平台成员；未绑定企微也可以接收平台待办"
              optionRender={(option) => {
                const member = platformMemberById.get(Number(option.value));
                if (!member) return option.label;
                return (
                  <div className="work-todo-member-option">
                    <Avatar size={34} src={member.avatar || undefined} icon={!member.avatar ? <UserOutlined /> : undefined} />
                    <div className="work-todo-member-option-copy">
                      <strong>{member.name}</strong>
                      <span>{member.department || "当前企业成员"}</span>
                    </div>
                    <Tag color={member.bound ? "success" : "default"}>{member.bound ? "已绑定企微" : "仅平台"}</Tag>
                  </div>
                );
              }}
              tagRender={({ value, closable, onClose }) => {
                const member = platformMemberById.get(Number(value));
                return (
                  <Tag className="work-todo-member-tag" closable={closable} onClose={onClose}>
                    <Avatar size={18} src={member?.avatar || undefined} icon={!member?.avatar ? <UserOutlined /> : undefined} />
                    <span>{member?.name || "平台成员"}</span>
                  </Tag>
                );
              }}
            />
          </Form.Item>
          <Typography.Paragraph type="secondary" className="work-todo-recipient-hint">
            平台负责人会在“我的待办”中收到任务；未绑定企业微信时默认不推送企微待办。
          </Typography.Paragraph>

          <Form.Item name="dueAt" label="截止时间">
            <DatePicker showTime style={{ width: "100%" }} placeholder="请选择日期和时间" />
          </Form.Item>

          <Form.Item name="priority" label="优先级" className="work-todo-priority-field">
            <Radio.Group>
              <Radio.Button className="is-normal" value="normal">普通</Radio.Button>
              <Radio.Button className="is-high" value="high">重要</Radio.Button>
              <Radio.Button className="is-urgent" value="urgent">紧急</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <button
            type="button"
            className={`work-todo-description-toggle${descriptionOpen ? " is-open" : ""}`}
            aria-expanded={descriptionOpen}
            onClick={() => setDescriptionOpen((value) => !value)}
          >
            <span><FileTextOutlined />添加补充说明</span>
            <DownOutlined />
          </button>
          {descriptionOpen && (
            <Form.Item name="description" className="work-todo-description-field">
              <Input.TextArea rows={3} maxLength={1000} showCount placeholder="补充任务背景、交付要求或注意事项" />
            </Form.Item>
          )}

          <div className={`work-todo-sync-option${syncToWeCom ? " is-enabled" : ""}`}>
            <span className="work-todo-sync-icon"><WechatOutlined /></span>
            <div className="work-todo-sync-copy">
              <span><strong>同步至企业微信待办</strong>{config?.canUse && <Tag color="success">已连接</Tag>}</span>
              {!config?.canUse && <small>当前连接不可用，本次将仅创建平台待办</small>}
            </div>
            <Form.Item name="syncToWeCom" valuePropName="checked" noStyle>
              <Switch disabled={!config?.canUse} onChange={(checked) => { if (!checked) form.setFieldValue("wecomContactIds", []); }} />
            </Form.Item>
          </div>

          {syncToWeCom && (
            <div className="work-todo-wecom-recipient-box">
              <Form.Item
                name="wecomContactIds"
                label="企业微信负责人"
                required
                extra="这里只选择需要收到企业微信待办的人；平台负责人不会被自动加入。"
                rules={[{ required: true, message: "请选择至少一位需要同步的企业微信负责人" }]}
              >
                <Select
                  mode="multiple"
                  showSearch
                  allowClear
                  optionFilterProp="searchText"
                  optionLabelProp="label"
                  options={contactOptions}
                  loading={contactsLoading}
                  placeholder="从企业微信通讯录选择负责人"
                  notFoundContent={contactsLoading ? <Spin size="small" /> : "暂无可用通讯录成员"}
                  optionRender={({ data }) => {
                    const member = data.option as WeComMember;
                    return (
                      <div className="work-todo-member-option">
                        <Avatar size={34} src={member.avatar || undefined} icon={!member.avatar ? <UserOutlined /> : undefined} />
                        <div className="work-todo-member-option-copy">
                          <strong>{member.name}</strong>
                          <span>{[member.department, member.position].filter(Boolean).join(" · ") || "企业微信成员"}</span>
                        </div>
                        <Tag color="success">企微通讯录</Tag>
                      </div>
                    );
                  }}
                  tagRender={({ value, closable, onClose }) => {
                    const member = weComContactById.get(Number(value));
                    return (
                      <Tag className="work-todo-member-tag" closable={closable} onClose={onClose}>
                        <Avatar size={18} src={member?.avatar || undefined} icon={!member?.avatar ? <UserOutlined /> : undefined} />
                        <span>{member?.name || "企业微信成员"}</span>
                      </Tag>
                    );
                  }}
                />
              </Form.Item>
              {contactsError && <Alert type="warning" showIcon message={contactsError} action={<Button type="link" size="small" onClick={() => { setWeComContacts([]); setContactsError(""); setContactsLoaded(false); }}>重新读取</Button>} />}
              {!contactsError && <Alert type="info" showIcon message="企业微信待办只会发送给这里明确选择的成员。" />}
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
}
