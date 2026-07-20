import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, App, Button, Form, Input, Modal, Segmented, Select, Space, Tag, Typography } from "antd";
import {
  ApiOutlined, CheckCircleFilled, EyeInvisibleOutlined, EyeOutlined, LinkOutlined,
  RobotOutlined, SafetyCertificateOutlined, WechatOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  DEFAULT_WECOM_CONFIG,
  getWeComConfig,
  getWeComGroups,
  saveWeComConfig,
  testWeComConfig,
  type WeComConfigValue,
} from "./mockWeCom";
import WeComGroupWebhookManager from "./WeComGroupWebhookManager";
import WeComCliConfigPanel, { type WeComCliConfigPanelHandle } from "./WeComCliConfigPanel";
import { getCurrentOrganization, type OrganizationMember } from "../../api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  initialTab?: "api" | "webhooks" | "cli";
}

type ShellTab = "api" | "webhooks" | "cli";

function GeneratedCopyField({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div className="wecom-generated-field">
      <Typography.Text strong>{label}</Typography.Text>
      <div className="wecom-generated-field__value">
        <Typography.Text ellipsis={{ tooltip: value }}>{value || "等待系统生成"}</Typography.Text>
        <Typography.Text copyable={value ? { text: value, tooltips: ["复制", "已复制"] } : false} />
      </div>
      <Typography.Text type="secondary">{help}</Typography.Text>
    </div>
  );
}

export default function WeComConfigModal({ open, onClose, onSaved, initialTab = "api" }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<WeComConfigValue>();
  const cliRef = useRef<WeComCliConfigPanelHandle>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [activeTab, setActiveTab] = useState<ShellTab>("api");
  const [generatedConfig, setGeneratedConfig] = useState<WeComConfigValue>(DEFAULT_WECOM_CONFIG);
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [webhookCount, setWebhookCount] = useState(0);
  const [cliStatus, setCliStatus] = useState<{
    canManage: boolean;
    saving: boolean;
    configured: boolean;
    lastTestedAt?: string | null;
  }>({
    canManage: false,
    saving: false,
    configured: false,
    lastTestedAt: null,
  });
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof testWeComConfig>> | null>(null);

  const refreshSidebarMeta = async () => {
    try {
      const [config, groups] = await Promise.all([getWeComConfig(), getWeComGroups()]);
      setGeneratedConfig(config);
      setWebhookCount(groups.length);
    } catch {
      /* ignore sidebar refresh errors */
    }
  };

  useEffect(() => {
    if (!open) return;
    setLoadingConfig(true);
    setActiveTab(initialTab);
    setTestResult(null);
    setGeneratedConfig(DEFAULT_WECOM_CONFIG);
    form.setFieldsValue(DEFAULT_WECOM_CONFIG);
    Promise.all([getWeComConfig(), getCurrentOrganization(), getWeComGroups()])
      .then(([config, organization, groups]) => {
        form.setFieldsValue(config);
        setGeneratedConfig(config);
        setOrganizationMembers(organization.members || []);
        setWebhookCount(groups.length);
      })
      .catch(() => message.error("企业微信 API 配置加载失败"))
      .finally(() => setLoadingConfig(false));
  }, [form, initialTab, message, open]);

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await testWeComConfig();
      setTestResult(result);
      message.success("连接测试成功");
    } catch (error: any) {
      setTestResult(null);
      message.error(error?.response?.data?.detail || "连接测试失败，请检查企业微信配置和应用权限");
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (activeTab === "cli") {
      const ok = await cliRef.current?.save(false);
      if (ok) onSaved?.();
      return;
    }
    const values = await form.validateFields();
    setSaving(true);
    try {
      const saved = await saveWeComConfig(values);
      setGeneratedConfig(saved);
      message.success("企业微信 API 配置已保存");
      onSaved?.();
    } catch {
      message.error("企业微信 API 配置保存失败");
    } finally {
      setSaving(false);
    }
  };

  const apiConnected = !!generatedConfig.configured;
  const cliConnected = cliStatus.configured;
  const lastTestedLabel = cliStatus.lastTestedAt
    ? dayjs(cliStatus.lastTestedAt).format("YYYY-MM-DD HH:mm")
    : "尚未测试";

  const navItems: Array<{
    key: ShellTab;
    title: string;
    desc: string;
    icon: ReactNode;
    meta: React.ReactNode;
  }> = [
    {
      key: "api",
      title: "自建应用 API",
      desc: "消息推送与通讯录",
      icon: <ApiOutlined />,
      meta: <span className={`wecom-shell-nav-status ${apiConnected ? "is-ready" : ""}`}>{apiConnected ? "已连接" : "未配置"}</span>,
    },
    {
      key: "webhooks",
      title: "群机器人 Webhook",
      desc: "群聊通知渠道",
      icon: <RobotOutlined />,
      meta: <Tag>{webhookCount}个群</Tag>,
    },
    {
      key: "cli",
      title: "智能机器人 / CLI",
      desc: "原生待办能力",
      icon: <WechatOutlined />,
      meta: <span className={`wecom-shell-nav-status ${cliConnected ? "is-ready" : ""}`}>{cliConnected ? "运行正常" : "未配置"}</span>,
    },
  ];

  const footerBusy = saving || testing || cliStatus.saving;
  const showSave = (activeTab === "api" && !!generatedConfig.canManage)
    || (activeTab === "cli" && cliStatus.canManage);

  return (
    <Modal
      className="wecom-config-modal wecom-connection-shell"
      open={open}
      width={1080}
      loading={loadingConfig}
      title={(
        <div className="wecom-shell-title">
          <span className="wecom-shell-title-icon"><WechatOutlined /></span>
          <span>
            <strong>企业微信连接</strong>
            <small>统一管理消息、群通知与原生待办</small>
          </span>
        </div>
      )}
      onCancel={onClose}
      destroyOnHidden={false}
      forceRender
      footer={(
        <div className="wecom-shell-footer">
          <Button onClick={onClose}>取消</Button>
          {showSave && (
            <Button type="primary" className="wecom-shell-save" loading={footerBusy} onClick={() => void save()}>
              保存配置
            </Button>
          )}
          {!showSave && <Button type="primary" onClick={onClose}>关闭</Button>}
        </div>
      )}
    >
      <div className="wecom-shell-layout">
        <aside className="wecom-shell-nav">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`wecom-shell-nav-item${activeTab === item.key ? " is-active" : ""}`}
              onClick={() => setActiveTab(item.key)}
            >
              <span className="wecom-shell-nav-icon">{item.icon}</span>
              <span className="wecom-shell-nav-copy">
                <strong>{item.title}</strong>
                <small>{item.desc}</small>
                {item.meta}
              </span>
            </button>
          ))}
          <div className="wecom-shell-nav-foot">
            <Typography.Link
              href="https://developer.work.weixin.qq.com/document/path/90665"
              target="_blank"
              rel="noreferrer"
            >
              <LinkOutlined /> 查看接入说明
            </Typography.Link>
            <small>上次测试：{lastTestedLabel}</small>
          </div>
        </aside>

        <div className="wecom-shell-content">
          {activeTab === "api" && (
            <>
              <div className="wecom-shell-panel-head">
                <div>
                  <Typography.Title level={4}>自建应用 API</Typography.Title>
                  <Typography.Text type="secondary">用于应用消息、通讯录同步与事件回调</Typography.Text>
                </div>
                <Space wrap>
                  <Tag color={apiConnected ? "success" : "default"}>{apiConnected ? "已连接" : "未配置"}</Tag>
                  {generatedConfig.canManage && (
                    <Button loading={testing} onClick={() => void testConnection()}>测试连接</Button>
                  )}
                </Space>
              </div>

              <div className="wecom-config-guide">
                <div>
                  <LinkOutlined />
                  <span>
                    <strong>不知道从哪里获取？</strong>
                    <Typography.Text type="secondary">
                      CorpID：我的企业 → 企业信息；AgentID 和 Secret：应用管理 → 自建应用 → 应用详情。
                    </Typography.Text>
                  </span>
                </div>
                <Typography.Link
                  href="https://developer.work.weixin.qq.com/document/path/90665"
                  target="_blank"
                  rel="noreferrer"
                >
                  查看企业微信官方获取指引
                </Typography.Link>
              </div>

              <Form form={form} layout="vertical" initialValues={DEFAULT_WECOM_CONFIG} requiredMark>
                <Alert
                  type={generatedConfig.canManage ? "success" : "info"}
                  showIcon
                  message={generatedConfig.organization?.name ? `所属企业：${generatedConfig.organization.name}` : "尚未加入企业"}
                  description={generatedConfig.canManage
                    ? "你是企业管理员，可以配置连接并决定哪些企业成员可以使用。"
                    : (generatedConfig.detail || `该连接由 ${generatedConfig.ownerName || "企业管理员"} 管理，你只能使用已获授权的功能。`)}
                  style={{ marginBottom: 14 }}
                />
                <div className="wecom-config-grid">
                  <Form.Item
                    label="企业 ID（CorpID）"
                    name="corpId"
                    extra="企业的唯一标识，在“我的企业 → 企业信息”中查看。"
                    rules={[{ required: true, message: "请输入 CorpID" }]}
                  >
                    <Input disabled={!generatedConfig.canManage} placeholder="wwxxxxxxxxxxxxxxxx" />
                  </Form.Item>
                  <Form.Item
                    label="应用 AgentID"
                    name="agentId"
                    extra="自建应用的数字 ID，用于指定由哪个应用发送消息。"
                    rules={[{ required: true, message: "请输入 AgentID" }]}
                  >
                    <Input disabled={!generatedConfig.canManage} placeholder="1000002" />
                  </Form.Item>
                </div>
                <Form.Item
                  label="应用 Secret"
                  name="secret"
                  extra="自建应用调用企业微信接口的凭证，请勿在聊天或文档中公开。"
                  rules={[{ required: true, message: "请输入 Secret" }]}
                >
                  <Input
                    disabled={!generatedConfig.canManage}
                    type={showSecret ? "text" : "password"}
                    suffix={(
                      <Button
                        type="text"
                        size="small"
                        icon={showSecret ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                        onClick={() => setShowSecret((value) => !value)}
                      >
                        {showSecret ? "隐藏" : "显示"}
                      </Button>
                    )}
                  />
                </Form.Item>
                {generatedConfig.canManage && (
                  <>
                    <Form.Item
                      label="连接可用范围"
                      name="accessScope"
                      extra="控制哪些平台成员可以使用该企业微信 API、通讯录和个人应用消息。"
                    >
                      <Segmented
                        block
                        options={[
                          { label: "企业全员", value: "organization" },
                          { label: "指定成员", value: "selected" },
                          { label: "仅配置者", value: "owner" },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(previous, current) => previous.accessScope !== current.accessScope}>
                      {({ getFieldValue }) => getFieldValue("accessScope") === "selected" ? (
                        <Form.Item
                          label="允许使用的成员"
                          name="allowedUserIds"
                          rules={[{ required: true, message: "请至少选择一位企业成员" }]}
                        >
                          <Select
                            mode="multiple"
                            placeholder="选择当前企业成员"
                            options={organizationMembers.filter((member) => member.isActive).map((member) => ({
                              value: member.id,
                              label: `${member.displayName} · ${member.roleLabel}`,
                            }))}
                          />
                        </Form.Item>
                      ) : null}
                    </Form.Item>
                  </>
                )}
                <div className="wecom-callback-generated" aria-label="系统生成的接收消息与事件配置">
                  <div className="wecom-callback-generated__title">
                    <div>
                      <strong>接收消息与事件配置</strong>
                      <Typography.Text type="secondary">以下内容由系统生成，请复制到企业微信应用的“接收消息”配置中。</Typography.Text>
                    </div>
                    {generatedConfig.callbackVerified
                      ? <Tag color="green">已通过企业微信验证</Tag>
                      : <Tag color="gold">等待企业微信验证</Tag>}
                  </div>
                  <GeneratedCopyField label="回调 URL" value={generatedConfig.callbackUrl} help="系统提供的公网 HTTPS 接口，企业微信会先向该地址发起验证请求。" />
                  <GeneratedCopyField label="Token" value={generatedConfig.token} help="用于验证企业微信请求签名，由系统生成并加密保存。" />
                  <GeneratedCopyField label="EncodingAESKey" value={generatedConfig.encodingAesKey} help="用于解密企业微信推送内容，由系统生成的 43 位密钥。" />
                </div>

                <Typography.Link
                  className="wecom-callback-doc-link"
                  href="https://developer.work.weixin.qq.com/document/path/90930"
                  target="_blank"
                  rel="noreferrer"
                >
                  <LinkOutlined /> 查看企业微信“接收消息与事件”配置说明
                </Typography.Link>

                <Alert
                  type="warning"
                  showIcon
                  icon={<SafetyCertificateOutlined />}
                  message="Secret 只在服务端加密保存且不会回传；Token 和 EncodingAESKey 仅向当前登录用户展示，用于复制到企业微信后台。"
                />

                {testResult && (
                  <div className="wecom-test-result">
                    <div><CheckCircleFilled /> <strong>连接测试成功</strong></div>
                    <span>已获取应用：{testResult.appName}</span>
                    <span>可见成员：{testResult.visibleMembers} 人</span>
                    <span>消息发送权限：{testResult.permission}</span>
                  </div>
                )}
              </Form>
            </>
          )}

          {activeTab === "webhooks" && (
            <>
              <div className="wecom-shell-panel-head">
                <div>
                  <Typography.Title level={4}>群机器人 Webhook</Typography.Title>
                  <Typography.Text type="secondary">为每个企业微信群配置独立通知渠道</Typography.Text>
                </div>
                <Tag color="blue">{webhookCount} 个群</Tag>
              </div>
              <Alert
                className="wecom-webhook-tab-intro"
                type="info"
                showIcon
                message="可配置多个企业微信群机器人"
                description="每个群聊分别添加一条 Webhook，发送任务时可选择具体群聊。Webhook 将加密保存在当前用户的服务端配置中。"
              />
              <WeComGroupWebhookManager
                onChanged={() => {
                  onSaved?.();
                  void refreshSidebarMeta();
                }}
                organizationMembers={organizationMembers}
                canManage={!!generatedConfig.canManage}
              />
            </>
          )}

          {activeTab === "cli" && (
            <WeComCliConfigPanel
              ref={cliRef}
              organizationMembers={organizationMembers}
              onChanged={() => {
                onSaved?.();
                void refreshSidebarMeta();
              }}
              onStatusChange={setCliStatus}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
