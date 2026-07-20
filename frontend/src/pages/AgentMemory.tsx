import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  BulbOutlined,
} from "@ant-design/icons";
import {
  createAgentMemory,
  deleteAgentMemory,
  deleteAgentSummary,
  deleteAgentSummaryByKey,
  getAgentDebugPack,
  getAgentMemories,
  getAgentSummaries,
  updateAgentMemory,
  type AgentMemoryItem,
  type AgentSessionSummary,
} from "../api/client";

const KIND_COLOR: Record<string, string> = {
  fact: "blue",
  preference: "purple",
  summary: "cyan",
};

export default function AgentMemoryPage() {
  const [memories, setMemories] = useState<AgentMemoryItem[]>([]);
  const [summaries, setSummaries] = useState<AgentSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<AgentMemoryItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [debug, setDebug] = useState<Record<string, unknown> | null>(null);
  const [debugKey, setDebugKey] = useState("");
  const [form] = Form.useForm();

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([getAgentMemories(), getAgentSummaries()])
      .then(([m, s]) => {
        setMemories(m.results || []);
        setSummaries(s.results || []);
      })
      .catch(() => message.error("加载记忆失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({ kind: "fact", scope: "user", importance: 5 });
    setCreating(true);
  };

  const openEdit = (row: AgentMemoryItem) => {
    setEditing(row);
    form.setFieldsValue({
      content: row.content,
      kind: row.kind,
      scope: row.scope,
      importance: row.importance,
      source: row.source,
    });
  };

  const submitForm = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await updateAgentMemory(editing.id, values);
        message.success("已更新");
        setEditing(null);
      } else {
        await createAgentMemory(values);
        message.success("已创建");
        setCreating(false);
      }
      load();
    } catch {
      message.error("保存失败");
    }
  };

  const loadDebug = async () => {
    try {
      const pack = await getAgentDebugPack({
        session_key: debugKey.trim() || undefined,
      });
      setDebug(pack as unknown as Record<string, unknown>);
    } catch {
      message.error("调试包加载失败");
    }
  };

  return (
    <div className="agent-memory-page">
      <header className="page-hero-head" style={{ marginBottom: 16 }}>
        <div className="page-hero-kicker">
          <BulbOutlined /> Context & Memory
        </div>
        <Typography.Title level={3} className="page-hero-title">
          Agent 记忆
        </Typography.Title>
        <Typography.Paragraph type="secondary" className="page-hero-desc">
          管理注入对话的用户记忆与会话摘要。Skill 脚本在沙箱中执行（超时 / cwd / 环境变量 / 命令白名单）。
        </Typography.Paragraph>
      </header>

      <Tabs
        items={[
          {
            key: "memories",
            label: "记忆条目",
            children: (
              <Card
                size="small"
                extra={
                  <Space>
                    <Button icon={<ReloadOutlined />} onClick={load}>
                      刷新
                    </Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                      新建
                    </Button>
                  </Space>
                }
              >
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading}
                  dataSource={memories}
                  pagination={{ pageSize: 20 }}
                  columns={[
                    {
                      title: "类型",
                      dataIndex: "kind",
                      width: 100,
                      render: (v: string) => <Tag color={KIND_COLOR[v] || "default"}>{v}</Tag>,
                    },
                    {
                      title: "范围",
                      dataIndex: "scope",
                      width: 90,
                    },
                    {
                      title: "内容",
                      dataIndex: "content",
                      ellipsis: true,
                    },
                    {
                      title: "重要度",
                      dataIndex: "importance",
                      width: 80,
                    },
                    {
                      title: "来源",
                      dataIndex: "source",
                      width: 140,
                      ellipsis: true,
                    },
                    {
                      title: "更新",
                      dataIndex: "updated_at",
                      width: 160,
                      render: (v: string) => v?.slice(0, 19).replace("T", " "),
                    },
                    {
                      title: "操作",
                      width: 120,
                      render: (_, row) => (
                        <Space>
                          <Button
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEdit(row)}
                          />
                          <Popconfirm
                            title="删除这条记忆？"
                            onConfirm={async () => {
                              await deleteAgentMemory(row.id);
                              message.success("已删除");
                              load();
                            }}
                          >
                            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "summaries",
            label: "会话摘要",
            children: (
              <Card
                size="small"
                extra={
                  <Button icon={<ReloadOutlined />} onClick={load}>
                    刷新
                  </Button>
                }
              >
                <Table
                  rowKey="id"
                  size="small"
                  loading={loading}
                  dataSource={summaries}
                  pagination={{ pageSize: 20 }}
                  columns={[
                    {
                      title: "会话键",
                      dataIndex: "session_key",
                      width: 280,
                      ellipsis: true,
                    },
                    {
                      title: "摘要",
                      dataIndex: "summary",
                      ellipsis: true,
                    },
                    {
                      title: "消息数",
                      dataIndex: "message_count",
                      width: 90,
                    },
                    {
                      title: "更新",
                      dataIndex: "updated_at",
                      width: 160,
                      render: (v: string) => v?.slice(0, 19).replace("T", " "),
                    },
                    {
                      title: "操作",
                      width: 100,
                      render: (_, row) => (
                        <Popconfirm
                          title="清空该会话摘要？"
                          onConfirm={async () => {
                            await deleteAgentSummary(row.id);
                            message.success("已清空");
                            load();
                          }}
                        >
                          <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "debug",
            label: "Context 调试",
            children: (
              <Card size="small">
                <Space style={{ marginBottom: 12 }} wrap>
                  <Input
                    placeholder="session_key（可选，如 collab:room:1）"
                    value={debugKey}
                    onChange={(e) => setDebugKey(e.target.value)}
                    style={{ width: 320 }}
                    allowClear
                  />
                  <Button type="primary" onClick={loadDebug}>
                    加载调试包
                  </Button>
                  {debugKey.trim() ? (
                    <Popconfirm
                      title="按 session_key 删除摘要？"
                      onConfirm={async () => {
                        await deleteAgentSummaryByKey(debugKey.trim());
                        message.success("已删除");
                        load();
                      }}
                    >
                      <Button danger>按键删摘要</Button>
                    </Popconfirm>
                  ) : null}
                </Space>
                <pre
                  style={{
                    margin: 0,
                    fontSize: 12,
                    maxHeight: 480,
                    overflow: "auto",
                    background: "var(--ant-color-fill-quaternary, #f5f5f5)",
                    padding: 12,
                    borderRadius: 8,
                  }}
                >
                  {debug ? JSON.stringify(debug, null, 2) : "尚未加载"}
                </pre>
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? "编辑记忆" : "新建记忆"}
        open={creating || !!editing}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
        }}
        onOk={submitForm}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="content" label="内容" rules={[{ required: true, message: "请填写内容" }]}>
            <Input.TextArea rows={4} maxLength={2000} showCount />
          </Form.Item>
          <Form.Item name="kind" label="类型">
            <Select
              options={[
                { value: "fact", label: "事实" },
                { value: "preference", label: "偏好" },
                { value: "summary", label: "摘要" },
              ]}
            />
          </Form.Item>
          <Form.Item name="scope" label="范围">
            <Select
              options={[
                { value: "user", label: "用户级" },
                { value: "session", label: "会话级" },
              ]}
            />
          </Form.Item>
          <Form.Item name="importance" label="重要度">
            <InputNumber min={0} max={10} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="source" label="来源">
            <Input placeholder="manual / collab:room:1 / ..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
