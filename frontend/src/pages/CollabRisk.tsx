import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App, Avatar, Badge, Button, Dropdown, Empty, Image, Input, Modal, Select, Space, Tag, Tooltip, Typography,
} from "antd";
import {
  AlertOutlined, ClearOutlined, DeleteOutlined, EditOutlined, FileOutlined,
  PaperClipOutlined, ReloadOutlined, RobotOutlined,
  SafetyCertificateOutlined, SendOutlined, SettingOutlined, StopOutlined,
  TeamOutlined, UserAddOutlined, UserDeleteOutlined, UserOutlined,
} from "@ant-design/icons";
import {
  addCollabRoomMembers,
  clearCollabMessages,
  removeCollabRoomMembers,
  collabPresenceHeartbeat,
  createCollabRoom,
  deleteCollabRoom,
  getAuthToken,
  getCollabRoom,
  getMe,
  listCollabInsights,
  listCollabMessages,
  listCollabRooms,
  listCollabUsers,
  refreshCollabInsights,
  sendCollabMessage,
  updateCollabMemberNickname,
  updateCollabRoom,
  type AuthUser,
  type CollabInsight,
  type CollabMessage,
  type CollabRoom,
  type CollabUserBrief,
} from "../api/client";
import ChatMarkdown from "../components/ChatMarkdown";
import { useSearchParams } from "react-router-dom";

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
  const before = text.slice(0, caret);
  const m = before.match(/@([^\s@]*)$/);
  if (!m) return null;
  return { start: caret - m[0].length, end: caret, query: m[1] || "" };
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
      <div className="collab-md">
        <ChatMarkdown content={content} variant="default" />
      </div>
    );
  }
  return <p>{renderMentionContent(content, room)}</p>;
}

export default function CollabRisk() {
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [me, setMe] = useState<AuthUser | null>(null);
  const [rooms, setRooms] = useState<CollabRoom[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeRoom, setActiveRoom] = useState<CollabRoom | null>(null);
  const [messages, setMessages] = useState<CollabMessage[]>([]);
  const [insights, setInsights] = useState<CollabInsight[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
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
  const [creating, setCreating] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; preview?: string }[]>([]);
  const [mention, setMention] = useState<MentionState>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<any>(null);
  const pollRef = useRef<number | null>(null);
  const messagesRef = useRef<CollabMessage[]>([]);
  const insightsRef = useRef<CollabInsight[]>([]);
  const contactKeywordRef = useRef("");

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { insightsRef.current = insights; }, [insights]);
  useEffect(() => { contactKeywordRef.current = contactKeyword; }, [contactKeyword]);

  const isParticipant = useMemo(() => {
    if (!me || !activeRoom) return false;
    return activeRoom.participants.some((p) => p.id === me.id);
  }, [me, activeRoom]);

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
    try {
      const room = await getCollabRoom(id);
      setActiveRoom(room);
      setMessages(room.messages || []);
      setInsights(room.insights || []);
    } catch {
      message.error("读取会话失败");
    }
  }, [message]);

  useEffect(() => {
    getMe().then((r) => setMe(r.user)).catch(() => setMe(null));
    const roomFromQuery = searchParams.get("room");
    loadRooms(!roomFromQuery);
    listCollabUsers()
      .then((d) => setContacts(d.results || []))
      .catch(() => setContacts([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 从铃铛/外链带 ?room= 进入时打开对应会话
  useEffect(() => {
    const roomId = searchParams.get("room");
    if (!roomId) return;
    setActiveId(roomId);
    setSiderTab("chats");
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!activeId) return;
    setRooms((prev) => prev.map((r) => (r.id === activeId ? { ...r, unread_count: 0 } : r)));
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
        setRooms(roomData.results || []);
        setContacts(userData.results || []);
        setActiveRoom((prev) => {
          if (!prev) return prev;
          const fresh = (roomData.results || []).find((r) => r.id === prev.id);
          if (!fresh) return prev;
          return {
            ...prev,
            peer_online: fresh.peer_online,
            online_count: fresh.online_count,
            participants: fresh.participants,
            risk_level: fresh.risk_level,
            status: fresh.status,
            updated_at: fresh.updated_at,
          };
        });
      } catch {
        /* ignore */
      }
    };
    beat();
    const timer = window.setInterval(beat, 20000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
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
      setMessages([]);
      setInsights([]);
      return;
    }
    loadRoomDetail(activeId);
  }, [activeId, loadRoomDetail]);

  // 轮询增量消息 / 洞察
  useEffect(() => {
    if (!activeId) return;
    const tick = async () => {
      try {
        const lastMsgId = messagesRef.current.length
          ? messagesRef.current[messagesRef.current.length - 1].id
          : 0;
        const lastInsightId = insightsRef.current.length
          ? Math.max(...insightsRef.current.map((i) => i.id))
          : 0;
        const [msgRes, insightRes] = await Promise.all([
          listCollabMessages(activeId, lastMsgId),
          listCollabInsights(activeId, lastInsightId),
        ]);
        if (msgRes.results?.length) {
          setMessages((prev) => {
            const known = new Set(prev.map((m) => m.id));
            const add = msgRes.results.filter((m) => !known.has(m.id));
            return add.length ? [...prev, ...add] : prev;
          });
        }
        if (insightRes.results?.length) {
          setInsights((prev) => {
            const known = new Set(prev.map((i) => i.id));
            const add = insightRes.results.filter((i) => !known.has(i.id));
            return add.length ? [...prev, ...add] : prev;
          });
        }
        if (msgRes.room?.risk_level || insightRes.room_risk_level || msgRes.room?.peer_online !== undefined || msgRes.room?.online_count !== undefined) {
          setActiveRoom((prev) => prev ? {
            ...prev,
            risk_level: (msgRes.room?.risk_level || insightRes.room_risk_level || prev.risk_level) as CollabRoom["risk_level"],
            status: (msgRes.room?.status as CollabRoom["status"]) || prev.status,
            peer_online: msgRes.room?.peer_online ?? prev.peer_online,
            online_count: msgRes.room?.online_count ?? prev.online_count,
            participants: msgRes.room?.participants || prev.participants,
          } : prev);
        }
      } catch {
        /* ignore poll errors */
      }
    };
    pollRef.current = window.setInterval(tick, 2500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
      setActiveId(room.id);
      setSiderTab("chats");
      message.success(`已打开与 ${username} 的对话`);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "打开对话失败");
    } finally {
      setCreating(false);
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
      setActiveId(room.id);
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

  const handleSend = async () => {
    if (!activeId || sending) return;
    if (!draft.trim() && pendingFiles.length === 0) return;
    if (!isParticipant) {
      message.warning("旁观者不能发送消息");
      return;
    }
    if (activeRoom?.status === "closed") {
      message.warning("会话已结束");
      return;
    }
    const content = draft.trim();
    const files = pendingFiles.map((p) => p.file);
    const previews = pendingFiles.map((p) => p.preview);
    setSending(true);
    setDraft("");
    setPendingFiles([]);
    try {
      const res = await sendCollabMessage(activeId, content, true, files.length ? files : undefined);
      setMessages((prev) => {
        const next = [...prev];
        if (!next.some((m) => m.id === res.message.id)) next.push(res.message);
        if (res.ai_message && !next.some((m) => m.id === res.ai_message!.id)) {
          next.push(res.ai_message);
        }
        return next;
      });
      if (res.insight) {
        setInsights((prev) => [...prev, res.insight!]);
      }
      if (res.room) {
        setActiveRoom(res.room);
        setRooms((prev) => prev.map((r) => (r.id === res.room.id ? { ...r, ...res.room } : r)));
      }
      previews.forEach((url) => { if (url) URL.revokeObjectURL(url); });
      setMention(null);
    } catch (e: any) {
      setDraft(content);
      setPendingFiles(files.map((file, i) => ({
        file,
        preview: previews[i],
      })));
      message.error(e?.response?.data?.error || "发送失败");
    } finally {
      setSending(false);
    }
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

  const syncMentionFromCaret = (value: string, caret: number) => {
    const next = detectMentionAt(value, caret);
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

  const handleDeleteRoom = (roomId?: string) => {
    const id = roomId || activeId;
    if (!id) return;
    Modal.confirm({
      title: "删除此会话？",
      content: "将彻底删除该会话及全部聊天记录，所有成员都不可再访问。",
      okText: "删除会话",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          await deleteCollabRoom(id);
          setRooms((prev) => prev.filter((r) => r.id !== id));
          if (activeId === id) {
            setActiveId(null);
            setActiveRoom(null);
            setMessages([]);
            setInsights([]);
          }
          message.success("会话已删除");
        } catch (e: any) {
          message.error(e?.response?.data?.error || "删除失败");
          throw e;
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
      message.success("已重新分析");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "分析失败");
    }
  };

  const applyDraft = (text: string) => {
    if (!text) return;
    setDraft((prev) => (prev.trim() ? `${prev.trim()}\n${text}` : text));
    message.success("已填入输入框，请确认后再发送");
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
    return contacts.filter((c) => c.username.toLowerCase().includes(q));
  }, [contacts, contactKeyword]);

  const memberUsernameSet = useMemo(() => {
    return new Set((activeRoom?.participants || []).map((p) => p.username));
  }, [activeRoom]);

  const inviteCandidateOptions = useMemo(() => {
    return contacts
      .filter((u) => !memberUsernameSet.has(u.username))
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

  const avatarColor = (name: string) => {
    const colors = ["#315efb", "#2f9e6c", "#d48806", "#cf1322", "#531dab", "#08979c"];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * 17) % colors.length;
    return colors[h];
  };

  const AvatarWithPresence = ({
    name,
    online,
    size = 40,
    group = false,
  }: {
    name: string;
    online?: boolean;
    size?: number;
    group?: boolean;
  }) => (
    <span className={`collab-avatar-wrap${online ? " online" : ""}`}>
      <Avatar size={size} style={{ background: avatarColor(name), flexShrink: 0 }}>
        {group ? <TeamOutlined /> : name.slice(0, 1).toUpperCase()}
      </Avatar>
      <i className="collab-online-dot" aria-hidden />
    </span>
  );

  return (
    <div className="collab-page">
      <style>{css}</style>

      <aside className="collab-sider">
        <div className="collab-sider-head">
          <Typography.Text strong>协作风控</Typography.Text>
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
              loadContacts(contactKeyword);
            }}
          >
            通讯录
          </button>
        </div>

        {siderTab === "chats" ? (
          <div className="collab-room-list">
            {rooms.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loadingRooms ? "加载中…" : "暂无会话，去通讯录点人开聊"} />
            ) : rooms.map((room) => {
              const title = roomTitle(room);
              const online = roomPeerOnline(room);
              const canRemove = Boolean(
                me?.is_staff
                || (room.room_kind !== "group" && room.participants.some((p) => p.id === me?.id))
                || (room.room_kind === "group" && room.created_by?.id === me?.id),
              );
              return (
                <div
                  key={room.id}
                  className={`collab-room-item ${activeId === room.id ? "active" : ""} risk-${room.risk_level}`}
                >
                  <button
                    type="button"
                    className="collab-room-main"
                    onClick={() => setActiveId(room.id)}
                  >
                    <AvatarWithPresence
                      name={title}
                      online={online}
                      group={room.room_kind === "group"}
                    />
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
              placeholder="搜索联系人"
              value={contactKeyword}
              onChange={(e) => {
                setContactKeyword(e.target.value);
                loadContacts(e.target.value);
              }}
              style={{ marginBottom: 8 }}
            />
            <div className="collab-room-list">
              {filteredContacts.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无其他账号" />
              ) : filteredContacts.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="collab-contact-item"
                  disabled={creating}
                  onClick={() => openDm(user.username)}
                >
                  <AvatarWithPresence name={user.username} online={Boolean(user.online)} />
                  <div>
                    <strong>{user.username}</strong>
                    <span className={user.online ? "collab-status-on" : "collab-status-off"}>
                      {user.online ? "在线" : "离线"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <section className="collab-main">
        {!activeRoom ? (
          <div className="collab-empty">
            <SafetyCertificateOutlined />
            <Typography.Title level={4}>协作风控台</Typography.Title>
            <Typography.Text type="secondary">
              像微信一样：通讯录点人单聊，或右上角发起群聊。AI 在右侧做风险旁路分析。
            </Typography.Text>
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" onClick={() => setSiderTab("contacts")}>打开通讯录</Button>
              <Button icon={<TeamOutlined />} onClick={() => setGroupOpen(true)}>发起群聊</Button>
            </Space>
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
                <Tag color={RISK_META[activeRoom.risk_level]?.color}>
                  {RISK_META[activeRoom.risk_level]?.label}
                </Tag>
                {activeRoom.room_kind === "group" && (isParticipant || me?.is_staff) ? (
                  <Dropdown
                    trigger={["click"]}
                    placement="bottomRight"
                    menu={{
                      items: [
                        {
                          key: "nicks",
                          icon: <EditOutlined />,
                          label: "修改成员名称",
                          onClick: openNickModal,
                        },
                        activeRoom.status === "open" && isParticipant
                          ? {
                              key: "invite",
                              icon: <UserAddOutlined />,
                              label: "邀请成员",
                              onClick: openInviteModal,
                            }
                          : null,
                        activeRoom.status === "open" && canKickMembers
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
                              label: "删除群聊",
                              danger: true,
                              onClick: () => handleDeleteRoom(),
                            }
                          : null,
                      ].filter(Boolean) as any[],
                    }}
                  >
                    <Tooltip title="群管理">
                      <Button icon={<SettingOutlined />} aria-label="群管理" />
                    </Tooltip>
                  </Dropdown>
                ) : (
                  <>
                    {isParticipant && (
                      <Tooltip title="清空聊天记录">
                        <Button icon={<ClearOutlined />} onClick={handleClearHistory}>
                          清空
                        </Button>
                      </Tooltip>
                    )}
                    {canDeleteRoom && (
                      <Tooltip title="删除会话">
                        <Button danger icon={<DeleteOutlined />} onClick={() => handleDeleteRoom()}>
                          删除
                        </Button>
                      </Tooltip>
                    )}
                    {activeRoom.status === "open" && isParticipant && (
                      <PopConfirmClose onConfirm={handleClose} />
                    )}
                  </>
                )}
                {activeRoom.status === "closed" && <Tag>已结束</Tag>}
              </Space>
            </header>

            {bannerInsight && (bannerInsight.risk_level === "red" || bannerInsight.risk_level === "yellow") && (
              <div className={`collab-banner risk-${bannerInsight.risk_level}`}>
                <AlertOutlined />
                <span>{bannerInsight.title}</span>
                <Typography.Link onClick={() => {
                  const id = bannerInsight.evidence_message_ids?.[0];
                  if (id) setHighlightId(id);
                }}>
                  查看证据
                </Typography.Link>
              </div>
            )}

            <div className="collab-messages">
              {messages.length === 0 ? (
                <div className="collab-empty soft">
                  开始对话吧。输入 @ 可 @所有人 / @成员 / @AI；右侧仍是风控旁路分析。
                </div>
              ) : messages.map((m) => {
                const isAi = m.msg_type === "ai";
                const isSystem = m.msg_type === "system";
                const mine = !isAi && !isSystem && me && m.sender.id === me.id;
                if (isSystem) {
                  return (
                    <div key={m.id} id={`collab-msg-${m.id}`} className="collab-msg system">
                      <div className="collab-system-tip">{m.content}</div>
                    </div>
                  );
                }
                return (
                  <div
                    key={m.id}
                    id={`collab-msg-${m.id}`}
                    className={`collab-msg ${mine ? "mine" : "peer"} ${isAi ? "ai" : ""} ${highlightId === m.id ? "highlight" : ""}`}
                  >
                    <Avatar
                      size={32}
                      icon={isAi ? <RobotOutlined /> : <UserOutlined />}
                      style={{ background: isAi ? "#0f766e" : (mine ? "#315efb" : "#8b9bb4") }}
                    />
                    <div className="collab-bubble">
                      <div className="collab-bubble-meta">
                        <b>{isAi ? "良策AI" : memberLabel(m.sender)}</b>
                        <span>{new Date(m.created_at).toLocaleTimeString("zh-CN")}</span>
                      </div>
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
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            <div className="collab-composer">
              {pendingFiles.length > 0 && (
                <div className="collab-pending-files">
                  {pendingFiles.map((item, idx) => (
                    item.preview ? (
                      <div key={`${item.file.name}-${idx}`} className="collab-pending-image">
                        <img src={item.preview} alt={item.file.name} />
                        <button
                          type="button"
                          aria-label={`移除 ${item.file.name}`}
                          onClick={() => removePendingFile(idx)}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div key={`${item.file.name}-${idx}`} className="collab-pending-file">
                        <FileOutlined />
                        <span>
                          <strong>{item.file.name}</strong>
                          <em>{fmtSize(item.file.size)}</em>
                        </span>
                        <button
                          type="button"
                          aria-label={`移除 ${item.file.name}`}
                          onClick={() => removePendingFile(idx)}
                        >
                          ×
                        </button>
                      </div>
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
              <div className="collab-composer-row">
                <Button
                  icon={<PaperClipOutlined />}
                  disabled={!isParticipant || activeRoom.status === "closed" || sending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  附件
                </Button>
                <div className="collab-composer-input-wrap">
                  {mention && mentionOptions.length > 0 && (
                    <div className="collab-mention-menu" role="listbox">
                      {mentionOptions.map((opt, idx) => (
                        <button
                          key={opt.id}
                          type="button"
                          role="option"
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
                  )}
                  <Input.TextArea
                    ref={composerRef}
                    value={draft}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDraft(value);
                      syncMentionFromCaret(value, e.target.selectionStart ?? value.length);
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
                          : "输入消息，可发附件 / @成员 / @AI · Enter 发送"
                    }
                    autoSize={{ minRows: 2, maxRows: 5 }}
                    disabled={!isParticipant || activeRoom.status === "closed" || sending}
                    onPaste={(e) => {
                      const items = e.clipboardData?.items;
                      if (!items) return;
                      const files: File[] = [];
                      for (let i = 0; i < items.length; i++) {
                        const it = items[i];
                        if (it.type.startsWith("image/")) {
                          const f = it.getAsFile();
                          if (f) files.push(f);
                        }
                      }
                      if (files.length) {
                        e.preventDefault();
                        addFiles(files);
                      }
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
                </div>
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sending}
                  disabled={
                    (!draft.trim() && pendingFiles.length === 0)
                    || !isParticipant
                    || activeRoom.status === "closed"
                  }
                  onClick={handleSend}
                >
                  发送
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <aside className="collab-ai">
        <div className="collab-ai-head">
          <div>
            <Typography.Text strong><SafetyCertificateOutlined /> AI 风险面板</Typography.Text>
            <div className="collab-ai-sub">旁路风控 · 聊天中 @AI 可直接召唤回复</div>
          </div>
          <Tooltip title="重新分析">
            <Button
              type="text"
              icon={<ReloadOutlined />}
              disabled={!activeId}
              onClick={handleRefreshInsight}
            />
          </Tooltip>
        </div>

        {!activeId ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择会话后查看分析" />
        ) : insights.length === 0 ? (
          <div className="collab-hint">发送消息后，AI 将自动进行异常分析、建议与风险管控。</div>
        ) : (
          <div className="collab-insight-list">
            {[...insights].reverse().map((ins) => (
              <article key={ins.id} className={`collab-insight risk-${ins.risk_level}`}>
                <header>
                  <Tag color={RISK_META[ins.risk_level]?.color}>{RISK_META[ins.risk_level]?.label}</Tag>
                  <strong>{ins.title}</strong>
                  <em>{new Date(ins.created_at).toLocaleTimeString("zh-CN")}</em>
                </header>
                {!!ins.tags?.length && (
                  <div className="collab-tags">
                    {ins.tags.map((t) => <Tag key={t}>{t}</Tag>)}
                  </div>
                )}
                {ins.analysis && (
                  <section>
                    <h5>异常分析</h5>
                    <p>{ins.analysis}</p>
                  </section>
                )}
                {ins.advice && (
                  <section>
                    <h5>建议</h5>
                    <p>{ins.advice}</p>
                  </section>
                )}
                {ins.control && (
                  <section>
                    <h5>风险管控</h5>
                    <p>{ins.control}</p>
                  </section>
                )}
                {!!ins.evidence_message_ids?.length && (
                  <div className="collab-evidence">
                    证据消息：
                    {ins.evidence_message_ids.map((mid) => (
                      <button
                        key={mid}
                        type="button"
                        onClick={() => {
                          setHighlightId(mid);
                          document.getElementById(`collab-msg-${mid}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                      >
                        #{mid}
                      </button>
                    ))}
                  </div>
                )}
                {ins.draft_reply && isParticipant && activeRoom?.status === "open" && (
                  <Button size="small" type="primary" ghost block onClick={() => applyDraft(ins.draft_reply)}>
                    采用合规回复草稿
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </aside>

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
              options={contacts.map((u) => ({ value: u.username, label: u.username }))}
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

function PopConfirmClose({ onConfirm }: { onConfirm: () => void }) {
  return (
    <Button
      icon={<StopOutlined />}
      onClick={() => {
        Modal.confirm({
          title: "结束此会话？",
          content: "结束后不可再发消息，AI 会生成最终风控纪要。",
          okText: "结束会话",
          onOk: onConfirm,
        });
      }}
    >
      结束
    </Button>
  );
}

const css = `
.collab-page {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr) 320px;
  height: calc(100vh - 68px);
  min-height: 520px;
  border: 1px solid #e8edf5;
  border-radius: 0;
  overflow: hidden;
  background: #fff;
  box-shadow: none;
}
.collab-sider, .collab-ai {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fbfcfe;
}
.collab-sider { border-right: 1px solid #e8edf5; }
.collab-ai { border-left: 1px solid #e8edf5; }
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
  overflow: auto;
  padding: 10px;
}
.collab-contact-pane .collab-room-list { padding: 0 0 10px; }
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
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
  max-width: 88%;
}
.collab-msg.mine { margin-left: auto; flex-direction: row-reverse; }
.collab-bubble {
  background: #f5f7fb;
  border-radius: 14px;
  padding: 10px 12px;
  border: 1px solid #e8edf5;
}
.collab-msg.mine .collab-bubble {
  background: #edf3ff;
  border-color: #d6e4ff;
}
.collab-msg.highlight .collab-bubble {
  outline: 2px solid #faad14;
}
.collab-bubble-meta {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 4px;
  font-size: 11px;
  color: #8b96a8;
}
.collab-bubble-meta b { color: #31405b; font-size: 12px; }
.collab-bubble p { margin: 0; white-space: pre-wrap; line-height: 1.55; color: #172033; font-size: 14px; }
.collab-md {
  color: #172033;
  font-size: 14px;
  line-height: 1.55;
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
  margin: 10px 0 6px;
}
.collab-md .agent-md-h1:first-child,
.collab-md .agent-md-h2:first-child,
.collab-md .agent-md-h3:first-child,
.collab-md .agent-md-h4:first-child { margin-top: 0; }
.collab-composer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-top: 1px solid #e8edf5;
  background: #fbfcfe;
}
.collab-composer-row {
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.collab-composer-row .ant-input-textarea {
  flex: 1;
}
.collab-composer-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.collab-mention-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 6px);
  z-index: 20;
  max-height: 240px;
  overflow: auto;
  background: #fff;
  border: 1px solid #dbe3f0;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(23, 32, 51, .12);
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
  background: #f5f8ff;
  color: #7b879c;
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

@media (max-width: 1100px) {
  .collab-page {
    grid-template-columns: 1fr;
    height: auto;
  }
  .collab-sider, .collab-ai { max-height: 280px; }
  .collab-main { min-height: 520px; }
}
`;
