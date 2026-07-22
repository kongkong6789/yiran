import { useEffect, useState } from "react";
import { App, Button, Space, Table, Tag, Typography } from "antd";
import { ReloadOutlined, SendOutlined } from "@ant-design/icons";
import { api } from "../../api/client";
import ManagementDetailModal, {
  handleDetailRowKey,
  isInteractiveTableTarget,
} from "../../components/ManagementDetailModal";

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
const compareText = (left?: string | null, right?: string | null) =>
  String(left || "").localeCompare(String(right || ""), "zh-CN", { numeric: true, sensitivity: "base" });
const timeValue = (value?: string | null) => (value ? new Date(value).getTime() : 0);

export default function WeComNotificationManager() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [detailNotification, setDetailNotification] = useState<NotificationRow | null>(null);
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
    <Table className="account-admin-table" rowKey="id" size="middle" loading={loading} dataSource={rows} scroll={{ x: 1080 }} showSorterTooltip={{ title: "点击切换升序或降序" }} onRow={(row) => ({
      className: "management-detail-row",
      tabIndex: 0,
      "aria-label": `查看${row.userName}的通知详情 #${row.id}`,
      onClick: (event) => {
        if (!isInteractiveTableTarget(event.target)) setDetailNotification(row);
      },
      onKeyDown: (event) => handleDetailRowKey(event, () => setDetailNotification(row)),
    })} pagination={{
      defaultPageSize: 20,
      pageSizeOptions: [10, 20, 50],
      showSizeChanger: true,
      showQuickJumper: true,
      showTotal: (total) => `共 ${total} 条通知记录`,
    }} columns={[
      { title: "平台用户", width: 140, sorter: (left, right) => compareText(left.userName, right.userName), render: (_, row) => <div><b>{row.userName}</b><div style={{ color: "#8b96a8", fontSize: 12 }}>ID：{row.userId}</div></div> },
      { title: "通知对象", dataIndex: "target_label", width: 180, sorter: (left, right) => compareText(left.target_label, right.target_label), render: (value) => value || "—" },
      { title: "渠道", dataIndex: "channelLabel", width: 100, sorter: (left, right) => compareText(left.channelLabel, right.channelLabel) },
      { title: "状态", dataIndex: "statusLabel", width: 120, sorter: (left, right) => compareText(left.statusLabel, right.statusLabel), render: (value, row) => <Tag color={statusColor[row.status]}>{value}</Tag> },
      { title: "重试", width: 110, sorter: (left, right) => left.retry_count - right.retry_count, render: (_, row) => `${row.retry_count} / ${row.max_retries}` },
      { title: "下次重试", dataIndex: "next_retry_at", width: 170, sorter: (left, right) => timeValue(left.next_retry_at) - timeValue(right.next_retry_at), render: fmt },
      { title: "最近发送", dataIndex: "last_attempt_at", width: 170, sorter: (left, right) => timeValue(left.last_attempt_at) - timeValue(right.last_attempt_at), render: fmt },
      { title: "失败原因", dataIndex: "error_reason", ellipsis: true, render: (value) => value || "—" },
      { title: "操作", fixed: "right", width: 120, render: (_, row) => <Button size="small" icon={<SendOutlined />} loading={retryingId === row.id} disabled={!['failed', 'partial', 'retry_waiting'].includes(row.status)} onClick={() => void retry(row)}>重新发送</Button> },
    ]} />

    {detailNotification ? (
      <ManagementDetailModal
        open
        onClose={() => setDetailNotification(null)}
        eyebrow="NOTIFICATION DETAIL"
        title={detailNotification.userName || `用户 ${detailNotification.userId}`}
        subtitle={`通知记录 #${detailNotification.id}`}
        avatarText={detailNotification.userName || String(detailNotification.userId)}
        badges={[{ label: detailNotification.statusLabel, color: statusColor[detailNotification.status] }]}
        sections={[
          {
            title: "通知对象",
            fields: [
              { label: "平台用户", value: detailNotification.userName || "—" },
              { label: "用户 ID", value: detailNotification.userId },
              { label: "通知对象", value: detailNotification.target_label || "—" },
              { label: "发送渠道", value: detailNotification.channelLabel || "—" },
            ],
          },
          {
            title: "发送状态",
            fields: [
              { label: "当前状态", value: detailNotification.statusLabel },
              { label: "重试进度", value: `${detailNotification.retry_count} / ${detailNotification.max_retries}` },
              { label: "最近发送", value: fmt(detailNotification.last_attempt_at) },
              { label: "下次重试", value: fmt(detailNotification.next_retry_at) },
              { label: "失败原因", value: detailNotification.error_reason || "无", wide: true },
            ],
          },
        ]}
      />
    ) : null}
  </div>;
}
