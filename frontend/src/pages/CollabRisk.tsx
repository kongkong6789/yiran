import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  App, Avatar, Badge, Button, Dropdown, Empty, Image, Input, Modal, Popover, Select, Space, Tag, Tooltip, Typography,
} from "antd";
import type { TooltipPlacement } from "antd/es/tooltip";
import {
  AlertOutlined, ClearOutlined, CopyOutlined, DeleteOutlined, EditOutlined, FileOutlined,
  CloseOutlined, MoonOutlined, PaperClipOutlined, PlusOutlined, RobotOutlined, RollbackOutlined,
  SendOutlined, SettingOutlined, StopOutlined, SunOutlined,
  TeamOutlined, UserAddOutlined, UserDeleteOutlined, UserOutlined,
} from "@ant-design/icons";
import {
  addCollabRoomMembers,
  clearCollabMessages,
  removeCollabRoomMembers,
  collabPresenceHeartbeat,
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
  markCollabRoomRead,
  recallCollabMessage,
  deleteCollabMessage,
  refreshCollabInsights,
  checkCollabDraft,
  cancelXiaoceRun,
  sendCollabMessage,
  summarizeCollabRoom,
  updateCollabMemberNickname,
  updateCollabRoom,
  type AuthUser,
  type CollabInsight,
  type CollabMessage,
  type CollabRoom,
  type CollabRoomStats,
  type CollabDraftTip,
  type CollabUserBrief,
  type UserSkillItem,
  type XiaoceRun,
} from "../api/client";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import ChatMarkdown from "../components/ChatMarkdown";
import ChatSkillPicker from "../components/ChatSkillPicker";
import XiaoceProcess from "../components/XiaoceProcess";
import XiaoceTaskList from "../components/XiaoceTaskList";
import CollabMonitorBoard from "../components/CollabMonitorBoard";
import { useCollabRoomLive } from "../hooks/useCollabRoomLive";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useThemeMode } from "../theme/mode";
import {
  beginRoomSelection,
  createXiaoceRunId,
  isRoomAsyncResultCurrent,
  isXiaoceTaskRunning,
  isXiaoceRoom,
  mergeXiaoceRunSnapshot,
  mergeXiaoceRunSnapshots,
  partitionXiaoceRooms,
  resolveXiaoceDeleteState,
  setRoomPending,
  xiaoceDeleteContent,
} from "./xiaoceChat";
import "../styles/xiaoceChatTheme.css";

const MSG_WINDOW = 50;
const VIRT_BASE_INDEX = 100_000;

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
  if (!url) return undefined;
  const token = getAuthToken();
  if (!token) return url;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}token=${encodeURIComponent(token)}`;
}

type MentionOption = {
  id: string;
  type: "all" | "ai" | "user";
  insert: string;
  label: string;
  desc: string;
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

function buildMentionOptions(
  room: CollabRoom | null,
  me: AuthUser | null,
  query: string,
): MentionOption[] {
  const q = query.trim().toLowerCase();
  const list: MentionOption[] = [
    { id: "all", type: "all", insert: "@所有人 ", label: "所有人", desc: "提醒会话内全部成员" },
    { id: "ai", type: "ai", insert: "@AI ", label: "AI", desc: "召唤良策AI 直接回复" },
  ];
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
}: {
  user: CollabUserBrief;
  online?: boolean;
  roleHint?: string;
}) {
  const label = memberLabel(user) || user.username;
  const src = authAvatarSrc(user.avatar_url);
  const isOnline = online ?? user.online;
  return (
    <div className="collab-profile-card">
      <Avatar
        size={52}
        src={src}
        style={{ background: src ? undefined : avatarColor(label), flexShrink: 0 }}
      >
        {label.slice(0, 1).toUpperCase()}
      </Avatar>
      <div className="collab-profile-card-main">
        <strong>{label}</strong>
        <span className="collab-profile-uname">@{user.username}</span>
        {user.nickname && user.nickname !== label ? (
          <span className="collab-profile-nick">群昵称：{user.nickname}</span>
        ) : null}
        {roleHint ? <span className="collab-profile-role">{roleHint}</span> : null}
        {user.bio ? <p className="collab-profile-bio">{user.bio}</p> : null}
        <span className={`collab-profile-online ${isOnline ? "on" : "off"}`}>
          {isOnline ? "在线" : "离线"}
        </span>
      </div>
    </div>
  );
}

function AiProfileCardContent({
  interject = false,
  suggest = false,
}: {
  interject?: boolean;
  suggest?: boolean;
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
  placement = "rightTop",
  size = 32,
}: {
  children?: ReactNode;
  user?: CollabUserBrief | null;
  online?: boolean;
  roleHint?: string;
  ai?: boolean;
  interject?: boolean;
  suggest?: boolean;
  placement?: TooltipPlacement;
  size?: number;
}) {
  const content = ai
    ? <AiProfileCardContent interject={interject} suggest={suggest} />
    : (user ? (
      <UserProfileCardContent user={user} online={online} roleHint={roleHint} />
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
        <span
          className="collab-avatar-hit"
          role="button"
          tabIndex={0}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </span>
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
        onClick={(e) => e.stopPropagation()}
        aria-label={`${label} 的资料`}
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
  onStartRoundtable?: (seed?: CollabRoundtableSeed) => void;
};

export default function CollabRisk({
  embedded = false,
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
    pendingFiles: { file: File; preview?: string }[];
    replyingTo: CollabMessage | null;
  };
  type RoomViewCache = {
    room: CollabRoom;
    messages: CollabMessage[];
    insights: CollabInsight[];
    hasMoreBefore: boolean;
    firstItemIndex: number;
    xiaoceRun: XiaoceRun | null;
    stats: CollabRoomStats | null;
  };
  const roomComposerCacheRef = useRef<Map<string, RoomComposerCache>>(new Map());
  const roomViewCacheRef = useRef<Map<string, RoomViewCache>>(new Map());
  const roomLoadSeqRef = useRef(0);
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
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [skillRefreshKey, setSkillRefreshKey] = useState(0);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [siderTab, setSiderTab] = useState<"chats" | "contacts">("chats");
  const [contacts, setContacts] = useState<CollabUserBrief[]>([]);
  const [contactKeyword, setContactKeyword] = useState("");
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
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
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview?: string }[]>([]);
  const [mention, setMention] = useState<MentionState>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const composerBoxRef = useRef<HTMLDivElement | null>(null);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [firstItemIndex, setFirstItemIndex] = useState(VIRT_BASE_INDEX);
  const stickBottomRef = useRef(true);
  const forceStickUntilRef = useRef(0);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
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
  const pendingFilesRef = useRef<{ file: File; preview?: string }[]>([]);
  const replyingToRef = useRef<CollabMessage | null>(null);
  const hasMoreBeforeRef = useRef(false);
  const firstItemIndexRef = useRef(VIRT_BASE_INDEX);
  const roomStatsRef = useRef<CollabRoomStats | null>(null);
  const sendingRoomIdsRef = useRef<Set<string>>(new Set());
  const contactKeywordRef = useRef("");
  const loadingOlderRef = useRef(false);
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
  hasMoreBeforeRef.current = hasMoreBefore;
  firstItemIndexRef.current = firstItemIndex;
  roomStatsRef.current = roomStats;
  useEffect(() => { contactKeywordRef.current = contactKeyword; }, [contactKeyword]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const xiaoceRoom = isXiaoceRoom(activeRoom);
  const xiaoceBusy = xiaoceRoom && activeXiaoceRun?.status === "running";
  const sending = Boolean(activeId && sendingRoomIds.has(activeId));
  const { xiaoceTasks, otherRooms } = useMemo(
    () => partitionXiaoceRooms(rooms),
    [rooms],
  );
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

  const isParticipant = useMemo(() => {
    if (!me || !activeRoom) return false;
    return activeRoom.participants.some((p) => p.id === me.id);
  }, [me, activeRoom]);

  const isXiaoce = xiaoceRoom;

  const canKickMembers = useMemo(() => {
    if (!me || !activeRoom || activeRoom.room_kind !== "group") return false;
    if (!isParticipant && !me.is_staff) return false;
    return Boolean(me.is_staff || activeRoom.created_by?.id === me.id);
  }, [me, activeRoom, isParticipant]);

  const canDeleteRoom = useMemo(() => {
    if (!me || !activeRoom) return false;
    if (me.is_staff) return true;
    if (!isParticipant) return false;
    if (activeRoom.room_kind === "group") {
      return activeRoom.created_by?.id === me.id;
    }
    return true;
  }, [me, activeRoom, isParticipant]);

  const bannerInsight = useMemo(() => {
    const hot = insights.find((i) => i.risk_level === "red" || i.risk_level === "yellow");
    return hot || null;
  }, [insights]);

  const chatAlertByMsgId = useMemo(
    () => buildChatAlertMap(insights, roomStats?.alerts),
    [insights, roomStats?.alerts],
  );

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.status !== "deleted"),
    [messages],
  );

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

  const scrollMessagesToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
    stickBottomRef.current = true;
    forceStickUntilRef.current = Date.now() + 1600;
    const go = () => {
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior,
      });
    };
    requestAnimationFrame(() => {
      go();
      window.setTimeout(go, 40);
      window.setTimeout(go, 160);
    });
  }, []);

  const loadRooms = useCallback(async (selectFirst = false) => {
    setLoadingRooms(true);
    try {
      const data = await listCollabRooms();
      setRooms(data.results || []);
      if (selectFirst && !activeId && data.results?.[0]) {
        setActiveId(data.results[0].id);
      }
    } catch {
      message.error("加载协作会话失败");
    } finally {
      setLoadingRooms(false);
    }
  }, [activeId, message]);

  const loadRoomDetail = useCallback(async (id: string) => {
    const seq = ++roomLoadSeqRef.current;
    try {
      const [room, page] = await Promise.all([
        getCollabRoom(id),
        listCollabMessages(id, { limit: MSG_WINDOW, includeParticipants: false }),
      ]);
      if (seq !== roomLoadSeqRef.current || activeIdRef.current !== id) return;
      const hydratedRoom = {
        ...room,
        ...page.room,
        // 首屏消息用分页窗口，避免一次拉全量历史
        messages: page.results,
        has_more_before: page.has_more_before,
      } as CollabRoom;
      const nextMessages = page.results || [];
      const nextInsights = room.insights || [];
      const nextHasMore = Boolean(page.has_more_before ?? room.has_more_before);
      const nextXiaoce = isXiaoceRoom(hydratedRoom) ? (hydratedRoom.active_xiaoce_run || null) : null;
      setActiveRoom(hydratedRoom);
      setActiveXiaoceRun(nextXiaoce);
      setMessages(nextMessages);
      setHasMoreBefore(nextHasMore);
      setFirstItemIndex(VIRT_BASE_INDEX);
      setInsights(nextInsights);
      stickBottomRef.current = true;
      forceStickUntilRef.current = Date.now() + 2000;
      window.setTimeout(() => scrollMessagesToBottom("auto"), 80);
      // 统计看板异步加载，不挡切换体感
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
      roomViewCacheRef.current.set(id, {
        room: hydratedRoom,
        messages: nextMessages,
        insights: nextInsights,
        hasMoreBefore: nextHasMore,
        firstItemIndex: VIRT_BASE_INDEX,
        xiaoceRun: nextXiaoce,
        stats: roomViewCacheRef.current.get(id)?.stats || null,
      });
    } catch {
      if (seq === roomLoadSeqRef.current && activeIdRef.current === id) {
        message.error("读取会话失败");
      }
    }
  }, [message, scrollMessagesToBottom]);

  const selectRoom = useCallback((roomId: string) => {
    if (roomId === activeIdRef.current) return;
    // 先把当前会话的输入框状态存起来
    const prevId = beginRoomSelection(activeIdRef, roomLoadSeqRef, roomId);
    setStatsLoading(false);
    if (prevId) {
      roomComposerCacheRef.current.set(prevId, {
        draft: draftRef.current,
        pendingFiles: pendingFilesRef.current,
        replyingTo: replyingToRef.current,
      });
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
        });
      }
    }
    // 立刻切 UI：恢复该会话草稿 / 缓存消息，避免共用输入框和白屏等待
    const composer = roomComposerCacheRef.current.get(roomId);
    setDraft(composer?.draft || "");
    setPendingFiles(composer?.pendingFiles || []);
    setReplyingTo(composer?.replyingTo || null);
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
    if (cached) {
      setActiveRoom(cached.room);
      setMessages(cached.messages);
      setInsights(cached.insights);
      setHasMoreBefore(cached.hasMoreBefore);
      setFirstItemIndex(cached.firstItemIndex);
      setActiveXiaoceRun(cached.xiaoceRun);
      setRoomStats(cached.stats);
      stickBottomRef.current = true;
      forceStickUntilRef.current = Date.now() + 1200;
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

  useEffect(() => {
    getMe().then((r) => setMe(r.user)).catch(() => setMe(null));
    const roomFromQuery = searchParams.get("room");
    const botFromQuery = searchParams.get("bot");
    loadRooms(!roomFromQuery && !botFromQuery);
    listCollabUsers()
      .then((d) => setContacts(d.results || []))
      .catch(() => setContacts([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 从铃铛/外链带 ?room= 进入时打开对应会话
  useEffect(() => {
    const roomId = searchParams.get("room");
    if (!roomId) return;
    selectRoom(roomId);
    setSiderTab("chats");
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, selectRoom]);

  // 从「AI 问答」入口带 ?bot=xiaoce 进入时，直聊小策bot
  useEffect(() => {
    const bot = searchParams.get("bot");
    if (bot !== "xiaoce" && bot !== "小策bot") return;
    const nasPrompt = (location.state as { nasPrompt?: string } | null)?.nasPrompt?.trim() || "";
    setSiderTab("contacts");
    let cancelled = false;
    const roomRequest = botRoomRequestRef.current || createCollabRoom({
      peer_username: "小策bot",
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
        setSiderTab("chats");
        if (nasPrompt) {
          roomComposerCacheRef.current.set(room.id, {
            draft: nasPrompt,
            pendingFiles: [],
            replyingTo: null,
          });
          setDraft(nasPrompt);
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
        if (!cancelled) message.error(e?.response?.data?.error || "打开小策bot 失败");
      } finally {
        if (botRoomRequestRef.current === roomRequest) botRoomRequestRef.current = null;
        if (!cancelled) setCreating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [location.pathname, location.state, loadRooms, message, navigate, searchParams]);

  useEffect(() => {
    if (!activeId) return;
    setRooms((prev) => prev.map((r) => (r.id === activeId ? { ...r, unread_count: 0 } : r)));
    setReplyingTo(null);
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
      }).catch(() => undefined);
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
    const timer = window.setInterval(() => report(false), 15_000);
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

  // 进入页面后定时心跳，维持「在线」并刷新联系人/会话在线态
  useEffect(() => {
    let stopped = false;
    const beat = async () => {
      try {
        await collabPresenceHeartbeat();
        if (stopped) return;
        const q = contactKeywordRef.current.trim() || undefined;
        const [roomData, userData] = await Promise.all([
          listCollabRooms(),
          listCollabUsers(q),
        ]);
        if (stopped) return;
        setContacts(userData.results || []);
        setRooms((prev) => {
          const next = roomData.results || [];
          if (
            prev.length === next.length
            && prev.every((r, i) => {
              const n = next[i];
              return Boolean(
                n
                && r.id === n.id
                && r.unread_count === n.unread_count
                && r.risk_level === n.risk_level
                && r.peer_online === n.peer_online
                && r.online_count === n.online_count
                && r.updated_at === n.updated_at
                && (r.last_message?.id || 0) === (n.last_message?.id || 0)
                && (r.last_message?.content || "") === (n.last_message?.content || "")
                && participantsPresenceEqual(r.participants, n.participants),
              );
            })
          ) {
            return prev;
          }
          return next;
        });
        setActiveRoom((prev) => {
          if (!prev) return prev;
          const fresh = (roomData.results || []).find((r) => r.id === prev.id);
          if (!fresh) return prev;
          if (
            prev.peer_online === fresh.peer_online
            && prev.online_count === fresh.online_count
            && prev.risk_level === fresh.risk_level
            && prev.status === fresh.status
            && prev.updated_at === fresh.updated_at
            && (prev.active_xiaoce_run?.id || "") === (fresh.active_xiaoce_run?.id || "")
            && (prev.active_xiaoce_run?.status || "") === (fresh.active_xiaoce_run?.status || "")
            && participantsPresenceEqual(prev.participants, fresh.participants)
          ) {
            return prev;
          }
          return {
            ...prev,
            peer_online: fresh.peer_online,
            online_count: fresh.online_count,
            participants: fresh.participants,
            risk_level: fresh.risk_level,
            status: fresh.status,
            updated_at: fresh.updated_at,
            active_xiaoce_run: fresh.active_xiaoce_run,
          };
        });
      } catch {
        /* ignore */
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
  }, []);

  const loadContacts = useCallback(async (q?: string) => {
    try {
      const d = await listCollabUsers(q);
      setContacts(d.results || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!activeId) {
      setActiveRoom(null);
      setActiveXiaoceRun(null);
      setCancellingRunId(null);
      setMessages([]);
      setInsights([]);
      setRoomStats(null);
      prevActiveIdForComposerRef.current = null;
      return;
    }
    prevActiveIdForComposerRef.current = activeId;
    stickBottomRef.current = true;
    void loadRoomDetail(activeId);
  }, [activeId, loadRoomDetail]);

  const mergeLiveMessages = useCallback((incoming: CollabMessage[], changed?: CollabMessage[]) => {
    const shouldStick = stickBottomRef.current || Date.now() < forceStickUntilRef.current;
    setMessages((prev) => {
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
          else next.push(m);
        }
      }
      if (changed?.length) {
        next = mergeMessagePatches(next, changed);
      }
      const rid = activeIdRef.current;
      if (rid) {
        const cached = roomViewCacheRef.current.get(rid);
        if (cached) roomViewCacheRef.current.set(rid, { ...cached, messages: next });
      }
      return next;
    });
    if (shouldStick && incoming.length) {
      scrollMessagesToBottom("auto");
    }
    if ([...incoming, ...(changed || [])].some((item) => Boolean(item.meta?.created_skill))) {
      setSkillRefreshKey((value) => value + 1);
    }
  }, [scrollMessagesToBottom]);

  const mergeLiveInsights = useCallback((incoming: CollabInsight[]) => {
    setInsights((prev) => {
      const known = new Set(prev.map((i) => i.id));
      const add = incoming.filter((i) => !known.has(i.id));
      return add.length ? [...prev, ...add] : prev;
    });
  }, []);

  const mergeLiveXiaoceRuns = useCallback((runs: XiaoceRun[]) => {
    const newest = runs.length > 0
      ? runs.reduce((latest, run) => (
          Date.parse(run.updated_at || "") >= Date.parse(latest.updated_at || "") ? run : latest
        ))
      : null;
    const nextRun = newest
      ? mergeXiaoceRunSnapshot(activeXiaoceRunRef.current, newest)
      : null;
    activeXiaoceRunRef.current = nextRun;
    setActiveXiaoceRun(nextRun);
    const roomId = activeIdRef.current;
    if (!roomId) return;
    setRooms((current) => current.map((room) => (
      room.id === roomId ? { ...room, active_xiaoce_run: nextRun } : room
    )));
    setActiveRoom((current) => current?.id === roomId
      ? { ...current, active_xiaoce_run: nextRun }
      : current);
    const cached = roomViewCacheRef.current.get(roomId);
    if (cached) {
      roomViewCacheRef.current.set(roomId, {
        ...cached,
        room: { ...cached.room, active_xiaoce_run: nextRun },
        xiaoceRun: nextRun,
      });
    }
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
      const patched = { ...prev, ...meta, participants: nextParts };
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
    isRoomCurrent: isLiveRoomCurrent,
    setRoomStats,
    participantsEqual: participantsPresenceEqual,
  });

  const loadOlderMessages = useCallback(async () => {
    if (!activeId || !hasMoreBefore || loadingOlderRef.current) return;
    const oldest = messagesRef.current.find((m) => m.status !== "deleted")?.id
      || messagesRef.current[0]?.id;
    if (!oldest) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await listCollabMessages(activeId, {
        beforeId: oldest,
        limit: 40,
        lite: true,
        includeParticipants: false,
      });
      const add = page.results || [];
      if (add.length) {
        setFirstItemIndex((idx) => idx - add.length);
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          const unique = add.filter((m) => !known.has(m.id));
          return unique.length ? [...unique, ...prev] : prev;
        });
      }
      setHasMoreBefore(Boolean(page.has_more_before));
    } catch {
      /* ignore */
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [activeId, hasMoreBefore]);

  useEffect(() => {
    if (!groupOpen && !inviteOpen) return;
    loadContacts();
  }, [groupOpen, inviteOpen, loadContacts]);

  const openDm = async (username: string) => {
    setCreating(true);
    try {
      const room = await createCollabRoom({
        peer_username: username,
        room_kind: "dm",
      });
      await loadRooms();
      selectRoom(room.id);
      setSiderTab("chats");
      message.success(`已打开与 ${username} 的对话`);
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

  const handleCreateGroup = async () => {
    if (groupMembers.length < 1) {
      message.warning("请至少选择一位群成员");
      return;
    }
    setCreating(true);
    try {
      const room = await createCollabRoom({
        title: groupTitle.trim() || undefined,
        peer_usernames: groupMembers,
        room_kind: "group",
      });
      setGroupOpen(false);
      setGroupMembers([]);
      setGroupTitle("");
      await loadRooms();
      selectRoom(room.id);
      setSiderTab("chats");
      message.success("群聊已创建");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "创建群聊失败");
    } finally {
      setCreating(false);
    }
  };

  const openInviteModal = () => {
    setInviteMembers([]);
    setInviteOpen(true);
    loadContacts();
  };

  const handleInviteMembers = async () => {
    if (!activeId || !activeRoom) return;
    if (inviteMembers.length < 1) {
      message.warning("请选择要邀请的联系人");
      return;
    }
    setInviting(true);
    try {
      const res = await addCollabRoomMembers(activeId, inviteMembers);
      setInviteOpen(false);
      setInviteMembers([]);
      if (res.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message.id)) return prev;
          return [...prev, res.message];
        });
      }
      if (res.room) {
        setActiveRoom((prev) => prev ? { ...prev, ...res.room } : res.room);
        setRooms((prev) => prev.map((r) => (r.id === res.room.id ? { ...r, ...res.room } : r)));
      }
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
      setRooms((current) => current.map((item) => (
        item.id === roomId ? { ...item, ...room, messages: undefined, insights: undefined } : item
      )));
      if (activeIdRef.current === roomId) {
        setActiveRoom((current) => current?.id === roomId
          ? { ...current, ...room, messages: undefined, insights: undefined }
          : current);
        if (target.room_kind === "group" && room.messages?.length) {
          const last = room.messages[room.messages.length - 1];
          setMessages((current) => (
            current.some((messageRow) => messageRow.id === last.id)
              ? current
              : [...current, last]
          ));
        }
      }
      const cached = roomViewCacheRef.current.get(roomId);
      if (cached) {
        roomViewCacheRef.current.set(roomId, {
          ...cached,
          room: { ...cached.room, ...room, messages: undefined, insights: undefined },
        });
      }
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
    if (!activeId || !activeRoom || !me) return;
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
        const res = await updateCollabMemberNickname(activeId, {
          username: p.username,
          nickname: (nickDrafts[p.username] || "").trim(),
        });
        latestRoom = res.room;
        if (res.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === res.message!.id)) return prev;
            return [...prev, res.message!];
          });
        }
      }
      setActiveRoom((prev) => prev ? { ...prev, ...latestRoom } : latestRoom);
      setRooms((prev) => prev.map((r) => (r.id === latestRoom.id ? { ...r, ...latestRoom } : r)));
      // 刷新消息发送者展示名
      if (latestRoom.participants) {
        const byId = new Map(latestRoom.participants.map((p) => [p.id, p]));
        setMessages((prev) => prev.map((m) => {
          const p = byId.get(m.sender.id);
          if (!p || m.msg_type === "ai" || m.msg_type === "system") return m;
          return {
            ...m,
            sender: {
              ...m.sender,
              nickname: p.nickname,
              display_name: p.display_name || p.nickname || p.username,
              avatar_url: p.avatar_url || m.sender.avatar_url,
              bio: p.bio || m.sender.bio,
            },
          };
        }));
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
    if (!activeId || !activeRoom) return;
    if (kickMembers.length < 1) {
      message.warning("请选择要移出的成员");
      return;
    }
    setKicking(true);
    try {
      const res = await removeCollabRoomMembers(activeId, kickMembers);
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
      if (res.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message.id)) return prev;
          return [...prev, res.message];
        });
      }
      if (res.room) {
        setActiveRoom((prev) => prev ? { ...prev, ...res.room } : res.room);
        setRooms((prev) => prev.map((r) => (r.id === res.room!.id ? { ...r, ...res.room! } : r)));
      }
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
    replyTarget: CollabMessage | null = null,
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
      message.warning("旁观者不能发送消息");
      return false;
    }
    if (targetRoom?.status === "closed") {
      message.warning("会话已结束");
      return false;
    }
    if (
      targetRoom
      && isXiaoceRoom(targetRoom)
      && isXiaoceTaskRunning(targetRoom, activeRoomRef.current, activeXiaoceRunRef.current)
    ) {
      message.warning("小策bot 正在处理，请先暂停或等待完成");
      return false;
    }
    const runId = isXiaoceRoom(targetRoom) ? createXiaoceRunId() : undefined;
    stickBottomRef.current = true;
    forceStickUntilRef.current = Date.now() + 1600;
    const tempId = -Date.now();
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
      attachments: [],
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
      meta: runId ? { run_id: runId } : {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const cachedAtStart = roomViewCacheRef.current.get(targetRoomId);
    if (cachedAtStart) {
      roomViewCacheRef.current.set(targetRoomId, {
        ...cachedAtStart,
        messages: [...cachedAtStart.messages, optimistic],
      });
    }
    if (isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)) {
      setMessages((current) => [...current, optimistic]);
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
      );
      const mergeResponseMessages = (current: CollabMessage[]) => {
        const withoutTemp = current.filter((row) => row.id !== tempId);
        const next = [...withoutTemp];
        if (!next.some((row) => row.id === res.message.id)) next.push(res.message);
        if (res.ai_message && !next.some((row) => row.id === res.ai_message!.id)) {
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
      if (cached) {
        roomViewCacheRef.current.set(targetRoomId, {
          ...cached,
          messages: mergeResponseMessages(cached.messages),
          room: {
            ...cached.room,
            ...res.room,
            active_xiaoce_run: mergedRun,
          },
          xiaoceRun: mergedRun,
        });
      }
      setRooms((current) => current.map((room) => (
        room.id === targetRoomId ? {
          ...room,
          ...res.room,
          active_xiaoce_run: mergedRun,
          updated_at: res.room.updated_at || room.updated_at,
        } : room
      )));
      if (isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)) {
        setMessages(mergeResponseMessages);
        scrollMessagesToBottom("auto");
        activeXiaoceRunRef.current = mergedRun;
        setActiveXiaoceRun(mergedRun);
        setActiveRoom((current) => current?.id === targetRoomId ? {
          ...current,
          ...res.room,
          active_xiaoce_run: mergedRun,
        } : current);
        setMention(null);
      }
      // 统计看板稍后刷新，不挡发送体感
      window.setTimeout(() => { void refreshStats(targetRoomId); }, 800);
      return true;
    } catch (e: any) {
      const removeOptimistic = (current: CollabMessage[]) => (
        current.filter((row) => row.id !== tempId)
      );
      const cached = roomViewCacheRef.current.get(targetRoomId);
      if (cached) {
        roomViewCacheRef.current.set(targetRoomId, {
          ...cached,
          messages: removeOptimistic(cached.messages),
        });
      }
      if (isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)) {
        setMessages(removeOptimistic);
      }
      const pendingRun = e?.response?.data?.xiaoce_run as XiaoceRun | undefined;
      if (pendingRun) {
        const failedCache = roomViewCacheRef.current.get(targetRoomId);
        const mergedPendingRun = mergeXiaoceRunSnapshots(pendingRun, [
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
        setRooms((current) => current.map((room) => (
          room.id === targetRoomId ? { ...room, active_xiaoce_run: mergedPendingRun } : room
        )));
        if (failedCache) {
          roomViewCacheRef.current.set(targetRoomId, {
            ...failedCache,
            room: { ...failedCache.room, active_xiaoce_run: mergedPendingRun },
            xiaoceRun: mergedPendingRun,
          });
        }
        if (isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)) {
          activeXiaoceRunRef.current = mergedPendingRun;
          setActiveXiaoceRun(mergedPendingRun);
          setActiveRoom((current) => current?.id === targetRoomId
            ? { ...current, active_xiaoce_run: mergedPendingRun }
            : current);
        }
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
    const content = draftRef.current.trim();
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
    roomComposerCacheRef.current.set(targetRoomId, {
      draft: "",
      pendingFiles: [],
      replyingTo: null,
    });
    const ok = await sendPlainMessage(targetRoomId, content, files, replyTarget);
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
      });
      if (isRoomAsyncResultCurrent(activeIdRef.current, targetRoomId)) {
        setDraft(content);
        setReplyingTo(replyTarget);
        setPendingFiles(restoredFiles);
      }
    } else {
      previews.forEach((url) => { if (url) URL.revokeObjectURL(url); });
    }
  };

  const pauseXiaoce = async () => {
    const roomId = activeId;
    const runId = activeXiaoceRun?.id;
    if (!roomId || !runId || cancellingRunId) return;
    setCancellingRunId(runId);
    try {
      const response = await cancelXiaoceRun(roomId, runId);
      setRooms((previous) => previous.map((room) => (
        room.id === roomId ? { ...room, ...response.room, active_xiaoce_run: null } : room
      )));
      if (activeIdRef.current === roomId) {
        setMessages((previous) => {
          const index = previous.findIndex((item) => item.id === response.message.id);
          if (index < 0) return [...previous, response.message];
          const next = [...previous];
          next[index] = response.message;
          return next;
        });
        setActiveRoom((previous) => previous ? {
          ...previous,
          ...response.room,
          active_xiaoce_run: null,
        } : previous);
        setActiveXiaoceRun(null);
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
    if (!activeId) return;
    try {
      const res = await recallCollabMessage(activeId, m.id);
      setMessages((prev) => mergeMessagePatches(prev, [res.message]));
      if (res.room) {
        setActiveRoom((prev) => (prev ? { ...prev, ...res.room } : res.room));
      }
      message.success("已撤回");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "撤回失败");
    }
  };

  const handleDeleteMessage = (m: CollabMessage) => {
    if (!activeId) return;
    Modal.confirm({
      title: "删除这条消息？",
      content: "删除后会话内其他人也将看不到该消息。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await deleteCollabMessage(activeId, m.id);
          setMessages((prev) => mergeMessagePatches(prev, [res.message]));
          if (res.room) {
            setActiveRoom((prev) => (prev ? { ...prev, ...res.room } : res.room));
          }
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
      const merged = [...prev];
      for (const file of incoming) {
        if (merged.length >= MAX_FILES) break;
        if (!merged.some((item) => item.file.name === file.name && item.file.size === file.size)) {
          merged.push({
            file,
            preview: isImageFile(file) ? URL.createObjectURL(file) : undefined,
          });
        }
      }
      if (merged.length >= MAX_FILES) {
        message.info(`最多发送 ${MAX_FILES} 个附件`);
      }
      return merged;
    });
  };

  const removePendingFile = (idx: number) => {
    setPendingFiles((prev) => {
      const next = [...prev];
      const [removed] = next.splice(idx, 1);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return next;
    });
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
    if (!activeId) return;
    try {
      const room = await updateCollabRoom(activeId, { status: "closed" });
      setActiveRoom(room);
      if (room.insights) setInsights(room.insights);
      await loadRooms();
      message.success("会话已结束，已生成风控纪要");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "结束失败");
    }
  };

  const handleClearHistory = () => {
    if (!activeId) return;
    Modal.confirm({
      title: "清空聊天记录？",
      content: "将删除本会话全部消息与风控洞察，会话本身保留。此操作对所有成员生效。",
      okText: "清空记录",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await clearCollabMessages(activeId);
          setMessages(res.room?.messages || (res.message ? [res.message] : []));
          setInsights(res.room?.insights || []);
          if (res.room) {
            setActiveRoom((prev) => prev ? { ...prev, ...res.room, messages: undefined, insights: undefined } : res.room);
            setRooms((prev) => prev.map((r) => (r.id === res.room.id ? { ...r, ...res.room, messages: undefined, insights: undefined } : r)));
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
      title,
      content,
      okText: xiaoceTask ? "删除任务" : "删除会话",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteCollabRoom(id);
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
    if (!activeId) return;
    try {
      const res = await refreshCollabInsights(activeId);
      setInsights((prev) => [...prev, res.insight]);
      setActiveRoom(res.room);
      if (res.ai_message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.ai_message!.id)) return prev;
          return [...prev, res.ai_message!];
        });
      }
      await refreshStats(activeId);
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
    () => (mention ? buildMentionOptions(activeRoom, me, mention.query) : []),
    [mention, activeRoom, me],
  );

  useEffect(() => {
    setMentionIndex(0);
  }, [mention?.query, mentionOptions.length]);

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

  return (
    <div className={`collab-page${embedded ? " collab-page--embedded" : ""}`}>
      <style>{css}</style>

      <aside className="collab-sider">
        <div className="collab-sider-head">
          <Typography.Text strong>协作</Typography.Text>
          <Tooltip title="发起群聊">
            <Button
              type="primary"
              size="small"
              icon={<TeamOutlined />}
              onClick={() => setGroupOpen(true)}
            />
          </Tooltip>
        </div>
        <div className="collab-tabs">
          <button
            type="button"
            className={siderTab === "chats" ? "active" : ""}
            onClick={() => setSiderTab("chats")}
          >
            消息
          </button>
          <button
            type="button"
            className={siderTab === "contacts" ? "active" : ""}
            onClick={() => {
              setSiderTab("contacts");
              setContactKeyword("");
              void loadContacts();
            }}
          >
            通讯录
          </button>
        </div>

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
                  className={`collab-room-item ${activeId === room.id ? "active" : ""} risk-${room.risk_level}`}
                >
                  <button
                    type="button"
                    className="collab-room-main"
                    onClick={() => selectRoom(room.id)}
                  >
                    {peer ? (
                      <ProfileAvatarPopover user={peer} online={online} placement="rightTop">
                        <AvatarWithPresence
                          name={memberLabel(peer) || title}
                          online={online}
                          avatarUrl={peer.avatar_url}
                        />
                      </ProfileAvatarPopover>
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
                const v = e.target.value;
                setContactKeyword(v);
                void loadContacts(v.trim() || undefined);
              }}
              style={{ marginBottom: 8 }}
            />
            <div className="collab-room-list">
              {filteredContacts.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={contactKeyword.trim() ? "没有匹配的联系人" : "暂无其他账号"}
                />
              ) : (
                <>
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
                      {botContacts.length > 0 ? (
                        <div className="collab-contact-section-title">同事</div>
                      ) : null}
                      {humanContacts.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          className="collab-contact-item"
                          disabled={creating}
                          onClick={() => openDm(user.username)}
                        >
                          <ProfileAvatarPopover user={user} online={Boolean(user.online)} placement="rightTop">
                            <AvatarWithPresence
                              name={memberLabel(user) || user.username}
                              online={Boolean(user.online)}
                              avatarUrl={user.avatar_url}
                            />
                          </ProfileAvatarPopover>
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
                        </button>
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
          <div className="collab-empty soft">
            {activeId ? "正在打开会话…" : "从左侧选择会话，或打开通讯录发起聊天"}
          </div>
        ) : (
          <>
            <header className="collab-main-head">
              <div>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {roomTitle(activeRoom)}
                  {activeRoom.room_kind === "group" ? (
                    <Typography.Text type="secondary" style={{ fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
                      ({activeRoom.participants.length}人)
                    </Typography.Text>
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
                </Typography.Title>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <span className={roomPeerOnline(activeRoom) ? "collab-status-on" : "collab-status-off"}>
                    {presenceLabel(activeRoom)}
                  </span>
                  {" · "}
                  {activeRoom.room_kind === "group" ? "群聊" : "单聊"}
                  {" · "}
                  {activeRoom.participants.map((p) => memberLabel(p)).join("、")}
                  {!isParticipant ? " · 管理员旁观（只读）" : ""}
                </Typography.Text>
              </div>
              <Space>
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
                {(isParticipant || me?.is_staff) ? (
                  <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
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

            <div className="collab-messages">
              {visibleMessages.length === 0 ? (
                <div className="collab-empty soft">
                  开始对话吧。需要 AI 时请 @AI（或调用 Skill）；日常讨论不会自动插嘴。右侧为旁路监控。
                </div>
              ) : (
              <Virtuoso
                ref={virtuosoRef}
                className="collab-virtuoso"
                data={visibleMessages}
                firstItemIndex={firstItemIndex}
                initialTopMostItemIndex={{
                  index: Math.max(0, visibleMessages.length - 1),
                  align: "end",
                }}
                followOutput={() => {
                  if (Date.now() < forceStickUntilRef.current) return "auto";
                  return stickBottomRef.current ? "auto" : false;
                }}
                atBottomThreshold={100}
                atBottomStateChange={(bottom) => {
                  if (Date.now() < forceStickUntilRef.current) {
                    stickBottomRef.current = true;
                    if (!bottom) {
                      virtuosoRef.current?.scrollToIndex({
                        index: "LAST",
                        align: "end",
                        behavior: "auto",
                      });
                    }
                    return;
                  }
                  stickBottomRef.current = bottom;
                }}
                startReached={() => {
                  if (stickBottomRef.current || Date.now() < forceStickUntilRef.current) return;
                  void loadOlderMessages();
                }}
                increaseViewportBy={{ top: 480, bottom: 320 }}
                components={{
                  Header: () => (
                    <div className="collab-msg-history-tip">
                      {loadingOlder ? "加载更早消息…" : hasMoreBefore ? "上滑加载更早消息" : "已到会话开头"}
                    </div>
                  ),
                }}
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
                const receiptMembers = activeRoom.room_kind === "group"
                  ? activeRoom.participants.filter((participant) => participant.id !== m.sender.id)
                  : [];
                const receiptRead = receiptMembers.filter(
                  (participant) => (participant.last_read_message_id || 0) >= m.id,
                );
                const receiptUnread = receiptMembers.filter(
                  (participant) => (participant.last_read_message_id || 0) < m.id,
                );
                const readNames = receiptRead.map((participant) => memberLabel(participant));
                const unreadNames = receiptUnread.map((participant) => memberLabel(participant));
                const unreadReceiptCount = receiptUnread.length;
                // 消息自带旗标，或洞察/告警挂到证据消息上 → 显示红/黄连线
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
                const timeSep = timeSepBeforeId.has(m.id)
                  ? formatChatTimeSep(m.created_at)
                  : "";
                if (isSystem) {
                  return (
                    <div className="collab-virt-item">
                      {timeSep ? <div className="collab-time-sep">{timeSep}</div> : null}
                      <Dropdown trigger={["contextMenu"]} menu={{ items: msgContextItems(m) }}>
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
                    <Dropdown trigger={["contextMenu"]} menu={{ items: msgContextItems(m) }}>
                    <div
                      id={`collab-msg-${m.id}`}
                      className={`collab-msg ${mine ? "mine" : "peer"} ${isAi ? "ai" : ""} ${isInterject ? "interject" : ""} ${isCollabSuggest ? "suggest" : ""} ${flagged ? "flagged" : ""} ${highlightId === m.id ? "highlight" : ""}`}
                    >
                      <div className="collab-msg-aside">
                        <span className="collab-msg-name">
                          {isAi ? aiLabel : memberLabel(m.sender)}
                          {isCollabSuggest ? <em className="collab-suggest-tag">建议</em> : null}
                          {isInterject ? <em className="collab-interject-tag">警告</em> : null}
                        </span>
                        <ProfileAvatarPopover
                          ai={isAi}
                          interject={isInterject}
                          suggest={isCollabSuggest}
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
                              avatar_url: p.avatar_url || m.sender.avatar_url,
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
                              <span className="collab-msg-flag-label">{flagLabel}</span>
                              <i className="collab-msg-flag-line" aria-hidden />
                            </div>
                          </Tooltip>
                        )}
                        <div className={`collab-bubble${flagged ? ` risk-edge-${flagLevel}` : ""}`}>
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
                        {!!m.attachments?.length && (
                          <div className="collab-msg-attach">
                            {m.attachments.filter((a) => a.is_image && a.url).length > 0 && (
                              <div className="collab-msg-images">
                                <Image.PreviewGroup>
                                  {m.attachments.filter((a) => a.is_image && a.url).map((a) => (
                                    <Image
                                      key={a.id}
                                      src={collabAttachUrl(a.url)}
                                      alt={a.name || "图片"}
                                      className="collab-msg-image"
                                      rootClassName="collab-msg-image-root"
                                    />
                                  ))}
                                </Image.PreviewGroup>
                              </div>
                            )}
                            {m.attachments.filter((a) => !a.is_image).map((a) => (
                              <a
                                key={a.id}
                                className="collab-msg-file"
                                href={collabAttachUrl(a.url, true)}
                                target="_blank"
                                rel="noreferrer"
                                download={a.name}
                              >
                                <FileOutlined />
                                <span className="collab-msg-file-meta">
                                  <strong>{a.name || "附件"}</strong>
                                  <em>{fmtSize(a.size || 0)}</em>
                                </span>
                              </a>
                            ))}
                          </div>
                        )}
                        {m.content ? renderMessageBody(m.content, activeRoom, isAi) : null}
                        {isXiaoceMessage && m.meta?.process_steps?.length ? (
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
                      {mine && activeRoom.room_kind === "group" && m.id > 0 ? (
                        <Popover
                          trigger="click"
                          placement="bottomRight"
                          content={(
                            <div className="collab-read-popover">
                              <strong>消息回执</strong>
                              <span>已读：{readNames.length ? readNames.join("、") : "暂无"}</span>
                              <span>未读：{unreadNames.length ? unreadNames.join("、") : "全部已读"}</span>
                            </div>
                          )}
                        >
                          <button
                            type="button"
                            className={`collab-read-state${unreadReceiptCount === 0 ? " is-all-read" : ""}`}
                          >
                            {unreadReceiptCount === 0 ? "全部已读" : `${unreadReceiptCount} 人未读`}
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
              )}
            </div>

            {xiaoceBusy && activeXiaoceRun ? (
              <div className="xiaoce-live-process">
                <span className="xiaoce-live-process-label">小策bot</span>
                <XiaoceProcess
                  steps={activeXiaoceRun.progress_steps}
                  status={activeXiaoceRun.status}
                  live
                  errorMessage={activeXiaoceRun.error_message}
                />
              </div>
            ) : null}

            <div className="agent-chat-input collab-agent-input">
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
              >
                {mention && mentionOptions.length > 0 ? (
                  <div className="collab-mention-menu" role="listbox">
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
                          {opt.type === "ai" ? <RobotOutlined /> : opt.type === "all" ? <TeamOutlined /> : <UserOutlined />}
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
                      ? "旁观模式，仅可查看"
                      : activeRoom.status === "closed"
                        ? "会话已结束"
                        : xiaoceBusy
                          ? "小策bot 正在处理，可点击右侧暂停"
                        : "输入消息… 用 @ 提及成员 / @AI；停手约 3 秒会给出可点的改写示例"
                  }
                  autoSize={{ minRows: 2, maxRows: 6 }}
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
                    if (mention && mentionOptions.length > 0) {
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
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                />
                <div className="agent-chat-composer-bar">
                  <div className="agent-chat-composer-left">
                    <ChatSkillPicker onSelect={insertSkill} refreshKey={skillRefreshKey} />
                    {!(mention && mentionOptions.length > 0) ? (
                      <span className="collab-composer-hint">@成员 · @AI · Skill</span>
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
                      <Tooltip title="发送">
                        <Button
                          className="agent-chat-send-circle"
                          type="primary"
                          shape="circle"
                          icon={<SendOutlined />}
                          loading={sending}
                          disabled={
                            (!draft.trim() && pendingFiles.length === 0)
                            || !isParticipant
                            || activeRoom.status === "closed"
                          }
                          onClick={handleSend}
                          aria-label="发送"
                        />
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      <CollabMonitorBoard
        room={activeRoom}
        stats={roomStats}
        loading={statsLoading}
        onRefresh={handleRefreshInsight}
        onJumpEvidence={jumpEvidence}
        summaryLoading={summaryLoading}
        onSummarize={handleSummarize}
      />

      <Modal
        title="发起群聊"
        open={groupOpen}
        onCancel={() => setGroupOpen(false)}
        onOk={handleCreateGroup}
        confirmLoading={creating}
        okText="创建群聊"
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
            <Typography.Text type="secondary">选择群成员</Typography.Text>
            <Select
              mode="multiple"
              showSearch
              style={{ width: "100%" }}
              placeholder="选择多个联系人"
              value={groupMembers}
              onChange={setGroupMembers}
              onSearch={(q) => loadContacts(q)}
              options={contacts
                .filter((u) => !(u.kind === "bot" || u.bot_id === "xiaoce" || u.username === "小策bot"))
                .map((u) => ({ value: u.username, label: u.username }))}
              filterOption={false}
            />
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
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 300px;
  height: calc(100vh - 68px);
  min-height: 520px;
  border: 1px solid #e8edf5;
  border-radius: 0;
  overflow: hidden;
  background: #fff;
  box-shadow: none;
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
.collab-sider, .collab-ai {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fbfcfe;
  overflow: hidden;
}
.collab-sider { border-right: 1px solid #e8edf5; }
.collab-ai {
  border-left: 1px solid #e8edf5;
  min-width: 0;
  overflow: auto;
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
  flex: 1;
  height: 100%;
  background: #fff;
}
.collab-virt-item {
  padding: 0 10px 8px;
  overflow: visible;
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
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  padding: 8px 10px 4px;
  user-select: none;
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
.collab-contact-item div { display: flex; flex-direction: column; min-width: 0; }
.collab-contact-item span { font-size: 12px; color: #93a0b4; }
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
  padding: 12px 14px;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(23, 32, 51, 0.12);
}
.collab-profile-card {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-width: 196px;
  max-width: 260px;
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
  overflow: visible;
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
  margin-bottom: 14px;
  width: fit-content;
  max-width: 88%;
  overflow: visible;
}
.collab-msg.mine { margin-left: auto; flex-direction: row-reverse; }
.collab-msg-aside {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 72px;
  align-self: flex-start;
}
.collab-msg.mine .collab-msg-aside {
  align-items: center;
}
.collab-msg-name {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  max-width: 72px;
  font-size: 11px;
  font-weight: 600;
  color: #5c6b84;
  line-height: 1.2;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-msg.mine .collab-msg-name {
  color: #31405b;
}
.collab-msg-name .collab-suggest-tag,
.collab-msg-name .collab-interject-tag {
  margin: 0;
  flex-shrink: 0;
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
  flex-direction: column;
  align-items: flex-start;
  pointer-events: auto;
  cursor: default;
  max-width: min(240px, 70vw);
}
.collab-msg.mine .collab-msg-flag {
  right: 10px;
  align-items: flex-end;
}
.collab-msg.peer .collab-msg-flag {
  left: 10px;
  align-items: flex-start;
}
.collab-msg-flag-label {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.25;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collab-msg-flag.risk-red .collab-msg-flag-label { color: #cf1322; }
.collab-msg-flag.risk-yellow .collab-msg-flag-label { color: #d48806; }
.collab-msg-flag-line {
  display: block;
  width: 2px;
  height: 18px;
  margin-top: 2px;
  border-radius: 1px;
  opacity: 1;
}
.collab-msg-flag.risk-red .collab-msg-flag-line { background: #cf1322; }
.collab-msg-flag.risk-yellow .collab-msg-flag-line { background: #d48806; }
.collab-msg.flagged {
  margin-top: 32px;
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
.xiaoce-live-process {
  flex-shrink: 0;
  padding: 10px 16px 8px;
  border-top: 1px solid var(--lc-border-light, #edf1f7);
  background: color-mix(in srgb, var(--lc-bg-elevated, #fff) 92%, #f3f7ff);
}
.xiaoce-live-process-label {
  display: block;
  margin: 0 0 6px 2px;
  color: var(--lc-text-muted, #5c6b84);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
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
.collab-agent-composer.has-mention {
  z-index: 80;
}
.collab-agent-composer.has-coach {
  margin-top: 8px;
}
.collab-draft-examples {
  margin: 0 0 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f4f7fb;
  border: 1px solid #e4ebf4;
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
  margin-bottom: 8px;
}
.collab-draft-examples-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.collab-draft-example-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #d7e2ef;
  background: #fff;
  cursor: pointer;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.collab-draft-example-chip:hover {
  border-color: #C4924A;
  box-shadow: 0 4px 12px rgba(11, 33, 68, 0.06);
  background: #fffdf8;
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
  background: #ecfdf8;
  border-color: #99f6e4;
}
.collab-msg.interject .collab-bubble {
  background: #fffbeb;
  border-color: #fcd34d;
  border-left: 3px solid #d97706;
}
.collab-msg.suggest .collab-bubble {
  background: #ecfdf8;
  border-color: #99f6e4;
  border-left: 3px solid #0f766e;
}
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
  overflow: auto;
  overscroll-behavior: contain;
  padding: 12px;
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
  max-height: min(36vh, 280px);
  overflow: auto;
  overscroll-behavior: contain;
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
.collab-msg-image-root {
  display: block;
  max-width: 220px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(0,0,0,.06);
  cursor: zoom-in;
}
.collab-msg-image-root .ant-image-img,
.collab-msg-image {
  display: block;
  max-width: 220px;
  max-height: 280px;
  width: auto !important;
  height: auto !important;
  object-fit: contain;
  background: #f4f6fa;
  cursor: zoom-in;
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

@media (max-width: 1100px) {
  .collab-page {
    grid-template-columns: 200px minmax(0, 1fr) 260px;
  }
}
@media (max-width: 860px) {
  .collab-page {
    grid-template-columns: 1fr;
    height: auto;
    overflow: auto;
  }
  .collab-page > .collab-sider,
  .collab-page > .collab-main,
  .collab-page > .collab-ai {
    grid-column: auto;
    grid-row: auto;
  }
  .collab-sider, .collab-ai { max-height: 280px; }
  .collab-main { min-height: 520px; }
  .xiaoce-live-process { padding-inline: 10px; }
  .xiaoce-process { width: 100%; }
}
`;
