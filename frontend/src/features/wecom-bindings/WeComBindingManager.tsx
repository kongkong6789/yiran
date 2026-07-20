import { useEffect, useState } from "react";
import { App, Avatar, Button, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { LinkOutlined, ReloadOutlined, SyncOutlined, UserOutlined } from "@ant-design/icons";
import {
  deleteWeComBinding,
  listWeComBindingLogs,
  listWeComBindings,
  listAdminUsers,
  manualWeComBinding,
  matchWeComBinding,
  syncWeComBindings,
  type WeComBindingRow,
  type WeComBindingStatus,
  type AdminUserRow,
} from "../../api/client";
import { getManagedWeComUsers, type ManagedWeComMember } from "../task-console/mockWeCom";

const statusColors: Record<WeComBindingStatus, string> = {
  matched: "green",
  pending: "gold",
  not_found: "default",
  invalid_phone: "red",
  duplicate_phone: "orange",
  conflict: "volcano",
  permission_denied: "red",
  retry_waiting: "blue",
  disabled: "default",
};

const statusOptions = [
  { value: "matched", label: "已绑定" },
  { value: "pending", label: "待匹配" },
  { value: "not_found", label: "未查询到成员" },
  { value: "invalid_phone", label: "手机号无效" },
  { value: "duplicate_phone", label: "手机号重复" },
  { value: "conflict", label: "绑定冲突" },
  { value: "permission_denied", label: "权限不足" },
  { value: "retry_waiting", label: "等待重试" },
];

const formatTime = (value?: string | null) => value
  ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
  : "—";

const compareText = (left?: string | null, right?: string | null) =>
  String(left || "").localeCompare(String(right || ""), "zh-CN", { numeric: true, sensitivity: "base" });
const timeValue = (value?: string | null) => (value ? new Date(value).getTime() : 0);

export default function WeComBindingManager() {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<WeComBindingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>();
  const [manualOpen, setManualOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState<Array<{ id: number; message: string; actorName: string; created_at: string }>>([]);
  const [platformUsers, setPlatformUsers] = useState<AdminUserRow[]>([]);
  const [weComMembers, setWeComMembers] = useState<ManagedWeComMember[]>([]);
  const [optionLoading, setOptionLoading] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [data, contacts] = await Promise.all([
        listWeComBindings({ q: q || undefined, status, page_size: 100 }),
        getManagedWeComUsers().catch(() => [] as ManagedWeComMember[]),
      ]);
      const contactMap = new Map(contacts.map((item) => [item.weComUserId, item]));
      setRows(data.results.map((row) => {
        const contact = contactMap.get(row.weComUserId);
        if (!contact) return row;
        return {
          ...row,
          weComMember: contact.name || row.weComMember,
          weComAvatar: contact.avatar || row.weComAvatar,
          weComDepartment: contact.department || row.weComDepartment,
          weComPosition: contact.position || row.weComPosition,
          weComAvailable: contact.available,
        };
      }));
    } catch (error: any) {
      message.error(error?.response?.data?.error || "企业微信绑定加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  const runMatch = async (row: WeComBindingRow) => {
    try {
      const result = await matchWeComBinding(row.platformUserId);
      message.success(result.binding.status === "matched" ? "匹配成功" : result.binding.statusLabel);
      await load();
    } catch (error: any) {
      message.error(error?.response?.data?.error || "匹配失败");
    }
  };

  const openManualBinding = async () => {
    setManualOpen(true);
    setOptionLoading(true);
    try {
      const [users, members] = await Promise.all([listAdminUsers(), getManagedWeComUsers()]);
      setPlatformUsers(users.results.filter((item) => item.is_active));
      setWeComMembers(members.filter((item) => item.available));
    } catch (error: any) {
      message.error(error?.response?.data?.error || "成员列表加载失败");
    } finally {
      setOptionLoading(false);
    }
  };

  return (
    <section className="wecom-binding-manager">
      <div className="account-admin-toolbar wecom-binding-toolbar">
        <div>
          <Typography.Title level={5}>企业微信账号绑定</Typography.Title>
          <Typography.Text type="secondary">
            展示平台成员与企业微信通讯录成员的对应关系，头像和姓名来自本企业通讯录缓存。
          </Typography.Text>
        </div>
        <div className="wecom-binding-toolbar-actions">
          <Input.Search
            allowClear
            placeholder="搜索平台用户或企微成员"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onSearch={() => void load()}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            placeholder="全部状态"
            value={status}
            onChange={setStatus}
            style={{ width: 145 }}
            options={statusOptions}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
          <Button icon={<LinkOutlined />} onClick={() => void openManualBinding()}>人工绑定</Button>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            onClick={async () => {
              try {
                await syncWeComBindings();
                message.success("同步任务已启动");
                window.setTimeout(() => void load(), 1200);
              } catch (error: any) {
                message.error(error?.response?.data?.error || "启动同步失败");
              }
            }}
          >
            批量同步
          </Button>
        </div>
      </div>

      <Table
        className="account-admin-table"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        showSorterTooltip={{ title: "点击切换升序或降序" }}
        scroll={{ x: 1180 }}
        pagination={{
          defaultPageSize: 20,
          pageSizeOptions: [10, 20, 50],
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条绑定记录`,
        }}
        columns={[
          {
            title: "平台用户",
            width: 190,
            sorter: (left, right) => compareText(left.platformUser, right.platformUser),
            render: (_: unknown, row) => (
              <div className="account-member-cell">
                <Avatar>{row.platformUser.slice(0, 1).toUpperCase()}</Avatar>
                <span>
                  <strong>{row.platformUser}</strong>
                  <small>良策工作台成员</small>
                </span>
              </div>
            ),
          },
          {
            title: "手机号",
            dataIndex: "phoneMasked",
            width: 130,
            sorter: (left, right) => compareText(left.phoneMasked, right.phoneMasked),
            render: (value: string) => value || <span className="account-muted">未填写</span>,
          },
          {
            title: "企业微信成员",
            width: 250,
            sorter: (left, right) => compareText(left.weComMember, right.weComMember),
            render: (_: unknown, row) => row.weComUserId ? (
              <div className="wecom-binding-member">
                <Avatar src={row.weComAvatar || undefined} icon={<UserOutlined />}>
                  {row.weComMember?.slice(0, 1)}
                </Avatar>
                <span>
                  <strong>{row.weComMember || "企业微信成员"}</strong>
                  <small>
                    {[row.weComDepartment, row.weComPosition].filter(Boolean).join(" · ") || "企业微信通讯录成员"}
                  </small>
                </span>
              </div>
            ) : <span className="account-muted">尚未绑定</span>,
          },
          {
            title: "绑定状态",
            dataIndex: "statusLabel",
            width: 120,
            sorter: (left, right) => compareText(left.statusLabel, right.statusLabel),
            render: (value: string, row) => <Tag color={statusColors[row.status]}>{value}</Tag>,
          },
          {
            title: "匹配来源",
            dataIndex: "sourceLabel",
            width: 110,
            sorter: (left, right) => compareText(left.sourceLabel, right.sourceLabel),
          },
          {
            title: "最后验证",
            dataIndex: "verifiedAt",
            width: 140,
            sorter: (left, right) => timeValue(left.verifiedAt) - timeValue(right.verifiedAt),
            render: formatTime,
          },
          {
            title: "失败原因",
            dataIndex: "failureReason",
            width: 200,
            ellipsis: true,
            render: (value: string) => value || "—",
          },
          {
            title: "操作",
            fixed: "right",
            width: 190,
            render: (_: unknown, row) => (
              <Space size={2}>
                <Button type="link" size="small" onClick={() => void runMatch(row)}>
                  {row.status === "matched" ? "重新验证" : "立即匹配"}
                </Button>
                <Button
                  type="link"
                  size="small"
                  onClick={async () => {
                    const data = await listWeComBindingLogs(row.id);
                    setLogs(data.results);
                    setLogsOpen(true);
                  }}
                >
                  日志
                </Button>
                {row.status === "matched" && (
                  <Button
                    danger
                    type="link"
                    size="small"
                    onClick={() => modal.confirm({
                      title: "确认解除绑定？",
                      content: "解除后可再次通过手机号匹配或人工绑定。",
                      onOk: async () => {
                        await deleteWeComBinding(row.id);
                        message.success("绑定已解除");
                        await load();
                      },
                    })}
                  >
                    解除
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="人工绑定企业微信成员"
        open={manualOpen}
        onCancel={() => setManualOpen(false)}
        onOk={async () => {
          const values = await form.validateFields();
          try {
            await manualWeComBinding(Number(values.platformUserId), values.weComUserId.trim());
            message.success("人工绑定成功");
            setManualOpen(false);
            form.resetFields();
            await load();
          } catch (error: any) {
            message.error(error?.response?.data?.error || "人工绑定失败");
          }
        }}
        okText="确认绑定"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="platformUserId" label="平台成员" rules={[{ required: true, message: "请选择平台成员" }]}>
            <Select
              showSearch
              loading={optionLoading}
              placeholder="按姓名选择平台成员"
              optionFilterProp="label"
              options={platformUsers.map((item) => ({
                value: item.id,
                label: item.display_name || item.username,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="weComUserId"
            label="企业微信成员"
            extra="只展示企业微信通讯录姓名，系统会在后台保存对应关系。"
            rules={[{ required: true, message: "请选择企业微信成员" }]}
          >
            <Select
              showSearch
              loading={optionLoading}
              placeholder="按姓名或部门选择企业微信成员"
              optionFilterProp="searchText"
              options={weComMembers.map((item) => ({
                value: item.weComUserId,
                label: item.name,
                searchText: `${item.name} ${item.department} ${item.position}`,
              }))}
              optionRender={(option) => {
                const member = weComMembers.find((item) => item.weComUserId === option.value);
                return (
                  <div className="wecom-binding-option">
                    <Avatar size={28} src={member?.avatar || undefined} icon={<UserOutlined />} />
                    <span>
                      <strong>{member?.name || String(option.label)}</strong>
                      <small>{[member?.department, member?.position].filter(Boolean).join(" · ") || "企业微信成员"}</small>
                    </span>
                  </div>
                );
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="绑定操作日志" open={logsOpen} onCancel={() => setLogsOpen(false)} footer={null}>
        {logs.length
          ? logs.map((log) => (
            <div key={log.id} className="wecom-binding-log">
              <strong>{log.message}</strong>
              <small>{log.actorName || "系统"} · {formatTime(log.created_at)}</small>
            </div>
          ))
          : <Typography.Text type="secondary">暂无日志</Typography.Text>}
      </Modal>
    </section>
  );
}
