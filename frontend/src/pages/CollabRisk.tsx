import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import {
  App, Avatar, Badge, Button, Dropdown, Empty, Image, Input, Modal, Popover, Select, Space, Tag, Tooltip, Typography,
} from "antd";
import type { TooltipPlacement } from "antd/es/tooltip";
import {
  AlertOutlined, ApartmentOutlined, CheckOutlined, CheckSquareOutlined, ClearOutlined,
  CloseOutlined, CommentOutlined, CopyOutlined, DeleteOutlined, DownOutlined, EditOutlined,
  DownloadOutlined, FileOutlined, FolderOpenOutlined, ForwardOutlined, HistoryOutlined, InsertRowRightOutlined, LoadingOutlined,
  MessageOutlined, MoonOutlined, PaperClipOutlined, PlusOutlined, RobotOutlined,
  RollbackOutlined, SearchOutlined, SendOutlined, SettingOutlined, StopOutlined, SunOutlined,
  TeamOutlined, TranslationOutlined, UserAddOutlined, UserDeleteOutlined, UserOutlined,
  UsergroupAddOutlined,
} from "@ant-design/icons";
import {
  addCollabRoomMembers,
  clearCollabMessages,
  removeCollabRoomMembers,
  collabPresenceHeartbeat,
  collabPresenceQuery,
  createCollabRoom,
  createXiaoceTask,
  deleteCollabRoom,
  getAuthToken,
  getCollabRoom,
  getCollabRoomStats,
  getMe,
  listCollabMessages,
  listCollabRooms,
  listCollabUsers,
  listTeams,
  markCollabRoomRead,
  recallCollabMessage,
  deleteCollabMessage,
  forwardCollabMessages,
  refreshCollabInsights,
  checkCollabDraft,
  cancelXiaoceRun,
  sendCollabMessage,
  summarizeCollabRoom,
  translateCollabMessages,
  updateCollabMemberNickname,
  updateCollabRoom,
  type AuthUser,
  type CollabInsight,
  type CollabMessage,
  type CollabUnreadItem,
  type CollabTranslation,
  type CollabReadReceipt,
  type CollabRoom,
  type CollabRoomStats,
  type CollabSearchResult,
  type CollabDraftTip,
  type CollabContextRoomRef,
  type CollabUserBrief,
  type UserSkillItem,
  type XiaoceRun,
  type XiaoceStreamUpdate,
  type McpServer,
  type TeamSummary,
} from "../api/client";
import { Virtuoso, type Components, type VirtuosoHandle } from "react-virtuoso";
import ChatMarkdown from "../components/ChatMarkdown";
import ChatSkillPicker from "../components/ChatSkillPicker";
import ChatTodoModal from "../components/ChatTodoModal";
import CollabTodoPreview from "../components/CollabTodoPreview";
import ChatConnectorPicker, {
  connectorIdsFromMessage,
  connectorPrompt,
} from "../components/ChatConnectorPicker";
import XiaoceProcess from "../components/XiaoceProcess";
import XiaoceStreamingMessage from "../components/XiaoceStreamingMessage";
import XiaoceTaskList from "../components/XiaoceTaskList";
import CollabMonitorBoard from "../components/CollabMonitorBoard";
import CollabMessageSearch from "../components/CollabMessageSearch";
import {
  CollabArtifactsPanel,
  collabArtifactId,
} from "../components/CollabArtifactsPanel";
import { CollabGroupMembersPopover } from "../components/CollabGroupMembersPopover";
import { CollabWelcome } from "../components/CollabWelcome";
import { useCollabRoomLive } from "../hooks/useCollabRoomLive";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useThemeMode } from "../theme/mode";
import {
  applyRoomMutation,
  beginRoomSelection,
  collabParticipantOnline,
  createXiaoceRunId,
  deleteAtomicMentionAtCaret,
  findXiaoceReferenceRooms,
  isRoomAsyncResultCurrent,
  isRoomSelectionCurrent,
  isXiaoceTaskRunning,
  isXiaoceRoom,
  mergeOlderRoomPage,
  mentionMenuScrollTop,
  mergeXiaoceRunSnapshot,
  mergeXiaoceRunSnapshots,
  partitionXiaoceRooms,
  reconcileRoomDetailSnapshot,
  resolveXiaoceDeleteState,
  setRoomPending,
  stabilizeXiaoceRunSnapshot,
  transitionRoomComposer,
  xiaoceDeleteContent,
  type RoomMutation,
} from "./xiaoceChat";
import type { NasResourceHandoff } from "../features/agent-handoff/resourceHandoff";
import { authenticatedAvatarUrl } from "../utils/avatar";
import "../styles/xiaoceChatTheme.css";

const MSG_WINDOW = 30;
const VIRT_BASE_INDEX = 100_000;
/** 有缓存时切房先秒开，超过此时长才后台整窗刷新 */
const ROOM_CACHE_FRESH_MS = 5 * 60_000;
/** 列表加载后空闲预取的会话数 */
const ROOM_PREFETCH_IDLE = 8;

const RISK_META: Record<string, { color: string; label: string }> = {
  green: { color: "success", label: "正常" },
  yellow: { color: "warning", label: "注意" },
  red: { color: "error", label: "高风险" },
};

const FILE_ACCEPT = [
  "image/*",
  ".png,.jpg,.jpeg,.gif,.webp,.bmp",
  ".md,.markdown,.txt,.json,.csv,.py,.log,.yaml,.yml,.xml,.html,.htm,.tsv",
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx",
  ".zip,.rar,.7z,.tar,.gz",
  ".mp3,.wav,.mp4,.mov,.avi",
].join(",");
const MAX_FILES = 5;
const DRAG_ATTACHMENT_TYPE = "application/x-liangce-chat-attachment";
type PendingUpload = { file: File; preview?: string };

function mergePendingUploads(current: PendingUpload[], files: File[]): PendingUpload[] {
  const merged = [...current];
  for (const file of files) {
    if (merged.length >= MAX_FILES) break;
    if (merged.some((item) => item.file.name === file.name && item.file.size === file.size)) continue;
    merged.push({
      file,
      preview: isImageFile(file) ? URL.createObjectURL(file) : undefined,
    });
  }
  return merged;
}

function isImageFile(file: File) {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext);
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function collabAttachUrl(url?: string, download = false) {
  if (!url) return "";
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  // Never leak the platform token to AI-generated files hosted on another origin.
  if (!url.startsWith("/")) return url;
  const token = getAuthToken();
  const parts: string[] = [];
  if (token) parts.push(`token=${encodeURIComponent(token)}`);
  if (download) parts.push("download=1");
  if (!parts.length) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}${parts.join("&")}`;
}

/** 个人头像接口需要鉴权 token */
function authAvatarSrc(url?: string) {
  return authenticatedAvatarUrl(url);
}

type MentionOption = {
  id: string;
  type: "all" | "ai" | "user" | "conversation";
  insert: string;
  label: string;
  desc: string;
  room?: CollabRoom;
};

type MentionState = {
  start: number;
  end: number;
  query: string;
} | null;

function detectMentionAt(text: string, caret: number): MentionState {
  const pos = Number.isFinite(caret)
    ? Math.max(0, Math.min(Math.floor(caret), text.length))
    : text.length;
  const before = text.slice(0, pos);
  const m = before.match(/@([^\s@]*)$/);
  if (!m) return null;
  return { start: pos - m[0].length, end: pos, query: m[1] || "" };
}

function memberLabel(u?: Pick<CollabUserBrief, "username" | "display_name" | "nickname"> | null) {
  if (!u) return "";
  return (u.display_name || u.nickname || u.username || "").trim();
}

function isAutomatedParticipant(
  participant?: Pick<CollabUserBrief, "kind" | "bot_id" | "username"> | null,
) {
  return Boolean(
    participant
    && (
      participant.kind === "bot"
      || participant.bot_id
      || participant.username === "小策bot"
      || participant.username === "良策AI"
    )
  );
}

function buildMentionOptions(
  room: CollabRoom | null,
  me: AuthUser | null,
  query: string,
  referenceRooms: CollabRoom[] = [],
): MentionOption[] {
  const q = query.trim().toLowerCase();
  const list: MentionOption[] = referenceRooms.map((item) => {
    const title = item.display_title || item.title || "小策bot 历史任务";
    return {
      id: `conversation-${item.id}`,
      type: "conversation" as const,
      insert: `@「${title}」 `,
      label: title,
      desc: `引用整个历史任务${typeof item.message_count === "number" ? ` · ${item.message_count} 条消息` : ""}`,
      room: item,
    };
  });
  list.push(
    { id: "all", type: "all", insert: "@所有人 ", label: "所有人", desc: "提醒会话内全部成员" },
    { id: "ai", type: "ai", insert: "@AI ", label: "AI", desc: "召唤良策AI 直接回复" },
  );
  const members = room?.participants || [];
  for (const p of members) {
    if (me && p.id === me.id) continue;
    const name = memberLabel(p);
    list.push({
      id: `user-${p.id}`,
      type: "user",
      insert: `@${p.username} `,
      label: name,
      desc: name !== p.username ? `账号 ${p.username}` : (p.online ? "在线成员" : "成员"),
    });
  }
  if (!q) return list;
  return list.filter(
    (item) =>
      item.label.toLowerCase().includes(q)
      || item.insert.toLowerCase().includes(q)
      || item.desc.toLowerCase().includes(q),
  );
}

function renderMentionContent(content: string, room: CollabRoom | null) {
  if (!content) return null;
  const members = room?.participants || [];
  const names = [
    ...members.map((p) => p.username),
    ...members.map((p) => memberLabel(p)).filter(Boolean),
  ].sort((a, b) => b.length - a.length);
  const specials = ["所有人", "全体", "全体成员", "AI", "ai", "良策AI", "良策ai", ...names];
  const uniq = [...new Set(specials)].filter(Boolean);
  if (!uniq.length) return content;
  const escaped = uniq.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(@(?:${escaped.join("|")}))`, "g");
  const parts = content.split(re);
  return parts.map((part, i) => {
    if (part.startsWith("@") && uniq.some((n) => part === `@${n}` || part.toLowerCase() === `@${n}`.toLowerCase())) {
      const isAi = /^@(AI|ai|良策AI|良策ai)$/.test(part);
      const isAll = /^@(所有人|全体|全体成员)$/.test(part);
      return (
        <span
          key={`${part}-${i}`}
          className={`collab-mention${isAi ? " ai" : ""}${isAll ? " all" : ""}`}
        >
          {part}
        </span>
      );
    }
    return <span key={`t-${i}`}>{part}</span>;
  });
}

function looksLikeMarkdown(content: string) {
  return /(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s*[-*+]\s|(^|\n)\s*\d+\.\s|\*\*[^*]+\*\*|__[^_]+__|```|^\s*>/m.test(content);
}

function isBilingualText(content: string) {
  return /[\u3400-\u4dbf\u4e00-\u9fffA-Za-z]/.test(content || "");
}

function requestsAiResponse(content: string) {
  return /@(?:AI|ai|良策AI|良策ai|小策bot|小策)(?=\s|$)/.test(content || "");
}

function renderMessageBody(content: string, room: CollabRoom | null, asMarkdown: boolean) {
  if (!content) return null;
  if (asMarkdown || looksLikeMarkdown(content)) {
    return (
      <div className="collab-md blocks chat-md">
        <ChatMarkdown content={content} variant="blocks" />
      </div>
    );
  }
  return <p>{renderMentionContent(content, room)}</p>;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/** 企微/微信复制分享时，纯文本常为「[链接]」，真实地址在 text/html 的 <a href> 里。 */
function extractClipboardUrls(cd: DataTransfer): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const add = (raw: string) => {
    let u = (raw || "").trim().replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    if (!u) return;
    try {
      u = decodeURIComponent(u);
    } catch {
      /* keep raw */
    }
    // 去掉尾部常见标点
    u = u.replace(/[),.;，。》」』】\]]+$/g, "");
    if (!/^https?:\/\//i.test(u)) return;
    if (/^(javascript|data|blob):/i.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  const html = cd.getData("text/html") || "";
  if (html) {
    for (const m of html.matchAll(/\b(?:href|data-url|data-link|data-href)\s*=\s*["']([^"']+)["']/gi)) {
      add(m[1]);
    }
    for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
      add(m[0]);
    }
  }
  const uriList = cd.getData("text/uri-list") || "";
  for (const line of uriList.split(/\r?\n/)) {
    if (line && !line.startsWith("#")) add(line);
  }
  // 部分客户端把 URL 放在 text/x-moz-url 第一行
  const moz = cd.getData("text/x-moz-url") || "";
  if (moz) add(moz.split(/\r?\n/)[0] || "");

  return urls;
}

function buildLinkAwarePaste(plain: string, urls: string[]): string | null {
  const text = plain || "";
  const hasPlaceholder = /\[链接\]|【链接】|\[link\]/i.test(text);
  const plainHasUrl = /https?:\/\//i.test(text);
  if (!urls.length) return null;
  // 纯文本已有完整 URL，且没有占位符 → 走浏览器默认粘贴
  if (plainHasUrl && !hasPlaceholder) return null;

  if (hasPlaceholder) {
    let i = 0;
    let out = text.replace(/\[链接\]|【链接】|\[link\]/gi, () => {
      const u = urls[i] || urls[urls.length - 1] || "";
      if (urls[i]) i += 1;
      return u;
    });
    if (i < urls.length) {
      out = `${out.trim()}\n${urls.slice(i).join("\n")}`.trim();
    }
    return out;
  }

  // 纯文本几乎只有「链接」二字，或为空
  const trimmed = text.trim();
  if (!trimmed || /^(链接|LINK)$/i.test(trimmed)) {
    return urls.join("\n");
  }
  // 有说明文字但无 URL：附到后面
  if (!plainHasUrl) {
    return `${trimmed}\n${urls.join("\n")}`;
  }
  return null;
}

function avatarColor(name: string) {
  const colors = ["#315efb", "#2f9e6c", "#d48806", "#cf1322", "#531dab", "#08979c"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * 17) % colors.length;
  return colors[h];
}

function AvatarWithPresence({
  name,
  online,
  size = 40,
  group = false,
  avatarUrl,
}: {
  name: string;
  online?: boolean;
  size?: number;
  group?: boolean;
  avatarUrl?: string;
}) {
  const src = !group ? authAvatarSrc(avatarUrl) : undefined;
  return (
    <span className={`collab-avatar-wrap${online ? " online" : ""}`}>
      <Avatar
        size={size}
        src={src}
        style={{ background: src ? undefined : avatarColor(name), flexShrink: 0 }}
      >
        {group ? <TeamOutlined /> : name.slice(0, 1).toUpperCase()}
      </Avatar>
      <i className="collab-online-dot" aria-hidden />
    </span>
  );
}

function UserProfileCardContent({
  user,
  online,
  roleHint,
  sentAt,
  onMessage,
}: {
  user: CollabUserBrief;
  online?: boolean;
  roleHint?: string;
  sentAt?: string;
  onMessage?: () => void;
}) {
  const label = memberLabel(user) || user.username;
  const src = authAvatarSrc(user.avatar_url);
  const isOnline = online ?? user.online;
  return (
    <div className="collab-profile-card collab-profile-card--detail">
      <div className="collab-profile-card-hero">
        <Avatar
          size={76}
          src={src}
          style={{ background: src ? undefined : avatarColor(label), flexShrink: 0 }}
        >
          {label.slice(0, 1).toUpperCase()}
        </Avatar>
        <div className="collab-profile-card-main">
          <strong>{label}</strong>
          <span className="collab-profile-uname">@{user.username}</span>
          <span className={`collab-profile-online ${isOnline ? "on" : "off"}`}>
            {isOnline ? "在线" : "离线"}
          </span>
        </div>
      </div>
      <dl className="collab-profile-detail-list">
        {user.nickname && user.nickname !== label ? <><dt>群昵称</dt><dd>{user.nickname}</dd></> : null}
        <dt>身份</dt><dd>{roleHint || "团队成员"}</dd>
        <dt>账号</dt><dd>{user.username}</dd>
        {user.bio ? <><dt>简介</dt><dd>{user.bio}</dd></> : null}
        {sentAt ? <><dt>发送时间</dt><dd>{formatChatTimeSep(sentAt)}</dd></> : null}
      </dl>
      {onMessage ? (
        <Button
          type="primary"
          block
          icon={<MessageOutlined />}
          className="collab-profile-message-btn"
          onClick={(event) => {
            event.stopPropagation();
            onMessage();
          }}
        >
          发消息
        </Button>
      ) : null}
    </div>
  );
}

function AiProfileCardContent({
  interject = false,
  suggest = false,
  sentAt,
}: {
  interject?: boolean;
  suggest?: boolean;
  sentAt?: string;
}) {
  const tone = suggest ? "suggest" : interject ? "interject" : "reply";
  return (
    <div className="collab-profile-card">
      <Avatar
        size={52}
        icon={<RobotOutlined />}
        style={{
          background: tone === "interject" ? "#b45309" : "#0f766e",
          flexShrink: 0,
        }}
      />
      <div className="collab-profile-card-main">
        <strong>{tone === "interject" ? "监控提醒" : tone === "suggest" ? "协作建议" : "良策AI"}</strong>
        <span className="collab-profile-uname">@AI</span>
        <p className="collab-profile-bio">
          {tone === "interject"
            ? "旁路发现黄/红风险时主动提醒，属于警告类。"
            : tone === "suggest"
              ? "历史协作建议气泡（现已改为需 @AI 才回复）。"
              : "被 @AI 或 Skill 召唤后才会回复；不会对每条消息自动答题。"}
        </p>
        <span className="collab-profile-online on">在线</span>
        {sentAt ? <span className="collab-profile-sent-at">发送于 {formatChatTimeSep(sentAt)}</span> : null}
      </div>
    </div>
  );
}

function ProfileAvatarPopover({
  children,
  user,
  online,
  roleHint,
  ai,
  interject,
  suggest,
  sentAt,
  placement = "rightTop",
  size = 32,
  onMessage,
}: {
  children?: ReactElement;
  user?: CollabUserBrief | null;
  online?: boolean;
  roleHint?: string;
  ai?: boolean;
  interject?: boolean;
  suggest?: boolean;
  sentAt?: string;
  placement?: TooltipPlacement;
  size?: number;
  onMessage?: () => void;
}) {
  const content = ai
    ? <AiProfileCardContent interject={interject} suggest={suggest} sentAt={sentAt} />
    : (user ? (
      <UserProfileCardContent user={user} online={online} roleHint={roleHint} sentAt={sentAt} onMessage={onMessage} />
    ) : null);

  const label = user
    ? (memberLabel(user) || user.username || "?")
    : (suggest ? "建议" : interject ? "监控" : "AI");
  const src = !ai ? authAvatarSrc(user?.avatar_url) : undefined;
  if (!content) {
    return children ? <>{children}</> : null;
  }

  // 侧栏等外部自定义触发器（已自带尺寸）
  if (children) {
    return (
      <Popover
        content={content}
        trigger="click"
        placement={placement}
        arrow
        destroyOnHidden
        overlayClassName="collab-profile-popover"
      >
        {children}
      </Popover>
    );
  }

  // 消息列表：自绘固定 32×32 圆形，避免 flex 把 Ant Avatar 拉扁
  return (
    <Popover
      content={content}
      trigger="click"
      placement={placement}
      arrow
      destroyOnHidden
      overlayClassName="collab-profile-popover"
    >
      <button
        type="button"
        className="collab-msg-avatar"
        style={{ width: size, height: size, flex: `0 0 ${size}px` }}
        aria-label={`查看 ${label} 的资料`}
      >
        <span
          className="collab-msg-avatar-face"
          style={{
            background: ai
              ? (interject && !suggest ? "#b45309" : "#0f766e")
              : (src ? undefined : avatarColor(label)),
          }}
        >
          {ai ? (
            <RobotOutlined style={{ fontSize: size * 0.45, color: "#fff" }} />
          ) : src ? (
            <img src={src} alt="" draggable={false} />
          ) : (
            label.slice(0, 1).toUpperCase()
          )}
        </span>
      </button>
    </Popover>
  );
}

function participantsPresenceEqual(
  a: CollabUserBrief[] | undefined,
  b: CollabUserBrief[] | undefined,
) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id
      || Boolean(a[i].online) !== Boolean(b[i].online)
      || (a[i].display_name || "") !== (b[i].display_name || "")
      || (a[i].nickname || "") !== (b[i].nickname || "")
      || (a[i].avatar_url || "") !== (b[i].avatar_url || "")
      || (a[i].last_seen || null) !== (b[i].last_seen || null)
      || (a[i].last_read_message_id || 0) !== (b[i].last_read_message_id || 0)
    ) {
      return false;
    }
  }
  return true;
}

const RECALL_MS = 2 * 60 * 1000;
/** 间隔超过此时长才在消息间插入居中时间条 */
const TIME_SEP_GAP_MS = 5 * 60 * 1000;

function formatChatTimeSep(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const time = d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayDiff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (dayDiff === 0) return time;
  if (dayDiff === 1) return `昨天 ${time}`;
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function canRecallMessage(m: CollabMessage, me: AuthUser | null) {
  if (!me) return false;
  if (m.msg_type !== "user") return false;
  if ((m.status || "normal") !== "normal") return false;
  if (m.sender?.id !== me.id) return false;
  const age = Date.now() - new Date(m.created_at).getTime();
  return age >= 0 && age <= RECALL_MS;
}

function mergeMessagePatches(prev: CollabMessage[], patches: CollabMessage[]) {
  let next = [...prev];
  for (const p of patches) {
    if (p.status === "deleted") {
      next = next.filter((m) => m.id !== p.id);
      continue;
    }
    const idx = next.findIndex((m) => m.id === p.id);
    if (idx >= 0) next[idx] = p;
    else next.push(p);
  }
  return next;
}

type ChatAlertMark = {
  label: string;
  level: "yellow" | "red";
  advice: string;
};

/** 把黄/红告警按证据消息挂到聊天气泡上方连线展示 */
function buildChatAlertMap(
  insights: CollabInsight[],
  alerts: CollabRoomStats["alerts"] | undefined,
): Map<number, ChatAlertMark> {
  const rank = { yellow: 1, red: 2 } as const;
  const map = new Map<number, ChatAlertMark>();
  const rows: { risk_level: string; title: string; advice?: string; evidence_message_ids?: number[] }[] = [
    ...insights.filter((i) => i.risk_level === "yellow" || i.risk_level === "red"),
    ...(alerts || []).filter((a) => a.risk_level === "yellow" || a.risk_level === "red"),
  ];
  for (const a of rows) {
    const level: "yellow" | "red" = a.risk_level === "red" ? "red" : "yellow";
    const label = (a.title || "").trim().slice(0, 48);
    if (!label) continue;
    for (const mid of a.evidence_message_ids || []) {
      const id = Number(mid);
      if (!Number.isFinite(id)) continue;
      const prev = map.get(id);
      if (!prev || rank[level] >= rank[prev.level]) {
        map.set(id, {
          label,
          level,
          advice: (a.advice || "").trim(),
        });
      }
    }
  }
  return map;
}

export type CollabRoundtableSeed = {
  title: string;
  intro: string;
  userIds: number[];
  sourceRoomId?: string;
};

type CollabRiskProps = {
  embedded?: boolean;
  panel?: "chats" | "contacts";
  onPanelChange?: (panel: "chats" | "contacts") => void;
  onStartRoundtable?: (seed?: CollabRoundtableSeed) => void;
};

type CollabMessageListContext = {
  loadingOlder: boolean;
  hasMoreBefore: boolean;
  xiaoceRun: XiaoceRun | null;
  xiaoceStream: XiaoceStreamUpdate | null;
};

function CollabMessageListHeader({ context }: { context: CollabMessageListContext }) {
  return (
    <div className="collab-msg-history-tip">
      {context.loadingOlder
        ? "加载更早消息…"
        : context.hasMoreBefore ? "上滑加载更早消息" : "已到会话开头"}
    </div>
  );
}

function CollabMessageListFooter({ context }: { context: CollabMessageListContext }) {
  return (
    <XiaoceStreamingMessage
      run={context.xiaoceRun}
      stream={context.xiaoceStream}
    />
  );
}

const COLLAB_MESSAGE_LIST_COMPONENTS: Components<
  CollabMessage,
  CollabMessageListContext
> = {
  Header: CollabMessageListHeader,
  Footer: CollabMessageListFooter,
};

export default function CollabRisk({
  embedded = false,
  panel,
  onPanelChange,
  onStartRoundtable,
}: CollabRiskProps) {
  const { message } = App.useApp();
  const { mode, setMode } = useThemeMode();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [rooms, setRooms] = useState<CollabRoom[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeRoom, setActiveRoom] = useState<CollabRoom | null>(null);
  const [messages, setMessages] = useState<CollabMessage[]>([]);
  const [insights, setInsights] = useState<CollabInsight[]>([]);
  const [roomStats, setRoomStats] = useState<CollabRoomStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  draftRef.current = draft;
  type RoomComposerCache = {
    draft: string;
    pendingFiles: PendingUpload[];
    replyingTo: CollabMessage | null;
    referencedRoom: CollabRoom | null;
  };
  type RoomViewCache = {
    room: CollabRoom;
    messages: CollabMessage[];
    insights: CollabInsight[];
    hasMoreBefore: boolean;
    firstItemIndex: number;
    xiaoceRun: XiaoceRun | null;
    stats: CollabRoomStats | null;
    fetchedAt: number;
  };
  const roomComposerCacheRef = useRef<Map<string, RoomComposerCache>>(new Map());
  const roomViewCacheRef = useRef<Map<string, RoomViewCache>>(new Map());
  const roomDataRevisionRef = useRef<Map<string, number>>(new Map());
  const roomLoadSeqRef = useRef(0);
  const roomPrefetchRef = useRef<Set<string>>(new Set());
  const prevActiveIdForComposerRef = useRef<string | null>(null);
  const [draftCoach, setDraftCoach] = useState<{
    level: string;
    tips: CollabDraftTip[];
    label: string;
    advice: string;
  } | null>(null);
  const [draftCoachLoading, setDraftCoachLoading] = useState(false);
  const [sendingRoomIds, setSendingRoomIds] = useState<Set<string>>(() => new Set());
  const [activeXiaoceRun, setActiveXiaoceRun] = useState<XiaoceRun | null>(null);
  const [xiaoceStreamsByRoom, setXiaoceStreamsByRoom] = useState<
    Record<string, XiaoceStreamUpdate>
  >({});
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [skillRefreshKey, setSkillRefreshKey] = useState(0);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [siderTab, setSiderTab] = useState<"chats" | "contacts">("chats");
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const switchSiderTab = useCallback((next: "chats" | "contacts") => {
    setSiderTab(next);
    onPanelChange?.(next);
  }, [onPanelChange]);
  const [contacts, setContacts] = useState<CollabUserBrief[]>([]);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<number>>(() => new Set());
  const [contactKeyword, setContactKeyword] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupTeamIds, setGroupTeamIds] = useState<number[]>([]);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembersOpen, setGroupMembersOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteMembers, setInviteMembers] = useState<string[]>([]);
  const [inviting, setInviting] = useState(false);
  const [kickOpen, setKickOpen] = useState(false);
  const [kickMembers, setKickMembers] = useState<string[]>([]);
  const [kicking, setKicking] = useState(false);
  const [nickOpen, setNickOpen] = useState(false);
  const [nickDrafts, setNickDrafts] = useState<Record<string, string>>({});
  const [nickSaving, setNickSaving] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingXiaoce, setCreatingXiaoce] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [replyingTo, setReplyingTo] = useState<CollabMessage | null>(null);
  const [todoSource, setTodoSource] = useState<CollabMessage | null>(null);
  const [todoOpen, setTodoOpen] = useState(false);
  const [referencedRoom, setReferencedRoom] = useState<CollabRoom | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [translations, setTranslations] = useState<Record<number, CollabTranslation>>({});
  const [translationPendingIds, setTranslationPendingIds] = useState<Set<number>>(() => new Set());
  const [pendingFiles, setPendingFiles] = useState<PendingUpload[]>([]);
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [roomDropTargetId, setRoomDropTargetId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<number>>(() => new Set());
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardMessageIds, setForwardMessageIds] = useState<number[]>([]);
  const [forwardMode, setForwardMode] = useState<"merge" | "separate">("separate");
  const [forwardTargetId, setForwardTargetId] = useState<string | undefined>();
  const [forwardSubmitting, setForwardSubmitting] = useState(false);
  const [mention, setMention] = useState<MentionState>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [composerMinHeight, setComposerMinHeight] = useState(0);
  const mentionMenuRef = useRef<HTMLDivElement | null>(null);
  const composerBoxRef = useRef<HTMLDivElement | null>(null);
  const composerResizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    currentHeight: number;
    pendingHeight: number;
    frameId: number | null;
  } | null>(null);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [roomDetailLoading, setRoomDetailLoading] = useState(false);
  const [summaryVisible, setSummaryVisible] = useState(() => {
    try { return window.localStorage.getItem("collab-summary-visible") !== "0"; }
    catch { return true; }
  });
  const [artifactsVisible, setArtifactsVisible] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState("");
  const [messagesAtBottom, setMessagesAtBottom] = useState(true);
  const [firstItemIndex, setFirstItemIndex] = useState(VIRT_BASE_INDEX);
  const stickBottomRef = useRef(true);
  const forceStickUntilRef = useRef(0);
  const manualScrollUntilRef = useRef(0);
  const initialBottomRoomRef = useRef<string | null>(null);
  const initialBottomSettleUntilRef = useRef(0);
  const bottomScrollFrameRef = useRef<number | null>(null);
  const bottomScrollBehaviorRef = useRef<"auto" | "smooth">("auto");
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const messageScrollerRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<any>(null);
  const botRoomRequestRef = useRef<ReturnType<typeof createCollabRoom> | null>(null);
  const draftCoachSeq = useRef(0);
  const draftCoachTimer = useRef<number | null>(null);
  const messagesRef = useRef<CollabMessage[]>([]);
  const insightsRef = useRef<CollabInsight[]>([]);
  const roomsRef = useRef<CollabRoom[]>([]);
  const activeRoomRef = useRef<CollabRoom | null>(null);
  const activeXiaoceRunRef = useRef<XiaoceRun | null>(null);
  const pendingFilesRef = useRef<PendingUpload[]>([]);
  const replyingToRef = useRef<CollabMessage | null>(null);
  const referencedRoomRef = useRef<CollabRoom | null>(null);
  const hasMoreBeforeRef = useRef(false);
  const firstItemIndexRef = useRef(VIRT_BASE_INDEX);
  const roomStatsRef = useRef<CollabRoomStats | null>(null);
  const sendingRoomIdsRef = useRef<Set<string>>(new Set());
  const contactKeywordRef = useRef("");
  const contactsRef = useRef<CollabUserBrief[]>([]);
  const contactSearchTimerRef = useRef<number | null>(null);
  const contactsLoadedRef = useRef(false);
  const teamsLoadedRef = useRef(false);
  const translationInFlightRef = useRef<Set<number>>(new Set());
  const loadingOlderRequestRef = useRef<Map<string, number>>(new Map());
  const pendingSearchTargetRef = useRef<{ roomId: string; messageId: number } | null>(null);
  const readSessionRef = useRef(
    `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const readActiveSinceRef = useRef(Date.now());
  const activeIdRef = useRef<string | null>(null);

  messagesRef.current = messages;
  insightsRef.current = insights;
  roomsRef.current = rooms;
  activeRoomRef.current = activeRoom;
  activeXiaoceRunRef.current = activeXiaoceRun;
  pendingFilesRef.current = pendingFiles;
  replyingToRef.current = replyingTo;
  referencedRoomRef.current = referencedRoom;
  hasMoreBeforeRef.current = hasMoreBefore;
  firstItemIndexRef.current = firstItemIndex;
  roomStatsRef.current = roomStats;
  useEffect(() => { contactKeywordRef.current = contactKeyword; }, [contactKeyword]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const xiaoceRoom = isXiaoceRoom(activeRoom);
  const agentBusy = activeXiaoceRun?.status === "running";
  const xiaoceBusy = xiaoceRoom && agentBusy;
  const activeXiaoceStream = activeId ? xiaoceStreamsByRoom[activeId] || null : null;
  const collabMessageListContext = useMemo<CollabMessageListContext>(() => ({
    loadingOlder,
    hasMoreBefore,
    xiaoceRun: agentBusy ? activeXiaoceRun : null,
    xiaoceStream: activeXiaoceStream,
  }), [
    activeXiaoceRun,
    activeXiaoceStream,
    hasMoreBefore,
    loadingOlder,
    agentBusy,
  ]);
  const sending = Boolean(activeId && sendingRoomIds.has(activeId));
  const { xiaoceTasks, otherRooms } = useMemo(
    () => partitionXiaoceRooms(rooms),
    [rooms],
  );
  const forwardRoomOptions = useMemo(() => rooms
    .filter((room) => (
      room.status === "open"
      && room.id !== activeId
      && !isXiaoceRoom(room)
      && (!me || room.participants.some((participant) => participant.id === me.id))
    ))
    .map((room) => ({
      value: room.id,
      label: room.display_title || room.title || "未命名会话",
    })), [activeId, me, rooms]);
  const renameTarget = useMemo(
    () => rooms.find((room) => room.id === renameTargetId)
      || (activeRoom?.id === renameTargetId ? activeRoom : null),
    [activeRoom, renameTargetId, rooms],
  );
  const renamingXiaoce = isXiaoceRoom(renameTarget);

  const markRoomSending = useCallback((roomId: string, pending: boolean) => {
    const next = setRoomPending(sendingRoomIdsRef.current, roomId, pending);
    sendingRoomIdsRef.current = next;
    setSendingRoomIds(next);
  }, []);

  const getRoomDataRevision = useCallback(
    (roomId: string) => roomDataRevisionRef.current.get(roomId) || 0,
    [],
  );

  const bumpRoomDataRevision = useCallback((roomId: string) => {
    const next = (roomDataRevisionRef.current.get(roomId) || 0) + 1;
    roomDataRevisionRef.current.set(roomId, next);
    return next;
  }, []);

  const mutateRoomData = useCallback((roomId: string, mutation: RoomMutation) => {
    if (
      activeIdRef.current === roomId
      && activeRoomRef.current
      && !roomViewCacheRef.current.has(roomId)
    ) {
      roomViewCacheRef.current.set(roomId, {
        room: activeRoomRef.current,
        messages: messagesRef.current,
        insights: insightsRef.current,
        hasMoreBefore: hasMoreBeforeRef.current,
        firstItemIndex: firstItemIndexRef.current,
        xiaoceRun: activeXiaoceRunRef.current,
        stats: roomStatsRef.current,
        fetchedAt: Date.now(),
      });
    }
    const next = applyRoomMutation({
      roomId,
      revision: getRoomDataRevision(roomId),
      rooms: roomsRef.current,
      cache: roomViewCacheRef.current,
      activeRoomId: activeIdRef.current,
      activeRoom: activeRoomRef.current,
      activeMessages: messagesRef.current,
      activeRun: activeXiaoceRunRef.current,
    }, mutation);
    roomDataRevisionRef.current.set(roomId, next.revision);
    roomViewCacheRef.current = next.cache;
    roomsRef.current = next.rooms;
    setRooms(next.rooms);
    if (activeIdRef.current === roomId) {
      activeRoomRef.current = next.activeRoom;
      messagesRef.current = next.activeMessages;
      activeXiaoceRunRef.current = next.activeRun;
      setActiveRoom(next.activeRoom);
      setMessages(next.activeMessages);
      setActiveXiaoceRun(next.activeRun);
    }
    return next;
  }, [getRoomDataRevision]);

  const setSummaryPanelVisible = useCallback((visible: boolean) => {
    if (visible) setArtifactsVisible(false);
    setSummaryVisible(visible);
    try { window.localStorage.setItem("collab-summary-visible", visible ? "1" : "0"); }
    catch { /* 浏览器禁用本地存储时仍保持当前会话状态 */ }
  }, []);

  const setArtifactPanelVisible = useCallback((visible: boolean) => {
    setArtifactsVisible(visible);
    if (visible) {
      setSummaryVisible(false);
      try { window.localStorage.setItem("collab-summary-visible", "0"); }
      catch { /* ignore */ }
    }
  }, []);

  const openArtifactPreview = useCallback((messageId: number, attachmentId: string) => {
    setSelectedArtifactId(collabArtifactId(messageId, attachmentId));
    setArtifactPanelVisible(true);
  }, [setArtifactPanelVisible]);

  const isParticipant = useMemo(() => {
    if (!me || !activeRoom) return false;
    return (activeRoom.participants || []).some((p) => p.id === me.id);
  }, [me, activeRoom]);

  const isXiaoce = xiaoceRoom;

  const canSendMessage = Boolean(
    activeRoom
    && isParticipant
    && activeRoom.status !== "closed"
    && !xiaoceBusy
    && !sending
    && (draft.trim() || pendingFiles.length > 0 || referencedRoom),
  );

  const canKickMembers = useMemo(() => {
    if (!me || !activeRoom || activeRoom.room_kind !== "group") return false;
    if (!isParticipant) return false;
    return Boolean(me.is_staff || activeRoom.created_by?.id === me.id);
  }, [me, activeRoom, isParticipant]);

  const canDeleteRoom = useMemo(() => {
    if (!me || !activeRoom) return false;
    if (!isParticipant) return false;
    if (me.is_staff) return true;
    if (activeRoom.room_kind === "group") {
      return activeRoom.created_by?.id === me.id;
    }
    return true;
  }, [me, activeRoom, isParticipant]);

  const bannerInsight = useMemo(() => {
    const latest = insights[insights.length - 1];
    return latest && (latest.risk_level === "red" || latest.risk_level === "yellow")
      ? latest
      : null;
  }, [insights]);

  const chatAlertByMsgId = useMemo(
    () => buildChatAlertMap(insights, roomStats?.alerts),
    [insights, roomStats?.alerts],
  );

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.status !== "deleted"),
    [messages],
  );

  const toggleMessageTranslation = useCallback((target: CollabMessage) => {
    if (translations[target.id]) {
      setTranslations((current) => {
        const next = { ...current };
        delete next[target.id];
        return next;
      });
      return;
    }
    const roomId = activeIdRef.current;
    if (
      !roomId
      || target.id <= 0
      || target.status === "recalled"
      || target.msg_type === "system"
      || !isBilingualText(target.content || "")
      || Array.isArray(target.meta?.forward_bundle)
      || translationInFlightRef.current.has(target.id)
    ) return;
    const messageId = target.id;
    translationInFlightRef.current.add(messageId);
    setTranslationPendingIds((current) => new Set([...current, messageId]));
    void translateCollabMessages(roomId, [messageId])
      .then((result) => {
        const translated = result.translations?.[0];
        if (!translated) throw new Error("翻译服务未返回结果");
        setTranslations((current) => ({ ...current, [translated.message_id]: translated }));
      })
      .catch((error: any) => {
        message.error(error?.response?.data?.error || error?.message || "消息翻译失败，请稍后重试");
      })
      .finally(() => {
        translationInFlightRef.current.delete(messageId);
        setTranslationPendingIds((current) => {
          const next = new Set(current);
          next.delete(messageId);
          return next;
        });
      });
  }, [message, translations]);

  const timeSepBeforeId = useMemo(() => {
    const show = new Set<number>();
    let lastTs = 0;
    for (const m of visibleMessages) {
      const ts = new Date(m.created_at).getTime();
      if (!Number.isFinite(ts)) continue;
      if (!lastTs || ts - lastTs >= TIME_SEP_GAP_MS) {
        show.add(m.id);
      }
      lastTs = ts;
    }
    return show;
  }, [visibleMessages]);

  const scheduleMessagesToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
    bottomScrollBehaviorRef.current = behavior;
    if (bottomScrollFrameRef.current !== null) return;
    bottomScrollFrameRef.current = window.requestAnimationFrame(() => {
      bottomScrollFrameRef.current = null;
      virtuosoRef.current?.scrollTo({
        top: Number.MAX_SAFE_INTEGER,
        behavior: bottomScrollBehaviorRef.current,
      });
    });
  }, []);

  const scrollMessagesToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
    stickBottomRef.current = true;
    forceStickUntilRef.current = Date.now() + 180;
    setMessagesAtBottom(true);
    scheduleMessagesToBottom(behavior);
  }, [scheduleMessagesToBottom]);

  useEffect(() => {
    if (!activeXiaoceStream?.content || !stickBottomRef.current) return;
    scheduleMessagesToBottom("auto");
  }, [activeXiaoceStream?.content, scheduleMessagesToBottom]);

  const releaseMessageAutoScroll = useCallback(() => {
    stickBottomRef.current = false;
    forceStickUntilRef.current = 0;
    manualScrollUntilRef.current = Date.now() + 600;
    initialBottomRoomRef.current = null;
    initialBottomSettleUntilRef.current = 0;
    if (bottomScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(bottomScrollFrameRef.current);
      bottomScrollFrameRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (bottomScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(bottomScrollFrameRef.current);
    }
  }, []);

  const beginComposerResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const textarea = composerRef.current?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
    const startHeight = textarea?.getBoundingClientRect().height || 72;
    composerResizeRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
      currentHeight: startHeight,
      pendingHeight: startHeight,
      frameId: null,
    };
    composerBoxRef.current?.classList.add("is-resizing");
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const moveComposerResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = composerResizeRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const viewportLimit = Math.max(120, window.innerHeight - 260);
    const nextHeight = Math.max(
      56,
      Math.min(viewportLimit, session.startHeight + session.startY - event.clientY),
    );
    session.pendingHeight = Math.round(nextHeight);
    if (session.frameId !== null) return;
    const pointerId = event.pointerId;
    session.frameId = window.requestAnimationFrame(() => {
      const liveSession = composerResizeRef.current;
      if (!liveSession || liveSession.pointerId !== pointerId) return;
      liveSession.frameId = null;
      liveSession.currentHeight = liveSession.pendingHeight;
      composerBoxRef.current?.style.setProperty(
        "--collab-composer-min-height",
        `${liveSession.currentHeight}px`,
      );
    });
  }, []);

  const finishComposerResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = composerResizeRef.current;
    if (session?.pointerId !== event.pointerId) return;
    if (session.frameId !== null) window.cancelAnimationFrame(session.frameId);
    session.currentHeight = session.pendingHeight;
    composerBoxRef.current?.style.setProperty(
      "--collab-composer-min-height",
      `${session.currentHeight}px`,
    );
    setComposerMinHeight(session.currentHeight);
    composerResizeRef.current = null;
    composerBoxRef.current?.classList.remove("is-resizing");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const loadRooms = useCallback(async (
    selectFirst = false,
    options?: { silent?: boolean },
  ) => {
    const silent = Boolean(options?.silent);
    if (!silent) setLoadingRooms(true);
    const revisionsAtStart = new Map(roomDataRevisionRef.current);
    try {
      const data = await listCollabRooms();
      setRooms((current) => {
        const currentById = new Map(current.map((room) => [room.id, room]));
        const next = (data.results || []).map((room) => ({
          ...room,
          unread_count: room.id === activeIdRef.current ? 0 : room.unread_count,
          active_xiaoce_run: mergeXiaoceRunSnapshot(
            currentById.get(room.id)?.active_xiaoce_run || null,
            room.active_xiaoce_run || null,
            {
              authoritative: true,
              requestRevision: revisionsAtStart.get(room.id) || 0,
              currentRevision: getRoomDataRevision(room.id),
            },
          ),
        }));
        roomsRef.current = next;
        return next;
      });
      if (selectFirst && !activeId && data.results?.[0]) {
        setActiveId(data.results[0].id);
      }
    } catch {
      if (!silent) message.error("加载协作会话失败");
    } finally {
      if (!silent) setLoadingRooms(false);
    }
  }, [activeId, getRoomDataRevision, message]);

  useEffect(() => {
    let authoritativeRefreshTimer: number | null = null;
    const onUnreadSnapshot = (event: Event) => {
      const items = (
        event as CustomEvent<{ items?: CollabUnreadItem[] }>
      ).detail?.items || [];
      const unreadByRoomId = new Map(items.map((item) => [item.room_id, item]));
      setRooms((current) => {
        const next = current.map((room) => {
          const unread = unreadByRoomId.get(room.id);
          if (!unread) {
            return room.unread_count ? { ...room, unread_count: 0 } : room;
          }
          const riskLevel = unread.risk_level;
          return {
            ...room,
            title: unread.title || room.title,
            risk_level: (
              riskLevel === "green" || riskLevel === "yellow" || riskLevel === "red"
            ) ? riskLevel : room.risk_level,
            updated_at: unread.updated_at || room.updated_at,
            last_message: unread.last_message || room.last_message,
            unread_count: unread.unread_count,
          };
        });
        roomsRef.current = next;
        return next;
      });
      if (authoritativeRefreshTimer !== null) {
        window.clearTimeout(authoritativeRefreshTimer);
      }
      authoritativeRefreshTimer = window.setTimeout(() => {
        authoritativeRefreshTimer = null;
        void loadRooms(false, { silent: true });
      }, 120);
    };
    window.addEventListener("liangce:collab-rooms-snapshot", onUnreadSnapshot);
    return () => {
      window.removeEventListener("liangce:collab-rooms-snapshot", onUnreadSnapshot);
      if (authoritativeRefreshTimer !== null) {
        window.clearTimeout(authoritativeRefreshTimer);
      }
    };
  }, [loadRooms]);

  const primeRoomSnapshot = useCallback((room: CollabRoom) => {
    const roomMessages = room.messages || [];
    const roomInsights = room.insights || [];
    const xiaoceRun = room.active_xiaoce_run || null;
    roomViewCacheRef.current.set(room.id, {
      room,
      messages: roomMessages,
      insights: roomInsights,
      hasMoreBefore: Boolean(room.has_more_before),
      firstItemIndex: VIRT_BASE_INDEX,
      xiaoceRun,
      stats: roomViewCacheRef.current.get(room.id)?.stats || null,
      fetchedAt: Date.now(),
    });
    setRooms((previous) => [room, ...previous.filter((item) => item.id !== room.id)]);
  }, []);

  const loadRoomDetail = useCallback(async (
    id: string,
    opts?: { soft?: boolean; targetMessageId?: number },
  ) => {
    const targetMessageId = opts?.targetMessageId;
    const soft = !targetMessageId && Boolean(opts?.soft);
    const seq = ++roomLoadSeqRef.current;
    const requestRevision = getRoomDataRevision(id);
    const cachedAtStart = roomViewCacheRef.current.get(id);
    const requestStartMessageIds = activeIdRef.current === id
      ? messagesRef.current.map((row) => row.id)
      : cachedAtStart?.messages.map((row) => row.id) || [];
    const hadCache = Boolean(cachedAtStart);
    const cacheFresh = Boolean(
      cachedAtStart && Date.now() - (cachedAtStart.fetchedAt || 0) < ROOM_CACHE_FRESH_MS,
    );
    if (targetMessageId || (!soft && !hadCache)) setRoomDetailLoading(true);

    const applyMessages = (
      page: Awaited<ReturnType<typeof listCollabMessages>>,
      roomBase: CollabRoom,
      insights: CollabInsight[],
    ) => {
      if (seq !== roomLoadSeqRef.current || activeIdRef.current !== id) return;
      const hydratedRoom = {
        ...roomBase,
        ...page.room,
        messages: page.results,
        has_more_before: page.has_more_before,
      } as CollabRoom;
      const cachedAtResolution = roomViewCacheRef.current.get(id);
      const currentMessages = activeIdRef.current === id
        ? messagesRef.current
        : cachedAtResolution?.messages || [];
      const currentRun = activeIdRef.current === id
        ? activeXiaoceRunRef.current
        : cachedAtResolution?.xiaoceRun || null;
      const pageRun = page.room?.active_xiaoce_run || hydratedRoom.active_xiaoce_run || null;
      const stablePageRun = stabilizeXiaoceRunSnapshot(
        currentRun,
        pageRun,
        [...(page.results || []), ...currentMessages],
      );
      const reconciled = reconcileRoomDetailSnapshot({
        pageMessages: page.results || [],
        currentMessages,
        requestStartMessageIds,
        pageRun: stablePageRun,
        currentRun,
        requestRevision,
        currentRevision: getRoomDataRevision(id),
      });
      const nextMessages = reconciled.messages;
      const nextHasMore = Boolean(page.has_more_before ?? roomBase.has_more_before);
      const nextXiaoce = reconciled.xiaoceRun;
      const reconciledRoom = { ...hydratedRoom, active_xiaoce_run: nextXiaoce };
      activeXiaoceRunRef.current = nextXiaoce;
      activeRoomRef.current = reconciledRoom;
      messagesRef.current = nextMessages;
      setActiveRoom(reconciledRoom);
      setActiveXiaoceRun(nextXiaoce);
      setMessages(nextMessages);
      setInsights(insights);
      setHasMoreBefore(nextHasMore);
      if (targetMessageId) {
        setFirstItemIndex(VIRT_BASE_INDEX);
        setHighlightId(targetMessageId);
        stickBottomRef.current = false;
        forceStickUntilRef.current = 0;
        initialBottomRoomRef.current = null;
        initialBottomSettleUntilRef.current = 0;
        const targetIndex = nextMessages
          .filter((item) => item.status !== "deleted")
          .findIndex((item) => item.id === targetMessageId);
        if (targetIndex >= 0) {
          const scrollToTarget = () => {
            virtuosoRef.current?.scrollToIndex({
              index: VIRT_BASE_INDEX + targetIndex,
              align: "center",
              behavior: "smooth",
            });
            document.getElementById(`collab-msg-${targetMessageId}`)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          };
          requestAnimationFrame(() => {
            scrollToTarget();
            window.setTimeout(scrollToTarget, 100);
          });
        }
      } else if (!soft || !cachedAtResolution) {
        setFirstItemIndex(VIRT_BASE_INDEX);
        stickBottomRef.current = true;
        forceStickUntilRef.current = Date.now() + 240;
        initialBottomRoomRef.current = id;
        initialBottomSettleUntilRef.current = Date.now() + 1_200;
        window.setTimeout(() => scrollMessagesToBottom("auto"), 40);
      }
      roomViewCacheRef.current.set(id, {
        room: reconciledRoom,
        messages: nextMessages,
        insights,
        hasMoreBefore: nextHasMore,
        firstItemIndex: !targetMessageId && soft && cachedAtResolution
          ? cachedAtResolution.firstItemIndex
          : VIRT_BASE_INDEX,
        xiaoceRun: nextXiaoce,
        stats: roomViewCacheRef.current.get(id)?.stats || null,
        fetchedAt: Date.now(),
      });
      setRoomDetailLoading(false);
    };

    try {
      // 有新鲜缓存：后台静默增量，不挡 UI
      if (soft && cacheFresh && cachedAtStart) {
        const afterId = cachedAtStart.messages.reduce(
          (max, row) => (row.id > max ? row.id : max),
          0,
        );
        const page = await listCollabMessages(id, {
          afterId: afterId || undefined,
          limit: MSG_WINDOW,
          lite: true,
          includeParticipants: false,
        });
        if (seq !== roomLoadSeqRef.current || activeIdRef.current !== id) return;
        const incoming = page.results || [];
        if (!incoming.length) {
          roomViewCacheRef.current.set(id, { ...cachedAtStart, fetchedAt: Date.now() });
          return;
        }
        const byId = new Map<number, CollabMessage>();
        for (const m of cachedAtStart.messages) byId.set(m.id, m);
        for (const m of incoming) byId.set(m.id, m);
        const merged = [...byId.values()].sort(
          (a, b) => a.id - b.id || a.created_at.localeCompare(b.created_at),
        );
        const pageRun = page.room?.active_xiaoce_run || null;
        const stablePageRun = stabilizeXiaoceRunSnapshot(
          cachedAtStart.xiaoceRun,
          pageRun,
          [...incoming, ...cachedAtStart.messages],
        );
        const nextRun = mergeXiaoceRunSnapshot(cachedAtStart.xiaoceRun, stablePageRun, {
          authoritative: true,
          requestRevision,
          currentRevision: getRoomDataRevision(id),
        });
        const reconciledRoom = {
          ...cachedAtStart.room,
          ...page.room,
          active_xiaoce_run: nextRun,
        } as CollabRoom;
        activeRoomRef.current = reconciledRoom;
        messagesRef.current = merged;
        activeXiaoceRunRef.current = nextRun;
        setActiveRoom(reconciledRoom);
        setMessages(merged);
        setActiveXiaoceRun(nextRun);
        roomViewCacheRef.current.set(id, {
          ...cachedAtStart,
          room: reconciledRoom,
          messages: merged,
          xiaoceRun: nextRun,
          fetchedAt: Date.now(),
        });
        return;
      }

      // 首屏只拉消息（lite），用列表摘要秒开标题；详情/纪要后台补
      const listRoom = roomsRef.current.find((room) => room.id === id) || cachedAtStart?.room || null;
      const page = await listCollabMessages(id, {
        limit: MSG_WINDOW,
        aroundId: targetMessageId,
        lite: true,
        includeParticipants: false,
      });
      const roomBase = {
        id,
        title: "正在打开会话…",
        display_title: "正在打开会话…",
        room_kind: "dm",
        participants: [],
        status: "open",
        risk_level: "green",
        messages: [],
        insights: [],
        ...(listRoom || {}),
        active_xiaoce_run: listRoom?.active_xiaoce_run || null,
      } as CollabRoom;
      applyMessages(page, roomBase, cachedAtStart?.insights || []);

      // 后台只补纪要/统计，避免整窗消息二次替换造成闪动
      void getCollabRoom(id, { includeMessages: false })
        .then((room) => {
          if (seq !== roomLoadSeqRef.current || activeIdRef.current !== id) return;
          const insights = room.insights || [];
          setInsights(insights);
          setActiveRoom((prev) => {
            if (!prev || prev.id !== id) return prev;
            const next = {
              ...prev,
              ...room,
              messages: undefined,
              active_xiaoce_run: prev.active_xiaoce_run,
            } as CollabRoom;
            activeRoomRef.current = next;
            const cached = roomViewCacheRef.current.get(id);
            if (cached) {
              roomViewCacheRef.current.set(id, {
                ...cached,
                room: next,
                insights,
              });
            }
            return next;
          });
        })
        .catch(() => { /* ignore */ });
      void getCollabRoomStats(id)
        .then((st) => {
          if (seq !== roomLoadSeqRef.current || activeIdRef.current !== id) return;
          setRoomStats(st);
          const cached = roomViewCacheRef.current.get(id);
          if (cached) roomViewCacheRef.current.set(id, { ...cached, stats: st });
        })
        .catch(() => {
          if (seq === roomLoadSeqRef.current && activeIdRef.current === id) {
            setRoomStats(null);
          }
        });
    } catch {
      if (seq === roomLoadSeqRef.current && activeIdRef.current === id) {
        message.error("读取会话失败");
        setRoomDetailLoading(false);
      }
    }
  }, [getRoomDataRevision, message, scrollMessagesToBottom]);

  const prefetchRoom = useCallback((roomId: string) => {
    if (!roomId || roomId === activeIdRef.current) return;
    if (roomViewCacheRef.current.has(roomId)) return;
    if (roomPrefetchRef.current.has(roomId)) return;
    roomPrefetchRef.current.add(roomId);
    void listCollabMessages(roomId, {
      limit: MSG_WINDOW,
      lite: true,
      includeParticipants: false,
    })
      .then((page) => {
        if (roomViewCacheRef.current.has(roomId)) return;
        const listRoom = roomsRef.current.find((room) => room.id === roomId) || null;
        const hydratedRoom = {
          ...(listRoom || { id: roomId } as CollabRoom),
          ...page.room,
          messages: page.results,
          has_more_before: page.has_more_before,
        } as CollabRoom;
        const nextXiaoce = hydratedRoom.active_xiaoce_run || listRoom?.active_xiaoce_run || null;
        roomViewCacheRef.current.set(roomId, {
          room: hydratedRoom,
          messages: page.results || [],
          insights: [],
          hasMoreBefore: Boolean(page.has_more_before),
          firstItemIndex: VIRT_BASE_INDEX,
          xiaoceRun: nextXiaoce,
          stats: null,
          fetchedAt: Date.now(),
        });
      })
      .catch(() => { /* 预取失败忽略 */ })
      .finally(() => {
        roomPrefetchRef.current.delete(roomId);
      });
  }, []);

  const selectRoom = useCallback((roomId: string) => {
    if (roomId === activeIdRef.current) return;
    setGroupMembersOpen(false);
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
    // 先把当前会话的输入框状态存起来
    const prevId = beginRoomSelection(activeIdRef, roomLoadSeqRef, roomId);
    setStatsLoading(false);
    setLoadingOlder(
      loadingOlderRequestRef.current.get(roomId) === roomLoadSeqRef.current,
    );
    const composerTransition = transitionRoomComposer(
      roomComposerCacheRef.current,
      prevId,
      roomId,
      {
        draft: draftRef.current,
        pendingFiles: pendingFilesRef.current,
        replyingTo: replyingToRef.current,
        referencedRoom: referencedRoomRef.current,
      },
    );
    roomComposerCacheRef.current = composerTransition.cache;
    if (prevId) {
      const previousRoom = activeRoomRef.current;
      if (previousRoom && previousRoom.id === prevId) {
        roomViewCacheRef.current.set(prevId, {
          room: previousRoom,
          messages: messagesRef.current,
          insights: insightsRef.current,
          hasMoreBefore: hasMoreBeforeRef.current,
          firstItemIndex: firstItemIndexRef.current,
          xiaoceRun: activeXiaoceRunRef.current,
          stats: roomStatsRef.current,
          fetchedAt: roomViewCacheRef.current.get(prevId)?.fetchedAt || Date.now(),
        });
      }
    }
    // 立刻切 UI：恢复该会话草稿 / 缓存消息，避免共用输入框和白屏等待
    const composer = composerTransition.composer;
    setDraft(composer.draft);
    setPendingFiles(composer.pendingFiles);
    setReplyingTo(composer.replyingTo);
    setReferencedRoom(composer.referencedRoom);
    setMention(null);
    setMentionIndex(0);
    setDraftCoach(null);
    setDraftCoachLoading(false);
    if (draftCoachTimer.current) {
      window.clearTimeout(draftCoachTimer.current);
      draftCoachTimer.current = null;
    }
    draftCoachSeq.current += 1;

    const cached = roomViewCacheRef.current.get(roomId);
    const hasPendingTarget = pendingSearchTargetRef.current?.roomId === roomId;
    initialBottomRoomRef.current = hasPendingTarget ? null : roomId;
    initialBottomSettleUntilRef.current = hasPendingTarget ? 0 : Date.now() + 1_200;
    if (cached) {
      setActiveRoom(cached.room);
      setMessages(cached.messages);
      setInsights(cached.insights);
      setHasMoreBefore(cached.hasMoreBefore);
      setFirstItemIndex(cached.firstItemIndex);
      setActiveXiaoceRun(cached.xiaoceRun);
      setRoomStats(cached.stats);
      setRoomDetailLoading(false);
      stickBottomRef.current = true;
      forceStickUntilRef.current = Date.now() + 180;
      window.setTimeout(() => scrollMessagesToBottom("auto"), 40);
    } else {
      // 用会话列表里的摘要立刻占位，避免切到空的「协作会话」引导页
      const listRoom = roomsRef.current.find((room) => room.id === roomId) || null;
      if (listRoom) setActiveRoom(listRoom);
      setMessages([]);
      setInsights([]);
      setHasMoreBefore(false);
      setFirstItemIndex(VIRT_BASE_INDEX);
      setActiveXiaoceRun(null);
      setRoomStats(null);
      setRoomDetailLoading(true);
    }
    setCancellingRunId(null);
    setHighlightId(null);
    prevActiveIdForComposerRef.current = roomId;
    setActiveId(roomId);
  }, [scrollMessagesToBottom]);

  const refreshStats = useCallback(async (id?: string | null) => {
    const rid = id || activeIdRef.current;
    if (!rid) return;
    if (isRoomAsyncResultCurrent(activeIdRef.current, rid)) setStatsLoading(true);
    try {
      const st = await getCollabRoomStats(rid);
      const cached = roomViewCacheRef.current.get(rid);
      if (cached) roomViewCacheRef.current.set(rid, { ...cached, stats: st });
      if (isRoomAsyncResultCurrent(activeIdRef.current, rid)) setRoomStats(st);
    } catch {
      /* ignore */
    } finally {
      if (isRoomAsyncResultCurrent(activeIdRef.current, rid)) setStatsLoading(false);
    }
  }, []);

  const loadTeams = useCallback(async (force = false) => {
    if (!force && teamsLoadedRef.current) return;
    setTeamsLoading(true);
    try {
      const result = await listTeams();
      setTeams((result.results || []).filter((team) => team.isActive));
      teamsLoadedRef.current = true;
    } catch (error: any) {
      if (force) message.error(error?.response?.data?.error || "加载团队失败");
    } finally {
      setTeamsLoading(false);
    }
  }, [message]);

  useEffect(() => {
    getMe().then((r) => setMe(r.user)).catch(() => setMe(null));
    const roomFromQuery = searchParams.get("room");
    const botFromQuery = searchParams.get("bot");
    loadRooms(!roomFromQuery && !botFromQuery);
    listCollabUsers()
      .then((d) => {
        setContacts(d.results || []);
        contactsLoadedRef.current = true;
      })
      .catch(() => setContacts([]));
    void loadTeams();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onUserUpdated = (event: Event) => {
      const nextUser = (event as CustomEvent<AuthUser>).detail;
      if (!nextUser?.id) return;
      setMe(nextUser);
      const patchBrief = (person: CollabUserBrief): CollabUserBrief => (
        person.id === nextUser.id
          ? {
              ...person,
              username: nextUser.username || person.username,
              display_name: nextUser.display_name || nextUser.username || person.display_name,
              avatar_url: nextUser.avatar_url || "",
            }
          : person
      );
      const patchMessage = (row: CollabMessage): CollabMessage => (
        row.sender.id === nextUser.id ? { ...row, sender: patchBrief(row.sender) } : row
      );
      setContacts((current) => current.map(patchBrief));
      setRooms((current) => current.map((room) => ({
        ...room,
        participants: room.participants.map(patchBrief),
      })));
      setActiveRoom((current) => {
        if (!current) return current;
        const next = { ...current, participants: current.participants.map(patchBrief) };
        activeRoomRef.current = next;
        return next;
      });
      setMessages((current) => {
        const next = current.map(patchMessage);
        messagesRef.current = next;
        return next;
      });
      for (const [roomId, cached] of roomViewCacheRef.current) {
        roomViewCacheRef.current.set(roomId, {
          ...cached,
          room: {
            ...cached.room,
            participants: cached.room.participants.map(patchBrief),
          },
          messages: cached.messages.map(patchMessage),
        });
      }
    };
    window.addEventListener("liangce:user-updated", onUserUpdated);
    return () => window.removeEventListener("liangce:user-updated", onUserUpdated);
  }, []);

  // 从铃铛/外链带 ?room= 进入时打开对应会话
  useEffect(() => {
    const roomId = searchParams.get("room");
    if (!roomId) return;
    selectRoom(roomId);
    setSiderTab("chats");
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("room");
    nextParams.delete("panel");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, selectRoom]);

  // 从资源交接入口进入时，按稳定 bot_id 创建/复用目标单聊。
  useEffect(() => {
    const botId = searchParams.get("bot");
    if (!botId) return;
    const navigationState = location.state as {
      resourceHandoff?: NasResourceHandoff;
      nasPrompt?: string;
    } | null;
    const handoffPrompt = navigationState?.resourceHandoff?.prompt?.trim()
      || navigationState?.nasPrompt?.trim()
      || "";
    switchSiderTab("contacts");
    let cancelled = false;
    const roomRequest = botRoomRequestRef.current || createCollabRoom({
      peer_bot_id: botId,
      room_kind: "dm",
    });
    botRoomRequestRef.current = roomRequest;
    (async () => {
      setCreating(true);
      try {
        const room = await roomRequest;
        if (cancelled) return;
        await loadRooms();
        selectRoom(room.id);
        switchSiderTab("chats");
        if (handoffPrompt) {
          roomComposerCacheRef.current.set(room.id, {
            draft: handoffPrompt,
            pendingFiles: [],
            replyingTo: null,
            referencedRoom: null,
          });
          setDraft(handoffPrompt);
          window.setTimeout(() => composerRef.current?.focus?.(), 0);
        }
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("bot");
        const suffix = nextParams.toString();
        navigate(`${location.pathname}${suffix ? `?${suffix}` : ""}`, {
          replace: true,
          state: null,
        });
      } catch (e: any) {
        if (!cancelled) message.error(e?.response?.data?.error || "打开目标智能体失败");
      } finally {
        if (botRoomRequestRef.current === roomRequest) botRoomRequestRef.current = null;
        if (!cancelled) setCreating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [location.pathname, location.state, loadRooms, message, navigate, searchParams, switchSiderTab]);

  useEffect(() => {
    if (!activeId) return;
    setRooms((prev) => {
      const next = prev.map((r) => (r.id === activeId ? { ...r, unread_count: 0 } : r));
      roomsRef.current = next;
      return next;
    });
    window.dispatchEvent(new CustomEvent("liangce:collab-unread-refresh", {
      detail: { roomId: activeId, read: true, optimistic: true },
    }));
  }, [activeId]);

  // 消息级已读回执：新消息进入视区后短暂稳定再上报，避免“收到即已读”。
  useEffect(() => {
    if (!activeId || document.visibilityState !== "visible") return;
    const latestId = visibleMessages.reduce(
      (max, row) => (row.id > max ? row.id : max),
      0,
    );
    if (!latestId) return;
    const timer = window.setTimeout(() => {
      markCollabRoomRead(activeId, latestId, {
        sessionId: readSessionRef.current,
      }).then((res) => {
        setActiveRoom((prev) => {
          if (!prev || !me) return prev;
          return {
            ...prev,
            last_read_message_id: res.last_read_message_id,
            participants: prev.participants.map((participant) => (
              participant.id === me.id
                ? { ...participant, last_read_message_id: res.last_read_message_id }
                : participant
            )),
          };
        });
        window.dispatchEvent(new CustomEvent("liangce:collab-unread-refresh", {
          detail: { roomId: activeId, read: true },
        }));
      }).catch(() => {
        window.dispatchEvent(new Event("liangce:collab-unread-refresh"));
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeId, me, visibleMessages]);

  // 阅读耗时按前台活跃片段累加；切换房间/隐藏页面时结束本段。
  useEffect(() => {
    if (!activeId) return;
    readSessionRef.current = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    readActiveSinceRef.current = Date.now();
    const report = (ended = false) => {
      const now = Date.now();
      const activeDurationMs = document.visibilityState === "visible"
        ? Math.max(0, now - readActiveSinceRef.current)
        : 0;
      readActiveSinceRef.current = now;
      const latestId = messagesRef.current.reduce(
        (max, row) => (row.id > max ? row.id : max),
        0,
      );
      void markCollabRoomRead(activeId, latestId || undefined, {
        sessionId: readSessionRef.current,
        activeDurationMs,
        ended,
      }).catch(() => undefined);
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") report(false);
    }, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") report(false);
      else readActiveSinceRef.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      report(true);
    };
  }, [activeId]);

  // 进入页面后定时心跳，维持「在线」；仅用轻量 presence 刷新在线态，避免每 15 秒全量拉房间列表
  useEffect(() => {
    let stopped = false;
    let beatInFlight = false;
    const applyPresenceToRooms = (
      users: Record<string, { online: boolean; last_seen: string | null }>,
    ) => {
      setRooms((prev) => {
        let changed = false;
        const next = prev.map((room) => {
          const participants = room.participants.map((p) => {
            const hit = users[String(p.id)];
            if (!hit) return p;
            const online = collabParticipantOnline(p, hit.online);
            if (Boolean(p.online) === online && (p.last_seen || null) === (hit.last_seen || null)) {
              return p;
            }
            changed = true;
            return { ...p, online, last_seen: hit.last_seen };
          });
          if (participants === room.participants) return room;
          const onlineCount = participants.filter((p) => collabParticipantOnline(p)).length;
          let peerOnline = room.peer_online;
          if (isXiaoceRoom(room)) {
            peerOnline = true;
          } else if (room.room_kind === "dm" && me?.id) {
            const peer = participants.find((p) => p.id !== me.id);
            peerOnline = collabParticipantOnline(peer);
          }
          return {
            ...room,
            participants,
            online_count: onlineCount,
            peer_online: peerOnline,
          };
        });
        return changed ? next : prev;
      });
      setContacts((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          const hit = users[String(c.id)];
          if (!hit) return c;
          const online = collabParticipantOnline(c, hit.online);
          if (Boolean(c.online) === online && (c.last_seen || null) === (hit.last_seen || null)) {
            return c;
          }
          changed = true;
          return { ...c, online, last_seen: hit.last_seen };
        });
        return changed ? next : prev;
      });
      setActiveRoom((prev) => {
        if (!prev) return prev;
        const participants = prev.participants.map((p) => {
          const hit = users[String(p.id)];
          if (!hit) return p;
          return {
            ...p,
            online: collabParticipantOnline(p, hit.online),
            last_seen: hit.last_seen,
          };
        });
        const onlineCount = participants.filter((p) => collabParticipantOnline(p)).length;
        let peerOnline = prev.peer_online;
        if (isXiaoceRoom(prev)) {
          peerOnline = true;
        } else if (prev.room_kind === "dm" && me?.id) {
          const peer = participants.find((p) => p.id !== me.id);
          peerOnline = collabParticipantOnline(peer);
        }
        if (
          prev.online_count === onlineCount
          && prev.peer_online === peerOnline
          && participantsPresenceEqual(prev.participants, participants)
        ) {
          return prev;
        }
        return {
          ...prev,
          participants,
          online_count: onlineCount,
          peer_online: peerOnline,
        };
      });
    };

    const beat = async () => {
      if (document.visibilityState !== "visible" || beatInFlight) return;
      beatInFlight = true;
      try {
        await collabPresenceHeartbeat();
        if (stopped) return;
        const ids = new Set<number>();
        for (const room of roomsRef.current) {
          for (const p of room.participants) ids.add(p.id);
        }
        for (const c of contactsRef.current) ids.add(c.id);
        if (ids.size === 0) return;
        const presence = await collabPresenceQuery([...ids]);
        if (stopped) return;
        applyPresenceToRooms(presence.users || {});
      } catch {
        /* ignore */
      } finally {
        beatInFlight = false;
      }
    };
    beat();
    const timer = window.setInterval(beat, 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [me?.id]);

  const loadContacts = useCallback(async (q?: string, opts?: { force?: boolean }) => {
    const query = (q || "").trim();
    if (!opts?.force && !query && contactsLoadedRef.current && contactsRef.current.length > 0) {
      return;
    }
    try {
      const d = await listCollabUsers(query || undefined);
      setContacts(d.results || []);
      if (!query) contactsLoadedRef.current = true;
    } catch {
      /* ignore */
    }
  }, []);

  const scheduleContactSearch = useCallback((raw: string) => {
    setContactKeyword(raw);
    if (contactSearchTimerRef.current) {
      window.clearTimeout(contactSearchTimerRef.current);
    }
    contactSearchTimerRef.current = window.setTimeout(() => {
      void loadContacts(raw.trim() || undefined, { force: true });
    }, 280);
  }, [loadContacts]);

  useEffect(() => () => {
    if (contactSearchTimerRef.current) window.clearTimeout(contactSearchTimerRef.current);
  }, []);

  useEffect(() => {
    if (!panel) return;
    setSiderTab(panel);
    if (panel === "contacts") {
      void loadContacts();
      void loadTeams();
    }
  }, [loadContacts, loadTeams, panel]);

  useEffect(() => {
    if (!activeId) {
      setActiveRoom(null);
      setActiveXiaoceRun(null);
      setCancellingRunId(null);
      setMessages([]);
      setInsights([]);
      setRoomStats(null);
      setRoomDetailLoading(false);
      prevActiveIdForComposerRef.current = null;
      return;
    }
    prevActiveIdForComposerRef.current = activeId;
    const pendingTarget = pendingSearchTargetRef.current?.roomId === activeId
      ? pendingSearchTargetRef.current
      : null;
    if (pendingTarget) pendingSearchTargetRef.current = null;
    stickBottomRef.current = !pendingTarget;
    const cached = roomViewCacheRef.current.get(activeId);
    const fresh = Boolean(
      cached && Date.now() - (cached.fetchedAt || 0) < ROOM_CACHE_FRESH_MS,
    );
    // 有缓存：秒开后后台 soft 同步；无缓存：hard 拉取。避免每次切房整页重绘等待。
    void loadRoomDetail(activeId, pendingTarget
      ? { targetMessageId: pendingTarget.messageId }
      : { soft: Boolean(cached) || fresh });
  }, [activeId, loadRoomDetail]);

  // 列表就绪后空闲预取，让后续切换尽量命中缓存
  const roomIdsKey = useMemo(() => rooms.map((room) => room.id).join(","), [rooms]);
  useEffect(() => {
    if (loadingRooms || !roomIdsKey) return;
    const timer = window.setTimeout(() => {
      let n = 0;
      for (const room of roomsRef.current) {
        if (n >= ROOM_PREFETCH_IDLE) break;
        if (room.id === activeIdRef.current) continue;
        if (roomViewCacheRef.current.has(room.id)) continue;
        prefetchRoom(room.id);
        n += 1;
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [loadingRooms, roomIdsKey, prefetchRoom]);

  const mergeLiveMessages = useCallback((incoming: CollabMessage[], changed?: CollabMessage[]) => {
    const shouldStick = stickBottomRef.current || Date.now() < forceStickUntilRef.current;
    const roomId = activeIdRef.current;
    if (!roomId || (!incoming.length && !changed?.length)) return;
    mutateRoomData(roomId, { messages: (prev) => {
      let next = prev;
      if (incoming.length) {
        next = [...next];
        for (const m of incoming) {
          if (m.status === "deleted") {
            next = next.filter((x) => x.id !== m.id);
            continue;
          }
          const idx = next.findIndex((x) => x.id === m.id);
          if (idx >= 0) next[idx] = m;
          else {
            const optimisticIndex = next.findIndex((candidate) => (
              candidate.id < 0
              && candidate.sender.id === m.sender.id
              && candidate.content === m.content
              && Math.abs(Date.parse(candidate.created_at) - Date.parse(m.created_at)) < 15_000
            ));
            if (optimisticIndex >= 0) {
              const optimisticMessage = next[optimisticIndex];
              const optimisticKey = optimisticMessage.meta?.client_message_key;
              next[optimisticIndex] = {
                ...m,
                attachments: (m.attachments || []).map((attachment, index) => ({
                  ...attachment,
                  preview_url: attachment.is_image
                    ? optimisticMessage.attachments?.[index]?.preview_url
                    : undefined,
                  uploading: attachment.is_image
                    ? optimisticMessage.attachments?.[index]?.uploading
                    : undefined,
                })),
                meta: { ...m.meta, ...(optimisticKey ? { client_message_key: optimisticKey } : {}) },
              };
            } else {
              next.push(m);
            }
          }
        }
      }
      if (changed?.length) {
        next = mergeMessagePatches(next, changed);
      }
      return next;
    } });
    if (shouldStick && incoming.length) {
      scrollMessagesToBottom("auto");
    }
    if ([...incoming, ...(changed || [])].some((item) => Boolean(item.meta?.created_skill))) {
      setSkillRefreshKey((value) => value + 1);
    }
    const completedRunIds = new Set(
      incoming
        .filter((item) => item.msg_type === "ai" && typeof item.meta?.run_id === "string")
        .map((item) => String(item.meta?.run_id)),
    );
    if (completedRunIds.size) {
      setXiaoceStreamsByRoom((current) => {
        const stream = current[roomId];
        if (!stream || !completedRunIds.has(stream.run_id)) return current;
        const next = { ...current };
        delete next[roomId];
        return next;
      });
    }
  }, [mutateRoomData, scrollMessagesToBottom]);

  const mergeLiveInsights = useCallback((incoming: CollabInsight[]) => {
    setInsights((prev) => {
      const known = new Set(prev.map((i) => i.id));
      const add = incoming.filter((i) => !known.has(i.id));
      return add.length ? [...prev, ...add] : prev;
    });
  }, []);

  const mergeLiveXiaoceRuns = useCallback((
    runs: XiaoceRun[],
    context: { authoritative?: boolean; requestRevision?: number } = {},
  ) => {
    const newest = runs.length > 0
      ? runs.reduce((latest, run) => mergeXiaoceRunSnapshot(latest, run) || latest)
      : null;
    const roomId = activeIdRef.current;
    if (!roomId) return;
    const previousRun = activeXiaoceRunRef.current;
    const stableNewest = stabilizeXiaoceRunSnapshot(
      previousRun,
      newest,
      messagesRef.current,
    );
    const nextRun = mergeXiaoceRunSnapshot(previousRun, stableNewest, {
      authoritative: Boolean(context.authoritative),
      requestRevision: context.requestRevision,
      currentRevision: getRoomDataRevision(roomId),
    });
    if (nextRun !== previousRun) {
      mutateRoomData(roomId, {
        room: (current) => ({ ...current, active_xiaoce_run: nextRun }),
        xiaoceRun: () => nextRun,
      });
    }
  }, [getRoomDataRevision, mutateRoomData]);

  const mergeLiveXiaoceStreams = useCallback((updates: XiaoceStreamUpdate[]) => {
    if (!updates.length) return;
    setXiaoceStreamsByRoom((current) => {
      let next = current;
      for (const update of updates) {
        if (!update.room_id || !update.run_id) continue;
        if (update.status !== "streaming") {
          if (next[update.room_id]?.run_id !== update.run_id) continue;
          if (next === current) next = { ...current };
          delete next[update.room_id];
          continue;
        }
        const previous = next[update.room_id];
        if (
          previous?.run_id === update.run_id
          && previous.content === update.content
          && previous.updated_at === update.updated_at
        ) continue;
        if (next === current) next = { ...current };
        next[update.room_id] = update;
      }
      return next;
    });
  }, []);

  const mergeLiveReadReceipts = useCallback((receipts: CollabReadReceipt[]) => {
    if (!receipts.length) return;
    const byUser = new Map(
      receipts.map((receipt) => [receipt.user_id, receipt.last_read_message_id]),
    );
    setActiveRoom((prev) => {
      if (!prev) return prev;
      let changed = false;
      const participants = prev.participants.map((participant) => {
        const cursor = byUser.get(participant.id);
        if (cursor === undefined || cursor <= (participant.last_read_message_id || 0)) {
          return participant;
        }
        changed = true;
        return { ...participant, last_read_message_id: cursor };
      });
      return changed ? { ...prev, participants } : prev;
    });
  }, []);

  const patchRoomMeta = useCallback((meta: Partial<CollabRoom>) => {
    setActiveRoom((prev) => {
      if (!prev) return prev;
      const nextParts = meta.participants || prev.participants;
      if (
        (meta.risk_level ?? prev.risk_level) === prev.risk_level
        && (meta.status ?? prev.status) === prev.status
        && (meta.peer_online ?? prev.peer_online) === prev.peer_online
        && (meta.online_count ?? prev.online_count) === prev.online_count
        && (meta.updated_at ?? prev.updated_at) === prev.updated_at
        && (
          !("active_xiaoce_run" in meta)
          || (
            (meta.active_xiaoce_run?.id || "") === (prev.active_xiaoce_run?.id || "")
            && (meta.active_xiaoce_run?.status || "") === (prev.active_xiaoce_run?.status || "")
            && (meta.active_xiaoce_run?.updated_at || "") === (prev.active_xiaoce_run?.updated_at || "")
          )
        )
        && (!meta.participants || participantsPresenceEqual(prev.participants, nextParts))
        && (meta.display_title ?? prev.display_title) === prev.display_title
      ) {
        return prev;
      }
      const reconciledRun = "active_xiaoce_run" in meta
        ? mergeXiaoceRunSnapshot(
            prev.active_xiaoce_run || null,
            meta.active_xiaoce_run || null,
          )
        : prev.active_xiaoce_run;
      const patched = {
        ...prev,
        ...meta,
        participants: nextParts,
        active_xiaoce_run: reconciledRun,
      };
      if (meta.participants?.length) {
        const byId = new Map(meta.participants.map((p) => [p.id, p]));
        setMessages((msgs) => {
          let changed = false;
          const next = msgs.map((m) => {
            const p = byId.get(m.sender.id);
            if (!p || m.msg_type === "ai" || m.msg_type === "system") return m;
            const display_name = p.display_name || p.nickname || p.username;
            const avatar_url = p.avatar_url || "";
            const bio = p.bio || "";
            if (
              (m.sender.display_name || "") === display_name
              && (m.sender.nickname || "") === (p.nickname || "")
              && (m.sender.avatar_url || "") === avatar_url
              && (m.sender.bio || "") === bio
            ) {
              return m;
            }
            changed = true;
            return {
              ...m,
              sender: {
                ...m.sender,
                nickname: p.nickname,
                display_name,
                avatar_url,
                bio,
              },
            };
          });
          return changed ? next : msgs;
        });
      }
      return patched;
    });
  }, []);

  const isLiveRoomCurrent = useCallback(
    (roomId: string) => isRoomAsyncResultCurrent(activeIdRef.current, roomId),
    [],
  );

  useCollabRoomLive({
    roomId: activeId,
    messagesRef,
    insightsRef,
    mergeMessages: mergeLiveMessages,
    mergeInsights: mergeLiveInsights,
    patchRoomMeta,
    onXiaoceRuns: mergeLiveXiaoceRuns,
    onXiaoceStreams: mergeLiveXiaoceStreams,
    isRoomCurrent: isLiveRoomCurrent,
    getRoomRevision: getRoomDataRevision,
    onReadReceipts: mergeLiveReadReceipts,
    setRoomStats,
    participantsEqual: participantsPresenceEqual,
  });

  const loadOlderMessages = useCallback(async () => {
    const targetRoomId = activeIdRef.current;
    if (
      !targetRoomId
      || !hasMoreBeforeRef.current
      || loadingOlderRequestRef.current.has(targetRoomId)
    ) return;
    const targetGeneration = roomLoadSeqRef.current;
    const oldest = messagesRef.current.find((m) => m.status !== "deleted")?.id
      || messagesRef.current[0]?.id;
    if (!oldest) return;
    const roomAtStart = activeRoomRef.current;
    if (!roomAtStart || roomAtStart.id !== targetRoomId) return;
    const fallbackCache: RoomViewCache = {
      room: roomAtStart,
      messages: messagesRef.current,
      insights: insightsRef.current,
      hasMoreBefore: hasMoreBeforeRef.current,
      firstItemIndex: firstItemIndexRef.current,
      xiaoceRun: activeXiaoceRunRef.current,
      stats: roomStatsRef.current,
      fetchedAt: roomViewCacheRef.current.get(targetRoomId)?.fetchedAt || Date.now(),
    };
    loadingOlderRequestRef.current.set(targetRoomId, targetGeneration);
    setLoadingOlder(true);
    try {
      const page = await listCollabMessages(targetRoomId, {
        beforeId: oldest,
        limit: 40,
        lite: true,
        includeParticipants: false,
      });
      const cached = roomViewCacheRef.current.get(targetRoomId) || fallbackCache;
      const next = mergeOlderRoomPage(cached, page);
      roomViewCacheRef.current.set(targetRoomId, {
        ...cached,
        messages: next.messages,
        hasMoreBefore: next.hasMoreBefore,
        firstItemIndex: next.firstItemIndex,
      });
      if ((page.results || []).length) bumpRoomDataRevision(targetRoomId);
      if (isRoomSelectionCurrent(
        activeIdRef.current,
        roomLoadSeqRef.current,
        targetRoomId,
        targetGeneration,
      )) {
        setMessages(next.messages);
        setFirstItemIndex(next.firstItemIndex);
        setHasMoreBefore(next.hasMoreBefore);
      }
    } catch {
      /* ignore */
    } finally {
      if (loadingOlderRequestRef.current.get(targetRoomId) === targetGeneration) {
        loadingOlderRequestRef.current.delete(targetRoomId);
      }
      if (isRoomSelectionCurrent(
        activeIdRef.current,
        roomLoadSeqRef.current,
        targetRoomId,
        targetGeneration,
      )) {
        setLoadingOlder(false);
      }
    }
  }, [bumpRoomDataRevision]);

  useEffect(() => {
    if (!groupOpen && !inviteOpen) return;
    void loadContacts();
    if (groupOpen) void loadTeams();
  }, [groupOpen, inviteOpen, loadContacts, loadTeams]);

  const findDirectRoom = useCallback((username: string) => (
    rooms.find((room) => (
      room.room_kind === "dm"
      && room.participants.some((participant) => participant.username === username)
    ))
  ), [rooms]);

  const openDm = async (username: string) => {
    const existingRoom = findDirectRoom(username);
    if (existingRoom) {
      switchSiderTab("chats");
      selectRoom(existingRoom.id);
      return;
    }
    setCreating(true);
    try {
      const room = await createCollabRoom({
        peer_username: username,
        room_kind: "dm",
      });
      primeRoomSnapshot(room);
      switchSiderTab("chats");
      selectRoom(room.id);
      void loadRooms();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "打开对话失败");
    } finally {
      setCreating(false);
    }
  };

  const handleCreateXiaoceTask = async () => {
    if (creatingXiaoce) return;
    setCreatingXiaoce(true);
    try {
      const room = await createXiaoceTask();
      const roomMessages = room.messages || [];
      roomViewCacheRef.current.set(room.id, {
        room,
        messages: roomMessages,
        insights: room.insights || [],
        hasMoreBefore: false,
        firstItemIndex: VIRT_BASE_INDEX,
        xiaoceRun: room.active_xiaoce_run || null,
        stats: null,
        fetchedAt: Date.now(),
      });
      setRooms((current) => [room, ...current.filter((item) => item.id !== room.id)]);
      setSiderTab("chats");
      selectRoom(room.id);
      message.success("小策任务已创建");
    } catch (error: any) {
      message.error(error?.response?.data?.error || "创建小策任务失败");
    } finally {
      setCreatingXiaoce(false);
    }
  };

  const openCreateGroup = () => {
    setGroupTeamIds([]);
    setGroupMembers([]);
    setGroupTitle("");
    setGroupOpen(true);
  };

  const handleCreateGroup = async () => {
    if (selectedGroupMembers.length < 1) {
      message.warning("请至少选择一位群成员");
      return;
    }
    setCreating(true);
    try {
      const room = await createCollabRoom({
        title: groupTitle.trim() || undefined,
        peer_usernames: selectedGroupMembers,
        room_kind: "group",
      });
      setGroupOpen(false);
      setGroupTeamIds([]);
      setGroupMembers([]);
      setGroupTitle("");
      primeRoomSnapshot(room);
      switchSiderTab("chats");
      selectRoom(room.id);
      void loadRooms();
      message.success("群聊已创建");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "创建群聊失败");
    } finally {
      setCreating(false);
    }
  };

  const openGroupForTeam = (team: TeamSummary) => {
    setGroupTeamIds([team.id]);
    setGroupMembers([]);
    setGroupTitle(team.name);
    setGroupOpen(true);
  };

  const toggleTeamExpanded = (teamId: number) => {
    setExpandedTeamIds((current) => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const openInviteModal = () => {
    setInviteMembers([]);
    setInviteOpen(true);
    loadContacts();
  };

  const handleInviteMembers = async () => {
    const roomId = activeIdRef.current;
    if (!roomId || !activeRoom) return;
    if (inviteMembers.length < 1) {
      message.warning("请选择要邀请的联系人");
      return;
    }
    setInviting(true);
    try {
      const res = await addCollabRoomMembers(roomId, inviteMembers);
      setInviteOpen(false);
      setInviteMembers([]);
      mutateRoomData(roomId, {
        ...(res.message ? {
          messages: (previous) => previous.some((item) => item.id === res.message.id)
            ? previous
            : [...previous, res.message],
        } : {}),
        ...(res.room ? { room: (previous) => ({ ...previous, ...res.room }) } : {}),
      });
      message.success(`已邀请 ${res.added_count} 人加入群聊`);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "邀请失败");
    } finally {
      setInviting(false);
    }
  };

  const openKickModal = () => {
    setKickMembers([]);
    setKickOpen(true);
  };

  const openNickModal = () => {
    const drafts: Record<string, string> = {};
    for (const p of activeRoom?.participants || []) {
      drafts[p.username] = p.nickname || p.display_name || "";
      if (drafts[p.username] === p.username) drafts[p.username] = p.nickname || "";
    }
    setNickDrafts(drafts);
    setNickOpen(true);
  };

  const openRenameModal = (room: CollabRoom | null = activeRoom) => {
    if (!room) return;
    setRenameTargetId(room.id);
    setRenameTitle((room.title || "").trim());
    setRenameOpen(true);
  };

  const handleRenameRoom = async () => {
    const roomId = renameTargetId;
    const target = rooms.find((room) => room.id === roomId)
      || (activeRoom?.id === roomId ? activeRoom : null);
    if (!roomId || !target) return;
    const next = renameTitle.trim();
    if (!next) {
      message.warning(isXiaoceRoom(target) ? "任务名称不能为空" : "群名不能为空");
      return;
    }
    if (next === (target.title || "").trim()) {
      setRenameOpen(false);
      return;
    }
    setRenaming(true);
    try {
      const room = await updateCollabRoom(roomId, { title: next });
      const last = target.room_kind === "group" && room.messages?.length
        ? room.messages[room.messages.length - 1]
        : null;
      mutateRoomData(roomId, {
        room: (previous) => ({ ...previous, ...room, messages: undefined, insights: undefined }),
        ...(last ? {
          messages: (previous) => previous.some((item) => item.id === last.id)
            ? previous
            : [...previous, last],
        } : {}),
      });
      setRenameOpen(false);
      message.success(isXiaoceRoom(target) ? "任务名称已更新" : "群名已更新");
    } catch (error: any) {
      message.error(
        error?.response?.data?.error
          || (isXiaoceRoom(target) ? "修改任务名称失败" : "修改群名失败"),
      );
    } finally {
      setRenaming(false);
    }
  };

  const handleSaveNicknames = async () => {
    const roomId = activeIdRef.current;
    if (!roomId || !activeRoom || !me) return;
    const canEditOthers = Boolean(me.is_staff || activeRoom.created_by?.id === me.id);
    const targets = (activeRoom.participants || []).filter((p) => {
      if (p.id === me.id) return true;
      return canEditOthers;
    });
    const changes = targets.filter((p) => {
      const next = (nickDrafts[p.username] || "").trim();
      const prev = (p.nickname || "").trim();
      return next !== prev;
    });
    if (!changes.length) {
      setNickOpen(false);
      message.info("没有需要保存的修改");
      return;
    }
    setNickSaving(true);
    try {
      let latestRoom = activeRoom;
      for (const p of changes) {
        const res = await updateCollabMemberNickname(roomId, {
          username: p.username,
          nickname: (nickDrafts[p.username] || "").trim(),
        });
        latestRoom = res.room;
        mutateRoomData(roomId, {
          room: (previous) => ({ ...previous, ...res.room }),
          ...(res.message ? {
            messages: (previous) => previous.some((item) => item.id === res.message!.id)
              ? previous
              : [...previous, res.message!],
          } : {}),
        });
      }
      // 刷新消息发送者展示名
      if (latestRoom.participants) {
        const byId = new Map(latestRoom.participants.map((p) => [p.id, p]));
        mutateRoomData(roomId, { messages: (prev) => prev.map((m) => {
          const p = byId.get(m.sender.id);
          if (!p || m.msg_type === "ai" || m.msg_type === "system") return m;
          return {
            ...m,
            sender: {
              ...m.sender,
              nickname: p.nickname,
              display_name: p.display_name || p.nickname || p.username,
                avatar_url: p.avatar_url ?? m.sender.avatar_url,
              bio: p.bio || m.sender.bio,
            },
          };
        }) });
      }
      setNickOpen(false);
      message.success("群内名称已更新");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "保存失败");
    } finally {
      setNickSaving(false);
    }
  };

  const handleKickMembers = async () => {
    const roomId = activeIdRef.current;
    if (!roomId || !activeRoom) return;
    if (kickMembers.length < 1) {
      message.warning("请选择要移出的成员");
      return;
    }
    setKicking(true);
    try {
      const res = await removeCollabRoomMembers(roomId, kickMembers);
      setKickOpen(false);
      setKickMembers([]);
      if (res.left) {
        setActiveId(null);
        setActiveRoom(null);
        setMessages([]);
        setInsights([]);
        await loadRooms();
        message.success("已退出群聊");
        return;
      }
      mutateRoomData(roomId, {
        ...(res.message ? {
          messages: (previous) => previous.some((item) => item.id === res.message.id)
            ? previous
            : [...previous, res.message],
        } : {}),
        ...(res.room ? { room: (previous) => ({ ...previous, ...res.room! }) } : {}),
      });
      message.success(`已移出 ${res.removed_count} 人`);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "移出失败");
    } finally {
      setKicking(false);
    }
  };

  const sendPlainMessage = async (
    targetRoomId: string,
    content: string,
    files: File[] = [],
    localPreviews: Array<string | undefined> = [],
    replyTarget: CollabMessage | null = null,
    contextRoom: CollabRoom | null = null,
  ) => {
    if (sendingRoomIdsRef.current.has(targetRoomId)) return false;
    if (!content.trim() && files.length === 0) return false;
    const targetRoom = activeRoomRef.current?.id === targetRoomId
      ? activeRoomRef.current
      : roomsRef.current.find((room) => room.id === targetRoomId) || null;
    const targetIsParticipant = Boolean(
      me && targetRoom?.participants.some((participant) => participant.id === me.id),
    );
    if (!targetIsParticipant) {
      message.warning("你不是该会话成员");
      return false;
    }
    if (targetRoom?.status === "closed") {
      message.warning("会话已结束");
      return false;
    }
    if (
      targetRoom
      && (isXiaoceRoom(targetRoom) || requestsAiResponse(content))
      && isXiaoceTaskRunning(targetRoom, activeRoomRef.current, activeXiaoceRunRef.current)
    ) {
      message.warning(
        isXiaoceRoom(targetRoom)
          ? "小策bot 正在处理，请先暂停或等待完成"
          : "良策AI 正在处理上一轮回答，请等待完成",
      );
      return false;
    }
    const runId = (
      isXiaoceRoom(targetRoom) || requestsAiResponse(content)
    ) ? createXiaoceRunId() : undefined;
    const optimisticRun: XiaoceRun | null = runId ? {
      id: runId,
      status: "running",
      room_id: targetRoomId,
      current_stage: "understanding",
      progress_steps: [{
        code: "understanding",
        label: "正在理解你的问题…",
        status: "running",
        tool_count: 0,
        detail: "",
        started_at: new Date().toISOString(),
        finished_at: "",
      }],
      error_code: "",
      error_message: "",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      agent_kind: isXiaoceRoom(targetRoom) ? "xiaoce" : "mention",
      agent_name: isXiaoceRoom(targetRoom) ? "小策bot" : "良策AI",
    } : null;
    if (runId) {
      setXiaoceStreamsByRoom((current) => ({
        ...current,
        [targetRoomId]: {
          run_id: runId,
          room_id: targetRoomId,
          content: "",
          status: "streaming",
          updated_at: new Date().toISOString(),
        },
      }));
    }
    stickBottomRef.current = true;
    forceStickUntilRef.current = 0;
    const tempId = -Date.now();
    const clientMessageKey = `local-${targetRoomId}-${Math.abs(tempId)}`;
    const optimistic: CollabMessage = {
      id: tempId,
      room_id: targetRoomId,
      sender: {
        id: me?.id || 0,
        username: me?.username || "",
        display_name: me?.display_name || me?.username || "",
        avatar_url: me?.avatar_url || "",
      },
      content: content.trim(),
      attachments: files.map((file, index) => ({
        id: `upload-${Math.abs(tempId)}-${index}`,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        is_image: isImageFile(file),
        is_file: !isImageFile(file),
        preview_url: localPreviews[index],
        uploading: true,
      })),
      mentions: [],
      msg_type: "user",
      status: "normal",
      reply_to: replyTarget ? {
        id: replyTarget.id,
        sender: {
          id: replyTarget.sender.id,
          username: replyTarget.sender.username,
          display_name: memberLabel(replyTarget.sender),
        },
        content: (replyTarget.content || (replyTarget.attachments?.length ? "[附件]" : "")).slice(0, 240),
        status: replyTarget.status,
        attachment_count: replyTarget.attachments?.length || 0,
      } : null,
      meta: {
        ...(runId ? { run_id: runId } : {}),
        client_message_key: clientMessageKey,
        ...(contextRoom ? {
          context_rooms: [{
            id: contextRoom.id,
            title: contextRoom.display_title || contextRoom.title,
            message_count: contextRoom.message_count,
            last_message_id: contextRoom.last_message?.id,
          } satisfies CollabContextRoomRef],
        } : {}),
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mutateRoomData(targetRoomId, {
      messages: (current) => [...current, optimistic],
      ...(optimisticRun ? {
        room: (current) => ({ ...current, active_xiaoce_run: optimisticRun }),
        xiaoceRun: () => optimisticRun,
      } : {}),
    });
    if (isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)) {
      scrollMessagesToBottom("auto");
    }
    markRoomSending(targetRoomId, true);
    try {
      const res = await sendCollabMessage(
        targetRoomId,
        content.trim(),
        true,
        files.length ? files : undefined,
        replyTarget?.id,
        runId,
        contextRoom ? [contextRoom.id] : undefined,
        connectorIdsFromMessage(content),
      );
      const confirmedMessage: CollabMessage = {
        ...res.message,
        attachments: (res.message.attachments || []).map((attachment, index) => ({
          ...attachment,
          preview_url: attachment.is_image ? localPreviews[index] : undefined,
        })),
        meta: { ...res.message.meta, client_message_key: clientMessageKey },
      };
      const mergeResponseMessages = (current: CollabMessage[]) => {
        const next = [...current];
        const tempIndex = next.findIndex((m) => m.id === tempId);
        const serverIndex = next.findIndex((m) => m.id === res.message.id);
        if (tempIndex >= 0 && serverIndex < 0) {
          next[tempIndex] = confirmedMessage;
        } else {
          if (tempIndex >= 0) next.splice(tempIndex, 1);
          const existingIndex = next.findIndex((m) => m.id === res.message.id);
          if (existingIndex >= 0) next[existingIndex] = confirmedMessage;
          else next.push(confirmedMessage);
        }
        if (res.ai_message && !next.some((m) => m.id === res.ai_message!.id)) {
          next.push(res.ai_message);
        }
        return next;
      };
      const cached = roomViewCacheRef.current.get(targetRoomId);
      const currentRunSnapshots = [
        cached?.xiaoceRun,
        cached?.room.active_xiaoce_run,
        roomsRef.current.find((room) => room.id === targetRoomId)?.active_xiaoce_run,
        isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)
          ? activeXiaoceRunRef.current
          : null,
        activeRoomRef.current?.id === targetRoomId
          ? activeRoomRef.current.active_xiaoce_run
          : null,
      ];
      let responseRun = res.xiaoce_run;
      if (!responseRun && "active_xiaoce_run" in res.room) {
        responseRun = res.room.active_xiaoce_run || undefined;
      }
      const runSeed = responseRun
        || currentRunSnapshots.find((snapshot) => snapshot?.id === runId)
        || null;
      const mergedRun = runSeed
        ? mergeXiaoceRunSnapshots(runSeed, currentRunSnapshots)
        : null;
      mutateRoomData(targetRoomId, {
        messages: mergeResponseMessages,
        room: (room) => ({
          ...room,
          ...res.room,
          active_xiaoce_run: mergedRun,
          updated_at: res.room.updated_at || room.updated_at,
        }),
        xiaoceRun: () => mergedRun,
      });
      if (runId && !mergedRun) {
        setXiaoceStreamsByRoom((current) => {
          if (current[targetRoomId]?.run_id !== runId) return current;
          const next = { ...current };
          delete next[targetRoomId];
          return next;
        });
      }
      for (const attachment of confirmedMessage.attachments || []) {
        if (!attachment.preview_url || !attachment.url || !attachment.is_image) continue;
        const localUrl = attachment.preview_url;
        const image = new window.Image();
        image.onload = () => {
          mutateRoomData(targetRoomId, {
            messages: (current) => current.map((row) => (
              row.id !== confirmedMessage.id
                ? row
                : {
                    ...row,
                    attachments: (row.attachments || []).map((item) => (
                      item.id === attachment.id
                        ? { ...item, preview_url: undefined, uploading: false }
                        : item
                    )),
                  }
            )),
          });
          URL.revokeObjectURL(localUrl);
        };
        image.src = collabAttachUrl(attachment.url);
      }
      if (isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)) {
        scrollMessagesToBottom("auto");
        setMention(null);
      }
      // 统计看板稍后刷新，不挡发送体感
      window.setTimeout(() => { void refreshStats(targetRoomId); }, 800);
      return true;
    } catch (e: any) {
      if (runId) {
        setXiaoceStreamsByRoom((current) => {
          if (current[targetRoomId]?.run_id !== runId) return current;
          const next = { ...current };
          delete next[targetRoomId];
          return next;
        });
      }
      const removeOptimistic = (current: CollabMessage[]) => (
        current.filter((row) => row.id !== tempId)
      );
      const pendingRun = e?.response?.data?.xiaoce_run as XiaoceRun | undefined;
      let mergedPendingRun: XiaoceRun | undefined;
      if (pendingRun) {
        const failedCache = roomViewCacheRef.current.get(targetRoomId);
        mergedPendingRun = mergeXiaoceRunSnapshots(pendingRun, [
          failedCache?.xiaoceRun,
          failedCache?.room.active_xiaoce_run,
          roomsRef.current.find((room) => room.id === targetRoomId)?.active_xiaoce_run,
          isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)
            ? activeXiaoceRunRef.current
            : null,
          activeRoomRef.current?.id === targetRoomId
            ? activeRoomRef.current.active_xiaoce_run
            : null,
        ]);
      }
      mutateRoomData(targetRoomId, {
        messages: removeOptimistic,
        ...(mergedPendingRun ? {
          room: (room) => ({ ...room, active_xiaoce_run: mergedPendingRun }),
          xiaoceRun: () => mergedPendingRun,
        } : runId ? {
          room: (room) => ({ ...room, active_xiaoce_run: null }),
          xiaoceRun: () => null,
        } : {}),
      });
      if (pendingRun) {
        // A second tab may finish/cancel the run immediately after this 409.
        // Reconcile against the authoritative room snapshot instead of
        // leaving this tab permanently blocked by the returned running row.
        window.setTimeout(() => {
          if (roomsRef.current.some((room) => room.id === targetRoomId)) {
            void loadRoomDetail(targetRoomId, { soft: true });
          }
        }, 650);
      }
      message.error(e?.response?.data?.error || "发送失败");
      return false;
    } finally {
      markRoomSending(targetRoomId, false);
    }
  };

  const handleSend = async () => {
    const targetRoomId = activeIdRef.current;
    if (!targetRoomId || sendingRoomIdsRef.current.has(targetRoomId) || xiaoceBusy) return;
    const contextRoom = referencedRoomRef.current;
    const content = draftRef.current.trim()
      || (contextRoom ? "请基于引用会话继续当前任务。" : "");
    const targetFiles = pendingFilesRef.current;
    if (!content && targetFiles.length === 0) return;
    const files = targetFiles.map((item) => item.file);
    const previews = targetFiles.map((item) => item.preview);
    const replyTarget = replyingToRef.current;
    // 发出后立刻停掉草稿分析（含进行中的请求）
    draftCoachSeq.current += 1;
    if (draftCoachTimer.current) {
      window.clearTimeout(draftCoachTimer.current);
      draftCoachTimer.current = null;
    }
    setDraft("");
    setDraftCoach(null);
    setDraftCoachLoading(false);
    setPendingFiles([]);
    setReplyingTo(null);
    setReferencedRoom(null);
    roomComposerCacheRef.current.set(targetRoomId, {
      draft: "",
      pendingFiles: [],
      replyingTo: null,
      referencedRoom: null,
    });
    const ok = await sendPlainMessage(
      targetRoomId,
      content,
      files,
      previews,
      replyTarget,
      contextRoom,
    );
    if (!ok) {
      if (!roomsRef.current.some((room) => room.id === targetRoomId)) {
        previews.forEach((url) => { if (url) URL.revokeObjectURL(url); });
        return;
      }
      const restoredFiles = files.map((file, index) => ({
        file,
        preview: previews[index],
      }));
      roomComposerCacheRef.current.set(targetRoomId, {
        draft: content,
        pendingFiles: restoredFiles,
        replyingTo: replyTarget,
        referencedRoom: contextRoom,
      });
      if (isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)) {
        setDraft(content);
        setReplyingTo(replyTarget);
        setPendingFiles(restoredFiles);
        setReferencedRoom(contextRoom);
      }
    }
  };

  const pauseXiaoce = async () => {
    const roomId = activeId;
    const runId = activeXiaoceRun?.id;
    if (!roomId || !runId || cancellingRunId) return;
    setCancellingRunId(runId);
    try {
      const response = await cancelXiaoceRun(roomId, runId);
      // The cancel response is terminal and authoritative. Do not let a
      // concurrent websocket revision keep a stale "running" snapshot alive.
      const nextRun = null;
      activeXiaoceRunRef.current = null;
      mutateRoomData(roomId, {
        messages: (previous) => {
          const index = previous.findIndex((item) => item.id === response.message.id);
          if (index < 0) return [...previous, response.message];
          const next = [...previous];
          next[index] = response.message;
          return next;
        },
        room: (previous) => ({
          ...previous,
          ...response.room,
          active_xiaoce_run: nextRun,
        }),
        xiaoceRun: () => nextRun,
      });
      if (activeIdRef.current === roomId) {
        scrollMessagesToBottom("auto");
      }
    } catch (error: any) {
      message.error(error?.response?.data?.error || "暂停失败，请重试");
      if (error?.response?.status === 409 && activeIdRef.current === roomId) {
        void loadRoomDetail(roomId);
      }
    } finally {
      setCancellingRunId((current) => (current === runId ? null : current));
    }
  };

  const runDraftCoach = useCallback(async (roomId: string, text: string) => {
    const trimmed = (text || "").trim();
    if (!trimmed) {
      setDraftCoach(null);
      setDraftCoachLoading(false);
      return;
    }
    const seq = ++draftCoachSeq.current;
    setDraftCoachLoading(true);
    try {
      const res = await checkCollabDraft(roomId, trimmed);
      if (seq !== draftCoachSeq.current) return;
      // 消息已发出 / 输入框已清空：不再展示改写
      if (!draftRef.current.trim()) {
        setDraftCoach(null);
        return;
      }
      if (!res.ok) {
        setDraftCoach(null);
        return;
      }
      if (!res.tips?.length && !res.examples?.length) {
        setDraftCoach(null);
        return;
      }
      const tips = (res.tips || []).map((t, i) => ({
        ...t,
        example: t.example || res.examples?.[i] || "",
      })).filter((t) => t.example);
      if (!tips.length) {
        setDraftCoach(null);
        return;
      }
      setDraftCoach({
        level: res.level || "info",
        tips,
        label: res.label || tips[0]?.label || "可改写",
        advice: res.advice || tips[0]?.advice || "",
      });
    } catch {
      if (seq === draftCoachSeq.current) setDraftCoach(null);
    } finally {
      if (seq === draftCoachSeq.current) setDraftCoachLoading(false);
    }
  }, []);

  const onDraftChange = (value: string, caret?: number | null) => {
    setDraft(value);
    const contextRoom = referencedRoomRef.current;
    if (contextRoom) {
      const contextTitle = contextRoom.display_title || contextRoom.title || "小策bot 历史任务";
      if (!value.includes(`@「${contextTitle}」`)) setReferencedRoom(null);
    }
    // Ant Design TextArea 的 onChange 里 selectionStart 偶发仍是 0；追加输入时按末尾算
    const resolved =
      caret == null
        ? value.length
        : (caret === 0 && value.length > draft.length ? value.length : caret);
    syncMentionFromCaret(value, resolved);

    if (draftCoachTimer.current) {
      window.clearTimeout(draftCoachTimer.current);
      draftCoachTimer.current = null;
    }

    const trimmed = value.trim();
    if (!trimmed || !activeId) {
      setDraftCoach(null);
      setDraftCoachLoading(false);
      return;
    }

    // 停手约 3 秒后，结合最近发言分析这句话能否优化
    draftCoachTimer.current = window.setTimeout(() => {
      void runDraftCoach(activeId, trimmed);
    }, 3000);
  };

  useEffect(() => {
    setDraftCoach(null);
    setDraftCoachLoading(false);
    draftCoachSeq.current += 1;
    if (draftCoachTimer.current) {
      window.clearTimeout(draftCoachTimer.current);
      draftCoachTimer.current = null;
    }
  }, [activeId]);

  useEffect(() => () => {
    if (draftCoachTimer.current) window.clearTimeout(draftCoachTimer.current);
  }, []);

  const askAiAboutMessage = async (m: CollabMessage) => {
    const targetRoomId = activeIdRef.current;
    if (!targetRoomId) return;
    if (sendingRoomIdsRef.current.has(targetRoomId)) {
      message.info("请等待当前消息发送完成");
      return;
    }
    const excerpt = (m.content || "").trim().slice(0, 80);
    const text = `@AI 请看 #${m.id}${excerpt ? `：${excerpt}` : ""}`.trim();
    await sendPlainMessage(targetRoomId, text);
  };

  const handleRecallMessage = async (m: CollabMessage) => {
    const roomId = activeIdRef.current;
    if (!roomId) return;
    try {
      const res = await recallCollabMessage(roomId, m.id);
      mutateRoomData(roomId, {
        messages: (previous) => mergeMessagePatches(previous, [res.message]),
        ...(res.room ? {
          room: (previous) => ({ ...previous, ...res.room }),
        } : {}),
      });
      message.success("已撤回");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "撤回失败");
    }
  };

  const handleDeleteMessage = (m: CollabMessage) => {
    const roomId = activeIdRef.current;
    if (!roomId) return;
    Modal.confirm({
      className: "collab-danger-confirm",
      title: "删除这条消息？",
      content: "删除后会话内其他人也将看不到该消息。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await deleteCollabMessage(roomId, m.id);
          mutateRoomData(roomId, {
            messages: (previous) => mergeMessagePatches(previous, [res.message]),
            ...(res.room ? {
              room: (previous) => ({ ...previous, ...res.room }),
            } : {}),
          });
          message.success("已删除");
        } catch (e: any) {
          message.error(e?.response?.data?.error || "删除失败");
          throw e;
        }
      },
    });
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    if (!incoming.length) return;
    setPendingFiles((prev) => {
      const merged = mergePendingUploads(prev, incoming);
      if (merged.length >= MAX_FILES) {
        message.info(`最多发送 ${MAX_FILES} 个附件`);
      }
      return merged;
    });
  };

  const filesFromDrop = async (transfer: DataTransfer): Promise<File[]> => {
    const external = Array.from(transfer.files || []);
    if (external.length) return external;
    const encoded = transfer.getData(DRAG_ATTACHMENT_TYPE);
    if (!encoded) return [];
    try {
      const attachment = JSON.parse(encoded) as { url?: string; name?: string; mime?: string };
      if (!attachment.url) return [];
      const response = await fetch(collabAttachUrl(attachment.url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      return [new File([blob], attachment.name || "聊天附件", {
        type: attachment.mime || blob.type || "application/octet-stream",
      })];
    } catch {
      message.error("读取拖拽附件失败，请重试");
      return [];
    }
  };

  const addFilesToRoom = async (roomId: string, transfer: DataTransfer) => {
    const incoming = await filesFromDrop(transfer);
    if (!incoming.length) return;
    if (roomId === activeIdRef.current) {
      addFiles(incoming);
      return;
    }
    const cached = roomComposerCacheRef.current.get(roomId) || {
      draft: "",
      pendingFiles: [],
      replyingTo: null,
      referencedRoom: null,
    };
    const merged = mergePendingUploads(cached.pendingFiles, incoming);
    roomComposerCacheRef.current.set(roomId, { ...cached, pendingFiles: merged });
    setRoomDropTargetId(null);
    selectRoom(roomId);
    const target = roomsRef.current.find((room) => room.id === roomId);
    message.success(`附件已放入「${target ? roomTitle(target) : "目标会话"}」输入框`);
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => {
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return next;
    });
  };

  const toggleMessageSelection = (messageId: number) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const openForwardDialog = (ids: number[], mode: "merge" | "separate") => {
    if (!forwardRoomOptions.length) {
      message.info("暂无其他可转发的会话");
      return;
    }
    const selected = new Set(ids);
    const ordered = messagesRef.current
      .filter((item) => selected.has(item.id))
      .map((item) => item.id);
    if (!ordered.length) return;
    setForwardMessageIds(ordered);
    setForwardMode(mode);
    setForwardTargetId(forwardRoomOptions[0]?.value);
    setForwardOpen(true);
  };

  const submitForward = async () => {
    if (!forwardTargetId || !forwardMessageIds.length || forwardSubmitting) return;
    setForwardSubmitting(true);
    try {
      const result = await forwardCollabMessages(forwardTargetId, forwardMessageIds, forwardMode);
      mutateRoomData(forwardTargetId, {
        messages: (previous) => mergeMessagePatches(previous, result.messages),
        room: (previous) => ({ ...previous, ...result.room }),
      });
      setForwardOpen(false);
      setSelectionMode(false);
      setSelectedMessageIds(new Set());
      selectRoom(forwardTargetId);
      window.setTimeout(() => {
        void loadRoomDetail(forwardTargetId, { soft: true });
        scrollMessagesToBottom("smooth");
      }, 60);
      message.success(forwardMode === "merge" ? "已合并转发" : "已逐条转发");
    } catch (error: any) {
      message.error(error?.response?.data?.error || "转发失败，请重试");
    } finally {
      setForwardSubmitting(false);
    }
  };

  const syncMentionFromCaret = (value: string, caret?: number | null) => {
    const raw = caret == null ? value.length : caret;
    // Ant Design TextArea 在 onChange 时 selectionStart 有时仍是 0，补一次末尾检测
    let next = detectMentionAt(value, raw);
    if (!next && raw !== value.length) {
      next = detectMentionAt(value, value.length);
    }
    setMention(next);
  };

  const applyMention = (opt: MentionOption) => {
    if (!mention) return;
    const before = draft.slice(0, mention.start);
    const after = draft.slice(mention.end);
    const next = `${before}${opt.insert}${after}`;
    const caret = before.length + opt.insert.length;
    setDraft(next);
    if (opt.type === "conversation" && opt.room) {
      setReferencedRoom(opt.room);
    }
    setMention(null);
    requestAnimationFrame(() => {
      const el = composerRef.current?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });
  };

  const handleClose = async () => {
    const roomId = activeIdRef.current;
    if (!roomId) return;
    try {
      const room = await updateCollabRoom(roomId, { status: "closed" });
      mutateRoomData(roomId, { room: () => room });
      if (room.insights && activeIdRef.current === roomId) setInsights(room.insights);
      await loadRooms();
      message.success("会话已结束，已生成风控纪要");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "结束失败");
    }
  };

  const handleClearHistory = () => {
    const roomId = activeIdRef.current;
    if (!roomId) return;
    Modal.confirm({
      className: "collab-danger-confirm",
      title: "清空聊天记录？",
      content: "将删除本会话全部消息与风控洞察，会话本身保留。此操作对所有成员生效。",
      okText: "清空记录",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await clearCollabMessages(roomId);
          mutateRoomData(roomId, {
            messages: () => res.room?.messages || (res.message ? [res.message] : []),
            ...(res.room ? {
              room: (previous) => ({
                ...previous,
                ...res.room,
                messages: undefined,
                insights: undefined,
              }),
            } : {}),
          });
          if (activeIdRef.current === roomId) {
            setInsights(res.room?.insights || []);
          }
          message.success("聊天记录已清空");
        } catch (e: any) {
          message.error(e?.response?.data?.error || "清空失败");
          throw e;
        }
      },
    });
  };

  const handleDeleteRoom = async (roomId?: string) => {
    const id = roomId || activeIdRef.current;
    const listedTarget = rooms.find((room) => room.id === id) || null;
    const target = activeRoom?.id === id ? activeRoom : listedTarget;
    if (!id || !target) return;
    const xiaoceTask = isXiaoceRoom(target);
    let running = false;
    if (xiaoceTask) {
      try {
        ({ running } = await resolveXiaoceDeleteState(id, getCollabRoom));
      } catch (error: any) {
        message.error(error?.response?.data?.error || "无法确认任务状态，请重试");
        return;
      }
    }
    const title = xiaoceTask ? "删除这个小策任务？" : "删除此会话？";
    const content = xiaoceTask
      ? xiaoceDeleteContent(running)
      : "将彻底删除该会话及全部聊天记录，所有成员都不可再访问。";
    Modal.confirm({
      className: "collab-danger-confirm",
      title,
      content,
      okText: xiaoceTask ? "删除任务" : "删除会话",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteCollabRoom(id);
          mutateRoomData(id, {});
          const remaining = roomsRef.current.filter((room) => room.id !== id);
          roomsRef.current = remaining;
          setRooms((current) => current.filter((room) => room.id !== id));
          if (activeIdRef.current === id) {
            const nextTask = xiaoceTask
              ? remaining.find((room) => isXiaoceRoom(room)) || null
              : null;
            if (nextTask) {
              selectRoom(nextTask.id);
            } else {
              roomLoadSeqRef.current += 1;
              activeIdRef.current = null;
              setActiveId(null);
              setActiveRoom(null);
              setMessages([]);
              setInsights([]);
              setActiveXiaoceRun(null);
              setRoomStats(null);
              setHasMoreBefore(false);
              setFirstItemIndex(VIRT_BASE_INDEX);
              setCancellingRunId(null);
            }
          }
          roomComposerCacheRef.current.delete(id);
          roomViewCacheRef.current.delete(id);
          message.success(xiaoceTask ? "任务已删除" : "会话已删除");
        } catch (error: any) {
          message.error(error?.response?.data?.error || "删除失败");
          throw error;
        }
      },
    });
  };

  const handleRefreshInsight = async () => {
    const roomId = activeIdRef.current;
    if (!roomId) return;
    try {
      const res = await refreshCollabInsights(roomId);
      if (activeIdRef.current === roomId) {
        setInsights((prev) => [...prev, res.insight]);
      }
      mutateRoomData(roomId, {
        room: () => res.room,
        ...(res.ai_message ? {
          messages: (previous) => previous.some((item) => item.id === res.ai_message!.id)
            ? previous
            : [...previous, res.ai_message!],
        } : {}),
      });
      await refreshStats(roomId);
      message.success("已重新分析");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "分析失败");
    }
  };

  const handleSummarize = async (windowMode: "auto" | "latest20" | "30m" | "60m") => {
    if (!activeId) return;
    setSummaryLoading(true);
    try {
      const body = windowMode === "latest20"
        ? { range_mode: "latest" as const, message_count: 20 }
        : windowMode === "30m"
          ? { range_mode: "time" as const, minutes: 30 }
          : windowMode === "60m"
            ? { range_mode: "time" as const, minutes: 60 }
            : { range_mode: "auto" as const };
      const res = await summarizeCollabRoom(activeId, body);
      setRoomStats((prev) => prev ? {
        ...prev,
        latest_summary: res.summary,
        summary_model: res.model,
        summary_suggestion: res.suggestion,
      } : prev);
      setActiveRoom((prev) => prev ? {
        ...prev,
        summary: res.summary.content,
      } : prev);
      message.success(`${res.summary.model_name || "AI"} 已生成聊天纪要`);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "生成纪要失败");
    } finally {
      setSummaryLoading(false);
    }
  };

  const insertSkill = (skill: UserSkillItem) => {
    const token = `@${skill.skill_id} `;
    setDraft((prev) => (prev.includes(token) ? prev : `${prev}${token}`));
    setTimeout(() => composerRef.current?.focus?.(), 0);
  };

  const insertConnector = (server: McpServer) => {
    const text = connectorPrompt(server);
    setDraft((prev) => {
      const base = prev.trimEnd();
      return base ? `${base}\n${text}` : text;
    });
    setTimeout(() => composerRef.current?.focus?.(), 0);
  };

  const toggleInterject = async () => {
    if (!activeId || !activeRoom) return;
    const next = !(activeRoom.interject_enabled !== false);
    try {
      const room = await updateCollabRoom(activeId, { interject_enabled: next });
      setActiveRoom(room);
      setRoomStats((prev) => (prev ? { ...prev, interject_enabled: next } : prev));
      message.success(next ? "已开启 AI 插嘴" : "已关闭 AI 插嘴");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "设置失败");
    }
  };

  const msgContextItems = (m: CollabMessage) => {
    const isSystem = m.msg_type === "system" || m.status === "recalled";
    const isRecalled = m.status === "recalled";
    const canModerate = Boolean(me?.is_staff || (activeRoom && me && activeRoom.created_by?.id === me.id));
    const canDelete = (() => {
      if (!me || (!isParticipant && !me.is_staff)) return false;
      if (m.status === "deleted") return false;
      if (isRecalled) return m.sender?.id === me.id || canModerate;
      if (m.msg_type === "system") return false;
      if (m.msg_type === "user" && m.sender?.id === me.id) return true;
      if (m.msg_type === "ai" && (isParticipant || me.is_staff)) return true;
      return canModerate;
    })();
    const items: any[] = [];
    if (!isSystem && !isRecalled) {
      items.push({
        key: "copy",
        icon: <CopyOutlined />,
        label: "复制全文",
        onClick: async () => {
          const ok = await copyText(m.content || "");
          message[ok ? "success" : "error"](ok ? "已复制" : "复制失败");
        },
      });
      items.push({
        key: "translate",
        icon: translationPendingIds.has(m.id) ? <LoadingOutlined /> : <TranslationOutlined />,
        label: translations[m.id] ? "隐藏译文" : "翻译消息",
        disabled: translationPendingIds.has(m.id) || !isBilingualText(m.content || ""),
        onClick: () => toggleMessageTranslation(m),
      });
      items.push(
        {
          key: "quote",
          icon: <RollbackOutlined />,
          label: "引用",
          onClick: () => {
            setReplyingTo(m);
            window.setTimeout(() => composerRef.current?.focus?.(), 0);
          },
        },
        {
          key: "forward",
          icon: <ForwardOutlined />,
          label: "转发",
          onClick: () => openForwardDialog([m.id], "separate"),
        },
        {
          key: "multi-select",
          icon: <CheckSquareOutlined />,
          label: "多选",
          onClick: () => {
            setSelectionMode(true);
            setSelectedMessageIds(new Set([m.id]));
          },
        },
        {
          key: "copy-id",
          label: `复制编号 #${m.id}`,
          onClick: async () => {
            const ok = await copyText(`#${m.id}`);
            message[ok ? "success" : "error"](ok ? "已复制编号" : "复制失败");
          },
        },
        {
          key: "ask-ai",
          icon: <RobotOutlined />,
          label: "让 AI 看这条",
          disabled: sending || !isParticipant || activeRoom?.status === "closed",
          onClick: () => {
            void askAiAboutMessage(m);
          },
        },
        {
          key: "wecom-todo",
          icon: <CheckSquareOutlined />,
          label: "发起企微待办",
          disabled: !isParticipant || activeRoom?.status === "closed",
          onClick: () => {
            setTodoSource(m);
            setTodoOpen(true);
          },
        },
      );
    } else if (isSystem && !isRecalled) {
      items.push({
        key: "copy",
        icon: <CopyOutlined />,
        label: "复制全文",
        onClick: async () => {
          const ok = await copyText(m.content || "");
          message[ok ? "success" : "error"](ok ? "已复制" : "复制失败");
        },
      });
    }
    if (canRecallMessage(m, me) && isParticipant) {
      items.push({
        key: "recall",
        icon: <RollbackOutlined />,
        label: "撤回",
        onClick: () => { void handleRecallMessage(m); },
      });
    }
    if (canDelete) {
      items.push({
        key: "delete",
        icon: <DeleteOutlined />,
        label: "删除",
        danger: true,
        onClick: () => handleDeleteMessage(m),
      });
    }
    return items;
  };

  const peerLabel = (room: CollabRoom) => {
    if (!me) return room.participants.map((p) => memberLabel(p)).join("、");
    const others = room.participants.filter((p) => p.id !== me.id).map((p) => memberLabel(p));
    return others.join("、") || room.participants.map((p) => memberLabel(p)).join("、");
  };

  const roomTitle = (room: CollabRoom) =>
    room.display_title || room.title || peerLabel(room);

  const presenceLabel = (room: CollabRoom) => {
    if (isXiaoceRoom(room)) return "在线";
    if (room.room_kind === "group") {
      const n = room.online_count ?? room.participants.filter((p) => p.online).length;
      return n > 0 ? `${n} 人在线` : "暂无人在线";
    }
    if (typeof room.peer_online === "boolean") {
      return room.peer_online ? "在线" : "离线";
    }
    const peer = me
      ? room.participants.find((p) => p.id !== me.id)
      : room.participants[0];
    return peer?.online ? "在线" : "离线";
  };

  const roomPeerOnline = (room: CollabRoom) => {
    if (isXiaoceRoom(room)) return true;
    if (room.room_kind === "group") {
      return (room.online_count ?? room.participants.filter((p) => p.online).length) > 0;
    }
    if (typeof room.peer_online === "boolean") return room.peer_online;
    const peer = me
      ? room.participants.find((p) => p.id !== me.id)
      : room.participants[0];
    return Boolean(peer?.online);
  };

  const filteredContacts = useMemo(() => {
    const q = contactKeyword.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const name = (c.display_name || "").toLowerCase();
      const nick = (c.nickname || "").toLowerCase();
      const user = (c.username || "").toLowerCase();
      const bio = (c.bio || "").toLowerCase();
      return user.includes(q) || name.includes(q) || nick.includes(q) || bio.includes(q);
    });
  }, [contacts, contactKeyword]);

  const botContacts = useMemo(
    () => filteredContacts.filter((c) => c.kind === "bot" || c.bot_id === "xiaoce" || c.username === "小策bot"),
    [filteredContacts],
  );
  const humanContacts = useMemo(
    () => filteredContacts.filter((c) => !(c.kind === "bot" || c.bot_id === "xiaoce" || c.username === "小策bot")),
    [filteredContacts],
  );
  const filteredTeams = useMemo(() => {
    const q = contactKeyword.trim().toLowerCase();
    if (!q) return teams;
    return teams.filter((team) => (
      team.name.toLowerCase().includes(q)
      || team.description.toLowerCase().includes(q)
      || team.members.some((member) => (
        member.username.toLowerCase().includes(q)
        || member.displayName.toLowerCase().includes(q)
      ))
    ));
  }, [contactKeyword, teams]);
  const contactById = useMemo(
    () => new Map(contacts.map((contact) => [contact.id, contact])),
    [contacts],
  );
  const selectedTeamMemberUsernames = useMemo(() => {
    const selected = new Set(groupTeamIds);
    return new Set(
      teams
        .filter((team) => selected.has(team.id))
        .flatMap((team) => team.members)
        .filter((member) => member.isActive && member.id !== me?.id)
        .map((member) => member.username),
    );
  }, [groupTeamIds, me?.id, teams]);
  const selectedGroupMembers = useMemo(
    () => Array.from(new Set([...selectedTeamMemberUsernames, ...groupMembers])),
    [groupMembers, selectedTeamMemberUsernames],
  );

  const isBotContact = (user: CollabUserBrief) =>
    user.kind === "bot" || user.bot_id === "xiaoce" || user.username === "小策bot";

  const isNewlyJoined = (user: CollabUserBrief) => {
    if (isBotContact(user)) return false;
    if (!user.date_joined) return false;
    const t = Date.parse(user.date_joined);
    if (Number.isNaN(t)) return false;
    return Date.now() - t < 7 * 24 * 3600 * 1000;
  };

  const memberUsernameSet = useMemo(() => {
    return new Set((activeRoom?.participants || []).map((p) => p.username));
  }, [activeRoom]);

  const inviteCandidateOptions = useMemo(() => {
    return contacts
      .filter((u) => !isBotContact(u) && !memberUsernameSet.has(u.username))
      .map((u) => ({
        value: u.username,
        label: u.online ? `${u.username}（在线）` : u.username,
      }));
  }, [contacts, memberUsernameSet]);

  const kickCandidateOptions = useMemo(() => {
    if (!activeRoom || !me) return [];
    const ownerId = activeRoom.created_by?.id;
    return (activeRoom.participants || [])
      .filter((p) => p.id !== me.id && p.id !== ownerId)
      .map((p) => ({
        value: p.username,
        label: memberLabel(p) !== p.username
          ? `${memberLabel(p)}（${p.username}）`
          : (p.online ? `${p.username}（在线）` : p.username),
      }));
  }, [activeRoom, me]);

  const mentionOptions = useMemo(
    () => (mention ? buildMentionOptions(
      activeRoom,
      me,
      mention.query,
      xiaoceRoom
        ? findXiaoceReferenceRooms(rooms, activeId, mention.query)
        : [],
    ) : []),
    [mention, activeRoom, me, xiaoceRoom, rooms, activeId],
  );

  const atomicMentionTokens = useMemo(() => [
    "@所有人",
    "@AI",
    ...(activeRoom?.participants || []).map((participant) => `@${participant.username}`),
  ], [activeRoom]);

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query, mentionOptions.length]);

  useEffect(() => {
    const menu = mentionMenuRef.current;
    if (!menu || mentionIndex < 0 || mentionIndex >= mentionOptions.length) return;
    const option = menu.children.item(mentionIndex) as HTMLElement | null;
    if (!option) return;
    const nextScrollTop = mentionMenuScrollTop(
      menu.scrollTop,
      menu.clientHeight,
      option.offsetTop,
      option.offsetHeight,
    );
    if (nextScrollTop !== menu.scrollTop) menu.scrollTop = nextScrollTop;
  }, [mention?.query, mentionIndex, mentionOptions.length]);

  const jumpEvidence = (mid: number) => {
    setHighlightId(mid);
    // 虚拟列表未挂载时退回 DOM；已渲染则滚入视区
    requestAnimationFrame(() => {
      document.getElementById(`collab-msg-${mid}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  };

  const openSearchResult = (result: CollabSearchResult) => {
    setChatSearchOpen(false);
    setSiderTab("chats");
    const roomId = result.room.id;
    const messageId = result.message?.id;
    if (!messageId) {
      selectRoom(roomId);
      return;
    }
    if (activeIdRef.current === roomId) {
      void loadRoomDetail(roomId, { targetMessageId: messageId });
      return;
    }
    pendingSearchTargetRef.current = { roomId, messageId };
    selectRoom(roomId);
  };

  return (
    <div className={`collab-page${embedded ? " collab-page--embedded" : ""}${summaryVisible || artifactsVisible ? "" : " collab-page--summary-hidden"}${selectionMode ? " collab-page--selecting" : ""}`}>
      <style>{css}</style>

      <aside className="collab-sider">
        <div className="collab-sider-head">
          <Typography.Text strong>{siderTab === "contacts" ? "团队通讯录" : "消息列表"}</Typography.Text>
          <Space size={4}>
            {siderTab === "chats" ? (
              <Popover
                trigger="click"
                placement="rightTop"
                overlayClassName="collab-search-popover"
                open={chatSearchOpen}
                onOpenChange={setChatSearchOpen}
                content={(
                  <CollabMessageSearch
                    onClose={() => setChatSearchOpen(false)}
                    onSelect={openSearchResult}
                  />
                )}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<SearchOutlined />}
                  title="搜索聊天记录"
                  aria-label="搜索聊天记录"
                />
              </Popover>
            ) : null}
            <Button
              type="primary"
              size="small"
              className="collab-create-group-btn"
              icon={<UsergroupAddOutlined />}
              onClick={openCreateGroup}
            >
              发起群聊
            </Button>
          </Space>
        </div>
        {!embedded ? (
          <div className="collab-tabs">
            <button
              type="button"
              className={siderTab === "chats" ? "active" : ""}
              onClick={() => switchSiderTab("chats")}
            >
              消息
            </button>
            <button
              type="button"
              className={siderTab === "contacts" ? "active" : ""}
              onClick={() => {
                switchSiderTab("contacts");
                setContactKeyword("");
                void loadContacts();
                void loadTeams();
              }}
            >
              通讯录
            </button>
          </div>
        ) : null}

        {siderTab === "chats" ? (
          <div className="collab-room-list">
            <XiaoceTaskList
              tasks={xiaoceTasks}
              activeId={activeId}
              creating={creatingXiaoce}
              canRename={(task) => Boolean(
                me && task.participants.some((participant) => participant.id === me.id),
              )}
              canDelete={(task) => Boolean(
                me?.is_staff || task.participants.some((participant) => participant.id === me?.id),
              )}
              onCreate={() => void handleCreateXiaoceTask()}
              onSelect={selectRoom}
              onRename={openRenameModal}
              onDelete={(task) => handleDeleteRoom(task.id)}
            />
            <div className="collab-contact-section-title">其他对话</div>
            {otherRooms.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={loadingRooms ? "加载中…" : "暂无其他对话"}
              />
            ) : otherRooms.map((room) => {
              const title = roomTitle(room);
              const online = roomPeerOnline(room);
              const peer = room.room_kind === "dm" && me
                ? room.participants.find((p) => p.id !== me.id)
                : undefined;
              const canRemove = Boolean(
                me?.is_staff
                || (room.room_kind !== "group" && room.participants.some((p) => p.id === me?.id))
                || (room.room_kind === "group" && room.created_by?.id === me?.id)
              );
              return (
                <div
                  key={room.id}
                  className={`collab-room-item ${activeId === room.id ? "active" : ""} ${roomDropTargetId === room.id ? "is-drop-target" : ""} risk-${room.risk_level}`}
                  onPointerEnter={() => prefetchRoom(room.id)}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes("Files") && !event.dataTransfer.types.includes(DRAG_ATTACHMENT_TYPE)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    setRoomDropTargetId(room.id);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRoomDropTargetId(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setRoomDropTargetId(null);
                    void addFilesToRoom(room.id, event.dataTransfer);
                  }}
                >
                  <button
                    type="button"
                    className="collab-room-main"
                    onClick={() => selectRoom(room.id)}
                  >
                    {peer ? (
                      <AvatarWithPresence
                        name={memberLabel(peer) || title}
                        online={online}
                        avatarUrl={peer.avatar_url}
                      />
                    ) : (
                      <AvatarWithPresence
                        name={title}
                        online={online}
                        group={room.room_kind === "group"}
                        avatarUrl={undefined}
                      />
                    )}
                    <div className="collab-room-body">
                      <div className="collab-room-top">
                        <strong>
                          {title}
                          {room.room_kind === "group" ? ` (${room.member_count || room.participants.length})` : ""}
                        </strong>
                        <em>{new Date(room.updated_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</em>
                      </div>
                      <div className="collab-room-preview">
                        <span>
                          {room.last_message
                            ? `${room.last_message.sender}: ${room.last_message.content}`
                            : room.status === "closed" ? "已结束" : presenceLabel(room)}
                        </span>
                        <span className="collab-room-badges">
                          {(room.unread_count || 0) > 0 && (
                            <Badge count={room.unread_count} size="small" />
                          )}
                          <Tag color={RISK_META[room.risk_level]?.color}>
                            {RISK_META[room.risk_level]?.label}
                          </Tag>
                        </span>
                      </div>
                    </div>
                  </button>
                  {canRemove && (
                    <Tooltip title="删除会话">
                      <button
                        type="button"
                        className="collab-room-del"
                        aria-label={`删除会话 ${title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRoom(room.id);
                        }}
                      >
                        <DeleteOutlined />
                      </button>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="collab-contact-pane">
            <Input
              allowClear
              placeholder="搜索账号 / 昵称"
              value={contactKeyword}
              onChange={(e) => {
                scheduleContactSearch(e.target.value);
              }}
              style={{ marginBottom: 8 }}
            />
            <div className="collab-room-list">
              {filteredContacts.length === 0 && filteredTeams.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={contactKeyword.trim() ? "没有匹配的联系人" : "暂无其他账号"}
                />
              ) : (
                <>
                  <div className="collab-contact-section collab-team-section">
                    <div className="collab-contact-section-title">
                      <span>团队分组</span>
                      <em>{filteredTeams.length}</em>
                    </div>
                    {teamsLoading && !teamsLoadedRef.current ? (
                      <div className="collab-team-empty"><LoadingOutlined /> 正在加载团队…</div>
                    ) : filteredTeams.length > 0 ? (
                      filteredTeams.map((team) => {
                        const expanded = expandedTeamIds.has(team.id);
                        const activeMembers = team.members.filter((member) => member.isActive);
                        return (
                          <article key={team.id} className={`collab-team-card${expanded ? " is-expanded" : ""}`}>
                            <button
                              type="button"
                              className="collab-team-card-main"
                              onClick={() => toggleTeamExpanded(team.id)}
                              aria-expanded={expanded}
                            >
                              <span className="collab-team-card-icon" aria-hidden>
                                <ApartmentOutlined />
                              </span>
                              <span className="collab-team-card-copy">
                                <strong>{team.name}</strong>
                                <small>{team.description || `${team.kindLabel} · ${team.memberCount} 位成员`}</small>
                              </span>
                              <Avatar.Group size={24} max={{ count: 3 }}>
                                {activeMembers.slice(0, 4).map((member) => (
                                  <Avatar
                                    key={member.id}
                                    src={authenticatedAvatarUrl(member.avatarUrl)}
                                  >
                                    {(member.displayName || member.username).slice(0, 1)}
                                  </Avatar>
                                ))}
                              </Avatar.Group>
                              <span className="collab-team-card-count">{team.memberCount}人</span>
                              <DownOutlined className="collab-team-card-chevron" />
                            </button>
                            {expanded ? (
                              <div className="collab-team-card-detail">
                                <div className="collab-team-member-list">
                                  {activeMembers.map((member) => {
                                    const contact = contactById.get(member.id) || {
                                      id: member.id,
                                      username: member.username,
                                      display_name: member.displayName,
                                      avatar_url: member.avatarUrl,
                                      online: false,
                                      kind: "human" as const,
                                    };
                                    return (
                                      <ProfileAvatarPopover
                                        key={member.id}
                                        user={contact}
                                        online={Boolean(contact.online)}
                                        roleHint={member.roleLabel}
                                        placement="rightTop"
                                        onMessage={() => void openDm(member.username)}
                                      >
                                        <button
                                          type="button"
                                          className="collab-team-member"
                                          aria-label={`查看 ${member.displayName || member.username} 的资料`}
                                        >
                                          <AvatarWithPresence
                                            name={member.displayName || member.username}
                                            online={Boolean(contact.online)}
                                            avatarUrl={member.avatarUrl}
                                            size={30}
                                          />
                                          <span>
                                            <strong>{member.displayName || member.username}</strong>
                                            <small>{member.roleLabel}</small>
                                          </span>
                                        </button>
                                      </ProfileAvatarPopover>
                                    );
                                  })}
                                </div>
                                <Button
                                  type="primary"
                                  block
                                  icon={<UsergroupAddOutlined />}
                                  disabled={activeMembers.every((member) => member.id === me?.id)}
                                  onClick={() => openGroupForTeam(team)}
                                >
                                  发起团队群聊
                                </Button>
                              </div>
                            ) : null}
                          </article>
                        );
                      })
                    ) : (
                      <div className="collab-team-empty">
                        <ApartmentOutlined />
                        <span>{contactKeyword.trim() ? "没有匹配的团队" : "当前企业暂无团队分组"}</span>
                      </div>
                    )}
                  </div>
                  {botContacts.length > 0 ? (
                    <div className="collab-contact-section">
                      <div className="collab-contact-section-title">应用</div>
                      {botContacts.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          className="collab-contact-item is-bot"
                          disabled={creating}
                          onClick={() => openDm(user.username)}
                        >
                          <span className="collab-bot-avatar" aria-hidden>
                            <RobotOutlined />
                          </span>
                          <div>
                            <strong>
                              {memberLabel(user) || user.username}
                              <Tag color="blue" style={{ marginLeft: 6, fontSize: 11, lineHeight: "18px" }}>Bot</Tag>
                            </strong>
                            <span className="collab-status-on">
                              {user.bio || "AI 知识问答助手"}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {humanContacts.length > 0 ? (
                    <div className="collab-contact-section">
                      <div className="collab-contact-section-title">同事</div>
                      {humanContacts.map((user) => (
                        <ProfileAvatarPopover
                          key={user.id}
                          user={user}
                          online={Boolean(user.online)}
                          placement="rightTop"
                          onMessage={() => void openDm(user.username)}
                        >
                          <button
                            type="button"
                            className="collab-contact-item"
                            disabled={creating}
                            aria-label={`查看 ${memberLabel(user) || user.username} 的资料`}
                          >
                            <AvatarWithPresence
                              name={memberLabel(user) || user.username}
                              online={Boolean(user.online)}
                              avatarUrl={user.avatar_url}
                            />
                            <div>
                              <strong>
                                {memberLabel(user) || user.username}
                                {isNewlyJoined(user) ? (
                                  <Tag color="green" style={{ marginLeft: 6, fontSize: 11, lineHeight: "18px" }}>新</Tag>
                                ) : null}
                              </strong>
                              <span className={user.online ? "collab-status-on" : "collab-status-off"}>
                                {user.online ? "在线" : "离线"}
                                {memberLabel(user) && memberLabel(user) !== user.username
                                  ? ` · ${user.username}`
                                  : ""}
                              </span>
                            </div>
                            <span className="collab-contact-open-hint">查看资料</span>
                          </button>
                        </ProfileAvatarPopover>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}
      </aside>

      <section
        className={`collab-main${isXiaoce ? " xiaoce-chat-shell" : ""}`}
      >
        {!activeRoom ? (
          activeId ? (
            <div className="collab-conversation-loading" role="status" aria-live="polite">
              <span aria-hidden="true" />
              正在打开会话…
            </div>
          ) : embedded ? (
            <div className="collab-conversation-placeholder">
              <CommentOutlined />
              <strong>选择一条会话开始协作</strong>
              <span>消息会在这里直接打开，不再加载中转卡片。</span>
            </div>
          ) : (
            <div className="collab-welcome-stage">
              <CollabWelcome
                onOpenContacts={() => switchSiderTab("contacts")}
                onCreateGroup={openCreateGroup}
              />
            </div>
          )
        ) : (
          <>
            <header className="collab-main-head">
              <div>
                <div className="collab-room-heading">
                  {activeRoom.room_kind === "group" ? (
                    <Popover
                      trigger="click"
                      placement="bottomLeft"
                      open={groupMembersOpen}
                      onOpenChange={setGroupMembersOpen}
                      overlayClassName="collab-members-popover"
                      content={<CollabGroupMembersPopover room={activeRoom} me={me} />}
                    >
                      <button
                        type="button"
                        className="collab-group-title-trigger"
                        aria-label={`查看 ${roomTitle(activeRoom)} 的全部群成员`}
                        aria-expanded={groupMembersOpen}
                      >
                        <strong>{roomTitle(activeRoom)}</strong>
                        <span>{activeRoom.participants.length} 人</span>
                        <DownOutlined aria-hidden />
                      </button>
                    </Popover>
                  ) : (
                    <Typography.Title level={4} style={{ margin: 0 }}>
                      {roomTitle(activeRoom)}
                    </Typography.Title>
                  )}
                  {isXiaoce && activeRoom.agent_runtime === "hermes-agent" ? (
                    <span
                      className="xiaoce-hermes-badge"
                      aria-label="由 Hermes Agent 驱动"
                      title="当前小策任务由 Hermes Agent 驱动"
                    >
                      Hermes
                    </span>
                  ) : null}
                  {isParticipant && (
                    (activeRoom.room_kind === "group" && activeRoom.status === "open") || isXiaoce
                  ) ? (
                    <Button
                      type="link"
                      size="small"
                      icon={<EditOutlined />}
                      style={{ marginLeft: 4, paddingInline: 4 }}
                      onClick={() => openRenameModal(activeRoom)}
                      aria-label={isXiaoce ? "修改任务名称" : "修改群名"}
                    />
                  ) : null}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <span className={roomPeerOnline(activeRoom) ? "collab-status-on" : "collab-status-off"}>
                    {presenceLabel(activeRoom)}
                  </span>
                  {" · "}
                  {activeRoom.room_kind === "group" ? "群聊" : "单聊"}
                  {" · "}
                  {activeRoom.participants.map((p) => memberLabel(p)).join("、")}
                </Typography.Text>
              </div>
              <Space className="collab-main-actions">
                <CollabTodoPreview />
                {isXiaoce ? (
                  <div className="xiaoce-theme-switch" role="group" aria-label="对话主题">
                    <Button
                      type="text"
                      size="small"
                      className={mode === "light" ? "active" : ""}
                      icon={<SunOutlined />}
                      onClick={() => setMode("light")}
                      aria-label="白色主题"
                      aria-pressed={mode === "light"}
                    />
                    <Button
                      type="text"
                      size="small"
                      className={mode === "dark" ? "active" : ""}
                      icon={<MoonOutlined />}
                      onClick={() => setMode("dark")}
                      aria-label="黑色主题"
                      aria-pressed={mode === "dark"}
                    />
                  </div>
                ) : null}
                {onStartRoundtable && isParticipant && activeRoom.status === "open" ? (
                  <Button
                    className="collab-roundtable-action"
                    icon={<TeamOutlined />}
                    onClick={() => {
                      const title = roomTitle(activeRoom);
                      onStartRoundtable({
                        title: `${title} · 圆桌`,
                        intro: `来自「${title}」团队会话。请围绕当前讨论梳理共识、风险与下一步行动。`,
                        userIds: activeRoom.participants
                          .filter((participant) => participant.kind !== "bot")
                          .map((participant) => participant.id),
                        sourceRoomId: activeRoom.id,
                      });
                    }}
                  >
                    发起圆桌
                  </Button>
                ) : null}
                <Tag color={RISK_META[activeRoom.risk_level]?.color}>
                  {RISK_META[activeRoom.risk_level]?.label}
                </Tag>
                {isParticipant ? (
                  <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    overlayClassName="collab-conversation-menu"
                    menu={{
                      items: [
                        (activeRoom.room_kind === "group" || isXiaoce) && isParticipant
                          ? {
                              key: "rename",
                              icon: <EditOutlined />,
                              label: isXiaoce ? "修改任务名称" : "修改群名",
                              onClick: () => openRenameModal(activeRoom),
                            }
                          : null,
                        activeRoom.room_kind === "group"
                          ? {
                              key: "nicks",
                              icon: <EditOutlined />,
                              label: "修改成员名称",
                              onClick: openNickModal,
                            }
                          : null,
                        activeRoom.room_kind === "group" && activeRoom.status === "open" && isParticipant
                          ? {
                              key: "invite",
                              icon: <UserAddOutlined />,
                              label: "邀请成员",
                              onClick: openInviteModal,
                            }
                          : null,
                        activeRoom.room_kind === "group" && activeRoom.status === "open" && canKickMembers
                          ? {
                              key: "kick",
                              icon: <UserDeleteOutlined />,
                              label: "移出成员",
                              disabled: kickCandidateOptions.length === 0,
                              onClick: openKickModal,
                            }
                          : null,
                        isParticipant
                          ? {
                              key: "interject",
                              icon: <RobotOutlined />,
                              label: activeRoom.interject_enabled !== false ? "关闭 AI 插嘴" : "开启 AI 插嘴",
                              onClick: toggleInterject,
                            }
                          : null,
                        isParticipant
                          ? {
                              key: "clear",
                              icon: <ClearOutlined />,
                              label: "清空聊天记录",
                              onClick: handleClearHistory,
                            }
                          : null,
                        activeRoom.status === "open" && isParticipant
                          ? {
                              key: "close",
                              icon: <StopOutlined />,
                              label: "结束会话",
                              onClick: () => {
                                Modal.confirm({
                                  title: "结束此会话？",
                                  content: "结束后不可再发消息，AI 会生成最终风控纪要。",
                                  okText: "结束会话",
                                  onOk: handleClose,
                                });
                              },
                            }
                          : null,
                        canDeleteRoom
                          ? { type: "divider" as const }
                          : null,
                        canDeleteRoom
                          ? {
                              key: "delete",
                              icon: <DeleteOutlined />,
                              label: isXiaoce
                                ? "删除任务"
                                : activeRoom.room_kind === "group" ? "删除群聊" : "删除会话",
                              danger: true,
                              onClick: () => handleDeleteRoom(activeRoom.id),
                            }
                          : null,
                      ].filter(Boolean) as any[],
                    }}
                  >
                    <Tooltip title="会话设置">
                      <Button icon={<SettingOutlined />} aria-label="会话设置" />
                    </Tooltip>
                  </Dropdown>
                ) : null}
                {activeRoom.status === "closed" && <Tag>已结束</Tag>}
                <Tooltip title={artifactsVisible ? "收起 AI 产物" : "查看 AI 产物"}>
                  <Button
                    type="text"
                    className={`collab-panel-toggle${artifactsVisible ? " is-active" : ""}`}
                    icon={<FolderOpenOutlined />}
                    onClick={() => setArtifactPanelVisible(!artifactsVisible)}
                    aria-label={artifactsVisible ? "收起 AI 产物" : "查看 AI 产物"}
                    aria-pressed={artifactsVisible}
                  />
                </Tooltip>
                <Tooltip title={summaryVisible ? "收起智能纪要" : "显示智能纪要"}>
                  <Button
                    type="text"
                    className={`collab-panel-toggle collab-summary-toggle${summaryVisible ? " is-active" : ""}`}
                    icon={<InsertRowRightOutlined />}
                    onClick={() => setSummaryPanelVisible(!summaryVisible)}
                    aria-label={summaryVisible ? "收起智能纪要" : "显示智能纪要"}
                    aria-pressed={summaryVisible}
                  />
                </Tooltip>
              </Space>
            </header>

            {bannerInsight && (bannerInsight.risk_level === "red" || bannerInsight.risk_level === "yellow") && (
              <div className={`collab-banner risk-${bannerInsight.risk_level}`}>
                <AlertOutlined />
                <span>{bannerInsight.title}</span>
                <Typography.Link onClick={() => {
                  const id = bannerInsight.evidence_message_ids?.[0];
                  if (id) jumpEvidence(id);
                }}>
                  查看证据
                </Typography.Link>
              </div>
            )}

            <div
              className="collab-messages"
              onWheelCapture={(event) => {
                if (event.deltaY < 0 || !messagesAtBottom) releaseMessageAutoScroll();
              }}
              onPointerDownCapture={(event) => {
                if (event.target === messageScrollerRef.current) releaseMessageAutoScroll();
              }}
              onPointerMoveCapture={(event) => {
                if (event.buttons) releaseMessageAutoScroll();
              }}
              onTouchMoveCapture={releaseMessageAutoScroll}
            >
              {visibleMessages.length === 0 && !xiaoceBusy ? (
                <div className="collab-empty soft">
                  {roomDetailLoading
                    ? "正在加载消息…"
                    : "开始对话吧。需要 AI 时请 @AI（或调用 Skill）；日常讨论不会自动插嘴。右侧为旁路监控。"}
                </div>
              ) : (
              <>
              <Virtuoso
                key={activeId || "none"}
                ref={virtuosoRef}
                scrollerRef={(element) => {
                  messageScrollerRef.current = element as HTMLElement | null;
                }}
                className="collab-virtuoso"
                data={visibleMessages}
                context={collabMessageListContext}
                computeItemKey={(_index, item) => String(item.meta?.client_message_key || item.id)}
                firstItemIndex={firstItemIndex}
                initialTopMostItemIndex={{
                  index: "LAST",
                  align: "end",
                }}
                followOutput={(isAtBottom) => {
                  if (Date.now() < manualScrollUntilRef.current) return false;
                  if (Date.now() < forceStickUntilRef.current) return "auto";
                  return isAtBottom && stickBottomRef.current ? "auto" : false;
                }}
                totalListHeightChanged={() => {
                  if (
                    initialBottomRoomRef.current !== activeId
                    || Date.now() > initialBottomSettleUntilRef.current
                  ) return;
                  scheduleMessagesToBottom("auto");
                }}
                atBottomThreshold={24}
                atBottomStateChange={(bottom) => {
                  setMessagesAtBottom(bottom);
                  if (bottom) stickBottomRef.current = true;
                  else if (Date.now() >= forceStickUntilRef.current) stickBottomRef.current = false;
                }}
                startReached={() => {
                  if (stickBottomRef.current || Date.now() < forceStickUntilRef.current) return;
                  void loadOlderMessages();
                }}
                increaseViewportBy={{ top: 480, bottom: 320 }}
                components={COLLAB_MESSAGE_LIST_COMPONENTS}
                itemContent={(_index, m) => {
                const isAi = m.msg_type === "ai" && m.status !== "recalled";
                const isCollabSuggest = isAi && (
                  m.ai_kind === "suggest"
                  || (m.ai_kind === "interject" && String(m.content || "").includes("【协作建议】"))
                );
                const isInterject = isAi && m.ai_kind === "interject" && !isCollabSuggest;
                const isXiaoceMessage = isAi && (
                  m.ai_kind === "xiaoce"
                  || m.sender?.bot_id === "xiaoce"
                  || m.sender?.username === "小策bot"
                );
                const aiLabel = isAi
                  ? (isCollabSuggest
                    ? "协作建议"
                    : isInterject
                      ? "监控提醒"
                      : (isXiaoceMessage ? "小策bot" : (m.sender?.display_name || "良策AI")))
                  : "";
                const isSystem = m.msg_type === "system" || m.status === "recalled";
                const mine = !isAi && !isSystem && me && m.sender.id === me.id;
                const receiptMembers = activeRoom.participants.filter(
                  (participant) => participant.id !== m.sender.id && !isAutomatedParticipant(participant),
                );
                const receiptRead = receiptMembers.filter(
                  (participant) => (participant.last_read_message_id || 0) >= m.id,
                );
                const receiptUnread = receiptMembers.filter(
                  (participant) => (participant.last_read_message_id || 0) < m.id,
                );
                const readNames = receiptRead.map((participant) => memberLabel(participant));
                const unreadNames = receiptUnread.map((participant) => memberLabel(participant));
                const unreadReceiptCount = receiptUnread.length;
                const readStateLabel = activeRoom.room_kind === "group"
                  ? (unreadReceiptCount === 0 ? "全部已读" : `${unreadReceiptCount} 人未读`)
                  : (unreadReceiptCount === 0 ? "已读" : "未读");
                // 消息自带旗标，或洞察/告警挂到证据消息上 → 显示紧凑风险徽标
                const chatAlert = !isSystem ? chatAlertByMsgId.get(m.id) : undefined;
                const flagLevel = (
                  m.risk_flag_level === "red" || m.risk_flag_level === "yellow"
                    ? m.risk_flag_level
                    : chatAlert?.level || ""
                ) as "" | "yellow" | "red";
                const flagLabel = (
                  m.risk_flag
                  || chatAlert?.label
                  || (flagLevel === "red" ? "高风险" : flagLevel === "yellow" ? "注意" : "")
                ).trim();
                const flagAdvice = chatAlert?.advice || "";
                const flagged = (flagLevel === "red" || flagLevel === "yellow") && Boolean(flagLabel);
                const forwardBundle = Array.isArray(m.meta?.forward_bundle) ? m.meta.forward_bundle : [];
                const forwardedFrom = m.meta?.forwarded_from;
                const translated = translations[m.id];
                const translating = translationPendingIds.has(m.id);
                const timeSep = timeSepBeforeId.has(m.id)
                  ? formatChatTimeSep(m.created_at)
                  : "";
                if (isSystem) {
                  return (
                    <div className="collab-virt-item">
                      {timeSep ? <div className="collab-time-sep">{timeSep}</div> : null}
                      <Dropdown
                        trigger={["contextMenu"]}
                        overlayClassName="collab-message-menu"
                        menu={{ items: msgContextItems(m) }}
                      >
                        <div id={`collab-msg-${m.id}`} className="collab-msg system">
                          <div className="collab-system-tip">{m.content}</div>
                        </div>
                      </Dropdown>
                    </div>
                  );
                }
                return (
                  <div className="collab-virt-item">
                    {timeSep ? <div className="collab-time-sep">{timeSep}</div> : null}
                    <Dropdown
                      trigger={["contextMenu"]}
                      overlayClassName="collab-message-menu"
                      menu={{ items: msgContextItems(m) }}
                    >
                    <div
                      id={`collab-msg-${m.id}`}
                      className={`collab-msg ${mine ? "mine" : "peer"} ${isAi ? "ai" : ""} ${isInterject ? "interject" : ""} ${isCollabSuggest ? "suggest" : ""} ${flagged ? "flagged" : ""} ${selectedMessageIds.has(m.id) ? "is-selected" : ""} ${highlightId === m.id ? "highlight" : ""}`}
                    >
                      {selectionMode ? (
                        <button
                          type="button"
                          className={`collab-message-selector${selectedMessageIds.has(m.id) ? " is-selected" : ""}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleMessageSelection(m.id);
                          }}
                          aria-label={selectedMessageIds.has(m.id) ? "取消选择消息" : "选择消息"}
                        >
                          {selectedMessageIds.has(m.id) ? <CheckOutlined /> : null}
                        </button>
                      ) : null}
                      <div className="collab-msg-aside">
                        <Tooltip title={`发送于 ${formatChatTimeSep(m.created_at)}`}>
                          <span className="collab-msg-name">
                            <span className="collab-msg-name-text">
                              {isAi ? aiLabel : memberLabel(m.sender)}
                            </span>
                            {isAi && m.meta?.agent_runtime === "hermes-agent" ? (
                              <span className="xiaoce-hermes-badge" title="由 Hermes Agent 驱动">
                                Hermes
                              </span>
                            ) : null}
                            {isCollabSuggest ? <em className="collab-suggest-tag">建议</em> : null}
                            {isInterject ? <em className="collab-interject-tag">警告</em> : null}
                          </span>
                        </Tooltip>
                        <ProfileAvatarPopover
                          ai={isAi}
                          interject={isInterject}
                          suggest={isCollabSuggest}
                          sentAt={m.created_at}
                          placement={mine ? "leftTop" : "rightTop"}
                          online={!isAi
                            ? activeRoom?.participants.find((p) => p.id === m.sender.id)?.online
                            : true}
                          roleHint={
                            !isAi && activeRoom?.created_by?.id === m.sender.id ? "群主" : undefined
                          }
                          user={(() => {
                            if (isAi) return null;
                            const p = activeRoom?.participants.find((x) => x.id === m.sender.id);
                            if (!p) return m.sender;
                            return {
                              ...m.sender,
                              ...p,
                              display_name: p.display_name || m.sender.display_name,
                              bio: p.bio || m.sender.bio,
                              avatar_url: p.avatar_url ?? m.sender.avatar_url,
                            };
                          })()}
                        />
                      </div>
                      <div className="collab-bubble-wrap">
                        {flagged && (
                          <Tooltip
                            title={flagAdvice || flagLabel}
                            placement={mine ? "topRight" : "topLeft"}
                          >
                            <div className={`collab-msg-flag risk-${flagLevel}`}>
                              <AlertOutlined aria-hidden />
                              <span className="collab-msg-flag-label">{flagLabel}</span>
                            </div>
                          </Tooltip>
                        )}
                        <div className={`collab-bubble${flagged ? ` risk-edge-${flagLevel}` : ""}`}>
                        {m.meta?.context_rooms?.map((contextRoom) => (
                          <div key={contextRoom.id} className="collab-context-block">
                            <HistoryOutlined aria-hidden />
                            <span>
                              <strong>引用小策历史任务</strong>
                              <em>
                                {contextRoom.title}
                                {typeof contextRoom.message_count === "number"
                                  ? ` · ${contextRoom.message_count} 条消息`
                                  : ""}
                              </em>
                            </span>
                          </div>
                        ))}
                        {m.reply_to ? (
                          <button
                            type="button"
                            className="collab-quote-block"
                            onClick={(event) => {
                              event.stopPropagation();
                              jumpEvidence(m.reply_to!.id);
                            }}
                            title={`定位到消息 #${m.reply_to.id}`}
                          >
                            <strong>{m.reply_to.sender.display_name || m.reply_to.sender.username}</strong>
                            <span>{m.reply_to.content || "[附件]"}</span>
                          </button>
                        ) : null}
                        {forwardedFrom ? (
                          <div className="collab-forward-origin">
                            <ForwardOutlined />
                            <span>
                              转发自 {memberLabel(forwardedFrom.sender) || forwardedFrom.sender.username}
                              <small>{forwardedFrom.room_title}</small>
                            </span>
                          </div>
                        ) : null}
                        {forwardBundle.length ? (
                          <div className="collab-forward-card">
                            <div className="collab-forward-card-head">
                              <strong>合并转发的聊天记录</strong>
                              <span>{forwardBundle.length} 条</span>
                            </div>
                            <div className="collab-forward-card-list">
                              {forwardBundle.map((item) => (
                                <div key={`${item.room_id}-${item.message_id}`} className="collab-forward-card-item">
                                  <Avatar
                                    size={28}
                                    src={authAvatarSrc(item.sender.avatar_url)}
                                    style={{ background: avatarColor(memberLabel(item.sender) || item.sender.username) }}
                                  >
                                    {(memberLabel(item.sender) || item.sender.username).slice(0, 1)}
                                  </Avatar>
                                  <div>
                                    <strong>{memberLabel(item.sender) || item.sender.username}</strong>
                                    <p>{item.content || (item.attachments?.length ? `[${item.attachments.length} 个附件]` : "空消息")}</p>
                                    <small>{formatChatTimeSep(item.created_at)} · {item.room_title}</small>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {!forwardBundle.length && !!m.attachments?.length && (
                          <div className="collab-msg-attach">
                            {m.attachments.filter((a) => a.is_image && (a.url || a.preview_url)).length > 0 && (
                              <div className="collab-msg-images">
                                <Image.PreviewGroup>
                                  {m.attachments.filter((a) => a.is_image && (a.url || a.preview_url)).map((a) => (
                                    <div key={a.id} className={`collab-msg-image-shell${a.uploading ? " is-uploading" : ""}`}>
                                      <Image
                                        src={a.preview_url || collabAttachUrl(a.url)}
                                        preview={{ src: collabAttachUrl(a.url) || a.preview_url }}
                                        alt={a.name || "图片"}
                                        className="collab-msg-image"
                                        rootClassName="collab-msg-image-root"
                                        draggable={Boolean(a.url)}
                                        onLoad={() => {
                                          virtuosoRef.current?.autoscrollToBottom();
                                        }}
                                        onDragStart={(event) => {
                                          if (!a.url) {
                                            event.preventDefault();
                                            return;
                                          }
                                          event.dataTransfer.effectAllowed = "copy";
                                          event.dataTransfer.setData(DRAG_ATTACHMENT_TYPE, JSON.stringify({
                                            url: a.url,
                                            name: a.name,
                                            mime: a.mime,
                                          }));
                                        }}
                                      />
                                      {a.uploading ? (
                                        <span className="collab-msg-uploading">
                                          <LoadingOutlined spin />
                                          发送中
                                        </span>
                                      ) : null}
                                      {a.url && !a.uploading ? (
                                        <Tooltip title="保存图片">
                                          <a
                                            className="collab-msg-image-save"
                                            href={collabAttachUrl(a.url, true)}
                                            download={a.name || "聊天图片"}
                                            onClick={(event) => event.stopPropagation()}
                                            aria-label={`保存${a.name || "图片"}`}
                                          >
                                            <DownloadOutlined />
                                          </a>
                                        </Tooltip>
                                      ) : null}
                                    </div>
                                  ))}
                                </Image.PreviewGroup>
                              </div>
                            )}
                            {m.attachments.filter((a) => !a.is_image).map((a) => {
                              const opensArtifactPreview = Boolean(isAi && a.url && !a.uploading);
                              const body = (
                                <>
                                <FileOutlined />
                                <span className="collab-msg-file-meta">
                                  <strong>{a.name || "附件"}</strong>
                                  <em>{a.uploading ? "正在发送…" : fmtSize(a.size || 0)}</em>
                                </span>
                                {a.uploading
                                  ? <LoadingOutlined spin />
                                  : opensArtifactPreview ? <FolderOpenOutlined /> : <DownloadOutlined />}
                                </>
                              );
                              return a.url && opensArtifactPreview ? (
                                <button
                                  type="button"
                                  key={a.id}
                                  className="collab-msg-file is-artifact"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openArtifactPreview(m.id, a.id);
                                  }}
                                  draggable
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "copy";
                                    event.dataTransfer.setData(DRAG_ATTACHMENT_TYPE, JSON.stringify({
                                      url: a.url,
                                      name: a.name,
                                      mime: a.mime,
                                    }));
                                  }}
                                  aria-label={`预览产物 ${a.name || "附件"}`}
                                >
                                  {body}
                                </button>
                              ) : a.url ? (
                                <a
                                  key={a.id}
                                  className="collab-msg-file"
                                  href={collabAttachUrl(a.url, true)}
                                  target="_blank"
                                  rel="noreferrer"
                                  download={a.name}
                                  draggable
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "copy";
                                    event.dataTransfer.setData(DRAG_ATTACHMENT_TYPE, JSON.stringify({
                                      url: a.url,
                                      name: a.name,
                                      mime: a.mime,
                                    }));
                                  }}
                                >
                                  {body}
                                </a>
                              ) : (
                                <div key={a.id} className="collab-msg-file is-uploading">
                                  {body}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {!forwardBundle.length && m.content ? renderMessageBody(m.content, activeRoom, isAi) : null}
                        {!forwardBundle.length && m.content && (translated || translating) ? (
                          <div className={`collab-translation${translating && !translated ? " is-loading" : ""}`}>
                            <span className="collab-translation-label">
                              {translating && !translated ? <LoadingOutlined /> : <TranslationOutlined />}
                              {translated?.target_language === "en" ? "English" : "中文译文"}
                            </span>
                            {translated ? (
                              <div className="collab-translation-text">
                                {renderMessageBody(translated.translated_text, activeRoom, isAi)}
                              </div>
                            ) : <span className="collab-translation-loading">正在翻译…</span>}
                          </div>
                        ) : null}
                        {isAi && m.meta?.process_steps?.length ? (
                          <XiaoceProcess
                            steps={m.meta.process_steps}
                            status={m.meta.process_status || "completed"}
                            defaultExpanded={
                              m.meta.process_status === "failed"
                              || m.meta.process_status === "cancelled"
                            }
                            errorMessage={m.meta.error_message || ""}
                          />
                        ) : null}
                        {isXiaoceMessage && m.meta?.created_skill && !m.meta.cancelled ? (
                          <div className="xiaoce-created-skill" aria-label="Skill 已创建">
                            <strong>{m.meta.created_skill.name}</strong>
                            <span>@{m.meta.created_skill.skill_id}</span>
                            <Tag>仅自己可见</Tag>
                            {m.meta.created_skill.enabled ? <Tag color="success">已上传并启用</Tag> : null}
                          </div>
                        ) : null}
                      </div>
                      {mine && receiptMembers.length > 0 && m.id > 0 ? (
                        <Popover
                          trigger="click"
                          placement="bottomRight"
                          content={(
                            <div className="collab-read-popover">
                            <strong>{activeRoom.room_kind === "group" ? "群消息回执" : "消息状态"}</strong>
                            <span>已读：{readNames.length ? readNames.join("、") : "暂无"}</span>
                            <span>未读：{unreadNames.length ? unreadNames.join("、") : "全部已读"}</span>
                            <span>发送时间：{formatChatTimeSep(m.created_at)}</span>
                            </div>
                          )}
                        >
                          <button
                            type="button"
                            className={`collab-read-state${unreadReceiptCount === 0 ? " is-all-read" : ""}`}
                          >
                            {readStateLabel}
                          </button>
                        </Popover>
                      ) : null}
                      </div>
                    </div>
                    </Dropdown>
                  </div>
                );
              }}
              />
              {!messagesAtBottom ? (
                <Tooltip title="回到最新消息" placement="left">
                  <button
                    type="button"
                    className="collab-scroll-bottom"
                    onClick={() => scrollMessagesToBottom("smooth")}
                    aria-label="回到最新消息"
                  >
                    <DownOutlined />
                  </button>
                </Tooltip>
              ) : null}
              </>
              )}
            </div>

            {selectionMode ? (
              <div className="collab-selection-toolbar" role="toolbar" aria-label="批量消息操作">
                <div>
                  <strong>已选择 {selectedMessageIds.size} 条消息</strong>
                  <span>可合并为一张聊天记录卡片，或按原顺序逐条转发</span>
                </div>
                <Space size={6}>
                  <Button
                    size="small"
                    icon={<ForwardOutlined />}
                    disabled={!selectedMessageIds.size}
                    onClick={() => openForwardDialog(Array.from(selectedMessageIds), "merge")}
                  >
                    合并转发
                  </Button>
                  <Button
                    size="small"
                    icon={<ForwardOutlined />}
                    disabled={!selectedMessageIds.size}
                    onClick={() => openForwardDialog(Array.from(selectedMessageIds), "separate")}
                  >
                    逐条转发
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    onClick={() => {
                      setSelectionMode(false);
                      setSelectedMessageIds(new Set());
                    }}
                  >
                    取消
                  </Button>
                </Space>
              </div>
            ) : null}

            <div
              className={`agent-chat-input collab-agent-input${composerDragActive ? " is-drag-active" : ""}`}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes("Files") && !event.dataTransfer.types.includes(DRAG_ATTACHMENT_TYPE)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setComposerDragActive(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setComposerDragActive(false);
                void filesFromDrop(event.dataTransfer).then(addFiles);
              }}
            >
              {composerDragActive ? (
                <div className="collab-composer-drop-overlay" aria-hidden>
                  <PaperClipOutlined />
                  <strong>松开即可添加到当前会话</strong>
                </div>
              ) : null}
              <div className="collab-agent-input-inner">
              {referencedRoom ? (
                <div className="collab-context-composer">
                  <HistoryOutlined aria-hidden />
                  <div>
                    <strong>已引用小策历史任务</strong>
                    <span>
                      {referencedRoom.display_title || referencedRoom.title}
                      {typeof referencedRoom.message_count === "number"
                        ? ` · ${referencedRoom.message_count} 条消息`
                        : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="取消引用历史任务"
                    onClick={() => {
                      const token = `@「${referencedRoom.display_title || referencedRoom.title}」 `;
                      setDraft((current) => current.replace(token, ""));
                      setReferencedRoom(null);
                    }}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              ) : null}
              {replyingTo ? (
                <div className="collab-reply-composer">
                  <div>
                    <strong>回复 {memberLabel(replyingTo.sender) || "这条消息"}</strong>
                    <span>
                      {(replyingTo.content || (replyingTo.attachments?.length ? "[附件]" : "")).slice(0, 140)}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="取消引用"
                    onClick={() => setReplyingTo(null)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              ) : null}
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
                          onClick={() => removePendingFile(idx)}
                        >
                          ×
                        </button>
                        <span>{item.file.name}</span>
                      </div>
                    ) : (
                      <Tag
                        key={`${item.file.name}-${idx}`}
                        closable
                        onClose={() => removePendingFile(idx)}
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
                accept={FILE_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <div
                ref={composerBoxRef}
                className={`agent-chat-composer collab-agent-composer${draftCoach || draftCoachLoading ? " has-coach" : ""}${mention && mentionOptions.length > 0 ? " has-mention" : ""}`}
                style={composerMinHeight
                  ? { "--collab-composer-min-height": `${composerMinHeight}px` } as CSSProperties
                  : undefined}
              >
                <button
                  type="button"
                  className="collab-composer-resizer"
                  aria-label="向上拖动扩大输入框，双击恢复自动高度"
                  title="向上拖动调整输入框高度，双击恢复自动高度"
                  onPointerDown={beginComposerResize}
                  onPointerMove={moveComposerResize}
                  onPointerUp={finishComposerResize}
                  onPointerCancel={finishComposerResize}
                  onLostPointerCapture={finishComposerResize}
                  onDoubleClick={() => setComposerMinHeight(0)}
                  onKeyDown={(event) => {
                    if (event.key === "Home" || event.key === "0") {
                      event.preventDefault();
                      setComposerMinHeight(0);
                      return;
                    }
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                    event.preventDefault();
                    const textarea = composerRef.current?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
                    const currentHeight = composerMinHeight || textarea?.getBoundingClientRect().height || 72;
                    const direction = event.key === "ArrowUp" ? 24 : -24;
                    const viewportLimit = Math.max(120, window.innerHeight - 260);
                    setComposerMinHeight(Math.max(56, Math.min(viewportLimit, currentHeight + direction)));
                  }}
                >
                  <span aria-hidden />
                </button>
                {mention && mentionOptions.length > 0 ? (
                  <div ref={mentionMenuRef} className="collab-mention-menu" role="listbox">
                    {mentionOptions.map((opt, idx) => (
                      <button
                        key={opt.id}
                        type="button"
                        role="option"
                        aria-selected={idx === mentionIndex}
                        className={idx === mentionIndex ? "active" : ""}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyMention(opt);
                        }}
                      >
                        <span className="collab-mention-ico">
                          {opt.type === "conversation"
                            ? <HistoryOutlined />
                            : opt.type === "ai"
                              ? <RobotOutlined />
                              : opt.type === "all"
                                ? <TeamOutlined />
                                : <UserOutlined />}
                        </span>
                        <span>
                          <strong>{opt.label}</strong>
                          <em>{opt.desc}</em>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                {(draftCoach || draftCoachLoading) && (
                  <div className={`collab-draft-examples level-${draftCoach?.level || "info"}`}>
                    <span className="collab-draft-examples-title">
                      {draftCoachLoading && !draftCoach
                        ? "正在生成改写…"
                        : draftCoach?.level === "yellow" || draftCoach?.level === "red"
                          ? (draftCoach?.advice || draftCoach?.label || "发送前请注意")
                          : "试试这样说"}
                    </span>
                    <div className="collab-draft-examples-list">
                      {(draftCoach?.tips || []).map((t) => (
                        <button
                          key={`${t.label}-${t.example}`}
                          type="button"
                          className={`collab-draft-example-chip kind-${t.kind || "optimize"}`}
                          title={t.advice || "点击填入输入框"}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            const next = (t.example || "").trim();
                            if (!next) return;
                            setDraft(next);
                            setDraftCoach(null);
                            setTimeout(() => {
                              try {
                                const el = composerRef.current?.resizableTextArea?.textArea as HTMLTextAreaElement | undefined;
                                el?.focus();
                                el?.setSelectionRange(next.length, next.length);
                              } catch {
                                /* ignore */
                              }
                            }, 0);
                          }}
                        >
                          <em>{t.label || "示例"}</em>
                          <strong>{t.example}</strong>
                        </button>
                      ))}
                      {draftCoachLoading && !draftCoach ? (
                        <span className="collab-draft-examples-loading">稍等一下</span>
                      ) : null}
                    </div>
                  </div>
                )}
                <Input.TextArea
                  ref={composerRef}
                  className="agent-chat-composer-textarea"
                  variant="borderless"
                  value={draft}
                  onChange={(e) => {
                    const value = e.target.value;
                    const el = e.target;
                    // 下一帧再读一次光标，避免 selectionStart 滞后
                    const immediate = el.selectionStart;
                    onDraftChange(value, immediate);
                    if (immediate === 0 && value.length > 0) {
                      requestAnimationFrame(() => {
                        syncMentionFromCaret(value, el.selectionStart ?? value.length);
                      });
                    }
                  }}
                  onClick={(e) => {
                    const el = e.target as HTMLTextAreaElement;
                    syncMentionFromCaret(el.value, el.selectionStart ?? 0);
                  }}
                  onKeyUp={(e) => {
                    const el = e.target as HTMLTextAreaElement;
                    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                      syncMentionFromCaret(el.value, el.selectionStart ?? 0);
                    }
                  }}
                  placeholder={
                    !isParticipant
                      ? "你不是该会话成员"
                      : activeRoom.status === "closed"
                        ? "会话已结束"
                        : xiaoceBusy
                          ? "小策bot 正在处理，可点击右侧暂停"
                        : xiaoceRoom
                          ? "输入消息… 用 @ 引用之前的小策任务"
                          : "输入消息… 用 @ 提及成员 / @AI；停手约 3 秒会给出可点的改写示例"
                  }
                  autoSize={{ minRows: 2 }}
                  disabled={!isParticipant || activeRoom.status === "closed" || sending || xiaoceBusy}
                  onPaste={(e) => {
                    const cd = e.clipboardData;
                    if (!cd) return;
                    const files: File[] = [];
                    const items = cd.items;
                    if (items) {
                      for (let i = 0; i < items.length; i++) {
                        const it = items[i];
                        if (it.type.startsWith("image/")) {
                          const f = it.getAsFile();
                          if (f) files.push(f);
                        }
                      }
                    }
                    const plain = cd.getData("text/plain") || "";
                    const urls = extractClipboardUrls(cd);
                    const rewritten = buildLinkAwarePaste(plain, urls);
                    if (!files.length && !rewritten) return;

                    e.preventDefault();
                    if (files.length) addFiles(files);

                    const el = e.target as HTMLTextAreaElement;
                    const start = el.selectionStart ?? draft.length;
                    const end = el.selectionEnd ?? draft.length;
                    const insert = rewritten ?? (files.length ? plain : "");
                    if (!insert) return;
                    const next = `${draft.slice(0, start)}${insert}${draft.slice(end)}`;
                    setDraft(next);
                    const caret = start + insert.length;
                    setTimeout(() => {
                      try {
                        el.focus();
                        el.setSelectionRange(caret, caret);
                      } catch {
                        /* ignore */
                      }
                      syncMentionFromCaret(next, caret);
                    }, 0);
                  }}
                  onKeyDown={(e) => {
                    const nativeEvent = e.nativeEvent as KeyboardEvent;
                    const isComposing = nativeEvent.isComposing || nativeEvent.keyCode === 229;
                    if (!isComposing && mention && mentionOptions.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setMentionIndex((i) => (i + 1) % mentionOptions.length);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setMentionIndex((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
                        return;
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setMention(null);
                        return;
                      }
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        applyMention(mentionOptions[mentionIndex] || mentionOptions[0]);
                        return;
                      }
                      if (e.key === "Tab") {
                        e.preventDefault();
                        applyMention(mentionOptions[mentionIndex] || mentionOptions[0]);
                        return;
                      }
                    }
                    if (
                      !isComposing
                      && (e.key === "Backspace" || e.key === "Delete")
                    ) {
                      const el = e.currentTarget;
                      const edit = deleteAtomicMentionAtCaret(
                        el.value,
                        el.selectionStart ?? el.value.length,
                        el.selectionEnd ?? el.value.length,
                        e.key === "Backspace" ? "backward" : "forward",
                        atomicMentionTokens,
                      );
                      if (edit) {
                        e.preventDefault();
                        onDraftChange(edit.value, edit.caret);
                        requestAnimationFrame(() => {
                          el.focus();
                          el.setSelectionRange(edit.caret, edit.caret);
                        });
                        return;
                      }
                    }
                    if (!isComposing && e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <div className="agent-chat-composer-bar">
                  <div className="agent-chat-composer-left">
                    <ChatSkillPicker onSelect={insertSkill} refreshKey={skillRefreshKey} />
                    <ChatConnectorPicker onSelect={insertConnector} />
                    {!(mention && mentionOptions.length > 0) ? (
                      <span className="collab-composer-hint">
                        {xiaoceRoom ? "@历史任务 · Skill · 连接器" : "@成员 · @AI · Skill · 连接器"}
                      </span>
                    ) : null}
                  </div>
                  <div className="agent-chat-composer-right">
                    <Tooltip title={`上传附件（最多 ${MAX_FILES} 个）`}>
                      <Button
                        className="agent-chat-circle-btn"
                        type="text"
                        shape="circle"
                        icon={<PlusOutlined />}
                        disabled={!isParticipant || activeRoom.status === "closed" || sending || xiaoceBusy || pendingFiles.length >= MAX_FILES}
                        onClick={() => fileInputRef.current?.click()}
                        aria-label="上传附件"
                      />
                    </Tooltip>
                    {xiaoceBusy ? (
                      <Tooltip title={cancellingRunId ? "正在暂停" : "暂停处理"}>
                        <Button
                          className="agent-chat-stop-circle"
                          type="primary"
                          shape="circle"
                          icon={<span className="agent-chat-stop-glyph" aria-hidden="true" />}
                          loading={Boolean(cancellingRunId)}
                          disabled={Boolean(cancellingRunId)}
                          onClick={pauseXiaoce}
                          aria-label="暂停小策处理"
                        />
                      </Tooltip>
                    ) : (
                      <Tooltip title={canSendMessage ? "发送消息" : "输入内容后发送"}>
                        <Button
                          className={`agent-chat-send-circle${canSendMessage || sending ? " is-ready" : ""}`}
                          type="primary"
                          shape="circle"
                          icon={<SendOutlined />}
                          loading={sending}
                          disabled={!canSendMessage}
                          onClick={handleSend}
                          aria-label={canSendMessage ? "发送消息" : "请输入内容后发送"}
                        />
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
              </div>
            </div>
          </>
        )}
      </section>

      {summaryVisible ? (
        <CollabMonitorBoard
          room={activeRoom}
          stats={roomStats}
          loading={statsLoading}
          onRefresh={handleRefreshInsight}
          onJumpEvidence={jumpEvidence}
          summaryLoading={summaryLoading}
          onSummarize={handleSummarize}
          onClose={() => setSummaryPanelVisible(false)}
        />
      ) : null}

      {artifactsVisible ? (
        <CollabArtifactsPanel
          messages={visibleMessages}
          attachmentUrl={collabAttachUrl}
          onClose={() => setArtifactPanelVisible(false)}
          onJumpToMessage={jumpEvidence}
          selectedArtifactId={selectedArtifactId}
          onSelectArtifact={setSelectedArtifactId}
        />
      ) : null}

      {!summaryVisible && !artifactsVisible && !activeRoom ? (
        <Tooltip title="显示智能纪要" placement="left">
          <button
            type="button"
            className="collab-summary-reopen"
            onClick={() => setSummaryPanelVisible(true)}
            aria-label="显示智能纪要"
          >
            <InsertRowRightOutlined />
          </button>
        </Tooltip>
      ) : null}

      <ChatTodoModal
        open={todoOpen}
        source={todoSource}
        participants={activeRoom?.participants || []}
        onClose={() => {
          setTodoOpen(false);
          setTodoSource(null);
        }}
      />

      <Modal
        title="转发消息"
        open={forwardOpen}
        onCancel={() => setForwardOpen(false)}
        onOk={() => void submitForward()}
        okText="确认转发"
        cancelText="取消"
        confirmLoading={forwardSubmitting}
        okButtonProps={{ disabled: !forwardTargetId || !forwardMessageIds.length }}
        className="collab-forward-modal"
      >
        <div className="collab-forward-form">
          <div className="collab-forward-mode" role="group" aria-label="转发方式">
            <button
              type="button"
              className={forwardMode === "merge" ? "is-active" : ""}
              onClick={() => setForwardMode("merge")}
            >
              <CheckSquareOutlined />
              <span><strong>合并转发</strong><small>整理为一张聊天记录卡片</small></span>
            </button>
            <button
              type="button"
              className={forwardMode === "separate" ? "is-active" : ""}
              onClick={() => setForwardMode("separate")}
            >
              <ForwardOutlined />
              <span><strong>逐条转发</strong><small>按当前顺序发送每条消息</small></span>
            </button>
          </div>
          <label htmlFor="collab-forward-target">转发到</label>
          <Select
            id="collab-forward-target"
            showSearch
            value={forwardTargetId}
            onChange={setForwardTargetId}
            options={forwardRoomOptions}
            optionFilterProp="label"
            placeholder="选择目标会话"
            style={{ width: "100%" }}
          />
          <div className="collab-forward-count">将转发 {forwardMessageIds.length} 条消息</div>
        </div>
      </Modal>

      <Modal
        title="发起群聊"
        open={groupOpen}
        className="collab-group-modal"
        onCancel={() => {
          setGroupOpen(false);
          setGroupTeamIds([]);
          setGroupMembers([]);
          setGroupTitle("");
        }}
        onOk={handleCreateGroup}
        confirmLoading={creating}
        okText="创建群聊"
        okButtonProps={{ disabled: selectedGroupMembers.length === 0 }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <div>
            <Typography.Text type="secondary">群名称（可选）</Typography.Text>
            <Input
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="默认用成员名生成"
            />
          </div>
          <div>
            <Typography.Text type="secondary">直接选择团队</Typography.Text>
            <Select
              mode="multiple"
              showSearch
              loading={teamsLoading}
              style={{ width: "100%" }}
              placeholder={teams.length ? "选择一个或多个团队" : "暂无可选团队"}
              value={groupTeamIds}
              onChange={setGroupTeamIds}
              optionFilterProp="label"
              options={teams.map((team) => ({
                value: team.id,
                label: `${team.name}（${team.memberCount} 人）`,
              }))}
            />
            {groupTeamIds.length ? (
              <div className="collab-group-team-summary">
                <CheckOutlined />
                已从 {groupTeamIds.length} 个团队选入 {selectedTeamMemberUsernames.size} 位成员
              </div>
            ) : null}
          </div>
          <div>
            <Typography.Text type="secondary">补充选择同事</Typography.Text>
            <Select
              mode="multiple"
              showSearch
              style={{ width: "100%" }}
              placeholder="可继续补充团队之外的联系人"
              value={groupMembers}
              onChange={setGroupMembers}
              onSearch={(q) => loadContacts(q)}
              options={contacts
                .filter((u) => (
                  !(u.kind === "bot" || u.bot_id === "xiaoce" || u.username === "小策bot")
                  && u.id !== me?.id
                  && !selectedTeamMemberUsernames.has(u.username)
                ))
                .map((u) => ({
                  value: u.username,
                  label: memberLabel(u) !== u.username
                    ? `${memberLabel(u)}（${u.username}）`
                    : u.username,
                }))}
              filterOption={false}
            />
          </div>
          <div className="collab-group-total">
            <TeamOutlined /> 群聊将包含你和另外 {selectedGroupMembers.length} 位成员
          </div>
        </Space>
      </Modal>

      <Modal
        title="邀请成员加入群聊"
        open={inviteOpen}
        onCancel={() => {
          setInviteOpen(false);
          setInviteMembers([]);
        }}
        onOk={handleInviteMembers}
        confirmLoading={inviting}
        okText="邀请加入"
        okButtonProps={{ disabled: inviteMembers.length === 0 }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Typography.Text type="secondary">
            当前群成员：{(activeRoom?.participants || []).map((p) => memberLabel(p)).join("、") || "无"}
          </Typography.Text>
          <div>
            <Typography.Text type="secondary">选择要邀请的联系人</Typography.Text>
            <Select
              mode="multiple"
              showSearch
              style={{ width: "100%" }}
              placeholder={inviteCandidateOptions.length ? "从通讯录选择" : "暂无可邀请的联系人"}
              value={inviteMembers}
              onChange={setInviteMembers}
              onSearch={(q) => loadContacts(q)}
              options={inviteCandidateOptions}
              filterOption={false}
              notFoundContent="没有可邀请的账号"
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title="移出群成员"
        open={kickOpen}
        onCancel={() => {
          setKickOpen(false);
          setKickMembers([]);
        }}
        onOk={handleKickMembers}
        confirmLoading={kicking}
        okText="确认移出"
        okButtonProps={{ danger: true, disabled: kickMembers.length === 0 }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Typography.Text type="secondary">
            群主不可被移出。被移出的成员将无法继续在此群发消息。
          </Typography.Text>
          <div>
            <Typography.Text type="secondary">选择要移出的成员</Typography.Text>
            <Select
              mode="multiple"
              showSearch
              style={{ width: "100%" }}
              placeholder={kickCandidateOptions.length ? "选择成员" : "没有可移出的成员"}
              value={kickMembers}
              onChange={setKickMembers}
              options={kickCandidateOptions}
              optionFilterProp="label"
              notFoundContent="没有可移出的成员"
            />
          </div>
        </Space>
      </Modal>

      <Modal
        title={renamingXiaoce ? "修改任务名称" : "修改群名"}
        open={renameOpen}
        onCancel={() => {
          setRenameOpen(false);
          setRenameTargetId(null);
        }}
        onOk={() => void handleRenameRoom()}
        confirmLoading={renaming}
        okText="保存"
        destroyOnHidden
      >
        <Input
          value={renameTitle}
          onChange={(e) => setRenameTitle(e.target.value)}
          maxLength={120}
          placeholder={renamingXiaoce ? "输入新的任务名称" : "输入新的群名称"}
          onPressEnter={() => { if (!renaming) void handleRenameRoom(); }}
          autoFocus
        />
      </Modal>

      <Modal
        title="修改群内名称"
        open={nickOpen}
        onCancel={() => setNickOpen(false)}
        onOk={handleSaveNicknames}
        confirmLoading={nickSaving}
        okText="保存"
        width={480}
      >
        <Space direction="vertical" style={{ width: "100%" }} size={12}>
          <Typography.Text type="secondary">
            群内名称仅在本群显示。自己可改自己的；群主/管理员可改全部成员。留空则恢复为账号名。
          </Typography.Text>
          {(activeRoom?.participants || []).map((p) => {
            const editable = Boolean(
              me && (p.id === me.id || me.is_staff || activeRoom?.created_by?.id === me.id),
            );
            return (
              <div key={p.id} className="collab-nick-row">
                <div className="collab-nick-meta">
                  <strong>{p.username}</strong>
                  {activeRoom?.created_by?.id === p.id ? <Tag>群主</Tag> : null}
                </div>
                <Input
                  value={nickDrafts[p.username] ?? ""}
                  disabled={!editable || nickSaving}
                  maxLength={64}
                  placeholder={editable ? "输入群内名称" : "仅群主可改"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setNickDrafts((prev) => ({ ...prev, [p.username]: v }));
                  }}
                />
              </div>
            );
          })}
        </Space>
      </Modal>
    </div>
  );
}


const css = `
.collab-page {
  position: relative;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) minmax(320px, 360px);
  height: calc(100vh - 68px);
  min-height: 520px;
  border: 1px solid #e8edf5;
  border-radius: 0;
  overflow: hidden;
  background: #fff;
  box-shadow: none;
}
.collab-page--summary-hidden {
  grid-template-columns: 220px minmax(0, 1fr);
}
/* style 标签不要占 grid 单元格，否则会挤掉右侧监控栏 */
.collab-page > style {
  display: none;
}
.collab-page > .collab-sider {
  grid-column: 1;
  grid-row: 1;
}
.collab-page > .collab-main {
  grid-column: 2;
  grid-row: 1;
}
.collab-page > .collab-ai {
  grid-column: 3;
  grid-row: 1;
}
.collab-page > .collab-artifacts {
  grid-column: 3;
  grid-row: 1;
}
.collab-sider, .collab-ai {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fbfcfe;
  overflow: hidden;
}
.collab-main {
  position: relative;
  min-width: 0;
}
.collab-conversation-loading,
.collab-conversation-placeholder {
  display: flex;
  height: 100%;
  min-height: 320px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 9px;
  color: #8691a5;
  background: radial-gradient(circle at 50% 42%, rgba(240, 244, 255, 0.8), transparent 38%), #fff;
}
.collab-conversation-loading > span {
  width: 22px;
  height: 22px;
  border: 2px solid #e3e7f0;
  border-top-color: #6f55e8;
  border-radius: 50%;
  animation: collab-loading-spin 720ms linear infinite;
}
.collab-conversation-placeholder > .anticon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border: 1px solid #e8e3fb;
  border-radius: 17px;
  color: #6b53dc;
  font-size: 21px;
  background: linear-gradient(145deg, #faf8ff, #f1edff);
  box-shadow: 0 10px 28px rgba(91, 63, 209, 0.09);
}
.collab-conversation-placeholder strong { color: #384258; font-size: 15px; }
.collab-conversation-placeholder span { font-size: 12px; }
@keyframes collab-loading-spin { to { transform: rotate(360deg); } }
.collab-summary-reopen {
  position: absolute;
  z-index: 8;
  top: 14px;
  right: 14px;
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid #e2e6ee;
  border-radius: 12px;
  color: #6450cb;
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 8px 22px rgba(34, 47, 73, 0.09);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  cursor: pointer;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}
.collab-summary-reopen:hover { transform: translateY(-1px); border-color: #cec4f5; box-shadow: 0 11px 28px rgba(73, 53, 155, 0.14); }
.collab-main-actions {
  flex: 0 1 auto;
  min-width: 0;
}
.collab-panel-toggle {
  width: 34px;
  height: 34px;
  border: 1px solid transparent !important;
  border-radius: 10px !important;
  color: #657189 !important;
  background: transparent !important;
  transition: transform 100ms ease-out, color 160ms ease, border-color 160ms ease, background 160ms ease !important;
}
.collab-panel-toggle:hover,
.collab-panel-toggle.is-active {
  border-color: #dce4f0 !important;
  color: #315efb !important;
  background: #f1f5ff !important;
}
.collab-panel-toggle:active { transform: scale(0.96); }
.collab-summary-toggle.is-active {
  color: #6652cf !important;
  background: #f5f2ff !important;
}
.collab-intelligence-head-actions { display: inline-flex; align-items: center; gap: 2px; }
.collab-sider { border-right: 1px solid #e8edf5; }
.collab-ai {
  border-left: 1px solid #e8edf5;
  min-width: 0;
  overflow: hidden;
}
.collab-sider-head, .collab-ai-head, .collab-main-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 12px;
  border-bottom: 1px solid #e8edf5;
  background: #fff;
}
.collab-sider-head > .ant-typography {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-main-head > div:first-child {
  min-width: 0;
}
.collab-room-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 3px;
}
.collab-room-heading > .ant-typography {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xiaoce-hermes-badge {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  min-height: 19px;
  align-items: center;
  gap: 5px;
  margin-left: 5px;
  padding: 1px 7px 1px 6px;
  overflow: hidden;
  border: 1px solid rgba(139, 86, 7, 0.56);
  border-radius: 999px;
  color: #553300;
  background: linear-gradient(
    135deg,
    #fff9d9 0%,
    #f4ce68 27%,
    #fff1a5 49%,
    #d99b27 74%,
    #fff2a9 100%
  );
  font-size: 10px;
  font-weight: 800;
  line-height: 15px;
  letter-spacing: 0.035em;
  text-shadow: 0 1px 0 rgba(255, 255, 255, 0.52);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.88),
    inset 0 -1px 0 rgba(124, 73, 0, 0.18),
    0 2px 7px rgba(190, 125, 18, 0.2);
  isolation: isolate;
}
.xiaoce-hermes-badge::before {
  position: relative;
  z-index: 1;
  color: #8d5706;
  content: "✦";
  font-size: 8px;
  line-height: 1;
}
.xiaoce-hermes-badge::after {
  position: absolute;
  top: -7px;
  left: 36%;
  width: 9px;
  height: 34px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.72), transparent);
  content: "";
  pointer-events: none;
  transform: rotate(24deg);
}
.collab-group-title-trigger {
  display: inline-flex;
  min-width: 0;
  max-width: min(520px, 46vw);
  align-items: center;
  gap: 7px;
  padding: 4px 7px 4px 3px;
  border: 0;
  border-radius: 9px;
  color: #172033;
  text-align: left;
  background: transparent;
  cursor: pointer;
  transition: color 160ms ease, background 160ms ease, transform 100ms ease-out;
}
.collab-group-title-trigger:hover,
.collab-group-title-trigger[aria-expanded="true"] {
  color: #315efb;
  background: rgba(49, 94, 251, 0.07);
}
.collab-group-title-trigger:active {
  transform: scale(0.985);
}
.collab-group-title-trigger strong {
  overflow: hidden;
  font-size: 18px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-group-title-trigger span {
  flex: 0 0 auto;
  color: #7e8aa3;
  font-size: 11px;
  font-weight: 500;
}
.collab-group-title-trigger > .anticon {
  flex: 0 0 auto;
  color: #8b96a8;
  font-size: 9px;
  transition: transform 160ms ease;
}
.collab-group-title-trigger[aria-expanded="true"] > .anticon {
  transform: rotate(180deg);
}
.collab-members-popover .ant-popover-inner {
  padding: 10px;
  border: 1px solid var(--lc-border-light);
  border-radius: 16px;
  background: color-mix(in srgb, var(--lc-surface) 94%, transparent);
  box-shadow: 0 18px 48px rgba(22, 34, 58, 0.16);
  backdrop-filter: blur(20px) saturate(145%);
}
.collab-create-group-btn {
  height: 30px;
  padding-inline: 10px;
  border-color: rgba(20, 55, 98, 0.9) !important;
  border-radius: 10px;
  color: #fff !important;
  background: linear-gradient(135deg, #173b6d 0%, #24558e 100%) !important;
  box-shadow: 0 7px 18px rgba(18, 55, 101, 0.22);
  font-size: 12px;
  font-weight: 650;
  transition: transform 100ms ease-out, box-shadow 180ms ease !important;
}
.collab-create-group-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(18, 55, 101, 0.28) !important;
}
.collab-create-group-btn:active { transform: scale(0.97); }
.collab-ai-sub { font-size: 11px; color: #8b96a8; margin-top: 2px; }
.collab-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid #e8edf5;
  background: #fff;
}
.collab-tabs button {
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #66738a;
  cursor: pointer;
  font-weight: 600;
}
.collab-tabs button.active {
  background: #edf3ff;
  color: #315efb;
}
.collab-contact-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  padding: 10px 10px 0;
}
.collab-room-list, .collab-insight-list, .collab-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
}
.collab-messages {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  position: relative;
  background: #fff;
}
.collab-messages .collab-empty.soft,
.collab-messages .collab-virtuoso {
  position: relative;
  z-index: 1;
}
.collab-messages .collab-empty.soft {
  padding: 24px 16px;
}
.collab-virtuoso {
  flex: 1 1 0;
  height: 100% !important;
  min-height: 0;
  overflow: auto;
  background: #fff;
  overscroll-behavior-y: none;
  scrollbar-gutter: stable;
}
.collab-scroll-bottom {
  position: absolute;
  z-index: 8;
  right: 18px;
  bottom: 16px;
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 1px solid rgba(49, 94, 251, 0.18);
  border-radius: 50%;
  color: #315efb;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 10px 28px rgba(38, 59, 105, 0.16);
  backdrop-filter: blur(14px);
  cursor: pointer;
  transition: transform 100ms ease-out, box-shadow 160ms ease, background 160ms ease;
}
.collab-scroll-bottom:hover {
  background: #fff;
  box-shadow: 0 12px 32px rgba(38, 59, 105, 0.22);
  transform: translateY(-1px);
}
.collab-scroll-bottom:active { transform: scale(0.96); }
}
.collab-virt-item {
  padding: 0 18px 8px 22px;
  overflow: visible;
}
.collab-msg-bottom-space {
  height: 18px;
  pointer-events: none;
}
.collab-msg-history-tip {
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
  padding: 10px 8px 6px;
  user-select: none;
}
.collab-contact-pane .collab-room-list { padding: 0 0 10px; }
.collab-contact-section { margin-bottom: 6px; }
.collab-contact-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  padding: 8px 10px 4px;
  user-select: none;
}
.collab-contact-section-title em {
  min-width: 22px;
  padding: 1px 7px;
  border-radius: 999px;
  color: #6f55e8;
  background: rgba(111, 85, 232, 0.09);
  font-size: 10px;
  font-style: normal;
  text-align: center;
}
.collab-team-section { margin-bottom: 12px; }
.collab-team-card {
  margin: 0 0 7px;
  overflow: hidden;
  border: 1px solid rgba(111, 85, 232, 0.13);
  border-radius: 14px;
  background:
    radial-gradient(160px 72px at 0 0, rgba(111, 85, 232, 0.09), transparent 74%),
    rgba(255, 255, 255, 0.86);
  box-shadow: 0 7px 20px rgba(35, 45, 72, 0.055);
  transition: transform 120ms cubic-bezier(.2,.8,.2,1), border-color 180ms ease, box-shadow 180ms ease;
}
.collab-team-card:hover {
  transform: translateY(-1px);
  border-color: rgba(111, 85, 232, 0.28);
  box-shadow: 0 11px 28px rgba(35, 45, 72, 0.09);
}
.collab-team-card.is-expanded { border-color: rgba(111, 85, 232, 0.34); }
.collab-team-card-main {
  display: grid;
  width: 100%;
  grid-template-columns: 36px minmax(0, 1fr) auto auto 14px;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 0;
  color: #26334b;
  text-align: left;
  background: transparent;
  cursor: pointer;
}
.collab-team-card-main:active { transform: scale(0.99); }
.collab-team-card-icon {
  display: inline-flex;
  width: 36px;
  height: 36px;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  color: #5f49cc;
  background: linear-gradient(145deg, #f0ecff, #e5eaff);
  font-size: 17px;
}
.collab-team-card-copy { min-width: 0; }
.collab-team-card-copy strong,
.collab-team-card-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.collab-team-card-copy strong { color: #28334a; font-size: 12px; }
.collab-team-card-copy small { margin-top: 2px; color: #8a94a6; font-size: 10px; }
.collab-team-card-count { color: #7b8497; font-size: 10px; white-space: nowrap; }
.collab-team-card-chevron {
  color: #8b95a7;
  font-size: 10px;
  transition: transform 180ms cubic-bezier(.2,.8,.2,1);
}
.collab-team-card.is-expanded .collab-team-card-chevron { transform: rotate(180deg); }
.collab-team-card-detail {
  display: grid;
  gap: 8px;
  padding: 0 9px 9px;
  border-top: 1px solid rgba(111, 85, 232, 0.09);
}
.collab-team-member-list {
  display: grid;
  max-height: 176px;
  gap: 2px;
  padding-top: 7px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.collab-team-member {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 0;
  border-radius: 10px;
  color: #344057;
  text-align: left;
  background: transparent;
  cursor: pointer;
}
.collab-team-member:hover { background: rgba(111, 85, 232, 0.07); }
.collab-team-member > span:last-child { display: flex; min-width: 0; flex-direction: column; }
.collab-team-member strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.collab-team-member small { color: #929bad; font-size: 9px; }
.collab-team-card-detail .ant-btn-primary {
  border-radius: 10px;
  background: linear-gradient(135deg, #6f55e8, #5944c8);
  box-shadow: 0 6px 16px rgba(88, 66, 196, 0.17);
}
.collab-team-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin: 0 2px 7px;
  padding: 13px 10px;
  border: 1px dashed rgba(111, 85, 232, 0.18);
  border-radius: 12px;
  color: #8993a6;
  background: rgba(248, 247, 253, 0.66);
  font-size: 11px;
  text-align: center;
}
.collab-bot-avatar {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: linear-gradient(145deg, #e8f1ff 0%, #dbeafe 100%);
  color: #2563eb;
  font-size: 18px;
  border: 1px solid #bfdbfe;
}
.collab-contact-item.is-bot {
  background: rgba(37, 99, 235, 0.04);
  border-color: rgba(37, 99, 235, 0.12);
}
.collab-contact-item.is-bot:hover {
  background: rgba(37, 99, 235, 0.08);
}
.collab-room-item, .collab-contact-item {
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 12px;
  padding: 10px;
  cursor: pointer;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 10px;
  transition:
    transform 120ms cubic-bezier(.2, .8, .2, 1),
    border-color 180ms ease,
    background 180ms ease,
    box-shadow 180ms ease;
}
.collab-room-item {
  padding: 4px 4px 4px 10px;
  cursor: default;
  position: relative;
}
.collab-room-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  background: transparent;
  padding: 6px 4px;
  cursor: pointer;
  text-align: left;
}
.collab-room-del {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  opacity: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.collab-room-item:hover .collab-room-del,
.collab-room-item.active .collab-room-del {
  opacity: 1;
}
.collab-room-del:hover {
  background: #fff1f0;
  color: #cf1322;
}
.collab-nick-row {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.collab-nick-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.collab-nick-meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.collab-room-item:hover, .collab-room-item.active,
.collab-contact-item:hover {
  background: #edf3ff;
  border-color: #d9e4ff;
}
.collab-room-item.active {
  box-shadow: 0 5px 16px rgba(49, 94, 251, 0.08);
}
.collab-room-item:active,
.collab-contact-item:active {
  transform: scale(0.988);
}
.collab-room-main:focus-visible,
.collab-contact-item:focus-visible,
.collab-room-del:focus-visible {
  outline: 2px solid rgba(49, 94, 251, 0.62);
  outline-offset: 2px;
}
.collab-room-body { flex: 1; min-width: 0; }
.collab-room-top {
  display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 2px;
}
.collab-room-item strong, .collab-contact-item strong {
  font-size: 13px; color: #172033;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.collab-room-item em {
  font-style: normal; font-size: 11px; color: #93a0b4; flex-shrink: 0;
}
.collab-room-preview {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.collab-room-preview span {
  font-size: 12px; color: #8b96a8;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.collab-room-badges {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  overflow: visible !important;
}
.collab-room-badges .ant-badge-count {
  color: #fff !important;
  background: #ef4444;
  box-shadow: 0 0 0 2px #fff;
  font-size: 10px;
  font-weight: 700;
}
.collab-contact-item div { display: flex; flex-direction: column; min-width: 0; }
.collab-contact-item span { font-size: 12px; color: #93a0b4; }
.collab-contact-open-hint {
  margin-left: auto;
  padding: 4px 7px;
  border-radius: 999px;
  color: #6f55e8 !important;
  background: rgba(111, 85, 232, 0.08);
  white-space: nowrap;
}
.collab-avatar-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
}
.collab-msg-avatar {
  display: block;
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  min-width: 32px;
  max-width: 32px;
  min-height: 32px;
  max-height: 32px;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 50%;
  overflow: hidden;
  flex: 0 0 32px !important;
  align-self: flex-start !important;
  background: transparent;
  cursor: pointer;
  line-height: 0;
  flex-shrink: 0 !important;
  transition:
    transform 160ms cubic-bezier(.2, .8, .2, 1),
    box-shadow 180ms ease;
}
.collab-msg-avatar:hover,
.collab-avatar-hit:hover {
  transform: translateY(-1px) scale(1.035);
  box-shadow: 0 7px 16px rgba(25, 43, 74, 0.14);
}
.collab-msg-avatar:active,
.collab-avatar-hit:active {
  transform: scale(0.96);
}
.collab-msg-avatar-face {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
.collab-msg-avatar-face img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}
.collab-avatar-hit {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex: 0 0 auto;
  flex-shrink: 0;
  border-radius: 50%;
  line-height: 0;
  align-self: flex-start;
  transition:
    transform 160ms cubic-bezier(.2, .8, .2, 1),
    box-shadow 180ms ease;
}
.collab-avatar-hit .ant-avatar {
  flex: none !important;
}
.collab-avatar-hit .ant-avatar img {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover !important;
}
.collab-avatar-hit:focus-visible,
.collab-msg-avatar:focus-visible {
  outline: 2px solid #315efb;
  outline-offset: 2px;
}
.collab-profile-popover .ant-popover-inner {
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(222, 226, 236, 0.86);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 24px 64px rgba(23, 32, 51, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  -webkit-backdrop-filter: blur(24px) saturate(150%);
  backdrop-filter: blur(24px) saturate(150%);
}
.collab-profile-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-width: 196px;
  max-width: 260px;
  padding: 14px;
}
.collab-profile-card--detail {
  display: block;
  width: 286px;
  max-width: min(286px, calc(100vw - 36px));
  padding: 18px;
}
.collab-profile-card-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid #edf0f5;
}
.collab-profile-card-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.collab-profile-card-main strong {
  font-size: 15px;
  color: #172033;
  line-height: 1.3;
  word-break: break-word;
}
.collab-profile-uname,
.collab-profile-nick,
.collab-profile-role {
  font-size: 12px;
  color: #8b96a8;
  line-height: 1.35;
}
.collab-profile-bio {
  margin: 6px 0 2px;
  font-size: 12px;
  color: #4a5568;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}
.collab-profile-online {
  margin-top: 4px;
  font-size: 12px;
  font-weight: 500;
}
.collab-profile-online.on { color: #2f9e6c; }
.collab-profile-online.off { color: #93a0b4; }
.collab-profile-sent-at {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid #edf0f5;
  color: #7d899c;
  font-size: 11px;
  line-height: 1.4;
}
.collab-profile-detail-list {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 9px 10px;
  margin: 14px 0;
  font-size: 12px;
  line-height: 1.45;
}
.collab-profile-detail-list dt {
  color: #929bad;
}
.collab-profile-detail-list dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: #364158;
}
.collab-profile-message-btn {
  height: 38px;
  border-radius: 10px;
  border-color: #6f55e8 !important;
  background: linear-gradient(135deg, #6f55e8, #7f63ee) !important;
  box-shadow: 0 8px 18px rgba(111, 85, 232, 0.2) !important;
}
.collab-online-dot {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #c5ccd8;
  border: 2px solid #fff;
  box-sizing: border-box;
  opacity: 0;
  pointer-events: none;
}
.collab-avatar-wrap.online .collab-online-dot {
  background: #22c55e;
  opacity: 1;
}
.collab-status-on { color: #16a34a !important; }
.collab-status-off { color: #93a0b4 !important; }
.collab-room-item.risk-red { box-shadow: inset 3px 0 0 #ff4d4f; }
.collab-room-item.risk-yellow { box-shadow: inset 3px 0 0 #faad14; }

.collab-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #fff;
  overflow: hidden;
  position: relative;
  z-index: 1;
}
.collab-agent-input {
  flex-shrink: 0;
  position: relative;
  z-index: 40;
  overflow: visible;
}
.collab-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #7e8aa3;
  gap: 8px;
  padding: 24px;
  text-align: center;
}
.collab-empty .anticon { font-size: 36px; color: #315efb; }
.collab-empty.soft { opacity: .85; font-size: 13px; }
.collab-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 13px;
  border-bottom: 1px solid #e8edf5;
}
.collab-banner.risk-yellow { background: #fffbe6; color: #ad6800; }
.collab-banner.risk-red { background: #fff2f0; color: #a8071a; }
.collab-msg {
  display: flex !important;
  align-items: flex-start !important;
  gap: 10px;
  margin-bottom: 8px;
  width: fit-content;
  max-width: 88%;
  overflow: visible;
}
.collab-msg.peer {
  margin-left: 18px;
}
.collab-msg.mine {
  margin-right: 18px;
  margin-left: auto;
  flex-direction: row-reverse;
}
.collab-msg-aside {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 72px;
  align-self: flex-start;
}
.collab-msg.mine .collab-msg-aside {
  align-items: flex-end;
  max-width: 92px;
}
.collab-msg-name {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  max-width: 72px;
  font-size: 11px;
  font-weight: 600;
  color: #5c6b84;
  line-height: 1.2;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-msg.mine .collab-msg-name {
  color: #31405b;
  justify-content: flex-end;
  max-width: 92px;
  text-align: right;
}
.collab-msg-name .collab-suggest-tag,
.collab-msg-name .collab-interject-tag {
  margin: 0;
  flex-shrink: 0;
}
.collab-msg-name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-msg.ai .collab-msg-aside,
.collab-msg.ai .collab-msg-name {
  max-width: 148px;
}
.collab-msg-name .xiaoce-hermes-badge {
  min-height: 16px;
  margin-left: 1px;
  padding: 0 5px;
  font-size: 8px;
  line-height: 13px;
}
.collab-bubble {
  background: rgba(255, 255, 255, 0.94);
  border-radius: 14px;
  padding: 10px 12px;
  border: 1px solid #e8edf5;
  overflow-wrap: anywhere;
  word-break: break-word;
  width: fit-content;
  max-width: 100%;
  box-shadow: 0 1px 3px rgba(11, 33, 68, 0.05);
  transition:
    transform 180ms cubic-bezier(.2, .8, .2, 1),
    border-color 180ms ease,
    box-shadow 180ms ease;
}
.collab-bubble-wrap {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  width: fit-content;
}
.collab-quote-block {
  display: flex;
  width: 100%;
  min-width: 180px;
  max-width: 420px;
  flex-direction: column;
  gap: 2px;
  margin: 0 0 8px;
  padding: 7px 9px 7px 10px;
  border: 0;
  border-left: 3px solid rgba(49, 94, 251, 0.42);
  border-radius: 4px 9px 9px 4px;
  color: #50607a;
  background: rgba(72, 95, 132, 0.08);
  text-align: left;
  cursor: pointer;
  transition:
    transform 100ms ease-out,
    background 160ms ease;
}
.collab-quote-block:hover {
  background: rgba(49, 94, 251, 0.1);
}
.collab-quote-block:active {
  transform: scale(0.985);
}
.collab-quote-block strong {
  overflow: hidden;
  color: #315efb;
  font-size: 11px;
  font-weight: 680;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-quote-block span {
  display: -webkit-box;
  overflow: hidden;
  color: #66738a;
  font-size: 12px;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.collab-context-block {
  display: flex;
  width: min(420px, 100%);
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--lc-accent-blue, #315efb) 22%, transparent);
  border-radius: 9px;
  color: var(--lc-accent-blue, #315efb);
  background: color-mix(in srgb, var(--lc-accent-blue, #315efb) 7%, transparent);
}
.collab-context-block > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}
.collab-context-block strong {
  font-size: 11px;
  line-height: 1.35;
}
.collab-context-block em {
  overflow: hidden;
  color: var(--lc-text-muted, #66738a);
  font-size: 12px;
  font-style: normal;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-read-state {
  display: block;
  margin: 4px 3px 0 auto;
  padding: 0;
  border: 0;
  color: #8b96a8;
  font-size: 10.5px;
  line-height: 1.3;
  background: transparent;
  cursor: pointer;
}
.collab-read-state.is-all-read {
  color: #315efb;
}
.collab-read-state:hover {
  text-decoration: underline;
}
.collab-read-popover {
  display: flex;
  max-width: 260px;
  flex-direction: column;
  gap: 5px;
}
.collab-read-popover strong {
  color: #172033;
  font-size: 13px;
}
.collab-read-popover span {
  color: #66738a;
  font-size: 12px;
  line-height: 1.45;
}
.collab-msg-flag {
  position: absolute;
  top: -28px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid currentColor;
  border-radius: 999px;
  pointer-events: auto;
  cursor: default;
  max-width: min(240px, 70vw);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 5px 14px rgba(24, 35, 58, 0.09);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
.collab-msg.mine .collab-msg-flag {
  right: 10px;
}
.collab-msg.peer .collab-msg-flag {
  left: 10px;
}
.collab-msg-flag.risk-red { color: #cf1322; background: rgba(255, 241, 240, 0.95); }
.collab-msg-flag.risk-yellow { color: #ad6800; background: rgba(255, 251, 230, 0.96); }
.collab-msg-flag-label {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.02em;
  line-height: 1.25;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-msg.flagged {
  margin-top: 26px;
}
.collab-bubble.risk-edge-red {
  border-color: rgba(207, 19, 34, 0.45) !important;
  box-shadow: inset 3px 0 0 #cf1322 !important;
}
.collab-msg.mine .collab-bubble.risk-edge-red {
  box-shadow: inset -3px 0 0 #cf1322 !important;
}
.collab-bubble.risk-edge-yellow {
  border-color: rgba(212, 136, 6, 0.5) !important;
  box-shadow: inset 3px 0 0 #d48806 !important;
}
.collab-msg.mine .collab-bubble.risk-edge-yellow {
  box-shadow: inset -3px 0 0 #d48806 !important;
}
.collab-msg.flagged .collab-bubble {
  border-color: rgba(207, 19, 34, 0.35);
}
.collab-msg.flagged.peer .collab-bubble {
  box-shadow: inset 3px 0 0 rgba(207, 19, 34, 0.55);
}
.collab-msg.mine.flagged .collab-bubble {
  box-shadow: inset -3px 0 0 rgba(207, 19, 34, 0.45);
}
.collab-msg.flagged .collab-msg-flag.risk-yellow ~ .collab-bubble,
.collab-msg.peer.flagged:has(.collab-msg-flag.risk-yellow) .collab-bubble {
  border-color: rgba(212, 136, 6, 0.4);
  box-shadow: inset 3px 0 0 rgba(212, 136, 6, 0.55);
}
.collab-msg.mine.flagged:has(.collab-msg-flag.risk-yellow) .collab-bubble {
  border-color: rgba(212, 136, 6, 0.4);
  box-shadow: inset -3px 0 0 rgba(212, 136, 6, 0.5);
}
.collab-msg.mine .collab-bubble {
  background: #edf3ff;
  border-color: #d6e4ff;
}
.collab-msg.highlight .collab-bubble {
  outline: 2px solid #faad14;
}
.collab-time-sep {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 10px 0 8px;
  padding: 0 12px;
  font-size: 12px;
  color: #93a0b4;
  line-height: 1.2;
  user-select: none;
}
.collab-bubble-meta {
  display: none;
}
.collab-bubble-meta:empty { display: none; margin: 0; }
.collab-bubble p { margin: 0; white-space: pre-wrap; line-height: 1.55; color: #172033; font-size: 14px; }
.collab-md {
  color: #172033;
  font-size: 14px;
  line-height: 1.55;
  max-width: min(560px, 100%);
}
.collab-md:has(.agent-md-mermaid),
.collab-md.blocks:has(.agent-md-mermaid) {
  max-width: min(760px, 92vw);
}
.collab-md.blocks {
  width: 100%;
}
.collab-msg.ai .collab-bubble:has(.collab-md.blocks),
.collab-msg.peer .collab-bubble:has(.collab-md.blocks) {
  background: #fff;
  border: 1px solid #e8edf5;
  padding: 12px 14px;
  border-radius: 14px;
  box-shadow: 0 2px 10px rgba(11, 33, 68, 0.04);
}
.collab-msg.ai .collab-bubble:has(.collab-md.blocks.chat-md),
.collab-msg.peer .collab-bubble:has(.collab-md.blocks.chat-md) {
  max-width: min(520px, 100%);
}
.collab-msg.mine .collab-bubble:has(.collab-md.blocks) {
  background: transparent;
  border: none;
  padding: 0;
}
.collab-md.blocks.chat-md .agent-report-card {
  border: none;
  box-shadow: none;
  background: transparent;
  overflow: visible;
}
.collab-md.blocks.chat-md .agent-md-section {
  padding: 0;
  border: none;
  background: transparent;
}
.collab-md.blocks.chat-md .agent-md-section .agent-md-root {
  padding: 0;
}
.collab-md.blocks.chat-md .agent-md-section.is-lead .agent-md-h1:first-child,
.collab-md.blocks.chat-md .agent-md-section.is-lead .agent-md-h2:first-child {
  margin: 0 0 10px;
  padding: 0;
  background: none;
  border-bottom: none;
  font-size: 15px;
  font-weight: 700;
}
.collab-md.blocks.chat-md .agent-md-h3,
.collab-md.blocks.chat-md .agent-md-h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 8px;
  padding: 0 0 6px;
  border-bottom: 1px solid rgba(49, 94, 251, 0.12);
  font-size: 13px;
  font-weight: 700;
  color: #1e3a5f;
}
.collab-md.blocks.chat-md .agent-md-h3::before,
.collab-md.blocks.chat-md .agent-md-h4::before {
  content: "";
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: #3370ff;
  flex-shrink: 0;
}
.collab-md.blocks.chat-md .agent-md-code {
  padding: 0 5px;
  border: none;
  background: rgba(51, 112, 255, 0.09);
  color: #1d4ed8;
  font-size: 0.92em;
  font-weight: 600;
  border-radius: 4px;
  font-family: inherit;
}
.collab-md.blocks.chat-md .agent-md-li {
  margin: 5px 0;
  line-height: 1.55;
}
.collab-md.blocks.chat-md .agent-md-list {
  margin: 6px 0 12px;
  padding-left: 1.2em;
}
.collab-md.blocks.chat-md .agent-md-p {
  margin: 0 0 8px;
}
.collab-md.blocks.chat-md .agent-md-strong {
  color: #334155;
  font-weight: 600;
}
.collab-md.blocks.chat-md .agent-md-table-wrap {
  margin: 8px 0 12px;
  border-radius: 10px;
  border: 1px solid #e8edf5;
  overflow: auto;
}
.collab-md.blocks.chat-md .agent-md-table th {
  background: #f6f8fc;
  font-size: 12px;
}
.collab-md.blocks.chat-md .agent-md-table td {
  font-size: 13px;
}
.collab-md .agent-md-blocks {
  max-width: min(560px, 78vw);
}
.collab-md:has(.agent-md-mermaid) .agent-md-blocks {
  max-width: min(760px, 92vw);
}
.collab-md .agent-md-root {
  font-size: 14px;
}
.collab-md .agent-md-p {
  margin: 0 0 8px;
  color: #172033;
}
.collab-md .agent-md-p:last-child { margin-bottom: 0; }
.collab-md .agent-md-strong { color: #0f172a; }
.collab-md .agent-md-list {
  margin: 6px 0 10px;
  padding-left: 1.25em;
}
.collab-md .agent-md-li { margin: 2px 0; color: #172033; }
.collab-md .agent-md-h1,
.collab-md .agent-md-h2,
.collab-md .agent-md-h3,
.collab-md .agent-md-h4 {
  color: #0f172a;
}
.collab-agent-input {
  flex-shrink: 0;
  position: relative;
  z-index: 40;
  overflow: visible;
}
.collab-agent-input-inner {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}
.collab-reply-composer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0 12px -5px;
  padding: 8px 10px 12px;
  border: 1px solid #dce5f1;
  border-bottom: 0;
  border-radius: 13px 13px 0 0;
  background: rgba(247, 249, 253, 0.94);
  box-shadow: 0 -4px 18px rgba(22, 39, 67, 0.035);
}
.collab-reply-composer > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  padding-left: 9px;
  border-left: 3px solid rgba(49, 94, 251, 0.45);
}
.collab-reply-composer strong {
  color: #315efb;
  font-size: 11px;
}
.collab-reply-composer span {
  overflow: hidden;
  color: #66738a;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-reply-composer button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: #7e8aa3;
  background: transparent;
  cursor: pointer;
  transition:
    transform 100ms ease-out,
    background 160ms ease;
}
.collab-reply-composer button:hover {
  background: rgba(23, 32, 51, 0.07);
}
.collab-reply-composer button:active {
  transform: scale(0.9);
}
.collab-context-composer {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 12px -5px;
  padding: 9px 10px 12px;
  border: 1px solid color-mix(in srgb, var(--lc-accent-blue, #315efb) 28%, var(--lc-border-light, #dce5f1));
  border-bottom: 0;
  border-radius: 13px 13px 0 0;
  color: var(--lc-accent-blue, #315efb);
  background: color-mix(in srgb, var(--lc-bg-elevated, #fff) 94%, var(--lc-accent-blue, #315efb));
  box-shadow: 0 -4px 18px rgba(22, 39, 67, 0.035);
}
.collab-context-composer:has(+ .collab-reply-composer) {
  margin-bottom: 7px;
  border-bottom: 1px solid color-mix(in srgb, var(--lc-accent-blue, #315efb) 28%, var(--lc-border-light, #dce5f1));
  border-radius: 13px;
}
.collab-context-composer > div {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.collab-context-composer strong {
  color: var(--lc-accent-blue, #315efb);
  font-size: 11px;
}
.collab-context-composer span {
  overflow: hidden;
  color: var(--lc-text-muted, #66738a);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-context-composer button {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  color: var(--lc-text-muted, #7e8aa3);
  background: transparent;
  cursor: pointer;
}
.collab-context-composer button:hover {
  background: color-mix(in srgb, var(--lc-text, #172033) 7%, transparent);
}
.xiaoce-stream-footer {
  padding: 4px 18px 0;
}
.xiaoce-stream-message {
  display: flex;
  width: min(760px, 88%);
  align-items: flex-start;
  gap: 10px;
  margin-left: 18px;
}
.xiaoce-stream-avatar {
  flex: 0 0 auto;
  padding-top: 19px;
}
.xiaoce-stream-avatar .ant-avatar {
  color: #0f766e;
  border: 1px solid rgba(50, 178, 151, 0.24);
  background: linear-gradient(145deg, #effffb, #d9f7ef);
  box-shadow: 0 5px 14px rgba(15, 118, 110, 0.12);
}
.xiaoce-stream-main {
  min-width: 0;
  flex: 1;
}
.xiaoce-stream-sender {
  display: flex;
  min-height: 18px;
  align-items: center;
  gap: 2px;
  margin-bottom: 4px;
  color: var(--lc-text-muted, #5c6b84);
  font-size: 11px;
  font-weight: 650;
}
.xiaoce-stream-bubble {
  width: fit-content;
  min-width: min(360px, 72vw);
  max-width: 100%;
  padding: 11px 13px;
  border: 1px solid rgba(50, 178, 151, 0.27);
  border-radius: 14px;
  color: var(--lc-text, #25344e);
  background:
    radial-gradient(220px 90px at 0 0, rgba(45, 185, 156, 0.12), transparent 78%),
    rgba(245, 254, 251, 0.97);
  box-shadow: 0 4px 16px rgba(19, 97, 83, 0.07);
}
.xiaoce-stream-content {
  position: relative;
  min-height: 22px;
}
.xiaoce-stream-content .agent-md-root > :first-child {
  margin-top: 0;
}
.xiaoce-stream-content .agent-md-root > :last-child {
  margin-bottom: 0;
}
.xiaoce-stream-caret {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  border-radius: 1px;
  vertical-align: -0.12em;
  background: #169f85;
  animation: xiaoce-stream-caret 900ms steps(1, end) infinite;
}
.xiaoce-stream-thinking {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  gap: 8px;
  color: #28695d;
  font-size: 13px;
  font-weight: 560;
}
.xiaoce-stream-thinking .anticon {
  color: #19a689;
}
@keyframes xiaoce-stream-caret {
  0%, 48% { opacity: 1; }
  49%, 100% { opacity: 0.18; }
}
.xiaoce-process {
  width: min(420px, 100%);
  margin-top: 8px;
  color: var(--lc-text, #31405b);
  font-size: 12px;
}
.xiaoce-process.is-live {
  width: 100%;
  max-width: 420px;
  margin-top: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--lc-accent-blue, #315efb) 22%, #dbe7ff);
  border-radius: 12px;
  background: color-mix(in srgb, var(--lc-bg, #f7faff) 88%, #fff);
  box-shadow: 0 4px 14px rgba(49, 94, 251, 0.06);
}
.xiaoce-process.is-failed,
.xiaoce-process.is-cancelled {
  padding: 10px 12px;
  border: 1px solid #f0d5d5;
  border-radius: 12px;
  background: #fffafa;
}
.xiaoce-process.is-cancelled {
  border-color: #f3e4c8;
  background: #fffdf8;
}
.xiaoce-process-status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 2px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
}
.xiaoce-process-status.is-failed { color: #a8071a; }
.xiaoce-process-status.is-cancelled { color: #ad6800; }
.xiaoce-process-live-title,
.xiaoce-process-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--lc-accent-blue, #315efb);
  font-size: 12px;
  font-weight: 600;
}
.xiaoce-process-toggle {
  min-height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.xiaoce-process-toggle:hover {
  color: var(--lc-navy, #1d4ed8);
}
.xiaoce-process-steps {
  display: grid;
  gap: 6px;
  margin: 8px 0 0;
  padding: 8px 0 0;
  border-top: 1px dashed rgba(49, 94, 251, 0.16);
  list-style: none;
}
.xiaoce-process.is-failed .xiaoce-process-steps,
.xiaoce-process.is-cancelled .xiaoce-process-steps {
  border-top-color: rgba(168, 7, 26, 0.12);
}
.xiaoce-process-steps li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 20px;
  color: var(--lc-text-muted, #6b7890);
  line-height: 1.45;
}
.xiaoce-process-step-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}
.xiaoce-process-step-copy > small {
  overflow: hidden;
  max-width: 100%;
  color: var(--lc-text-muted, #7c879b);
  font-size: 10.5px;
  font-weight: 450;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xiaoce-process-steps li.is-running {
  color: var(--lc-text, #172033);
  font-weight: 600;
}
.xiaoce-process-steps li.is-failed {
  color: #a8071a;
  font-weight: 600;
}
.xiaoce-process-steps li.is-cancelled {
  color: #ad6800;
}
.xiaoce-process-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  font-size: 13px;
}
.xiaoce-process-icon.is-completed { color: #22a06b; }
.xiaoce-process-icon.is-running { color: var(--lc-accent-blue, #315efb); }
.xiaoce-process-icon.is-cancelled { color: #d48806; }
.xiaoce-process-icon.is-failed { color: #cf1322; }
.xiaoce-process-error {
  margin-top: 8px;
  padding: 7px 9px;
  border-radius: 8px;
  background: #fff2f0;
  color: #a8071a;
  font-size: 11.5px;
  line-height: 1.5;
}
.xiaoce-created-skill {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
  padding: 9px 10px;
  border: 1px solid #d7eadf;
  border-radius: 10px;
  background: #f6ffed;
}
.xiaoce-created-skill strong {
  color: #135c37;
  font-size: 12px;
}
.xiaoce-created-skill > span:not(.ant-tag) {
  color: #5d7466;
  font-size: 11px;
}
.xiaoce-created-skill .ant-tag {
  margin-inline-end: 0;
}
.agent-chat-stop-circle {
  border-color: var(--lc-navy, #172033) !important;
  background: var(--lc-navy, #172033) !important;
  box-shadow: none !important;
}
.agent-chat-stop-glyph {
  display: block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--lc-bg-elevated, #fff);
}
.collab-agent-composer {
  position: relative;
  overflow: visible;
  z-index: 30;
}
.collab-composer-resizer {
  position: absolute;
  z-index: 6;
  top: -7px;
  left: 50%;
  display: grid;
  width: 58px;
  height: 16px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: ns-resize;
  touch-action: none;
}
.collab-composer-resizer > span {
  display: block;
  width: 34px;
  height: 4px;
  border-radius: 999px;
  background: #c6cfdd;
  box-shadow: 0 1px 2px rgba(18, 32, 55, 0.08);
  transition: width 160ms ease, background 160ms ease, transform 100ms ease-out;
}
.collab-composer-resizer:hover > span,
.collab-composer-resizer:focus-visible > span {
  width: 42px;
  background: #7c8ba3;
}
.collab-composer-resizer:active > span {
  transform: scaleX(0.94);
}
.collab-agent-composer.is-resizing {
  user-select: none;
}
.collab-agent-composer.is-resizing .collab-composer-resizer > span {
  width: 46px;
  background: #65758e;
}
.collab-agent-composer textarea.agent-chat-composer-textarea {
  min-height: var(--collab-composer-min-height, 52px) !important;
  max-height: calc(100vh - 260px) !important;
  overflow-y: auto !important;
  overscroll-behavior: contain;
}
.collab-agent-composer.has-mention {
  z-index: 80;
}
.collab-agent-composer.has-coach {
  margin-top: 8px;
}
.collab-draft-examples {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: 12px;
  background: #f4f7fb;
  border: 1px solid #e4ebf4;
  animation: collabCoachReveal 180ms cubic-bezier(.2, .8, .2, 1) both;
}
@keyframes collabCoachReveal {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.collab-draft-examples.level-yellow {
  background: #fff8e8;
  border-color: #f0c060;
}
.collab-draft-examples.level-yellow .collab-draft-examples-title {
  color: #ad6800;
}
.collab-draft-examples.level-red {
  background: #fff2f0;
  border-color: #ffccc7;
}
.collab-draft-examples.level-red .collab-draft-examples-title {
  color: #cf1322;
}
.collab-draft-examples-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #5c6b84;
  margin-bottom: 6px;
}
.collab-draft-examples-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.collab-draft-example-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 7px 9px;
  border-radius: 10px;
  border: 1px solid #d7e2ef;
  background: #fff;
  cursor: pointer;
  transition:
    transform 120ms cubic-bezier(.2, .8, .2, 1),
    border-color .16s,
    box-shadow .16s,
    background .16s;
}
.collab-draft-example-chip:hover {
  border-color: #C4924A;
  box-shadow: 0 4px 12px rgba(11, 33, 68, 0.06);
  background: #fffdf8;
}
.collab-draft-example-chip:active {
  transform: scale(0.988);
}
.collab-draft-example-chip em {
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
  color: #8a6a35;
}
.collab-draft-example-chip strong {
  font-weight: 500;
  font-size: 13px;
  line-height: 1.45;
  color: #172033;
}
.collab-draft-example-chip.kind-warn em { color: #d48806; }
.collab-draft-example-chip.kind-risk em { color: #cf1322; }
.collab-draft-examples-loading {
  font-size: 12px;
  color: #8b96a8;
}
.collab-composer-hint {
  font-size: 12px;
  color: var(--lc-text-muted, #8b96a8);
  padding-left: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.collab-mention-menu {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: calc(100% + 8px);
  z-index: 100;
  max-height: min(280px, 42vh);
  overflow: auto;
  background: #fff;
  border: 1px solid #dbe3f0;
  border-radius: 12px;
  box-shadow:
    0 14px 36px rgba(23, 32, 51, 0.16),
    0 0 0 1px rgba(49, 94, 251, 0.05);
  padding: 4px;
}
.collab-mention-menu button {
  width: 100%;
  display: flex;
  gap: 10px;
  align-items: center;
  border: none;
  background: transparent;
  text-align: left;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.collab-mention-menu button:hover,
.collab-mention-menu button.active {
  background: #eef3ff;
}
.collab-mention-ico {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #edf2f7;
  color: #315efb;
  flex-shrink: 0;
}
.collab-mention-menu strong {
  display: block;
  font-size: 13px;
  color: #172033;
}
.collab-mention-menu em {
  display: block;
  font-style: normal;
  font-size: 11px;
  color: #8b96a8;
}
.collab-mention {
  color: #315efb;
  font-weight: 600;
}
.collab-mention.ai { color: #0f766e; }
.collab-mention.all { color: #c2410c; }
.collab-msg.system {
  justify-content: center;
  margin: 4px 0 10px;
}
.collab-system-tip {
  font-size: 12px;
  color: #8b96a8;
  background: #f3f5f9;
  padding: 4px 12px;
  border-radius: 999px;
}
.collab-msg.ai .collab-bubble {
  background:
    radial-gradient(180px 70px at 0 0, rgba(45, 185, 156, 0.11), transparent 78%),
    rgba(245, 254, 251, 0.96);
  border-color: rgba(50, 178, 151, 0.27);
}
.collab-msg.interject .collab-bubble {
  background:
    radial-gradient(180px 70px at 0 0, rgba(230, 160, 51, 0.13), transparent 78%),
    rgba(255, 252, 242, 0.97);
  border-color: rgba(217, 119, 6, 0.3);
  border-left: 3px solid #d97706;
}
.collab-msg.suggest .collab-bubble {
  background: #ecfdf8;
  border-color: #99f6e4;
  border-left: 3px solid #0f766e;
}
.collab-translation {
  margin-top: 9px;
  padding: 9px 10px;
  border-top: 1px solid rgba(99, 117, 147, 0.15);
  border-radius: 0 0 9px 9px;
  background: rgba(245, 248, 252, 0.76);
}
.collab-translation-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 5px;
  color: #617089;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.collab-translation-text > p,
.collab-translation-text .collab-md { margin: 0; }
.collab-translation-text {
  color: #33425a;
  font-size: 12px;
  line-height: 1.55;
}
.collab-translation-loading { color: #8a95a8; font-size: 11px; }
.collab-translation.is-loading { background: rgba(248, 250, 253, 0.72); }
.collab-interject-tag,
.collab-suggest-tag {
  font-size: 10px;
  font-style: normal;
  font-weight: 500;
  border-radius: 4px;
  padding: 0 5px;
  margin-right: 4px;
}
.collab-interject-tag {
  color: #b45309;
  background: #fef3c7;
}
.collab-suggest-tag {
  color: #0f766e;
  background: #ccfbf1;
}
.collab-monitor {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 12px 24px;
  scrollbar-gutter: stable;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.collab-intelligence-head {
  position: sticky;
  z-index: 4;
  top: 0;
  flex-shrink: 0;
}
.collab-ai.collab-intelligence {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.collab-intelligence-tabs {
  position: sticky;
  z-index: 4;
  top: 62px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 6px 10px 8px;
  background: rgba(251, 252, 254, 0.88);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  backdrop-filter: blur(16px) saturate(150%);
  flex-shrink: 0;
}
.collab-intelligence-tabs button {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 9px;
  color: #7a879b;
  font-size: 12px;
  font-weight: 650;
  background: transparent;
  cursor: pointer;
  transition:
    transform 100ms ease-out,
    color 160ms ease,
    background 160ms ease,
    box-shadow 160ms ease;
}
.collab-intelligence-tabs button.active {
  color: #17365f;
  background: rgba(255, 255, 255, 0.94);
  box-shadow:
    0 3px 12px rgba(20, 38, 66, 0.08),
    inset 0 0 0 1px rgba(215, 224, 236, 0.8);
}
.collab-intelligence-tabs button:active {
  transform: scale(0.97);
}
.collab-summary-panel {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 10px 12px 18px;
}
.collab-summary-model {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 10px 11px;
  border: 1px solid rgba(70, 114, 188, 0.2);
  border-radius: 13px;
  background:
    radial-gradient(160px 80px at 0 0, rgba(92, 139, 222, 0.14), transparent 74%),
    rgba(248, 251, 255, 0.94);
}
.collab-summary-model.is-missing {
  border-color: rgba(184, 100, 86, 0.25);
  background:
    radial-gradient(160px 80px at 0 0, rgba(232, 151, 127, 0.14), transparent 74%),
    rgba(255, 250, 248, 0.96);
}
.collab-summary-model-icon {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: #315fa4;
  background: rgba(70, 114, 188, 0.12);
}
.collab-summary-model.is-missing .collab-summary-model-icon {
  color: #a45142;
  background: rgba(184, 100, 86, 0.11);
}
.collab-summary-model > div {
  min-width: 0;
}
.collab-summary-model strong {
  display: block;
  overflow: hidden;
  color: #243550;
  font-size: 12px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-summary-model p {
  margin: 2px 0 0;
  color: #7d899c;
  font-size: 10.5px;
  line-height: 1.4;
}
.collab-summary-model .ant-tag {
  margin-inline-end: 0;
  font-size: 10px;
}
.collab-summary-nudge {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  grid-template-rows: auto auto;
  gap: 9px 9px;
  padding: 11px;
  border: 1px solid #e1e8f1;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 7px 20px rgba(22, 39, 67, 0.045);
}
.collab-summary-nudge.is-ready {
  border-color: rgba(196, 146, 74, 0.38);
  background:
    radial-gradient(180px 90px at 0 0, rgba(255, 222, 165, 0.28), transparent 75%),
    rgba(255, 253, 248, 0.96);
}
.collab-summary-nudge-icon {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: #80561f;
  background: rgba(196, 146, 74, 0.13);
}
.collab-summary-nudge > div {
  min-width: 0;
}
.collab-summary-nudge strong {
  display: block;
  color: #243550;
  font-size: 12.5px;
  line-height: 1.35;
}
.collab-summary-nudge p {
  margin: 3px 0 0;
  color: #738096;
  font-size: 11.5px;
  line-height: 1.5;
}
.collab-summary-nudge-action {
  grid-column: 1 / -1;
  justify-self: stretch;
  width: 100%;
  min-height: 32px;
  margin-top: 2px;
  padding: 0 11px;
  border: 0;
  border-radius: 9px;
  color: #fff;
  font-size: 11.5px;
  font-weight: 650;
  background: linear-gradient(145deg, #987035, #80561f);
  box-shadow: 0 5px 13px rgba(128, 86, 31, 0.18);
  cursor: pointer;
  transition:
    transform 100ms ease-out,
    filter 160ms ease;
}
.collab-summary-nudge-action:active {
  transform: scale(0.96);
}
.collab-summary-nudge-action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  filter: saturate(0.55);
}
.collab-summary-controls {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  padding: 10px;
  border: 1px solid #e4eaf2;
  border-radius: 13px;
  background: rgba(247, 249, 253, 0.86);
}
.collab-summary-controls .ant-btn-primary {
  width: 100%;
  border-color: #5b50d6 !important;
  background: linear-gradient(135deg, #6d5eea, #5145c7) !important;
  box-shadow: 0 7px 18px rgba(81, 69, 199, 0.2);
  transition:
    transform 120ms cubic-bezier(.2, .8, .2, 1),
    filter 160ms ease,
    box-shadow 180ms ease;
}
.collab-summary-controls .ant-btn-primary:hover:not(:disabled) {
  filter: brightness(1.04);
  box-shadow: 0 9px 22px rgba(81, 69, 199, 0.26);
}
.collab-summary-controls .ant-btn-primary:active:not(:disabled) {
  transform: scale(0.982);
}
.collab-summary-controls label {
  grid-column: 1 / -1;
  color: #526079;
  font-size: 11px;
  font-weight: 650;
}
.collab-summary-controls .ant-select {
  min-width: 0;
}
.collab-summary-controls > span:last-child {
  grid-column: 1 / -1;
  color: #8b96a8;
  font-size: 10.5px;
  line-height: 1.45;
}
.collab-summary-empty {
  display: flex;
  min-height: 190px;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: #95a0b2;
  text-align: center;
}
.collab-summary-empty > .anticon {
  font-size: 28px;
  opacity: 0.66;
}
.collab-summary-empty strong {
  color: #5c6b84;
  font-size: 13px;
}
.collab-summary-empty span {
  max-width: 220px;
  font-size: 11.5px;
  line-height: 1.5;
}
.collab-summary-card {
  padding: 13px;
  border: 1px solid #dfe7f1;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 9px 26px rgba(22, 39, 67, 0.06);
}
.collab-summary-card > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.collab-summary-card > header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.collab-summary-card > header span {
  color: #8b6a35;
  font-size: 10.5px;
  font-weight: 720;
  letter-spacing: 0.06em;
}
.collab-summary-card > header strong {
  color: #172033;
  font-size: 13px;
  font-weight: 620;
  line-height: 1.55;
}
.collab-summary-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 9px;
  margin-top: 8px;
  color: #8b96a8;
  font-size: 10.5px;
}
.collab-summary-selection {
  margin: 7px 0 0;
  padding: 6px 8px;
  border-radius: 8px;
  color: #66738a;
  font-size: 10.5px;
  line-height: 1.4;
  background: #f4f7fb;
}
.collab-summary-card section {
  margin-top: 12px;
}
.collab-summary-card section h5 {
  margin: 0 0 6px;
  color: #526079;
  font-size: 11px;
  font-weight: 700;
}
.collab-summary-card section.is-decision h5 {
  color: #257653;
}
.collab-summary-card section.is-action h5 {
  color: #80561f;
}
.collab-summary-card ul {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.collab-summary-card li {
  position: relative;
  padding-left: 12px;
  color: #40506a;
  font-size: 11.5px;
  line-height: 1.5;
}
.collab-summary-card li::before {
  position: absolute;
  top: 0.62em;
  left: 1px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #7e91ad;
  content: "";
}
.collab-summary-locate {
  margin-top: 12px;
  padding: 0;
  border: 0;
  color: #315efb;
  font-size: 11px;
  background: transparent;
  cursor: pointer;
}
.collab-read-metrics > div {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.collab-read-metrics > div > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  padding: 8px 6px;
  border: 1px solid #e8edf5;
  border-radius: 9px;
  background: #fff;
}
.collab-read-metrics em {
  overflow: hidden;
  color: #8b96a8;
  font-size: 9.5px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-read-metrics strong {
  overflow: hidden;
  color: #31405b;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-kpi-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.collab-kpi {
  background: var(--lc-surface);
  border: 1px solid var(--lc-line);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.collab-kpi span { font-size: 11px; color: var(--lc-muted); }
.collab-kpi strong { font-size: 18px; color: var(--lc-ink); line-height: 1.2; }
.collab-kpi em { font-style: normal; font-size: 11px; color: var(--lc-muted); }
.collab-kpi.risk-green,
.collab-kpi.risk-yellow,
.collab-kpi.risk-red {
  color: var(--lc-ink);
  background: var(--lc-surface);
  border-color: var(--lc-line);
}
.collab-monitor-block h5 {
  margin: 0 0 8px;
  font-size: 12px;
  color: #66738a;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.collab-alert-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #fee2e2;
  color: #b91c1c;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
.collab-alert-block {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.collab-alert-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: none;
  overflow: visible;
  padding-right: 2px;
}
.collab-mini-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 56px;
  padding: 4px 0;
}
.collab-mini-bar-wrap {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
}
.collab-mini-bar-wrap i {
  display: block;
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: var(--lc-ink);
  min-height: 4px;
}
.collab-speaker-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.collab-speaker-list li {
  display: grid;
  grid-template-columns: 56px 1fr 28px;
  gap: 6px;
  align-items: center;
  font-size: 12px;
}
.collab-speaker-list .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #31405b;
}
.collab-speaker-list .track {
  height: 8px;
  background: var(--lc-hover);
  border-radius: 99px;
  overflow: hidden;
}
.collab-speaker-list .track i {
  display: block;
  height: 100%;
  background: var(--lc-ink);
  border-radius: 99px;
}
.collab-speaker-list em {
  font-style: normal;
  text-align: right;
  color: #8b96a8;
}
.collab-alert-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  margin: 0;
  padding: 7px 8px;
  border: 1px solid #e8edf5;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: background .12s ease, border-color .12s ease;
}
.collab-alert-row:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #d9e4ff;
}
.collab-alert-row:disabled,
.collab-alert-row.disabled {
  cursor: default;
  opacity: 0.72;
}
.collab-alert-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d48806;
  flex-shrink: 0;
}
.collab-alert-row.risk-red .collab-alert-dot { background: #cf1322; }
.collab-alert-row.risk-yellow .collab-alert-dot { background: #d48806; }
.collab-alert-title {
  font-size: 12px;
  color: #172033;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
}
.collab-alert-row em {
  font-style: normal;
  font-size: 11px;
  color: #93a0b4;
  flex-shrink: 0;
}
.collab-pending-files,
.collab-pending-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.collab-pending-image {
  position: relative;
  width: 72px;
  height: 72px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}
.collab-pending-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.collab-pending-image button {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,.55);
  color: #fff;
  cursor: pointer;
  line-height: 1;
  font-size: 14px;
}
.collab-pending-file {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 160px;
  max-width: 240px;
  padding: 8px 28px 8px 10px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
}
.collab-pending-file span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.collab-pending-file strong {
  font-size: 12px;
  color: #172033;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-pending-file em {
  font-style: normal;
  font-size: 11px;
  color: #93a0b4;
}
.collab-pending-file button {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,.45);
  color: #fff;
  cursor: pointer;
  line-height: 1;
}
.collab-msg-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 4px;
}
.collab-msg-image-shell {
  position: relative;
  width: min(220px, 42vw);
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border: 1px solid rgba(28, 43, 70, 0.08);
  border-radius: 10px;
  background: #f4f6fa;
  box-shadow: 0 5px 16px rgba(29, 43, 69, 0.06);
}
.collab-msg-image-shell.is-uploading {
  background: linear-gradient(110deg, #f1f3f7 8%, #fafbfc 18%, #f1f3f7 33%);
  background-size: 220% 100%;
  animation: collab-image-uploading 1.2s linear infinite;
}
@keyframes collab-image-uploading { to { background-position-x: -220%; } }
.collab-msg-image-root {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 9px;
  overflow: hidden;
  cursor: zoom-in;
}
.collab-msg-image-root .ant-image-img,
.collab-msg-image {
  display: block;
  width: 100% !important;
  height: 100% !important;
  object-fit: contain;
  background: #f4f6fa;
  cursor: zoom-in;
}
.collab-msg-uploading {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border-radius: 999px;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  background: rgba(17, 28, 47, 0.72);
  backdrop-filter: blur(10px);
}
.collab-msg-image-save {
  position: absolute;
  z-index: 3;
  top: 8px;
  right: 8px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.48);
  border-radius: 9px;
  color: #fff;
  background: rgba(17, 28, 47, 0.62);
  box-shadow: 0 5px 16px rgba(17, 28, 47, 0.18);
  opacity: 0;
  backdrop-filter: blur(10px);
  transition: opacity 140ms ease, transform 100ms ease-out, background 140ms ease;
}
.collab-msg-image-shell:hover .collab-msg-image-save,
.collab-msg-image-save:focus-visible {
  opacity: 1;
}
.collab-msg-image-save:hover { color: #fff; background: rgba(17, 28, 47, 0.82); }
.collab-msg-image-save:active { transform: scale(0.94); }
@media (hover: none) {
  .collab-msg-image-save { opacity: 1; }
}
.collab-msg-attach {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 6px 0 4px;
}
.collab-msg-file {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  color: #315efb;
  text-decoration: none;
  max-width: 260px;
  cursor: grab;
  font: inherit;
  text-align: left;
}
.collab-msg-file.is-artifact {
  cursor: pointer;
}
.collab-msg-file.is-artifact > .anticon:last-child {
  color: #315efb;
}
.collab-msg-file.is-uploading {
  color: #718096;
  cursor: default;
}
.collab-msg-file:hover {
  border-color: #b7c8ff;
  background: #eef3ff;
}
.collab-msg-file-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.collab-msg-file-meta strong {
  font-size: 13px;
  color: #172033;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-msg-file-meta em {
  font-style: normal;
  font-size: 11px;
  color: #93a0b4;
}

.collab-hint {
  margin: 12px;
  padding: 12px;
  border-radius: 12px;
  background: transparent;
  color: var(--lc-muted);
  font-size: 12px;
  line-height: 1.6;
}
.collab-insight {
  border: 1px solid #e8edf5;
  border-radius: 14px;
  padding: 12px;
  background: #fff;
  margin-bottom: 10px;
  box-shadow: 0 6px 16px rgba(31,51,94,.04);
}
.collab-insight.risk-red { border-color: #ffccc7; }
.collab-insight.risk-yellow { border-color: #ffe58f; }
.collab-insight header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.collab-insight header strong { flex: 1; font-size: 13px; color: #172033; }
.collab-insight header em { font-style: normal; font-size: 11px; color: #9aa4b5; }
.collab-insight section h5 {
  margin: 8px 0 4px;
  font-size: 11px;
  color: #8c97a9;
  font-weight: 600;
  letter-spacing: .5px;
}
.collab-insight section p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: #31405b;
}
.collab-tags { margin-bottom: 4px; }
.collab-evidence {
  margin: 8px 0;
  font-size: 12px;
  color: #7e8aa3;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.collab-evidence button {
  border: 1px solid #d9e4ff;
  background: #edf3ff;
  color: #315efb;
  border-radius: 999px;
  padding: 0 8px;
  height: 22px;
  cursor: pointer;
  font-size: 11px;
}

/* 全站主题由根节点变量控制；头像与风险/在线语义色不在此覆盖。 */
.collab-page,
.collab-sider,
.collab-ai,
.collab-main,
.collab-sider-head,
.collab-ai-head,
.collab-main-head,
.collab-tabs,
.collab-messages,
.collab-virtuoso,
.collab-monitor,
.collab-agent-input,
.collab-contact-pane,
.collab-room-list,
.collab-insight-list {
  color: var(--lc-ink);
  background: var(--lc-canvas);
  border-color: var(--lc-line);
}

.collab-page,
.collab-sider,
.collab-ai,
.collab-main-head,
.collab-sider-head,
.collab-ai-head,
.collab-tabs,
.collab-banner,
.collab-kpi,
.collab-alert-row {
  border-color: var(--lc-line);
}

.collab-tabs button,
.collab-ai-sub,
.collab-msg-history-tip,
.collab-contact-section-title,
.collab-room-del,
.collab-room-item em,
.collab-room-preview span,
.collab-contact-item span,
.collab-msg-name,
.collab-time-sep,
.collab-system-tip,
.collab-kpi span,
.collab-kpi em,
.collab-monitor-block h5,
.collab-speaker-list em,
.collab-alert-row em,
.collab-composer-hint {
  color: var(--lc-muted);
}

.collab-tabs button.active,
.collab-room-item:hover,
.collab-room-item.active,
.collab-contact-item:hover,
.collab-contact-item.is-bot,
.collab-contact-item.is-bot:hover,
.collab-room-del:hover,
.collab-mention-menu button:hover,
.collab-mention-menu button.active,
.collab-alert-row:hover:not(:disabled) {
  color: var(--lc-ink);
  background: var(--lc-hover);
  border-color: var(--lc-line);
}

.collab-room-item strong,
.collab-contact-item strong,
.collab-profile-card-main strong,
.collab-profile-uname,
.collab-profile-nick,
.collab-profile-role,
.collab-profile-bio,
.collab-bubble p,
.collab-md,
.collab-md .agent-md-root,
.collab-md .agent-md-p,
.collab-md .agent-md-strong,
.collab-md .agent-md-li,
.collab-md .agent-md-h1,
.collab-md .agent-md-h2,
.collab-md .agent-md-h3,
.collab-md .agent-md-h4,
.collab-kpi strong,
.collab-speaker-list .name,
.collab-alert-title,
.collab-mention-menu strong,
.collab-mention-menu em {
  color: var(--lc-ink);
}

.collab-bubble,
.collab-msg.ai .collab-bubble,
.collab-msg.peer .collab-bubble,
.collab-kpi,
.collab-alert-row,
.collab-profile-popover .ant-popover-inner,
.collab-md .agent-report-card,
.collab-md .agent-md-section,
.collab-md .agent-md-pre,
.collab-md .agent-md-mermaid,
.collab-md .agent-md-code,
.collab-md .agent-md-table td,
.collab-md .agent-md-table th {
  color: var(--lc-ink);
  background: var(--lc-surface);
  border-color: var(--lc-line);
  box-shadow: none;
}

.collab-mention-menu {
  color: var(--lc-ink);
  background: var(--lc-surface);
  border-color: var(--lc-line);
  box-shadow:
    0 14px 36px rgba(23, 32, 51, 0.16),
    0 0 0 1px rgba(49, 94, 251, 0.05);
}

.collab-msg.mine .collab-bubble {
  color: var(--lc-own-ink);
  background: var(--lc-own-bg);
  border-color: var(--lc-own-bg);
}

.collab-msg.mine .collab-bubble p,
.collab-msg.mine .collab-md,
.collab-msg.mine .collab-md .agent-md-root,
.collab-msg.mine .collab-md .agent-md-p,
.collab-msg.mine .collab-md .agent-md-strong,
.collab-msg.mine .collab-md .agent-md-li,
.collab-msg.mine .collab-md .agent-md-h1,
.collab-msg.mine .collab-md .agent-md-h2,
.collab-msg.mine .collab-md .agent-md-h3,
.collab-msg.mine .collab-md .agent-md-h4 {
  color: var(--lc-own-ink);
}

.collab-system-tip,
.collab-speaker-list .track {
  color: var(--lc-muted);
  background: var(--lc-hover);
  border-color: var(--lc-line);
}

:root[data-theme="dark"] .collab-sider,
:root[data-theme="dark"] .collab-ai,
:root[data-theme="dark"] .collab-sider-head,
:root[data-theme="dark"] .collab-ai-head,
:root[data-theme="dark"] .collab-main-head,
:root[data-theme="dark"] .collab-contact-pane,
:root[data-theme="dark"] .collab-room-list,
:root[data-theme="dark"] .collab-insight-list {
  color: var(--lc-ink);
  background: var(--lc-surface);
  border-color: var(--lc-border-light);
}

:root[data-theme="dark"] .collab-agent-input,
:root[data-theme="dark"] .collab-mention-menu,
:root[data-theme="dark"] .collab-profile-card,
:root[data-theme="dark"] .collab-insight,
:root[data-theme="dark"] .collab-kpi,
:root[data-theme="dark"] .collab-alert-row {
  color: var(--lc-ink);
  background: var(--lc-surface-raised);
  border-color: var(--lc-border-light);
  box-shadow: none;
}

:root[data-theme="dark"] .collab-intelligence-tabs {
  background: var(--lc-surface);
  border-color: var(--lc-border-light);
}

:root[data-theme="dark"] .collab-intelligence-tabs button {
  color: var(--lc-muted);
}

:root[data-theme="dark"] .collab-intelligence-tabs button.active {
  color: var(--lc-ink);
  background: var(--lc-surface-raised);
  box-shadow: inset 0 0 0 1px var(--lc-border-light);
}

:root[data-theme="dark"] .collab-summary-model,
:root[data-theme="dark"] .collab-summary-nudge,
:root[data-theme="dark"] .collab-summary-controls,
:root[data-theme="dark"] .collab-summary-card,
:root[data-theme="dark"] .collab-summary-selection {
  color: var(--lc-text-secondary);
  background: var(--lc-surface-raised);
  border-color: var(--lc-border-light);
  box-shadow: none;
}

:root[data-theme="dark"] .collab-summary-model.is-missing {
  color: var(--lc-status-error);
  background: var(--lc-status-error-bg);
  border-color: color-mix(in srgb, var(--lc-status-error) 42%, transparent);
}

:root[data-theme="dark"] .collab-summary-nudge.is-ready {
  color: var(--lc-status-warning);
  background: var(--lc-status-warning-bg);
  border-color: color-mix(in srgb, var(--lc-status-warning) 42%, transparent);
}

:root[data-theme="dark"] .collab-summary-model strong,
:root[data-theme="dark"] .collab-summary-nudge strong,
:root[data-theme="dark"] .collab-summary-card > header strong,
:root[data-theme="dark"] .collab-summary-card section h5,
:root[data-theme="dark"] .collab-summary-empty strong {
  color: var(--lc-ink);
}

:root[data-theme="dark"] .collab-summary-model p,
:root[data-theme="dark"] .collab-summary-nudge p,
:root[data-theme="dark"] .collab-summary-controls label,
:root[data-theme="dark"] .collab-summary-controls > span:last-child,
:root[data-theme="dark"] .collab-summary-meta,
:root[data-theme="dark"] .collab-summary-selection,
:root[data-theme="dark"] .collab-summary-card li,
:root[data-theme="dark"] .collab-summary-empty {
  color: var(--lc-muted);
}

:root[data-theme="dark"] .collab-banner.risk-yellow,
:root[data-theme="dark"] .collab-insight.risk-yellow {
  color: var(--lc-status-warning);
  background: var(--lc-status-warning-bg);
  border-color: color-mix(in srgb, var(--lc-status-warning) 42%, transparent);
}

:root[data-theme="dark"] .collab-banner.risk-red,
:root[data-theme="dark"] .collab-insight.risk-red {
  color: var(--lc-status-error);
  background: var(--lc-status-error-bg);
  border-color: color-mix(in srgb, var(--lc-status-error) 42%, transparent);
}

:root[data-theme="dark"] .collab-insight header strong,
:root[data-theme="dark"] .collab-insight section p,
:root[data-theme="dark"] .collab-profile-card-main strong,
:root[data-theme="dark"] .collab-agent-input textarea {
  color: var(--lc-ink);
}

:root[data-theme="dark"] .collab-insight header em,
:root[data-theme="dark"] .collab-insight section h5,
:root[data-theme="dark"] .collab-evidence,
:root[data-theme="dark"] .collab-agent-input textarea::placeholder {
  color: var(--lc-muted);
}

/* 让 AI 身份和告警类型完整可读，避免“监控提醒”首字被压缩。 */
.collab-msg.ai .collab-msg-aside,
.collab-msg.interject .collab-msg-aside {
  width: auto;
  max-width: 148px;
  align-items: flex-start;
}
.collab-msg.ai .collab-msg-name,
.collab-msg.interject .collab-msg-name {
  width: max-content;
  max-width: 148px;
  overflow: visible;
  text-overflow: clip;
  justify-content: flex-start;
  text-align: left;
}
.collab-msg.ai .collab-msg-name-text,
.collab-msg.interject .collab-msg-name-text {
  flex: 0 0 auto;
  max-width: none;
  overflow: visible;
  text-overflow: clip;
}

@media (hover: hover) and (pointer: fine) {
  .collab-msg:not(.system):hover .collab-bubble {
    transform: translateY(-1px);
    border-color: rgba(92, 110, 151, 0.24);
    box-shadow:
      0 10px 24px rgba(31, 45, 75, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.84);
  }
}

@media (prefers-reduced-motion: reduce) {
  .collab-room-item,
  .collab-contact-item,
  .collab-team-card,
  .collab-team-card-chevron,
  .collab-create-group-btn,
  .collab-panel-toggle,
  .collab-scroll-bottom,
  .collab-msg-image-save,
  .collab-msg-image-shell,
  .collab-msg-avatar,
  .collab-avatar-hit,
  .collab-bubble,
  .collab-draft-examples,
  .collab-draft-example-chip,
  .collab-summary-controls .ant-btn-primary {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
  .xiaoce-stream-caret {
    animation: none !important;
  }
  .collab-msg-image-shell.is-uploading { background: #f4f6fa; }
}

/* 自己发送的消息使用更轻盈的蓝紫玻璃气泡，和他人消息形成稳定层级。 */
.collab-msg.mine .collab-bubble:not(:has(.collab-md.blocks)) {
  border-color: rgba(121, 135, 221, 0.2);
  border-radius: 17px 17px 5px 17px;
  color: #263055;
  background:
    linear-gradient(145deg, rgba(238, 242, 255, 0.98), rgba(226, 232, 255, 0.94));
  box-shadow:
    0 8px 22px rgba(64, 79, 155, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.84);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  backdrop-filter: blur(14px) saturate(140%);
}
.collab-msg.peer .collab-bubble:not(:has(.collab-md.blocks)),
.collab-msg.ai .collab-bubble:not(:has(.collab-md.blocks)) {
  border-radius: 17px 17px 17px 5px;
  box-shadow:
    0 6px 18px rgba(31, 45, 75, 0.075),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}
:root[data-theme="dark"] .collab-msg.ai .collab-bubble {
  border-color: rgba(76, 207, 180, 0.28);
  color: var(--lc-ink);
  background:
    radial-gradient(180px 70px at 0 0, rgba(45, 185, 156, 0.16), transparent 78%),
    rgba(24, 48, 48, 0.96);
}
:root[data-theme="dark"] .collab-msg.interject .collab-bubble {
  border-color: rgba(226, 161, 74, 0.34);
  border-left-color: #d99132;
  background:
    radial-gradient(180px 70px at 0 0, rgba(230, 160, 51, 0.18), transparent 78%),
    rgba(54, 42, 25, 0.96);
}
.collab-msg.mine .collab-bubble:not(:has(.collab-md.blocks)) p,
.collab-msg.mine .collab-bubble:not(:has(.collab-md.blocks)) .collab-md {
  color: #263055;
}
:root[data-theme="dark"] .collab-msg.mine .collab-bubble:not(:has(.collab-md.blocks)) {
  border-color: rgba(147, 161, 255, 0.24);
  color: #eef0ff;
  background: linear-gradient(145deg, rgba(56, 67, 123, 0.96), rgba(42, 50, 96, 0.95));
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
}
:root[data-theme="dark"] .collab-msg.mine .collab-bubble:not(:has(.collab-md.blocks)) p,
:root[data-theme="dark"] .collab-msg.mine .collab-bubble:not(:has(.collab-md.blocks)) .collab-md {
  color: #eef0ff;
}

.collab-room-item.is-drop-target {
  border-color: rgba(111, 85, 232, 0.56);
  background: linear-gradient(135deg, rgba(245, 242, 255, 0.98), rgba(235, 241, 255, 0.96));
  box-shadow: 0 0 0 3px rgba(111, 85, 232, 0.11), 0 10px 26px rgba(59, 45, 129, 0.12);
  transform: translateX(2px);
}
.collab-agent-input {
  position: relative;
  padding: 10px 14px 14px !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
.collab-agent-input-inner {
  background: transparent;
}
.collab-agent-composer {
  border-radius: 22px;
}
:root[data-theme="dark"] .collab-agent-input {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
.collab-agent-input.is-drag-active .collab-agent-composer {
  border-color: rgba(111, 85, 232, 0.58) !important;
  box-shadow: 0 0 0 4px rgba(111, 85, 232, 0.1), 0 14px 34px rgba(45, 35, 102, 0.13) !important;
}
.collab-composer-drop-overlay {
  position: absolute;
  z-index: 80;
  inset: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 1px dashed rgba(111, 85, 232, 0.58);
  border-radius: 15px;
  color: #5b3fd1;
  background: rgba(248, 246, 255, 0.93);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.88);
  -webkit-backdrop-filter: blur(14px) saturate(145%);
  backdrop-filter: blur(14px) saturate(145%);
  pointer-events: none;
}
.collab-selection-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 14px 8px;
  padding: 9px 10px 9px 13px;
  border: 1px solid rgba(111, 85, 232, 0.18);
  border-radius: 12px;
  background: rgba(248, 246, 255, 0.92);
  box-shadow: 0 8px 22px rgba(54, 42, 115, 0.08);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.collab-selection-toolbar > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.collab-selection-toolbar strong { color: #3e326d; font-size: 12px; }
.collab-selection-toolbar span { color: #81779e; font-size: 10px; }
.collab-message-selector {
  position: absolute;
  z-index: 8;
  top: 20px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid #c8cfdb;
  border-radius: 7px;
  color: #fff;
  background: rgba(255, 255, 255, 0.94);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(28, 40, 66, 0.08);
}
.collab-page--selecting .collab-msg.peer { padding-left: 28px; }
.collab-page--selecting .collab-msg.mine { padding-right: 28px; }
.collab-msg.peer .collab-message-selector { left: 3px; }
.collab-msg.mine .collab-message-selector { right: 3px; }
.collab-message-selector.is-selected {
  border-color: #6f55e8;
  background: #6f55e8;
}
.collab-msg.is-selected .collab-bubble {
  outline: 2px solid rgba(111, 85, 232, 0.44);
  outline-offset: 3px;
}
.collab-forward-origin {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 8px;
  padding: 6px 8px;
  border-radius: 9px;
  color: #756a91;
  background: rgba(111, 85, 232, 0.07);
  font-size: 11px;
}
.collab-forward-origin > span { display: flex; flex-direction: column; }
.collab-forward-origin small { color: #9b93ad; font-size: 9px; }
.collab-forward-card {
  width: min(360px, 64vw);
  overflow: hidden;
  border: 1px solid rgba(130, 139, 160, 0.17);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.78);
}
.collab-forward-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(130, 139, 160, 0.14);
}
.collab-forward-card-head strong { color: #313a50; font-size: 12px; }
.collab-forward-card-head span { color: #8d96a8; font-size: 10px; }
.collab-forward-card-list {
  max-height: 286px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.collab-forward-card-item {
  display: flex;
  gap: 8px;
  padding: 9px 11px;
  border-bottom: 1px solid rgba(130, 139, 160, 0.1);
}
.collab-forward-card-item:last-child { border-bottom: 0; }
.collab-forward-card-item > div { min-width: 0; }
.collab-forward-card-item strong { display: block; color: #465169; font-size: 10px; }
.collab-forward-card-item p {
  margin: 2px 0;
  overflow: hidden;
  color: #283248;
  font-size: 11px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-forward-card-item small { color: #9aa3b2; font-size: 9px; }
.collab-forward-modal .ant-modal-content { border-radius: 18px; }
.collab-forward-form { display: grid; gap: 12px; }
.collab-forward-form > label { color: #535e73; font-size: 12px; font-weight: 600; }
.collab-forward-mode { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.collab-forward-mode button {
  display: flex;
  min-height: 72px;
  align-items: center;
  gap: 10px;
  padding: 11px;
  border: 1px solid #e0e4ec;
  border-radius: 12px;
  color: #7c879a;
  text-align: left;
  background: #fbfcfe;
  cursor: pointer;
}
.collab-forward-mode button.is-active {
  border-color: rgba(111, 85, 232, 0.48);
  color: #6f55e8;
  background: #f7f4ff;
  box-shadow: 0 0 0 3px rgba(111, 85, 232, 0.07);
}
.collab-forward-mode button > span { display: flex; flex-direction: column; }
.collab-forward-mode strong { color: #303a50; font-size: 12px; }
.collab-forward-mode small { color: #9099a9; font-size: 10px; }
.collab-forward-count { color: #8b94a6; font-size: 11px; }
.collab-group-modal .ant-modal-content {
  overflow: hidden;
  border: 1px solid rgba(221, 225, 235, 0.86);
  border-radius: 20px;
  box-shadow: 0 28px 80px rgba(21, 32, 54, 0.2);
}
.collab-group-modal .ant-select-selector,
.collab-group-modal .ant-input { border-radius: 10px !important; }
.collab-group-team-summary,
.collab-group-total {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
  padding: 7px 9px;
  border-radius: 10px;
  color: #4d5b72;
  background: #f5f7fb;
  font-size: 11px;
}
.collab-group-team-summary { color: #0f766e; background: #ecfdf8; }
.collab-message-menu .ant-dropdown-menu-item-danger,
.collab-conversation-menu .ant-dropdown-menu-item-danger {
  color: #b42318 !important;
  background: transparent !important;
}
.collab-message-menu .ant-dropdown-menu-item-danger:hover,
.collab-message-menu .ant-dropdown-menu-item-danger.ant-dropdown-menu-item-active,
.collab-conversation-menu .ant-dropdown-menu-item-danger:hover,
.collab-conversation-menu .ant-dropdown-menu-item-danger.ant-dropdown-menu-item-active {
  color: #b42318 !important;
  background: #fff1f0 !important;
}
.collab-danger-confirm .ant-btn-dangerous.ant-btn-primary {
  border-color: #d92d20 !important;
  color: #fff !important;
  background: #d92d20 !important;
  box-shadow: 0 7px 18px rgba(217, 45, 32, 0.2);
}
.collab-danger-confirm .ant-btn-dangerous.ant-btn-primary:hover {
  border-color: #b42318 !important;
  color: #fff !important;
  background: #b42318 !important;
}
:root[data-theme="dark"] .collab-composer-drop-overlay,
:root[data-theme="dark"] .collab-selection-toolbar,
:root[data-theme="dark"] .collab-forward-card,
:root[data-theme="dark"] .collab-profile-popover .ant-popover-inner {
  border-color: rgba(142, 124, 230, 0.24);
  color: var(--lc-ink);
  background: rgba(25, 29, 40, 0.94);
}
:root[data-theme="dark"] .collab-profile-detail-list dd,
:root[data-theme="dark"] .collab-forward-card-item p,
:root[data-theme="dark"] .collab-forward-card-head strong { color: var(--lc-ink); }
:root[data-theme="dark"] .collab-team-card {
  border-color: rgba(142, 124, 230, 0.22);
  background:
    radial-gradient(160px 72px at 0 0, rgba(142, 124, 230, 0.14), transparent 74%),
    rgba(25, 29, 40, 0.94);
}
:root[data-theme="dark"] .collab-team-card-copy strong,
:root[data-theme="dark"] .collab-team-member,
:root[data-theme="dark"] .collab-translation-text { color: var(--lc-ink); }
:root[data-theme="dark"] .collab-team-card-copy small,
:root[data-theme="dark"] .collab-team-card-count,
:root[data-theme="dark"] .collab-team-member small { color: var(--lc-muted); }
:root[data-theme="dark"] .collab-team-member:hover { background: rgba(142, 124, 230, 0.13); }
:root[data-theme="dark"] .collab-team-empty {
  border-color: rgba(142, 124, 230, 0.24);
  color: var(--lc-muted);
  background: rgba(25, 29, 40, 0.72);
}
:root[data-theme="dark"] .collab-translation {
  border-top-color: rgba(180, 190, 210, 0.17);
  background: rgba(12, 16, 24, 0.28);
}
:root[data-theme="dark"] .collab-group-modal .ant-modal-content,
:root[data-theme="dark"] .collab-group-total { color: var(--lc-ink); background: var(--lc-panel); }
:root[data-theme="dark"] .collab-group-team-summary { color: #5eead4; background: rgba(17, 94, 82, 0.35); }

@media (max-width: 1100px) {
  .collab-page {
    grid-template-columns: 200px minmax(0, 1fr) 260px;
  }
  .collab-page--summary-hidden { grid-template-columns: 200px minmax(0, 1fr); }
}
@media (max-width: 860px) {
  .collab-sider-head { padding: 10px; }
  .collab-sider-head > .ant-typography { display: none; }
  .collab-create-group-btn { width: 100%; }
  .collab-team-card-main { grid-template-columns: 36px minmax(0, 1fr) 14px; }
  .collab-team-card-main .ant-avatar-group,
  .collab-team-card-count { display: none; }
  .collab-page {
    grid-template-columns: minmax(190px, 220px) minmax(0, 1fr);
    height: calc(100vh - 68px);
    min-height: 0;
    overflow: hidden;
  }
  .collab-page > .collab-sider { grid-column: 1; grid-row: 1; }
  .collab-page > .collab-main { grid-column: 2; grid-row: 1; }
  .collab-page > .collab-ai,
  .collab-page > .collab-artifacts {
    position: absolute;
    grid-column: auto;
    grid-row: auto;
    z-index: 60;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(320px, calc(100% - 44px));
    max-height: none;
    border-left: 1px solid #e1e6ef;
    box-shadow: -18px 0 44px rgba(26, 38, 63, 0.15);
  }
  .collab-sider, .collab-main { min-height: 0; max-height: none; }
  .collab-main { min-width: 0; }
  .collab-selection-toolbar { align-items: flex-start; flex-direction: column; }
  .collab-forward-card { width: min(320px, 56vw); }
  .xiaoce-stream-footer { padding-inline: 10px; }
  .xiaoce-stream-message { width: 94%; margin-left: 10px; }
  .xiaoce-process { width: 100%; }
}
@media (max-width: 560px) {
  .collab-page { grid-template-columns: 132px minmax(0, 1fr); }
  .collab-room-item { padding-left: 5px; }
  .collab-room-main { gap: 6px; }
  .collab-room-main .collab-avatar-wrap { display: none; }
  .collab-room-badges .ant-tag { display: none; }
  .collab-main-head { padding-inline: 10px; }
  .collab-group-title-trigger {
    max-width: 45vw;
  }
  .collab-group-title-trigger strong {
    font-size: 16px;
  }
  .collab-virt-item {
    padding-inline: 14px 10px;
  }
  .collab-msg.peer {
    margin-left: 10px;
  }
  .collab-msg.mine {
    margin-right: 10px;
  }
  .collab-forward-mode { grid-template-columns: 1fr; }
  .collab-contact-open-hint { display: none; }
  .collab-contact-pane { padding-inline: 6px; }
  .collab-contact-item { gap: 6px; padding: 7px 5px; border-radius: 9px; }
  .collab-contact-item .collab-avatar-wrap,
  .collab-contact-item .ant-avatar,
  .collab-bot-avatar { width: 32px !important; height: 32px !important; flex-basis: 32px; }
  .collab-contact-item strong { font-size: 11px; }
  .collab-contact-item strong .ant-tag { display: none; }
  .collab-contact-item span { font-size: 9px; }
  .collab-contact-item.is-bot > div:last-child > span {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-height: 1.35;
  }
}
`;
