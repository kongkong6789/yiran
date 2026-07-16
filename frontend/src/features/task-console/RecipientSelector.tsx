import { useCallback, useEffect, useState } from "react";
import { Alert, Avatar, Button, Radio, Select, Space, Tag, Typography } from "antd";
import { ReloadOutlined, SettingOutlined, TeamOutlined, UserOutlined, WechatOutlined } from "@ant-design/icons";
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
  onConfigureWeCom: () => void;
  refreshKey?: number;
}

export default function RecipientSelector({ value, onChange, onConfigureWeCom, refreshKey = 0 }: Props) {
  const [members, setMembers] = useState<WeComMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<WeComGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  const loadMembers = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError("");
    try {
      const results = await getWeComUsers(forceRefresh);
      setMembers(results);
      const validKeys = new Set(results.map((member) => member.key));
      const validAssignees = value.assigneeIds.filter((key) => validKeys.has(key));
      if (validAssignees.length !== value.assigneeIds.length) {
        onChange({ ...value, assigneeIds: validAssignees });
      }
    } catch (loadError) {
      setMembers([]);
      setError(getWeComApiError(loadError));
    } finally {
      setLoading(false);
    }
  }, [onChange, value]);

  useEffect(() => {
    if (value.notificationMode === "person") void loadMembers();
  // 只在切换到个人通知或配置保存后重新同步，避免选择成员时重复请求。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.notificationMode, refreshKey]);

  useEffect(() => {
    if (value.notificationMode !== "group") return;
    setGroupsLoading(true);
    getWeComGroups().then((results) => {
      setGroups(results);
      if (value.groupId && !results.some((item) => item.key === value.groupId)) onChange({ ...value, groupId: "" });
    }).catch(() => setGroups([])).finally(() => setGroupsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.notificationMode, refreshKey]);

  return (
    <div className="task-recipient-selector">
      <Radio.Group
        className="task-notify-toggle"
        optionType="button"
        buttonStyle="solid"
        value={value.notificationMode}
        onChange={(event) => onChange({ ...value, notificationMode: event.target.value as NotificationMode })}
        options={[
          { label: <><UserOutlined /> 通知个人</>, value: "person" },
          { label: <><TeamOutlined /> 通知群聊</>, value: "group" },
        ]}
      />

      {value.notificationMode === "person" ? (
        <div className="task-wecom-contact-picker">
          {error && (
            <Alert
              type="warning"
              showIcon
              message={error}
              action={(
                <Space size={4}>
                  <Button size="small" icon={<SettingOutlined />} onClick={onConfigureWeCom}>配置 API</Button>
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => void loadMembers(true)}>重新同步</Button>
                </Space>
              )}
            />
          )}
          <Select
            mode="multiple"
            allowClear
            loading={loading}
            disabled={Boolean(error)}
            value={value.assigneeIds}
            placeholder={loading ? "正在同步企业微信通讯录…" : "从企业微信通讯录选择负责人"}
            notFoundContent={loading ? "正在同步…" : "应用可见范围内暂无成员"}
            maxTagCount="responsive"
            onChange={(ids) => onChange({ ...value, assigneeIds: ids })}
            optionLabelProp="label"
            options={members.map((member) => ({
              value: member.key,
              label: member.name,
              disabled: !member.available,
              searchText: `${member.name} ${member.department} ${member.position}`,
              option: member,
            }))}
            optionFilterProp="searchText"
            optionRender={({ data }) => {
              const member = data.option;
              return (
                <div className="task-recipient-option">
                  <Avatar size={34} src={member.avatar || undefined} icon={<UserOutlined />} />
                  <div className="task-recipient-option-main">
                    <Space size={6} wrap>
                      <Typography.Text strong>{member.name}</Typography.Text>
                      <Tag color={member.available ? "success" : "default"}>
                        {member.available ? "企微可用" : "成员已停用"}
                      </Tag>
                    </Space>
                    <Typography.Text type="secondary">
                      {[member.department, member.position].filter(Boolean).join(" · ") || "未设置部门"}
                    </Typography.Text>
                  </div>
                </div>
              );
            }}
          />
          {!error && !loading && <span className="task-wecom-sync-note">已从本地通讯录加载 {members.length} 位可见成员 <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => void loadMembers(true)}>同步企业微信</Button></span>}
        </div>
      ) : (
        <div className="task-wecom-contact-picker">
        {groups.length === 0 && !groupsLoading && <Alert type="info" showIcon message="尚未配置可用的群聊通知渠道" action={<Button size="small" icon={<SettingOutlined />} onClick={onConfigureWeCom}>配置群聊通知</Button>} />}
        <Select
          value={value.groupId || undefined}
          loading={groupsLoading}
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
            const group = data.option;
            return (
              <div className="task-recipient-option group">
                <Avatar size={34} icon={<WechatOutlined />} />
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
      )}
    </div>
  );
}
