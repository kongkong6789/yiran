import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Drawer, Tag, Button, Space, Typography, message, Tooltip,
  Form, Input, Switch, Empty, Segmented, Skeleton, Alert,
} from "antd";
import {
  AccountBookOutlined,
  ShoppingOutlined,
  HddOutlined,
  ApiOutlined,
  CopyOutlined,
  RadarChartOutlined,
  ReloadOutlined,
  SaveOutlined,
  ImportOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import WecomIcon from "./WecomIcon";
import NasFileExplorer from "./NasFileExplorer";
import type { ReactNode } from "react";
import {
  getMcpServers,
  getMcpServer,
  saveMcpServer,
  importMcpServer,
  probeMcpServer,
  type McpServer,
  type McpServerDetail,
} from "../api/client";

const ICONS: Record<string, ReactNode> = {
  wecom: <WecomIcon size={20} />,
  kingdee: <AccountBookOutlined />,
  jackyun: <ShoppingOutlined />,
  nas: <HddOutlined />,
};

const COLORS: Record<string, string> = {
  wecom: "#0082EF",
  kingdee: "#e62e2e",
  jackyun: "#ff6b35",
  nas: "#a78bfa",
};

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  unconfigured: { color: "default", text: "未配置" },
  configured: { color: "processing", text: "已配置" },
  reachable: { color: "success", text: "连接正常" },
  unreachable: { color: "error", text: "无法连接" },
  error: { color: "error", text: "连接异常" },
  disabled: { color: "default", text: "已禁用" },
};

const SOURCE_LABEL: Record<string, string> = {
  personal: "个人配置",
  organization: "企业配置",
  ui: "界面配置",
  env: ".env 默认",
  none: "未配置",
};

const TRANSPORT_LABEL: Record<string, string> = {
  streamable_http: "HTTP",
  sse: "SSE",
  stdio: "本地服务",
  openapi: "开放接口",
};

const WECOM_JSON_TEMPLATE = `{
  "mcpServers": {
    "企业微信文档": {
      "type": "streamable-http",
      "url": "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=你的apikey"
    }
  }
}`;

type Props = {
  variant?: "dock" | "sidebar" | "page";
  title?: string;
};

type FormValues = {
  enabled: boolean;
  nas_path?: string;
  url?: string;
  command?: string;
  args?: string;
  env?: string;
  paste_json?: string;
  // 吉客云
  app_key?: string;
  app_secret?: string;
  base_url?: string;
  method_inventory?: string;
  // 金蝶
  acct_id?: string;
  username?: string;
  password?: string;
  lcid?: string;
};

type StatusFilter = "all" | "configured" | "reachable" | "attention";
type NasDrawerMode = "files" | "settings";
type ConfigInputMode = "direct" | "import";

const LAYER_META: Record<string, { title: string; description: string }> = {
  协作: { title: "协作与文件", description: "企业沟通、共享文件与团队协作" },
  感知: { title: "业务系统", description: "订单、库存、财务等业务数据" },
  终端: { title: "本地工具", description: "本地文件、桌面环境与执行能力" },
};

function mcpStatus(item: Pick<McpServer, "status" | "configured" | "enabled">): McpServer["status"] {
  if (item.status && item.status !== "unconfigured") return item.status;
  if (item.enabled === false) return "disabled";
  return item.configured ? "configured" : "unconfigured";
}

function normalizeServer(item: McpServer): McpServer {
  return { ...item, status: mcpStatus(item) };
}

export default function McpServers({ variant = "dock", title = "MCP 业务接入" }: Props) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<McpServerDetail | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [nasDrawerMode, setNasDrawerMode] = useState<NasDrawerMode>("files");
  const [configInputMode, setConfigInputMode] = useState<ConfigInputMode>("direct");
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(() => {
    setLoading(true);
    getMcpServers()
      .then((d) => setServers((d.results || []).map(normalizeServer)))
      .catch(() => message.error("加载 MCP 服务失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const fillForm = useCallback((d: McpServerDetail) => {
    const ph = d.placeholders || {};
    const nasPath = [...(d.args || [])]
      .reverse()
      .find((value) => value && !value.startsWith("-") && !value.startsWith("@")) || "";
    const native = d.native || {};
    form.setFieldsValue({
      enabled: d.enabled !== false,
      nas_path: d.id === "nas" ? nasPath : "",
      url: d.url || "",
      command: d.command || "",
      args: d.args?.length ? JSON.stringify(d.args) : "",
      env: d.env && Object.keys(d.env).length
        ? JSON.stringify(d.env, null, 2)
        : "",
      paste_json: "",
      app_key: native.app_key || "",
      app_secret: "",
      base_url: native.base_url || ph.base_url || "",
      method_inventory: native.method_inventory || ph.method_inventory || "erp.stockquantity.get",
      acct_id: native.acct_id || ph.acct_id || "",
      username: native.username || "",
      password: "",
      lcid: native.lcid || ph.lcid || "2052",
    });
  }, [form]);

  const applyDetail = (saved: McpServerDetail, id: string) => {
    const normalized = normalizeServer(saved);
    setDetail(saved);
    fillForm(saved);
    setServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...normalized } : s)),
    );
  };

  const openServer = async (id: string) => {
    if (id === "nas") setNasDrawerMode("files");
    setConfigInputMode("direct");
    setOpenId(id);
    try {
      const d = await getMcpServer(id);
      setDetail(d);
      if (id !== "nas") fillForm(d);
    } catch {
      message.error("读取 MCP 配置失败");
      setOpenId(null);
    }
  };

  const doSave = async () => {
    if (!openId) return;
    if (detail?.can_manage === false) {
      message.warning("仅当前企业的所有者或管理员可以修改连接器");
      return;
    }
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (openId === "jackyun" || openId === "kingdee") {
        const native = openId === "jackyun"
          ? {
              app_key: values.app_key?.trim() || "",
              app_secret: values.app_secret?.trim() || "",
              base_url: values.base_url?.trim() || "",
              method_inventory: values.method_inventory?.trim() || "erp.stockquantity.get",
            }
          : {
              base_url: values.base_url?.trim() || "",
              acct_id: values.acct_id?.trim() || "",
              username: values.username?.trim() || "",
              password: values.password?.trim() || "",
              lcid: values.lcid?.trim() || "2052",
            };
        const saved = await saveMcpServer(openId, {
          enabled: values.enabled,
          native,
          ...native,
        });
        applyDetail(saved, openId);
        message.success(`${openId === "jackyun" ? "吉客云" : "金蝶"}配置已保存`);
        return;
      }
      const nasPath = values.nas_path?.trim() || "";
      const saved = await saveMcpServer(openId, {
        enabled: values.enabled,
        url: openId === "nas" ? "" : values.url?.trim() || "",
        command: openId === "nas" ? "npx" : values.command?.trim() || "",
        args: openId === "nas"
          ? JSON.stringify(["-y", "@modelcontextprotocol/server-filesystem", nasPath])
          : values.args?.trim() || "",
        env: openId === "nas" ? "" : values.env?.trim() || "",
      });
      applyDetail(saved, openId);
      if (openId === "nas") {
        setNasDrawerMode("files");
        message.success("NAS 连接设置已保存，正在打开文件库");
      } else {
        message.success("MCP 配置已保存");
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const doImport = async () => {
    if (!openId) return;
    if (detail?.can_manage === false) {
      message.warning("仅当前企业的所有者或管理员可以导入连接器配置");
      return;
    }
    const raw = (form.getFieldValue("paste_json") || "").trim();
    if (!raw) {
      message.warning("请先粘贴 Cursor mcp.json 片段");
      return;
    }
    setImporting(true);
    try {
      const saved = await importMcpServer(openId, raw);
      applyDetail(saved, openId);
      message.success("已从 mcp.json 导入并保存");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "导入失败,请检查 JSON");
    } finally {
      setImporting(false);
    }
  };

  const fillWecomTemplate = () => {
    form.setFieldsValue({ paste_json: WECOM_JSON_TEMPLATE });
    message.info("已填入 JSON Config 模板,请替换 apikey 后点「导入并保存」");
  };

  const copyUrl = async () => {
    const url = (form.getFieldValue("url") || "").trim();
    if (!url) {
      message.warning("请先填写 StreamableHttp URL");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      message.success("已复制 StreamableHttp URL");
    } catch {
      message.error("复制失败");
    }
  };

  const doProbe = async () => {
    if (!openId) return;
    setProbing(true);
    try {
      const res = await probeMcpServer(openId);
      const st = (res.status || "error") as McpServer["status"];
      setServers((prev) =>
        prev.map((s) => (s.id === openId ? { ...s, status: st } : s)),
      );
      if (res.ok) {
        message.success(res.message || "探测成功");
      } else {
        message.warning(res.message || "探测未通过");
      }
    } catch {
      message.error("探测请求失败");
    } finally {
      setProbing(false);
    }
  };

  const copyConfig = async () => {
    if (!detail?.cursor_json) return;
    try {
      await navigator.clipboard.writeText(detail.cursor_json);
      message.success("已复制 Cursor mcp.json 片段");
    } catch {
      message.error("复制失败,请手动选择复制");
    }
  };

  const renderCard = (item: McpServer) => {
    const color = COLORS[item.id] || "#59c2ff";
    const status = mcpStatus(item);
    const st = STATUS_TAG[status] || STATUS_TAG.unconfigured;
    return (
      <button
        key={item.id}
        type="button"
        className="mcp-card"
        onClick={() => openServer(item.id)}
        style={{ "--accent": color } as React.CSSProperties}
      >
        <span className="mcp-card-icon" style={{ color }}>{ICONS[item.id]}</span>
        <b>{item.name}</b>
        <em>{item.desc}</em>
        <span className="mcp-card-meta">
          <Tag
            className={`mcp-status-tag mcp-status-tag--${status}`}
            color={st.color}
            bordered={false}
            style={{ margin: 0, fontSize: 10 }}
          >
            {st.text}
          </Tag>
          <i>{TRANSPORT_LABEL[item.transport] || item.transport}</i>
        </span>
      </button>
    );
  };

  useEffect(() => {
    if (openId === "nas" && detail && nasDrawerMode === "settings") {
      fillForm(detail);
    }
  }, [detail, fillForm, nasDrawerMode, openId]);

  const renderPageCard = (item: McpServer) => {
    const color = COLORS[item.id] || "#59c2ff";
    const status = mcpStatus(item);
    const st = STATUS_TAG[status] || STATUS_TAG.unconfigured;
    const actionLabel = status === "unconfigured"
      ? "开始配置"
      : item.id === "nas"
        ? "打开文件库"
        : "查看设置";
    return (
      <button
        key={item.id}
        type="button"
        className="mcp-card mcp-card--detailed"
        onClick={() => openServer(item.id)}
        style={{ "--accent": color } as React.CSSProperties}
        aria-label={`${actionLabel}${item.name}，当前状态：${st.text}`}
      >
        <span className="mcp-card-icon" style={{ color }}>{ICONS[item.id]}</span>
        <span className="mcp-card-copy">
          <span className="mcp-card-title-row">
            <b>{item.name}</b>
            <Tag
              className={`mcp-status-tag mcp-status-tag--${status}`}
              color={st.color}
              bordered={false}
            >
              {st.text}
            </Tag>
          </span>
          <em>{item.desc}</em>
          <span className="mcp-card-meta">
            <i>{TRANSPORT_LABEL[item.transport] || item.transport}</i>
            <i>{item.tools?.length || 0} 个工具</i>
            {status === "reachable" ? <i className="mcp-card-health"><CheckCircleOutlined /> 已验证</i> : null}
          </span>
        </span>
        <span className="mcp-card-action">
          {actionLabel}
          <ArrowRightOutlined />
        </span>
      </button>
    );
  };

  const renderRow = (item: McpServer) => {
    const color = COLORS[item.id] || "#59c2ff";
    const status = mcpStatus(item);
    const st = STATUS_TAG[status] || STATUS_TAG.unconfigured;
    return (
      <button
        key={item.id}
        type="button"
        className="mcp-sidebar-item"
        onClick={() => openServer(item.id)}
        title={`${item.desc} · ${TRANSPORT_LABEL[item.transport]}`}
      >
        <span className="mcp-icon" style={{ color, borderColor: `${color}55` }}>
          {ICONS[item.id]}
        </span>
        <span className="mcp-name">{item.name}</span>
        <Tag
          className={`mcp-status-tag mcp-status-tag--${status}`}
          color={st.color}
          bordered={false}
          style={{ margin: 0, fontSize: 10, lineHeight: "16px" }}
        >
          {st.text}
        </Tag>
      </button>
    );
  };

  const isWecom = openId === "wecom";
  const isNas = openId === "nas";
  const isJackyun = openId === "jackyun";
  const isKingdee = openId === "kingdee";
  const isNativeOpenApi = isJackyun || isKingdee;
  const showStdio = !isWecom && !isNativeOpenApi && (detail?.declared_transport === "stdio" || detail?.transport === "stdio");
  const showUrl = !isWecom && !isNativeOpenApi && (
    detail?.declared_transport === "streamable_http"
    || detail?.declared_transport === "sse"
    || !!detail?.url
  );
  const ph = detail?.placeholders || {};

  const configuredCount = servers.filter((s) => mcpStatus(s) === "configured" || mcpStatus(s) === "reachable").length;
  const reachableCount = servers.filter((s) => mcpStatus(s) === "reachable").length;
  const attentionCount = servers.filter((s) => !["configured", "reachable"].includes(mcpStatus(s))).length;
  const filteredServers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return servers.filter((server) => {
      const status = mcpStatus(server);
      const statusMatched = statusFilter === "all"
        || (statusFilter === "configured" && ["configured", "reachable"].includes(status))
        || (statusFilter === "reachable" && status === "reachable")
        || (statusFilter === "attention" && !["configured", "reachable"].includes(status));
      const queryMatched = !keyword
        || `${server.name} ${server.desc} ${server.layer} ${server.transport}`.toLowerCase().includes(keyword);
      return statusMatched && queryMatched;
    });
  }, [query, servers, statusFilter]);
  const layerOrder = ["协作", "感知", "终端"];
  const layers = [
    ...layerOrder.filter((l) => filteredServers.some((s) => s.layer === l)),
    ...Array.from(new Set(filteredServers.map((s) => s.layer).filter((l) => !layerOrder.includes(l)))),
  ];

  return (
    <>
      {variant === "sidebar" ? (
        <div className="mcp-sidebar">
          <div className="mcp-sidebar-head">
            <span>{title}</span>
            <Tooltip title="刷新">
              <Button type="text" size="small" icon={<ReloadOutlined />} loading={loading} onClick={load} />
            </Tooltip>
          </div>
          {servers.map(renderRow)}
        </div>
      ) : variant === "page" ? (
        <section className="connectors-board">
          <div className="connectors-board-head">
            <div>
              <Typography.Text className="connectors-section-eyebrow">业务系统与资源</Typography.Text>
              <Typography.Title level={4}>{title}</Typography.Title>
              <Typography.Text type="secondary">
                连接共享文件、经营系统和外部服务。打开卡片后完成设置，并在使用前检查连接状态。
              </Typography.Text>
            </div>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新状态</Button>
          </div>

          <div className="connectors-stats">
            <button
              type="button"
              className={`connectors-stat${statusFilter === "all" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              <b>{servers.length}</b>
              <span>全部连接</span>
            </button>
            <button
              type="button"
              className={`connectors-stat${statusFilter === "configured" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("configured")}
            >
              <b>{configuredCount}</b>
              <span>配置完成</span>
            </button>
            <button
              type="button"
              className={`connectors-stat${statusFilter === "reachable" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("reachable")}
            >
              <b>{reachableCount}</b>
              <span>连接正常</span>
            </button>
            <button
              type="button"
              className={`connectors-stat connectors-stat--attention${statusFilter === "attention" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("attention")}
            >
              <b>{attentionCount}</b>
              <span>需要处理</span>
            </button>
          </div>

          <div className="connectors-toolbar">
            <Input
              allowClear
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              prefix={<SearchOutlined />}
              placeholder="搜索连接器、用途或接入方式"
              aria-label="搜索企业连接器"
            />
            <Segmented
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              options={[
                { label: "全部", value: "all" },
                { label: "配置完成", value: "configured" },
                { label: "连接正常", value: "reachable" },
                { label: "需要处理", value: "attention" },
              ]}
            />
            <Typography.Text type="secondary">{filteredServers.length} 个结果</Typography.Text>
          </div>

          {loading && !servers.length ? (
            <div className="connectors-loading" aria-label="正在加载业务连接器">
              <Skeleton active paragraph={{ rows: 4 }} />
            </div>
          ) : filteredServers.length ? (
            <div className="connectors-layers">
              {layers.map((layer) => {
                const items = filteredServers.filter((s) => s.layer === layer);
                if (!items.length) return null;
                return (
                  <div key={layer} className="connectors-layer">
                    <div className="connectors-layer-head">
                      <div>
                        <Typography.Title level={5} className="connectors-layer-title">
                          {LAYER_META[layer]?.title || layer}
                        </Typography.Title>
                        <Typography.Text type="secondary">
                          {LAYER_META[layer]?.description || "外部业务系统与能力服务"}
                        </Typography.Text>
                      </div>
                      <Typography.Text type="secondary">{items.length} 个连接</Typography.Text>
                    </div>
                    <div className="mcp-dock-grid connectors-grid">
                      {items.map(renderPageCard)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="connectors-empty">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有符合当前条件的连接器"
              >
                <Button onClick={() => { setQuery(""); setStatusFilter("all"); }}>清除筛选</Button>
              </Empty>
            </div>
          )}
        </section>
      ) : (
        <section className="mcp-dock">
          <div className="mcp-dock-head">
            <h3><ApiOutlined /> {title}</h3>
            <Space size={8}>
              <span>Model Context Protocol · 前端可填可存</span>
              <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={load}>
                刷新
              </Button>
            </Space>
          </div>
          <div className="mcp-dock-grid">
            {servers.map(renderCard)}
          </div>
        </section>
      )}

      <Drawer
        title={detail ? (isNas ? (
          <span className="nas-drawer-title">
            <HddOutlined />
            {nasDrawerMode === "files" ? "NAS 文件库" : "设置 NAS 文件库"}
          </span>
        ) : isNativeOpenApi ? `${detail.name} · 连接配置` : `${detail.name} · MCP 配置`) : "连接配置"}
        open={!!openId}
        onClose={() => {
          setOpenId(null);
          setDetail(null);
          setNasDrawerMode("files");
          setConfigInputMode("direct");
          form.resetFields();
        }}
        width={isNas ? "min(1180px, calc(100vw - 24px))" : 560}
        className={isNas ? `nas-explorer-drawer nas-explorer-drawer--${nasDrawerMode}` : "mcp-config-drawer"}
        extra={
          detail && isNas && nasDrawerMode === "files" ? (
            <Space>
              <Button icon={<RadarChartOutlined />} loading={probing} onClick={doProbe}>检查连接</Button>
              <Button type="primary" onClick={() => setNasDrawerMode("settings")}>连接设置</Button>
            </Space>
          ) : detail && isNas ? (
            <Space>
              <Button onClick={() => setNasDrawerMode("files")}>
                {detail.configured ? "返回文件库" : "取消"}
              </Button>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={detail.can_manage === false} onClick={doSave}>
                保存并打开
              </Button>
            </Space>
          ) : detail ? (
            <Button
              type="primary"
              icon={configInputMode === "import" ? <ImportOutlined /> : <SaveOutlined />}
              loading={configInputMode === "import" ? importing : saving}
              disabled={detail.can_manage === false}
              onClick={configInputMode === "import" ? doImport : doSave}
            >
              {configInputMode === "import" ? "导入并保存" : "保存"}
            </Button>
          ) : null
        }
      >
        {detail && isNas && nasDrawerMode === "files" ? (
          <NasFileExplorer
            configured={detail.configured}
            enabled={detail.enabled}
            onOpenSettings={() => setNasDrawerMode("settings")}
          />
        ) : detail && (
          <div className={`mcp-config-shell${isNas ? " nas-settings-panel" : ""}`}>
            <Form form={form} layout="vertical" requiredMark={false} className="mcp-config-form" disabled={detail.can_manage === false}>
              <section className="mcp-config-summary">
                <span
                  className="mcp-config-summary-icon"
                  style={{ "--accent": COLORS[detail.id] || "#315efb" } as React.CSSProperties}
                >
                  {ICONS[detail.id] || <ApiOutlined />}
                </span>
                <div className="mcp-config-summary-copy">
                  <strong>{isNas ? "企业 NAS 文件库" : detail.name}</strong>
                  <span>{isNas ? "连接企业共享目录，用于浏览、检索和引用文件" : detail.desc}</span>
                  <small>
                    {isNas
                      ? "企业级配置 · Windows 网络路径"
                      : `${detail.layer} · ${TRANSPORT_LABEL[detail.transport] || detail.transport} · ${SOURCE_LABEL[detail.config_source] || detail.config_source}`}
                  </small>
                </div>
                <span className="mcp-config-enable">
                  <span>{isNas ? "启用文件库" : "启用"}</span>
                  <Form.Item name="enabled" valuePropName="checked" noStyle>
                    <Switch aria-label={`启用${detail.name}`} />
                  </Form.Item>
                </span>
              </section>

              <Alert
                type={isNas || detail.can_manage === false ? "info" : "success"}
                showIcon
                message={isNas
                  ? (detail.can_manage === false
                    ? "此文件库由企业管理员统一维护"
                    : `配置仅对「${detail.organization_name || "当前企业"}」生效`)
                  : `当前企业：${detail.organization_name || "未加入企业"}`}
                description={isNas
                  ? (detail.can_manage === false
                    ? "你可以使用该文件库，但不能修改连接设置。"
                    : "切换企业后，将自动加载对应企业的文件库配置。")
                  : (detail.can_manage === false
                    ? "该连接由企业管理员统一维护，你可以使用但不能修改。"
                    : "此处保存的连接配置只对当前企业生效，切换企业后会加载对应企业的配置。")}
              />

              {!!detail.hints?.length && (
                <details className="mcp-config-help">
                  <summary>
                    <span>{isWecom ? "企业微信配置说明" : "配置说明"}</span>
                    <small>{detail.hints.length} 条</small>
                  </summary>
                  <ul>
                    {detail.hints.map((hint) => <li key={hint}>{hint}</li>)}
                  </ul>
                </details>
              )}

              {!isNas && !isNativeOpenApi && (
                <div className="mcp-config-modebar">
                  <Segmented<ConfigInputMode>
                    value={configInputMode}
                    onChange={setConfigInputMode}
                    options={[
                      { value: "direct", label: isWecom ? "连接地址" : "直接配置" },
                      { value: "import", label: "JSON 导入" },
                    ]}
                  />
                  <Button size="small" type="text" icon={<RadarChartOutlined />} loading={probing} onClick={doProbe}>
                    检查连接
                  </Button>
                </div>
              )}

              {isNativeOpenApi && (
                <div className="mcp-config-modebar">
                  <Typography.Text type="secondary">OpenAPI 企业配置</Typography.Text>
                  <Button size="small" type="text" icon={<RadarChartOutlined />} loading={probing} onClick={doProbe}>
                    检查连接
                  </Button>
                </div>
              )}

              {isNas ? (
                <section className="mcp-config-section">
                  <div className="mcp-config-section-head">
                    <div>
                      <strong>共享目录</strong>
                      <span>填写可访问的 UNC 网络路径或本机绝对路径。</span>
                    </div>
                  </div>
                  <Form.Item
                    label="目录路径"
                    name="nas_path"
                    rules={[
                      { required: true, whitespace: true, message: "请输入共享目录路径" },
                      {
                        validator: (_, value?: string) => {
                          const path = value?.trim() || "";
                          const valid = /^\\\\[^\\]+/.test(path) || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/");
                          return valid
                            ? Promise.resolve()
                            : Promise.reject(new Error("请输入 UNC 网络路径、本机盘符路径或绝对目录"));
                        },
                      },
                    ]}
                  >
                    <Input
                      size="large"
                      placeholder={String.raw`例如：\\192.168.0.188\共享文件夹`}
                      allowClear
                      autoFocus
                    />
                  </Form.Item>
                  <p className="mcp-config-note">
                    访问权限取决于运行良策服务的 Windows 账户。保存前，请先在资源管理器中确认该目录可以打开。
                  </p>
                </section>
              ) : isJackyun ? (
                <section className="mcp-config-section">
                  <div className="mcp-config-section-head">
                    <div>
                      <strong>吉客云开放平台</strong>
                      <span>AppKey / AppSecret 按当前企业保存</span>
                    </div>
                  </div>
                  <Form.Item label="AppKey" name="app_key" rules={[{ required: true, message: "请填写 AppKey" }]}>
                    <Input placeholder={ph.app_key || "开放平台 AppKey"} allowClear />
                  </Form.Item>
                  <Form.Item
                    label="AppSecret"
                    name="app_secret"
                    extra={detail.native?.app_secret_set ? "已保存密钥；留空则保持不变" : "请填写 AppSecret"}
                  >
                    <Input.Password placeholder={detail.native?.app_secret_set ? "******（留空保持不变）" : (ph.app_secret || "开放平台 AppSecret")} />
                  </Form.Item>
                  <Form.Item label="OpenAPI 地址" name="base_url">
                    <Input placeholder={ph.base_url || "https://open.jackyun.com/open/openapi/do"} allowClear />
                  </Form.Item>
                  <Form.Item label="库存方法" name="method_inventory">
                    <Input placeholder={ph.method_inventory || "erp.stockquantity.get"} allowClear />
                  </Form.Item>
                </section>
              ) : isKingdee ? (
                <section className="mcp-config-section">
                  <div className="mcp-config-section-head">
                    <div>
                      <strong>金蝶云星空 K3Cloud</strong>
                      <span>地址 / 账套 / 账号 / LCID 可在此手动配置</span>
                    </div>
                  </div>
                  <Form.Item label="服务器地址" name="base_url" rules={[{ required: true, message: "请填写 K3Cloud 地址" }]}>
                    <Input placeholder={ph.base_url || "http://159.75.104.61/k3cloud"} allowClear />
                  </Form.Item>
                  <Form.Item label="账套 ID" name="acct_id" rules={[{ required: true, message: "请填写账套 ID" }]}>
                    <Input placeholder={ph.acct_id || "65405d0ec432ee"} allowClear />
                  </Form.Item>
                  <Form.Item label="账号" name="username" rules={[{ required: true, message: "请填写登录账号" }]}>
                    <Input placeholder={ph.username || "金蝶登录账号"} allowClear autoComplete="username" />
                  </Form.Item>
                  <Form.Item
                    label="密码"
                    name="password"
                    extra={detail.native?.password_set ? "已保存密码；留空则保持不变" : "请填写登录密码"}
                  >
                    <Input.Password
                      placeholder={detail.native?.password_set ? "******（留空保持不变）" : (ph.password || "金蝶登录密码")}
                      autoComplete="current-password"
                    />
                  </Form.Item>
                  <Form.Item label="LCID（语言）" name="lcid" extra="简体中文一般为 2052">
                    <Input placeholder={ph.lcid || "2052"} allowClear />
                  </Form.Item>
                </section>
              ) : configInputMode === "direct" && isWecom ? (
                <section className="mcp-config-section">
                  <div className="mcp-config-section-head">
                    <div>
                      <strong>StreamableHttp URL</strong>
                      <span>从企业微信 MCP 配置页复制完整地址</span>
                    </div>
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyUrl}>复制</Button>
                  </div>
                  <Form.Item name="url">
                    <Input.TextArea
                      autoSize={{ minRows: 2, maxRows: 4 }}
                      placeholder={ph.url || "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=..."}
                      allowClear
                    />
                  </Form.Item>
                  <p className="mcp-config-note">地址可能包含 apikey，仅保存在当前账号配置中，请勿转发或截图分享。</p>
                </section>
              ) : configInputMode === "import" ? (
                <section className="mcp-config-section">
                  <div className="mcp-config-section-head">
                    <div>
                      <strong>JSON Config</strong>
                      <span>支持完整 mcp.json 或单个 server 对象</span>
                    </div>
                    {isWecom && <Button size="small" type="text" onClick={fillWecomTemplate}>填入模板</Button>}
                  </div>
                  <Form.Item name="paste_json">
                    <Input.TextArea
                      rows={7}
                      placeholder={isWecom ? WECOM_JSON_TEMPLATE : '{\n  "mcpServers": {\n    "...": { "command": "npx", "args": [], "env": {} }\n  }\n}'}
                    />
                  </Form.Item>
                  <p className="mcp-config-note">确认内容后，点击右上角“导入并保存”。</p>
                </section>
              ) : (
                <section className="mcp-config-section">
                  <div className="mcp-config-section-head">
                    <div>
                      <strong>连接参数</strong>
                      <span>{showStdio ? "配置本机启动命令与参数" : "填写 MCP 服务地址"}</span>
                    </div>
                  </div>
                  {showStdio && (
                    <>
                      <Form.Item label="command" name="command">
                        <Input placeholder={ph.command || "npx"} allowClear />
                      </Form.Item>
                      <Form.Item label="args" name="args">
                        <Input.TextArea
                          rows={2}
                          placeholder={ph.args || '["-y","@modelcontextprotocol/server-filesystem","/mnt/nas"]'}
                        />
                      </Form.Item>
                      <Form.Item label="env" name="env">
                        <Input.TextArea rows={3} placeholder='{"KEY":"value"}' />
                      </Form.Item>
                    </>
                  )}
                  {showUrl && (
                    <Form.Item label="MCP URL" name="url">
                      <Input placeholder={ph.url || "http://127.0.0.1:3101/mcp"} allowClear />
                    </Form.Item>
                  )}
                </section>
              )}
            </Form>

            {!isNas && (
              <details className="mcp-config-advanced">
                <summary>
                  <span>工具与当前配置</span>
                  <small>{detail.tools.length} 个工具</small>
                </summary>
                <div className="mcp-config-advanced-body">
                  {!!detail.tools.length && (
                    <div className="mcp-config-tools">
                      {detail.tools.map((tool) => <code key={tool}>{tool}</code>)}
                    </div>
                  )}
                  <div className="mcp-config-json-head">
                    <strong>当前 mcp.json</strong>
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={copyConfig}>复制</Button>
                  </div>
                  <pre className="mcp-json">{detail.cursor_json}</pre>
                </div>
              </details>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
