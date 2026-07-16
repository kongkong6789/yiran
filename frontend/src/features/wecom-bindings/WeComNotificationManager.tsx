import { useEffect, useState } from "react";
import { App, Button, Space, Table, Tag, Typography } from "antd";
import { ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { api } from "../../api/client";

interface NotificationRow {
  id: number;
  userId: number;
  userName: string;
  channelLabel: string;
  target_label: string;
  status: "pending" | "retry_waiting" | "accepted" | "partial" | "failed";
  statusLabel: string;
  retry_count: number;
  max_retries: number;
  next_retry_at?: string | null;
  last_attempt_at?: string | null;
  error_reason?: string;
}

const statusColor: Record<NotificationRow["status"], string> = {
  pending: "default", retry_waiting: "blue", accepted: "green", partial: "gold", failed: "red",
};
const fmt = (value?: string | null) => value ? value.slice(0, 19).replace("T", " ") : "—";

export default function WeComNotificationManager() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<number>();

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get("/wecom/notifications/?all=1");
      setRows(response.data.results || []);
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "加载通知记录失败");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const retry = async (row: NotificationRow) => {
    setRetryingId(row.id);
    try {
      const response = await api.post(`/wecom/notifications/${row.id}/retry/`, {});
      const status = response.data.notification.status;
      message.success(status === "retry_waiting" ? "发送仍失败，已进入自动重试队列" : "通知已被企业微信受理");
      await load();
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "重新发送失败");
      await load();
    } finally { setRetryingId(undefined); }
  };

  return <div>
    <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 14 }} wrap>
      <Typography.Text type="secondary">“已受理”仅代表企业微信接受请求，不代表成员已经阅读。</Typography.Text>
      <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
    </Space>
    <Table rowKey="id" size="middle" loading={loading} dataSource={rows} scroll={{ x: 1080 }} pagination={{ pageSize: 20 }} columns={[
      { title: "平台用户", width: 140, render: (_, row) => <div><b>{row.userName}</b><div style={{ color: "#8b96a8", fontSize: 12 }}>ID：{row.userId}</div></div> },
      { title: "通知对象", dataIndex: "target_label", width: 180, render: (value) => value || "—" },
      { title: "渠道", dataIndex: "channelLabel", width: 100 },
      { title: "状态", dataIndex: "statusLabel", width: 120, render: (value, row) => <Tag color={statusColor[row.status]}>{value}</Tag> },
      { title: "重试", width: 110, render: (_, row) => `${row.retry_count} / ${row.max_retries}` },
      { title: "下次重试", dataIndex: "next_retry_at", width: 170, render: fmt },
      { title: "最近发送", dataIndex: "last_attempt_at", width: 170, render: fmt },
      { title: "失败原因", dataIndex: "error_reason", ellipsis: true, render: (value) => value || "—" },
      { title: "操作", fixed: "right", width: 120, render: (_, row) => <Button size="small" icon={<SendOutlined />} loading={retryingId === row.id} disabled={!['failed', 'partial', 'retry_waiting'].includes(row.status)} onClick={() => void retry(row)}>重新发送</Button> },
    ]} />
  </div>;
}
