import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Input, List, Space, Switch, Tag, Typography } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, RobotOutlined, SendOutlined } from "@ant-design/icons";
import {
  createWeComGroupWebhook, deleteWeComGroupWebhook, getWeComGroups,
  testWeComGroupWebhook, updateWeComGroupWebhook, type WeComGroup,
} from "./mockWeCom";

interface Props { refreshKey?: number; onChanged?: () => void; }

export default function WeComGroupWebhookManager({ refreshKey = 0, onChanged }: Props) {
  const { message, modal } = App.useApp();
  const [groups, setGroups] = useState<WeComGroup[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => { try { setGroups(await getWeComGroups()); } catch { setGroups([]); } }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const save = async () => {
    if (!name.trim() || (!editingId && !url.trim())) { message.warning("请填写群聊名称和完整 Webhook 地址"); return; }
    setLoading(true);
    try {
      if (editingId) await updateWeComGroupWebhook(editingId, { name: name.trim(), ...(url.trim() ? { webhookUrl: url.trim() } : {}) });
      else await createWeComGroupWebhook(name.trim(), url.trim());
      setName(""); setUrl(""); setEditingId(null);
      message.success(editingId ? "群机器人配置已更新" : "群机器人 Webhook 已保存");
      await load(); onChanged?.();
    } catch (e: any) { message.error(e?.response?.data?.webhookUrl?.[0] || e?.response?.data?.detail || "Webhook 保存失败"); }
    finally { setLoading(false); }
  };

  const beginEdit = (group: WeComGroup) => { setEditingId(group.id); setName(group.name); setUrl(""); };
  const test = (group: WeComGroup) => modal.confirm({
    title: `向“${group.name}”发送测试消息？`,
    content: "该操作会真实向企业微信群发送一条“良策测试消息”。",
    okText: "确认发送", cancelText: "取消",
    onOk: async () => { await testWeComGroupWebhook(group.id); message.success("测试消息已被企业微信受理"); await load(); },
  });

  return <div className="wecom-group-webhook-manager">
    <div className="wecom-group-webhook-heading"><div><RobotOutlined /><span><strong>群聊通知 Webhook</strong><Typography.Text type="secondary">每个企业微信群配置一条，可同时管理多个群聊。</Typography.Text></span></div><Tag color="blue">已配置 {groups.length} 个</Tag></div>
    <Space.Compact block>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="群聊名称" style={{ width: "32%" }} />
      <Input.Password value={url} onChange={(e) => setUrl(e.target.value)} placeholder={editingId ? "留空表示不更换 Webhook" : "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."} />
      <Button type="primary" icon={editingId ? <EditOutlined /> : <PlusOutlined />} loading={loading} onClick={() => void save()}>{editingId ? "保存" : "添加"}</Button>
      {editingId && <Button onClick={() => { setEditingId(null); setName(""); setUrl(""); }}>取消</Button>}
    </Space.Compact>
    <Alert type="warning" showIcon message="“测试”会真实向对应企业微信群发送消息；Webhook 仅加密保存在服务端。" />
    <List size="small" locale={{ emptyText: "尚未配置群机器人 Webhook" }} dataSource={groups} renderItem={(group) => <List.Item actions={[
      <Switch key="enabled" checked={group.enabled} checkedChildren="启用" unCheckedChildren="停用" onChange={async (enabled) => { await updateWeComGroupWebhook(group.id, { enabled }); await load(); onChanged?.(); }} />,
      <Button key="test" type="text" size="small" icon={<SendOutlined />} disabled={!group.enabled} onClick={() => test(group)}>测试</Button>,
      <Button key="edit" type="text" size="small" icon={<EditOutlined />} onClick={() => beginEdit(group)}>编辑</Button>,
      <Button key="delete" danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => modal.confirm({ title: `删除“${group.name}”的群机器人？`, onOk: async () => { await deleteWeComGroupWebhook(group.id); message.success("已删除"); await load(); onChanged?.(); } })}>删除</Button>,
    ]}><List.Item.Meta avatar={<RobotOutlined />} title={<Space>{group.name}<Tag color={group.enabled ? "green" : "default"}>{group.enabled ? "可用" : "已停用"}</Tag></Space>} description={<span>{group.maskedWebhook}<br />{group.lastSuccessAt ? `最近成功：${new Date(group.lastSuccessAt).toLocaleString("zh-CN")}` : "尚无成功记录"}{group.lastErrorReason ? `；最近失败：${group.lastErrorReason}` : ""}</span>} /></List.Item>} />
  </div>;
}
