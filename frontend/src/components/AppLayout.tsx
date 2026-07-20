import { Avatar, Button, Dropdown, Grid, Input, Layout, Menu, Space, Tooltip, Typography } from "antd";
import {
  ApartmentOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BookOutlined,
  BulbOutlined,
  DatabaseOutlined,
  FlagOutlined,
  HomeOutlined,
  LeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  RightOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  SyncOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import UserSettingsModal from "./UserSettingsModal";
import BrandLogo from "./BrandLogo";
import CollabUnreadBell from "./CollabUnreadBell";
import MeetingInviteAlert from "./MeetingInviteAlert";
import { brand } from "../theme/brand";
import { useThemeMode } from "../theme/mode";
import { clearAuthToken, getAuthToken, getMe, logout, type AuthUser } from "../api/client";

const { Header, Content, Sider } = Layout;

type NavItem = { key: string; icon: ReactNode; label: string };
type SectionKey = "work" | "knowledge" | "commerce" | "capability" | "admin";
type NavSection = {
  key: SectionKey;
  label: string;
  eyebrow: string;
  icon: ReactNode;
  defaultPath: string;
  items: NavItem[];
};

/** 仅控制菜单可见性；所有路由和功能仍在 App.tsx 中保留。 */
const WORK_NAV: NavItem[] = [
  { key: "/home", icon: <HomeOutlined />, label: "工作台" },
  { key: "/collab", icon: <TeamOutlined />, label: "团队协作" },
  { key: "/work", icon: <FlagOutlined />, label: "任务与待办" },
];

const KNOWLEDGE_NAV: NavItem[] = [
  { key: "/knowledge", icon: <BookOutlined />, label: "知识库" },
  { key: "/skills", icon: <ThunderboltOutlined />, label: "技能" },
  { key: "/tables", icon: <DatabaseOutlined />, label: "智能表格" },
];

const COMMERCE_NAV: NavItem[] = [
  { key: "/commerce/loops", icon: <SyncOutlined />, label: "经营回路" },
];

const CAPABILITY_NAV: NavItem[] = [
  { key: "/agent", icon: <MessageOutlined />, label: "Agent" },
  { key: "/connectors", icon: <ApiOutlined />, label: "连接能力" },
];

const ADMIN_NAV: NavItem[] = [
  { key: "/accounts", icon: <UserOutlined />, label: "账号管理" },
  { key: "/agents", icon: <ApartmentOutlined />, label: "对象管理" },
];

const SECTIONS: NavSection[] = [
  {
    key: "work",
    label: "工作",
    eyebrow: "WORK",
    icon: <HomeOutlined />,
    defaultPath: "/home",
    items: WORK_NAV,
  },
  {
    key: "knowledge",
    label: "知识",
    eyebrow: "KNOWLEDGE",
    icon: <BookOutlined />,
    defaultPath: "/knowledge",
    items: KNOWLEDGE_NAV,
  },
  {
    key: "commerce",
    label: "经营",
    eyebrow: "OPERATIONS",
    icon: <ShopOutlined />,
    defaultPath: "/commerce/loops",
    items: COMMERCE_NAV,
  },
  {
    key: "capability",
    label: "能力",
    eyebrow: "CAPABILITY",
    icon: <BulbOutlined />,
    defaultPath: "/agent",
    items: CAPABILITY_NAV,
  },
  {
    key: "admin",
    label: "管理",
    eyebrow: "ADMIN",
    icon: <SettingOutlined />,
    defaultPath: "/accounts",
    items: ADMIN_NAV,
  },
];

const ALL_VISIBLE_NAV = SECTIONS.flatMap((section) => section.items);

/**
 * 被隐藏入口的路由归属仍保留，直接访问时顶部模块会正确高亮。
 * 这让隐藏项可以在后续需求中零成本恢复。
 */
const HIDDEN_ROUTE_SECTION: Array<[string, SectionKey]> = [
  ["/ontology", "knowledge"],
  ["/agent-memory", "knowledge"],
  ["/my/recent", "knowledge"],
  ["/my/knowledge", "knowledge"],
  ["/my/favorites", "knowledge"],
  ["/commerce/bench", "commerce"],
  ["/commerce", "commerce"],
  ["/datalake", "capability"],
  ["/audit", "admin"],
];

const FULL_BLEED = new Set([
  "/home",
  "/agent",
  "/collab",
  "/work",
  "/ontology",
  "/connectors",
  "/tables",
  "/commerce/loops",
]);

function routeMatches(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function sectionForPath(pathname: string): SectionKey {
  const visibleHit = SECTIONS.find((section) => (
    section.items.some((item) => routeMatches(pathname, item.key))
  ));
  if (visibleHit) return visibleHit.key;
  const hiddenHit = HIDDEN_ROUTE_SECTION.find(([route]) => routeMatches(pathname, route));
  return hiddenHit?.[1] || "work";
}

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const screens = Grid.useBreakpoint();
  const { mode, toggle } = useThemeMode();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [searchValue, setSearchValue] = useState("");

  useEffect(() => {
    getMe().then((res) => setUser(res.user)).catch(() => setUser(null));
  }, []);

  const handleLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    clearAuthToken();
    nav("/login", { replace: true });
  };

  const activeSectionKey = sectionForPath(loc.pathname);
  const activeSection = SECTIONS.find((section) => section.key === activeSectionKey) || SECTIONS[0];
  const compactSidebar = screens.lg === false || navCollapsed;
  const isFullBleed = FULL_BLEED.has(loc.pathname);

  const selectedKeys = useMemo(() => {
    const ordered = [...ALL_VISIBLE_NAV].sort((a, b) => b.key.length - a.key.length);
    const hit = ordered.find((item) => routeMatches(loc.pathname, item.key));
    return hit ? [hit.key] : [];
  }, [loc.pathname]);

  const userMenu = {
    items: [
      { key: "settings", label: "个人信息", icon: <UserOutlined /> },
      {
        key: "theme",
        label: mode === "dark" ? "浅色模式" : "深色模式",
        icon: mode === "dark" ? <BulbOutlined /> : <MoonOutlined />,
      },
      { type: "divider" as const },
      { key: "logout", label: "退出登录", danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "settings") setSettingsOpen(true);
      if (key === "theme") toggle();
      if (key === "logout") handleLogout();
    },
  };

  const displayName = user?.display_name || user?.username || "未登录";
  const organizationName = user?.organization?.name || "良策科技有限公司";

  const submitSearch = () => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return;
    const target = ALL_VISIBLE_NAV.find((item) => (
      item.label.toLowerCase().includes(query)
      || item.key.toLowerCase().includes(query)
    ));
    if (target) {
      nav(target.key);
      setSearchValue("");
    }
  };

  return (
    <Layout className="app-shell-topnav">
      <Header className="app-topnav">
        <div
          className="app-brand app-topnav-brand"
          onClick={() => nav("/home")}
          role="link"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") nav("/home");
          }}
          title="回到工作台"
        >
          <BrandLogo size={40} className="app-brand-logo" />
          {screens.md !== false ? (
            <span className="app-brand-text">
              良策
              <small>智能协作工作台</small>
            </span>
          ) : null}
        </div>

        {screens.xl !== false ? (
          <button
            type="button"
            className="app-organization-switcher"
            title={organizationName}
            onClick={() => nav("/accounts")}
          >
            <AppstoreOutlined />
            <span>{organizationName}</span>
            <RightOutlined />
          </button>
        ) : null}

        <nav className="app-module-nav" aria-label="一级模块">
          {SECTIONS.map((section) => (
            <button
              key={section.key}
              type="button"
              className={section.key === activeSectionKey ? "is-active" : ""}
              aria-current={section.key === activeSectionKey ? "page" : undefined}
              onClick={() => nav(section.defaultPath)}
            >
              {section.label}
            </button>
          ))}
        </nav>

        {screens.xl !== false ? (
          <Input
            className="app-global-search"
            value={searchValue}
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索功能、知识、应用…"
            onChange={(event) => setSearchValue(event.target.value)}
            onPressEnter={submitSearch}
            aria-label="全局功能搜索"
          />
        ) : null}

        <Space className="app-topnav-actions" size={4}>
          {screens.md !== false ? (
            <Tooltip title="帮助中心">
              <Button
                type="text"
                className="app-topnav-icon"
                icon={<QuestionCircleOutlined />}
                aria-label="帮助中心"
              />
            </Tooltip>
          ) : null}
          <Tooltip title="个人设置">
            <Button
              type="text"
              className="app-topnav-icon"
              icon={<SettingOutlined />}
              aria-label="个人设置"
              onClick={() => setSettingsOpen(true)}
            />
          </Tooltip>
          {user ? <CollabUnreadBell enabled /> : null}
          <Dropdown menu={userMenu} placement="bottomRight" trigger={["click"]}>
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
              {screens.sm !== false ? (
                <span className="app-topnav-user-copy">
                  <Typography.Text className="app-topnav-username">{displayName}</Typography.Text>
                  <small>{user?.organization?.roleLabel || "成员"}</small>
                </span>
              ) : null}
            </button>
          </Dropdown>
        </Space>
      </Header>

      {user ? <MeetingInviteAlert enabled /> : null}

      <UserSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(nextUser) => setUser(nextUser)}
      />

      <Layout className="app-layout-body">
        <Sider
          className="app-module-sidebar"
          width={216}
          collapsedWidth={72}
          collapsed={compactSidebar}
          theme="light"
          trigger={null}
        >
          <div className="app-module-sidebar-head">
            <span className="app-module-sidebar-icon">{activeSection.icon}</span>
            {!compactSidebar ? (
              <span>
                <small>{activeSection.eyebrow}</small>
                <strong>{activeSection.label}模块</strong>
              </span>
            ) : null}
          </div>

          <Menu
            className="app-module-sidebar-menu"
            mode="inline"
            inlineCollapsed={compactSidebar}
            selectedKeys={selectedKeys}
            items={activeSection.items.map((item) => ({
              key: item.key,
              icon: item.icon,
              label: item.label,
              title: item.label,
            }))}
            onClick={({ key }) => nav(String(key))}
          />

          {screens.lg !== false ? (
            <button
              type="button"
              className="app-module-sidebar-collapse"
              onClick={() => setNavCollapsed((value) => !value)}
              aria-label={navCollapsed ? "展开导航" : "收起导航"}
            >
              {navCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              {!navCollapsed ? <span>收起导航</span> : null}
              {!navCollapsed ? <LeftOutlined /> : null}
            </button>
          ) : null}
        </Sider>

        <Content className={isFullBleed ? "app-content-bleed" : "app-content-padded"}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
