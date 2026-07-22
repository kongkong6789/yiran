import { useEffect, useState } from "react";
import { App, Button, Card, Form, Input, Tabs, Typography } from "antd";
import { useNavigate } from "react-router-dom";
import { getMe, LOGIN_NOTICE_KEY, login, register, setAuthToken } from "../api/client";
import BrandLogo from "../components/BrandLogo";

export default function Login() {
  const nav = useNavigate();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const notice = sessionStorage.getItem(LOGIN_NOTICE_KEY);
    if (notice) {
      sessionStorage.removeItem(LOGIN_NOTICE_KEY);
      message.warning(notice);
    }
  }, [message]);

  useEffect(() => {
    if (!localStorage.getItem("liangce_auth_token")) return;
    getMe()
      .then(() => nav("/collab", { replace: true }))
      .catch(() => undefined);
  }, [nav]);

  const onLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await login(values);
      if (!res.ok || !res.token) {
        message.error(res.error || "登录失败");
        return;
      }
      setAuthToken(res.token);
      message.success(`欢迎回来，${res.user.username}`);
      nav("/collab", { replace: true });
    } catch (e: any) {
      message.error(e?.response?.data?.error || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const onRegister = async (values: { username: string; password: string; email?: string }) => {
    setLoading(true);
    try {
      const res = await register(values);
      if (!res.ok || !res.token) {
        message.error(res.error || "注册失败");
        return;
      }
      setAuthToken(res.token);
      message.success("注册成功，已自动登录");
      nav("/collab", { replace: true });
    } catch (e: any) {
      message.error(e?.response?.data?.error || "注册失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <Card className="login-card" variant="borderless">
        <div className="login-brand">
          <BrandLogo size={72} />
          <Typography.Title level={3} style={{ margin: "14px 0 0", textAlign: "center" }}>
            良策
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ textAlign: "center", marginBottom: 0 }}>
            智能协作工作台
          </Typography.Paragraph>
        </div>
        <Typography.Paragraph type="secondary" style={{ textAlign: "center" }}>
          账号密码登录 · MCP 与对话配置均为个人私有
        </Typography.Paragraph>

        <Tabs
          centered
          items={[
            {
              key: "login",
              label: "登录",
              children: (
                <Form layout="vertical" onFinish={onLogin}>
                  <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
                    <Input placeholder="用户名" autoComplete="username" />
                  </Form.Item>
                  <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                    <Input.Password placeholder="密码" autoComplete="current-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={loading}>
                    登录
                  </Button>
                </Form>
              ),
            },
            {
              key: "register",
              label: "注册",
              children: (
                <Form layout="vertical" onFinish={onRegister}>
                  <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
                    <Input placeholder="用户名" />
                  </Form.Item>
                  <Form.Item label="邮箱" name="email">
                    <Input placeholder="可选" />
                  </Form.Item>
                  <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
                    <Input.Password placeholder="至少 8 位" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={loading}>
                    注册并登录
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
