import { useEffect, useRef } from "react";
import {
  closeWebSocketQuietly,
  getCollabRoomPresence,
  getCollabRoomStats,
  listCollabMessages,
  listCollabInsights,
  openCollabRoomSocket,
  type CollabInsight,
  type CollabMessage,
  type CollabRoom,
  type CollabRoomStats,
  type CollabSyncEvent,
  type XiaoceRun,
} from "../api/client";

type Args = {
  roomId: string | null;
  messagesRef: React.MutableRefObject<CollabMessage[]>;
  insightsRef: React.MutableRefObject<CollabInsight[]>;
  mergeMessages: (incoming: CollabMessage[], changed?: CollabMessage[]) => void;
  mergeInsights: (incoming: CollabInsight[]) => void;
  patchRoomMeta: (meta: Partial<CollabRoom>) => void;
  onXiaoceRuns?: (runs: XiaoceRun[]) => void;
  setRoomStats: React.Dispatch<React.SetStateAction<CollabRoomStats | null>>;
  /** 兼容旧调用，当前未使用 */
  participantsEqual?: (a?: CollabRoom["participants"], b?: CollabRoom["participants"]) => boolean;
};

/**
 * 即时通信：WebSocket 推送 + 短轮询兜底。
 */
export function useCollabRoomLive({
  roomId,
  messagesRef,
  insightsRef,
  mergeMessages,
  mergeInsights,
  patchRoomMeta,
  onXiaoceRuns,
  setRoomStats,
}: Args) {
  const aliveRef = useRef(true);
  const afterMsgRef = useRef(0);
  const afterInsightRef = useRef(0);

  useEffect(() => {
    aliveRef.current = true;
    if (!roomId) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let presenceTimer: number | null = null;
    let pollTimer: number | null = null;
    let pingTimer: number | null = null;
    let stopped = false;

    afterMsgRef.current = messagesRef.current.reduce(
      (max, m) => (m.id > 0 && m.id > max ? m.id : max),
      0,
    );
    afterInsightRef.current = insightsRef.current.reduce(
      (max, i) => (i.id > max ? i.id : max),
      0,
    );

    const applySync = (data: CollabSyncEvent) => {
      if (!aliveRef.current) return;
      if (typeof data.after_id === "number" && data.after_id > afterMsgRef.current) {
        afterMsgRef.current = data.after_id;
      }
      if (typeof data.after_insight_id === "number" && data.after_insight_id > afterInsightRef.current) {
        afterInsightRef.current = data.after_insight_id;
      }
      if (data.messages?.length || data.changed?.length) {
        mergeMessages(data.messages || [], data.changed);
        for (const m of data.messages || []) {
          if (m.id > afterMsgRef.current) afterMsgRef.current = m.id;
        }
      }
      if (data.insights?.length) {
        mergeInsights(data.insights);
        for (const i of data.insights) {
          if (i.id > afterInsightRef.current) afterInsightRef.current = i.id;
        }
      }
      if (data.room) {
        patchRoomMeta(data.room);
      }
      if (data.xiaoce_runs) {
        onXiaoceRuns?.(data.xiaoce_runs);
      } else if (data.room && "active_xiaoce_run" in data.room) {
        onXiaoceRuns?.(data.room.active_xiaoce_run ? [data.room.active_xiaoce_run] : []);
      }
      if (data.messages?.length || data.insights?.length) {
        getCollabRoomStats(roomId).then((st) => {
          if (!aliveRef.current) return;
          setRoomStats((prev) => {
            if (!prev) return st;
            if (
              prev.message_count === st.message_count
              && prev.user_message_count === st.user_message_count
              && prev.ai_reply_count === st.ai_reply_count
              && prev.ai_interject_count === st.ai_interject_count
              && prev.attachment_count === st.attachment_count
              && prev.risk_level === st.risk_level
              && prev.risk_counts.yellow === st.risk_counts.yellow
              && prev.risk_counts.red === st.risk_counts.red
              && (prev.alerts?.length || 0) === (st.alerts?.length || 0)
              && (prev.alerts?.[0]?.id || 0) === (st.alerts?.[0]?.id || 0)
            ) {
              return prev;
            }
            return st;
          });
        }).catch(() => undefined);
      }
    };

    const pollOnce = async () => {
      if (!aliveRef.current || stopped) return;
      const cursor = Math.max(
        afterMsgRef.current,
        messagesRef.current.reduce((max, m) => (m.id > 0 && m.id > max ? m.id : max), 0),
      );
      const insightCursor = Math.max(
        afterInsightRef.current,
        insightsRef.current.reduce((max, i) => (i.id > max ? i.id : max), 0),
      );
      try {
        const [page, insights] = await Promise.all([
          listCollabMessages(roomId, {
            afterId: cursor > 0 ? cursor : undefined,
            limit: 50,
            lite: true,
            includeParticipants: false,
          }),
          listCollabInsights(roomId, insightCursor > 0 ? insightCursor : 0),
        ]);
        if (!aliveRef.current) return;
        const incoming = page.results || [];
        const changed = page.changed || [];
        applySync({
          messages: incoming,
          changed,
          after_id: incoming.length ? incoming[incoming.length - 1].id : cursor,
          room: page.room,
        });
        const newInsights = insights.results || [];
        if (newInsights.length) {
          applySync({
            insights: newInsights,
            after_insight_id: newInsights[newInsights.length - 1].id,
          });
        }
      } catch {
        /* ignore */
      }
    };

    const connect = () => {
      if (stopped) return;
      closeWebSocketQuietly(ws);
      afterMsgRef.current = Math.max(
        afterMsgRef.current,
        messagesRef.current.reduce((max, m) => (m.id > 0 && m.id > max ? m.id : max), 0),
      );
      afterInsightRef.current = Math.max(
        afterInsightRef.current,
        insightsRef.current.reduce((max, i) => (i.id > max ? i.id : max), 0),
      );
      ws = openCollabRoomSocket(roomId, {
        onSync: applySync,
        onClose: (ev) => {
          if (stopped) return;
          if (ev.code === 4401 || ev.code === 4403 || ev.code === 4404) return;
          if (reconnectTimer) window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(connect, 1500);
        },
      });
      if (pingTimer) window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* ignore */ }
        }
      }, 25000);
    };

    const refreshPresence = async () => {
      try {
        const p = await getCollabRoomPresence(roomId);
        if (!aliveRef.current) return;
        patchRoomMeta({
          status: p.status as CollabRoom["status"],
          risk_level: p.risk_level as CollabRoom["risk_level"],
          updated_at: p.updated_at,
          online_count: p.online_count,
          peer_online: p.peer_online,
          participants: p.participants,
          member_count: p.member_count,
          display_title: p.display_title,
          active_xiaoce_run: p.active_xiaoce_run,
        });
        onXiaoceRuns?.(p.active_xiaoce_run ? [p.active_xiaoce_run] : []);
      } catch {
        /* ignore */
      }
    };

    const startTimer = window.setTimeout(() => {
      if (stopped) return;
      afterMsgRef.current = Math.max(
        afterMsgRef.current,
        messagesRef.current.reduce((max, m) => (m.id > 0 && m.id > max ? m.id : max), 0),
      );
      connect();
      void pollOnce();
      pollTimer = window.setInterval(() => { void pollOnce(); }, 2500);
    }, 400);

    refreshPresence();
    presenceTimer = window.setInterval(refreshPresence, 20000);

    return () => {
      stopped = true;
      aliveRef.current = false;
      window.clearTimeout(startTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (presenceTimer) window.clearInterval(presenceTimer);
      if (pollTimer) window.clearInterval(pollTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      closeWebSocketQuietly(ws);
    };
  }, [
    roomId,
    messagesRef,
    insightsRef,
    mergeMessages,
    mergeInsights,
    patchRoomMeta,
    onXiaoceRuns,
    setRoomStats,
  ]);
}
