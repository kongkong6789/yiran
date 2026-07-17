import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Drawer, Tag, Button, Space, Typography, List, message, Tooltip,
  Form, Input, Switch, Divider, Alert, Empty, Segmented, Skeleton,
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
  reachable: { color: "success", text: "可连通" },
  unreachable: { color: "error", text: "不可达" },
  error: { color: "error", text: "异常" },
  disabled: { color: "default", text: "已禁用" },
};

const SOURCE_LABEL: Record<string, string> = {
  personal: "个人配置",
  ui: "界面配置",
  env: ".env 默认",
  none: "未配置",
};

const TRANSPORT_LABEL: Record<string, string> = {
  streamable_http: "HTTP",
  sse: "SSE",
  stdio: "stdio",
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
};

type StatusFilter = "all" | "configured" | "reachable" | "attention";
type NasDrawerMode = "files" | "settings";

const LAYER_DESC: Record<string, string> = {
  协作: "文档、消息与团队协作服务",
  感知: "业务数据读取与外部信息感知",
  终端: "本地文件、桌面环境与执行终端",
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
    });
    // 未配置时用占位提示(不写入 form 正式值,靠 placeholder 展示)
    if (!d.command && !d.url && ph.command) {
      // keep empty so user can see placeholders
    }
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
    const values = await form.validateFields();
    setSaving(true);
    try {
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
        message.success("NAS 路径已保存，正在打开文件库");
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
    const st = STATUS_TAG[mcpStatus(item)] || STATUS_TAG.unconfigured;
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
          <Tag color={st.color} bordered={false} style={{ margin: 0, fontSize: 10 }}>
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
    return (
      <button
        key={item.id}
        type="button"
        className="mcp-card mcp-card--detailed"
        onClick={() => openServer(item.id)}
        style={{ "--accent": color } as React.CSSProperties}
        aria-label={`管理${item.name}连接，当前状态：${st.text}`}
      >
        <span className="mcp-card-icon" style={{ color }}>{ICONS[item.id]}</span>
        <span className="mcp-card-copy">
          <span className="mcp-card-title-row">
            <b>{item.name}</b>
            <Tag color={st.color} bordered={false}>{st.text}</Tag>
          </span>
          <em>{item.desc}</em>
          <span className="mcp-card-meta">
            <i>{TRANSPORT_LABEL[item.transport] || item.transport}</i>
            <i>{item.tools?.length || 0} 个工具</i>
            {status === "reachable" ? <i className="mcp-card-health"><CheckCircleOutlined /> 已验证</i> : null}
          </span>
        </span>
        <span className="mcp-card-action">
          管理连接
          <ArrowRightOutlined />
        </span>
      </button>
    );
  };

  const renderRow = (item: McpServer) => {
    const color = COLORS[item.id] || "#59c2ff";
    const st = STATUS_TAG[mcpStatus(item)] || STATUS_TAG.unconfigured;
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
        <Tag color={st.color} bordered={false} style={{ margin: 0, fontSize: 10, lineHeight: "16px" }}>
          {st.text}
        </Tag>
      </button>
    );
  };

  const isWecom = openId === "wecom";
  const isNas = openId === "nas";
  const showStdio = !isWecom && (detail?.declared_transport === "stdio" || detail?.transport === "stdio");
  const showUrl = !isWecom && (
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
              <Typography.Text className="connectors-section-eyebrow">MCP 服务目录</Typography.Text>
              <Typography.Title level={4}>{title}</Typography.Title>
              <Typography.Text type="secondary">
                按业务层查看可用连接。选择卡片即可配置参数、导入 mcp.json 或探测连通性。
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
              <span>平台总数</span>
            </button>
            <button
              type="button"
              className={`connectors-stat${statusFilter === "configured" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("configured")}
            >
              <b>{configuredCount}</b>
              <span>已配置</span>
            </button>
            <button
              type="button"
              className={`connectors-stat${statusFilter === "reachable" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("reachable")}
            >
              <b>{reachableCount}</b>
              <span>可连通</span>
            </button>
            <button
              type="button"
              className={`connectors-stat connectors-stat--attention${statusFilter === "attention" ? " is-active" : ""}`}
              onClick={() => setStatusFilter("attention")}
            >
              <b>{attentionCount}</b>
              <span>待处理</span>
            </button>
          </div>

          <div className="connectors-toolbar">
            <Input
              allowClear
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              prefix={<SearchOutlined />}
              placeholder="搜索平台、能力或协议"
              aria-label="搜索平台连接器"
            />
            <Segmented
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as StatusFilter)}
              options={[
                { label: "全部", value: "all" },
                { label: "已配置", value: "configured" },
                { label: "可连通", value: "reachable" },
                { label: "待处理", value: "attention" },
              ]}
            />
            <Typography.Text type="secondary">{filteredServers.length} 个结果</Typography.Text>
          </div>

          {loading && !servers.length ? (
            <div className="connectors-loading" aria-label="正在加载平台连接器">
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
                        <Typography.Title level={5} className="connectors-layer-title">{layer}</Typography.Title>
                        <Typography.Text type="secondary">{LAYER_DESC[layer] || "外部业务系统与能力服务"}</Typography.Text>
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
          <span className="nas-drawer-title"><HddOutlined /> NAS 文件资源管理器</span>
        ) : `${detail.name} · MCP 配置`) : "MCP 配置"}
        open={!!openId}
        onClose={() => { setOpenId(null); setDetail(null); setNasDrawerMode("files"); form.resetFields(); }}
        width={isNas ? "min(1180px, calc(100vw - 24px))" : 560}
        className={isNas ? "nas-explorer-drawer" : undefined}
        extra={
          detail && isNas && nasDrawerMode === "files" ? (
            <Space>
              <Button icon={<RadarChartOutlined />} loading={probing} onClick={doProbe}>检查连接</Button>
              <Button type="primary" onClick={() => setNasDrawerMode("settings")}>连接设置</Button>
            </Space>
          ) : detail && isNas ? (
            <Space>
              <Button onClick={() => setNasDrawerMode("files")}>返回文件库</Button>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={doSave}>连接并打开</Button>
            </Space>
          ) : detail ? (
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={doSave}>
              保存
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
          <Space
            direction="vertical"
            size={16}
            style={{ width: "100%" }}
            className={isNas ? "nas-settings-panel" : undefined}
          >
            <div>
              <Typography.Text type="secondary">{detail.desc}</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <Tag>{detail.layer}</Tag>
                <Tag color="blue">{TRANSPORT_LABEL[detail.transport]}</Tag>
                <Tag color={detail.config_source === "personal" || detail.config_source === "ui" ? "success" : "default"}>
                  {SOURCE_LABEL[detail.config_source] || detail.config_source}
                </Tag>
              </div>
            </div>

            {!!detail.hints?.length && (
              <Alert
                type="info"
                showIcon
                message={isWecom ? "企业微信 MCP 填写说明" : "配置说明"}
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {detail.hints.map((h) => <li key={h}>{h}</li>)}
                  </ul>
                }
              />
            )}

            <Form form={form} layout="vertical" requiredMark={false}>
              <Form.Item label="启用" name="enabled" valuePropName="checked">
                <Switch checkedChildren="开" unCheckedChildren="关" />
              </Form.Item>

              {isNas ? (
                <>
                  <Alert
                    type="info"
                    showIcon
                    message="输入 NAS 网络路径即可连接"
                    description="支持直接填写服务器根路径（如 \\\\192.168.0.188），连接后会列出当前 Windows 账户可访问的共享文件夹。"
                  />
                  <Form.Item
                    label="NAS 网络路径"
                    name="nas_path"
                    extra="使用运行良策后端的 Windows 账户访问；如果资源管理器已登录该 NAS，通常无需再次输入账号密码。"
                    rules={[
                      { required: true, whitespace: true, message: "请输入 NAS 网络路径" },
                      {
                        validator: (_, value?: string) => {
                          const path = value?.trim() || "";
                          const valid = /^\\\\[^\\]+/.test(path) || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/");
                          return valid
                            ? Promise.resolve()
                            : Promise.reject(new Error("请输入 \\\\服务器、盘符路径或绝对目录"));
                        },
                      },
                    ]}
                  >
                    <Input size="large" placeholder="\\\\192.168.0.188" allowClear autoFocus />
                  </Form.Item>
                </>
              ) : isWecom ? (
                <>
                  <Form.Item
                    label="StreamableHttp URL"
                    name="url"
                    extra="从企微 MCP 配置页复制 StreamableHttp URL,粘贴后点右上角「保存」"
                  >
                    <Input.TextArea
                      rows={3}
                      placeholder={ph.url || "https://qyapi.weixin.qq.com/mcp/robot-doc?apikey=..."}
                      allowClear
                    />
                  </Form.Item>
                  <Button size="small" icon={<CopyOutlined />} onClick={copyUrl} style={{ marginBottom: 12 }}>
                    复制 URL
                  </Button>

                  <Divider style={{ margin: "4px 0 12px" }}>JSON Config</Divider>

                  <Form.Item
                    label="JSON Config"
                    name="paste_json"
                    extra='从企微 MCP 配置页复制 JSON Config,粘贴后点「导入并保存」'
                  >
                    <Input.TextArea
                      rows={10}
                      placeholder={WECOM_JSON_TEMPLATE}
                    />
                  </Form.Item>
                  <Space wrap>
                    <Button onClick={fillWecomTemplate}>填入模板</Button>
                    <Button
                      type="primary"
                      ghost
                      icon={<ImportOutlined />}
                      loading={importing}
                      onClick={doImport}
                    >
                      导入并保存
                    </Button>
                  </Space>
                </>
              ) : (
                <>
                  {showStdio && (
                    <>
                      <Form.Item
                        label="command"
                        name="command"
                        extra="stdio 启动命令"
                      >
                        <Input placeholder={ph.command || "npx"} allowClear />
                      </Form.Item>
                      <Form.Item
                        label="args"
                        name="args"
                        extra='JSON 数组'
                      >
                        <Input.TextArea
                          rows={2}
                          placeholder={ph.args || '["-y","@modelcontextprotocol/server-filesystem","/mnt/nas"]'}
                        />
                      </Form.Item>
                      <Form.Item
                        label="env"
                        name="env"
                        extra='JSON 对象(可选)'
                      >
                        <Input.TextArea rows={4} placeholder='{"KEY":"value"}' />
                      </Form.Item>
                    </>
                  )}

                  {showUrl && (
                    <Form.Item label="MCP URL" name="url" extra="HTTP / SSE 端点">
                      <Input placeholder={ph.url || "http://127.0.0.1:3101/mcp"} allowClear />
                    </Form.Item>
                  )}

                  <Divider style={{ margin: "4px 0 12px" }}>或粘贴 Cursor mcp.json</Divider>

                  <Form.Item label="粘贴导入" name="paste_json" extra="支持完整 mcp.json 或单个 server 对象">
                    <Input.TextArea
                      rows={8}
                      placeholder={'{\n  "mcpServers": {\n    "...": { "command": "npx", "args": [], "env": {} }\n  }\n}'}
                    />
                  </Form.Item>
                  <Button
                    type="primary"
                    ghost
                    icon={<ImportOutlined />}
                    loading={importing}
                    onClick={doImport}
                  >
                    导入并保存
                  </Button>
                </>
              )}
            </Form>

            {!isNas && (
              <>
                <div>
                  <Typography.Text strong>可用工具</Typography.Text>
                  <List
                    size="small"
                    dataSource={detail.tools}
                    renderItem={(t) => <List.Item style={{ padding: "4px 0" }}><code>{t}</code></List.Item>}
                  />
                </div>

                <Divider style={{ margin: "4px 0" }} />

                <div>
                  <Space style={{ marginBottom: 8 }} wrap>
                    <Typography.Text strong>当前 Cursor mcp.json</Typography.Text>
                    <Button size="small" icon={<CopyOutlined />} onClick={copyConfig}>复制</Button>
                    <Button size="small" icon={<RadarChartOutlined />} loading={probing} onClick={doProbe}>
                      探测连接
                    </Button>
                  </Space>
                  <pre className="mcp-json">{detail.cursor_json}</pre>
                </div>

                <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
                  {isWecom
                    ? "与企微后台一致: 填 StreamableHttp URL 或粘贴 JSON Config。配置含 apikey,请勿泄露。"
                    : "填写后点右上角「保存」,或粘贴 mcp.json 后「导入并保存」。"}
                </Typography.Paragraph>
              </>
            )}
          </Space>
        )}
      </Drawer>
    </>
  );
}
