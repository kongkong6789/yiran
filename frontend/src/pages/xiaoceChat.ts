import type { XiaoceRun } from "../api/client";


type XiaoceRoomLike = {
  id?: string;
  title?: string;
  display_title?: string;
  message_count?: number;
  room_kind?: string;
  participants?: Array<{ username?: string; bot_id?: string }>;
};


export function isXiaoceRoom(room: XiaoceRoomLike | null | undefined): boolean {
  return room?.room_kind === "dm" && Boolean(
    room.participants?.some(
      (participant) => (
        participant.bot_id === "xiaoce"
        || participant.username === "小策bot"
      ),
    ),
  );
}


export function findXiaoceReferenceRooms<T extends XiaoceRoomLike>(
  rooms: T[],
  activeRoomId: string | null | undefined,
  query = "",
  limit = 8,
): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  return rooms
    .filter((room) => room.id && room.id !== activeRoomId && isXiaoceRoom(room))
    .filter((room) => {
      if (!normalized) return true;
      const title = room.display_title || room.title || "小策bot 历史任务";
      return title.toLocaleLowerCase().includes(normalized);
    })
    .slice(0, Math.max(0, limit));
}


export function createXiaoceRunId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}


export function mergeXiaoceRunSnapshot(
  current: XiaoceRun | null,
  incoming: XiaoceRun | null,
): XiaoceRun | null {
  if (incoming === null) return null;
  if (current === null || current.id !== incoming.id) return incoming;
  const currentTime = Date.parse(current.updated_at || "") || 0;
  const incomingTime = Date.parse(incoming.updated_at || "") || 0;
  return incomingTime >= currentTime ? incoming : current;
}
