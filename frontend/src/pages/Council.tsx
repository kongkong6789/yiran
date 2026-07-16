import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Avatar, Button, Card, Col, DatePicker, Empty, Input, InputNumber, message,
  Modal, Row, Segmented, Space, Tag, Tooltip, Typography,
} from "antd";
import {
  ArrowLeftOutlined, AudioMutedOutlined, DesktopOutlined,
  DownloadOutlined, EyeOutlined, FileExcelOutlined, FileTextOutlined,
  FullscreenOutlined, Html5Outlined, PauseCircleOutlined, PhoneOutlined,
  PlayCircleOutlined, PlusOutlined, RobotOutlined, TeamOutlined, UserOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { useSearchParams } from "react-router-dom";
import RoundTable from "../components/RoundTable";
import { brand } from "../theme/brand";
import {
  listAgents, listMeetings, createMeeting, getMeeting, interject, openCouncilMeetingSocket, pollMessages,
  stopMeeting, startMeeting, pauseMeeting, pauseActiveMeetings, downloadDeliverable,
  listCollabUsers, getAuthToken, getMe,
  type Agent, type CouncilMessage, type Meeting, type Deliverable,
  type CollabUserBrief, type AuthUser,
} from "../api/client";

const KIND_META: Record<Deliverable["kind"], { label: string; color: string; icon: ReactNode }> = {
  md: { label: "Markdown 方案", color: "gold", icon: <FileTextOutlined /> },
  html: { label: "HTML 分析报告", color: "geekblue", icon: <Html5Outlined /> },
  xlsx: { label: "Excel 指标表", color: "green", icon: <FileExcelOutlined /> },
};

const MONITOR_RULES = [
  "敏感内容与违规承诺",
  "偏离会议目标",
  "情绪异常 / 对立升级",
  "低效空转讨论",
  "关键成员长时间沉默",
];

type Phase = "setup" | "lobby" | "live";
type SetupView = "list" | "create";
type ListFilter = "all" | "active" | "paused" | "draft" | "stopped";

const STATUS_META: Record<Meeting["status"], { label: string; color: string }> = {
  draft: { label: "待开始", color: "gold" },
  active: { label: "进行中", color: "processing" },
  paused: { label: "已暂停", color: "orange" },
  stopped: { label: "已结束", color: "default" },
};

function userLabel(u: CollabUserBrief) {
  return u.display_name || u.nickname || u.username;
}

function avatarSrc(url?: string | null) {
  if (!url) return undefined;
  const token = getAuthToken();
  if (!token) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

function buildAgenda(question: string, intro?: string) {
  const topic = (question || intro || "本次议题").slice(0, 28);
  return [
    { id: 1, title: "开场与目标对齐", done: true },
    { id: 2, title: `讨论：${topic}`, current: true },
    { id: 3, title: "风险与约束梳理", done: false },
    { id: 4, title: "行动项与负责人", done: false },
    { id: 5, title: "总结与产物确认", done: false },
  ];
}

export default function Council() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("setup");
  const [setupView, setSetupView] = useState<SetupView>("list");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [listQuery, setListQuery] = useState("");
  const [pausing, setPausing] = useState(false);
  const [me, setMe] = useState<AuthUser | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [users, setUsers] = useState<CollabUserBrief[]>([]);
  const [history, setHistory] = useState<Meeting[]>([]);

  const [title, setTitle] = useState("");
  const [intro, setIntro] = useState("");
  const [scheduledAt, setScheduledAt] = useState<Dayjs | null>(dayjs().add(30, "minute"));
  const [duration, setDuration] = useState(60);
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [selectedAgents, setSelectedAgents] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [messages, setMessages] = useState<CouncilMessage[]>([]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [finishing, setFinishing] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [previewItem, setPreviewItem] = useState<Deliverable | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const elapsedTimer = useRef<number | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<any>(null);
  const meetingRef = useRef<Meeting | null>(null);
  meetingRef.current = meeting;

  const loadLists = useCallback(() => {
    listAgents().then((d) => {
      setAgents(d.results);
      setSelectedAgents((prev) => (prev.length ? prev : d.results.slice(0, Math.min(3, d.results.length)).map((a) => a.id)));
    }).catch(() => {});
    listCollabUsers().then((d) => setUsers(d.results)).catch(() => {});
    listMeetings().then((d) => setHistory(d.results)).catch(() => {});
  }, []);

  useEffect(() => {
    getMe().then((r) => setMe(r.user)).catch(() => setMe(null));
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const appendMsg = (m: CouncilMessage) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    if (m.speaker_type === "agent" && m.agent_id) setActiveAgentId(m.agent_id);
  };

  const openMeeting = async (id: number, nextPhase?: Phase) => {
    const detail = await getMeeting(id);
    setMeeting(detail.meeting);
    setMessages(detail.messages);
    setDeliverables(detail.deliverables || []);
    if (nextPhase) {
      setPhase(nextPhase);
    } else if (detail.meeting.status === "draft") {
      setPhase("lobby");
    } else if (detail.meeting.status === "active") {
      setPhase("live");
    } else if (detail.meeting.status === "paused") {
      setPhase("live");
    } else {
      setPhase("live");
    }
  };

  // 从邀请弹窗跳转：/council?meeting=123
  useEffect(() => {
    const raw = searchParams.get("meeting");
    if (!raw) return;
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0) return;
    let cancelled = false;
    openMeeting(id, "live")
      .then(() => {
        if (cancelled) return;
        const next = new URLSearchParams(searchParams);
        next.delete("meeting");
        setSearchParams(next, { replace: true });
      })
      .catch(() => {
        if (!cancelled) message.error("无法进入会议");
      });
    return () => { cancelled = true; };
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (phase !== "live" || meeting?.status !== "active") {
      if (elapsedTimer.current) window.clearInterval(elapsedTimer.current);
      return;
    }
    const start = meeting.started_at ? dayjs(meeting.started_at).valueOf() : Date.now();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    elapsedTimer.current = window.setInterval(tick, 1000);
    return () => {
      if (elapsedTimer.current) window.clearInterval(elapsedTimer.current);
    };
  }, [phase, meeting?.status, meeting?.started_at]);

  // 多人即时通信：WebSocket 为主 + 短轮询兜底（代理/断线时仍能收到）
  useEffect(() => {
    if (phase !== "live" || !meeting?.id) return;
    if (meeting.status === "stopped") return;

    let stopped = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let pollTimer: number | null = null;
    let wsAlive = false;
    const messagesRef = { current: [] as CouncilMessage[] };

    const applyPayload = (data: { status?: string; round?: number; results?: CouncilMessage[] }) => {
      if (data.results?.length) {
        setMessages((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          const add = data.results!.filter((x) => x.id > 0 && !seen.has(x.id));
          if (!add.length) return prev;
          const last = add[add.length - 1];
          if (last.speaker_type === "agent" && last.agent_id) {
            setActiveAgentId(last.agent_id);
          }
          const next = [...prev, ...add];
          messagesRef.current = next;
          return next;
        });
      }
      if (data.status != null || data.round != null) {
        setMeeting((prev) => {
          if (!prev) return prev;
          const nextStatus = (data.status as Meeting["status"] | undefined) || prev.status;
          const nextRound = data.round != null ? data.round : prev.round;
          if (prev.status === nextStatus && prev.round === nextRound) return prev;
          return { ...prev, status: nextStatus, round: nextRound };
        });
      }
    };

    const pollOnce = async () => {
      const m = meetingRef.current;
      if (!m?.id || stopped) return;
      // WebSocket 正常时降低频率：仍偶发补洞，避免完全丢消息
      const after = messagesRef.current.reduce(
        (max, x) => (x.id > 0 && x.id > max ? x.id : max),
        0,
      );
      try {
        const res = await pollMessages(m.id, after);
        if (stopped) return;
        if (res.results?.length) {
          applyPayload({ status: res.status, round: res.round, results: res.results });
        } else if (res.status || res.round != null) {
          applyPayload({ status: res.status, round: res.round });
        }
      } catch {
        /* ignore */
      }
    };

    const connect = () => {
      if (stopped || !meetingRef.current?.id) return;
      try { ws?.close(); } catch { /* ignore */ }
      ws = openCouncilMeetingSocket(meetingRef.current.id, {
        onOpen: () => { wsAlive = true; },
        onMessages: applyPayload,
        onStatus: applyPayload,
        onClose: (ev) => {
          wsAlive = false;
          if (stopped) return;
          // 鉴权失败别狂重连
          if (ev.code === 4401 || ev.code === 4404) return;
          if (reconnectTimer) window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(connect, 1500);
        },
        onError: () => {
          wsAlive = false;
        },
      });
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ }
        }
      }, 25000);
    };

    // 同步当前消息游标
    setMessages((prev) => {
      messagesRef.current = prev;
      return prev;
    });

    connect();
    void pollOnce();
    // 2s 轮询兜底：WS 断了或不通时仍能收到对方消息
    pollTimer = window.setInterval(() => { void pollOnce(); }, 2000);

    return () => {
      stopped = true;
      wsAlive = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      if (pollTimer) window.clearInterval(pollTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [phase, meeting?.id]);

  const create = async (startNow: boolean) => {
    if (!title.trim() && !intro.trim()) return message.warning("请填写会议标题或简介");
    if (selectedAgents.length < 1) return message.warning("请至少选择 1 个 AI 对象");
    setSaving(true);
    message.loading({ content: "正在创建会议…", key: "council-create", duration: 0 });
    try {
      const res = await createMeeting({
        title: title.trim() || intro.trim().slice(0, 30),
        intro: intro.trim(),
        question: intro.trim() || title.trim(),
        agent_ids: selectedAgents,
        user_ids: selectedUsers,
        scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
        duration_minutes: duration,
        start_now: startNow,
      });
      // 用创建结果直接进会，避免再等一轮详情/图谱查询
      setMeeting(res.meeting);
      setMessages(res.messages || []);
      setDeliverables([]);
      setPreviewItem(null);
      setElapsed(0);
      setPhase(startNow ? "live" : "lobby");
      setSetupView("list");
      message.success({
        key: "council-create",
        content: startNow ? "会议已开始" : "草稿已保存，可在大厅开始",
      });
      loadLists();
    } catch (e: any) {
      message.error({ key: "council-create", content: e?.response?.data?.error || "创建失败" });
    } finally {
      setSaving(false);
    }
  };

  const beginFromLobby = async () => {
    if (!meeting) return;
    setSaving(true);
    try {
      const res = await startMeeting(meeting.id);
      setMeeting(res.meeting);
      if (res.message) appendMsg(res.message);
      setPhase("live");
      message.success("会议已开始");
    } catch (e: any) {
      message.error(e?.response?.data?.error || "开始失败");
    } finally {
      setSaving(false);
    }
  };

  const sendChat = async () => {
    if (!meeting || !draft.trim()) return;
    if (meeting.status !== "active") {
      message.warning(meeting.status === "paused" ? "请先恢复会议再发言" : "会议未在进行中");
      return;
    }
    const text = draft.trim();
    const needsReply = meeting.participants.some((a) => text.includes(`@${a.name}`))
      || /@(?:所有人|全体|全体成员|everyone|all)\b/i.test(text);
    setDraft("");

    // 先上屏，发送不再干等
    const tempId = -Date.now();
    const optimistic: CouncilMessage = {
      id: tempId,
      speaker_type: "user",
      speaker_name: me?.display_name || me?.username || "我",
      emoji: "🧑",
      agent_id: null,
      content: text,
      round: meeting.round,
      created_at: new Date().toISOString(),
    };
    appendMsg(optimistic);

    try {
      if (needsReply) message.loading({ content: "Agent 回复中…", key: "council-at", duration: 0 });
      const res = await interject(meeting.id, text);
      setMessages((prev) => prev.filter((x) => x.id !== tempId));
      appendMsg(res.message);
      (res.replies || []).forEach(appendMsg);
      if (needsReply && !(res.replies || []).length) {
        message.info({ key: "council-at", content: "未匹配到参会 Agent，可点上方胶囊 @ 点名" });
      } else if (needsReply) {
        message.destroy("council-at");
      }
    } catch (e: any) {
      setMessages((prev) => prev.filter((x) => x.id !== tempId));
      message.error({ key: "council-at", content: e?.response?.data?.error || "发送失败" });
      setDraft(text);
    }
  };

  const finish = async () => {
    if (!meeting || finishing) return;
    setFinishing(true);
    message.loading({ content: "正在生成会议产物…", key: "stop", duration: 0 });
    try {
      const res = await stopMeeting(meeting.id);
      setDeliverables(res.deliverables || []);
      setMeeting({ ...meeting, status: "stopped" });
      if (res.deliverables?.length) setPreviewItem(res.deliverables[0]);
      message.success({ key: "stop", content: "会议已结束，产物已生成" });
      loadLists();
      // 结束后可继续查看本场；也可点「返回列表」看全部记录
    } catch (e: any) {
      message.error({ key: "stop", content: e?.response?.data?.error || "结束失败" });
    } finally {
      setFinishing(false);
    }
  };

  const backToSetup = () => {
    setPhase("setup");
    setSetupView("list");
    setMeeting(null);
    setMessages([]);
    setDeliverables([]);
    setPreviewItem(null);
    setElapsed(0);
    loadLists();
  };

  const downloadFile = async (item: Deliverable) => {
    if (!meeting) return;
    try {
      const blob = await downloadDeliverable(meeting.id, item.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.filename || `deliverable.${item.kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error("下载失败");
    }
  };

  const filteredUsers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const label = userLabel(u).toLowerCase();
      return label.includes(q) || u.username.toLowerCase().includes(q);
    });
  }, [users, memberQuery]);

  const filteredAgents = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const blob = `${a.name} ${a.role || ""} ${a.expertise || ""} ${a.group || ""}`.toLowerCase();
      return blob.includes(q);
    });
  }, [agents, memberQuery]);

  const selectedUserObjs = users.filter((u) => selectedUsers.includes(u.id));
  const selectedAgentObjs = agents.filter((a) => selectedAgents.includes(a.id));
  const pickCount = filteredUsers.length + filteredAgents.length;
  const selectedCount = selectedUserObjs.length + selectedAgentObjs.length;
  const hostName = me?.display_name || me?.username || "";

  const filteredMeetings = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return history.filter((h) => {
      if (listFilter === "active" && h.status !== "active") return false;
      if (listFilter === "paused" && h.status !== "paused") return false;
      if (listFilter === "draft" && h.status !== "draft") return false;
      if (listFilter === "stopped" && h.status !== "stopped") return false;
      if (!q) return true;
      const blob = `${h.title} ${h.question} ${h.intro || ""} ${(h.agent_names || []).join(" ")} ${(h.human_names || []).join(" ")}`.toLowerCase();
      return blob.includes(q);
    });
  }, [history, listFilter, listQuery]);

  const listCounts = useMemo(() => ({
    all: history.length,
    active: history.filter((h) => h.status === "active").length,
    paused: history.filter((h) => h.status === "paused").length,
    draft: history.filter((h) => h.status === "draft").length,
    stopped: history.filter((h) => h.status === "stopped").length,
  }), [history]);

  const enterMeetingLabel = (status: Meeting["status"]) => {
    if (status === "active") return "进入会议";
    if (status === "paused") return "恢复进入";
    if (status === "draft") return "进入大厅";
    return "查看记录";
  };

  const pauseOne = async (id: number) => {
    try {
      await pauseMeeting(id);
      message.success("已暂停");
      loadLists();
      if (meetingRef.current?.id === id) {
        setMeeting((m) => (m ? { ...m, status: "paused" } : m));
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || "暂停失败");
    }
  };

  const resumeOne = async (id: number) => {
    try {
      const res = await startMeeting(id);
      message.success("已恢复");
      await openMeeting(id, "live");
      if (res.message) appendMsg(res.message);
    } catch (e: any) {
      message.error(e?.response?.data?.error || "恢复失败");
    }
  };

  const pauseAllActive = async () => {
    if (listCounts.active < 1) return message.info("当前没有进行中的会议");
    setPausing(true);
    try {
      const res = await pauseActiveMeetings();
      message.success(`已暂停 ${res.paused_count} 场会议`);
      if (meetingRef.current?.status === "active") {
        setMeeting((m) => (m ? { ...m, status: "paused" } : m));
      }
      loadLists();
    } catch (e: any) {
      message.error(e?.response?.data?.error || "批量暂停失败");
    } finally {
      setPausing(false);
    }
  };

  const insertMention = (name: string) => {
    const token = `@${name} `;
    setDraft((prev) => {
      const base = prev.trimEnd();
      if (!base) return token;
      if (base.includes(`@${name}`)) return `${base} `;
      return `${base} ${token}`;
    });
    setMention(null);
  };

  const insertAgentMention = (a: Agent) => insertMention(a.name);

  const syncMentionFromCaret = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) {
      setMention(null);
      return;
    }
    setMention({
      start: caret - (m[0]?.length || 0),
      end: caret,
      query: m[1] || "",
    });
    setMentionIndex(0);
  };

  const applyMentionOption = (opt: { insert: string }) => {
    if (!mention) {
      setDraft((prev) => `${prev.trimEnd()} ${opt.insert}`.trimStart());
      return;
    }
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

  const fmtElapsed = (s: number) => {
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${sec}`;
  };

  // ---------- 列表 / 创建 ----------
  if (phase === "setup") {
    if (setupView === "list") {
      return (
        <div className="council-page">
          <header className="council-hero council-hero-row">
            <div>
              <Typography.Title level={3} style={{ margin: 0 }}>圆桌会议</Typography.Title>
              <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
                所有人开过的会议都会留在这里，退出后也可随时再进入。
              </Typography.Paragraph>
            </div>
            <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setSetupView("create")}>
              新建会议
            </Button>
          </header>

          <Card size="small" className="council-card" style={{ marginTop: 14 }}>
            <div className="council-list-toolbar">
              <Segmented
                value={listFilter}
                onChange={(v) => setListFilter(v as ListFilter)}
                options={[
                  { label: `全部 ${listCounts.all}`, value: "all" },
                  { label: `进行中 ${listCounts.active}`, value: "active" },
                  { label: `已暂停 ${listCounts.paused}`, value: "paused" },
                  { label: `待开始 ${listCounts.draft}`, value: "draft" },
                  { label: `已结束 ${listCounts.stopped}`, value: "stopped" },
                ]}
              />
              <Space wrap>
                <Input
                  allowClear
                  placeholder="搜索标题、议题、成员"
                  value={listQuery}
                  onChange={(e) => setListQuery(e.target.value)}
                  style={{ width: 220 }}
                  prefix={<TeamOutlined />}
                />
                <Button onClick={() => loadLists()}>刷新</Button>
                <Button
                  icon={<PauseCircleOutlined />}
                  loading={pausing}
                  disabled={listCounts.active < 1}
                  onClick={pauseAllActive}
                >
                  暂停全部进行中
                </Button>
              </Space>
            </div>

            {filteredMeetings.length === 0 ? (
              <Empty
                style={{ padding: "48px 0" }}
                description={history.length === 0 ? "还没有会议，点击右上角新建" : "没有符合筛选的会议"}
              >
                {history.length === 0 ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setSetupView("create")}>
                    新建会议
                  </Button>
                ) : null}
              </Empty>
            ) : (
              <div className="council-meeting-list">
                {filteredMeetings.map((h) => {
                  const meta = STATUS_META[h.status] || STATUS_META.stopped;
                  const humans = h.human_names || [];
                  const agents = h.agent_names || [];
                  const when = h.started_at || h.scheduled_at || h.created_at;
                  return (
                    <div key={h.id} className="council-meeting-row">
                      <div className="council-meeting-main">
                        <div className="council-meeting-title-row">
                          <b>{h.title || h.question}</b>
                          <Tag color={meta.color}>{meta.label}</Tag>
                          {h.has_deliverable ? <Tag color="green">有产物</Tag> : null}
                        </div>
                        <div className="council-meeting-sub">
                          {h.intro || h.question || "无简介"}
                        </div>
                        <div className="council-meeting-meta">
                          <span>{dayjs(when).format("YYYY-MM-DD HH:mm")}</span>
                          <span>发言 {h.message_count ?? 0} 条</span>
                          <span>
                            Agent {h.agent_count ?? agents.length} · 同事 {h.human_count ?? humans.length}
                          </span>
                          {(humans.length > 0 || agents.length > 0) && (
                            <span>
                              {humans.slice(0, 3).join("、")}
                              {humans.length > 3 ? "…" : ""}
                              {humans.length && agents.length ? " · " : ""}
                              {agents.slice(0, 3).join("、")}
                              {agents.length > 3 ? "…" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <Space wrap>
                        {h.status === "active" ? (
                          <Button icon={<PauseCircleOutlined />} onClick={() => pauseOne(h.id)}>
                            暂停
                          </Button>
                        ) : null}
                        {h.status === "paused" ? (
                          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => resumeOne(h.id)}>
                            恢复
                          </Button>
                        ) : (
                          <Button
                            type={h.status === "stopped" ? "default" : "primary"}
                            onClick={() => {
                              if (h.status === "paused") {
                                resumeOne(h.id).catch(() => {});
                                return;
                              }
                              openMeeting(h.id).catch(() => message.error("加载失败"));
                            }}
                          >
                            {enterMeetingLabel(h.status)}
                          </Button>
                        )}
                      </Space>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
          <CouncilStyles />
        </div>
      );
    }

    return (
      <div className="council-page council-create">
        <button
          type="button"
          className="council-back-link"
          onClick={() => { setSetupView("list"); loadLists(); }}
        >
          <ArrowLeftOutlined /> 返回会议列表
        </button>

        <div className="council-create-shell">
          <aside className="council-create-aside">
            <p className="council-create-kicker">NEW MEETING</p>
            <h1 className="council-create-title">新建圆桌</h1>
            <p className="council-create-lead">
              写清议题，点选同事与 Agent。创建后会出现在列表里，随时再进。
            </p>

            <label className="council-field">
              <span>会议标题</span>
              <Input
                maxLength={50}
                showCount
                size="large"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：Q3 产品规划圆桌"
              />
            </label>

            <label className="council-field">
              <span>会议简介（可选）</span>
              <Input.TextArea
                maxLength={200}
                showCount
                rows={4}
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                placeholder="背景、目标或核心问题，Agent 将围绕它讨论"
              />
            </label>

            <div className="council-field-row">
              <label className="council-field">
                <span>会议时间</span>
                <DatePicker
                  showTime
                  size="large"
                  style={{ width: "100%" }}
                  value={scheduledAt}
                  onChange={(v) => setScheduledAt(v)}
                />
              </label>
              <label className="council-field">
                <span>时长（分钟）</span>
                <InputNumber
                  min={15}
                  max={480}
                  step={15}
                  size="large"
                  style={{ width: "100%" }}
                  value={duration}
                  onChange={(v) => setDuration(Number(v) || 60)}
                />
              </label>
            </div>

            <div className="council-create-actions">
              <Button type="primary" size="large" loading={saving} onClick={() => create(true)} block>
                创建并开始
              </Button>
              <div className="council-create-actions-row">
                <Button size="large" loading={saving} onClick={() => create(false)}>
                  保存草稿
                </Button>
                <Button size="large" onClick={() => setSetupView("list")}>
                  取消
                </Button>
              </div>
            </div>
          </aside>

          <section className="council-create-members">
            <div className="council-create-members-head">
              <div>
                <h2>参会成员</h2>
                <p>至少选 1 个 Agent · 已选 {selectedCount}（Agent {selectedAgentObjs.length}）</p>
              </div>
              {selectedCount > 0 ? (
                <Button
                  type="link"
                  onClick={() => {
                    setSelectedUsers([]);
                    setSelectedAgents([]);
                  }}
                >
                  清空
                </Button>
              ) : null}
            </div>

            {selectedCount > 0 ? (
              <div className="council-selected-strip">
                {selectedAgentObjs.map((a) => (
                  <button
                    key={`sa-${a.id}`}
                    type="button"
                    className="council-selected-chip is-agent"
                    onClick={() => setSelectedAgents((p) => p.filter((id) => id !== a.id))}
                    title="点击移除"
                  >
                    <i>{a.emoji}</i>
                    {a.name}
                    <span>×</span>
                  </button>
                ))}
                {selectedUserObjs.map((u) => (
                  <button
                    key={`su-${u.id}`}
                    type="button"
                    className="council-selected-chip"
                    onClick={() => setSelectedUsers((p) => p.filter((id) => id !== u.id))}
                    title="点击移除"
                  >
                    <i className="council-face-sm">
                      {avatarSrc(u.avatar_url) ? (
                        <img src={avatarSrc(u.avatar_url)} alt="" />
                      ) : (
                        userLabel(u)[0]?.toUpperCase()
                      )}
                    </i>
                    {userLabel(u)}
                    <span>×</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="council-selected-empty">点右侧卡片加入圆桌</div>
            )}

            <Input
              allowClear
              size="large"
              className="council-member-search"
              placeholder="搜索同事或 Agent"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              prefix={<TeamOutlined />}
            />

            {agents.length === 0 ? (
              <p className="council-create-hint">还没有 Agent，请到「管理 → 对象」创建。</p>
            ) : null}

            <div className="council-member-grid">
              {pickCount === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的成员" />
              ) : (
                <>
                  {filteredAgents.map((a) => {
                    const on = selectedAgents.includes(a.id);
                    return (
                      <button
                        key={`a-${a.id}`}
                        type="button"
                        className={`council-member-tile is-agent${on ? " is-on" : ""}`}
                        onClick={() => {
                          setSelectedAgents((prev) =>
                            on ? prev.filter((id) => id !== a.id) : [...prev, a.id],
                          );
                        }}
                      >
                        <span className="council-face">{a.emoji}</span>
                        <span className="council-member-tile-text">
                          <b>{a.name}</b>
                          <em>{a.role || a.expertise || "AI 顾问"}</em>
                        </span>
                        <span className="council-member-badge">Agent</span>
                      </button>
                    );
                  })}
                  {filteredUsers.map((u) => {
                    const on = selectedUsers.includes(u.id);
                    return (
                      <button
                        key={`u-${u.id}`}
                        type="button"
                        className={`council-member-tile${on ? " is-on" : ""}`}
                        onClick={() => {
                          setSelectedUsers((prev) =>
                            on ? prev.filter((id) => id !== u.id) : [...prev, u.id],
                          );
                        }}
                      >
                        <span className="council-face is-human">
                          {avatarSrc(u.avatar_url) ? (
                            <img src={avatarSrc(u.avatar_url)} alt="" />
                          ) : (
                            userLabel(u)[0]?.toUpperCase()
                          )}
                        </span>
                        <span className="council-member-tile-text">
                          <b>{userLabel(u)}</b>
                          <em>{u.online ? "在线" : "离线"}</em>
                        </span>
                        <span className="council-member-badge is-human">同事</span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </section>
        </div>
        <CouncilStyles />
      </div>
    );
  }

  // ---------- 待开始大厅 ----------
  if (phase === "lobby" && meeting) {
    const humans = meeting.human_participants || [];
    return (
      <div className="council-page">
        <Button icon={<ArrowLeftOutlined />} onClick={backToSetup} style={{ marginBottom: 12 }}>
          返回会议列表
        </Button>
        <header className="council-hero">
          <Typography.Title level={3} style={{ margin: 0 }}>会议室（未开始）</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
            可在此确认成员与 Agent，准备就绪后开始会议。
          </Typography.Paragraph>
        </header>
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={16}>
            <Card size="small" title="会议概览" className="council-card">
              <DescriptionsLite
                items={[
                  { label: "标题", value: meeting.title },
                  { label: "时间", value: meeting.scheduled_at ? dayjs(meeting.scheduled_at).format("YYYY-MM-DD HH:mm") : "待定" },
                  { label: "时长", value: `${meeting.duration_minutes || 60} 分钟` },
                  { label: "成员", value: `${humans.length} 人` },
                  { label: "Agent", value: `${meeting.participants.length} 个` },
                ]}
              />
              {meeting.intro || meeting.question ? (
                <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
                  {meeting.intro || meeting.question}
                </Typography.Paragraph>
              ) : null}
            </Card>
            <Card size="small" title="参会同事" className="council-card" style={{ marginTop: 14 }}>
              <Space wrap>
                {humans.map((h) => (
                  <Tag key={h.id} icon={<Avatar size={16} src={avatarSrc(h.avatar_url)} />}>
                    {h.display_name || h.username}
                  </Tag>
                ))}
                {humans.length === 0 ? <Typography.Text type="secondary">暂无同事（发起人会自动加入）</Typography.Text> : null}
              </Space>
            </Card>
            <Card size="small" title="Agent 配置" className="council-card" style={{ marginTop: 14 }}>
              <Space wrap>
                {meeting.participants.map((a) => (
                  <Tag key={a.id} color="gold">{a.emoji} {a.name} · 已启用</Tag>
                ))}
              </Space>
            </Card>
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" size="large" loading={saving} onClick={beginFromLobby}>
                开始会议
              </Button>
              <Button size="large" onClick={backToSetup}>取消会议</Button>
            </Space>
          </Col>
          <Col xs={24} lg={8}>
            <Card size="small" title="Agent 监控规则" className="council-card">
              <ul className="council-rules">
                {MONITOR_RULES.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </Card>
          </Col>
        </Row>
        <CouncilStyles />
      </div>
    );
  }

  // ---------- 开会中 ----------
  if (!meeting) return null;
  const humansOnTable = (meeting.human_participants || []).map((h) => ({
    ...h,
    avatar_url: avatarSrc(h.avatar_url),
  }));
  // 主持人始终入座（即使创建时未勾选自己）
  if (me && !humansOnTable.some((h) => h.id === me.id)) {
    humansOnTable.unshift({
      id: me.id,
      username: me.username,
      display_name: hostName || me.username,
      avatar_url: avatarSrc(me.avatar_url),
      kind: "human",
    });
  }
  const agenda = buildAgenda(meeting.question, meeting.intro);
  const memberCount = humansOnTable.length + meeting.participants.length;
  const mentionNames = Array.from(new Set([
    "所有人", "全体", "全体成员",
    ...humansOnTable.map((h) => h.display_name || h.username).filter(Boolean),
    ...humansOnTable.map((h) => h.username).filter(Boolean),
    ...meeting.participants.map((a) => a.name),
  ]));
  const mentionOptions = (() => {
    if (!mention) return [] as { id: string; insert: string; label: string; desc: string; kind: "all" | "human" | "agent" }[];
    const q = mention.query.trim().toLowerCase();
    const opts: { id: string; insert: string; label: string; desc: string; kind: "all" | "human" | "agent" }[] = [
      { id: "all", insert: "@所有人 ", label: "所有人", desc: "提醒全体参会同事与 Agent", kind: "all" },
    ];
    for (const h of humansOnTable) {
      const label = h.display_name || h.username;
      opts.push({
        id: `h-${h.id}`,
        insert: `@${label} `,
        label,
        desc: h.username !== label ? `@${h.username}` : "参会同事",
        kind: "human",
      });
    }
    for (const a of meeting.participants) {
      opts.push({
        id: `a-${a.id}`,
        insert: `@${a.name} `,
        label: a.name,
        desc: a.role || "Agent",
        kind: "agent",
      });
    }
    if (!q) return opts;
    return opts.filter((o) =>
      o.label.toLowerCase().includes(q)
      || o.desc.toLowerCase().includes(q)
      || o.insert.toLowerCase().includes(q),
    );
  })();

  return (
    <div className="council-live">
      <div className="council-live-left">
        <Card size="small" className="council-card" title="会议信息">
          <Space direction="vertical" size={6} style={{ width: "100%" }}>
            <Typography.Text strong>{meeting.title}</Typography.Text>
            <Tag color={meeting.status === "active" ? "success" : "default"}>
              {meeting.status === "active" ? "进行中" : meeting.status === "stopped" ? "已结束" : meeting.status}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {meeting.scheduled_at
                ? dayjs(meeting.scheduled_at).format("YYYY-MM-DD HH:mm")
                : dayjs(meeting.created_at).format("YYYY-MM-DD HH:mm")}
              {" · "}预计 {meeting.duration_minutes || 60} 分钟
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              参会 {memberCount} 人（同事 {humansOnTable.length} · AI {meeting.participants.length}）
            </Typography.Text>
          </Space>
        </Card>

        <Card size="small" className="council-card" title="参会人员" style={{ marginTop: 12, flex: 1 }}>
          <div className="council-live-members">
            {humansOnTable.map((h) => (
              <div key={`h-${h.id}`} className="council-live-member">
                <Avatar size={32} src={h.avatar_url || undefined}>{h.display_name?.[0]}</Avatar>
                <span>
                  <b>{h.display_name || h.username}</b>
                  <em>同事{hostName && (h.display_name === hostName || h.username === me?.username) ? " · 主持人" : ""}</em>
                </span>
              </div>
            ))}
            {meeting.participants.map((a) => (
              <div
                key={`a-${a.id}`}
                className={`council-live-member${activeAgentId === a.id ? " is-talking" : ""}`}
              >
                <Avatar size={32}>{a.emoji}</Avatar>
                <span>
                  <b>{a.name}</b>
                  <em>{a.role || "AI"}{activeAgentId === a.id ? " · 发言中" : ""}</em>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="council-live-center">
        <div className="council-live-topbar">
          <Space>
            <TeamOutlined />
            <Typography.Text strong>{meeting.title}</Typography.Text>
            {meeting.status === "active" ? <Tag color="red">讨论中</Tag> : null}
          </Space>
          <Space>
            <Typography.Text type="secondary">{fmtElapsed(elapsed)}</Typography.Text>
            <Tooltip title="示意控件"><Button size="small" icon={<FullscreenOutlined />} /></Tooltip>
          </Space>
        </div>

        <div className="council-live-stage">
          <RoundTable
            question={meeting.question || meeting.intro || meeting.title}
            agents={meeting.participants}
            humans={humansOnTable}
            activeAgentId={activeAgentId}
            hostName={hostName}
            size={Math.min(400, typeof window !== "undefined" ? window.innerWidth * 0.3 : 380)}
          />
        </div>

        <div className="council-live-controls">
          <Space wrap>
            <Button icon={<AudioMutedOutlined />} disabled>静音</Button>
            <Button icon={<VideoCameraOutlined />} disabled>视频</Button>
            <Button icon={<DesktopOutlined />} disabled>共享</Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Agent 默认不发言，需 @ 点名才会回复
            </Typography.Text>
            {meeting.status === "active" && (
              <Button
                icon={<PauseCircleOutlined />}
                onClick={async () => {
                  try {
                    const res = await pauseMeeting(meeting.id);
                    setMeeting(res.meeting);
                    if (res.message) appendMsg(res.message);
                    loadLists();
                    message.success("会议已暂停");
                  } catch (e: any) {
                    message.error(e?.response?.data?.error || "暂停失败");
                  }
                }}
              >
                暂停会议
              </Button>
            )}
            {meeting.status === "paused" && (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={async () => {
                  try {
                    const res = await startMeeting(meeting.id);
                    setMeeting(res.meeting);
                    if (res.message) appendMsg(res.message);
                    loadLists();
                    message.success("会议已恢复");
                  } catch (e: any) {
                    message.error(e?.response?.data?.error || "恢复失败");
                  }
                }}
              >
                恢复会议
              </Button>
            )}
            <Button
              danger
              type="primary"
              icon={<PhoneOutlined />}
              loading={finishing}
              disabled={meeting.status === "stopped" || finishing}
              onClick={finish}
            >
              结束会议
            </Button>
            <Button icon={<ArrowLeftOutlined />} onClick={backToSetup}>返回列表</Button>
          </Space>
        </div>
      </div>

      <div className="council-live-right">
        <Card size="small" title="议程" className="council-card council-side-compact">
          <ol className="council-agenda">
            {agenda.map((a) => (
              <li key={a.id} className={a.current ? "is-current" : a.done ? "is-done" : ""}>
                {a.title}
              </li>
            ))}
          </ol>
        </Card>

        <Card size="small" title="会议文档" className="council-card council-side-compact" style={{ marginTop: 10 }}>
          {deliverables.length === 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              结束后将生成方案 / 报告 / 指标表
            </Typography.Text>
          ) : (
            <Space direction="vertical" style={{ width: "100%" }} size={6}>
              {deliverables.map((d) => (
                <div key={d.id} className="council-doc-row">
                  <Tag color={KIND_META[d.kind]?.color}>{KIND_META[d.kind]?.label || d.kind}</Tag>
                  <Space>
                    {d.kind !== "xlsx" && d.content ? (
                      <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewItem(d)}>预览</Button>
                    ) : null}
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadFile(d)}>下载</Button>
                  </Space>
                </div>
              ))}
            </Space>
          )}
        </Card>

        <Card
          size="small"
          title="会议聊天"
          className="council-card council-chat-card"
          style={{ marginTop: 10, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          styles={{ body: { display: "flex", flexDirection: "column", padding: 0, flex: 1, minHeight: 0 } }}
        >
          {(humansOnTable.length > 0 || meeting.participants.length > 0) ? (
            <div className="council-agent-chips">
              {humansOnTable.length > 0 ? (
                <>
                  <span className="council-agent-chips-label">
                    <UserOutlined /> 同事
                  </span>
                  {humansOnTable.map((h) => {
                    const label = h.display_name || h.username;
                    return (
                      <button
                        key={`h-${h.id}`}
                        type="button"
                        className="council-agent-chip is-human"
                        onClick={() => insertMention(label)}
                        title={`点击插入 @${label}`}
                      >
                        <Avatar size={18} src={h.avatar_url || undefined} style={{ flexShrink: 0 }}>
                          {(label[0] || "?").toUpperCase()}
                        </Avatar>
                        {label}
                      </button>
                    );
                  })}
                </>
              ) : null}
              {meeting.participants.length > 0 ? (
                <>
                  <span className="council-agent-chips-label">
                    <RobotOutlined /> Agent
                  </span>
                  {meeting.participants.map((a) => (
                    <button
                      key={`a-${a.id}`}
                      type="button"
                      className={`council-agent-chip${activeAgentId === a.id ? " is-active" : ""}`}
                      onClick={() => insertAgentMention(a)}
                      title="点击 @Agent，发送后才会回复"
                    >
                      <span>{a.emoji}</span>
                      {a.name}
                    </button>
                  ))}
                </>
              ) : null}
              <button
                type="button"
                className="council-agent-chip is-all"
                onClick={() => insertMention("所有人")}
                title="插入 @所有人"
              >
                @所有人
              </button>
            </div>
          ) : null}
          <div ref={chatRef} className="council-chat-list">
            {messages.map((m) => (
              <ChatBubble key={m.id} m={m} mentionNames={mentionNames} />
            ))}
          </div>
          <div className="council-chat-input">
            {mention && mentionOptions.length > 0 ? (
              <div className="council-mention-pop">
                {mentionOptions.slice(0, 8).map((opt, idx) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`council-mention-item${idx === mentionIndex ? " is-active" : ""} kind-${opt.kind}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyMentionOption(opt)}
                  >
                    <b>{opt.label}</b>
                    <em>{opt.desc}</em>
                  </button>
                ))}
              </div>
            ) : null}
            <Input.TextArea
              ref={composerRef}
              autoSize={{ minRows: 2, maxRows: 4 }}
              placeholder={
                meeting.status === "stopped"
                  ? "会议已结束"
                  : meeting.status === "paused"
                    ? "会议已暂停，请先恢复"
                    : "输入 @ 可点名同事或 Agent；@Agent 才会触发 AI 回复"
              }
              value={draft}
              disabled={meeting.status !== "active"}
              onChange={(e) => {
                const value = e.target.value;
                setDraft(value);
                const caret = e.target.selectionStart ?? value.length;
                syncMentionFromCaret(value, caret);
              }}
              onClick={(e) => {
                const el = e.currentTarget;
                syncMentionFromCaret(el.value, el.selectionStart ?? el.value.length);
              }}
              onKeyUp={(e) => {
                const el = e.currentTarget;
                if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                  syncMentionFromCaret(el.value, el.selectionStart ?? el.value.length);
                }
              }}
              onKeyDown={(e) => {
                if (!mention || mentionOptions.length === 0) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((i) => (i + 1) % Math.min(8, mentionOptions.length));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex((i) => (i - 1 + Math.min(8, mentionOptions.length)) % Math.min(8, mentionOptions.length));
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  applyMentionOption(mentionOptions[mentionIndex] || mentionOptions[0]);
                } else if (e.key === "Escape") {
                  setMention(null);
                }
              }}
              onPressEnter={(e) => {
                if (mention && mentionOptions.length > 0) return;
                if (!e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
            />
            <Button type="primary" onClick={sendChat} disabled={meeting.status !== "active"}>
              发送
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        title={previewItem ? `${KIND_META[previewItem.kind]?.label || ""} · ${previewItem.title}` : ""}
        open={!!previewItem}
        onCancel={() => setPreviewItem(null)}
        width={previewItem?.kind === "html" ? 960 : 760}
        footer={[
          previewItem && (
            <Button key="dl" icon={<DownloadOutlined />} onClick={() => downloadFile(previewItem)}>下载</Button>
          ),
          <Button key="close" type="primary" onClick={() => setPreviewItem(null)}>关闭</Button>,
        ]}
      >
        {previewItem?.kind === "html" ? (
          <iframe
            title="html-report"
            srcDoc={previewItem.content}
            style={{ width: "100%", height: 520, border: `1px solid ${brand.borderLight}`, borderRadius: 8 }}
          />
        ) : (
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", maxHeight: 500, overflow: "auto" }}>
            {previewItem?.content}
          </pre>
        )}
      </Modal>
      <CouncilStyles />
    </div>
  );
}

function DescriptionsLite({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="council-desc">
      {items.map((it) => (
        <div key={it.label} className="council-desc-row">
          <span>{it.label}</span>
          <b>{it.value}</b>
        </div>
      ))}
    </div>
  );
}

function renderCouncilMentions(content: string, mentionNames: string[]) {
  const uniq = Array.from(new Set((mentionNames || []).filter(Boolean)))
    .sort((a, b) => b.length - a.length);
  if (!uniq.length) return content;
  const escaped = uniq.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(@(?:${escaped.join("|")}))`, "g");
  const parts = content.split(re);
  return parts.map((part, i) => {
    if (part.startsWith("@") && uniq.some((n) => part === `@${n}`)) {
      const isAll = /^@(所有人|全体|全体成员)$/.test(part);
      return (
        <span key={`${part}-${i}`} className={`council-mention${isAll ? " is-all" : ""}`}>
          {part}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function ChatBubble({ m, mentionNames = [] }: { m: CouncilMessage; mentionNames?: string[] }) {
  if (m.speaker_type === "system") {
    return (
      <div style={{ textAlign: "center", margin: "8px 0" }}>
        <Tag style={{ whiteSpace: "pre-wrap", maxWidth: "95%" }}>{m.content}</Tag>
      </div>
    );
  }
  const mine = m.speaker_type === "user";
  return (
    <div className={`council-bubble-row${mine ? " is-mine" : ""}`}>
      <Avatar size={28} style={{ flexShrink: 0 }}>{m.emoji}</Avatar>
      <div>
        <div className="council-bubble-meta">
          {m.speaker_name}
          <em>{mine ? "同事" : "AI"}</em>
        </div>
        <div className={`council-bubble${mine ? " is-mine" : ""}`}>
          {renderCouncilMentions(m.content, mentionNames)}
        </div>
      </div>
    </div>
  );
}

function CouncilStyles() {
  return (
    <style>{`
      .council-page { width: 100%; max-width: 1100px; }
      .council-page.council-create {
        max-width: none;
        width: 100%;
      }
      .council-back-link {
        border: none;
        background: transparent;
        color: #5c6b84;
        font-size: 13px;
        padding: 0;
        margin-bottom: 18px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .council-back-link:hover { color: #0B2144; }
      .council-create-shell {
        display: grid;
        grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
        gap: 18px;
        align-items: stretch;
        min-height: calc(100vh - 150px);
        width: 100%;
      }
      @media (min-width: 1400px) {
        .council-create-shell {
          grid-template-columns: minmax(320px, 400px) minmax(0, 1fr);
          gap: 22px;
        }
      }
      @media (max-width: 960px) {
        .council-create-shell { grid-template-columns: 1fr; min-height: 0; }
      }
      .council-create-aside {
        background:
          linear-gradient(165deg, rgba(255,255,255,0.96), rgba(255,250,242,0.92)),
          radial-gradient(ellipse at 20% 0%, rgba(196,146,74,0.14), transparent 55%);
        border: 1px solid #e6ecf4;
        border-radius: 20px;
        padding: 28px 24px 22px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .council-create-kicker {
        margin: 0;
        font-size: 11px;
        letter-spacing: 0.16em;
        font-weight: 700;
        color: #C4924A;
      }
      .council-create-title {
        margin: 0;
        font-size: 28px;
        line-height: 1.2;
        color: #0B2144;
        font-weight: 760;
      }
      .council-create-lead {
        margin: 0 0 8px;
        font-size: 13px;
        line-height: 1.55;
        color: #5c6b84;
      }
      .council-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
      }
      .council-field > span {
        font-size: 12px;
        font-weight: 600;
        color: #445066;
      }
      .council-field-row {
        display: grid;
        grid-template-columns: 1.4fr 1fr;
        gap: 10px;
      }
      @media (max-width: 520px) {
        .council-field-row { grid-template-columns: 1fr; }
      }
      .council-create-actions {
        margin-top: auto;
        padding-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .council-create-actions-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .council-create-members {
        background: #fff;
        border: 1px solid #e6ecf4;
        border-radius: 20px;
        padding: 22px 22px 18px;
        display: flex;
        flex-direction: column;
        min-height: 0;
        min-width: 0;
        width: 100%;
      }
      .council-create-members-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 12px;
      }
      .council-create-members-head h2 {
        margin: 0;
        font-size: 18px;
        color: #0B2144;
      }
      .council-create-members-head p {
        margin: 4px 0 0;
        font-size: 12px;
        color: #8b96a8;
      }
      .council-selected-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 12px;
      }
      .council-selected-empty {
        margin-bottom: 12px;
        padding: 10px 12px;
        border-radius: 10px;
        background: #f7f9fc;
        color: #8b96a8;
        font-size: 12px;
      }
      .council-selected-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #e6ecf4;
        background: #f8fafc;
        border-radius: 999px;
        padding: 4px 10px 4px 4px;
        font-size: 12px;
        color: #172033;
        cursor: pointer;
      }
      .council-selected-chip.is-agent {
        background: #fff8ef;
        border-color: #edd4a8;
      }
      .council-selected-chip i {
        font-style: normal;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #fff;
        font-size: 13px;
      }
      .council-selected-chip span { color: #8b96a8; }
      .council-member-search { margin-bottom: 14px; }
      .council-create-hint {
        margin: 0 0 10px;
        font-size: 12px;
        color: #8b96a8;
      }
      .council-member-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
        gap: 10px;
        overflow: auto;
        flex: 1;
        min-height: 280px;
        padding-right: 2px;
        align-content: start;
      }
      @media (min-width: 1280px) {
        .council-member-grid {
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 12px;
        }
      }
      @media (min-width: 1600px) {
        .council-member-grid {
          grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        }
      }
      .council-member-tile {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        border: 1px solid #e6ecf4;
        background: #fbfcfe;
        border-radius: 14px;
        padding: 12px 12px 12px 10px;
        cursor: pointer;
        transition: border-color .15s, background .15s, transform .15s;
      }
      .council-member-tile:hover {
        border-color: #c9d4e4;
        background: #fff;
        transform: translateY(-1px);
      }
      .council-member-tile.is-on {
        border-color: #C4924A;
        background: linear-gradient(180deg, #fffdf8, #fff);
        box-shadow: 0 0 0 1px rgba(196,146,74,0.18);
      }
      .council-face {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(145deg, #f3e6d0, #e8d2a8);
        font-size: 20px;
        overflow: hidden;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.55);
      }
      .council-face.is-human {
        background: linear-gradient(145deg, #dbe7f5, #c5d4e8);
        color: #0B2144;
        font-size: 14px;
        font-weight: 700;
      }
      .council-face img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .council-face-sm {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        overflow: hidden;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #e8eef6;
        font-size: 11px;
        font-weight: 700;
      }
      .council-face-sm img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .council-member-tile-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .council-member-tile-text b {
        font-size: 13px;
        color: #172033;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .council-member-tile-text em {
        font-style: normal;
        font-size: 11px;
        color: #8b96a8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .council-member-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        font-size: 10px;
        font-weight: 700;
        color: #9a6b2a;
        background: rgba(196,146,74,0.12);
        border-radius: 999px;
        padding: 1px 6px;
      }
      .council-member-badge.is-human {
        color: #3D6FA8;
        background: rgba(61,111,168,0.1);
      }
      .council-hero { margin-bottom: 16px; }
      .council-hero-row {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        flex-wrap: wrap;
      }
      .council-list-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 14px;
      }
      .council-meeting-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .council-meeting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 16px;
        border: 1px solid #e6ecf4;
        border-radius: 12px;
        background: #fff;
        transition: border-color .15s, box-shadow .15s;
      }
      .council-meeting-row:hover {
        border-color: #C4924A;
        box-shadow: 0 4px 14px rgba(23, 32, 51, 0.06);
      }
      .council-meeting-main { flex: 1; min-width: 0; }
      .council-meeting-title-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }
      .council-meeting-title-row b {
        font-size: 15px;
        color: #172033;
      }
      .council-meeting-sub {
        font-size: 13px;
        color: #5c6b84;
        line-height: 1.45;
        margin-bottom: 6px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .council-meeting-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
        font-size: 12px;
        color: #8b96a8;
      }
      .council-card {
        border-radius: 14px;
        border: 1px solid #e6ecf4;
      }
      .council-pick-pane {
        border: 1px solid #e6ecf4;
        border-radius: 12px;
        background: #f8fafc;
        min-height: 220px;
        display: flex;
        flex-direction: column;
      }
      .council-pick-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 600;
        color: #5c6b84;
        border-bottom: 1px solid #e6ecf4;
      }
      .council-pick-list {
        padding: 8px;
        overflow: auto;
        max-height: 260px;
      }
      .council-pick-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border-radius: 8px;
        cursor: pointer;
      }
      .council-pick-row:hover { background: #fff; }
      .council-pick-row span { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .council-pick-row b { font-size: 13px; color: #172033; }
      .council-pick-row em { font-style: normal; font-size: 11px; color: #8b96a8; }
      .council-agent-card {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        padding: 12px;
        border-radius: 12px;
        border: 1px solid #e6ecf4;
        background: #fff;
        cursor: pointer;
      }
      .council-agent-card.is-on {
        border-color: #C4924A;
        background: #fffdf8;
      }
      .council-agent-emoji { font-size: 22px; }
      .council-agent-card span { flex: 1; display: flex; flex-direction: column; }
      .council-agent-card b { font-size: 13px; color: #172033; }
      .council-agent-card em { font-style: normal; font-size: 12px; color: #8b96a8; }
      .council-history-item {
        width: 100%;
        text-align: left;
        border: 1px solid #e6ecf4;
        border-radius: 10px;
        padding: 10px 12px;
        background: #fff;
        cursor: pointer;
      }
      .council-history-item:hover { border-color: #C4924A; }
      .council-history-title {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
        color: #172033;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .council-desc-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 0;
        border-bottom: 1px dashed #edf1f7;
        font-size: 13px;
      }
      .council-desc-row span { color: #8b96a8; }
      .council-desc-row b { font-weight: 600; color: #172033; text-align: right; }
      .council-rules { margin: 0; padding-left: 18px; color: #5c6b84; font-size: 13px; line-height: 1.8; }

      .council-live {
        display: grid;
        grid-template-columns: 220px minmax(0, 1fr) minmax(380px, 42vw);
        gap: 14px;
        height: calc(100vh - 120px);
        min-height: 560px;
        width: 100%;
      }
      @media (max-width: 1200px) {
        .council-live { grid-template-columns: 200px minmax(0, 1fr) minmax(320px, 40vw); }
      }
      @media (max-width: 980px) {
        .council-live { grid-template-columns: 1fr; height: auto; }
      }
      .council-live-left, .council-live-right {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
      }
      .council-side-compact .ant-card-body {
        padding: 8px 12px !important;
      }
      .council-side-compact {
        flex-shrink: 0;
      }
      .council-agenda {
        margin: 0;
        padding-left: 18px;
        font-size: 12px;
        color: #445066;
        line-height: 1.65;
        max-height: 110px;
        overflow: auto;
      }
      .council-agenda .is-done { color: #8b96a8; text-decoration: line-through; }
      .council-agenda .is-current { color: #0B2144; font-weight: 700; }
      .council-chat-card {
        min-height: 0 !important;
        flex: 1 1 auto !important;
        display: flex !important;
        flex-direction: column !important;
      }
      .council-chat-card .ant-card-head {
        flex-shrink: 0;
      }
      .council-chat-card .ant-card-body {
        min-height: 0 !important;
        flex: 1 1 auto !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden;
      }
      .council-agent-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid #e6ecf4;
        background: #fff;
        flex-shrink: 0;
      }
      .council-agent-chips-label {
        font-size: 11px;
        color: #8b96a8;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-right: 2px;
      }
      .council-agent-chip {
        border: 1px solid #e6ecf4;
        background: #f8fafc;
        border-radius: 999px;
        padding: 2px 10px 2px 6px;
        font-size: 12px;
        color: #172033;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .council-agent-chip:hover {
        border-color: #C4924A;
        background: rgba(196,146,74,0.08);
      }
      .council-agent-chip.is-active {
        border-color: #C4924A;
        background: rgba(196,146,74,0.14);
        font-weight: 600;
      }
      .council-agent-chip.is-human {
        background: #f3f8ff;
        border-color: #c6dbf5;
      }
      .council-agent-chip.is-all {
        background: #fff7e8;
        border-color: #efd2a0;
        color: #8a5a12;
      }
      .council-chat-input { position: relative; }
      .council-mention-pop {
        position: absolute;
        left: 12px;
        right: 88px;
        bottom: calc(100% - 4px);
        z-index: 20;
        max-height: 220px;
        overflow: auto;
        background: #fff;
        border: 1px solid #e6ecf4;
        border-radius: 10px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
        padding: 4px;
      }
      .council-mention-item {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 1px;
        border: none;
        background: transparent;
        border-radius: 8px;
        padding: 8px 10px;
        cursor: pointer;
        text-align: left;
      }
      .council-mention-item:hover,
      .council-mention-item.is-active {
        background: #f4f7fb;
      }
      .council-mention-item b { font-size: 13px; color: #172033; font-weight: 600; }
      .council-mention-item em { font-style: normal; font-size: 11px; color: #8b96a8; }
      .council-mention {
        color: #1d6fd8;
        font-weight: 600;
      }
      .council-mention.is-all {
        color: #c45c26;
      }
      .council-bubble.is-mine .council-mention {
        color: #ffe7c2;
      }
      .council-chat-list {
        flex: 1 1 auto;
        overflow: auto;
        padding: 12px 14px;
        background: #f8fafc;
        min-height: 0;
      }
      .council-chat-input {
        display: flex;
        gap: 8px;
        align-items: flex-end;
        padding: 10px 12px;
        border-top: 1px solid #e6ecf4;
        background: #fff;
        flex-shrink: 0;
      }
      .council-chat-input .ant-input,
      .council-chat-input textarea {
        flex: 1;
      }
      .council-bubble {
        max-width: min(340px, 92%);
        padding: 8px 12px;
        border-radius: 10px;
        background: #fff;
        border: 1px solid #e6ecf4;
        font-size: 13px;
        line-height: 1.55;
        color: #172033;
        word-break: break-word;
      }
      .council-live-center {
        display: flex;
        flex-direction: column;
        min-height: 0;
        background: #f5f7fb;
        border: 1px solid #e6ecf4;
        border-radius: 16px;
        overflow: hidden;
      }
      .council-live-topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: #fff;
        border-bottom: 1px solid #e6ecf4;
      }
      .council-live-stage {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px 12px;
        background:
          radial-gradient(ellipse at 50% 40%, rgba(196,146,74,0.08), transparent 55%),
          #f3f6fb;
      }
      .council-live-controls {
        padding: 12px;
        background: #fff;
        border-top: 1px solid #e6ecf4;
        display: flex;
        justify-content: center;
      }
      .council-live-members { display: flex; flex-direction: column; gap: 8px; max-height: 420px; overflow: auto; }
      .council-live-member {
        display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-radius: 8px;
      }
      .council-live-member.is-talking { background: rgba(196,146,74,0.12); }
      .council-live-member span { display: flex; flex-direction: column; }
      .council-live-member b { font-size: 13px; }
      .council-live-member em { font-style: normal; font-size: 11px; color: #8b96a8; }
      .council-doc-row {
        display: flex; justify-content: space-between; align-items: center; gap: 8px;
      }
      .council-bubble-row {
        display: flex; gap: 8px; margin-bottom: 12px; align-items: flex-start;
      }
      .council-bubble-row.is-mine { flex-direction: row-reverse; }
      .council-bubble-meta { font-size: 11px; color: #8b96a8; margin-bottom: 2px; }
      .council-bubble-meta em { font-style: normal; margin-left: 6px; }
      .council-bubble.is-mine {
        background: linear-gradient(135deg, #C4924A, #B8863B);
        color: #fff; border: none;
      }
    `}</style>
  );
}
