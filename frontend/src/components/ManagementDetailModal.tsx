import type { KeyboardEvent, ReactNode } from "react";
import { Avatar, Button, Modal, Tag } from "antd";

const HEADER_TITLES: Record<string, string> = {
  "ACCOUNT DETAIL": "账号详情",
  "MEMBER DETAIL": "成员详情",
  "TEAM DETAIL": "团队详情",
  "WECOM BINDING": "企微绑定详情",
  "NOTIFICATION DETAIL": "通知详情",
  DETAIL: "详情",
};

export interface ManagementDetailField {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

export interface ManagementDetailSection {
  title: string;
  fields: ManagementDetailField[];
}

export interface ManagementDetailBadge {
  label: ReactNode;
  color?: string;
}

export function isInteractiveTableTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest([
    "button",
    "a",
    "input",
    "textarea",
    "select",
    "[role='button']",
    "[role='combobox']",
    ".ant-select",
    ".ant-table-row-expand-icon",
  ].join(",")));
}

export function handleDetailRowKey(
  event: KeyboardEvent<HTMLElement>,
  open: () => void,
) {
  if (isInteractiveTableTarget(event.target)) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  open();
}

export default function ManagementDetailModal({
  open,
  onClose,
  eyebrow = "DETAIL",
  headerTitle,
  title,
  subtitle,
  avatarSrc,
  avatarText,
  icon,
  badges = [],
  sections,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  headerTitle?: string;
  title: string;
  subtitle?: string;
  avatarSrc?: string;
  avatarText?: string;
  icon?: ReactNode;
  badges?: ManagementDetailBadge[];
  sections: ManagementDetailSection[];
}) {
  const modalTitle = headerTitle ?? HEADER_TITLES[eyebrow] ?? eyebrow;

  return (
    <Modal
      className="management-detail-modal"
      open={open}
      onCancel={onClose}
      title={modalTitle}
      width={680}
      centered
      destroyOnHidden
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      <div className="management-detail-hero">
        {avatarSrc || avatarText ? (
          <Avatar size={58} src={avatarSrc} className="management-detail-avatar">
            {(avatarText || title).slice(0, 1).toUpperCase()}
          </Avatar>
        ) : (
          <span className="management-detail-icon">{icon}</span>
        )}
        <div className="management-detail-hero-main">
          <div className="management-detail-heading">
            <strong>{title}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </div>
          {badges.length ? (
            <div className="management-detail-badges">
              {badges.map((badge, index) => (
                <Tag key={index} color={badge.color}>{badge.label}</Tag>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="management-detail-sections">
        {sections.map((section) => (
          <section key={section.title} className="management-detail-section">
            <h4>{section.title}</h4>
            <dl className="management-detail-grid">
              {section.fields.map((field) => (
                <div key={field.label} className={field.wide ? "is-wide" : undefined}>
                  <dt>{field.label}</dt>
                  <dd>{field.value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
