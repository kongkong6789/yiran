import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App, Avatar, Button, Empty, Input, Popconfirm, Select, Space, Spin, Tag, Tooltip,
  Typography,
} from "antd";
import {
  BulbOutlined, DatabaseOutlined, DeleteOutlined, HistoryOutlined, MoonOutlined, PaperClipOutlined,
  PictureOutlined, PlusOutlined, RobotOutlined, SendOutlined, SunOutlined, UserOutlined,
} from "@ant-design/icons";
import {
  agentChat,
  deleteAgentChatSession,
  getAgentChatSession,
  getAgentChatSessions,
  getAgentModels,
  getAuthToken,
  listKnowledgeBases,
  getMe,
  getUserSettings,
  type AgentChatMessage,
  type AgentChatResult,
  type AgentChatSession,
  type AuthUser,
  type KnowledgeBaseItem,
  type McpServer,
  type UserSkillItem,
} from "../api/client";
import ChatSkillPicker from "../components/ChatSkillPicker";
import ChatConnectorPicker, { connectorPrompt } from "../components/ChatConnectorPicker";
import ChatMarkdown, { isReportLike, looksBlocky } from "../components/ChatMarkdown";
import { useThemeMode } from "../theme/mode";

const { TextArea } = Input;

const MODEL_STORAGE_KEY = "liangce_chat_model";

type ModelKind = "chat" | "vision" | "image";

type ModelPreset = {
  value: string;
  title: string;
  kind: ModelKind;
};

/** 离线兜底：仅保留曾从本网关实测到的型号 */
const FALLBACK_PRESETS: ModelPreset[] = [
  { value: "gpt-5.4", title: "gpt-5.4", kind: "chat" },
  { value: "gpt-5.4-mini", title: "gpt-5.4-mini", kind: "chat" },
  { value: "gpt-5.5", title: "gpt-5.5", kind: "chat" },
  { value: "gpt-5.6-sol", title: "gpt-5.6-sol", kind: "chat" },
  { value: "gpt-image-2", title: "gpt-image-2", kind: "image" },
  { value: "gemini-3.1-flash-image-preview", title: "gemini-3.1-flash-image-preview", kind: "image" },
  { value: "gemini-3-pro-image-preview", title: "gemini-3-pro-image-preview", kind: "image" },
];

function kindOfModel(value: string, presets: ModelPreset[]): ModelKind {
  const hit = presets.find((m) => m.value === value);
  if (hit) return hit.kind;
  const m = value.toLowerCase().replace(/\s+/g, "");
  if (
    /dall-e|dalle|flux|stable-diffusion|sdxl|midjourney|imagen|kolors|wanx|cogview|gpt-image/.test(m)
    || (m.includes("image") && /gemini|gpt|preview|flash|pro/.test(m))
  ) {
    return "image";
  }
  return "chat";
}

function modelLabel(value: string, presets: ModelPreset[]) {
  const hit = presets.find((m) => m.value === value);
  const title = hit?.title || value;
  return `${title}:${value}`;
}

function kindTag(kind: ModelKind) {
  if (kind === "image") return "生图";
  if (kind === "vision") return "识图";
  return "对话";
}

const ATTACH_ACCEPT = ".md,.markdown,.txt,.json,.csv,.py,.log,.yaml,.yml,.xml,.html,.htm,.tsv,.png,.jpg,.jpeg,.gif,.webp,.bmp,image/*";
const MAX_ATTACH_FILES = 5;
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTS.has(ext);
}

type AttachMeta = {
  id?: string;
  name: string;
  size: number;
  has_text?: boolean;
  is_image?: boolean;
  url?: string;
  preview?: string;
};

function attachPreviewSrc(a: AttachMeta) {
  if (a.preview) return a.preview;
  if (!a.url) return "";
  const token = getAuthToken();
  if (!token) return a.url;
  const joiner = a.url.includes("?") ? "&" : "?";
  return `${a.url}${joiner}token=${encodeURIComponent(token)}`;
}
const QUICK_PROMPTS = [
  "读取这个企业微信文档并总结：https://doc.weixin.qq.com/...",
  "昨天 GMV 和退款率怎么样？",
  "帮我梳理采购补货的 SOP 步骤",
];

export default function AgentChat() {
  const { message } = App.useApp();
  const { mode, setMode } = useThemeMode();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [sessions, setSessions] = useState<AgentChatSession[]>([]);
  const [isAdminView, setIsAdminView] = useState(false);
  const [userFilter, setUserFilter] = useState<string | undefined>(undefined);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => {
    try {
      return localStorage.getItem(MODEL_STORAGE_KEY) || "gpt-5.4-mini";
    } catch {
      return "gpt-5.4-mini";
    }
  });
  const [modelPresets, setModelPresets] = useState<ModelPreset[]>(FALLBACK_PRESETS);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [lastMeta, setLastMeta] = useState<Pick<
    AgentChatResult,
    "llm" | "llm_model" | "knowledge_hit" | "refs" | "mcp" | "skills" | "skill_scripts"
  > | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview?: string }[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseItem[]>([]);
  const [knowledgeMode, setKnowledgeMode] = useState<"auto" | "none" | "selected">("auto");
  const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState<number[]>([]);

  const selectedKind = kindOfModel(selectedModel, modelPresets);
  const activeSession = sessions.find((s) => s.id === activeId) || null;
  const viewingOthers = Boolean(
    isAdminView
    && activeSession
    && me
    && activeSession.user_id != null
    && activeSession.user_id !== me.id,
  );
  const userOptions = useMemo(() => {
    const names = Array.from(new Set(sessions.map((s) => s.username).filter(Boolean))) as string[];
    return names.sort().map((name) => ({ value: name, label: name }));
  }, [sessions]);

  const knowledgeOptions = useMemo(() => knowledgeBases.map((item) => ({
    value: item.id,
    label: `${item.name}${item.file_count ? ` (${item.file_count})` : ""}`,
  })), [knowledgeBases]);

  const modelSelectOptions = useMemo(() => {
    const chat = modelPresets.filter((m) => m.kind === "chat");
    const image = modelPresets.filter((m) => m.kind === "image");
    const groups: { label: string; options: { value: string; label: string }[] }[] = [];
    if (chat.length) {
      groups.push({
        label: "对话",
        options: chat.map((m) => ({ value: m.value, label: modelLabel(m.value, modelPresets) })),
      });
    }
    if (image.length) {
      groups.push({
        label: "生图",
        options: image.map((m) => ({ value: m.value, label: modelLabel(m.value, modelPresets) })),
      });
    }
    if (selectedModel && !modelPresets.some((m) => m.value === selectedModel)) {
      const kind = kindOfModel(selectedModel, modelPresets);
      const opt = { value: selectedModel, label: modelLabel(selectedModel, modelPresets) };
      if (kind === "image") {
        if (!groups.some((g) => g.label === "生图")) groups.push({ label: "生图", options: [] });
        groups.find((g) => g.label === "生图")!.options.unshift(opt);
      } else {
        if (!groups.some((g) => g.label === "对话")) groups.push({ label: "对话", options: [] });
        groups.find((g) => g.label === "对话")!.options.unshift(opt);
      }
    }
    return groups;
  }, [modelPresets, selectedModel]);

  const loadSessions = useCallback(async (selectFirst = false) => {
    try {
      const data = await getAgentChatSessions({
        limit: 200,
        username: userFilter || undefined,
      });
      setIsAdminView(!!data.is_admin);
      setSessions(data.results || []);
      if (selectFirst && !activeId && data.results?.[0]) {
        setActiveId(data.results[0].id);
      }
    } catch {
      message.error("加载历史对话失败");
    }
  }, [activeId, userFilter, message]);

  useEffect(() => {
    getMe()
      .then((res) => setMe(res.user))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    listKnowledgeBases()
      .then((rows) => setKnowledgeBases(rows.filter((item) => item.status !== "archived")))
      .catch(() => setKnowledgeBases([]));
  }, []);

  useEffect(() => {
    loadSessions(true);
  }, [userFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setModelsLoading(true);
    getAgentModels()
      .then((data) => {
        const next: ModelPreset[] = [
          ...(data.chat || []).map((m) => ({
            value: m.value,
            title: m.title || m.value,
            kind: "chat" as const,
          })),
          ...(data.image || []).map((m) => ({
            value: m.value,
            title: m.title || m.value,
            kind: "image" as const,
          })),
        ];
        if (next.length) {
          setModelPresets(next);
          setSelectedModel((prev) => {
            if (next.some((m) => m.value === prev)) return prev;
            return next.find((m) => m.kind === "chat")?.value
              || next[0]?.value
              || prev;
          });
        }
      })
      .catch(() => undefined)
      .finally(() => setModelsLoading(false));
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved) return;
    } catch {
      /* ignore */
    }
    getUserSettings()
      .then((data) => {
        if (data.llm_model?.trim()) {
          setSelectedModel(data.llm_model.trim());
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      if (selectedModel.trim()) {
        localStorage.setItem(MODEL_STORAGE_KEY, selectedModel.trim());
      }
    } catch {
      /* ignore */
    }
  }, [selectedModel]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    setHistoryLoading(true);
    getAgentChatSession(activeId)
      .then((session) => setMessages(session.messages || []))
      .catch(() => message.error("读取对话记录失败"))
      .finally(() => setHistoryLoading(false));
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const newChat = () => {
    setActiveId(null);
    setMessages([]);
    setDraft("");
    setPendingFiles([]);
    setLastMeta(null);
  };

  const removeSession = async (id: string) => {
    try {
      await deleteAgentChatSession(id);
      setSessions((prev) => prev.filter((item) => item.id !== id));
      if (activeId === id) newChat();
      message.success("历史对话已删除");
    } catch {
      message.error("删除失败");
    }
  };

  const insertSkill = (skill: UserSkillItem) => {
    const token = `@${skill.skill_id} `;
    setDraft((prev) => (prev.includes(token) ? prev : `${prev}${token}`));
  };

  const insertConnector = (server: McpServer) => {
    const text = connectorPrompt(server);
    setDraft((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return text;
      if (trimmed.includes(server.name) || trimmed.includes(text.slice(0, 12))) return prev;
      return `${trimmed}\n${text}`;
    });
    if (!server.configured || server.enabled === false) {
      message.warning(`「${server.name}」尚未配置或未启用，可到连接器页完善`);
    }
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list?.length) return;
    const incoming = Array.from(list);
    setPendingFiles((prev) => {
      const merged = [...prev];
      for (const file of incoming) {
        if (merged.length >= MAX_ATTACH_FILES) break;
        if (!merged.some((item) => item.file.name === file.name && item.file.size === file.size)) {
          merged.push({
            file,
            preview: isImageFile(file) ? URL.createObjectURL(file) : undefined,
          });
        }
      }
      return merged;
    });
  };

  const send = async (text?: string) => {
    if (viewingOthers) {
      message.warning("正在查看其他用户的对话，仅可浏览，请先「新对话」再发送");
      return;
    }
    const content = (text ?? draft).trim();
    const files = pendingFiles.map((item) => item.file);
    if ((!content && files.length === 0) || loading) return;

    const attachMeta: AttachMeta[] = pendingFiles.map((item) => ({
      name: item.file.name,
      size: item.file.size,
      has_text: !isImageFile(item.file),
      is_image: isImageFile(item.file),
      preview: item.preview,
    }));
    const display = content || (files.length ? `[附件: ${files.map((f) => f.name).join("、")}]` : "");
    const userContent = files.length && content
      ? `${content}\n\n[附件: ${files.map((f) => f.name).join("、")}]`
      : display;

    setMessages((prev) => [...prev, {
      role: "user",
      content: userContent,
      meta: files.length || knowledgeMode !== "auto" || selectedKnowledgeBaseIds.length ? { attachments: attachMeta, knowledge_mode: knowledgeMode, knowledge_base_ids: selectedKnowledgeBaseIds } : undefined,
    }]);
    setDraft("");
    setPendingFiles([]);
    setLoading(true);

    try {
      const model = selectedModel.trim();
      if (files.some(isImageFile) && model && kindOfModel(model, modelPresets) === "chat") {
        message.warning(`当前模型「${model}」是对话型；带图识图请用对话模型试，改图/生图请换「生图」分组`);
      }
      const res = await agentChat({
        message: content,
        conversation_id: activeId || undefined,
        files: files.length ? files : undefined,
        model: model || undefined,
        knowledge_mode: knowledgeMode,
        knowledge_base_ids: knowledgeMode === "selected" ? selectedKnowledgeBaseIds : [],
      });
      if (!res.ok || !res.reply) {
        message.error(res.error || "对话失败");
        return;
      }
      // 用服务端返回的附件 URL 替换本地预览
      if (res.attachments?.length) {
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (next[i].role === "user") {
              next[i] = {
                ...next[i],
                meta: { ...(next[i].meta || {}), attachments: res.attachments },
              };
              break;
            }
          }
          return next;
        });
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.reply!, meta: res as unknown as Record<string, unknown> },
      ]);
      if (res.conversation_id) setActiveId(res.conversation_id);
      setLastMeta({
        llm: res.llm,
        llm_model: res.llm_model,
        knowledge_hit: res.knowledge_hit,
        refs: res.refs,
        mcp: res.mcp,
        skills: res.skills || res.refs?.skills,
        skill_scripts: res.skill_scripts,
      });
      await loadSessions();
    } catch (error: any) {
      message.error(error?.response?.data?.error || "请求失败，请检查后端服务");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="agent-chat-shell" data-chat-theme={mode}>
      <aside className="agent-chat-history">
        <div className="agent-chat-history-head">
          <Typography.Text strong>
            <HistoryOutlined /> {isAdminView ? "全员对话" : "历史对话"}
          </Typography.Text>
          <Space size={4}>
            {isAdminView && (
              <Select
                allowClear
                size="small"
                placeholder="用户"
                style={{ width: 96 }}
                popupClassName="agent-chat-user-filter-dropdown"
                value={userFilter}
                options={userOptions}
                onChange={(v) => {
                  setUserFilter(v);
                  setActiveId(null);
                }}
              />
            )}
            <Tooltip title="新建对话">
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={newChat}
                aria-label="新建对话"
              />
            </Tooltip>
          </Space>
        </div>
        <div className="agent-chat-session-list">
          {sessions.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史对话" />
          ) : sessions.map((item) => (
            <div
              key={item.id}
              className={`agent-chat-session ${activeId === item.id ? "active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => setActiveId(item.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter") setActiveId(item.id);
              }}
            >
              <div>
                <strong>{item.title}</strong>
                <span>
                  {isAdminView && item.username ? `${item.username} · ` : ""}
                  {new Date(item.updated_at).toLocaleString("zh-CN")}
                </span>
              </div>
              <Popconfirm
                title="删除这条对话？"
                overlayClassName="agent-chat-popconfirm"
                onConfirm={(event) => {
                  event?.stopPropagation();
                  removeSession(item.id);
                }}
                onCancel={(event) => event?.stopPropagation()}
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`删除对话：${item.title}`}
                />
              </Popconfirm>
            </div>
          ))}
        </div>
      </aside>

      <div className="agent-chat-page">
        <div className="agent-chat-header">
          <Space>
            <Avatar size={36} className="agent-chat-avatar-assistant" icon={<RobotOutlined />} />
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>经营决策顾问</Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {viewingOthers
                  ? `管理员只读预览 · ${activeSession?.username || "用户"} 的对话`
                  : isAdminView
                    ? "管理员模式 · 可查看全员对话"
                    : "RAG + 图谱 + 企业微信 MCP · 对话自动保存"}
              </Typography.Text>
            </div>
          </Space>
          <Space wrap>
            {lastMeta && (
              <>
                <Tag color={lastMeta.llm ? "success" : "default"}>
                  {lastMeta.llm ? "LLM 在线" : "演示模式"}
                </Tag>
                {lastMeta.llm_model && (
                  <Tag color="geekblue">{lastMeta.llm_model}</Tag>
                )}
                {lastMeta.knowledge_hit && <Tag color="blue">已注入资料</Tag>}
                {lastMeta.mcp?.attempted && (
                  <Tag color={lastMeta.mcp.ok ? "success" : "error"}>
                    {lastMeta.mcp.ok ? `企微 MCP · ${lastMeta.mcp.tool}` : "企微 MCP 读取失败"}
                  </Tag>
                )}
                {(lastMeta.skills || []).map((s) => (
                  <Tag key={s.skill_id} color="gold">Skill · {s.name}</Tag>
                ))}
                {(lastMeta.skill_scripts || []).map((s, i) => (
                  <Tag key={`${s.skill_id}-${i}`} color={s.ok ? "success" : "error"}>
                    {s.ok ? "脚本已执行" : "脚本未执行"}
                    {s.error ? ` · ${s.error.slice(0, 24)}` : ""}
                  </Tag>
                ))}
              </>
            )}
            <div className="agent-chat-theme-switch" role="group" aria-label="对话主题">
              <Tooltip title="白色主题">
                <button
                  type="button"
                  className={mode === "light" ? "active" : ""}
                  aria-label="切换为白色主题"
                  aria-pressed={mode === "light"}
                  onClick={() => setMode("light")}
                >
                  <SunOutlined />
                </button>
              </Tooltip>
              <Tooltip title="黑色主题">
                <button
                  type="button"
                  className={mode === "dark" ? "active" : ""}
                  aria-label="切换为黑色主题"
                  aria-pressed={mode === "dark"}
                  onClick={() => setMode("dark")}
                >
                  <MoonOutlined />
                </button>
              </Tooltip>
            </div>
            <Button icon={<PlusOutlined />} onClick={newChat}>新对话</Button>
          </Space>
        </div>

        <div className="agent-chat-body">
          {historyLoading ? (
            <div className="agent-chat-empty">
              <Spin tip="加载历史记录"><div style={{ minHeight: 48 }} /></Spin>
            </div>
          ) : messages.length === 0 ? (
            <div className="agent-chat-empty">
              <RobotOutlined />
              <Typography.Title level={4}>开始一个新对话</Typography.Title>
              <Typography.Text type="secondary">
                粘贴企业微信文档链接，我会通过已配置的 MCP 读取并回答。
              </Typography.Text>
              <div className="agent-chat-empty-prompts">
                <BulbOutlined className="agent-chat-quick-icon" />
                {QUICK_PROMPTS.map((prompt) => (
                  <Button
                    key={prompt}
                    size="small"
                    onClick={() => send(prompt)}
                    disabled={loading || viewingOthers}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
            </div>
          ) : messages.map((item, index) => {
            const isUser = item.role === "user";
            const isBlocks = !isUser && (isReportLike(item.content) || looksBlocky(item.content));
            return (
              <div key={item.id || index} className={`agent-chat-row ${isUser ? "user" : "assistant"}`}>
                <Avatar
                  size={32}
                  className={isUser ? "agent-chat-avatar-user" : "agent-chat-avatar-assistant"}
                  src={isUser && me?.avatar_url
                    ? `${me.avatar_url}${me.avatar_url.includes("?") ? "&" : "?"}token=${encodeURIComponent(getAuthToken() || "")}`
                    : undefined}
                  icon={isUser
                    ? (me?.avatar_url ? undefined : <UserOutlined />)
                    : <RobotOutlined />}
                />
                <div className={`agent-chat-bubble${isBlocks ? " report" : ""}`}>
                  {isUser ? (
                    <>
                      {!!(item.meta?.attachments as AttachMeta[] | undefined)?.length && (
                        <div className="agent-chat-attach-list">
                          {(item.meta!.attachments as AttachMeta[]).map((a) => (
                            a.is_image && (a.preview || a.url) ? (
                              <a
                                key={a.id || a.name}
                                className="agent-chat-attach-image"
                                href={attachPreviewSrc(a)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <img src={attachPreviewSrc(a)} alt={a.name} />
                                <span>{a.name}</span>
                              </a>
                            ) : (
                              <Tag key={a.id || a.name} className="agent-chat-attach-tag" icon={<PaperClipOutlined />}>
                                {a.name} · {fmtSize(a.size)}
                              </Tag>
                            )
                          ))}
                        </div>
                      )}
                      <Typography.Paragraph style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {item.content.replace(/\n\n\[附件:.*\]$/, "").replace(/^\[附件:.*\]$/, "") || item.content}
                      </Typography.Paragraph>
                    </>
                  ) : (
                    <ChatMarkdown content={item.content} variant="auto" />
                  )}
                </div>
              </div>
            );
          })}
          {loading && (
            <div className="agent-chat-row assistant">
              <Avatar size={32} className="agent-chat-avatar-assistant" icon={<RobotOutlined />} />
              <div className="agent-chat-bubble">
                <Spin size="small" /> <span style={{ marginLeft: 8, color: "var(--chat-muted)" }}>正在检索资料并思考…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="agent-chat-input">
          {pendingFiles.length > 0 && (
            <div className="agent-chat-pending-files">
              {pendingFiles.map((item, idx) => (
                item.preview ? (
                  <div key={`${item.file.name}-${idx}`} className="agent-chat-pending-image">
                    <img src={item.preview} alt={item.file.name} />
                    <button
                      type="button"
                      className="agent-chat-pending-remove"
                      aria-label={`移除 ${item.file.name}`}
                      onClick={() => {
                        if (item.preview) URL.revokeObjectURL(item.preview);
                        setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
                      }}
                    >
                      ×
                    </button>
                    <span>{item.file.name}</span>
                  </div>
                ) : (
                  <Tag
                    key={`${item.file.name}-${idx}`}
                    closable
                    onClose={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="agent-chat-attach-tag"
                    icon={<PaperClipOutlined />}
                  >
                    {item.file.name} · {fmtSize(item.file.size)}
                  </Tag>
                )
              ))}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACH_ACCEPT}
            style={{ display: "none" }}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="agent-chat-composer">
            <TextArea
              className="agent-chat-composer-textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={viewingOthers}
              placeholder={
                viewingOthers
                  ? "正在查看其他用户对话（只读）。点击右上角「新对话」可继续自己聊。"
                  : selectedKind === "image"
                    ? "描述要生成的画面，例如：一只戴墨镜的柴犬，赛博朋克风格"
                    : "今天帮你做些什么？ 锤子选 Skill，插头选连接器"
              }
              autoSize={{ minRows: 2, maxRows: 6 }}
              variant="borderless"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
            />
            <div className="agent-chat-composer-bar">
              <div className="agent-chat-composer-left">
                <Select
                  className="agent-chat-model-select"
                  value={selectedModel}
                  onChange={setSelectedModel}
                  options={modelSelectOptions}
                  optionLabelProp="label"
                  popupMatchSelectWidth={false}
                  popupClassName="agent-chat-model-dropdown"
                  suffixIcon={null}
                  showSearch
                  loading={modelsLoading}
                  optionFilterProp="label"
                  labelRender={({ label, value }) => (
                    <span className="agent-chat-model-trigger">
                      {kindOfModel(String(value), modelPresets) === "image" ? (
                        <PictureOutlined className="agent-chat-model-icon image" />
                      ) : (
                        <RobotOutlined className="agent-chat-model-icon" />
                      )}
                      <span className="agent-chat-model-text">{label || modelLabel(String(value), modelPresets)}</span>
                    </span>
                  )}
                />
                <Tag className={`agent-chat-kind-tag kind-${selectedKind}`}>
                  {kindTag(selectedKind)}
                </Tag>
                <Select
                  className="agent-chat-knowledge-mode-select"
                  value={knowledgeMode}
                  onChange={(value) => setKnowledgeMode(value as "auto" | "none" | "selected")}
                  options={[
                    { value: "auto", label: "知识库:自动" },
                    { value: "none", label: "不使用知识库" },
                    { value: "selected", label: "指定知识库" },
                  ]}
                  popupMatchSelectWidth={180}
                  suffixIcon={<DatabaseOutlined />}
                  disabled={viewingOthers}
                />
                {knowledgeMode === "selected" && (
                  <Select
                    className="agent-chat-knowledge-select"
                    mode="multiple"
                    allowClear
                    maxTagCount={1}
                    placeholder="选择知识库"
                    value={selectedKnowledgeBaseIds}
                    onChange={(values) => setSelectedKnowledgeBaseIds(values as number[])}
                    options={knowledgeOptions}
                    popupMatchSelectWidth={260}
                    suffixIcon={<DatabaseOutlined />}
                    disabled={viewingOthers}
                  />
                )}
                <ChatSkillPicker onSelect={insertSkill} />
                <ChatConnectorPicker onSelect={insertConnector} />
              </div>
              <div className="agent-chat-composer-right">
                <Tooltip title={`上传附件(最多${MAX_ATTACH_FILES}个)`}>
                  <Button
                    className="agent-chat-circle-btn"
                    type="text"
                    shape="circle"
                    icon={<PlusOutlined />}
                    disabled={loading || viewingOthers || pendingFiles.length >= MAX_ATTACH_FILES}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="上传附件"
                  />
                </Tooltip>
                <Tooltip title="发送">
                  <Button
                    className="agent-chat-send-circle"
                    type="primary"
                    shape="circle"
                    icon={<SendOutlined />}
                    loading={loading}
                    disabled={viewingOthers || (!draft.trim() && pendingFiles.length === 0)}
                    onClick={() => send()}
                    aria-label="发送"
                  />
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
