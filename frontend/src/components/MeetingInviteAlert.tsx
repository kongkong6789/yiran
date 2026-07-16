import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal, Typography } from "antd";
import { TeamOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import {
  ackCouncilInvite,
  getAuthToken,
  listPendingCouncilInvites,
  openUserNotifySocket,
  type CouncilInvite,
} from "../api/client";

type Props = {
  enabled?: boolean;
};

/**
 * 全局会议邀请提醒：用户级 WebSocket + 轮询兜底 + 醒目弹窗 + 可选桌面通知。
 */
export default function MeetingInviteAlert({ enabled = true }: Props) {
  const nav = useNavigate();
  const [current, setCurrent] = useState<CouncilInvite | null>(null);
  const shownRef = useRef<Set<number>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playBeep = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = audioCtxRef.current || new Ctx();
      audioCtxRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.stop(ctx.currentTime + 0.5);
    } catch {
      /* ignore */
    }
  }, []);

  const desktopNotify = useCallback((inv: CouncilInvite) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const title = "圆桌会议邀请";
    const body = `${inv.inviter_name} 邀请你加入「${inv.title}」`;
    if (Notification.permission === "granted") {
      try {
        const n = new Notification(title, { body, tag: `council-invite-${inv.invite_id}` });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        /* ignore */
      }
      return;
    }
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  const present = useCallback((inv: CouncilInvite) => {
    if (!inv?.invite_id || shownRef.current.has(inv.invite_id)) return;
    // 若已有弹窗，不覆盖更高优先级；排队：当前空才弹
    setCurrent((prev) => {
      if (prev) return prev;
      shownRef.current.add(inv.invite_id);
      return inv;
    });
    playBeep();
    desktopNotify(inv);
    void ackCouncilInvite(inv.invite_id, "seen").catch(() => undefined);
  }, [desktopNotify, playBeep]);

  const refreshPending = useCallback(async () => {
    if (!enabled || !getAuthToken()) return;
    try {
      const data = await listPendingCouncilInvites();
      const first = (data.results || []).find((x) => !shownRef.current.has(x.invite_id));
      if (first) present(first);
    } catch {
      /* ignore */
    }
  }, [enabled, present]);

  useEffect(() => {
    if (!enabled || !getAuthToken()) return;

    let stopped = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;

    const connect = () => {
      if (stopped) return;
      try { ws?.close(); } catch { /* ignore */ }
      ws = openUserNotifySocket({
        onInvite: (inv) => present(inv),
        onClose: (ev) => {
          if (stopped) return;
          if (ev.code === 4401) return;
          if (reconnectTimer) window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(connect, 2000);
        },
      });
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ }
        }
      }, 25000);
    };

    connect();
    void refreshPending();
    const poll = window.setInterval(() => { void refreshPending(); }, 12000);
    const onFocus = () => { void refreshPending(); };
    window.addEventListener("focus", onFocus);

    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      try { ws?.close(); } catch { /* ignore */ }
    };
  }, [enabled, present, refreshPending]);

  const closeAndMaybeNext = async (action: "join" | "dismiss") => {
    const inv = current;
    setCurrent(null);
    if (!inv) return;
    try {
      await ackCouncilInvite(inv.invite_id, action);
    } catch {
      /* ignore */
    }
    if (action === "join") {
      nav(`/council?meeting=${inv.meeting_id}`);
    } else {
      // 稍后再说后，尝试展示下一条
      window.setTimeout(() => { void refreshPending(); }, 400);
    }
  };

  return (
    <Modal
      open={!!current}
      closable={false}
      maskClosable={false}
      keyboard={false}
      centered
      width={440}
      footer={null}
      className="council-invite-modal"
      styles={{
        mask: { background: "rgba(20, 16, 12, 0.72)" },
        content: {
          borderRadius: 16,
          overflow: "hidden",
          border: "2px solid #c45c26",
          boxShadow: "0 24px 64px rgba(196, 92, 38, 0.35)",
        },
      }}
    >
      {current ? (
        <div style={{ padding: "8px 4px 4px", textAlign: "center" }}>
          <div
            style={{
              width: 64,
              height: 64,
              margin: "0 auto 16px",
              borderRadius: "50%",
              background: "linear-gradient(145deg, #e8a06a, #c45c26)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 28,
              animation: "council-invite-pulse 1.2s ease-in-out infinite",
            }}
          >
            <TeamOutlined />
          </div>
          <Typography.Title level={3} style={{ margin: "0 0 8px", color: "#2a2118" }}>
            有人在拉你开会
          </Typography.Title>
          <Typography.Paragraph style={{ marginBottom: 4, fontSize: 16, color: "#5c4a3a" }}>
            <strong>{current.inviter_name}</strong>
            {" "}邀请你加入
          </Typography.Paragraph>
          <Typography.Title level={4} style={{ margin: "0 0 12px", color: "#c45c26" }}>
            {current.title}
          </Typography.Title>
          {current.question ? (
            <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 24 }}>
              {current.question}
            </Typography.Paragraph>
          ) : null}
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <Button size="large" onClick={() => { void closeAndMaybeNext("dismiss"); }}>
              稍后再说
            </Button>
            <Button
              type="primary"
              size="large"
              style={{ background: "#c45c26", borderColor: "#c45c26", minWidth: 140 }}
              onClick={() => { void closeAndMaybeNext("join"); }}
            >
              立即进入会议
            </Button>
          </div>
          <style>{`
            @keyframes council-invite-pulse {
              0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(196,92,38,.45); }
              50% { transform: scale(1.06); box-shadow: 0 0 0 12px rgba(196,92,38,0); }
            }
          `}</style>
        </div>
      ) : null}
    </Modal>
  );
}
