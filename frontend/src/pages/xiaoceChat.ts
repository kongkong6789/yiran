import type { XiaoceRun } from "../api/client";


export type XiaoceRoomLike = {
  room_kind?: string;
  participants?: Array<{ username?: string; bot_id?: string }>;
};

type MutableValueRef<T> = { current: T };

export type RoomComposerSnapshot<TFile, TReply> = {
  draft: string;
  pendingFiles: TFile[];
  replyingTo: TReply | null;
};

type XiaoceRunStateLike = { status?: string };

type XiaoceTaskStateLike = {
  id: string;
  active_xiaoce_run?: XiaoceRunStateLike | null;
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

export function partitionXiaoceRooms<T extends XiaoceRoomLike>(rooms: T[]): {
  xiaoceTasks: T[];
  otherRooms: T[];
} {
  const xiaoceTasks: T[] = [];
  const otherRooms: T[] = [];
  for (const room of rooms) {
    (isXiaoceRoom(room) ? xiaoceTasks : otherRooms).push(room);
  }
  return { xiaoceTasks, otherRooms };
}


export function isRoomAsyncResultCurrent(
  activeRoomId: string | null,
  targetRoomId: string,
): boolean {
  return activeRoomId === targetRoomId;
}


export function setRoomPending(
  current: ReadonlySet<string>,
  roomId: string,
  pending: boolean,
): Set<string> {
  const next = new Set(current);
  if (pending) next.add(roomId);
  else next.delete(roomId);
  return next;
}


export function transitionRoomComposer<TFile, TReply>(
  cache: ReadonlyMap<string, RoomComposerSnapshot<TFile, TReply>>,
  previousRoomId: string | null,
  destinationRoomId: string,
  current: RoomComposerSnapshot<TFile, TReply>,
): {
  cache: Map<string, RoomComposerSnapshot<TFile, TReply>>;
  composer: RoomComposerSnapshot<TFile, TReply>;
} {
  const nextCache = new Map(cache);
  if (previousRoomId) {
    nextCache.set(previousRoomId, {
      ...current,
      pendingFiles: [...current.pendingFiles],
    });
  }
  const destination = nextCache.get(destinationRoomId);
  return {
    cache: nextCache,
    composer: destination
      ? { ...destination, pendingFiles: [...destination.pendingFiles] }
      : { draft: "", pendingFiles: [], replyingTo: null },
  };
}


export function beginRoomSelection(
  activeRoomRef: MutableValueRef<string | null>,
  generationRef: MutableValueRef<number>,
  roomId: string,
): string | null {
  const previousRoomId = activeRoomRef.current;
  activeRoomRef.current = roomId;
  generationRef.current += 1;
  return previousRoomId;
}


export function isLiveGenerationCurrent(
  currentGeneration: number,
  effectGeneration: number,
  stopped: boolean,
): boolean {
  return !stopped && currentGeneration === effectGeneration;
}


export function isXiaoceTaskRunning(
  listedTask: XiaoceTaskStateLike,
  activeRoom: XiaoceTaskStateLike | null,
  activeRun: XiaoceRunStateLike | null,
): boolean {
  if (activeRoom?.id === listedTask.id) {
    if (activeRun) return activeRun.status === "running";
    return activeRoom.active_xiaoce_run?.status === "running";
  }
  return listedTask.active_xiaoce_run?.status === "running";
}


export async function resolveXiaoceDeleteState<T extends XiaoceTaskStateLike>(
  roomId: string,
  loadRoom: (roomId: string) => Promise<T>,
): Promise<{ room: T; running: boolean }> {
  const room = await loadRoom(roomId);
  return {
    room,
    running: room.active_xiaoce_run?.status === "running",
  };
}


export function xiaoceDeleteContent(running: boolean): string {
  return running
    ? "将永久删除该任务及全部聊天记录，正在处理的任务也会停止。"
    : "将永久删除该任务及全部聊天记录。";
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


export function mergeXiaoceRunSnapshots(
  incoming: XiaoceRun,
  snapshots: Array<XiaoceRun | null | undefined>,
): XiaoceRun {
  let merged = incoming;
  for (const snapshot of snapshots) {
    if (!snapshot || snapshot.id !== incoming.id) continue;
    merged = mergeXiaoceRunSnapshot(merged, snapshot) || merged;
  }
  return merged;
}
