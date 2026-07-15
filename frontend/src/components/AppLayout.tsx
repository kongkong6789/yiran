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
  ApiOutlined,
  BarChartOutlined,
  ClockCircleOutlined,
  FlagOutlined,
  DownOutlined,
  UserOutlined,
  ApartmentOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import UserSettingsModal from "./UserSettingsModal";
import BrandLogo from "./BrandLogo";
import CollabUnreadBell from "./CollabUnreadBell";
import { brand } from "../theme/brand";
import { clearAuthToken, getAuthToken, getMe, logout, type AuthUser } from "../api/client";

const { Header, Content } = Layout;

type NavItem = { key: string; icon: ReactNode; label: string };

/** 日常高频：先做事 */
const WORK_NAV: NavItem[] = [
  { key: "/home", icon: <HomeOutlined />, label: "总览" },
  { key: "/agent", icon: <MessageOutlined />, label: "对话" },
  { key: "/collab", icon: <AlertOutlined />, label: "协作" },
  { key: "/console", icon: <FlagOutlined />, label: "任务" },
];

/** 沉淀与复用 */
const KNOWLEDGE_NAV: NavItem[] = [
  { key: "/knowledge", icon: <BookOutlined />, label: "知识库" },
  { key: "/ontology", icon: <ShareAltOutlined />, label: "图谱" },
  { key: "/skills", icon: <ThunderboltOutlined />, label: "技能" },
  { key: "/my/recent", icon: <ClockCircleOutlined />, label: "最近" },
];

/** 业务能力与外部系统 */
const CAPABILITY_NAV: NavItem[] = [
  { key: "/council", icon: <TeamOutlined />, label: "专家团" },
  { key: "/connectors", icon: <ApiOutlined />, label: "连接" },
  { key: "/datalake", icon: <BarChartOutlined />, label: "数据" },
];

/** 低频管理 */
const ADMIN_NAV: NavItem[] = [
  { key: "/accounts", icon: <UserOutlined />, label: "账号" },
  { key: "/agents", icon: <ApartmentOutlined />, label: "对象" },
  { key: "/loops", icon: <SyncOutlined />, label: "回路" },
  { key: "/audit", icon: <SafetyCertificateOutlined />, label: "审计" },
];

const ALL_NAV = [...WORK_NAV, ...KNOWLEDGE_NAV, ...CAPABILITY_NAV, ...ADMIN_NAV];

const FULL_BLEED = new Set(["/home", "/agent", "/collab", "/ontology", "/connectors"]);

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

  const isFullBleed = FULL_BLEED.has(loc.pathname);

  const selectedKeys = useMemo(() => {
    const hit = ALL_NAV.find((n) => loc.pathname === n.key || loc.pathname.startsWith(`${n.key}/`));
    return hit ? [hit.key] : [loc.pathname];
  }, [loc.pathname]);

  const openKeys = useMemo(() => {
    if (WORK_NAV.some((n) => selectedKeys.includes(n.key))) return ["work"];
    if (KNOWLEDGE_NAV.some((n) => selectedKeys.includes(n.key))) return ["knowledge"];
    if (CAPABILITY_NAV.some((n) => selectedKeys.includes(n.key))) return ["capability"];
    if (ADMIN_NAV.some((n) => selectedKeys.includes(n.key))) return ["admin"];
    return [];
  }, [selectedKeys]);

  const menuItems = useMemo(() => [
    {
      key: "work",
      label: "工作",
      children: WORK_NAV.map((n) => ({ key: n.key, icon: n.icon, label: n.label })),
    },
    {
      key: "knowledge",
      label: "知识",
      children: KNOWLEDGE_NAV.map((n) => ({ key: n.key, icon: n.icon, label: n.label })),
    },
    {
      key: "capability",
      label: "能力",
      children: CAPABILITY_NAV.map((n) => ({ key: n.key, icon: n.icon, label: n.label })),
    },
    {
      key: "admin",
      label: "管理",
      children: ADMIN_NAV.map((n) => ({ key: n.key, icon: n.icon, label: n.label })),
    },
  ], []);

  const userMenu = {
    items: [
      { key: "settings", label: "个人信息", icon: <UserOutlined /> },
      { type: "divider" as const },
      { key: "logout", label: "退出登录", danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "settings") setSettingsOpen(true);
      if (key === "logout") handleLogout();
    },
  };

  const displayName = user?.display_name || user?.username || "未登录";

  return (
    <Layout className="app-shell-topnav" style={{ minHeight: "100vh" }}>
      <Header className="app-topnav">
        <div
          className="app-brand app-topnav-brand"
          onClick={() => nav("/home")}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") nav("/home");
          }}
          title="回到总览"
        >
          <BrandLogo size={40} className="app-brand-logo" />
          {screens.md !== false && (
            <span className="app-brand-text">
              良策
              <small>智能协作工作台</small>
            </span>
          )}
        </div>

        <Menu
          className="app-topnav-menu"
          theme="light"
          mode="horizontal"
          selectedKeys={selectedKeys}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={(e) => {
            if (String(e.key).startsWith("/")) nav(e.key);
          }}
        />

        <Space className="app-topnav-actions" size={8}>
          {user ? <CollabUnreadBell enabled /> : null}
          <Dropdown menu={userMenu} placement="bottomRight">
            <button type="button" className="app-topnav-user" aria-label="打开账户菜单">
              <Avatar
                size={32}
                src={
                  user?.avatar_url
                    ? `${user.avatar_url}${user.avatar_url.includes("?") ? "&" : "?"}token=${encodeURIComponent(getAuthToken() || "")}`
                    : undefined
                }
                style={{ background: brand.gradientGold }}
              >
                {displayName[0]?.toUpperCase()}
              </Avatar>
              {screens.sm !== false && (
                <Typography.Text className="app-topnav-username">
                  {displayName}
                </Typography.Text>
              )}
              <DownOutlined style={{ fontSize: 10, opacity: 0.7 }} />
            </button>
          </Dropdown>
        </Space>
      </Header>

      <UserSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(u) => setUser(u)}
      />

      <Content className={isFullBleed ? "app-content-bleed" : "app-content-padded"}>
        <Outlet />
      </Content>
    </Layout>
  );
}
