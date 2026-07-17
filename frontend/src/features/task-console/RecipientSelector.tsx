import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Avatar, Button, Select, Space, Tag, Typography } from "antd";
import { BellOutlined, ReloadOutlined, TeamOutlined, UserOutlined } from "@ant-design/icons";
import {
  getWeComApiError,
  getWeComGroups,
  getWeComUsers,
  type NotificationMode,
  type TaskAssignmentValue,
  type WeComMember,
  type WeComGroup,
} from "./mockWeCom";

interface Props {
  value: TaskAssignmentValue;
  onChange: (next: TaskAssignmentValue) => void;
  refreshKey?: number;
}

const ADMIN_HINT = "企业微信尚未配置或暂无权限，请联系管理员开通后再发送通知。你仍可选择「暂不通知」继续创建任务。";

const NOTIFY_MODES: Array<{ value: NotificationMode; label: string; icon: typeof UserOutlined }> = [
  { value: "person", label: "企微个人", icon: UserOutlined },
  { value: "group", label: "企微群聊", icon: TeamOutlined },
  { value: "none", label: "暂不通知", icon: BellOutlined },
];

export default function RecipientSelector({ value, onChange, refreshKey = 0 }: Props) {
  const [members, setMembers] = useState<WeComMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<WeComGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const membersLoadedRef = useRef(false);
  const groupsLoadedRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;

  const loadMembers = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && membersLoadedRef.current) return;
    setLoading(true);
    setError("");
    try {
      const results = await getWeComUsers(forceRefresh);
      setMembers(results);
      membersLoadedRef.current = true;
      const current = valueRef.current;
      const validKeys = new Set(results.map((member) => member.key));
      const validAssignees = current.assigneeIds.filter((key) => validKeys.has(key));
      if (validAssignees.length !== current.assigneeIds.length) {
        onChange({ ...current, assigneeIds: validAssignees });
      }
    } catch (loadError) {
      setMembers([]);
      membersLoadedRef.current = false;
      setError(getWeComApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  const loadGroups = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && groupsLoadedRef.current) return;
    setGroupsLoading(true);
    try {
      const results = await getWeComGroups();
      setGroups(results);
      groupsLoadedRef.current = true;
      const current = valueRef.current;
      if (current.groupId && !results.some((item) => item.key === current.groupId)) {
        onChange({ ...current, groupId: "" });
      }
    } catch {
      setGroups([]);
      groupsLoadedRef.current = false;
    } finally {
      setGroupsLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    membersLoadedRef.current = false;
    groupsLoadedRef.current = false;
    void loadMembers(true);
    void loadGroups(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (value.notificationMode === "person" || value.notificationMode === "none") void loadMembers();
    if (value.notificationMode === "group") void loadGroups();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.notificationMode]);

  const handleModeChange = (mode: NotificationMode) => {
    onChange({ ...value, notificationMode: mode });
  };

  const showAssigneePicker = value.notificationMode === "person" || value.notificationMode === "none";
  const assigneeRequired = value.notificationMode === "person";

  return (
    <div className="task-recipient-selector">
      <div className="task-field-label">通知方式</div>
      <div className="task-notify-switch" role="tablist" aria-label="通知方式">
        {NOTIFY_MODES.map((mode) => {
          const Icon = mode.icon;
          const active = value.notificationMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              role="tab"
              aria-selected={active}
              className={`task-notify-switch-item${active ? " is-active" : ""}`}
              onClick={() => handleModeChange(mode.value)}
            >
              <Icon />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>

      {value.notificationMode === "none" ? (
        <Alert
          type="info"
          showIcon
          message="不会发送企业微信通知，任务仍会正常创建与执行。"
          className="task-notify-none-alert"
        />
      ) : null}

      {showAssigneePicker ? (
        <div className="task-wecom-contact-picker">
          <div className="task-field-label">
            {assigneeRequired ? "任务负责人" : "任务负责人（可选）"}
          </div>
          {assigneeRequired && error && (
            <Alert type="warning" showIcon message={error || ADMIN_HINT} />
          )}
          {!assigneeRequired && error && members.length === 0 && (
            <Alert type="info" showIcon message="通讯录暂不可用，可不指定负责人直接创建任务。" />
          )}
          <Select
            mode="multiple"
            allowClear
            loading={loading && members.length === 0}
            disabled={assigneeRequired ? Boolean(error) : members.length === 0 && Boolean(error)}
            value={value.assigneeIds}
            placeholder={
              loading && members.length === 0
                ? "正在加载通讯录…"
                : assigneeRequired
                  ? "选择任务负责人（可多选）"
                  : "选择任务负责人（可选，用于任务跟踪）"
            }
            notFoundContent={loading ? "正在加载…" : "暂无可选成员"}
            maxTagCount="responsive"
            onChange={(ids) => onChange({ ...value, assigneeIds: ids })}
            optionLabelProp="label"
            options={members.map((member) => ({
              value: member.key,
              label: member.name,
              disabled: assigneeRequired ? !member.available : false,
              searchText: `${member.name} ${member.department} ${member.position}`,
              option: member,
            }))}
            optionFilterProp="searchText"
            optionRender={({ data }) => {
              const member = data.option as WeComMember;
              const bound = Boolean(member.weComUserId && member.available);
              return (
                <div className="task-recipient-option">
                  <Avatar size={34} src={member.avatar || undefined} icon={<UserOutlined />} />
                  <div className="task-recipient-option-main">
                    <Space size={6} wrap>
                      <Typography.Text strong>{member.name}</Typography.Text>
                      {assigneeRequired && (
                        <Tag color={bound ? "success" : "default"}>
                          {bound ? "已绑定企微" : "未绑定企微"}
                        </Tag>
                      )}
                    </Space>
                    <Typography.Text type="secondary">
                      {[member.department, member.position].filter(Boolean).join(" · ") || "未设置部门"}
                    </Typography.Text>
                  </div>
                </div>
              );
            }}
          />
          {!error && members.length > 0 && (
            <span className="task-wecom-sync-note">
              已加载 {members.length} 位可见成员
              <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => {
                membersLoadedRef.current = false;
                void loadMembers(true);
              }}>刷新通讯录</Button>
            </span>
          )}
        </div>
      ) : null}

      {value.notificationMode === "group" ? (
        <div className="task-wecom-contact-picker">
          {groups.length === 0 && !groupsLoading && (
            <Alert type="info" showIcon message={ADMIN_HINT} />
          )}
          <Select
            value={value.groupId || undefined}
            loading={groupsLoading && groups.length === 0}
            disabled={groups.length === 0}
            placeholder="选择需要接收通知的群聊"
            onChange={(groupId) => onChange({ ...value, groupId })}
            optionLabelProp="label"
            options={groups.map((group) => ({
              value: group.key,
              label: group.name,
              option: group,
            }))}
            optionRender={({ data }) => {
              const group = data.option as WeComGroup;
              return (
                <div className="task-recipient-option group">
                  <Avatar size={34} icon={<TeamOutlined />} />
                  <div className="task-recipient-option-main">
                    <Space size={6} wrap>
                      <Typography.Text strong>{group.name}</Typography.Text>
                      <Tag color={group.available ? "success" : "default"}>{group.available ? "可用" : "不可用"}</Tag>
                    </Space>
                    <span>企业微信群聊通知 · {group.available ? "通知渠道正常" : "通知渠道已停用"}</span>
                  </div>
                </div>
              );
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
