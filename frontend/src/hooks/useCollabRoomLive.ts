import { useEffect, useRef } from "react";
import {
  getCollabRoomPresence,
  getCollabRoomStats,
  openCollabRoomEvents,
  type CollabInsight,
  type CollabMessage,
  type CollabRoom,
  type CollabRoomStats,
  type CollabSyncEvent,
} from "../api/client";

type Args = {
  roomId: string | null;
  messagesRef: React.MutableRefObject<CollabMessage[]>;
  insightsRef: React.MutableRefObject<CollabInsight[]>;
  mergeMessages: (incoming: CollabMessage[], changed?: CollabMessage[]) => void;
  mergeInsights: (incoming: CollabInsight[]) => void;
  patchRoomMeta: (meta: Partial<CollabRoom>) => void;
  setRoomStats: React.Dispatch<React.SetStateAction<CollabRoomStats | null>>;
  participantsEqual: (a?: CollabRoom["participants"], b?: CollabRoom["participants"]) => boolean;
};

/**
 * SSE 接收消息增量；成员/在线态走独立低频 presence。
 * 取代原 2.5s 全量轮询。
 */
export function useCollabRoomLive({
  roomId,
  messagesRef,
  insightsRef,
  mergeMessages,
  mergeInsights,
  patchRoomMeta,
  setRoomStats,
  participantsEqual,
}: Args) {
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    if (!roomId) return;

    let abort: AbortController | null = null;
    let reconnectTimer: number | null = null;
    let presenceTimer: number | null = null;
    let stopped = false;

    const applySync = (data: CollabSyncEvent) => {
      if (!aliveRef.current) return;
      if (data.messages?.length || data.changed?.length) {
        mergeMessages(data.messages || [], data.changed);
      }
      if (data.insights?.length) {
        mergeInsights(data.insights);
      }
      if (data.room) {
        patchRoomMeta(data.room);
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

    const connect = () => {
      if (stopped) return;
      abort?.abort();
      abort = new AbortController();
      const lastMsgId = messagesRef.current.reduce(
        (max, m) => (m.id > 0 && m.id > max ? m.id : max),
        0,
      );
      const lastInsightId = insightsRef.current.reduce(
        (max, i) => (i.id > max ? i.id : max),
        0,
      );
      openCollabRoomEvents(roomId, {
        afterId: lastMsgId > 0 ? lastMsgId : 0,
        afterInsightId: lastInsightId > 0 ? lastInsightId : 0,
        signal: abort.signal,
        onSync: applySync,
        onDone: () => {
          if (stopped) return;
          if (reconnectTimer) window.clearTimeout(reconnectTimer);
          reconnectTimer = window.setTimeout(connect, 800);
        },
        onError: () => {
          if (stopped) return;
          if (reconnectTimer) window.clearTimeout(reconnectTimer);
          // 406/网络失败退避，避免打爆后端
          reconnectTimer = window.setTimeout(connect, 5000);
        },
      });
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
        });
      } catch {
        /* ignore */
      }
    };

    connect();
    refreshPresence();
    presenceTimer = window.setInterval(refreshPresence, 20000);

    return () => {
      stopped = true;
      aliveRef.current = false;
      abort?.abort();
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (presenceTimer) window.clearInterval(presenceTimer);
    };
  }, [
    roomId,
    messagesRef,
    insightsRef,
    mergeMessages,
    mergeInsights,
    patchRoomMeta,
    setRoomStats,
    participantsEqual,
  ]);
}
