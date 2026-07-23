import { useEffect, useState, type ReactNode } from "react";
import {
  App,
  Avatar,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popover,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  BankOutlined,
  CameraOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  MailOutlined,
  MinusCircleOutlined,
  PhoneOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  StarOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  createAdminUser,
  deleteAdminUser,
  getMe,
  listAdminUsers,
  listOrganizations,
  switchCurrentOrganization,
  updateAdminUser,
  uploadUserAvatar,
  type AdminUserRow,
  type OrganizationSummary,
} from "../api/client";
import WeComBindingManager from "../features/wecom-bindings/WeComBindingManager";
import WeComNotificationManager from "../features/wecom-bindings/WeComNotificationManager";
import OrganizationManager from "../features/organizations/OrganizationManager";
import TeamManager from "../features/teams/TeamManager";
import { AvatarPreview } from "../components/AvatarPreview";
import ManagementDetailModal, {
  handleDetailRowKey,
  isInteractiveTableTarget,
} from "../components/ManagementDetailModal";
import { formatPhoneMasked, hasFilledPhone } from "../utils/phone";
import { authenticatedAvatarUrl } from "../utils/avatar";

function AccountEditModalHead({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="account-edit-modal-head">
      <div className="account-modal-title account-edit-modal-title">
        <span>{icon}</span>
        <div>
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
      </div>
    </div>
  );
}

function fmtTime(v?: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDetailTime(v?: string | null) {
  return v ? new Date(v).toLocaleString("zh-CN", { hour12: false }) : "—";
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

type PlatformRole = "user" | "staff" | "superuser";

const platformRoleOf = (row: Pick<AdminUserRow, "is_superuser" | "is_staff">): PlatformRole => {
  if (row.is_superuser) return "superuser";
  if (row.is_staff) return "staff";
  return "user";
};

const PLATFORM_ROLE_OPTIONS: { value: PlatformRole; label: ReactNode }[] = [
  { value: "user", label: "普通用户" },
  {
    value: "staff",
    label: (
      <span className="account-platform-role-option">
        <SafetyCertificateOutlined />
        平台管理员
      </span>
    ),
  },
  {
    value: "superuser",
    label: (
      <span className="account-platform-role-option is-super">
        <StarOutlined />
        超级管理员
      </span>
    ),
  },
];

const platformRoleLabel: Record<PlatformRole, string> = {
  user: "普通用户",
  staff: "平台管理员",
  superuser: "超级管理员",
};
export default function Accounts() {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [detailUser, setDetailUser] = useState<AdminUserRow | null>(null);
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [createAvatarFile, setCreateAvatarFile] = useState<File | null>(null);
  const [createAvatarPreview, setCreateAvatarPreview] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [isStaffSelf, setIsStaffSelf] = useState(false);
  const [isSuperuserSelf, setIsSuperuserSelf] = useState(false);
  const [isPlatformAdminSelf, setIsPlatformAdminSelf] = useState(false);
  const [canManageOrgSelf, setCanManageOrgSelf] = useState(false);
  const [currentOrgName, setCurrentOrgName] = useState("");
  const [selfUserId, setSelfUserId] = useState<number>();
  const [activeTab, setActiveTab] = useState("accounts");
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [accountOrganizationId, setAccountOrganizationId] = useState(0);
  const [managementOrganizationId, setManagementOrganizationId] = useState<number>();

  const handleManagementOrganizationChange = async (organizationId: number) => {
    setManagementOrganizationId(organizationId);
    const selected = organizations.find((item) => item.id === organizationId);
    if (!selected?.canSwitch || selected.isCurrent) return;
    try {
      await switchCurrentOrganization(organizationId);
      message.success(`已切换至${selected.name}`);
      // 企业上下文会影响连接器、企业微信和任务数据，刷新可避免保留上一企业的缓存状态。
      window.location.reload();
    } catch (error: any) {
      message.error(error?.response?.data?.error || "切换企业失败");
    }
  };

  const handleAccountOrganizationChange = async (organizationId: number) => {
    setAccountOrganizationId(organizationId);
    if (!organizationId) {
      await load(keyword, 0);
      return;
    }
    const selected = organizations.find((item) => item.id === organizationId);
    if (selected?.canSwitch && !selected.isCurrent) {
      await handleManagementOrganizationChange(organizationId);
      return;
    }
    await load(keyword, organizationId);
  };

  const load = async (q = keyword, organizationId = accountOrganizationId) => {
    setLoading(true);
    try {
      const data = await listAdminUsers(q.trim() || undefined, organizationId || undefined);
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
      .then(async (res) => {
        const canManage = !!(
          res.user.can_manage_accounts
          ?? (res.user.is_staff || res.user.is_superuser || res.user.organization?.canManage)
        );
        setIsStaffSelf(canManage);
        setIsSuperuserSelf(!!res.user.is_superuser);
        setIsPlatformAdminSelf(!!(res.user.is_staff || res.user.is_superuser));
        setCanManageOrgSelf(!!(
          res.user.can_manage_accounts
          || res.user.organization?.canManage
        ));
        setCurrentOrgName(res.user.organization?.name || "");
        setSelfUserId(res.user.id);
        if (canManage) {
          const organizationResponse = await listOrganizations();
          const available = organizationResponse.results || [];
          setOrganizations(available);
          const preferred =
            available.find((item) => item.id === res.user.organization?.id && item.canManage)
            || available.find((item) => item.canManage)
            || available.find((item) => item.isCurrent)
            || available[0];
          const currentOrganizationId = preferred?.id || 0;
          setAccountOrganizationId(currentOrganizationId);
          setManagementOrganizationId(currentOrganizationId || undefined);
          await load("", currentOrganizationId);
        }
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

  const manageableOrganizations = isPlatformAdminSelf
    ? organizations
    : organizations.filter((item) => item.canManage);

  const organizationSelectOptions = manageableOrganizations.map((item) => ({
    value: item.id,
    label: item.name,
  }));

  const editOrganizationOptions = (() => {
    const map = new Map(organizationSelectOptions.map((item) => [item.value, item]));
    for (const org of target?.organizations || []) {
      if (!map.has(org.id)) map.set(org.id, { value: org.id, label: org.name });
    }
    return Array.from(map.values());
  })();

  const editMemberships = Form.useWatch("organizations", editForm) as Array<{ id?: number; role?: string }> | undefined;
  const createDisplayName = Form.useWatch("display_name", createForm) as string | undefined;

  const revokeCreateAvatarPreview = (url: string) => {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  };

  const clearCreateAvatar = () => {
    if (createAvatarPreview) revokeCreateAvatarPreview(createAvatarPreview);
    setCreateAvatarFile(null);
    setCreateAvatarPreview("");
  };

  const resetCreateModal = () => {
    setCreateOpen(false);
    createForm.resetFields();
    clearCreateAvatar();
  };

  const handleCreateAvatarSelect = (file: File) => {
    if (createAvatarPreview) revokeCreateAvatarPreview(createAvatarPreview);
    setCreateAvatarFile(file);
    setCreateAvatarPreview(URL.createObjectURL(file));
    return false;
  };

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    setSaving(true);
    try {
      const memberships = (values.organizations || [])
        .filter((item: { id?: number }) => item?.id)
        .map((item: { id: number; role: "admin" | "member" }) => ({
          id: item.id,
          role: item.role || "member",
        }));
      const res = await createAdminUser({
        username: values.username.trim(),
        password: values.password,
        email: values.email || "",
        display_name: values.display_name || "",
        phone: values.phone || "",
        platform_role: values.platform_role || "user",
        is_staff: values.platform_role === "staff" || values.platform_role === "superuser",
        is_superuser: values.platform_role === "superuser",
        organizations: memberships.length
          ? memberships
          : undefined,
        organization_id: memberships[0]?.id || managementOrganizationId,
        organization_role: memberships[0]?.role || "member",
      });
      if (createAvatarFile) {
        try {
          await uploadUserAvatar(createAvatarFile, res.user.id);
        } catch {
          message.warning("账号已创建，但头像上传失败");
        }
      }
      message.success("账号已创建");
      resetCreateModal();
      if (res.password_once) showPasswordOnce(res.user.username, res.password_once);
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (row: AdminUserRow) => {
    setTarget(row);
    setEditAvatarUrl(row.avatar_url || "");
    const memberships = (row.organizations || []).map((item) => ({
      id: item.id,
      role: item.role,
    }));
    editForm.setFieldsValue({
      display_name: row.display_name || "",
      email: row.email || "",
      phone: "",
      password: "",
      organizations: memberships.length
        ? memberships
        : [{ id: row.organization_id || managementOrganizationId, role: row.organization_role || "member" }],
      platform_role: platformRoleOf(row),
      is_active: row.is_active,
    });
    setEditOpen(true);
  };

  const handleEditAvatar = async (file: File) => {
    if (!target) return false;
    setAvatarUploading(true);
    try {
      const res = await uploadUserAvatar(file, target.id);
      setEditAvatarUrl(res.avatar_url || "");
      if (res.admin_user) setTarget(res.admin_user);
      message.success("头像已更新");
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "头像上传失败");
    } finally {
      setAvatarUploading(false);
    }
    return false;
  };

  const handleEdit = async () => {
    if (!target) return;
    const values = await editForm.validateFields();
    setSaving(true);
    try {
      const organizationsPayload = (values.organizations || [])
        .filter((item: { id?: number }) => item?.id)
        .map((item: { id: number; role: "owner" | "admin" | "member" }) => ({
          id: item.id,
          role: item.role || "member",
        }));

      const payload: Parameters<typeof updateAdminUser>[1] = {
        display_name: values.display_name || "",
        email: values.email || "",
        is_active: !!values.is_active,
        organizations: organizationsPayload,
      };
      if (values.phone?.trim()) payload.phone = values.phone.trim();
      if (values.password?.trim()) payload.password = values.password.trim();
      if (isSuperuserSelf) {
        payload.platform_role = values.platform_role || "user";
      }
      const res = await updateAdminUser(target.id, payload);
      message.success("账号已更新");
      setEditOpen(false);
      setTarget(null);
      setEditAvatarUrl("");
      editForm.resetFields();
      if (res.password_once) showPasswordOnce(target.username, res.password_once);
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "保存失败");
    } finally {
      setSaving(false);
    }
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
          setEditOpen(false);
          setTarget(null);
          await load();
        } catch (error: any) {
          message.error(error?.response?.data?.error || "账号删除失败");
        }
      },
    });
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
  const unboundPhoneCount = rows.filter((row) => !hasFilledPhone(row.phone_masked)).length;

  const canDeleteAccount = (row: AdminUserRow) => !(
    row.id === selfUserId
    || row.is_superuser
    || row.organization_role === "owner"
    || (row.is_staff && !isSuperuserSelf)
  );

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
        <Button type="primary" icon={<PlusOutlined />} onClick={() => {
          clearCreateAvatar();
          createForm.setFieldsValue({
            platform_role: "user",
            organizations: [{
              id: managementOrganizationId || accountOrganizationId || organizations[0]?.id,
              role: "member",
            }],
          });
          setCreateOpen(true);
        }}>新建成员账号</Button>
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
                    organizationId={managementOrganizationId}
                    availableOrganizations={organizations}
                    onOrganizationChange={(organizationId) => void handleManagementOrganizationChange(organizationId)}
                    onOrganizationCreated={async () => {
                      const response = await listOrganizations();
                      setOrganizations(response.results || []);
                      await load();
                    }}
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
                      <Select
                        className="account-organization-filter"
                        value={accountOrganizationId}
                        onChange={(value) => void handleAccountOrganizationChange(Number(value))}
                        options={[
                          ...(isPlatformAdminSelf ? [{ value: 0, label: "全部企业" }] : []),
                          ...organizations
                            .filter((item) => isPlatformAdminSelf || item.canManage)
                            .map((item) => ({ value: item.id, label: item.name })),
                        ]}
                      />
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
                     onRow={(row) => ({
                       className: "management-detail-row",
                       tabIndex: 0,
                       "aria-label": `查看${row.display_name || row.username}的账号详情`,
                       onClick: (event) => {
                         if (!isInteractiveTableTarget(event.target)) setDetailUser(row);
                       },
                       onKeyDown: (event) => handleDetailRowKey(event, () => setDetailUser(row)),
                     })}
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
                            <Avatar
                              src={authenticatedAvatarUrl(row.avatar_url)}
                              alt={`${displayName}的头像`}
                            >
                              {displayName.slice(0, 1).toUpperCase()}
                            </Avatar>
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
                          <small>{formatPhoneMasked(row.phone_masked)}</small>
                        </div>,
                      },
                      {
                        title: "企业身份",
                        width: 210,
                        sorter: (left, right) => (
                          compareText(left.organization_name, right.organization_name)
                          || organizationRoleOrder[left.organization_role] - organizationRoleOrder[right.organization_role]
                        ),
                        render: (_: unknown, row) => {
                          const orgs = row.organizations || [];
                          if (!orgs.length) return <Tag>未分配</Tag>;

                          const fullList = (
                            <div className="account-org-popover-list">
                              {orgs.map((item) => (
                                <div key={item.id} className="account-org-popover-item">
                                  <span title={item.name}>{item.name}</span>
                                  <Tag color={organizationRoleColor[item.role]}>{organizationRoleLabel[item.role]}</Tag>
                                </div>
                              ))}
                            </div>
                          );

                          const primary = orgs[0];
                          const extra = orgs.length - 1;

                          return (
                            <Popover
                              content={fullList}
                              title={`全部企业身份（${orgs.length}）`}
                              trigger="click"
                              placement="bottomLeft"
                            >
                              <button type="button" className="account-role-cell account-role-cell--compact" title="点击查看全部企业">
                                <span className="account-role-primary">
                                  <span>{primary.name}</span>
                                  <Tag color={organizationRoleColor[primary.role]}>{organizationRoleLabel[primary.role]}</Tag>
                                </span>
                                {extra > 0 ? <span className="account-role-more">… +{extra}</span> : null}
                              </button>
                            </Popover>
                          );
                        },
                      },
                      {
                        title: "平台权限",
                        width: 120,
                        sorter: (left, right) => (
                          Number(left.is_superuser) * 2 + Number(left.is_staff)
                        ) - (
                          Number(right.is_superuser) * 2 + Number(right.is_staff)
                        ),
                        render: (_: unknown, row) => {
                          const role = platformRoleOf(row);
                          if (role === "superuser") return <Tag color="purple">超级管理员</Tag>;
                          if (role === "staff") return <Tag color="blue">平台管理员</Tag>;
                          return <span className="account-muted">普通用户</span>;
                        },
                      },
                      {
                        title: "账号状态",
                        width: 100,
                        sorter: (left, right) => Number(left.is_active) - Number(right.is_active),
                        render: (_: unknown, row) => row.is_active
                          ? <Tag color="success">启用</Tag>
                          : <Tag>停用</Tag>,
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
                        title: "操作",
                        fixed: "right",
                        width: 88,
                        align: "center",
                        render: (_: unknown, row) => (
                          <Button
                            type="link"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => openEditModal(row)}
                          >
                            编辑
                          </Button>
                        ),
                      },
                    ]}
                  />
                </>}
       </div>
      </Card>

      {detailUser ? (
        <ManagementDetailModal
          open
          onClose={() => setDetailUser(null)}
          eyebrow="ACCOUNT DETAIL"
          title={detailUser.display_name || detailUser.username}
          subtitle={`@${detailUser.username}`}
          avatarSrc={authenticatedAvatarUrl(detailUser.avatar_url)}
          avatarText={detailUser.display_name || detailUser.username}
          badges={[
            {
              label: platformRoleLabel[platformRoleOf(detailUser)],
              color: platformRoleOf(detailUser) === "superuser" ? "purple" : platformRoleOf(detailUser) === "staff" ? "blue" : undefined,
            },
            { label: detailUser.is_active ? "已启用" : "已停用", color: detailUser.is_active ? "green" : undefined },
          ]}
          sections={[
            {
              title: "基本信息",
              fields: [
                { label: "用户名", value: `@${detailUser.username}` },
                { label: "成员姓名", value: detailUser.display_name || "未填写" },
                { label: "邮箱", value: detailUser.email || "未填写" },
                { label: "手机号", value: formatPhoneMasked(detailUser.phone_masked, "未填写") },
              ],
            },
            {
              title: "权限与企业",
              fields: [
                { label: "平台权限", value: platformRoleLabel[platformRoleOf(detailUser)] },
                { label: "账号状态", value: detailUser.is_active ? "启用" : "停用" },
                {
                  label: `所属企业（${detailUser.organizations?.length || 0}）`,
                  wide: true,
                  value: detailUser.organizations?.length ? (
                    <div className="management-detail-tag-list">
                      {detailUser.organizations.map((item) => (
                        <Tag key={item.id} color={organizationRoleColor[item.role]}>
                          {item.name} · {organizationRoleLabel[item.role]}{item.isCurrent ? " · 当前" : ""}
                        </Tag>
                      ))}
                    </div>
                  ) : "未分配企业",
                },
              ],
            },
            {
              title: "使用信息",
              fields: [
                { label: "加入时间", value: fmtDetailTime(detailUser.date_joined) },
                { label: "最近登录", value: fmtDetailTime(detailUser.last_login) },
                { label: "密码状态", value: detailUser.has_usable_password ? "已设置可用密码" : "未设置可用密码" },
                { label: "账号 ID", value: detailUser.id },
              ],
            },
          ]}
        />
      ) : null}

      <Modal
        className="account-admin-modal account-edit-modal"
        title={null}
        open={createOpen}
        onCancel={resetCreateModal}
        onOk={() => void handleCreate()}
        confirmLoading={saving}
        okText="创建"
        cancelText="取消"
        width={640}
        centered
        destroyOnHidden
      >
        <AccountEditModalHead
          icon={<PlusOutlined />}
          title="新建成员账号"
          subtitle="可同时加入多个企业"
        />
        <Form
          form={createForm}
          layout="vertical"
          className="account-edit-form"
          requiredMark="optional"
          initialValues={{
            platform_role: "user",
            organizations: [{ id: managementOrganizationId || organizations[0]?.id, role: "member" }],
          }}
        >
          <section className="account-edit-avatar-card">
            {createAvatarPreview ? (
              <AvatarPreview
                src={createAvatarPreview}
                size={56}
                className="account-edit-avatar-preview"
                alt={`${createDisplayName || "新成员"}的头像`}
              />
            ) : (
              <Avatar
                size={56}
                icon={<UserOutlined />}
                className="account-edit-avatar"
              >
                {(createDisplayName || "?").slice(0, 1)}
              </Avatar>
            )}
            <div className="account-edit-avatar-copy">
              <strong>头像</strong>
              <span>支持 png / jpg / gif / webp，不超过 5MB</span>
            </div>
            <Upload
              accept="image/png,image/jpeg,image/gif,image/webp"
              showUploadList={false}
              beforeUpload={handleCreateAvatarSelect}
            >
              <Button icon={<CameraOutlined />} className="account-edit-avatar-btn">
                {createAvatarPreview ? "更换头像" : "选择头像"}
              </Button>
            </Upload>
          </section>

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

          <div className="account-org-list-head">
            <strong>所属企业</strong>
            <Typography.Text type="secondary">可添加多个企业并分别设置角色</Typography.Text>
          </div>
          <Form.List
            name="organizations"
            rules={[{
              validator: async (_, value) => {
                if (!value?.length) throw new Error("至少选择一个所属企业");
              },
            }]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <div className="account-org-row" key={field.key}>
                    <Form.Item
                      {...field}
                      name={[field.name, "id"]}
                      rules={[{ required: true, message: "请选择企业" }]}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="选择企业"
                        options={organizationSelectOptions}
                      />
                    </Form.Item>
                    <Form.Item
                      {...field}
                      name={[field.name, "role"]}
                      rules={[{ required: true, message: "请选择角色" }]}
                      style={{ width: 140, marginBottom: 0 }}
                    >
                      <Select options={[
                        { value: "member", label: "企业成员" },
                        { value: "admin", label: "企业管理员" },
                      ]} />
                    </Form.Item>
                    {fields.length > 1 ? (
                      <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)} />
                    ) : <span style={{ width: 32 }} />}
                  </div>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ role: "member" })} style={{ marginTop: 8 }}>
                  添加企业
                </Button>
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>

          {isSuperuserSelf && (
            <Form.Item label="平台管理权限" name="platform_role" extra="超级管理员拥有全部后台权限，平台管理员可管理账号与企业" style={{ marginTop: 16 }}>
              <Select options={PLATFORM_ROLE_OPTIONS} />
            </Form.Item>
          )}
        </Form>
      </Modal>

      <Modal
        className="account-admin-modal account-edit-modal"
        title={null}
        open={editOpen}
        onCancel={() => { setEditOpen(false); setTarget(null); setEditAvatarUrl(""); editForm.resetFields(); }}
        onOk={() => void handleEdit()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={640}
        centered
        destroyOnHidden
        footer={(_, { OkBtn, CancelBtn }) => (
          <div className={`account-edit-footer${target && canDeleteAccount(target) ? " has-delete" : ""}`}>
            {target && canDeleteAccount(target) ? (
              <Button type="link" danger onClick={() => confirmDeleteAccount(target)}>
                删除账号
              </Button>
            ) : null}
            <Space size={10} className="account-edit-footer-actions">
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
        )}
      >
        <AccountEditModalHead
          icon={<EditOutlined />}
          title="编辑账号"
          subtitle={target ? `@${target.username}` : undefined}
        />
        <Form form={editForm} layout="vertical" className="account-edit-form" requiredMark="optional">
          <section className="account-edit-avatar-card">
            {authenticatedAvatarUrl(editAvatarUrl) ? (
              <AvatarPreview
                src={authenticatedAvatarUrl(editAvatarUrl)!}
                size={56}
                className="account-edit-avatar-preview"
                alt={`${target?.display_name || target?.username || "用户"}的头像`}
              />
            ) : (
              <Avatar
                size={56}
                icon={<UserOutlined />}
                className="account-edit-avatar"
              >
                {(target?.display_name || target?.username || "?").slice(0, 1)}
              </Avatar>
            )}
            <div className="account-edit-avatar-copy">
              <strong>头像</strong>
              <span>支持 png / jpg / gif / webp，不超过 5MB</span>
            </div>
            <Upload
              accept="image/png,image/jpeg,image/gif,image/webp"
              showUploadList={false}
              beforeUpload={(file) => {
                void handleEditAvatar(file);
                return false;
              }}
            >
              <Button icon={<CameraOutlined />} loading={avatarUploading} className="account-edit-avatar-btn">
                更换头像
              </Button>
            </Upload>
          </section>

          <div className="account-form-grid">
            <Form.Item label="成员姓名" name="display_name" required rules={[{ required: true, message: "请输入成员姓名" }]}>
              <Input prefix={<UserOutlined />} placeholder="在任务和协作中展示" />
            </Form.Item>
            <Form.Item label="邮箱" name="email">
              <Input prefix={<MailOutlined />} placeholder="选填" />
            </Form.Item>
            <Form.Item
              label="手机号"
              name="phone"
              className="account-edit-phone-item"
              help={hasFilledPhone(target?.phone_masked) ? `当前：${target?.phone_masked}（填写新号码才会更新）` : "填写后用于匹配企业微信成员"}
            >
              <Input prefix={<PhoneOutlined />} placeholder="留空则不修改" />
            </Form.Item>
            <Form.Item label="账号状态" name="is_active" valuePropName="checked" className="account-edit-status-item">
              <Switch
                checkedChildren="启用"
                unCheckedChildren="停用"
                disabled={target?.id === selfUserId}
              />
            </Form.Item>
          </div>

          <Form.Item
            label="重置密码"
            name="password"
            rules={[{ min: 8, message: "至少 8 位" }]}
            extra="留空表示不修改密码；填写后将立即失效旧登录态"
          >
            <Input.Password prefix={<LockOutlined />} placeholder="可选，填写则重置" autoComplete="new-password" />
          </Form.Item>

          <div className="account-org-list-head">
            <strong>所属企业</strong>
            <span>支持多个企业；所有者身份需通过所有权转移调整</span>
          </div>
          <Form.List
            name="organizations"
            rules={[{
              validator: async (_, value) => {
                if (!value?.length) throw new Error("至少保留一个所属企业");
              },
            }]}
          >
            {(fields, { add, remove }, { errors }) => (
              <div className="account-org-list">
                {fields.map((field) => {
                  const rowRole = editMemberships?.[field.name]?.role;
                  const isOwner = rowRole === "owner";
                  return (
                    <div className="account-org-card" key={field.key}>
                      <span className="account-org-card-icon"><BankOutlined /></span>
                      <Form.Item
                        {...field}
                        name={[field.name, "id"]}
                        rules={[{ required: true, message: "请选择企业" }]}
                        className="account-org-card-org"
                      >
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="选择企业"
                          disabled={isOwner}
                          variant="borderless"
                          options={editOrganizationOptions}
                          suffixIcon={null}
                        />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, "role"]}
                        rules={[{ required: true, message: "请选择角色" }]}
                        className="account-org-card-role"
                      >
                        <Select
                          disabled={isOwner}
                          options={isOwner
                            ? [{ value: "owner", label: "企业所有者" }]
                            : [
                              { value: "member", label: "企业成员" },
                              { value: "admin", label: "企业管理员" },
                            ]}
                        />
                      </Form.Item>
                      <Button
                        type="text"
                        className="account-org-card-remove"
                        disabled={isOwner || fields.length <= 1}
                        icon={<DeleteOutlined />}
                        onClick={() => remove(field.name)}
                        aria-label="移出企业"
                      />
                    </div>
                  );
                })}
                <Button
                  type="dashed"
                  block
                  className="account-org-add-btn"
                  icon={<PlusOutlined />}
                  onClick={() => add({ role: "member" })}
                >
                  添加企业
                </Button>
                <Form.ErrorList errors={errors} />
              </div>
            )}
          </Form.List>

          {isSuperuserSelf && (
            <Form.Item
              label="平台管理权限"
              name="platform_role"
              extra="超级管理员拥有全部后台权限"
              className="account-edit-platform-item"
            >
              <Select
                className="account-platform-role-select-lg"
                options={PLATFORM_ROLE_OPTIONS}
                disabled={Boolean(
                  target
                  && target.id === selfUserId
                  && platformRoleOf(target) === "superuser"
                )}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
