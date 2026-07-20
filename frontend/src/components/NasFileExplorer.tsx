import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { Button, Empty, Input, Segmented, Select, Skeleton, Tag, Tooltip, Typography, message } from "antd";
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FolderFilled,
  HddOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { isAxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import {
  getNasDirectory,
  getNasFilePreview,
  listCollabUsers,
  type CollabUserBrief,
  type NasDirectoryResult,
  type NasFileEntry,
  type NasFilePreview,
} from "../api/client";
import {
  XIAOCE_HANDOFF_TARGET,
  buildNasResourceHandoff,
  handoffDestination,
  type AgentHandoffTarget,
} from "../features/agent-handoff/resourceHandoff";

type Props = {
  configured: boolean;
  enabled: boolean;
  onOpenSettings: () => void;
};

type ViewMode = "details" | "icons";

const EMPTY_DIRECTORY: NasDirectoryResult = {
  root_name: "NAS",
  current_path: "/",
  current_native_path: "",
  parent_path: null,
  entries: [],
  count: 0,
  truncated: false,
  read_only: true,
};

function errorMessage(error: unknown): string {
  if (isAxiosError<{ error?: string }>(error)) {
    return error.response?.data?.error || "NAS 文件库暂时无法访问";
  }
  return "NAS 文件库暂时无法访问";
}

function formatSize(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function fileType(entry: NasFileEntry): string {
  if (entry.kind === "folder") return "文件夹";
  if (entry.extension) return `${entry.extension.slice(1).toUpperCase()} 文件`;
  return "文件";
}

function fileIcon(entry: NasFileEntry) {
  if (entry.kind === "folder") return <FolderFilled />;
  if (entry.mime_type.startsWith("image/")) return <FileImageOutlined />;
  if (entry.mime_type === "application/pdf") return <FilePdfOutlined />;
  if (entry.previewable) return <FileTextOutlined />;
  return <FileOutlined />;
}

function pathSegments(path: string): Array<{ label: string; path: string }> {
  const names = path.split("/").filter(Boolean);
  const result = [{ label: "根目录", path: "/" }];
  names.forEach((name, index) => {
    result.push({ label: name, path: `/${names.slice(0, index + 1).join("/")}` });
  });
  return result;
}

export default function NasFileExplorer({ configured, enabled, onOpenSettings }: Props) {
  const navigateTo = useNavigate();
  const [directory, setDirectory] = useState<NasDirectoryResult>(EMPTY_DIRECTORY);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("details");
  const [selected, setSelected] = useState<NasFileEntry | null>(null);
  const [preview, setPreview] = useState<NasFilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const [handoffTargets, setHandoffTargets] = useState<AgentHandoffTarget[]>([XIAOCE_HANDOFF_TARGET]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [handoffTargetKey, setHandoffTargetKey] = useState(XIAOCE_HANDOFF_TARGET.key);

  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    listCollabUsers()
      .then((data) => {
        if (!cancelled) {
          const botTargets = data.results
            .filter((user): user is CollabUserBrief & { bot_id: string } => user.kind === "bot" && Boolean(user.bot_id))
            .map((bot) => ({
              key: `bot:${bot.bot_id}`,
              kind: "bot" as const,
              id: bot.bot_id,
              label: bot.display_name || bot.nickname || bot.username,
              emoji: "🤖",
              description: bot.bio || "可用智能体",
            }));
          setHandoffTargets(botTargets.length ? botTargets : [XIAOCE_HANDOFF_TARGET]);
          const defaultTarget = botTargets.find((target) => target.id === "xiaoce") || botTargets[0];
          if (defaultTarget) setHandoffTargetKey(defaultTarget.key);
        }
      })
      .catch(() => {
        if (!cancelled) setHandoffTargets([XIAOCE_HANDOFF_TARGET]);
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const fetchDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setLoadError("");
    setSelected(null);
    setPreview(null);
    try {
      setDirectory(await getNasDirectory(path));
    } catch (error: unknown) {
      setLoadError(errorMessage(error));
      const parts = path.split("/").filter(Boolean);
      const parentPath = parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : parts.length ? "/" : null;
      setDirectory((current) => ({
        ...EMPTY_DIRECTORY,
        root_name: current.root_name,
        current_path: path,
        parent_path: parentPath,
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setBackStack([]);
    setForwardStack([]);
    setQuery("");
    if (configured && enabled) {
      void fetchDirectory("/");
    } else {
      setDirectory(EMPTY_DIRECTORY);
      setLoadError("请先完成 NAS 连接设置，文件库将在连接成功后显示");
    }
  }, [configured, enabled, fetchDirectory]);

  const navigate = (path: string) => {
    if (path === directory.current_path) return;
    setBackStack((items) => [...items, directory.current_path]);
    setForwardStack([]);
    setQuery("");
    void fetchDirectory(path);
  };

  const goBack = () => {
    const target = backStack[backStack.length - 1];
    if (!target) return;
    setBackStack((items) => items.slice(0, -1));
    setForwardStack((items) => [directory.current_path, ...items]);
    setQuery("");
    void fetchDirectory(target);
  };

  const goForward = () => {
    const target = forwardStack[0];
    if (!target) return;
    setForwardStack((items) => items.slice(1));
    setBackStack((items) => [...items, directory.current_path]);
    setQuery("");
    void fetchDirectory(target);
  };

  const openEntry = async (entry: NasFileEntry) => {
    if (entry.kind === "folder") {
      navigate(entry.path);
      return;
    }
    setSelected(entry);
    if (!entry.previewable) {
      setPreview(null);
      message.info("当前文件类型暂不支持在线预览，可查看右侧属性");
      return;
    }
    if (entry.preview_kind === "image" || entry.preview_kind === "pdf") {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    try {
      setPreview(await getNasFilePreview(entry.path));
    } catch (error: unknown) {
      message.error(errorMessage(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const copyPath = async (path = selected?.native_path || directory.current_native_path) => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(path);
        copied = true;
      }
    } catch {
      // 部分内网浏览器会禁用 Clipboard API，继续使用兼容性回退。
    }
    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = path;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand("copy");
      textarea.remove();
    }
    message[copied ? "success" : "error"](copied ? "路径已复制" : "复制路径失败");
  };

  const downloadEntry = (entry: NasFileEntry) => {
    if (!entry.download_url) return;
    const link = document.createElement("a");
    link.href = entry.download_url;
    link.download = entry.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const dragFileOut = (event: DragEvent<HTMLButtonElement>, entry: NasFileEntry) => {
    if (entry.kind !== "file" || !entry.download_url) {
      event.preventDefault();
      return;
    }
    const url = new URL(entry.download_url, window.location.origin).toString();
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("DownloadURL", `${entry.mime_type}:${entry.name}:${url}`);
    event.dataTransfer.setData("text/uri-list", url);
    event.dataTransfer.setData("text/plain", entry.native_path);
  };

  const handoffToAgent = (entry: NasFileEntry) => {
    const target = handoffTargets.find((item) => item.key === handoffTargetKey)
      || XIAOCE_HANDOFF_TARGET;
    const resourceHandoff = buildNasResourceHandoff(entry, target);
    navigateTo(handoffDestination(target), { state: { resourceHandoff } });
  };

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return directory.entries;
    return directory.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(keyword));
  }, [directory.entries, query]);

  const quickFolders = directory.entries.filter((entry) => entry.kind === "folder").slice(0, 6);
  const segments = pathSegments(directory.current_path);

  return (
    <div className="nas-explorer" data-testid="nas-file-explorer">
      <div className="nas-explorer-commandbar">
        <div className="nas-explorer-nav-buttons" aria-label="目录导航">
          <Tooltip title="后退"><Button type="text" icon={<ArrowLeftOutlined />} disabled={!backStack.length} onClick={goBack} /></Tooltip>
          <Tooltip title="前进"><Button type="text" icon={<ArrowRightOutlined />} disabled={!forwardStack.length} onClick={goForward} /></Tooltip>
          <Tooltip title="向上一级"><Button type="text" icon={<ArrowUpOutlined />} disabled={!directory.parent_path} onClick={() => directory.parent_path && navigate(directory.parent_path)} /></Tooltip>
          <Tooltip title="刷新"><Button type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchDirectory(directory.current_path)} /></Tooltip>
        </div>

        <div className="nas-explorer-address" aria-label="当前位置">
          <HddOutlined />
          <div className="nas-explorer-breadcrumbs">
            {segments.map((segment, index) => (
              <span key={segment.path}>
                {index > 0 && <i>/</i>}
                <button type="button" onClick={() => navigate(segment.path)}>{segment.label}</button>
              </span>
            ))}
          </div>
          <Tooltip title="复制当前 Windows 路径"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => void copyPath(directory.current_native_path)} /></Tooltip>
        </div>

        <Input
          allowClear
          className="nas-explorer-search"
          prefix={<SearchOutlined />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索当前文件夹"
          aria-label="搜索当前文件夹"
        />
      </div>

      <div className="nas-explorer-actionbar">
        <div>
          <Button type="text" icon={<HomeOutlined />} onClick={() => navigate("/")}>根目录</Button>
          <Button type="text" icon={<EyeOutlined />} disabled={!selected || selected.kind === "folder"} onClick={() => selected && void openEntry(selected)}>预览</Button>
          <Button type="text" icon={<InfoCircleOutlined />} disabled={!selected}>属性</Button>
        </div>
        <div>
          <Tag icon={<SafetyCertificateOutlined />} bordered={false}>只读模式</Tag>
          <Segmented<ViewMode>
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: "details", icon: <UnorderedListOutlined />, label: "详细信息" },
              { value: "icons", icon: <AppstoreOutlined />, label: "大图标" },
            ]}
          />
          <Button type="text" icon={<SettingOutlined />} onClick={onOpenSettings}>连接设置</Button>
        </div>
      </div>

      <div className="nas-explorer-workspace">
        <aside className="nas-explorer-sidebar" aria-label="NAS 快速访问">
          <Typography.Text className="nas-explorer-sidebar-label">快速访问</Typography.Text>
          <button type="button" className={directory.current_path === "/" ? "is-active" : ""} onClick={() => navigate("/")}>
            <HomeOutlined /><span>{directory.root_name || "NAS 根目录"}</span>
          </button>
          {!!quickFolders.length && <Typography.Text className="nas-explorer-sidebar-label">当前文件夹</Typography.Text>}
          {quickFolders.map((entry) => (
            <button key={entry.path} type="button" onClick={() => navigate(entry.path)} title={entry.name}>
              <FolderFilled /><span>{entry.name}</span>
            </button>
          ))}
        </aside>

        <main className="nas-explorer-main">
          {loading ? (
            <div className="nas-explorer-loading"><Skeleton active paragraph={{ rows: 7 }} /></div>
          ) : loadError ? (
            <div className="nas-explorer-connect-state">
              <span><HddOutlined /></span>
              <Typography.Title level={4}>NAS 文件库尚未就绪</Typography.Title>
              <Typography.Text type="secondary">{loadError}</Typography.Text>
              <Button type="primary" icon={<SettingOutlined />} onClick={onOpenSettings}>打开连接设置</Button>
            </div>
          ) : visibleEntries.length ? (
            <div className={`nas-file-view nas-file-view--${viewMode}`} role="listbox" aria-label="NAS 文件列表">
              {viewMode === "details" && (
                <div className="nas-file-list-head" aria-hidden="true">
                  <span>名称</span><span>修改日期</span><span>类型</span><span>大小</span>
                </div>
              )}
              {visibleEntries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={`nas-file-item${selected?.path === entry.path ? " is-selected" : ""}`}
                  onClick={() => { setSelected(entry); setPreview(null); }}
                  onDoubleClick={() => void openEntry(entry)}
                  draggable={entry.kind === "file"}
                  onDragStart={(event) => dragFileOut(event, entry)}
                  role="option"
                  aria-selected={selected?.path === entry.path}
                  title={`${entry.name}（双击${entry.kind === "folder" ? "打开" : "预览"}${entry.kind === "file" ? "，可拖到桌面" : ""}）`}
                >
                  <span className={`nas-file-item-icon nas-file-item-icon--${entry.kind}`}>{fileIcon(entry)}</span>
                  <span className="nas-file-item-name">{entry.name}</span>
                  <span className="nas-file-item-modified">{formatDate(entry.modified_at)}</span>
                  <span className="nas-file-item-type">{fileType(entry)}</span>
                  <span className="nas-file-item-size">{formatSize(entry.size)}</span>
                </button>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? "当前文件夹没有匹配项" : "此文件夹为空"} />
          )}
        </main>

        <aside className={`nas-explorer-preview${selected ? " has-selection" : ""}`} aria-label="文件详细信息">
          {selected ? (
            <>
              <span className={`nas-preview-icon nas-file-item-icon--${selected.kind}`}>{fileIcon(selected)}</span>
              <Typography.Title level={5} ellipsis={{ tooltip: selected.name }}>{selected.name}</Typography.Title>
              <div className="nas-preview-meta">
                <div><span>类型</span><b>{fileType(selected)}</b></div>
                <div><span>大小</span><b>{formatSize(selected.size)}</b></div>
                <div><span>修改时间</span><b>{formatDate(selected.modified_at)}</b></div>
                <div><span>位置</span><b title={selected.native_path}>{selected.native_path}</b></div>
              </div>
              {previewLoading ? <Skeleton active paragraph={{ rows: 5 }} /> : selected.preview_kind === "image" && selected.preview_url ? (
                <div className="nas-preview-media">
                  <img src={selected.preview_url} alt={selected.name} />
                </div>
              ) : selected.preview_kind === "pdf" && selected.preview_url ? (
                <div className="nas-preview-media nas-preview-media--pdf">
                  <iframe src={selected.preview_url} title={selected.name} />
                </div>
              ) : preview?.previewable ? (
                <div className="nas-preview-content">
                  <Typography.Text strong>文本预览</Typography.Text>
                  <pre>{preview.content || "（空文件）"}</pre>
                  {preview.truncated && <Typography.Text type="secondary">仅展示前 512 KB</Typography.Text>}
                </div>
              ) : null}
              <div className="nas-preview-actions">
                {selected.kind === "file" && <Button icon={<EyeOutlined />} disabled={!selected.previewable} onClick={() => void openEntry(selected)}>预览</Button>}
                {selected.kind === "file" && <Button icon={<DownloadOutlined />} onClick={() => downloadEntry(selected)}>下载</Button>}
                <Button icon={<CopyOutlined />} onClick={() => void copyPath(selected.native_path)}>复制路径</Button>
                <div className="nas-agent-handoff">
                  <Select
                    value={handoffTargetKey}
                    loading={agentsLoading}
                    aria-label="选择目标智能体"
                    classNames={{ popup: { root: "nas-agent-handoff-dropdown" } }}
                    onChange={setHandoffTargetKey}
                    options={handoffTargets.map((target) => ({
                      value: target.key,
                      label: `${target.emoji || "🤖"} ${target.label}${target.id === "xiaoce" ? "（默认）" : ""}`,
                      title: target.description,
                    }))}
                  />
                  <Button type="primary" icon={<RobotOutlined />} onClick={() => handoffToAgent(selected)}>
                    交给智能体
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="nas-preview-empty">
              <InfoCircleOutlined />
              <Typography.Text type="secondary">选择文件或文件夹以查看属性</Typography.Text>
            </div>
          )}
        </aside>
      </div>

      <footer className="nas-explorer-statusbar">
        <span>{directory.count} 个项目{directory.truncated ? "（仅显示前 500 项）" : ""}</span>
        <span>{selected ? `已选择 1 个项目 · ${selected.name}` : "双击打开；文件可下载或拖到 Windows 桌面"}</span>
      </footer>
    </div>
  );
}
