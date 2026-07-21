import { App, Avatar, Button, Dropdown, Grid, Input, Layout, Menu, Space, Tooltip, Typography } from "antd";
import {
  ApartmentOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BankOutlined,
  BookOutlined,
  BulbOutlined,
  CheckOutlined,
  CheckSquareOutlined,
  CommentOutlined,
  ContactsOutlined,
  DownOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  FlagOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import UserSettingsModal from "./UserSettingsModal";
import BrandLogo from "./BrandLogo";
import CollabUnreadBell from "./CollabUnreadBell";
import MeetingInviteAlert from "./MeetingInviteAlert";
import { brand } from "../theme/brand";
import { useThemeMode } from "../theme/mode";
import {
  clearAuthToken,
  getAuthToken,
  getMe,
  listOrganizations,
  logout,
  switchCurrentOrganization,
  type AuthUser,
  type OrganizationSummary,
} from "../api/client";

const { Header, Content, Sider } = Layout;

type NavItem = {
  key: string;
  path: string;
  icon: ReactNode;
  label: string;
  keywords?: string;
};
type NavGroup = { key: string; label: string; items: NavItem[] };
type SectionKey = "work" | "knowledge" | "commerce" | "admin";
type NavSection = {
  key: SectionKey;
  label: string;
  description: string;
  sidebarTitle: string;
  eyebrow: string;
  icon: ReactNode;
  defaultPath: string;
  groups: NavGroup[];
};

/** 仅控制菜单可见性；所有路由和功能仍在 App.tsx 中保留。 */
const WORK_GROUPS: NavGroup[] = [
  {
    key: "team-collaboration",
    label: "团队协作",
    items: [
      { key: "collab-messages", path: "/collab", icon: <CommentOutlined />, label: "消息", keywords: "聊天 会话 群聊" },
      { key: "collab-contacts", path: "/collab?panel=contacts", icon: <ContactsOutlined />, label: "通讯录", keywords: "成员 联系人" },
      { key: "collab-roundtable", path: "/collab?view=roundtable", icon: <TeamOutlined />, label: "圆桌会议", keywords: "会议 总结" },
    ],
  },
  {
    key: "task-execution",
    label: "任务与待办",
    items: [
      { key: "task-center", path: "/work", icon: <FlagOutlined />, label: "任务中心", keywords: "任务" },
      { key: "task-todos", path: "/work?tab=todos", icon: <CheckSquareOutlined />, label: "待办", keywords: "清单" },
      { key: "task-templates", path: "/work?tab=templates", icon: <FileTextOutlined />, label: "模板中心", keywords: "模版 技能" },
      { key: "task-automation", path: "/work?tab=automation", icon: <PlayCircleOutlined />, label: "自动化", keywords: "流程" },
    ],
  },
  {
    key: "workspace-tools",
    label: "工作工具",
    items: [
      { key: "work-overview", path: "/home", icon: <HomeOutlined />, label: "工作概览", keywords: "工作台 首页" },
      { key: "work-connectors", path: "/connectors", icon: <ApiOutlined />, label: "连接管理", keywords: "连接器 MCP 企业微信" },
    ],
  },
];

const KNOWLEDGE_GROUPS: NavGroup[] = [
  {
    key: "knowledge-assets",
    label: "知识资产",
    items: [
      { key: "knowledge-library", path: "/knowledge", icon: <BookOutlined />, label: "知识库", keywords: "内容 文档" },
    ],
  },
  {
    key: "knowledge-capabilities",
    label: "能力复用",
    items: [
      { key: "knowledge-skills", path: "/skills", icon: <ThunderboltOutlined />, label: "技能中心", keywords: "技能 模板" },
    ],
  },
];

const COMMERCE_GROUPS: NavGroup[] = [
  {
    key: "commerce-insight",
    label: "业务经营",
    items: [
      { key: "commerce-loops", path: "/commerce/loops", icon: <SyncOutlined />, label: "经营回路", keywords: "经营 分析" },
    ],
  },
];

const ADMIN_GROUPS: NavGroup[] = [
  {
    key: "organization-admin",
    label: "组织与配置",
    items: [
      { key: "admin-accounts", path: "/accounts", icon: <UserOutlined />, label: "账号管理", keywords: "成员 组织 权限" },
      { key: "admin-agents", path: "/agents", icon: <ApartmentOutlined />, label: "对象管理", keywords: "Agent 对象" },
    ],
  },
];

/** 仅超级管理员可见 */
const LOGS_NAV: NavItem = { key: "admin-logs", path: "/logs", icon: <FileSearchOutlined />, label: "系统日志" };

const SECTIONS: NavSection[] = [
  {
    key: "work",
    label: "工作区",
    description: "协同与执行",
    sidebarTitle: "协作工作区",
    eyebrow: "WORKSPACE",
    icon: <HomeOutlined />,
    defaultPath: "/collab",
    groups: WORK_GROUPS,
  },
  {
    key: "knowledge",
    label: "知识",
    description: "内容与技能",
    sidebarTitle: "知识与能力",
    eyebrow: "KNOWLEDGE",
    icon: <BookOutlined />,
    defaultPath: "/knowledge",
    groups: KNOWLEDGE_GROUPS,
  },
  {
    key: "commerce",
    label: "经营",
    description: "流程与洞察",
    sidebarTitle: "经营分析",
    eyebrow: "OPERATIONS",
    icon: <ShopOutlined />,
    defaultPath: "/commerce/loops",
    groups: COMMERCE_GROUPS,
  },
  {
    key: "admin",
    label: "管理",
    description: "组织与配置",
    sidebarTitle: "组织管理",
    eyebrow: "ADMINISTRATION",
    icon: <SettingOutlined />,
    defaultPath: "/accounts",
    groups: ADMIN_GROUPS,
  },
];

const ALL_VISIBLE_NAV = SECTIONS.flatMap((section) => section.groups.flatMap((group) => group.items));

/**
 * 被隐藏入口的路由归属仍保留，直接访问时顶部模块会正确高亮。
 * 这让隐藏项可以在后续需求中零成本恢复。
 */
const HIDDEN_ROUTE_SECTION: Array<[string, SectionKey]> = [
  ["/agent", "work"],
  ["/ontology", "knowledge"],
  ["/agent-memory", "knowledge"],
  ["/my/recent", "knowledge"],
  ["/my/knowledge", "knowledge"],
  ["/my/favorites", "knowledge"],
  ["/commerce/bench", "commerce"],
  ["/commerce", "commerce"],
  ["/datalake", "work"],
  ["/audit", "admin"],
  ["/logs", "admin"],
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

function sectionForLocation(pathname: string): SectionKey {
  if (pathname === "/skills") return "knowledge";
  const visibleHit = SECTIONS.find((section) => (
    section.groups.some((group) => group.items.some((item) => routeMatches(pathname, item.path.split("?")[0])))
  ));
  if (visibleHit) return visibleHit.key;
  const hiddenHit = HIDDEN_ROUTE_SECTION.find(([route]) => routeMatches(pathname, route));
  return hiddenHit?.[1] || "work";
}

function navKeyForLocation(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  if (pathname === "/collab") {
    if (params.get("view") === "roundtable" || params.has("meeting")) return "collab-roundtable";
    if (params.get("panel") === "contacts") return "collab-contacts";
    return "collab-messages";
  }
  if (pathname === "/work") {
    if (params.get("tab") === "todos") return "task-todos";
    if (params.get("tab") === "templates") return "task-templates";
    if (params.get("tab") === "automation") return "task-automation";
    return "task-center";
  }
  if (pathname === "/skills") {
    return "knowledge-skills";
  }
  const ordered = [...ALL_VISIBLE_NAV, LOGS_NAV]
    .sort((a, b) => b.path.split("?")[0].length - a.path.split("?")[0].length);
  return ordered.find((item) => routeMatches(pathname, item.path.split("?")[0]))?.key;
}

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const screens = Grid.useBreakpoint();
  const { message } = App.useApp();
  const { mode, toggle } = useThemeMode();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(232);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const lastOpenSidebarWidthRef = useRef(232);
  const mobileSubnavRef = useRef<HTMLElement | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [switchingOrganizationId, setSwitchingOrganizationId] = useState<number | null>(null);

  useEffect(() => {
    getMe()
      .then((res) => {
        setUser(res.user);
        void listOrganizations()
          .then((organizationResponse) => setOrganizations(organizationResponse.results || []))
          .catch(() => setOrganizations([]));
      })
      .catch(() => setUser(null));
  }, []);

  const handleLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    clearAuthToken();
    nav("/login", { replace: true });
  };

  const activeSectionKey = sectionForLocation(loc.pathname);
  const activeSection = SECTIONS.find((section) => section.key === activeSectionKey) || SECTIONS[0];
  const compactSidebar = screens.lg === false || navCollapsed;
  const sidebarHeaderMode = compactSidebar || sidebarWidth < 148
    ? "collapsed"
    : sidebarWidth < 224
      ? "compact"
      : "full";
  const isFullBleed = FULL_BLEED.has(loc.pathname);

  const selectedKeys = useMemo(() => {
    const key = navKeyForLocation(loc.pathname, loc.search);
    if (key === LOGS_NAV.key && !user?.is_superuser) return [];
    return key ? [key] : [];
  }, [loc.pathname, loc.search, user?.is_superuser]);

  useEffect(() => {
    if (screens.lg !== false) return;
    const activeItem = mobileSubnavRef.current?.querySelector<HTMLElement>(".is-active");
    if (!activeItem) return;
    window.requestAnimationFrame(() => {
      activeItem.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    });
  }, [screens.lg, selectedKeys]);

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

  const handleOrganizationSwitch = useCallback(async (organizationId: number) => {
    if (switchingOrganizationId || organizationId === user?.organization?.id) return;
    setSwitchingOrganizationId(organizationId);
    try {
      const result = await switchCurrentOrganization(organizationId);
      setUser(result.user);
      setOrganizations((previous) => previous.map((organization) => ({
        ...organization,
        isCurrent: organization.id === organizationId,
      })));
      message.success(`已切换到 ${result.organization.name}`);
      window.setTimeout(() => window.location.reload(), 220);
    } catch (error: any) {
      message.error(error?.response?.data?.error || "切换企业失败");
      setSwitchingOrganizationId(null);
    }
  }, [message, switchingOrganizationId, user?.organization?.id]);

  const organizationMenu = useMemo(() => ({
    items: [
      {
        key: "organization-list",
        type: "group" as const,
        label: "切换企业",
        children: (organizations.length ? organizations : [{
          id: user?.organization?.id || 0,
          name: organizationName,
          isCurrent: true,
          role: user?.organization?.role || "member",
        } as OrganizationSummary]).map((organization) => ({
          key: `organization-${organization.id}`,
          icon: organization.isCurrent || organization.id === user?.organization?.id
            ? <CheckOutlined />
            : <BankOutlined />,
          label: (
            <span className="app-organization-menu-item">
              <span>
                <strong>{organization.name}</strong>
                <small>{organization.isCurrent || organization.id === user?.organization?.id ? "当前企业" : "点击切换"}</small>
              </span>
            </span>
          ),
          disabled: Boolean(switchingOrganizationId),
        })),
      },
      { type: "divider" as const },
      { key: "manage-organizations", icon: <SettingOutlined />, label: "企业与成员管理" },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "manage-organizations") {
        nav("/accounts");
        return;
      }
      const organizationId = Number(key.replace("organization-", ""));
      if (organizationId) void handleOrganizationSwitch(organizationId);
    },
  }), [handleOrganizationSwitch, nav, organizationName, organizations, switchingOrganizationId, user?.organization?.id, user?.organization?.role]);

  const toggleSidebar = useCallback(() => {
    setNavCollapsed((collapsed) => {
      if (collapsed) setSidebarWidth(Math.max(196, lastOpenSidebarWidthRef.current));
      else lastOpenSidebarWidthRef.current = sidebarWidth;
      return !collapsed;
    });
  }, [sidebarWidth]);

  const beginSidebarResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (screens.lg === false) return;
    event.preventDefault();
    const resizeHandle = event.currentTarget;
    const pointerId = event.pointerId;
    try { resizeHandle.setPointerCapture(pointerId); } catch { /* 浏览器不支持时继续用 window 监听 */ }
    const startX = event.clientX;
    const startWidth = navCollapsed ? 76 : sidebarWidth;
    let latestWidth = startWidth;
    setSidebarResizing(true);
    if (navCollapsed) {
      setNavCollapsed(false);
      setSidebarWidth(76);
    }

    const handleMove = (moveEvent: PointerEvent) => {
      latestWidth = Math.max(76, Math.min(320, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(latestWidth);
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      try {
        if (resizeHandle.hasPointerCapture(pointerId)) resizeHandle.releasePointerCapture(pointerId);
      } catch { /* 指针已由浏览器释放 */ }
      setSidebarResizing(false);
      if (latestWidth < 168) {
        setNavCollapsed(true);
        setSidebarWidth(lastOpenSidebarWidthRef.current);
      } else {
        const settledWidth = Math.max(196, latestWidth);
        lastOpenSidebarWidthRef.current = settledWidth;
        setSidebarWidth(settledWidth);
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    window.addEventListener("pointercancel", handleUp, { once: true });
  }, [navCollapsed, screens.lg, sidebarWidth]);

  const resizeSidebarFromKeyboard = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleSidebar();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    if (navCollapsed && event.key === "ArrowRight") {
      setNavCollapsed(false);
      setSidebarWidth(Math.max(196, lastOpenSidebarWidthRef.current));
      return;
    }
    const next = Math.max(168, Math.min(320, sidebarWidth + (event.key === "ArrowRight" ? 16 : -16)));
    if (next <= 168 && event.key === "ArrowLeft") {
      lastOpenSidebarWidthRef.current = sidebarWidth;
      setNavCollapsed(true);
      return;
    }
    setSidebarWidth(next);
    lastOpenSidebarWidthRef.current = next;
  }, [navCollapsed, sidebarWidth, toggleSidebar]);

  const submitSearch = () => {
    const query = searchValue.trim().toLowerCase();
    if (!query) return;
    const target = ALL_VISIBLE_NAV.find((item) => (
      item.label.toLowerCase().includes(query)
      || item.path.toLowerCase().includes(query)
      || item.keywords?.toLowerCase().includes(query)
    ));
    if (target) {
      nav(target.path);
      setSearchValue("");
    }
  };

  return (
    <Layout className="app-shell-topnav">
      <Header className="app-topnav">
        <div
          className="app-brand app-topnav-brand"
          onClick={() => nav("/collab")}
          role="link"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") nav("/collab");
          }}
          title="回到团队协作"
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
          <Dropdown menu={organizationMenu} placement="bottomLeft" trigger={["click"]}>
            <button
              type="button"
              className="app-organization-switcher"
              title={`当前企业：${organizationName}`}
              aria-label={`切换企业，当前为 ${organizationName}`}
              aria-haspopup="menu"
            >
              <span className="app-organization-switcher-icon"><AppstoreOutlined /></span>
              <span className="app-organization-switcher-copy">
                <small>当前企业</small>
                <strong>{organizationName}</strong>
              </span>
              <DownOutlined className="app-organization-switcher-chevron" />
            </button>
          </Dropdown>
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
              <span className="app-module-nav-icon">{section.icon}</span>
              <span className="app-module-nav-copy">
                <strong>{section.label}</strong>
                <small>{section.description}</small>
              </span>
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
        {screens.lg === false ? (
          <nav ref={mobileSubnavRef} className="app-mobile-subnav" aria-label={`${activeSection.label}二级功能`}>
            {activeSection.groups.flatMap((group) => group.items).concat(
              activeSection.key === "admin" && user?.is_superuser ? [LOGS_NAV] : [],
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                className={selectedKeys.includes(item.key) ? "is-active" : ""}
                onClick={() => nav(item.path)}
                aria-current={selectedKeys.includes(item.key) ? "page" : undefined}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        ) : null}

        <Sider
          className={`app-module-sidebar${compactSidebar ? " is-collapsed" : ""}${sidebarResizing ? " is-resizing" : ""}`}
          width={sidebarWidth}
          collapsedWidth={76}
          collapsed={compactSidebar}
          theme="light"
          trigger={null}
        >
          <div className={`app-module-sidebar-head is-${sidebarHeaderMode}`}>
            {sidebarHeaderMode !== "collapsed" ? (
              <>
                <span className="app-module-sidebar-icon">{activeSection.icon}</span>
                <span className="app-module-sidebar-title">
                  {sidebarHeaderMode === "full" ? <small>{activeSection.eyebrow}</small> : null}
                  <strong title={activeSection.sidebarTitle}>
                    {sidebarHeaderMode === "compact" ? activeSection.label : activeSection.sidebarTitle}
                  </strong>
                </span>
              </>
            ) : null}
            {screens.lg !== false ? (
              <Tooltip title={navCollapsed ? "展开导航" : "收起导航"} placement="right">
                <button
                  type="button"
                  className="app-module-sidebar-collapse"
                  onClick={toggleSidebar}
                  aria-label={navCollapsed ? "展开导航" : "收起导航"}
                  aria-expanded={!navCollapsed}
                >
                  {navCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                </button>
              </Tooltip>
            ) : null}
          </div>

          <Menu
            className="app-module-sidebar-menu"
            mode="inline"
            inlineCollapsed={compactSidebar}
            selectedKeys={selectedKeys}
            items={(compactSidebar
              ? activeSection.groups.flatMap((group) => group.items).concat(
                  activeSection.key === "admin" && user?.is_superuser ? [LOGS_NAV] : [],
                ).map((item) => ({
                  key: item.key,
                  icon: item.icon,
                  label: item.label,
                  title: item.label,
                }))
              : activeSection.groups.map((group) => ({
                  key: `group-${group.key}`,
                  type: "group" as const,
                  label: group.label,
                  children: group.items.map((item) => ({
                    key: item.key,
                    icon: item.icon,
                    label: item.label,
                    title: item.label,
                  })),
                })).concat(
                  activeSection.key === "admin" && user?.is_superuser
                    ? [{
                        key: "group-system",
                        type: "group" as const,
                        label: "系统",
                        children: [{
                          key: LOGS_NAV.key,
                          icon: LOGS_NAV.icon,
                          label: LOGS_NAV.label,
                          title: LOGS_NAV.label,
                        }],
                      }]
                    : [],
                ))}
            onClick={({ key }) => {
              const target = [...ALL_VISIBLE_NAV, LOGS_NAV].find((item) => item.key === key);
              if (target) nav(target.path);
            }}
          />

          {screens.lg !== false ? (
            <div
              className="app-module-sidebar-resizer"
              role="separator"
              aria-label="拖拽调整左侧导航宽度"
              aria-orientation="vertical"
              aria-valuemin={76}
              aria-valuemax={320}
              aria-valuenow={compactSidebar ? 76 : Math.round(sidebarWidth)}
              tabIndex={0}
              onPointerDown={beginSidebarResize}
              onDoubleClick={toggleSidebar}
              onKeyDown={resizeSidebarFromKeyboard}
            >
              <span aria-hidden="true" />
            </div>
          ) : null}
        </Sider>

        <Content className={isFullBleed ? "app-content-bleed" : "app-content-padded"}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
