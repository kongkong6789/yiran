import { Layout, Menu, Grid, Space, Typography, Avatar, Dropdown } from "antd";
import {
  AlertOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ShareAltOutlined,
  HomeOutlined,
  SyncOutlined,
  MessageOutlined,
  BookOutlined,
  ThunderboltOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  FolderOutlined,
  StarOutlined,
  ClockCircleOutlined,
  FlagOutlined,
  DownOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import UserSettingsModal from "./UserSettingsModal";
import BrandLogo from "./BrandLogo";
import CollabUnreadBell from "./CollabUnreadBell";
import { brand } from "../theme/brand";
import { clearAuthToken, getMe, logout, type AuthUser } from "../api/client";

const { Header, Content } = Layout;

type NavItem = { key: string; icon: ReactNode; label: string };

const MAIN_NAV: NavItem[] = [
  { key: "/home", icon: <HomeOutlined />, label: "概览" },
  { key: "/ontology", icon: <ShareAltOutlined />, label: "知识图谱" },
  { key: "/knowledge", icon: <BookOutlined />, label: "知识库" },
  { key: "/skills", icon: <ThunderboltOutlined />, label: "技能库" },
  { key: "/council", icon: <TeamOutlined />, label: "专家团" },
  { key: "/console", icon: <FlagOutlined />, label: "任务中心" },
  { key: "/connectors", icon: <AppstoreOutlined />, label: "应用中心" },
  { key: "/datalake", icon: <BarChartOutlined />, label: "数据看板" },
];

const MY_SPACE: NavItem[] = [
  { key: "/agent", icon: <MessageOutlined />, label: "对话 Agent" },
  { key: "/collab", icon: <AlertOutlined />, label: "协作风控" },
  { key: "/my/knowledge", icon: <FolderOutlined />, label: "我的知识库" },
  { key: "/my/favorites", icon: <StarOutlined />, label: "我的收藏" },
  { key: "/my/recent", icon: <ClockCircleOutlined />, label: "最近查看" },
];

const ADVANCED_NAV: NavItem[] = [
  { key: "/agents", icon: <TeamOutlined />, label: "对象管理" },
  { key: "/loops", icon: <SyncOutlined />, label: "Loops 回路" },
  { key: "/audit", icon: <SafetyCertificateOutlined />, label: "闸机审计" },
];

const ALL_NAV = [...MAIN_NAV, ...MY_SPACE, ...ADVANCED_NAV];

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const screens = Grid.useBreakpoint();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    getMe().then((res) => setUser(res.user)).catch(() => setUser(null));
  }, []);

  const handleLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    clearAuthToken();
    nav("/login", { replace: true });
  };

  const isFullBleed = ["/home", "/agent", "/collab", "/ontology", "/connectors"].includes(loc.pathname);

  const selectedKeys = useMemo(() => {
    const hit = ALL_NAV.find((n) => loc.pathname === n.key || loc.pathname.startsWith(`${n.key}/`));
    return hit ? [hit.key] : [loc.pathname];
  }, [loc.pathname]);

  const menuItems = useMemo(() => [
    {
      key: "platform",
      label: "平台",
      children: MAIN_NAV.map((n) => ({ key: n.key, icon: n.icon, label: n.label })),
    },
    {
      key: "myspace",
      label: "我的空间",
      children: MY_SPACE.map((n) => ({ key: n.key, icon: n.icon, label: n.label })),
    },
    {
      key: "advanced",
      label: "高级",
      children: ADVANCED_NAV.map((n) => ({ key: n.key, icon: n.icon, label: n.label })),
    },
  ], []);

  const userMenu = {
    items: [
      { key: "settings", label: "个人设置", icon: <UserOutlined /> },
      { type: "divider" as const },
      { key: "logout", label: "退出登录", danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "settings") setSettingsOpen(true);
      if (key === "logout") handleLogout();
    },
  };

  return (
    <Layout className="app-shell-topnav" style={{ minHeight: "100vh" }}>
      <Header className="app-topnav">
        <div className="app-brand app-topnav-brand" onClick={() => nav("/home")}>
          <BrandLogo size={48} className="app-brand-logo" />
          {screens.md !== false && (
            <span className="app-brand-text">
              良策 AI<small>Agent 执行平台</small>
            </span>
          )}
        </div>

        <Menu
          className="app-topnav-menu"
          theme="light"
          mode="horizontal"
          selectedKeys={selectedKeys}
          items={menuItems}
          onClick={(e) => nav(e.key)}
        />

        <Space className="app-topnav-actions" size={8}>
          {user ? <CollabUnreadBell enabled /> : null}
          <Dropdown menu={userMenu} placement="bottomRight">
            <button type="button" className="app-topnav-user">
              <Avatar size={32} style={{ background: brand.gradientGold }}>
                {(user?.username || "?")[0]?.toUpperCase()}
              </Avatar>
              {screens.sm !== false && (
                <Typography.Text className="app-topnav-username">
                  {user?.username || "未登录"}
                </Typography.Text>
              )}
              <DownOutlined style={{ fontSize: 10, opacity: 0.7 }} />
            </button>
          </Dropdown>
        </Space>
      </Header>

      <UserSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <Content
        className={isFullBleed ? "app-content-bleed" : "app-content-padded"}
      >
        <Outlet />
      </Content>
    </Layout>
  );
}
