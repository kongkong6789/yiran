import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import {
  Alert, App, Avatar, Button, Form, Input, Segmented, Select, Space, Spin, Tag, Typography,
} from "antd";
import {
  CheckCircleFilled, LinkOutlined, LockOutlined, RobotOutlined, SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";

import {
  getWeComCliConfig, saveWeComCliConfig, testWeComCliConfig,
  type OrganizationMember, type WeComCliConfig,
} from "../../api/client";

type FormValue = {
  botId: string;
  secret?: string;
  accessScope: "organization" | "selected" | "owner";
  allowedUserIds: number[];
};

export type WeComCliConfigPanelHandle = {
  save: (testAfterSave?: boolean) => Promise<boolean>;
  test: () => Promise<boolean>;
  canManage: boolean;
  saving: boolean;
  configured: boolean;
  lastTestedAt?: string | null;
};

type Props = {
  organizationMembers: OrganizationMember[];
  onChanged?: () => void;
  onStatusChange?: (status: {
    canManage: boolean;
    saving: boolean;
    configured: boolean;
    lastTestedAt?: string | null;
  }) => void;
};

const WeComCliConfigPanel = forwardRef<WeComCliConfigPanelHandle, Props>(function WeComCliConfigPanel({
  organizationMembers,
  onChanged,
  onStatusChange,
}, ref) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValue>();
  const [config, setConfig] = useState<WeComCliConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [memberKeyword, setMemberKeyword] = useState("");
  const accessScope = Form.useWatch("accessScope", form) || "organization";
  const allowedUserIds = Form.useWatch("allowedUserIds", form) || [];

  const load = async () => {
    setLoading(true);
    try {
      const value = await getWeComCliConfig();
      setConfig(value);
      form.setFieldsValue({
        botId: value.canManage ? value.botId : "",
        secret: "",
        accessScope: value.accessScope || "organization",
        allowedUserIds: value.allowedUserIds || [],
      });
      onStatusChange?.({
        canManage: !!value.canManage,
        saving: false,
        configured: !!value.configured,
        lastTestedAt: value.lastTestedAt,
      });
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "企业微信智能机器人配置加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async (testAfterSave = false) => {
    const values = await form.validateFields();
    setSaving(true);
    onStatusChange?.({
      canManage: !!config?.canManage,
      saving: true,
      configured: !!config?.configured,
      lastTestedAt: config?.lastTestedAt,
    });
    try {
      await saveWeComCliConfig(values);
      if (testAfterSave) {
        const result = await testWeComCliConfig();
        message.success(result.detail);
      } else {
        message.success("企业微信智能机器人配置已保存");
      }
      await load();
      onChanged?.();
      return true;
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "企业微信智能机器人配置保存失败");
      return false;
    } finally {
      setSaving(false);
      onStatusChange?.({
        canManage: !!config?.canManage,
        saving: false,
        configured: !!config?.configured,
        lastTestedAt: config?.lastTestedAt,
      });
    }
  };

  const test = async () => {
    setSaving(true);
    onStatusChange?.({
      canManage: !!config?.canManage,
      saving: true,
      configured: !!config?.configured,
      lastTestedAt: config?.lastTestedAt,
    });
    try {
      const result = await testWeComCliConfig();
      message.success(result.detail);
      await load();
      onChanged?.();
      return true;
    } catch (error: any) {
      message.error(error?.response?.data?.detail || "连接测试失败");
      return false;
    } finally {
      setSaving(false);
      onStatusChange?.({
        canManage: !!config?.canManage,
        saving: false,
        configured: !!config?.configured,
        lastTestedAt: config?.lastTestedAt,
      });
    }
  };

  useImperativeHandle(ref, () => ({
    save,
    test,
    canManage: !!config?.canManage,
    saving,
    configured: !!config?.configured,
    lastTestedAt: config?.lastTestedAt,
  }), [config, saving]);

  const activeMembers = organizationMembers.filter((member) => member.isActive);
  const filteredMembers = activeMembers.filter((member) => {
    if (!memberKeyword.trim()) return true;
    const keyword = memberKeyword.trim().toLowerCase();
    return member.displayName.toLowerCase().includes(keyword)
      || member.roleLabel.toLowerCase().includes(keyword)
      || (member.username || "").toLowerCase().includes(keyword);
  });
  const selectedMembers = activeMembers.filter((member) => allowedUserIds.includes(member.id));
  const capabilityReady = !!config?.configured;

  return (
    <Spin spinning={loading}>
      <div className="wecom-cli-config-panel">
        <div className="wecom-shell-panel-head">
          <div>
            <Typography.Title level={4}>智能机器人 / CLI</Typography.Title>
            <Typography.Text type="secondary">用于创建、查询并同步企业微信原生待办</Typography.Text>
          </div>
          <Space wrap>
            <Tag color={capabilityReady ? "success" : "default"}>{capabilityReady ? "已连接" : "未配置"}</Tag>
            {config?.canManage && (
              <Button loading={saving} onClick={() => void test()}>测试连接</Button>
            )}
          </Space>
        </div>

        {config?.canManage ? (
          <Form form={form} layout="vertical" requiredMark className="wecom-cli-form">
            <section className="wecom-credential-card">
              <Form.Item
                name="botId"
                label="Bot ID"
                rules={[{ required: true, message: "请输入 Bot ID" }]}
              >
                <Input placeholder="请输入 Bot ID" />
              </Form.Item>
              <Form.Item
                name="secret"
                label="Secret"
                rules={config.secretConfigured ? [] : [{ required: true, message: "请输入 Secret" }]}
              >
                <Input.Password
                  autoComplete="new-password"
                  placeholder={config.secretConfigured ? "已保存，如需更换请重新输入" : "请输入 Secret"}
                />
              </Form.Item>
              <div className="wecom-credential-note">
                <LockOutlined />
                <span>Secret 只加密保存在服务端，页面不会返回完整明文。</span>
              </div>
            </section>

            <section className="wecom-scope-card">
              <div className="wecom-scope-card-head">
                <strong>待办使用范围</strong>
                <Typography.Text type="secondary">控制哪些平台成员可以使用原生待办能力</Typography.Text>
              </div>
              <Form.Item name="accessScope" className="wecom-scope-segment">
                <Segmented
                  block
                  options={[
                    { label: "企业全员", value: "organization" },
                    { label: "指定成员", value: "selected" },
                    { label: "仅配置者", value: "owner" },
                  ]}
                />
              </Form.Item>

              {accessScope === "selected" && (
                <>
                  <Input
                    className="wecom-member-search"
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="搜索姓名或部门"
                    value={memberKeyword}
                    onChange={(event) => setMemberKeyword(event.target.value)}
                  />
                  <Form.Item
                    name="allowedUserIds"
                    rules={[{ required: true, message: "请至少选择一位企业成员" }]}
                    className="wecom-member-select-field"
                  >
                    <Select
                      mode="multiple"
                      showSearch
                      optionFilterProp="label"
                      placeholder="添加成员"
                      options={filteredMembers.map((member) => ({
                        value: member.id,
                        label: `${member.displayName} · ${member.roleLabel}`,
                      }))}
                      tagRender={({ label, closable, onClose, value }) => {
                        const member = selectedMembers.find((item) => item.id === value);
                        return (
                          <Tag
                            className="wecom-member-tag"
                            closable={closable}
                            onClose={onClose}
                            icon={<Avatar size={18}>{member?.displayName?.slice(0, 1) || "成"}</Avatar>}
                          >
                            {member?.displayName || label}
                          </Tag>
                        );
                      }}
                    />
                  </Form.Item>
                </>
              )}
            </section>

            {config.lastErrorReason && (
              <Alert type="error" showIcon message="最近一次连接失败" description={config.lastErrorReason} style={{ marginBottom: 14 }} />
            )}
          </Form>
        ) : (
          <Alert
            type={config?.canUse ? "success" : "info"}
            showIcon
            message={config?.configured ? "智能机器人已由企业管理员配置" : "尚未配置智能机器人"}
            description={config?.canUse
              ? "你已获得企业微信原生待办使用权限。"
              : "企业管理员尚未向你开放该能力。普通成员不会看到 Bot ID、Secret 或底层地址。"}
            style={{ marginBottom: 16 }}
          />
        )}

        <section className="wecom-capability-list">
          {[
            { title: "创建原生待办", desc: "创建企业微信原生待办并分配负责人", ready: capabilityReady },
            { title: "查询与同步状态", desc: "查询待办并同步完成状态回平台", ready: capabilityReady },
            { title: "文档能力", desc: "保留官方文档与接入说明入口", ready: true },
          ].map((item) => (
            <div className="wecom-capability-row" key={item.title}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.desc}</span>
              </div>
              <em className={item.ready ? "is-ready" : ""}>
                {item.ready ? <><CheckCircleFilled /> 可用</> : "待配置"}
              </em>
            </div>
          ))}
          <Typography.Link href="https://github.com/WeComTeam/wecom-cli" target="_blank" rel="noreferrer" className="wecom-capability-doc">
            <LinkOutlined /> 查看官方接入说明
          </Typography.Link>
        </section>

        {config?.lastTestedAt && (
          <Typography.Text type="secondary" className="wecom-last-tested">
            <RobotOutlined /> 上次测试：{dayjs(config.lastTestedAt).format("YYYY-MM-DD HH:mm")}
          </Typography.Text>
        )}
      </div>
    </Spin>
  );
});

export default WeComCliConfigPanel;
