import { Alert, DatePicker, Form, Input, Modal, Radio, Select, Space, Typography, message } from "antd";
import { CheckSquareOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";

import {
  createWeComTodo,
  type CollabMessage,
  type CollabUserBrief,
} from "../api/client";

type TodoFormValues = {
  title: string;
  description?: string;
  platformAssigneeIds: number[];
  dueAt?: Dayjs;
  priority: "normal" | "high" | "urgent";
};

type ChatTodoModalProps = {
  open: boolean;
  source: CollabMessage | null;
  participants: CollabUserBrief[];
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
  participants,
  onClose,
  onCreated,
}: ChatTodoModalProps) {
  const [form] = Form.useForm<TodoFormValues>();
  const [saving, setSaving] = useState(false);
  const memberOptions = useMemo(
    () => participants
      .filter((item) => item.kind !== "bot" && item.bot_id !== "xiaoce")
      .map((item) => ({
        value: item.id,
        label: item.display_name || item.nickname || item.username,
      })),
    [participants],
  );

  useEffect(() => {
    if (!open || !source) return;
    const senderIsMember = memberOptions.some((item) => item.value === source.sender?.id);
    form.setFieldsValue({
      title: plainExcerpt(source.content),
      description: sourceDescription(source),
      platformAssigneeIds: senderIsMember ? [source.sender.id] : [],
      priority: "normal",
      dueAt: dayjs().add(1, "day").hour(18).minute(0).second(0),
    });
  }, [form, memberOptions, open, source]);

  const submit = async () => {
    if (!source) return;
    const values = await form.validateFields();
    setSaving(true);
    try {
      await createWeComTodo({
        title: values.title.trim(),
        description: values.description?.trim(),
        platformAssigneeIds: values.platformAssigneeIds,
        wecomContactIds: [],
        dueAt: values.dueAt?.toISOString(),
        priority: values.priority,
        syncToWeCom: false,
      });
      message.success("待办已发送");
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
          <span>从聊天发起待办</span>
        </Space>
      )}
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="发送待办"
      cancelText="取消"
      confirmLoading={saving}
      okButtonProps={{ disabled: !source }}
      width={620}
      destroyOnHidden
      afterClose={() => form.resetFields()}
    >
      <Alert
        type="info"
        showIcon
        message={`关联聊天消息 #${source?.id || ""}`}
        description="消息正文会写入待办说明，方便负责人回看上下文。"
        style={{ marginBottom: 16 }}
      />
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
          name="platformAssigneeIds"
          label="负责人"
          rules={[{ required: true, type: "array", min: 1, message: "请至少选择一位负责人" }]}
        >
          <Select
            mode="multiple"
            showSearch
            optionFilterProp="label"
            options={memberOptions}
            placeholder="从当前会话成员中选择"
            maxTagCount="responsive"
          />
        </Form.Item>
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
        <Form.Item name="description" label="待办说明">
          <Input.TextArea rows={5} maxLength={4000} showCount />
        </Form.Item>
        <Typography.Text type="secondary">
          当前从平台内发送；如需同步企业微信，可在“工作待办”中继续操作。
        </Typography.Text>
      </Form>
    </Modal>
  );
}
