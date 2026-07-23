import type { CollabMessage, CollabRoom, XiaoceRun } from "../api/client";


export type XiaoceParticipantLike = {
  username?: string;
  bot_id?: string;
  kind?: string;
  online?: boolean;
};

export type XiaoceRoomLike = {
  id?: string;
  title?: string;
  display_title?: string;
  message_count?: number;
  room_kind?: string;
  participants?: XiaoceParticipantLike[];
};

type MutableValueRef<T> = { current: T };

export type RoomComposerSnapshot<TFile, TReply, TReference> = {
  draft: string;
  pendingFiles: TFile[];
  replyingTo: TReply | null;
  referencedRoom: TReference | null;
};

type XiaoceRunStateLike = { status?: string };

type XiaoceTaskStateLike = {
  id: string;
  active_xiaoce_run?: XiaoceRunStateLike | null;
};


export function isXiaoceParticipant(
  participant: XiaoceParticipantLike | null | undefined,
): boolean {
  return Boolean(
    participant
    && (
      participant.bot_id === "xiaoce"
      || participant.username === "小策bot"
    )
  );
}

export function collabParticipantOnline(
  participant: XiaoceParticipantLike | null | undefined,
  reportedOnline = participant?.online,
): boolean {
  return isXiaoceParticipant(participant) || Boolean(reportedOnline);
}

export function isXiaoceRoom(room: XiaoceRoomLike | null | undefined): boolean {
  return room?.room_kind === "dm" && Boolean(
    room.participants?.some(isXiaoceParticipant),
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


export function isRoomSelectionCurrent(
  activeRoomId: string | null,
  currentGeneration: number,
  targetRoomId: string,
  targetGeneration: number,
): boolean {
  return activeRoomId === targetRoomId && currentGeneration === targetGeneration;
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


export function transitionRoomComposer<TFile, TReply, TReference>(
  cache: ReadonlyMap<string, RoomComposerSnapshot<TFile, TReply, TReference>>,
  previousRoomId: string | null,
  destinationRoomId: string,
  current: RoomComposerSnapshot<TFile, TReply, TReference>,
): {
  cache: Map<string, RoomComposerSnapshot<TFile, TReply, TReference>>;
  composer: RoomComposerSnapshot<TFile, TReply, TReference>;
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
      : { draft: "", pendingFiles: [], replyingTo: null, referencedRoom: null },
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


export function mentionMenuScrollTop(
  currentScrollTop: number,
  viewportHeight: number,
  optionTop: number,
  optionHeight: number,
): number {
  const scrollTop = Math.max(0, currentScrollTop);
  const height = Math.max(0, viewportHeight);
  const top = Math.max(0, optionTop);
  const bottom = top + Math.max(0, optionHeight);
  if (height === 0) return scrollTop;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + height) return Math.max(0, bottom - height);
  return scrollTop;
}


export type AtomicMentionDeletion = {
  value: string;
  caret: number;
  deleted: string;
};

type MentionRange = { start: number; end: number };

function isMentionEndBoundary(character: string | undefined): boolean {
  return character === undefined || /[\s,.!?;:，。！？；：、()[\]{}<>"'“”‘’]/u.test(character);
}

function mentionRanges(value: string, mentionTokens: readonly string[]): MentionRange[] {
  const ranges = new Map<string, MentionRange>();
  const tokens = [...new Set(
    mentionTokens
      .map((token) => token.trimEnd())
      .filter((token) => token.startsWith("@") && token.length > 1),
  )].sort((a, b) => b.length - a.length);

  for (const token of tokens) {
    let from = 0;
    while (from < value.length) {
      const start = value.indexOf(token, from);
      if (start < 0) break;
      const end = start + token.length;
      if (isMentionEndBoundary(value[end])) {
        ranges.set(`${start}:${end}`, { start, end });
      }
      from = start + 1;
    }
  }

  const conversationPattern = /@「[^」\r\n]+」/gu;
  for (const match of value.matchAll(conversationPattern)) {
    const start = match.index;
    const end = start + match[0].length;
    ranges.set(`${start}:${end}`, { start, end });
  }

  return [...ranges.values()].sort((a, b) => a.start - b.start || b.end - a.end);
}

/**
 * Treat an inserted mention as one textarea editing unit. A non-collapsed selection
 * intentionally returns null so the browser can keep its normal selection behavior.
 */
export function deleteAtomicMentionAtCaret(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "backward" | "forward",
  mentionTokens: readonly string[],
): AtomicMentionDeletion | null {
  const start = Math.max(0, Math.min(value.length, Math.floor(selectionStart)));
  const end = Math.max(0, Math.min(value.length, Math.floor(selectionEnd)));
  if (start !== end) return null;

  const caret = start;
  const range = mentionRanges(value, mentionTokens).find((candidate) => (
    direction === "backward"
      ? (
        (caret > candidate.start && caret <= candidate.end)
        || (caret === candidate.end + 1 && value[candidate.end] === " ")
      )
      : caret >= candidate.start && caret < candidate.end
  ));
  if (!range) return null;

  const deleteEnd = value[range.end] === " " ? range.end + 1 : range.end;
  return {
    value: `${value.slice(0, range.start)}${value.slice(deleteEnd)}`,
    caret: range.start,
    deleted: value.slice(range.start, deleteEnd),
  };
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
  context: {
    authoritative?: boolean;
    requestRevision?: number;
    currentRevision?: number;
  } = {},
): XiaoceRun | null {
  if (
    context.authoritative
    && context.requestRevision !== undefined
    && context.currentRevision !== undefined
    && context.requestRevision !== context.currentRevision
  ) {
    return current;
  }
  if (incoming === null) {
    if (current === null) return null;
    if (!context.authoritative) return current;
    return null;
  }
  if (current === null) return incoming;
  if (current.id !== incoming.id) {
    const currentCreated = Date.parse(current.created_at || "") || 0;
    const incomingCreated = Date.parse(incoming.created_at || "") || 0;
    if (incomingCreated !== currentCreated) {
      return incomingCreated > currentCreated ? incoming : current;
    }
  }
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
    if (!snapshot) continue;
    merged = mergeXiaoceRunSnapshot(merged, snapshot) || merged;
  }
  return merged;
}


export function hasXiaoceRunTerminalMessage(
  messages: Array<Pick<CollabMessage, "meta">>,
  runId: string,
): boolean {
  return messages.some((message) => {
    const meta = message.meta;
    if (!meta || meta.run_id !== runId) return false;
    return meta.process_status === "completed"
      || meta.process_status === "failed"
      || meta.process_status === "cancelled"
      || meta.cancelled === true;
  });
}


/**
 * 轮询 / presence 可能比运行创建或终态消息更早抵达。
 * 只有已看到同一 run 的终态消息时，才允许空快照卸载正在显示的处理过程。
 */
export function stabilizeXiaoceRunSnapshot(
  current: XiaoceRun | null,
  incoming: XiaoceRun | null,
  messages: Array<Pick<CollabMessage, "meta">>,
): XiaoceRun | null {
  if (incoming !== null || current?.status !== "running") return incoming;
  return hasXiaoceRunTerminalMessage(messages, current.id) ? null : current;
}


type RoomMutationCacheLike = {
  room: CollabRoom;
  messages: CollabMessage[];
  xiaoceRun: XiaoceRun | null;
};

export type RoomMutation = {
  messages?: (current: CollabMessage[]) => CollabMessage[];
  room?: (current: CollabRoom) => CollabRoom;
  xiaoceRun?: (current: XiaoceRun | null) => XiaoceRun | null;
};

export function applyRoomMutation<TCache extends RoomMutationCacheLike>(
  state: {
    roomId: string;
    revision: number;
    rooms: CollabRoom[];
    cache: ReadonlyMap<string, TCache>;
    activeRoomId: string | null;
    activeRoom: CollabRoom | null;
    activeMessages: CollabMessage[];
    activeRun: XiaoceRun | null;
  },
  mutation: RoomMutation,
): {
  revision: number;
  rooms: CollabRoom[];
  cache: Map<string, TCache>;
  activeRoom: CollabRoom | null;
  activeMessages: CollabMessage[];
  activeRun: XiaoceRun | null;
} {
  const cached = state.cache.get(state.roomId);
  const isActive = state.activeRoomId === state.roomId;
  const listedRoom = state.rooms.find((room) => room.id === state.roomId) || null;
  const currentRoom = (isActive ? state.activeRoom : null) || cached?.room || listedRoom;
  const currentMessages = isActive ? state.activeMessages : (cached?.messages || []);
  const currentRun = isActive
    ? state.activeRun
    : (cached?.xiaoceRun || currentRoom?.active_xiaoce_run || null);
  const nextMessages = mutation.messages
    ? mutation.messages(currentMessages)
    : currentMessages;
  const nextRun = mutation.xiaoceRun
    ? mutation.xiaoceRun(currentRun)
    : currentRun;
  let nextRoom = currentRoom && mutation.room
    ? mutation.room(currentRoom)
    : currentRoom;
  if (nextRoom && mutation.xiaoceRun) {
    nextRoom = { ...nextRoom, active_xiaoce_run: nextRun };
  }

  const nextCache = new Map(state.cache);
  if (cached && nextRoom) {
    nextCache.set(state.roomId, {
      ...cached,
      room: nextRoom,
      messages: nextMessages,
      xiaoceRun: nextRun,
    });
  }
  const nextRooms = nextRoom
    ? state.rooms.map((room) => (room.id === state.roomId ? nextRoom! : room))
    : state.rooms;
  return {
    revision: state.revision + 1,
    rooms: nextRooms,
    cache: nextCache,
    activeRoom: isActive ? nextRoom : state.activeRoom,
    activeMessages: isActive ? nextMessages : state.activeMessages,
    activeRun: isActive ? nextRun : state.activeRun,
  };
}


function messageTime(message: Pick<CollabMessage, "updated_at">): number {
  return Date.parse(message.updated_at || "") || 0;
}


function mergeDetailMessages(
  pageMessages: CollabMessage[],
  currentMessages: CollabMessage[],
  requestStartMessageIds: number[],
): CollabMessage[] {
  const currentIds = new Set(currentMessages.map((message) => message.id));
  const requestStartIds = new Set(requestStartMessageIds);
  const byId = new Map<number, CollabMessage>();
  for (const message of pageMessages) {
    if (requestStartIds.has(message.id) && !currentIds.has(message.id)) continue;
    byId.set(message.id, message);
  }
  for (const message of currentMessages) {
    const pageMessage = byId.get(message.id);
    if (!pageMessage || messageTime(message) >= messageTime(pageMessage)) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()].sort((left, right) => {
    if (left.id < 0 && right.id >= 0) return 1;
    if (right.id < 0 && left.id >= 0) return -1;
    return left.id - right.id;
  });
}


export function reconcileRoomDetailSnapshot(input: {
  pageMessages: CollabMessage[];
  currentMessages: CollabMessage[];
  requestStartMessageIds?: number[];
  pageRun: XiaoceRun | null;
  currentRun: XiaoceRun | null;
  requestRevision: number;
  currentRevision: number;
}): { messages: CollabMessage[]; xiaoceRun: XiaoceRun | null } {
  const changedDuringRequest = input.requestRevision !== input.currentRevision;
  return {
    messages: changedDuringRequest
      ? mergeDetailMessages(
          input.pageMessages,
          input.currentMessages,
          input.requestStartMessageIds || [],
        )
      : input.pageMessages,
    xiaoceRun: mergeXiaoceRunSnapshot(input.currentRun, input.pageRun, {
      authoritative: true,
      requestRevision: input.requestRevision,
      currentRevision: input.currentRevision,
    }),
  };
}


export function mergeOlderRoomPage<TMessage extends { id: number }>(
  current: {
    messages: TMessage[];
    hasMoreBefore: boolean;
    firstItemIndex: number;
  },
  page: { results: TMessage[]; has_more_before?: boolean },
): { messages: TMessage[]; hasMoreBefore: boolean; firstItemIndex: number } {
  const known = new Set(current.messages.map((message) => message.id));
  const unique = (page.results || []).filter((message) => !known.has(message.id));
  return {
    messages: unique.length ? [...unique, ...current.messages] : current.messages,
    hasMoreBefore: Boolean(page.has_more_before),
    firstItemIndex: current.firstItemIndex - unique.length,
  };
}
