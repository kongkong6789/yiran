import { useEffect, useState } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  BankOutlined,
  DeleteOutlined,
  KeyOutlined,
  LockOutlined,
  MoreOutlined,
  PhoneOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  createAdminUser,
  deleteAdminUser,
  getMe,
  listAdminUsers,
  updateAdminUser,
  type AdminUserRow,
} from "../api/client";
import WeComBindingManager from "../features/wecom-bindings/WeComBindingManager";
import WeComNotificationManager from "../features/wecom-bindings/WeComNotificationManager";
import OrganizationManager from "../features/organizations/OrganizationManager";
import TeamManager from "../features/teams/TeamManager";

function fmtTime(v?: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const organizationRoleLabel = {
  owner: "企业所有者",
  admin: "企业管理员",
  member: "企业成员",
} as const;

const organizationRoleColor = {
  owner: "gold",
  admin: "blue",
  member: "default",
} as const;

const compareText = (left?: string | null, right?: string | null) =>
  String(left || "").localeCompare(String(right || ""), "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });

const organizationRoleOrder = { owner: 3, admin: 2, member: 1, "": 0 } as const;

export default function Accounts() {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [createForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [phoneForm] = Form.useForm();
  const [isStaffSelf, setIsStaffSelf] = useState(false);
  const [isSuperuserSelf, setIsSuperuserSelf] = useState(false);
  const [isPlatformAdminSelf, setIsPlatformAdminSelf] = useState(false);
  const [canManageOrgSelf, setCanManageOrgSelf] = useState(false);
  const [currentOrgName, setCurrentOrgName] = useState("");
  const [selfUserId, setSelfUserId] = useState<number>();
  const [activeTab, setActiveTab] = useState("accounts");

  const load = async (q = keyword) => {
    setLoading(true);
    try {
      const data = await listAdminUsers(q.trim() || undefined);
      setRows(data.results || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "加载账号失败（需管理员）");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getMe()
      .then((res) => {
        const canManage = !!(res.user.is_staff || res.user.is_superuser || res.user.organization?.canManage);
        setIsStaffSelf(canManage);
        setIsSuperuserSelf(!!res.user.is_superuser);
        setIsPlatformAdminSelf(!!(res.user.is_staff || res.user.is_superuser));
        setCanManageOrgSelf(!!res.user.organization?.canManage);
        setCurrentOrgName(res.user.organization?.name || "");
        setSelfUserId(res.user.id);
        if (canManage) void load();
      })
      .catch(() => setIsStaffSelf(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showPasswordOnce = (username: string, password: string) => {
    modal.success({
      title: "请抄录密码（仅显示一次）",
      content: (
        <div>
          <p>账号：<Typography.Text copyable>{username}</Typography.Text></p>
          <p>密码：<Typography.Text copyable code>{password}</Typography.Text></p>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            密码在库中加密存储，之后无法再查看明文，只能重置。
          </Typography.Paragraph>
        </div>
      ),
    });
  };

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    setSaving(true);
    try {
      const res = await createAdminUser({
        username: values.username.trim(),
        password: values.password,
        email: values.email || "",
        display_name: values.display_name || "",
        phone: values.phone || "",
        is_staff: !!values.is_staff,
        organization_role: values.organization_role || "member",
      });
      message.success("账号已创建");
      setCreateOpen(false);
      createForm.resetFields();
      if (res.password_once) showPasswordOnce(res.user.username, res.password_once);
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const handleResetPwd = async () => {
    if (!target) return;
    const values = await pwdForm.validateFields();
    setSaving(true);
    try {
      const res = await updateAdminUser(target.id, { password: values.password });
      message.success("密码已重置");
      setPwdOpen(false);
      pwdForm.resetFields();
      if (res.password_once) showPasswordOnce(target.username, res.password_once);
      setTarget(null);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "重置失败");
    } finally {
      setSaving(false);
    }
  };

  if (!isStaffSelf) {
    return (
      <div className="account-admin-page account-admin-denied">
        <Card>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <div>
                <Typography.Title level={5}>暂无账号管理权限</Typography.Title>
                <Typography.Text type="secondary">仅企业所有者、企业管理员或平台管理员可以访问。</Typography.Text>
              </div>
            )}
          />
        </Card>
      </div>
    );
  }

  const enabledCount = rows.filter((row) => row.is_active).length;
  const organizationAdminCount = rows.filter((row) => ["owner", "admin"].includes(row.organization_role)).length;
  const unboundPhoneCount = rows.filter((row) => !row.phone_masked).length;

  const openPasswordModal = (row: AdminUserRow) => {
    setTarget(row);
    pwdForm.resetFields();
    setPwdOpen(true);
  };

  const openPhoneModal = (row: AdminUserRow) => {
    setTarget(row);
    phoneForm.resetFields();
    setPhoneOpen(true);
  };

  const confirmDeleteAccount = (row: AdminUserRow) => {
    const displayName = row.display_name || row.username;
    modal.confirm({
      title: `删除平台账号“${displayName}”？`,
      centered: true,
      content: (
        <div>
          <Typography.Paragraph>
            删除后该账号将立即退出企业、无法继续登录，手机号、个人资料和密钥会被清除。
          </Typography.Paragraph>
          <Typography.Text type="secondary">
            历史任务和待办记录会保留，并显示为“已删除用户”。此操作不可恢复。
          </Typography.Text>
        </div>
      ),
      okText: "确认删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteAdminUser(row.id);
          message.success("平台账号已删除");
          await load();
        } catch (error: any) {
          message.error(error?.response?.data?.error || "账号删除失败");
        }
      },
    });
  };

  return (
    <div className="account-admin-page">
      <header className="account-admin-header">
        <div className="account-admin-heading">
          <span className="account-admin-heading-icon"><TeamOutlined /></span>
          <div>
            <Typography.Title level={3}>账号与企业成员</Typography.Title>
            <Typography.Text>管理本企业的平台账号、成员角色和企业微信绑定关系</Typography.Text>
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建成员账号</Button>
      </header>

      <Card className="account-admin-workspace" styles={{ body: { padding: 0 } }}>
        <Tabs
          className="account-admin-tabs"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: "accounts", label: <span><UserOutlined /> 平台账号</span> },
            { key: "organization", label: <span><BankOutlined /> 企业与成员</span> },
            { key: "teams", label: <span><TeamOutlined /> 团队</span> },
            { key: "wecom", label: <span><SafetyCertificateOutlined /> 企微绑定</span> },
            { key: "wecom-notifications", label: <span><ReloadOutlined /> 通知重试</span> },
          ]}
        />

        <div className="account-admin-content">
          {activeTab === "wecom" ? <WeComBindingManager />
            : activeTab === "wecom-notifications" ? <WeComNotificationManager />
              : activeTab === "teams" ? (
                <TeamManager
                  isSuperuser={isSuperuserSelf}
                  isPlatformAdmin={isPlatformAdminSelf}
                  canManageOrg={canManageOrgSelf}
                  currentOrgName={currentOrgName}
                />
              )
              : activeTab === "organization" ? (
                <OrganizationManager
                  isSuperuser={isSuperuserSelf}
                  platformUsers={rows}
                  onOrganizationCreated={() => load()}
                />
              )
                : <>
                  <div className="account-admin-overview">
                    <div><span>企业账号</span><strong>{rows.length}</strong><small>当前企业成员总数</small></div>
                    <div><span>已启用</span><strong>{enabledCount}</strong><small>{rows.length - enabledCount} 个账号已停用</small></div>
                    <div><span>企业管理者</span><strong>{organizationAdminCount}</strong><small>所有者与企业管理员</small></div>
                    <div><span>资料待完善</span><strong>{unboundPhoneCount}</strong><small>尚未填写手机号</small></div>
                  </div>

                  <div className="account-admin-toolbar">
                    <div>
                      <Typography.Title level={5}>平台账号</Typography.Title>
                      <Typography.Text type="secondary">平台权限和企业角色分别管理，密码不会在页面回显。</Typography.Text>
                    </div>
                    <Space wrap>
                      <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="搜索姓名、用户名或邮箱"
                        value={keyword}
                        onChange={(event) => {
                          setKeyword(event.target.value);
                          if (!event.target.value) void load("");
                        }}
                        onPressEnter={() => void load()}
                      />
                      <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
                    </Space>
                  </div>

                  <Table
                    className="account-admin-table"
                    rowKey="id"
                    loading={loading}
                    dataSource={rows}
                    showSorterTooltip={{ title: "点击切换升序或降序" }}
                    scroll={{ x: 980 }}
                    pagination={{
                      defaultPageSize: 15,
                      pageSizeOptions: [10, 15, 30, 50],
                      showSizeChanger: true,
                      showQuickJumper: true,
                      showTotal: (total) => `共 ${total} 个账号`,
                    }}
                    columns={[
                      {
                        title: "成员",
                        fixed: "left",
                        width: 230,
                        sorter: (left, right) => compareText(
                          left.display_name || left.username,
                          right.display_name || right.username,
                        ),
                        render: (_: unknown, row) => {
                          const displayName = row.display_name || row.username;
                          return <div className="account-member-cell">
                            <Avatar>{displayName.slice(0, 1).toUpperCase()}</Avatar>
                            <span>
                              <strong>{displayName}</strong>
                              <small>@{row.username}</small>
                            </span>
                          </div>;
                        },
                      },
                      {
                        title: "联系方式",
                        width: 220,
                        sorter: (left, right) => compareText(
                          left.email || left.phone_masked,
                          right.email || right.phone_masked,
                        ),
                        render: (_: unknown, row) => <div className="account-contact-cell">
                          <span>{row.email || "未填写邮箱"}</span>
                          <small>{row.phone_masked || "未填写手机号"}</small>
                        </div>,
                      },
                      {
                        title: "企业身份",
                        width: 210,
                        sorter: (left, right) => (
                          compareText(left.organization_name, right.organization_name)
                          || organizationRoleOrder[left.organization_role] - organizationRoleOrder[right.organization_role]
                        ),
                        render: (_: unknown, row) => <div className="account-role-cell">
                          <span>{row.organization_name || "未分配企业"}</span>
                          {row.organization_role
                            ? <Tag color={organizationRoleColor[row.organization_role]}>{organizationRoleLabel[row.organization_role]}</Tag>
                            : <Tag>未分配</Tag>}
                        </div>,
                      },
                      {
                        title: "平台权限",
                        width: 130,
                        sorter: (left, right) => (
                          Number(left.is_superuser) * 2 + Number(left.is_staff)
                        ) - (
                          Number(right.is_superuser) * 2 + Number(right.is_staff)
                        ),
                        render: (_: unknown, row) => row.is_superuser
                          ? <Tag color="purple">超级管理员</Tag>
                          : row.is_staff ? <Tag color="geekblue">平台管理员</Tag> : <span className="account-muted">普通用户</span>,
                      },
                      {
                        title: "账号状态",
                        width: 120,
                        sorter: (left, right) => Number(left.is_active) - Number(right.is_active),
                        render: (_: unknown, row) => <Switch
                          size="small"
                          checked={row.is_active}
                          checkedChildren="启用"
                          unCheckedChildren="停用"
                          onChange={async (checked) => {
                            try {
                              await updateAdminUser(row.id, { is_active: checked });
                              message.success(checked ? "账号已启用" : "账号已停用");
                              await load();
                            } catch (error: any) {
                              message.error(error?.response?.data?.error || "状态更新失败");
                            }
                          }}
                        />,
                      },
                      {
                        title: "最近登录",
                        dataIndex: "last_login",
                        width: 130,
                        sorter: (left, right) => (
                          left.last_login ? new Date(left.last_login).getTime() : 0
                        ) - (
                          right.last_login ? new Date(right.last_login).getTime() : 0
                        ),
                        render: (value: string | null) => <span className="account-muted">{fmtTime(value)}</span>,
                      },
                      {
                        title: "",
                        fixed: "right",
                        width: 64,
                        align: "center",
                        render: (_: unknown, row) => <Dropdown
                          trigger={["click"]}
                          menu={{
                            items: [
                              { key: "phone", icon: <PhoneOutlined />, label: "修改手机号" },
                              { key: "password", icon: <KeyOutlined />, label: "重置密码" },
                              { type: "divider" },
                              {
                                key: "delete",
                                icon: <DeleteOutlined />,
                                label: "删除账号",
                                danger: true,
                                disabled: row.id === selfUserId
                                  || row.is_superuser
                                  || row.organization_role === "owner"
                                  || (row.is_staff && !isSuperuserSelf),
                              },
                            ],
                            onClick: ({ key }) => {
                              if (key === "phone") openPhoneModal(row);
                              else if (key === "password") openPasswordModal(row);
                              else if (key === "delete") confirmDeleteAccount(row);
                            },
                          }}
                        >
                          <Button type="text" icon={<MoreOutlined />} aria-label={`管理 ${row.username}`} />
                        </Dropdown>,
                      },
                    ]}
                  />
                </>}
        </div>
      </Card>

      <Modal
        className="account-admin-modal"
        title={<div className="account-modal-title"><span><PlusOutlined /></span><div><strong>新建成员账号</strong><small>账号创建后将自动加入当前企业</small></div></div>}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
        confirmLoading={saving}
        okText="创建"
        cancelText="取消"
        width={680}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" initialValues={{ is_staff: false, organization_role: "member" }}>
          <div className="account-form-grid">
            <Form.Item label="登录用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
              <Input placeholder="用于登录，不建议使用中文" autoComplete="off" />
            </Form.Item>
            <Form.Item label="成员姓名" name="display_name" rules={[{ required: true, message: "请输入成员姓名" }]}>
              <Input placeholder="在任务和协作中展示" />
            </Form.Item>
            <Form.Item label="邮箱" name="email"><Input placeholder="选填" /></Form.Item>
            <Form.Item label="手机号" name="phone" help="用于自动匹配企业微信成员">
              <Input placeholder="13800000000" />
            </Form.Item>
          </div>
          <Form.Item
            label="初始密码"
            name="password"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 8, message: "至少 8 位" },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="至少 8 位，创建后仅展示一次" autoComplete="new-password" />
          </Form.Item>
          <div className="account-form-grid">
            <Form.Item label="企业角色" name="organization_role" extra="企业管理员可管理本企业成员和连接授权">
              <Select options={[
                { value: "member", label: "企业成员" },
                { value: "admin", label: "企业管理员" },
              ]} />
            </Form.Item>
            {isSuperuserSelf && <Form.Item label="平台管理权限" name="is_staff" valuePropName="checked" extra="可访问平台级后台功能">
              <Switch checkedChildren="平台管理员" unCheckedChildren="普通用户" />
            </Form.Item>}
          </div>
        </Form>
      </Modal>

      <Modal
        className="account-admin-modal"
        title={target ? `重置密码 · ${target.display_name || target.username}` : "重置密码"}
        open={pwdOpen}
        onCancel={() => { setPwdOpen(false); setTarget(null); }}
        onOk={() => void handleResetPwd()}
        confirmLoading={saving}
        okText="确认重置"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={pwdForm} layout="vertical">
          <Form.Item
            label="新密码"
            name="password"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: 8, message: "至少 8 位" },
            ]}
          >
            <Input.Password placeholder="重置后对方需用新密码登录" autoComplete="new-password" />
          </Form.Item>
          <div className="account-modal-notice">重置后该成员现有登录令牌会立即失效，需要使用新密码重新登录。</div>
        </Form>
      </Modal>

      <Modal className="account-admin-modal" title={target ? `修改手机号 · ${target.display_name || target.username}` : "修改手机号"} open={phoneOpen}
        onCancel={() => { setPhoneOpen(false); setTarget(null); }} okText="保存并匹配"
        onOk={async () => {
          if (!target) return;
          const values = await phoneForm.validateFields();
          setSaving(true);
          try { await updateAdminUser(target.id, { phone: values.phone || "" }); message.success("手机号已保存，匹配任务已触发"); setPhoneOpen(false); setTarget(null); await load(); }
          catch (e: any) { message.error(e?.response?.data?.error || "保存失败"); }
          finally { setSaving(false); }
        }} confirmLoading={saving} cancelText="取消" destroyOnHidden>
        <Form form={phoneForm} layout="vertical">
          <Form.Item name="phone" label="手机号" help="保存后会异步匹配同企业的企业微信成员；页面和日志仅展示脱敏号码">
            <Input prefix={<PhoneOutlined />} placeholder="13800000000 或 +8613800000000" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
