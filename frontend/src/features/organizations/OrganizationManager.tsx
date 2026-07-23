import { useEffect, useMemo, useState } from "react";
import { App, Alert, Avatar, Button, Form, Input, Modal, Select, Switch, Table, Tag, Typography } from "antd";
import {
  BankOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  SwapOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserAddOutlined,
} from "@ant-design/icons";

import {
  assignUsersToOrganization,
  createOrganization,
  getCurrentOrganization,
  listAdminUsers,
  listOrganizations,
  removeOrganizationMember,
  transferOrganizationOwnership,
  updateAdminUser,
  updateCurrentOrganization,
  type AdminUserRow,
  type OrganizationMember,
  type OrganizationSummary,
} from "../../api/client";
import { authenticatedAvatarUrl } from "../../utils/avatar";
import { formatPhoneMasked } from "../../utils/phone";
import ManagementDetailModal, {
  handleDetailRowKey,
  isInteractiveTableTarget,
} from "../../components/ManagementDetailModal";

const ROLE_COLOR = { owner: "gold", admin: "blue", member: "default" } as const;
const ROLE_ORDER = { owner: 3, admin: 2, member: 1 } as const;
const compareMemberName = (left: OrganizationMember, right: OrganizationMember) =>
  (left.displayName || left.username).localeCompare(
    right.displayName || right.username,
    "zh-CN",
    { numeric: true, sensitivity: "base" },
  );

interface Props {
  isSuperuser?: boolean;
  platformUsers?: AdminUserRow[];
  organizationId?: number;
  availableOrganizations?: OrganizationSummary[];
  onOrganizationChange?: (organizationId: number) => void;
  onOrganizationCreated?: () => void | Promise<void>;
}

export default function OrganizationManager({
  isSuperuser = false,
  platformUsers = [],
  organizationId,
  availableOrganizations = [],
  onOrganizationChange,
  onOrganizationCreated,
}: Props) {
  const { message, modal } = App.useApp();
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [detailMember, setDetailMember] = useState<OrganizationMember | null>(null);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingEvolution, setSavingEvolution] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [assignmentUsers, setAssignmentUsers] = useState<AdminUserRow[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [assignForm] = Form.useForm();
  const assignmentOrganizationId = Form.useWatch("organizationId", assignForm) as number | undefined;
  const availableAssignmentUsers = useMemo(
    () => assignmentUsers.filter(
      (user) => user.is_active
        && !user.organizations?.some((item) => item.id === assignmentOrganizationId),
    ),
    [assignmentOrganizationId, assignmentUsers],
  );
const formatDetailTime = (value?: string | null) => value
  ? new Date(value).toLocaleString("zh-CN", { hour12: false })
  : "—";
  const detailPlatformUser = detailMember
    ? platformUsers.find((user) => user.id === detailMember.id)
    : undefined;

  const load = async () => {
    setLoading(true);
    try {
      const response = await getCurrentOrganization(organizationId);
      setOrganization(response.organization);
      setMembers(response.members || []);
      setName(response.organization.name);
    } catch (error: any) {
      message.error(error?.response?.data?.error || "企业信息加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const saveName = async () => {
    const nextName = name.trim();
    if (!nextName) {
      message.warning("请输入企业名称");
      return;
    }
    setSaving(true);
    try {
      const response = await updateCurrentOrganization({ name: nextName, organizationId: organization?.id });
      setOrganization(response.organization);
      setName(response.organization.name);
      message.success("企业名称已保存");
    } catch (error: any) {
      message.error(error?.response?.data?.error || "企业名称保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveEvolutionToggle = async (enabled: boolean) => {
    if (!organization?.canManage) return;
    setSavingEvolution(true);
    try {
      const response = await updateCurrentOrganization({
        sopEvolutionEnabled: enabled,
        organizationId: organization.id,
      });
      setOrganization(response.organization);
      message.success(enabled ? "已开启 SOP 自我进化" : "已关闭 SOP 自我进化");
    } catch (error: any) {
      message.error(error?.response?.data?.error || "设置保存失败");
    } finally {
      setSavingEvolution(false);
    }
  };

  const transferOwnership = () => {
    const candidates = members.filter((member) => member.isActive && member.role !== "owner");
    let targetUserId: number | undefined;
    modal.confirm({
      className: "org-settings-confirm",
      title: "确认转移企业所有权？",
      icon: <ExclamationCircleOutlined style={{ color: "#c43c3c" }} />,
      width: 480,
      okText: "确认转移",
      cancelText: "取消",
      okButtonProps: { danger: true },
      content: (
        <div className="org-settings-confirm__body">
          <p>
            转移后当前账号将降级为普通成员，新所有者获得企业最高权限。此操作不可撤销，请谨慎确认。
          </p>
          <Select
            style={{ width: "100%" }}
            placeholder="选择新的企业所有者"
            options={candidates.map((member) => ({
              value: member.id,
              label: `${member.displayName}（@${member.username}）`,
            }))}
            onChange={(value) => { targetUserId = value; }}
          />
        </div>
      ),
      onOk: async () => {
        if (!targetUserId) throw new Error("请选择新的企业所有者");
        try {
          await transferOrganizationOwnership(targetUserId, organization?.id);
          message.success("企业所有权已转移");
          await load();
        } catch (error: any) {
          message.error(error?.response?.data?.error || error?.message || "企业所有权转移失败");
          throw error;
        }
      },
    });
  };

  const submitCreateOrganization = async () => {
    const values = await createForm.validateFields();
    setCreating(true);
    try {
      const response = await createOrganization({
        name: String(values.name).trim(),
        ownerUserId: Number(values.ownerUserId),
      });
      message.success(`企业“${response.organization.name}”已创建`);
      setCreateOpen(false);
      createForm.resetFields();
      await onOrganizationCreated?.();
    } catch (error: any) {
      message.error(error?.response?.data?.error || "创建企业失败");
    } finally {
      setCreating(false);
    }
  };

  const openAssignment = async () => {
    setAssignOpen(true);
    setAssignmentLoading(true);
    setAssignmentUsers([]);
    try {
      const [organizationResponse, userResponse] = await Promise.all([
        listOrganizations(),
        listAdminUsers(),
      ]);
      setOrganizations(organizationResponse.results || []);
      setAssignmentUsers(userResponse.results || []);
      assignForm.setFieldsValue({
        organizationId: organization?.id,
        role: "member",
      });
    } catch (error: any) {
      message.error(error?.response?.data?.error || "企业列表加载失败");
    } finally {
      setAssignmentLoading(false);
    }
  };

  const submitAssignment = async () => {
    const values = await assignForm.validateFields();
    setAssigning(true);
    try {
      const response = await assignUsersToOrganization({
        organizationId: Number(values.organizationId),
        userIds: values.userIds.map(Number),
        role: values.role,
      });
      message.success(
        response.skippedCount
          ? `已新增 ${response.assignedCount} 位成员，跳过 ${response.skippedCount} 位已有成员`
          : `已将 ${response.assignedCount} 位用户加入“${response.organization.name}”`,
      );
      setAssignOpen(false);
      assignForm.resetFields();
      await Promise.all([load(), onOrganizationCreated?.()]);
    } catch (error: any) {
      message.error(error?.response?.data?.error || "用户分配失败");
    } finally {
      setAssigning(false);
    }
  };

  const confirmRemoveMember = (member: OrganizationMember) => {
    modal.confirm({
      title: `将“${member.displayName || member.username}”移出企业？`,
      content: "该成员的平台账号不会被停用，但将立即失去当前企业的数据和配置访问权限。",
      okText: "确认移出",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        setRemovingUserId(member.id);
        try {
          await removeOrganizationMember(member.id, organization?.id);
          message.success("成员已移出企业");
          await Promise.all([load(), onOrganizationCreated?.()]);
        } catch (error: any) {
          message.error(error?.response?.data?.error || "移出成员失败");
        } finally {
          setRemovingUserId(null);
        }
      },
    });
  };

  return (
    <section className="organization-manager">
      <div className="account-admin-toolbar">
        <div>
          <Typography.Title level={5}><BankOutlined /> 企业与成员</Typography.Title>
          <Typography.Text type="secondary">
            企业管理员配置的企业微信 API、通讯录和群机器人，仅对授权成员生效。
          </Typography.Text>
        </div>
        <div className="organization-toolbar-actions">
          {(availableOrganizations.length > 1 || isSuperuser) && (
            <Select
              className="organization-scope-select"
              value={organization?.id || organizationId}
              onChange={(value) => onOrganizationChange?.(Number(value))}
              placeholder="选择要管理的企业"
              optionFilterProp="label"
              showSearch
              options={availableOrganizations.map((item) => ({
                value: item.id,
                label: `${item.name}（${item.memberCount} 人）`,
              }))}
            />
          )}
          {isSuperuser && (
            <>
              <Button icon={<UserAddOutlined />} onClick={() => void openAssignment()}>
                分配用户
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                创建企业
              </Button>
            </>
          )}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
        </div>
      </div>

      <div className="organization-profile">
        <span className="organization-profile-icon"><BankOutlined /></span>
        <div className="organization-profile-copy">
          <Typography.Text type="secondary">当前企业</Typography.Text>
          <Typography.Title level={4}>{organization?.name || "—"}</Typography.Title>
          <Typography.Text type="secondary">
            企业角色：{organization?.role === "owner" ? "企业所有者" : organization?.role === "admin" ? "企业管理员" : organization?.role === "member" ? "企业成员" : "平台管理员（管理视图）"}
          </Typography.Text>
        </div>
        {organization?.canManage && (
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>
            企业设置
          </Button>
        )}
        <div className="organization-profile-count">
          <TeamOutlined />
          <strong>{organization?.memberCount || members.length}</strong>
          <span>位企业成员</span>
        </div>
      </div>

      <div className="organization-member-heading">
        <div>
          <Typography.Title level={5}>成员权限</Typography.Title>
          <Typography.Text type="secondary">企业角色与平台管理权限相互独立。</Typography.Text>
        </div>
        <Tag>{members.length} 位成员</Tag>
      </div>

      <Table
        className="account-admin-table"
        rowKey="id"
        loading={loading}
        pagination={{
          defaultPageSize: 10,
          pageSizeOptions: [10, 20, 50],
          showSizeChanger: true,
          hideOnSinglePage: true,
          showTotal: (total) => `共 ${total} 位成员`,
        }}
        dataSource={members}
        onRow={(member) => ({
          className: "management-detail-row",
          tabIndex: 0,
          "aria-label": `查看${member.displayName || member.username}的企业成员详情`,
          onClick: (event) => {
            if (!isInteractiveTableTarget(event.target)) setDetailMember(member);
          },
          onKeyDown: (event) => handleDetailRowKey(event, () => setDetailMember(member)),
        })}
        showSorterTooltip={{ title: "点击切换升序或降序" }}
        columns={[
          {
            title: "成员",
            sorter: compareMemberName,
            render: (_: unknown, row) => (
              <div className="account-member-cell">
                <Avatar src={authenticatedAvatarUrl(row.avatarUrl)}>
                  {(row.displayName || row.username).slice(0, 1).toUpperCase()}
                </Avatar>
                <span>
                  <strong>{row.displayName}</strong>
                  <small>@{row.username}</small>
                </span>
              </div>
            ),
          },
          {
            title: "企业角色",
            width: 200,
            sorter: (left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role],
            render: (_: unknown, row) => organization?.canManage && row.role !== "owner"
              ? (
                <Select
                  className="organization-role-select"
                  popupClassName="organization-role-dropdown"
                  popupMatchSelectWidth={160}
                  value={row.role}
                  style={{ width: 140 }}
                  options={[
                    { value: "admin", label: "企业管理员" },
                    { value: "member", label: "企业成员" },
                  ]}
                  onChange={async (role) => {
                    try {
                      await updateAdminUser(row.id, { organization_id: organization?.id, organization_role: role });
                      message.success("企业角色已更新");
                      await load();
                    } catch (error: any) {
                      message.error(error?.response?.data?.error || "企业角色更新失败");
                    }
                  }}
                />
              )
              : <Tag color={ROLE_COLOR[row.role]}>{row.roleLabel}</Tag>,
          },
          {
            title: "账号状态",
            width: 120,
            sorter: (left, right) => Number(left.isActive) - Number(right.isActive),
            render: (_: unknown, row) => (
              <Tag color={row.isActive ? "green" : "default"}>{row.isActive ? "已启用" : "已停用"}</Tag>
            ),
          },
          {
            title: "操作",
            width: 110,
            align: "center",
            render: (_: unknown, row) => row.canRemove ? (
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                loading={removingUserId === row.id}
                disabled={removingUserId !== null && removingUserId !== row.id}
                onClick={() => confirmRemoveMember(row)}
              >
                移出
              </Button>
            ) : <Typography.Text type="secondary">—</Typography.Text>,
          },
        ]}
      />

      {detailMember ? (
        <ManagementDetailModal
          open
          onClose={() => setDetailMember(null)}
          eyebrow="MEMBER DETAIL"
          title={detailMember.displayName || detailMember.username}
          subtitle={`@${detailMember.username}`}
          avatarSrc={authenticatedAvatarUrl(detailMember.avatarUrl)}
          avatarText={detailMember.displayName || detailMember.username}
          badges={[
            { label: detailMember.roleLabel, color: ROLE_COLOR[detailMember.role] },
            { label: detailMember.isActive ? "已启用" : "已停用", color: detailMember.isActive ? "green" : undefined },
          ]}
          sections={[
            {
              title: "成员信息",
              fields: [
                { label: "用户名", value: `@${detailMember.username}` },
                { label: "成员姓名", value: detailMember.displayName || "未填写" },
                { label: "邮箱", value: detailPlatformUser?.email || "未填写" },
                { label: "手机号", value: formatPhoneMasked(detailPlatformUser?.phone_masked, "未填写") },
              ],
            },
            {
              title: "企业与权限",
              fields: [
                { label: "当前企业", value: organization?.name || "—" },
                { label: "企业角色", value: detailMember.roleLabel },
                {
                  label: "平台权限",
                  value: detailPlatformUser?.is_superuser
                    ? "超级管理员"
                    : detailPlatformUser?.is_staff ? "平台管理员" : "普通用户",
                },
                { label: "可移出企业", value: detailMember.canRemove ? "是" : "否" },
              ],
            },
            {
              title: "账号活动",
              fields: [
                { label: "账号状态", value: detailMember.isActive ? "启用" : "停用" },
                { label: "最近登录", value: formatDetailTime(detailPlatformUser?.last_login) },
                { label: "加入平台", value: formatDetailTime(detailPlatformUser?.date_joined) },
                { label: "成员 ID", value: detailMember.id },
              ],
            },
          ]}
        />
      ) : null}

      <Modal
        className="org-settings-modal"
        title={
          <div className="org-settings-modal__title">
            <span className="org-settings-modal__title-icon" aria-hidden>
              <SettingOutlined />
            </span>
            <div>
              <strong>企业设置</strong>
              <small>管理企业信息、AI 能力与权限</small>
            </div>
          </div>
        }
        open={settingsOpen}
        footer={null}
        width={640}
        centered
        onCancel={() => {
          setSettingsOpen(false);
          setName(organization?.name || "");
        }}
        destroyOnHidden
      >
        <div className="org-settings-modal__body">
          <section className="org-settings-section">
            <header className="org-settings-section__head">
              <span className="org-settings-section__icon" aria-hidden>
                <BankOutlined />
              </span>
              <div>
                <h3>企业信息</h3>
                <p>用于工作台、成员管理与企业连接中的标识。</p>
              </div>
            </header>
            <label className="org-settings-field">
              <span>企业名称</span>
              <div className="org-settings-field__row">
                <Input
                  value={name}
                  maxLength={128}
                  placeholder="输入企业名称"
                  onChange={(event) => setName(event.target.value)}
                  onPressEnter={() => void saveName()}
                />
                <button
                  type="button"
                  className="org-settings-save-btn"
                  disabled={saving || !name.trim() || name.trim() === organization?.name}
                  onClick={() => void saveName()}
                >
                  {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </label>
          </section>

          {organization?.canManage && (
            <section className="org-settings-section org-settings-ai">
              <div className="org-settings-ai__card">
                <div className="org-settings-ai__top">
                  <span className="org-settings-ai__badge" aria-hidden>
                    <ThunderboltOutlined />
                  </span>
                  <div className="org-settings-ai__copy">
                    <div className="org-settings-ai__heading">
                      <h3>SOP 自我进化</h3>
                      <span
                        className={
                          organization.sopEvolutionEnabled !== false
                            ? "org-settings-status is-on"
                            : "org-settings-status is-off"
                        }
                      >
                        {organization.sopEvolutionEnabled !== false ? "已开启" : "已关闭"}
                      </span>
                    </div>
                    <p>
                      AI 会根据运行数据、执行反馈持续发现流程优化机会，并生成改进建议。
                    </p>
                  </div>
                  <Switch
                    className="org-settings-toggle"
                    checked={organization.sopEvolutionEnabled !== false}
                    loading={savingEvolution}
                    onChange={(checked) => void saveEvolutionToggle(checked)}
                  />
                </div>
                {organization.sopEvolutionEnabled !== false && (
                  <div className="org-settings-ai__insight">
                    <span className="org-settings-ai__insight-label">最近优化</span>
                    <span className="org-settings-ai__insight-value">
                      {(organization.pendingEvolutionCount ?? 0) > 0
                        ? `已发现 ${organization.pendingEvolutionCount} 个流程优化机会`
                        : "暂无待处理的优化建议"}
                    </span>
                  </div>
                )}
              </div>
            </section>
          )}

          {organization?.role === "owner" && (
            <section className="org-settings-section org-settings-danger">
              <div className="org-settings-danger__card">
                <span className="org-settings-danger__icon" aria-hidden>
                  <ExclamationCircleOutlined />
                </span>
                <div className="org-settings-danger__copy">
                  <h3>企业所有权</h3>
                  <p>转移后当前账号将降级为普通成员，新所有者获得企业最高权限。</p>
                </div>
                <button
                  type="button"
                  className="org-settings-danger__btn"
                  onClick={transferOwnership}
                >
                  <SwapOutlined />
                  转移所有权
                </button>
              </div>
            </section>
          )}
        </div>
      </Modal>

      <Modal
        className="organization-assignment-modal"
        title="分配平台用户到企业"
        open={assignOpen}
        okText="确认分配"
        cancelText="取消"
        confirmLoading={assigning}
        onOk={() => void submitAssignment()}
        onCancel={() => {
          setAssignOpen(false);
          assignForm.resetFields();
        }}
        width={620}
        destroyOnHidden
      >
        <Form form={assignForm} layout="vertical" preserve={false}>
          <Alert
            type="info"
            showIcon
            message="分配只会新增企业成员关系"
            description="用户原有企业和当前企业保持不变，可在个人资料中自行切换。仅当用户尚无当前企业时，目标企业才会自动成为当前企业。"
            style={{ marginBottom: 18 }}
          />
          <Form.Item
            label="目标企业"
            name="organizationId"
            rules={[{ required: true, message: "请选择目标企业" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择用户要加入的企业"
              loading={assignmentLoading}
              onChange={() => assignForm.setFieldValue("userIds", [])}
              options={organizations
                .filter((item) => item.isActive)
                .map((item) => ({
                  value: item.id,
                  label: `${item.name}（${item.memberCount} 人）`,
                }))}
            />
          </Form.Item>
          <Form.Item
            label="平台用户"
            name="userIds"
            rules={[{ required: true, message: "请至少选择一位用户" }]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              loading={assignmentLoading}
              disabled={!assignmentOrganizationId || assignmentLoading}
              placeholder={assignmentOrganizationId ? "选择尚未加入该企业的平台用户" : "请先选择目标企业"}
              notFoundContent={assignmentLoading ? "正在加载平台用户…" : "所有启用用户均已加入该企业"}
              options={availableAssignmentUsers
                .map((user) => ({
                  value: user.id,
                  label: `${user.display_name || user.username}（@${user.username}）${user.organizations?.length ? ` · 已加入：${user.organizations.map((item) => item.name).join("、")}` : ""}`,
                }))}
            />
          </Form.Item>
          <Form.Item
            label="企业角色"
            name="role"
            initialValue="member"
            rules={[{ required: true, message: "请选择企业角色" }]}
          >
            <Select
              options={[
                { value: "member", label: "企业成员" },
                { value: "admin", label: "企业管理员" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="创建企业"
        open={createOpen}
        okText="创建企业"
        cancelText="取消"
        confirmLoading={creating}
        onOk={() => void submitCreateOrganization()}
        onCancel={() => {
          setCreateOpen(false);
          createForm.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item
            label="企业名称"
            name="name"
            rules={[
              { required: true, message: "请输入企业名称" },
              { max: 128, message: "企业名称不能超过 128 个字符" },
            ]}
          >
            <Input placeholder="例如：XX科技有限公司" maxLength={128} />
          </Form.Item>
          <Form.Item
            label="初始所有者"
            name="ownerUserId"
            extra="创建后，该企业将成为所选用户的当前企业，用户拥有企业最高管理权限。"
            rules={[{ required: true, message: "请选择初始所有者" }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择一个启用的平台用户"
              options={platformUsers
                .filter((user) => user.is_active)
                .map((user) => ({
                  value: user.id,
                  label: `${user.display_name || user.username}（@${user.username}）`,
                }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
