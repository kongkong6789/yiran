import { Avatar, Form, Input, Modal, Tabs, Tag, Upload, message } from "antd";
import { CameraOutlined, MobileOutlined, UserOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import {
  changePassword,
  getAuthToken,
  getMe,
  getUserSettings,
  setAuthToken,
  updateUserSettings,
  uploadUserAvatar,
  type AuthUser,
  type UserProfileSettings,
  type UserWeComBindingSummary,
} from "../api/client";

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

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved?: (user: AuthUser) => void;
};

export default function UserSettingsModal({ open, onClose, onSaved }: Props) {
  const [form] = Form.useForm();
  const [llmForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [phoneMasked, setPhoneMasked] = useState("");
  const [wecomBinding, setWecomBinding] = useState<UserWeComBindingSummary | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    pwdForm.resetFields();
    setPhoneTouched(false);
    Promise.all([getUserSettings(), getMe()])
      .then(([data, me]) => {
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
        setAvatarUrl(profile.avatar_url || "");
        setDisplayName(profile.display_name || "");
        setUsername(me.user.username || "");
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
        return;
      }
      if (pwd.new_password !== pwd.new_password2) {
        message.error("两次新密码不一致");
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

  return (
    <Modal
      title="个人信息"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={saving}
      okText="保存"
      width={560}
      destroyOnHidden
      className="user-profile-modal"
    >
      <div className="user-profile-hero">
        <Upload
          accept="image/png,image/jpeg,image/gif,image/webp"
          showUploadList={false}
          beforeUpload={(file) => {
            void handleUpload(file);
            return false;
          }}
          disabled={uploading || loading}
        >
          <div className="user-profile-avatar-wrap" title="点击更换头像">
            <Avatar size={72} src={avatarSrc()} icon={<UserOutlined />} />
            <span className="user-profile-avatar-mask">
              <CameraOutlined />
            </span>
          </div>
        </Upload>
        <div>
          <div className="user-profile-name">{displayName || "未设置昵称"}</div>
          <div className="user-profile-tip">
            {username ? <>登录账号：{username} · </> : null}
            点击头像可上传；头像用于协作与顶栏展示
          </div>
        </div>
      </div>

      <Tabs
        defaultActiveKey="profile"
        items={[
          {
            key: "profile",
            label: "资料",
            children: (
              <Form form={form} layout="vertical" disabled={loading}>
                <Form.Item
                  label="显示名称"
                  name="display_name"
                  extra="协作聊天里优先展示此名称"
                >
                  <Input placeholder="例如：阿东" maxLength={64} showCount />
                </Form.Item>
                <Form.Item
                  label="手机号"
                  name="phone"
                  extra={
                    <>
                      {phoneMasked ? <>当前：{phoneMasked} · </> : null}
                      用于自动匹配企业微信成员；保存后将触发一次账号绑定同步
                    </>
                  }
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
                  <div className="user-profile-wecom-binding">
                    <span>企业微信绑定</span>
                    <Tag color={BINDING_STATUS_COLOR[wecomBinding.status] || "default"}>
                      {wecomBinding.statusLabel}
                    </Tag>
                    {wecomBinding.weComUserId ? (
                      <small>UserID：{wecomBinding.weComUserId}</small>
                    ) : null}
                    {wecomBinding.failureReason ? (
                      <small className="user-profile-wecom-binding-error">{wecomBinding.failureReason}</small>
                    ) : null}
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
                <Form.Item
                  label="方法论"
                  name="methodology"
                  extra="你习惯怎么做判断、决策、协作；@AI 时可酌情参考"
                >
                  <Input.TextArea
                    placeholder={"例如：\n1. 先澄清目标与约束\n2. 用数据验证，不拍脑袋\n3. 风险先暴露，再给方案"}
                    autoSize={{ minRows: 4, maxRows: 8 }}
                    maxLength={4000}
                    showCount
                  />
                </Form.Item>
              </Form>
            ),
          },
          {
            key: "password",
            label: "登录密码",
            children: (
              <Form form={pwdForm} layout="vertical" disabled={loading}>
                <p style={{ color: "#8b96a8", marginBottom: 12, fontSize: 13 }}>
                  修改后需用新密码登录；未填写则不改密码。
                </p>
                <Form.Item label="当前账号">
                  <Input value={username || "—"} disabled />
                </Form.Item>
                <Form.Item label="原密码" name="old_password">
                  <Input.Password placeholder="要改密时填写" autoComplete="current-password" />
                </Form.Item>
                <Form.Item
                  label="新密码"
                  name="new_password"
                  rules={[{ min: 8, message: "至少 8 位" }]}
                >
                  <Input.Password placeholder="至少 8 位" autoComplete="new-password" />
                </Form.Item>
                <Form.Item label="确认新密码" name="new_password2" dependencies={["new_password"]}>
                  <Input.Password placeholder="再输一次" autoComplete="new-password" />
                </Form.Item>
              </Form>
            ),
          },
          {
            key: "llm",
            label: "模型密钥",
            children: (
              <Form form={llmForm} layout="vertical" disabled={loading}>
                <p style={{ color: "#8b96a8", marginBottom: 12, fontSize: 13 }}>
                  可选：配置个人 LLM。看图请用视觉模型；未配置时走平台默认。
                </p>
                <Form.Item label="LLM API Key" name="llm_api_key">
                  <Input.Password placeholder="sk-xxx（已保存时留空表示不修改）" autoComplete="off" />
                </Form.Item>
                <Form.Item label="LLM Base URL" name="llm_base_url">
                  <Input placeholder="https://ai.centos.hk/v1" />
                </Form.Item>
                <Form.Item label="LLM Model" name="llm_model">
                  <Input placeholder="gpt-4o" />
                </Form.Item>
              </Form>
            ),
          },
        ]}
      />
      <style>{`
        .user-profile-hero {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 12px;
          padding: 4px 0 8px;
        }
        .user-profile-avatar-wrap {
          position: relative;
          cursor: pointer;
          border-radius: 50%;
          overflow: hidden;
          width: 72px;
          height: 72px;
        }
        .user-profile-avatar-mask {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(23,32,51,.45);
          color: #fff;
          opacity: 0;
          transition: opacity .15s;
        }
        .user-profile-avatar-wrap:hover .user-profile-avatar-mask { opacity: 1; }
        .user-profile-name {
          font-size: 16px;
          font-weight: 650;
          color: #172033;
        }
        .user-profile-tip {
          font-size: 12px;
          color: #8b96a8;
          margin-top: 4px;
        }
        .user-profile-wecom-binding {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin: -4px 0 16px;
          padding: 10px 12px;
          border-radius: 10px;
          background: #f6f8fb;
          font-size: 13px;
        }
        .user-profile-wecom-binding > span:first-child {
          color: #5c6778;
        }
        .user-profile-wecom-binding small {
          color: #8b96a8;
        }
        .user-profile-wecom-binding-error {
          color: #cf4f4f !important;
        }
      `}</style>
    </Modal>
  );
}
