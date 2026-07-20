import { useEffect, useMemo, useRef, useState } from "react";
import { App, Avatar, Button, Empty, Form, Input, Modal, Segmented, Select, Table, Tag, Typography } from "antd";
import {
  ApartmentOutlined,
  DeleteOutlined,
  GlobalOutlined,
  InfoCircleFilled,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
  UserAddOutlined,
} from "@ant-design/icons";

import {
  addTeamMembers,
  createTeam,
  deleteTeam,
  listOrganizations,
  listTeamUserOptions,
  listTeams,
  removeTeamMember,
  type OrganizationSummary,
  type TeamKind,
  type TeamSummary,
  type TeamUserOption,
} from "../../api/client";

const KIND_META: Record<TeamKind, { label: string; color: string; icon: JSX.Element; hint: string }> = {
  platform: {
    label: "平台团队",
    color: "purple",
    icon: <GlobalOutlined />,
    hint: "跨企业协作组，由平台管理员维护，成员可来自不同企业。",
  },
  enterprise: {
    label: "企业团队",
    color: "blue",
    icon: <ApartmentOutlined />,
    hint: "企业内部小组/部门，由企业管理员维护，成员限本企业。",
  },
};

interface Props {
  isSuperuser?: boolean;
  isPlatformAdmin?: boolean;
  canManageOrg?: boolean;
  currentOrgName?: string;
}

export default function TeamManager({
  isSuperuser = false,
  isPlatformAdmin = false,
  canManageOrg = false,
  currentOrgName = "",
}: Props) {
  const { message, modal } = App.useApp();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | TeamKind>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm();
  const createKind = Form.useWatch("kind", createForm) as TeamKind | undefined;
  const createOrgId = Form.useWatch("organizationId", createForm) as number | undefined;
  const createMemberIds = Form.useWatch("memberIds", createForm) as number[] | undefined;
  const [createOptions, setCreateOptions] = useState<TeamUserOption[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const memberSelectRef = useRef<any>(null);

  const [memberTeam, setMemberTeam] = useState<TeamSummary | null>(null);
  const [memberOpen, setMemberOpen] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);
  const [memberForm] = Form.useForm();
  const [memberOptions, setMemberOptions] = useState<TeamUserOption[]>([]);

  const canCreatePlatform = isPlatformAdmin || isSuperuser;
  const canCreateEnterprise = canManageOrg || isSuperuser;
  const canCreateAny = canCreatePlatform || canCreateEnterprise;

  const load = async () => {
    setLoading(true);
    try {
      const res = await listTeams();
      setTeams(res.results || []);
    } catch (error: any) {
      message.error(error?.response?.data?.error || "团队列表加载失败");
      setTeams([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const visibleTeams = useMemo(
    () => (kindFilter === "all" ? teams : teams.filter((team) => team.kind === kindFilter)),
    [teams, kindFilter],
  );

  const selectedCreateMembers = useMemo(
    () => (createMemberIds || [])
      .map((id) => createOptions.find((option) => option.id === id))
      .filter((option): option is TeamUserOption => Boolean(option)),
    [createMemberIds, createOptions],
  );

  const activeCreateKind: TeamKind = createKind || "enterprise";
  const membersDisabled = activeCreateKind === "enterprise" && isSuperuser && !createOrgId;

  const optionText = (option: TeamUserOption, isEnterprise: boolean) =>
    `${option.displayName}（@${option.username}）${isEnterprise && !option.wecomBound ? " · 待绑定企微" : ""}`;

  const openCreate = async () => {
    const defaultKind: TeamKind = canCreatePlatform && !canCreateEnterprise ? "platform" : "enterprise";
    createForm.resetFields();
    createForm.setFieldsValue({ kind: defaultKind });
    setCreateOptions([]);
    setCreateOpen(true);
    if (isSuperuser && organizations.length === 0) {
      try {
        const res = await listOrganizations();
        setOrganizations((res.results || []).filter((item) => item.isActive));
      } catch {
        /* 忽略企业列表加载失败，仍可创建平台团队 */
      }
    }
  };

  useEffect(() => {
    if (!createOpen || !createKind) return;
    if (createKind === "enterprise" && isSuperuser && !createOrgId) {
      setCreateOptions([]);
      return;
    }
    let cancelled = false;
    listTeamUserOptions({ kind: createKind, organizationId: createKind === "enterprise" ? createOrgId : undefined })
      .then((res) => {
        if (!cancelled) setCreateOptions(res.results || []);
      })
      .catch(() => {
        if (!cancelled) setCreateOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [createOpen, createKind, createOrgId, isSuperuser]);

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    setCreating(true);
    try {
      const res = await createTeam({
        name: String(values.name).trim(),
        kind: values.kind,
        description: values.description || "",
        organizationId: values.kind === "enterprise" && isSuperuser ? values.organizationId : undefined,
        memberIds: (values.memberIds || []).map(Number),
      });
      message.success(`团队“${res.team.name}”已创建`);
      setCreateOpen(false);
      createForm.resetFields();
      await load();
    } catch (error: any) {
      message.error(error?.response?.data?.error || "创建团队失败");
    } finally {
      setCreating(false);
    }
  };

  const openMemberModal = async (team: TeamSummary) => {
    setMemberTeam(team);
    memberForm.resetFields();
    setMemberOptions([]);
    setMemberOpen(true);
    try {
      const res = await listTeamUserOptions({
        kind: team.kind,
        organizationId: team.organizationId || undefined,
      });
      const existing = new Set(team.members.map((m) => m.id));
      setMemberOptions((res.results || []).filter((option) => !existing.has(option.id)));
    } catch (error: any) {
      message.error(error?.response?.data?.error || "候选成员加载失败");
    }
  };

  const submitAddMembers = async () => {
    if (!memberTeam) return;
    const values = await memberForm.validateFields();
    setAddingMembers(true);
    try {
      const res = await addTeamMembers(memberTeam.id, { userIds: values.userIds.map(Number) });
      message.success(`已加入 ${res.addedCount} 位成员`);
      setMemberOpen(false);
      setMemberTeam(null);
      memberForm.resetFields();
      await load();
    } catch (error: any) {
      message.error(error?.response?.data?.error || "添加成员失败");
    } finally {
      setAddingMembers(false);
    }
  };

  const confirmRemoveMember = (team: TeamSummary, member: TeamSummary["members"][number]) => {
    modal.confirm({
      title: `将“${member.displayName || member.username}”移出团队？`,
      content: `移出后该成员将不再属于“${team.name}”，其平台账号与企业成员关系不受影响。`,
      okText: "确认移出",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await removeTeamMember(team.id, member.id);
          message.success("成员已移出团队");
          await load();
        } catch (error: any) {
          message.error(error?.response?.data?.error || "移出成员失败");
        }
      },
    });
  };

  const confirmDeleteTeam = (team: TeamSummary) => {
    modal.confirm({
      title: `删除团队“${team.name}”？`,
      content: "删除后团队及其成员归属关系会被移除，引用该团队的知识库范围将失效。此操作不可恢复。",
      okText: "确认删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteTeam(team.id);
          message.success("团队已删除");
          await load();
        } catch (error: any) {
          message.error(error?.response?.data?.error || "删除团队失败");
        }
      },
    });
  };

  const platformCount = teams.filter((team) => team.kind === "platform").length;
  const enterpriseCount = teams.filter((team) => team.kind === "enterprise").length;

  return (
    <section className="team-manager">
      <div className="account-admin-toolbar">
        <div>
          <Typography.Title level={5}><TeamOutlined /> 团队</Typography.Title>
          <Typography.Text type="secondary">
            平台团队与企业团队用于知识库等场景的可见范围划分，与企业成员角色相互独立。
          </Typography.Text>
        </div>
        <div className="team-toolbar-actions">
          <Segmented
            className="team-kind-seg"
            value={kindFilter}
            onChange={(value) => setKindFilter(value as "all" | TeamKind)}
            options={[
              { label: `全部 ${teams.length}`, value: "all" },
              { label: `平台团队 ${platformCount}`, value: "platform" },
              { label: `企业团队 ${enterpriseCount}`, value: "enterprise" },
            ]}
          />
          {canCreateAny && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => void openCreate()}>
              新建团队
            </Button>
          )}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>刷新</Button>
        </div>
      </div>

      <Table
        className="account-admin-table team-table"
        rowKey="id"
        loading={loading}
        dataSource={visibleTeams}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无团队，点击右上角新建" /> }}
        pagination={{ defaultPageSize: 10, hideOnSinglePage: true, showTotal: (total) => `共 ${total} 个团队` }}
        expandable={{
          expandedRowRender: (team) => (
            <div className="team-member-panel">
              <div className="team-member-panel-head">
                <span>
                  团队成员（{team.members.length}）
                  {team.kind === "enterprise" && team.pendingWecomCount > 0 && (
                    <Tag color="orange" style={{ marginLeft: 8 }}>{team.pendingWecomCount} 人待绑定企微</Tag>
                  )}
                </span>
                {team.canManage && (
                  <Button size="small" icon={<UserAddOutlined />} onClick={() => void openMemberModal(team)}>
                    添加成员
                  </Button>
                )}
              </div>
              {team.members.length === 0 ? (
                <Typography.Text type="secondary">暂无成员</Typography.Text>
              ) : (
                <div className="team-member-chips">
                  {team.members.map((member) => (
                    <span className="team-member-chip" key={member.id}>
                      <Avatar size={22}>{(member.displayName || member.username).slice(0, 1).toUpperCase()}</Avatar>
                      <span className="team-member-chip-name">
                        {member.displayName}
                        <small>@{member.username}</small>
                      </span>
                      {member.role === "lead" && <Tag color="gold">负责人</Tag>}
                      {team.kind === "enterprise" && !member.wecomBound && (
                        <Tag color="orange" className="team-pending-tag">待绑定企微</Tag>
                      )}
                      {team.canManage && (
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => confirmRemoveMember(team, member)}
                        />
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ),
        }}
        columns={[
          {
            title: "团队",
            render: (_: unknown, team) => (
              <div className="team-name-cell">
                <span className={`team-kind-icon is-${team.kind}`}>{KIND_META[team.kind].icon}</span>
                <span>
                  <strong>{team.name}</strong>
                  <small>{team.description || KIND_META[team.kind].hint}</small>
                </span>
              </div>
            ),
          },
          {
            title: "类型",
            width: 130,
            filters: [
              { text: "平台团队", value: "platform" },
              { text: "企业团队", value: "enterprise" },
            ],
            onFilter: (value, team) => team.kind === value,
            render: (_: unknown, team) => <Tag color={KIND_META[team.kind].color}>{team.kindLabel}</Tag>,
          },
          {
            title: "所属企业",
            width: 180,
            render: (_: unknown, team) => team.kind === "enterprise"
              ? <span>{team.organizationName || "—"}</span>
              : <Typography.Text type="secondary">跨企业</Typography.Text>,
          },
          {
            title: "成员数",
            width: 90,
            align: "center",
            sorter: (left, right) => left.memberCount - right.memberCount,
            render: (_: unknown, team) => <Tag>{team.memberCount}</Tag>,
          },
          {
            title: "操作",
            width: 170,
            align: "right",
            render: (_: unknown, team) => team.canManage ? (
              <div className="team-row-actions">
                <Button type="link" size="small" icon={<UserAddOutlined />} onClick={() => void openMemberModal(team)}>
                  成员
                </Button>
                <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => confirmDeleteTeam(team)}>
                  删除
                </Button>
              </div>
            ) : <Typography.Text type="secondary">—</Typography.Text>,
          },
        ]}
      />

      <Modal
        className="team-create-modal"
        title={(
          <div className="team-modal-title">
            <span className="team-modal-title-icon"><TeamOutlined /></span>
            <div>
              <strong>新建团队</strong>
              <small>用于知识库等场景的可见范围划分</small>
            </div>
          </div>
        )}
        open={createOpen}
        footer={null}
        onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        width={560}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" preserve={false} initialValues={{ kind: "enterprise" }}>
          <Form.Item label="团队类型" name="kind" rules={[{ required: true, message: "请选择团队类型" }]}>
            <Select
              popupClassName="team-select-dropdown"
              optionLabelProp="label"
              options={[
                {
                  value: "platform",
                  disabled: !canCreatePlatform,
                  label: <span className="team-opt"><span className="team-opt-icon is-platform"><GlobalOutlined /></span>平台团队 · 跨企业</span>,
                },
                {
                  value: "enterprise",
                  disabled: !canCreateEnterprise,
                  label: <span className="team-opt"><span className="team-opt-icon is-enterprise"><ApartmentOutlined /></span>企业团队 · 企业内部</span>,
                },
              ]}
            />
          </Form.Item>

          <div className="team-info-banner">
            <InfoCircleFilled />
            <span>{KIND_META[activeCreateKind].hint}</span>
          </div>

          <Form.Item label="团队名称" name="name" rules={[{ required: true, message: "请输入团队名称" }, { max: 128, message: "最多 128 字" }]}>
            <Input prefix={<TeamOutlined />} placeholder="例如：品牌增长小组" maxLength={128} />
          </Form.Item>

          {isSuperuser && activeCreateKind === "enterprise" && (
            <Form.Item label="所属企业" name="organizationId" rules={[{ required: true, message: "请选择所属企业" }]}>
              <Select
                showSearch
                optionFilterProp="label"
                popupClassName="team-select-dropdown"
                placeholder="选择团队归属的企业"
                options={organizations.map((org) => ({ value: org.id, label: `${org.name}（${org.memberCount} 人）` }))}
              />
            </Form.Item>
          )}
          {!isSuperuser && activeCreateKind === "enterprise" && currentOrgName && (
            <Form.Item label="所属企业">
              <Input prefix={<ApartmentOutlined />} value={currentOrgName} disabled />
            </Form.Item>
          )}

          <Form.Item label="团队说明" name="description">
            <Input.TextArea className="team-desc" rows={2} maxLength={255} placeholder="选填，简述团队职责或用途" />
          </Form.Item>

          <Form.Item label="初始成员" className="team-member-field">
            <Form.Item name="memberIds" noStyle>
              <Select
                ref={memberSelectRef}
                mode="multiple"
                showSearch
                optionFilterProp="label"
                maxTagCount="responsive"
                popupClassName="team-select-dropdown"
                suffixIcon={<UserAddOutlined />}
                placeholder={membersDisabled ? "请先选择所属企业" : "选择团队成员"}
                disabled={membersDisabled}
                options={createOptions.map((option) => ({
                  value: option.id,
                  label: optionText(option, activeCreateKind === "enterprise"),
                }))}
              />
            </Form.Item>
            <div className="team-member-preview">
              {selectedCreateMembers.length > 0 && (
                <div className="team-member-avatars">
                  {selectedCreateMembers.slice(0, 6).map((member) => (
                    <Avatar key={member.id} size={28}>{(member.displayName || member.username).slice(0, 1).toUpperCase()}</Avatar>
                  ))}
                  {selectedCreateMembers.length > 6 && <Avatar size={28}>+{selectedCreateMembers.length - 6}</Avatar>}
                </div>
              )}
              <button
                type="button"
                className="team-invite-chip"
                disabled={membersDisabled}
                onClick={() => memberSelectRef.current?.focus()}
              >
                <PlusOutlined /> 邀请成员
              </button>
              <span className="team-member-hint">可稍后在列表中继续添加或移除</span>
            </div>
          </Form.Item>
        </Form>

        <div className="team-modal-footer">
          <Button onClick={() => { setCreateOpen(false); createForm.resetFields(); }}>取消</Button>
          <Button type="primary" className="team-primary-btn" loading={creating} onClick={() => void submitCreate()}>
            创建团队
          </Button>
        </div>
      </Modal>

      <Modal
        title={memberTeam ? `添加成员 · ${memberTeam.name}` : "添加成员"}
        open={memberOpen}
        okText="添加"
        cancelText="取消"
        confirmLoading={addingMembers}
        onOk={() => void submitAddMembers()}
        onCancel={() => { setMemberOpen(false); setMemberTeam(null); memberForm.resetFields(); }}
        width={560}
        destroyOnClose
      >
        <Form form={memberForm} layout="vertical" preserve={false}>
          <Form.Item
            label="选择成员"
            name="userIds"
            rules={[{ required: true, message: "请至少选择一位成员" }]}
            extra={memberTeam?.kind === "platform"
              ? "平台团队可添加任意企业的启用用户"
              : "企业团队仅能添加本企业成员；未绑定企业微信的成员会标记为「待绑定企微」，绑定后自动生效"}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              placeholder={memberOptions.length ? "选择要加入的成员" : "暂无可添加的成员"}
              options={memberOptions.map((option) => ({
                value: option.id,
                label: optionText(option, memberTeam?.kind === "enterprise"),
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
