import { useEffect, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { PlusOutlined, ReloadOutlined, KeyOutlined, DeleteOutlined } from "@ant-design/icons";
import {
  createAdminUser,
  deleteAdminUser,
  getMe,
  listAdminUsers,
  updateAdminUser,
  type AdminUserRow,
  type AuthUser,
} from "../api/client";
import WeComBindingManager from "../features/wecom-bindings/WeComBindingManager";
import WeComNotificationManager from "../features/wecom-bindings/WeComNotificationManager";

function fmtTime(v?: string | null) {
  if (!v) return "—";
  return v.slice(0, 19).replace("T", " ");
}

export default function Accounts() {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [target, setTarget] = useState<AdminUserRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [createForm] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [phoneForm] = Form.useForm();
  const [isStaffSelf, setIsStaffSelf] = useState(false);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [activeTab, setActiveTab] = useState("accounts");

  const load = async (q = keyword) => {
    setLoading(true);
    try {
      const data = await listAdminUsers(q.trim() || undefined);
      setRows(data.results || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "加载账号失败（需管理员）");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getMe()
      .then((res) => {
        setMe(res.user);
        setIsStaffSelf(!!(res.user.is_staff || res.user.is_superuser));
        if (res.user.is_staff || res.user.is_superuser) void load();
      })
      .catch(() => setIsStaffSelf(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showPasswordOnce = (username: string, password: string) => {
    modal.success({
      title: "请抄录密码（仅显示一次）",
      content: (
        <div>
          <p>账号：<Typography.Text copyable>{username}</Typography.Text></p>
          <p>密码：<Typography.Text copyable code>{password}</Typography.Text></p>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            密码在库中加密存储，之后无法再查看明文，只能重置。
          </Typography.Paragraph>
        </div>
      ),
    });
  };

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    setSaving(true);
    try {
      const res = await createAdminUser({
        username: values.username.trim(),
        password: values.password,
        email: values.email || "",
        display_name: values.display_name || "",
        phone: values.phone || "",
        is_staff: !!values.is_staff,
      });
      message.success("账号已创建");
      setCreateOpen(false);
      createForm.resetFields();
      if (res.password_once) showPasswordOnce(res.user.username, res.password_once);
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "创建失败");
    } finally {
      setSaving(false);
    }
  };

  const handleResetPwd = async () => {
    if (!target) return;
    const values = await pwdForm.validateFields();
    setSaving(true);
    try {
      const res = await updateAdminUser(target.id, { password: values.password });
      message.success("密码已重置");
      setPwdOpen(false);
      pwdForm.resetFields();
      if (res.password_once) showPasswordOnce(target.username, res.password_once);
      setTarget(null);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "重置失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: AdminUserRow) => {
    if (me && row.id === me.id) {
      message.warning("不能删除自己的账号");
      return;
    }
    modal.confirm({
      title: `删除账号「${row.username}」？`,
      content: "删除后无法恢复，该账号的登录态也会失效。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteAdminUser(row.id);
          message.success("账号已删除");
          await load();
        } catch (e: any) {
          message.error(e?.response?.data?.error || "删除失败");
          throw e;
        }
      },
    });
  };

  if (!isStaffSelf) {
    return (
      <div style={{ padding: 24 }}>
        <Typography.Title level={4}>账号管理</Typography.Title>
        <Typography.Paragraph type="secondary">
          仅管理员可查看与修改账号密码。请用 staff / 超级管理员账号登录。
        </Typography.Paragraph>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px 32px", maxWidth: 1100 }}>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>账号管理</Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            列出全部登录账号；密码入库后不可回读，可在此新建或重置。
          </Typography.Text>
        </div>
        {activeTab === "accounts" ? <Space wrap>
          <Input.Search
            allowClear
            placeholder="搜用户名 / 邮箱"
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={(v) => void load(v)}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建账号
          </Button>
        </Space> : null}
      </Space>

      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        { key: "accounts", label: "平台账号" },
        { key: "wecom", label: "企业微信账号绑定" },
        { key: "wecom-notifications", label: "通知重试" },
      ]} />

      {activeTab === "wecom" ? <WeComBindingManager /> : activeTab === "wecom-notifications" ? <WeComNotificationManager /> : <>

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        columns={[
          {
            title: "账号",
            dataIndex: "username",
            render: (v: string, r) => (
              <div>
                <Typography.Text strong copyable={{ text: v }}>{v}</Typography.Text>
                {r.display_name && r.display_name !== v ? (
                  <div style={{ color: "#8b96a8", fontSize: 12 }}>{r.display_name}</div>
                ) : null}
              </div>
            ),
          },
          {
            title: "邮箱",
            dataIndex: "email",
            render: (v: string) => v || "—",
          },
          {
            title: "手机号",
            dataIndex: "phone_masked",
            width: 130,
            render: (v: string) => v || "未填写",
          },
          {
            title: "密码",
            width: 120,
            render: (_: unknown, r) => (
              r.has_usable_password
                ? <Tag color="blue">已设置（加密）</Tag>
                : <Tag>不可用</Tag>
            ),
          },
          {
            title: "角色",
            width: 130,
            render: (_: unknown, r) => (
              r.is_superuser ? <Tag color="gold">超级管理员</Tag>
                : r.is_staff ? <Tag color="purple">管理员</Tag>
                  : <Tag>成员</Tag>
            ),
          },
          {
            title: "状态",
            width: 90,
            dataIndex: "is_active",
            render: (v: boolean, r) => (
              <Switch
                size="small"
                checked={v}
                checkedChildren="启用"
                unCheckedChildren="停用"
                onChange={async (checked) => {
                  try {
                    await updateAdminUser(r.id, { is_active: checked });
                    message.success(checked ? "已启用" : "已停用");
                    await load();
                  } catch (e: any) {
                    message.error(e?.response?.data?.error || "操作失败");
                  }
                }}
              />
            ),
          },
          {
            title: "最近登录",
            dataIndex: "last_login",
            width: 170,
            render: fmtTime,
          },
          {
            title: "操作",
            width: 250,
            render: (_: unknown, r) => (
              <Space size={0}>
                <Button
                  type="link"
                  size="small"
                  icon={<KeyOutlined />}
                  onClick={() => {
                    setTarget(r);
                    pwdForm.resetFields();
                    setPwdOpen(true);
                  }}
                >
                  改密码
                </Button>
                <Button
                  type="link"
                  size="small"
                  onClick={() => {
                    setTarget(r);
                    phoneForm.resetFields();
                    setPhoneOpen(true);
                  }}
                >
                  改手机号
                </Button>
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!!(me && r.id === me.id)}
                  onClick={() => handleDelete(r)}
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="新建账号"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
        confirmLoading={saving}
        okText="创建"
        destroyOnClose
      >
        <Form form={createForm} layout="vertical" initialValues={{ is_staff: false }}>
          <Form.Item label="账号（用户名）" name="username" rules={[{ required: true, message: "请输入账号" }]}>
            <Input placeholder="登录用用户名" autoComplete="off" />
          </Form.Item>
          <Form.Item label="显示名称" name="display_name">
            <Input placeholder="可选，协作里展示" />
          </Form.Item>
          <Form.Item label="邮箱" name="email">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item label="手机号" name="phone" help="用于自动匹配企业微信成员">
            <Input placeholder="例如 13800000000" />
          </Form.Item>
          <Form.Item
            label="初始密码"
            name="password"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 8, message: "至少 8 位" },
            ]}
          >
            <Input.Password placeholder="创建后仅展示一次供抄录" autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="管理员权限" name="is_staff" valuePropName="checked">
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={target ? `重置密码 · ${target.username}` : "重置密码"}
        open={pwdOpen}
        onCancel={() => { setPwdOpen(false); setTarget(null); }}
        onOk={() => void handleResetPwd()}
        confirmLoading={saving}
        okText="重置"
        destroyOnClose
      >
        <Form form={pwdForm} layout="vertical">
          <Form.Item
            label="新密码"
            name="password"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: 8, message: "至少 8 位" },
            ]}
          >
            <Input.Password placeholder="重置后对方需用新密码登录" autoComplete="new-password" />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            重置后该账号已有登录状态会失效，需重新登录。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal title={target ? `修改手机号 · ${target.username}` : "修改手机号"} open={phoneOpen}
        onCancel={() => { setPhoneOpen(false); setTarget(null); }} okText="保存并匹配"
        onOk={async () => {
          if (!target) return;
          const values = await phoneForm.validateFields();
          setSaving(true);
          try { await updateAdminUser(target.id, { phone: values.phone || "" }); message.success("手机号已保存，匹配任务已触发"); setPhoneOpen(false); setTarget(null); await load(); }
          catch (e: any) { message.error(e?.response?.data?.error || "保存失败"); }
          finally { setSaving(false); }
        }} confirmLoading={saving} destroyOnClose>
        <Form form={phoneForm} layout="vertical"><Form.Item name="phone" label="新手机号" help="留空可清除；页面和日志仅展示脱敏号码"><Input placeholder="13800000000 或 +8613800000000" /></Form.Item></Form>
      </Modal>
      </>}
    </div>
  );
}
