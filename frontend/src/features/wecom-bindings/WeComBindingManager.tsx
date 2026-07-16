import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { LinkOutlined, ReloadOutlined, SyncOutlined } from "@ant-design/icons";
import {
  deleteWeComBinding, listWeComBindingLogs, listWeComBindings, manualWeComBinding,
  matchWeComBinding, syncWeComBindings, type WeComBindingRow, type WeComBindingStatus,
} from "../../api/client";

const statusColors: Record<WeComBindingStatus, string> = {
  matched: "green", pending: "gold", not_found: "default", invalid_phone: "red",
  duplicate_phone: "orange", conflict: "volcano", permission_denied: "red",
  retry_waiting: "blue", disabled: "default",
};

const time = (value?: string | null) => value ? value.slice(0, 19).replace("T", " ") : "—";

export default function WeComBindingManager() {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<WeComBindingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>();
  const [manualOpen, setManualOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: number; message: string; actorName: string; created_at: string }>>([]);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const data = await listWeComBindings({ q: q || undefined, status, page_size: 100 });
      setRows(data.results);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "加载企业微信绑定失败");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  const runMatch = async (row: WeComBindingRow) => {
    try {
      const result = await matchWeComBinding(row.platformUserId);
      message.success(result.binding.status === "matched" ? "匹配成功" : result.binding.statusLabel);
      await load();
    } catch (e: any) { message.error(e?.response?.data?.error || "匹配失败"); }
  };

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 14 }} wrap>
        <Typography.Text type="secondary">手机号仅脱敏展示；自动匹配不会覆盖存在冲突的绑定。</Typography.Text>
        <Space wrap>
          <Input.Search placeholder="平台用户 / 企业微信 UserID" value={q} onChange={(e) => setQ(e.target.value)} onSearch={() => void load()} style={{ width: 230 }} />
          <Select allowClear placeholder="全部状态" value={status} onChange={setStatus} style={{ width: 140 }} options={[
            ["matched", "已绑定"], ["pending", "待匹配"], ["not_found", "未查询到成员"], ["invalid_phone", "手机号无效"],
            ["duplicate_phone", "手机号重复"], ["conflict", "绑定冲突"], ["permission_denied", "权限不足"], ["retry_waiting", "等待重试"],
          ].map(([value, label]) => ({ value, label }))} />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button icon={<LinkOutlined />} onClick={() => setManualOpen(true)}>人工绑定</Button>
          <Button type="primary" icon={<SyncOutlined />} onClick={async () => {
            try { await syncWeComBindings(); message.success("同步任务已启动"); setTimeout(() => void load(), 1200); }
            catch (e: any) { message.error(e?.response?.data?.error || "启动同步失败"); }
          }}>批量同步</Button>
        </Space>
      </Space>
      <Table rowKey="id" size="middle" loading={loading} dataSource={rows} scroll={{ x: 1180 }} pagination={{ pageSize: 20 }} columns={[
        { title: "平台用户", width: 150, render: (_, r) => <div><b>{r.platformUser}</b><div style={{ fontSize: 12, color: "#8b96a8" }}>ID：{r.platformUserId}</div></div> },
        { title: "手机号", dataIndex: "phoneMasked", width: 130, render: (v) => v || "未填写" },
        { title: "企业微信成员", width: 180, render: (_, r) => <div>{r.weComMember || "—"}<div style={{ fontSize: 12, color: "#8b96a8" }}>{r.weComUserId ? `UserID：${r.weComUserId}` : "尚未绑定"}</div></div> },
        { title: "绑定状态", dataIndex: "statusLabel", width: 120, render: (v, r) => <Tag color={statusColors[r.status]}>{v}</Tag> },
        { title: "匹配来源", dataIndex: "sourceLabel", width: 110 },
        { title: "最后匹配", dataIndex: "verifiedAt", width: 170, render: time },
        { title: "失败原因", dataIndex: "failureReason", width: 220, ellipsis: true, render: (v) => v || "—" },
        { title: "操作", fixed: "right", width: 220, render: (_, r) => <Space size={2}>
          <Button type="link" size="small" onClick={() => void runMatch(r)}>{r.status === "matched" ? "重新匹配" : "立即匹配"}</Button>
          <Button type="link" size="small" onClick={async () => { const data = await listWeComBindingLogs(r.id); setLogs(data.results); setLogsOpen(true); }}>日志</Button>
          {r.status === "matched" && <Button danger type="link" size="small" onClick={() => modal.confirm({ title: "确认解除绑定？", content: "解除后可再次自动或人工匹配。", onOk: async () => { await deleteWeComBinding(r.id); message.success("已解除绑定"); await load(); } })}>解除</Button>}
        </Space> },
      ]} />

      <Modal title="人工绑定企业微信 UserID" open={manualOpen} onCancel={() => setManualOpen(false)} onOk={async () => {
        const v = await form.validateFields();
        try { await manualWeComBinding(Number(v.platformUserId), v.weComUserId.trim()); message.success("人工绑定成功"); setManualOpen(false); form.resetFields(); await load(); }
        catch (e: any) { message.error(e?.response?.data?.error || "人工绑定失败"); }
      }} okText="确认绑定" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="platformUserId" label="平台用户 ID" rules={[{ required: true }]}><Input type="number" /></Form.Item>
          <Form.Item name="weComUserId" label="企业微信 UserID" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
      <Modal title="绑定操作日志" open={logsOpen} onCancel={() => setLogsOpen(false)} footer={null}>
        {logs.length ? logs.map((log) => <div key={log.id} style={{ padding: "10px 0", borderBottom: "1px solid #eef1f5" }}><b>{log.message}</b><div style={{ color: "#8b96a8", fontSize: 12 }}>{log.actorName || "系统"} · {time(log.created_at)}</div></div>) : <Typography.Text type="secondary">暂无日志</Typography.Text>}
      </Modal>
    </div>
  );
}
