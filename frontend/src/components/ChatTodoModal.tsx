import { Alert, Avatar, DatePicker, Form, Input, Modal, Radio, Select, Space, Spin, Tag, Typography, message } from "antd";
import { CheckSquareOutlined, UserOutlined, WechatOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";

import {
  createWeComTodo,
  getUserSettings,
  getWeComCliConfig,
  type CollabMessage,
  type CollabUserBrief,
  type UserWeComBindingSummary,
  type WeComCliConfig,
} from "../api/client";
import { getWeComApiError, getWeComUsers, type WeComMember } from "../features/task-console/mockWeCom";

type TodoFormValues = {
  title: string;
  description?: string;
  wecomContactIds: number[];
  dueAt?: Dayjs;
  priority: "normal" | "high" | "urgent";
};

type ChatTodoModalProps = {
  open: boolean;
  source: CollabMessage | null;
  participants?: CollabUserBrief[];
  onClose: () => void;
  onCreated?: () => void;
};

const plainExcerpt = (value: string, max = 48) => {
  const text = String(value || "")
    .replace(/```[\s\S]*?```/g, "代码内容")
    .replace(/[#>*_`~\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "跟进聊天消息";
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const sourceDescription = (source: CollabMessage) => {
  const sender = source.sender?.display_name || source.sender?.username || "未知成员";
  const content = String(source.content || "").trim() || "[附件消息]";
  return `${content}\n\n—— 来源：团队聊天 #${source.id}，发送人：${sender}`;
};

export default function ChatTodoModal({
  open,
  source,
  onClose,
  onCreated,
}: ChatTodoModalProps) {
  const [form] = Form.useForm<TodoFormValues>();
  const [saving, setSaving] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contacts, setContacts] = useState<WeComMember[]>([]);
  const [contactsError, setContactsError] = useState("");
  const [cliConfig, setCliConfig] = useState<WeComCliConfig | null>(null);
  const [binding, setBinding] = useState<UserWeComBindingSummary | null>(null);

  const contactById = useMemo(
    () => new Map(contacts.map((item) => [item.contactId, item])),
    [contacts],
  );

  const selfContactId = binding?.status === "matched" ? binding.wecomContactId ?? null : null;
  const canUseWeCom = Boolean(cliConfig?.canUse);

  const contactOptions = useMemo(
    () => contacts
      .filter((item) => item.available)
      .map((item) => ({
        value: item.contactId,
        label: item.contactId === selfContactId ? `${item.name}（本人）` : item.name,
        searchText: `${item.name} ${item.department} ${item.position}`,
        option: item,
      })),
    [contacts, selfContactId],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setContactsLoading(true);
    setContactsError("");
    void Promise.all([
      getWeComUsers(),
      getWeComCliConfig().catch(() => null),
      getUserSettings().catch(() => null),
    ])
      .then(([users, config, settings]) => {
        if (cancelled) return;
        setContacts(users || []);
        setCliConfig(config);
        setBinding(settings?.wecom_binding || null);
      })
      .catch((error) => {
        if (cancelled) return;
        setContacts([]);
        setContactsError(getWeComApiError(error) || "企业微信通讯录读取失败");
      })
      .finally(() => {
        if (!cancelled) setContactsLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || !source) return;
    const defaultContactIds = selfContactId ? [selfContactId] : [];
    form.setFieldsValue({
      title: plainExcerpt(source.content),
      description: sourceDescription(source),
      wecomContactIds: defaultContactIds,
      priority: "normal",
      dueAt: dayjs().add(1, "day").hour(18).minute(0).second(0),
    });
  }, [form, open, selfContactId, source]);

  const submit = async () => {
    if (!source) return;
    const values = await form.validateFields();
    if (!canUseWeCom) {
      message.error("企业微信待办连接不可用，请先在工作待办中完成机器人配置");
      return;
    }
    const wecomContactIds = values.wecomContactIds || [];
    if (!wecomContactIds.length) {
      form.setFields([{ name: "wecomContactIds", errors: ["请选择至少一位企业微信负责人"] }]);
      return;
    }
    setSaving(true);
    try {
      await createWeComTodo({
        title: values.title.trim(),
        description: values.description?.trim(),
        platformAssigneeIds: [],
        wecomContactIds,
        dueAt: values.dueAt?.toISOString(),
        priority: values.priority,
        syncToWeCom: true,
      });
      message.success("企业微信待办已创建。可在「工作待办 → 我创建的」查看；若负责人已绑定平台账号，也会出现在其「我的待办」。");
      form.resetFields();
      onClose();
      onCreated?.();
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "待办发送失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      className="collab-todo-modal"
      title={(
        <Space size={10}>
          <CheckSquareOutlined />
          <span>发起企微待办</span>
        </Space>
      )}
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="发送到企业微信"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !source || !canUseWeCom }}
      width={640}
      destroyOnHidden
      afterClose={() => form.resetFields()}
    >
      <Alert
        type="info"
        showIcon
        icon={<WechatOutlined />}
        message={`关联聊天消息 #${source?.id || ""}`}
        description="可先修改标题与说明，再选择企业微信负责人。默认选中已绑定的本人。"
        style={{ marginBottom: 16 }}
      />
      {!canUseWeCom && (
        <Alert
          type="warning"
          showIcon
          message="企业微信待办连接不可用"
          description="请先在「工作待办」完成智能机器人配置后再发送。"
          style={{ marginBottom: 16 }}
        />
      )}
      {binding?.status !== "matched" && (
        <Alert
          type="warning"
          showIcon
          message="当前账号尚未绑定企业微信"
          description="无法默认选中本人，请手动从通讯录选择负责人，或前往「账号与企业成员 → 企微绑定」完成绑定。"
          style={{ marginBottom: 16 }}
        />
      )}
      <Form<TodoFormValues> form={form} layout="vertical" requiredMark="optional">
        <Form.Item
          name="title"
          label="待办标题"
          rules={[
            { required: true, message: "请输入待办标题" },
            { max: 120, message: "标题不能超过 120 个字符" },
          ]}
        >
          <Input autoFocus maxLength={120} showCount placeholder="概括需要跟进的事项" />
        </Form.Item>
        <Form.Item
          name="wecomContactIds"
          label="企业微信负责人"
          rules={[{ required: true, type: "array", min: 1, message: "请至少选择一位企业微信负责人" }]}
          extra={selfContactId ? "已默认选中本人，可继续追加或更换其他人。" : "请从企业微信通讯录中选择接收人。"}
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
              const isSelf = member.contactId === selfContactId;
              return (
                <div className="collab-todo-member-option">
                  <Avatar size={28} src={member.avatar || undefined} icon={!member.avatar ? <UserOutlined /> : undefined} />
                  <div className="collab-todo-member-copy">
                    <strong>{member.name}{isSelf ? "（本人）" : ""}</strong>
                    <span>{[member.department, member.position].filter(Boolean).join(" · ") || "企业微信成员"}</span>
                  </div>
                  {isSelf ? <Tag color="purple">本人</Tag> : <Tag color="success">企微</Tag>}
                </div>
              );
            }}
            tagRender={({ value, closable, onClose: closeTag }) => {
              const member = contactById.get(Number(value));
              const isSelf = Number(value) === selfContactId;
              return (
                <Tag className="collab-todo-member-tag" closable={closable} onClose={closeTag}>
                  <Avatar size={16} src={member?.avatar || undefined} icon={!member?.avatar ? <UserOutlined /> : undefined} />
                  <span>{member?.name || "企业微信成员"}{isSelf ? "（本人）" : ""}</span>
                </Tag>
              );
            }}
          />
        </Form.Item>
        {contactsError ? (
          <Alert
            type="warning"
            showIcon
            message={contactsError}
            action={(
              <Typography.Link
                onClick={() => {
                  setContacts([]);
                  setContactsError("");
                  setContactsLoading(true);
                  void getWeComUsers(true)
                    .then((users) => setContacts(users || []))
                    .catch((error) => setContactsError(getWeComApiError(error) || "企业微信通讯录读取失败"))
                    .finally(() => setContactsLoading(false));
                }}
              >
                重新读取
              </Typography.Link>
            )}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <div className="collab-todo-form-row">
          <Form.Item name="dueAt" label="截止时间" style={{ flex: 1, minWidth: 220 }}>
            <DatePicker
              showTime={{ format: "HH:mm" }}
              format="YYYY-MM-DD HH:mm"
              style={{ width: "100%" }}
              disabledDate={(current) => current && current.endOf("day").isBefore(dayjs())}
            />
          </Form.Item>
          <Form.Item name="priority" label="优先级" style={{ flex: 1 }}>
            <Radio.Group buttonStyle="solid">
              <Radio.Button value="normal">普通</Radio.Button>
              <Radio.Button value="high">高</Radio.Button>
              <Radio.Button value="urgent">紧急</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </div>
        <Form.Item
          name="description"
          label="待办说明"
          extra="可直接修改消息正文后再发送到企业微信。"
        >
          <Input.TextArea rows={5} maxLength={4000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
