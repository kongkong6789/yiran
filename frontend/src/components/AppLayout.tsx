import { Layout, Menu, Grid } from "antd";
import {
  ApartmentOutlined,
  RobotOutlined,
  DatabaseOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  CommentOutlined,
  ShareAltOutlined,
  HomeOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

const { Header, Sider, Content } = Layout;

type NavItem = { key: string; icon: ReactNode; label: string };

const NAV: NavItem[] = [
  { key: "/home", icon: <HomeOutlined />, label: "首页" },
  { key: "/architecture", icon: <ApartmentOutlined />, label: "架构总览" },
  { key: "/agents", icon: <TeamOutlined />, label: "对象管理" },
  { key: "/ontology", icon: <ShareAltOutlined />, label: "本体图谱" },
  { key: "/loops", icon: <SyncOutlined />, label: "Loops 回路" },
  { key: "/council", icon: <CommentOutlined />, label: "圆桌会议" },
  { key: "/console", icon: <RobotOutlined />, label: "Agent 控制台" },
  { key: "/datalake", icon: <DatabaseOutlined />, label: "数据底座" },
  { key: "/audit", icon: <SafetyCertificateOutlined />, label: "闸机审计" },
];

const menuItems = [
  { type: "group" as const, label: "总览", children: NAV.slice(0, 2) },
  { type: "group" as const, label: "构建", children: NAV.slice(2, 5) },
  { type: "group" as const, label: "运行", children: NAV.slice(5, 7) },
  { type: "group" as const, label: "数据与治理", children: NAV.slice(7) },
];

export default function AppLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const screens = Grid.useBreakpoint();
  const current = NAV.find((n) => n.key === loc.pathname);
  const isHome = loc.pathname === "/home";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="dark" breakpoint="lg" collapsedWidth="0" width={220}
        style={{ borderRight: "1px solid #1c1f2e" }}>
        <div className="app-brand" onClick={() => nav("/home")}>
          <span className="app-brand-mark">良</span>
          <span className="app-brand-text">
            良策 AI<small>Agent 执行平台</small>
          </span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[loc.pathname]}
          items={menuItems}
          onClick={(e) => nav(e.key)}
          style={{ background: "transparent", borderInlineEnd: "none" }}
        />
      </Sider>
      <Layout style={{ minWidth: 0 }}>
        <Header className="app-header">
          <div className="app-header-title">
            {current?.icon}
            <span>{current?.label ?? "工作台"}</span>
          </div>
          {screens.md && (
            <div className="app-header-sub">Daily LLM Wiki · 多智能体决策 · 安全闸机执行</div>
          )}
        </Header>
        <Content
          style={
            isHome
              ? { minWidth: 0 }
              : { margin: 16, minWidth: 0, overflow: "auto" }
          }
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
