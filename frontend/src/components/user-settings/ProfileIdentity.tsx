import {
  BankOutlined,
  CameraOutlined,
  LockOutlined,
  MailOutlined,
  RightOutlined,
  SearchOutlined,
  SwapOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Empty, Input, Popover, Tag, Upload } from "antd";
import { useMemo, useState, type ReactNode } from "react";
import type { OrganizationSummary } from "../../api/client";

const ROLE_LABELS: Record<string, string> = {
  owner: "企业所有者",
  admin: "企业管理员",
  member: "企业成员",
};

export function ContactInfo({ email, phone }: { email: string; phone: string }) {
  return (
    <div className="ups-contact-info" aria-label="联系方式">
      <div className="ups-contact-item">
        <span><MailOutlined /> 邮箱</span>
        <strong title={email || "未填写"}>{email || "未填写"}</strong>
      </div>
      <div className="ups-contact-item">
        <span>手机号</span>
        <strong>{phone || "未填写"}</strong>
      </div>
    </div>
  );
}

type UserProfileHeaderProps = {
  displayName: string;
  username: string;
  email: string;
  phone: string;
  avatarSrc?: string;
  isSuperuser: boolean;
  loading: boolean;
  uploading: boolean;
  onUpload: (file: File) => void;
  onSecurity: () => void;
};

export function UserProfileHeader({
  displayName,
  username,
  email,
  phone,
  avatarSrc,
  isSuperuser,
  loading,
  uploading,
  onUpload,
  onSecurity,
}: UserProfileHeaderProps) {
  return (
    <section className="ups-profile-header" aria-label="个人主信息">
      <div className="ups-profile-person">
        <Upload
          accept="image/png,image/jpeg,image/gif,image/webp"
          showUploadList={false}
          beforeUpload={(file) => {
            onUpload(file);
            return false;
          }}
          disabled={uploading || loading}
        >
          <button type="button" className="ups-avatar-wrap" aria-label="更换头像" disabled={uploading || loading}>
            <Avatar size={64} src={avatarSrc} icon={<UserOutlined />} />
            <span className="ups-avatar-cam"><CameraOutlined /></span>
          </button>
        </Upload>
        <div className="ups-profile-person-copy">
          <strong title={displayName || username}>{displayName || username || "未设置昵称"}</strong>
          <div className="ups-profile-account">
            <span title={username ? `@${username}` : "未设置账号"}>{username ? `@${username}` : "未设置账号"}</span>
            {isSuperuser ? <Tag className="ups-platform-role">超级管理员</Tag> : null}
          </div>
        </div>
      </div>

      <ContactInfo email={email} phone={phone} />

      <div className="ups-profile-actions">
        <Button icon={<LockOutlined />} onClick={onSecurity}><span className="ups-action-label">修改密码</span></Button>
      </div>
    </section>
  );
}

type EnterpriseSwitcherProps = {
  organizations: OrganizationSummary[];
  currentOrganization: OrganizationSummary | null;
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitch: (organization: OrganizationSummary) => void;
  onCreateOrJoin: () => void;
  children: ReactNode;
};

export function EnterpriseSwitcher({
  organizations,
  currentOrganization,
  open,
  disabled,
  onOpenChange,
  onSwitch,
  onCreateOrJoin,
  children,
}: EnterpriseSwitcherProps) {
  const [keyword, setKeyword] = useState("");
  const availableOrganizations = useMemo(
    () => organizations.filter((item) => item.canSwitch || item.id === currentOrganization?.id),
    [currentOrganization?.id, organizations],
  );
  const filtered = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase();
    return query
      ? availableOrganizations.filter((item) => item.name.toLocaleLowerCase().includes(query))
      : availableOrganizations;
  }, [availableOrganizations, keyword]);

  const content = (
    <div className="ups-enterprise-popover">
      <div className="ups-enterprise-popover-title">切换企业</div>
      {availableOrganizations.length > 5 ? (
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索企业名称"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      ) : null}
      <div className="ups-enterprise-list" role="listbox" aria-label="所属企业">
        {filtered.length ? filtered.map((organization) => {
          const isCurrent = organization.id === currentOrganization?.id;
          return (
            <button
              key={organization.id}
              type="button"
              className={isCurrent ? "is-current" : ""}
              onClick={() => onSwitch(organization)}
              aria-selected={isCurrent}
            >
              <span className="ups-enterprise-list-icon"><BankOutlined /></span>
              <span className="ups-enterprise-list-copy">
                <strong title={organization.name}>{organization.name}</strong>
                <small>{ROLE_LABELS[organization.role] || "企业成员"} · {organization.memberCount} 位成员</small>
              </span>
              {isCurrent ? <Tag className="ups-current-enterprise-tag">当前企业</Tag> : <RightOutlined />}
            </button>
          );
        }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的企业" />}
      </div>
      <button type="button" className="ups-enterprise-create" onClick={onCreateOrJoin}>
        <span>＋</span> 创建或加入企业
      </button>
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={(nextOpen) => {
        if (!disabled) onOpenChange(nextOpen);
        if (!nextOpen) setKeyword("");
      }}
      content={content}
      overlayClassName="ups-enterprise-popover-overlay"
    >
      {children}
    </Popover>
  );
}

type CurrentEnterpriseCardProps = {
  organization: OrganizationSummary | null;
  organizations: OrganizationSummary[];
  switcherOpen: boolean;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitch: (organization: OrganizationSummary) => void;
  onCreateOrJoin: () => void;
};

export function CurrentEnterpriseCard({
  organization,
  organizations,
  switcherOpen,
  loading,
  onOpenChange,
  onSwitch,
  onCreateOrJoin,
}: CurrentEnterpriseCardProps) {
  return (
    <section className="ups-current-enterprise-section" aria-labelledby="ups-current-enterprise-title">
      <h3 id="ups-current-enterprise-title">当前企业</h3>
      <div className="ups-current-enterprise-card">
        <span className="ups-current-enterprise-icon"><BankOutlined /></span>
        <div className="ups-current-enterprise-copy">
          <strong title={organization?.name || "尚未加入企业"}>{organization?.name || "尚未加入企业"}</strong>
          <small>
            {organization
              ? `${ROLE_LABELS[organization.role] || "企业成员"} · ${organization.memberCount} 位成员`
              : "创建或加入企业后可使用企业协作能力"}
          </small>
        </div>
        {organization ? <Tag className="ups-current-enterprise-tag">当前企业</Tag> : null}
        <EnterpriseSwitcher
          organizations={organizations}
          currentOrganization={organization}
          open={switcherOpen}
          disabled={loading}
          onOpenChange={onOpenChange}
          onSwitch={onSwitch}
          onCreateOrJoin={onCreateOrJoin}
        >
          <Button
            className="ups-switch-enterprise"
            icon={<SwapOutlined />}
            disabled={loading}
            onClick={() => onOpenChange(!switcherOpen)}
          >
            切换企业
          </Button>
        </EnterpriseSwitcher>
      </div>
    </section>
  );
}
