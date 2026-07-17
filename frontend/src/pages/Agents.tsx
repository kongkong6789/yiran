import { useEffect, useState } from "react";
import {
  Card, Row, Col, Form, Input, Button, Space, Avatar, Popconfirm,
  message, Empty, Tag, Alert, Modal, AutoComplete, Collapse, InputNumber, Select, Switch, Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined, EditOutlined } from "@ant-design/icons";
import { listAgents, createAgent, updateAgent, deleteAgent, type Agent } from "../api/client";

const EMOJI_CHOICES = ["🤖", "📈", "🧩", "💰", "🎯", "🧠", "⚙️", "🎨", "📊", "🛡️", "🚀", "🔬"];

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [llm, setLlm] = useState(false);
  const [emoji, setEmoji] = useState("🤖");
  const [form] = Form.useForm();

  // 编辑
  const [editing, setEditing] = useState<Agent | null>(null);
  const [editEmoji, setEditEmoji] = useState("🤖");
  const [editForm] = Form.useForm();

  const load = () => listAgents().then((d) => { setAgents(d.results); setLlm(d.llm); });
  useEffect(() => { load(); }, []);

  const openEdit = (a: Agent) => {
    setEditing(a);
    setEditEmoji(a.emoji);
    editForm.setFieldsValue({
      name: a.name, group: a.group, role: a.role, expertise: a.expertise, persona: a.persona,
      execution_role: a.execution_role, is_active: a.is_active, quota_limit: a.quota_limit,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const v = await editForm.validateFields();
    await updateAgent(editing.id, { ...v, emoji: editEmoji });
    message.success("已保存");
    setEditing(null);
    load();
  };

  const submit = async () => {
    const v = await form.validateFields();
    await createAgent({ ...v, emoji });
    message.success("已创建对象 Agent");
    form.resetFields();
    setEmoji("🤖");
    load();
  };

  const remove = async (id: number) => {
    await deleteAgent(id);
    message.success("已删除");
    load();
  };

  // 分类:去重 + 选项 + 分组
  const groups = Array.from(new Set(agents.map((a) => a.group || "未分类")));
  const groupOptions = groups.map((g) => ({ value: g }));

  const renderCard = (a: Agent) => (
    <Col key={a.id} xs={24} sm={12}>
      <Card size="small" hoverable>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <Avatar size={44} style={{ background: "#f0f5ff", fontSize: 22, flexShrink: 0 }}>
            {a.emoji}
          </Avatar>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{a.name}</div>
            <div style={{ marginTop: 2 }}>
              {a.role && <Tag color="blue">{a.role}</Tag>}
              {a.expertise && <Tag>{a.expertise}</Tag>}
              <Tag color={a.status === "available" ? "success" : "default"}>
                {a.status === "available" ? "任务可用" : a.status === "disabled" ? "已停用" : "额度已用尽"}
              </Tag>
            </div>
            {a.persona && (
              <Typography.Paragraph
                className="agent-card-persona"
                ellipsis={{ rows: 2, tooltip: a.persona }}
              >
                {a.persona}
              </Typography.Paragraph>
            )}
          </div>
          <Space direction="vertical" size={2} style={{ flexShrink: 0 }}>
            <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(a)} />
            <Popconfirm title="删除该对象?" onConfirm={() => remove(a.id)}>
              <Button size="small" danger type="text" icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        </div>
      </Card>
    </Col>
  );

  const collapseItems = groups.map((g) => {
    const list = agents.filter((a) => (a.group || "未分类") === g);
    return {
      key: g,
      label: (
        <span>
          {g} <Tag>{list.length}</Tag>
        </span>
      ),
      children: <Row gutter={[12, 12]}>{list.map(renderCard)}</Row>,
    };
  });

  return (
    <Row gutter={16}>
      <Col xs={24} lg={9}>
        <Card title="创建对象 Agent" size="small">
          {!llm && (
            <Alert
              style={{ marginBottom: 12 }}
              type="warning"
              showIcon
              message="未配置 LLM,会议将使用智能模拟发言。在 backend/.env 配置 LLM_API_KEY 后即为真实对话。"
            />
          )}
          <Form form={form} layout="vertical">
            <Form.Item label="头像">
              <Space wrap>
                {EMOJI_CHOICES.map((e) => (
                  <Button
                    key={e}
                    shape="circle"
                    type={emoji === e ? "primary" : "default"}
                    onClick={() => setEmoji(e)}
                  >
                    {e}
                  </Button>
                ))}
              </Space>
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
              <Input placeholder="如:增长官 / 产品官 / 财务官" />
            </Form.Item>
            <Form.Item name="group" label="分类">
              <AutoComplete
                options={groupOptions}
                placeholder="选择已有分类或输入新分类,如:运营团队 / 决策层"
                filterOption={(input, option) =>
                  String(option?.value ?? "").toLowerCase().includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item name="role" label="角色 / 人设">
              <Input placeholder="如:增长专家、谨慎的财务负责人" />
            </Form.Item>
            <Form.Item name="expertise" label="专长">
              <Input placeholder="如:用户增长、财务风控" />
            </Form.Item>
            <Form.Item name="persona" label="人设描述(可选,作为系统提示)">
              <Input.TextArea rows={3} placeholder="描述该 Agent 的立场、说话风格、关注点" />
            </Form.Item>
            <Form.Item name="execution_role" label="任务执行权限" initialValue="operator">
              <Select options={[
                { value: "operator", label: "操作员（1 万额度）" },
                { value: "manager", label: "主管（10 万额度）" },
                { value: "director", label: "总监（100 万额度）" },
              ]} />
            </Form.Item>
            <Form.Item name="quota_limit" label="任务额度上限" initialValue={10000}>
              <InputNumber min={0} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="is_active" label="允许用于任务执行" valuePropName="checked" initialValue>
              <Switch />
            </Form.Item>
            <Button type="primary" icon={<PlusOutlined />} onClick={submit} block>
              创建
            </Button>
          </Form>
        </Card>
      </Col>

      <Col xs={24} lg={15}>
        <Card title={`已有对象(${agents.length})· ${groups.length} 个分类`} size="small">
          {agents.length === 0 ? (
            <Empty description="还没有对象,先创建一个" />
          ) : (
            <Collapse defaultActiveKey={groups} items={collapseItems} />
          )}
        </Card>
      </Col>

      <Modal
        title="编辑对象 Agent"
        open={!!editing}
        onOk={saveEdit}
        onCancel={() => setEditing(null)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="头像">
            <Space wrap>
              {EMOJI_CHOICES.map((e) => (
                <Button
                  key={e}
                  shape="circle"
                  type={editEmoji === e ? "primary" : "default"}
                  onClick={() => setEditEmoji(e)}
                >
                  {e}
                </Button>
              ))}
            </Space>
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input placeholder="如:增长官 / 产品官 / 财务官" />
          </Form.Item>
          <Form.Item name="group" label="分类">
            <AutoComplete
              options={groupOptions}
              placeholder="选择已有分类或输入新分类"
              filterOption={(input, option) =>
                String(option?.value ?? "").toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="role" label="角色 / 人设">
            <Input placeholder="如:增长专家、谨慎的财务负责人" />
          </Form.Item>
          <Form.Item name="expertise" label="专长">
            <Input placeholder="如:用户增长、财务风控" />
          </Form.Item>
          <Form.Item name="persona" label="人设描述(可选,作为系统提示)">
            <Input.TextArea rows={3} placeholder="描述该 Agent 的立场、说话风格、关注点" />
          </Form.Item>
          <Form.Item name="execution_role" label="任务执行权限">
            <Select options={[
              { value: "operator", label: "操作员（1 万额度）" },
              { value: "manager", label: "主管（10 万额度）" },
              { value: "director", label: "总监（100 万额度）" },
            ]} />
          </Form.Item>
          <Form.Item name="quota_limit" label="任务额度上限">
            <InputNumber min={0} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="is_active" label="允许用于任务执行" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Row>
  );
}
