import { Button, Form, Input, Modal, Tag, message } from "antd";
import {
  CheckCircleFilled,
  CodeOutlined,
  DownOutlined,
  KeyOutlined,
  LockOutlined,
  MinusCircleOutlined,
  MobileOutlined,
  SafetyCertificateOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import {
  changePassword,
  getAuthToken,
  getMe,
  getUserSettings,
  listOrganizations,
  setAuthToken,
  switchCurrentOrganization,
  updateUserSettings,
  uploadUserAvatar,
  type AuthUser,
  type OrganizationSummary,
  type UserProfileSettings,
  type UserWeComBindingSummary,
} from "../api/client";
import { CurrentEnterpriseCard, UserProfileHeader } from "./user-settings/ProfileIdentity";

const BINDING_STATUS_COLOR: Record<string, string> = {
  matched: "success",
  pending: "default",
  not_found: "warning",
  invalid_phone: "error",
  duplicate_phone: "error",
  conflict: "error",
  permission_denied: "error",
  retry_waiting: "processing",
  disabled: "default",
};

type SectionKey = "profile" | "password" | "llm";

const NAV_ITEMS: { key: SectionKey; label: string; icon: JSX.Element; subtitle: string }[] = [
  { key: "profile", label: "个人信息", icon: <UserOutlined />, subtitle: "维护昵称、头像与联系方式" },
  { key: "password", label: "登录密码", icon: <LockOutlined />, subtitle: "保障你的账号安全" },
  { key: "llm", label: "模型密钥", icon: <CodeOutlined />, subtitle: "配置个人 LLM 供应商" },
];

const COMMON_PWD = new Set([
  "12345678", "123456789", "password", "11111111", "88888888", "qwertyui", "abcd1234", "aa123456",
]);

function passwordStrength(pwd: string) {
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (/\d/.test(pwd) || /[^A-Za-z0-9]/.test(pwd)) score += 1;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 1;
  return score;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: (user: AuthUser) => void;
};

export default function UserSettingsModal({ open, onClose, onSaved }: Props) {
  const [form] = Form.useForm();
  const [llmForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [active, setActive] = useState<SectionKey>("profile");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [phoneMasked, setPhoneMasked] = useState("");
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [currentOrganization, setCurrentOrganization] = useState<OrganizationSummary | null>(null);
  const [enterpriseSwitcherOpen, setEnterpriseSwitcherOpen] = useState(false);
  const [wecomBinding, setWecomBinding] = useState<UserWeComBindingSummary | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);

  const newPwd = (Form.useWatch("new_password", pwdForm) as string) || "";
  const pwdScore = passwordStrength(newPwd);
  const pwdChecks = useMemo(() => ([
    { ok: newPwd.length >= 8, text: "长度至少 8 位" },
    { ok: /\d/.test(newPwd) || /[^A-Za-z0-9]/.test(newPwd), text: "包含数字或符号" },
    { ok: /[a-z]/.test(newPwd) && /[A-Z]/.test(newPwd), text: "包含大小写字母" },
    { ok: newPwd.length > 0 && !COMMON_PWD.has(newPwd.toLowerCase()), text: "避免使用常见密码" },
  ]), [newPwd]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setActive("profile");
    setAdvancedOpen(false);
    pwdForm.resetFields();
    setPhoneTouched(false);
    Promise.all([getUserSettings(), getMe(), listOrganizations().catch(() => ({ ok: false, count: 0, results: [] as OrganizationSummary[] }))])
      .then(([data, me, organizationData]) => {
        const profile = data as UserProfileSettings;
        form.setFieldsValue({
          display_name: profile.display_name || "",
          bio: profile.bio || "",
          methodology: profile.methodology || "",
          phone: "",
        });
        setPhoneMasked(profile.phone_masked || "");
        setWecomBinding(profile.wecom_binding || null);
        llmForm.setFieldsValue({
          llm_api_key: profile.llm_api_key === "***" ? "" : profile.llm_api_key,
          llm_base_url: profile.llm_base_url,
          llm_model: profile.llm_model,
        });
        if (profile.llm_base_url || profile.llm_model) setAdvancedOpen(true);
        setAvatarUrl(profile.avatar_url || "");
        setDisplayName(profile.display_name || "");
        setUsername(me.user.username || "");
        setEmail(me.user.email || "");
        setAuthUser(me.user);
        const membershipOrganizations = organizationData.results || [];
        const activeOrganization = membershipOrganizations.find((item) => item.isCurrent)
          || membershipOrganizations.find((item) => item.id === me.user.organization?.id)
          || (me.user.organization ? {
            id: me.user.organization.id,
            code: "",
            name: me.user.organization.name,
            isActive: true,
            memberCount: 0,
            role: me.user.organization.role,
            canManage: me.user.organization.canManage,
            isCurrent: true,
            canSwitch: true,
            createdAt: null,
          } : null);
        setOrganizations(activeOrganization && !membershipOrganizations.some((item) => item.id === activeOrganization.id)
          ? [activeOrganization, ...membershipOrganizations]
          : membershipOrganizations);
        setCurrentOrganization(activeOrganization);
      })
      .catch(() => message.error("加载个人信息失败"))
      .finally(() => setLoading(false));
  }, [open, form, llmForm, pwdForm]);

  const avatarSrc = () => {
    if (!avatarUrl) return undefined;
    const token = getAuthToken();
    if (!token) return avatarUrl;
    const joiner = avatarUrl.includes("?") ? "&" : "?";
    return `${avatarUrl}${joiner}token=${encodeURIComponent(token)}`;
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadUserAvatar(file);
      setAvatarUrl(res.avatar_url || "");
      if (res.user) onSaved?.(res.user);
      message.success("头像已更新");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "头像上传失败");
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handleOk = async () => {
    const profile = await form.validateFields();
    const llm = await llmForm.validateFields().catch(() => ({}));
    const pwd = pwdForm.getFieldsValue();
    const wantsPwd = !!(pwd.old_password || pwd.new_password || pwd.new_password2);

    if (wantsPwd) {
      await pwdForm.validateFields();
      if (!pwd.old_password || !pwd.new_password) {
        message.error("改密请填写原密码和新密码");
        setActive("password");
        return;
      }
      if (pwd.new_password !== pwd.new_password2) {
        message.error("两次新密码不一致");
        setActive("password");
        return;
      }
    }

    setSaving(true);
    try {
      const body: Record<string, string> = {
        display_name: profile.display_name || "",
        bio: profile.bio || "",
        methodology: profile.methodology || "",
        llm_base_url: (llm as any).llm_base_url || "",
        llm_model: (llm as any).llm_model || "",
      };
      if ((llm as any).llm_api_key) {
        body.llm_api_key = (llm as any).llm_api_key;
      }
      if (phoneTouched) {
        body.phone = profile.phone ?? "";
      }
      const res = await updateUserSettings(body);
      setDisplayName(profile.display_name || "");
      if (res.phone_masked !== undefined) setPhoneMasked(res.phone_masked);
      if (res.wecom_binding) setWecomBinding(res.wecom_binding);
      if (res.user) onSaved?.(res.user);

      const syncHint = res.wecom_sync_triggered ? "，企业微信账号绑定同步已触发" : "";
      if (wantsPwd) {
        const pwdRes = await changePassword({
          old_password: pwd.old_password,
          new_password: pwd.new_password,
        });
        if (pwdRes.token) setAuthToken(pwdRes.token);
        if (pwdRes.user) onSaved?.(pwdRes.user);
        message.success(`个人信息与密码已保存${syncHint}`);
      } else {
        message.success(`个人信息已保存${syncHint}`);
      }
      onClose();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleEnterpriseSwitch = async (organization: OrganizationSummary) => {
    if (organization.id === currentOrganization?.id) {
      setEnterpriseSwitcherOpen(false);
      return;
    }
    try {
      const result = await switchCurrentOrganization(organization.id);
      const selected = { ...organization, ...result.organization, isCurrent: true };
      setOrganizations((items) => items.map((item) => ({ ...item, isCurrent: item.id === selected.id })));
      setCurrentOrganization(selected);
      setEnterpriseSwitcherOpen(false);
      const nextUser = result.user || (authUser ? { ...authUser, organization: {
        id: selected.id,
        name: selected.name,
        role: selected.role || "member",
        roleLabel: selected.role === "owner" ? "企业所有者" : selected.role === "admin" ? "企业管理员" : "企业成员",
        canManage: selected.canManage,
      } } : null);
      if (nextUser) {
        setAuthUser(nextUser);
        onSaved?.(nextUser);
      }
      message.success(`已切换至${selected.name}`);
      // 企业微信、连接器和任务均依赖当前企业，刷新以清理旧企业的页面缓存。
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error: any) {
      message.error(error?.response?.data?.error || "切换企业失败");
    }
  };

  const activeItem = NAV_ITEMS.find((item) => item.key === active) || NAV_ITEMS[0];

  return (
    <Modal
      className="ups-modal"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1040}
      destroyOnHidden
      title={(
        <div className="ups-title">
          <span className="ups-title-icon">{activeItem.icon}</span>
          <div>
            <strong>{activeItem.label}</strong>
            <small>{activeItem.subtitle}</small>
          </div>
        </div>
      )}
    >
      <div className="ups-body">
        <nav className="ups-nav" role="tablist">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active === item.key}
              className={active === item.key ? "is-on" : ""}
              onClick={() => setActive(item.key)}
            >
              <span className="ups-nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="ups-panel">
          {/* 个人信息 */}
          <div className="ups-section" hidden={active !== "profile"}>
            <UserProfileHeader
              displayName={displayName}
              username={username}
              email={email}
              phone={phoneMasked}
              avatarSrc={avatarSrc()}
              isSuperuser={Boolean(authUser?.is_superuser)}
              loading={loading}
              uploading={uploading}
              onUpload={(file) => void handleUpload(file)}
              onSecurity={() => setActive("password")}
            />

            <CurrentEnterpriseCard
              organization={currentOrganization}
              organizations={organizations}
              switcherOpen={enterpriseSwitcherOpen}
              loading={loading}
              onOpenChange={setEnterpriseSwitcherOpen}
              onSwitch={(organization) => void handleEnterpriseSwitch(organization)}
              onCreateOrJoin={() => message.info("请前往“管理－账号与企业成员”创建企业，或联系企业管理员邀请加入")}
            />

            <Form id="ups-profile-form" form={form} layout="vertical" disabled={loading} requiredMark={false}>
              <Form.Item label="显示名称" name="display_name" extra="该名称将在聊天中优先展示">
                <Input placeholder="例如：阿东" maxLength={64} showCount />
              </Form.Item>
              <Form.Item
                label="手机号"
                name="phone"
                extra={<>{phoneMasked ? <>当前：{phoneMasked} · </> : null}用于自动匹配企业微信成员；保存后将触发一次账号绑定同步</>}
              >
                <Input
                  prefix={<MobileOutlined />}
                  placeholder={phoneMasked ? "输入新手机号以更新，留空可清除" : "13800000000 或 +8613800000000"}
                  maxLength={32}
                  onChange={() => setPhoneTouched(true)}
                  allowClear
                />
              </Form.Item>
              {wecomBinding && (
                <div className="ups-binding">
                  <span className="ups-binding-label">企业微信绑定</span>
                  <Tag color={BINDING_STATUS_COLOR[wecomBinding.status] || "default"}>{wecomBinding.statusLabel}</Tag>
                  {wecomBinding.weComMember ? <span className="ups-binding-member">企微成员：{wecomBinding.weComMember}</span> : null}
                  {wecomBinding.statusHint ? <small className="ups-binding-hint">{wecomBinding.statusHint}</small> : null}
                  {wecomBinding.failureReason ? <small className="ups-binding-error">{wecomBinding.failureReason}</small> : null}
                </div>
              )}
              <Form.Item label="个性签名" name="bio">
                <Input.TextArea
                  placeholder="一句话介绍自己，例如：对口径负责，对结果较真"
                  autoSize={{ minRows: 2, maxRows: 3 }}
                  maxLength={200}
                  showCount
                />
              </Form.Item>
              <Form.Item label="方法论" name="methodology" extra="你习惯怎么做判断、决策、协作；@AI 时可酌情参考">
                <Input.TextArea
                  placeholder={"例如：\n1. 先澄清目标与约束\n2. 用数据验证，不拍脑袋\n3. 风险先暴露，再给方案"}
                  autoSize={{ minRows: 4, maxRows: 8 }}
                  maxLength={4000}
                  showCount
                />
              </Form.Item>
            </Form>
          </div>

          {/* 登录密码 */}
          <div className="ups-section" hidden={active !== "password"}>
            <div className="ups-hero-note">
              <span className="ups-hero-note-icon is-shield"><SafetyCertificateOutlined /></span>
              <div>
                <strong>保障你的账号安全</strong>
                <small>建议定期更换密码，避免与其他平台使用同一密码。</small>
              </div>
            </div>
            <Form form={pwdForm} layout="vertical" disabled={loading} requiredMark={false}>
              <Form.Item label="当前账号">
                <Input value={username || "—"} disabled />
              </Form.Item>
              <Form.Item label="当前密码" name="old_password">
                <Input.Password placeholder="请输入当前密码" autoComplete="current-password" />
              </Form.Item>
              <Form.Item label="新密码" name="new_password" rules={[{ min: 8, message: "至少 8 位" }]}>
                <Input.Password placeholder="至少 8 位，建议包含字母、数字和符号" autoComplete="new-password" />
              </Form.Item>
              {newPwd.length > 0 && (
                <div className="ups-pwd-strength">
                  <div className="ups-pwd-bars" data-score={pwdScore}>
                    <span /><span /><span />
                  </div>
                  <em>{pwdScore <= 1 ? "弱" : pwdScore === 2 ? "中" : "强"}</em>
                </div>
              )}
              <Form.Item label="确认新密码" name="new_password2" dependencies={["new_password"]}>
                <Input.Password placeholder="请再次输入新密码" autoComplete="new-password" />
              </Form.Item>
            </Form>
            <div className="ups-pwd-tips">
              <div className="ups-pwd-tips-title">密码安全建议</div>
              <div className="ups-pwd-tips-grid">
                {pwdChecks.map((tip) => (
                  <span key={tip.text} className={tip.ok ? "is-ok" : ""}>
                    {tip.ok ? <CheckCircleFilled /> : <MinusCircleOutlined />} {tip.text}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 模型密钥 */}
          <div className="ups-section" hidden={active !== "llm"}>
            <div className="ups-hero-note">
              <span className="ups-hero-note-icon is-key"><KeyOutlined /></span>
              <div>
                <strong>配置个人 LLM 供应商</strong>
                <small>可选：配置个人 LLM。看图请用视觉模型；未配置时走平台默认。</small>
              </div>
            </div>
            <Form form={llmForm} layout="vertical" disabled={loading} requiredMark={false}>
              <Form.Item label="LLM API Key" name="llm_api_key" extra="你的密钥将被加密保存，仅用于调用模型服务">
                <Input.Password placeholder="sk-xxx（已保存时留空表示不修改）" autoComplete="off" />
              </Form.Item>

              <button
                type="button"
                className={`ups-advanced-toggle ${advancedOpen ? "is-open" : ""}`}
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                高级选项（可选）<DownOutlined />
              </button>
              <div className="ups-advanced" style={{ display: advancedOpen ? "block" : "none" }}>
                <Form.Item label="LLM Base URL" name="llm_base_url" extra="模型服务的基础请求地址">
                  <Input placeholder="https://api.example.com/v1" />
                </Form.Item>
                <Form.Item label="LLM Model" name="llm_model" extra="选择你要使用的模型名称">
                  <Input placeholder="例如：gpt-4o、claude-3.5-sonnet 等" />
                </Form.Item>
              </div>
            </Form>
          </div>

          <div className="ups-footer">
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" className="ups-primary" loading={saving} onClick={handleOk}>保存</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
