import { useEffect, useState } from "react";
import { Alert, App, Button, Form, Input, Modal, Space, Tabs, Tag, Typography } from "antd";
import {
  CheckCircleFilled,
  EyeInvisibleOutlined,
  EyeOutlined,
  LinkOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  DEFAULT_WECOM_CONFIG,
  getWeComConfig,
  saveWeComConfig,
  testWeComConfig,
  type WeComConfigValue,
} from "./mockWeCom";
import WeComGroupWebhookManager from "./WeComGroupWebhookManager";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

function GeneratedCopyField({ label, value, help }: { label: string; value: string; help: string }) {
  return <div className="wecom-generated-field">
    <Typography.Text strong>{label}</Typography.Text>
    <div className="wecom-generated-field__value">
      <Typography.Text ellipsis={{ tooltip: value }}>{value || "等待系统生成"}</Typography.Text>
      <Typography.Text copyable={value ? { text: value, tooltips: ["复制", "已复制"] } : false} />
    </div>
    <Typography.Text type="secondary">{help}</Typography.Text>
  </div>;
}

export default function WeComConfigModal({ open, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<WeComConfigValue>();
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [activeTab, setActiveTab] = useState("api");
  const [generatedConfig, setGeneratedConfig] = useState<WeComConfigValue>(DEFAULT_WECOM_CONFIG);
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof testWeComConfig>> | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoadingConfig(true);
    setActiveTab("api");
    setTestResult(null);
    setGeneratedConfig(DEFAULT_WECOM_CONFIG);
    form.setFieldsValue(DEFAULT_WECOM_CONFIG);
    getWeComConfig()
      .then((config) => { form.setFieldsValue(config); setGeneratedConfig(config); })
      .catch(() => message.error("企业微信 API 配置加载失败"))
      .finally(() => setLoadingConfig(false));
  }, [form, message, open]);

  const testConnection = async () => {
    const values = await form.validateFields();
    setTesting(true);
    try {
      const result = await testWeComConfig(values);
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
    const values = await form.validateFields();
    setSaving(true);
    try {
      const saved = await saveWeComConfig(values);
      setGeneratedConfig(saved);
      message.success("企业微信 API 配置已保存");
      onSaved?.();
      onClose();
    } catch {
      message.error("企业微信 API 配置保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      className="wecom-config-modal"
      open={open}
      width={620}
      loading={loadingConfig}
      title={(
        <div className="wecom-modal-title">
          <Typography.Title level={4}>企业微信配置</Typography.Title>
          <Typography.Text type="secondary">配置自建应用 API 与多个群聊通知 Webhook</Typography.Text>
        </div>
      )}
      onCancel={onClose}
      destroyOnHidden={false}
      forceRender
      footer={activeTab === "api" ? (
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button loading={testing} onClick={testConnection}>测试连接</Button>
          <Button type="primary" loading={saving} onClick={save}>保存配置</Button>
        </Space>
      ) : <Button onClick={onClose}>关闭</Button>}
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        { key: "api", label: "企业微信 API", children: <>
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
        <div className="wecom-config-grid">
          <Form.Item
            label="企业 ID（CorpID）"
            name="corpId"
            extra="企业的唯一标识，在“我的企业 → 企业信息”中查看。"
            rules={[{ required: true, message: "请输入 CorpID" }]}
          >
            <Input placeholder="wwxxxxxxxxxxxxxxxx" />
          </Form.Item>
          <Form.Item
            label="应用 AgentID"
            name="agentId"
            extra="自建应用的数字 ID，用于指定由哪个应用发送消息。"
            rules={[{ required: true, message: "请输入 AgentID" }]}
          >
            <Input placeholder="1000002" />
          </Form.Item>
        </div>
        <Form.Item
          label="应用 Secret"
          name="secret"
          extra="自建应用调用企业微信接口的凭证，请勿在聊天或文档中公开。"
          rules={[{ required: true, message: "请输入 Secret" }]}
        >
          <Input
            type={showSecret ? "text" : "password"}
            suffix={<Button type="text" size="small" icon={showSecret ? <EyeInvisibleOutlined /> : <EyeOutlined />} onClick={() => setShowSecret((v) => !v)}>{showSecret ? "隐藏" : "显示"}</Button>}
          />
        </Form.Item>
        <div className="wecom-callback-generated" aria-label="系统生成的接收消息与事件配置">
          <div className="wecom-callback-generated__title">
            <div><strong>接收消息与事件配置</strong><Typography.Text type="secondary">以下内容由系统生成，请复制到企业微信应用的“接收消息”配置中。</Typography.Text></div>
            {generatedConfig.callbackVerified ? <Tag color="green">已通过企业微信验证</Tag> : <Tag color="gold">等待企业微信验证</Tag>}
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
        </> },
        { key: "webhooks", label: "群聊通知 Webhook", children: <>
          <Alert
            className="wecom-webhook-tab-intro"
            type="info"
            showIcon
            message="可配置多个企业微信群机器人"
            description="每个群聊分别添加一条 Webhook，发送任务时可选择具体群聊。Webhook 将加密保存在当前用户的服务端配置中。"
          />
          <WeComGroupWebhookManager onChanged={onSaved} />
        </> },
      ]} />
    </Modal>
  );
}
