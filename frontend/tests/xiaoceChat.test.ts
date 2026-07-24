import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  collabParticipantOnline,
  createXiaoceRunId,
  deleteAtomicMentionAtCaret,
  findXiaoceReferenceRooms,
  hasXiaoceRunTerminalMessage,
  isXiaoceRoom,
  mentionMenuScrollTop,
  mergeXiaoceRunSnapshot,
  partitionXiaoceRooms,
  stabilizeXiaoceRunSnapshot,
} from "../src/pages/xiaoceChat.ts";
import * as xiaoceChatHelpers from "../src/pages/xiaoceChat.ts";


test("recognizes only Xiaoce direct messages", () => {
  assert.equal(
    isXiaoceRoom({
      room_kind: "dm",
      participants: [{ username: "小策bot", bot_id: "xiaoce" }],
    }),
    true,
  );
  assert.equal(
    isXiaoceRoom({
      room_kind: "group",
      participants: [{ username: "小策bot", bot_id: "xiaoce" }],
    }),
    false,
  );
  assert.equal(
    isXiaoceRoom({ room_kind: "dm", participants: [{ username: "同事" }] }),
    false,
  );
});

test("Xiaoce service presence cannot be downgraded by a missing heartbeat", () => {
  assert.equal(collabParticipantOnline({ bot_id: "xiaoce", online: false }), true);
  assert.equal(collabParticipantOnline({ username: "小策bot" }, false), true);
  assert.equal(collabParticipantOnline({ username: "同事", online: false }), false);
  assert.equal(collabParticipantOnline({ username: "同事", online: true }), true);
});

test("finds prior Xiaoce tasks for @ references and excludes the active room", () => {
  const rooms = [
    {
      id: "current",
      title: "当前任务",
      room_kind: "dm",
      participants: [{ bot_id: "xiaoce" }],
    },
    {
      id: "summer",
      title: "夏季上新计划",
      room_kind: "dm",
      participants: [{ username: "小策bot" }],
    },
    {
      id: "other",
      title: "普通单聊",
      room_kind: "dm",
      participants: [{ username: "同事" }],
    },
  ];

  assert.deepEqual(
    findXiaoceReferenceRooms(rooms, "current", "夏季").map((room) => room.id),
    ["summer"],
  );
  assert.deepEqual(
    findXiaoceReferenceRooms(rooms, "summer").map((room) => room.id),
    ["current"],
  );
});

test("keeps the active mention option inside the menu viewport", () => {
  assert.equal(mentionMenuScrollTop(40, 120, 60, 32), 40);
  assert.equal(mentionMenuScrollTop(40, 120, 12, 32), 12);
  assert.equal(mentionMenuScrollTop(40, 120, 148, 32), 60);
});

test("deletes inserted mentions as one textarea unit", () => {
  const tokens = ["@所有人", "@AI", "@alice", "@al"];

  assert.deepEqual(
    deleteAtomicMentionAtCaret("请 @alice 处理", 9, 9, "backward", tokens),
    { value: "请 处理", caret: 2, deleted: "@alice " },
  );
  assert.deepEqual(
    deleteAtomicMentionAtCaret("@AI 帮我", 0, 0, "forward", tokens),
    { value: "帮我", caret: 0, deleted: "@AI " },
  );
  assert.deepEqual(
    deleteAtomicMentionAtCaret("通知 @所有人 ", 3, 3, "forward", tokens),
    { value: "通知 ", caret: 3, deleted: "@所有人 " },
  );
  assert.deepEqual(
    deleteAtomicMentionAtCaret("引用 @「夏季上新 计划」 继续", 14, 14, "backward", tokens),
    { value: "引用 继续", caret: 3, deleted: "@「夏季上新 计划」 " },
  );
});

test("atomic mention deletion preserves selections and non-mention text", () => {
  const tokens = ["@AI", "@al"];
  assert.equal(deleteAtomicMentionAtCaret("@AI hello", 0, 3, "backward", tokens), null);
  assert.equal(deleteAtomicMentionAtCaret("hello", 5, 5, "backward", tokens), null);
  assert.equal(deleteAtomicMentionAtCaret("@alice ", 7, 7, "backward", tokens), null);
});

test("partitions multiple Xiaoce tasks without reordering either group", () => {
  const rooms = [
    { id: "task-a", room_kind: "dm", participants: [{ bot_id: "xiaoce" }] },
    { id: "person", room_kind: "dm", participants: [{ username: "同事" }] },
    { id: "task-b", room_kind: "dm", participants: [{ username: "小策bot" }] },
    { id: "group", room_kind: "group", participants: [{ username: "小策bot" }] },
  ];

  const result = partitionXiaoceRooms(rooms);

  assert.deepEqual(result.xiaoceTasks.map((room) => room.id), ["task-a", "task-b"]);
  assert.deepEqual(result.otherRooms.map((room) => room.id), ["person", "group"]);
});

test("places unread conversations first and sorts equal unread counts by recency", () => {
  const result = partitionXiaoceRooms([
    {
      id: "read-new",
      room_kind: "dm",
      unread_count: 0,
      updated_at: "2026-07-24T10:00:00Z",
      participants: [{ username: "甲" }],
    },
    {
      id: "unread-old",
      room_kind: "dm",
      unread_count: 1,
      updated_at: "2026-07-24T08:00:00Z",
      participants: [{ username: "乙" }],
    },
    {
      id: "unread-new",
      room_kind: "dm",
      unread_count: 3,
      updated_at: "2026-07-24T09:00:00Z",
      participants: [{ username: "丙" }],
    },
  ]);

  assert.deepEqual(
    result.otherRooms.map((room) => room.id),
    ["unread-new", "unread-old", "read-new"],
  );
});

test("API client exposes the dedicated Xiaoce task endpoint", () => {
  const source = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.ok(source.includes("export const createXiaoceTask"));
  assert.ok(source.includes('api.post<CollabRoom>("/collab/xiaoce-tasks/"'));
});

test("Xiaoce task list exposes create, select, rename, delete, running, and all-task states", () => {
  const source = readFileSync(
    new URL("../src/components/XiaoceTaskList.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('aria-label="新建小策bot任务"'));
  assert.ok(source.includes("处理中"));
  assert.ok(source.includes("修改任务名称"));
  assert.ok(source.includes("删除任务"));
  assert.ok(source.includes("onSelect(task.id)"));
  assert.ok(source.includes("展开所有任务"));
  assert.ok(source.includes("收起所有任务"));
  assert.ok(source.includes("onOpenChange={setAllTasksOpen}"));
  assert.ok(source.includes('role="dialog"'));
});

test("Xiaoce task list styles use semantic theme variables", () => {
  const css = readFileSync(
    new URL("../src/styles/xiaoceTaskList.css", import.meta.url),
    "utf8",
  );
  assert.ok(css.includes("var(--lc-surface"));
  assert.ok(css.includes("var(--lc-border"));
  assert.ok(css.includes("var(--lc-ink)"));
  assert.ok(css.includes(".xiaoce-all-tasks-popover"));
  assert.ok(css.includes("var(--lc-surface-overlay)"));
  assert.ok(css.includes(":focus-visible"));
});

test("creates a UUID v4 for each Xiaoce run", () => {
  const first = createXiaoceRunId();
  const second = createXiaoceRunId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first, second);
});

test("keeps the newest Xiaoce run snapshot", () => {
  const current = {
    id: "run-1",
    room_id: "room-1",
    status: "running" as const,
    current_stage: "understanding",
    progress_steps: [],
    error_code: "",
    error_message: "",
    created_at: "2026-07-17T10:00:00Z",
    updated_at: "2026-07-17T10:00:02Z",
  };
  const stale = { ...current, updated_at: "2026-07-17T10:00:01Z" };
  const completed = {
    ...current,
    status: "completed" as const,
    updated_at: "2026-07-17T10:00:03Z",
  };

  assert.equal(mergeXiaoceRunSnapshot(current, stale), current);
  assert.deepEqual(mergeXiaoceRunSnapshot(current, completed), completed);
  assert.equal(
    mergeXiaoceRunSnapshot(current, null, { authoritative: true }),
    null,
  );
});

test("an older terminal run cannot replace a newer running run", () => {
  const newerRunning = {
    id: "run-b",
    room_id: "room-1",
    status: "running" as const,
    current_stage: "understanding",
    progress_steps: [],
    error_code: "",
    error_message: "",
    created_at: "2026-07-20T10:05:00Z",
    updated_at: "2026-07-20T10:05:01Z",
  };
  const delayedTerminal = {
    ...newerRunning,
    id: "run-a",
    status: "completed" as const,
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:06:00Z",
  };

  assert.equal(mergeXiaoceRunSnapshot(newerRunning, delayedTerminal), newerRunning);
});

test("only an authoritative current-generation null clears a Xiaoce run", () => {
  const running = {
    id: "run-b",
    room_id: "room-1",
    status: "running" as const,
    current_stage: "understanding",
    progress_steps: [],
    error_code: "",
    error_message: "",
    created_at: "2026-07-20T10:05:00Z",
    updated_at: "2026-07-20T10:05:01Z",
  };

  assert.equal(
    mergeXiaoceRunSnapshot(running, null, {
      authoritative: true,
      requestRevision: 3,
      currentRevision: 4,
    }),
    running,
  );
  assert.equal(
    mergeXiaoceRunSnapshot(running, null, {
      authoritative: true,
      requestRevision: 4,
      currentRevision: 4,
    }),
    null,
  );
});

test("transient empty snapshots cannot hide a running Xiaoce process", () => {
  const running = {
    id: "run-live",
    room_id: "room-1",
    status: "running" as const,
    current_stage: "understanding",
    progress_steps: [],
    error_code: "",
    error_message: "",
    created_at: "2026-07-21T08:00:00Z",
    updated_at: "2026-07-21T08:00:01Z",
  };

  assert.equal(stabilizeXiaoceRunSnapshot(running, null, []), running);
  assert.equal(
    stabilizeXiaoceRunSnapshot(running, null, [{
      meta: { run_id: "another-run", process_status: "completed" },
    }]),
    running,
  );
});

test("terminal evidence clears only its matching Xiaoce run", () => {
  const running = {
    id: "run-live",
    room_id: "room-1",
    status: "running" as const,
    current_stage: "composing",
    progress_steps: [],
    error_code: "",
    error_message: "",
    created_at: "2026-07-21T08:00:00Z",
    updated_at: "2026-07-21T08:00:03Z",
  };
  const terminalMessage = {
    meta: { run_id: running.id, process_status: "completed" as const },
  };

  assert.equal(hasXiaoceRunTerminalMessage([terminalMessage], running.id), true);
  assert.equal(stabilizeXiaoceRunSnapshot(running, null, [terminalMessage]), null);
  const completed = { ...running, status: "completed" as const, updated_at: "2026-07-21T08:00:04Z" };
  assert.equal(stabilizeXiaoceRunSnapshot(running, completed, []), completed);
});

test("late room detail preserves messages and run updates created after request start", async () => {
  const reconcileDetail = (xiaoceChatHelpers as Record<string, unknown>)
    .reconcileRoomDetailSnapshot as ((input: Record<string, any>) => {
      messages: Array<Record<string, any>>;
      xiaoceRun: Record<string, any> | null;
    }) | undefined;
  assert.equal(typeof reconcileDetail, "function");

  const pageMessage = {
    id: 10,
    content: "before",
    status: "normal",
    updated_at: "2026-07-20T10:00:01Z",
  };
  const liveEdit = {
    ...pageMessage,
    content: "live edit",
    updated_at: "2026-07-20T10:00:03Z",
  };
  const sentAfterStart = {
    id: 11,
    content: "sent after detail started",
    status: "normal",
    updated_at: "2026-07-20T10:00:04Z",
  };
  const deletedAfterStart = {
    id: 12,
    content: "deleted while detail was loading",
    status: "normal",
    updated_at: "2026-07-20T10:00:01Z",
  };
  const olderRun = {
    id: "run-a",
    status: "completed",
    created_at: "2026-07-20T09:59:00Z",
    updated_at: "2026-07-20T10:00:05Z",
  };
  const newerRun = {
    id: "run-b",
    status: "running",
    created_at: "2026-07-20T10:00:02Z",
    updated_at: "2026-07-20T10:00:04Z",
  };
  let resolveDetail!: () => void;
  const delayedDetail = new Promise<void>((resolve) => { resolveDetail = resolve; });
  const resolved = delayedDetail.then(() => reconcileDetail!({
    pageMessages: [pageMessage, deletedAfterStart],
    currentMessages: [liveEdit, sentAfterStart],
    requestStartMessageIds: [10, 12],
    pageRun: olderRun,
    currentRun: newerRun,
    requestRevision: 7,
    currentRevision: 9,
  }));

  resolveDetail();
  const result = await resolved;

  assert.deepEqual(result.messages.map((row) => [row.id, row.content]), [
    [10, "live edit"],
    [11, "sent after detail started"],
  ]);
  assert.equal(result.xiaoceRun, newerRun);
});

function deferredRoomMutationHarness() {
  const applyMutation = (xiaoceChatHelpers as Record<string, unknown>)
    .applyRoomMutation as ((state: Record<string, any>, mutation: Record<string, any>) => Record<string, any>) | undefined;
  const reconcileDetail = (xiaoceChatHelpers as Record<string, unknown>)
    .reconcileRoomDetailSnapshot as ((input: Record<string, any>) => {
      messages: Array<Record<string, any>>;
      xiaoceRun: Record<string, any> | null;
    }) | undefined;
  assert.equal(typeof applyMutation, "function");
  assert.equal(typeof reconcileDetail, "function");
  const room = {
    id: "room-a",
    active_xiaoce_run: null,
  };
  const original = {
    id: 10,
    room_id: "room-a",
    content: "original",
    status: "normal",
    updated_at: "2026-07-20T10:00:01Z",
  };
  return {
    applyMutation: applyMutation!,
    reconcileDetail: reconcileDetail!,
    requestRevision: 3,
    pageMessages: [original],
    state: {
      roomId: "room-a",
      revision: 3,
      rooms: [room],
      cache: new Map([["room-a", {
        room,
        messages: [original],
        xiaoceRun: null,
      }]]),
      activeRoomId: "room-a",
      activeRoom: room,
      activeMessages: [original],
      activeRun: null,
    },
  };
}

test("detail started before recall preserves the recalled message", async () => {
  const harness = deferredRoomMutationHarness();
  const recalled = {
    ...harness.pageMessages[0],
    content: "",
    status: "recalled",
    updated_at: "2026-07-20T10:00:04Z",
  };
  const next = harness.applyMutation(harness.state, {
    messages: (current: Array<Record<string, any>>) => current.map((message) => (
      message.id === recalled.id ? recalled : message
    )),
  });
  await Promise.resolve();
  const resolved = harness.reconcileDetail({
    pageMessages: harness.pageMessages,
    currentMessages: next.activeMessages,
    requestStartMessageIds: [10],
    pageRun: null,
    currentRun: next.activeRun,
    requestRevision: harness.requestRevision,
    currentRevision: next.revision,
  });
  assert.equal(resolved.messages[0].status, "recalled");
});

test("detail started before delete cannot restore the deleted message", async () => {
  const harness = deferredRoomMutationHarness();
  const next = harness.applyMutation(harness.state, {
    messages: (current: Array<Record<string, any>>) => current.filter((message) => message.id !== 10),
  });
  await Promise.resolve();
  const resolved = harness.reconcileDetail({
    pageMessages: harness.pageMessages,
    currentMessages: next.activeMessages,
    requestStartMessageIds: [10],
    pageRun: null,
    currentRun: next.activeRun,
    requestRevision: harness.requestRevision,
    currentRevision: next.revision,
  });
  assert.deepEqual(resolved.messages, []);
});

test("detail started before send success preserves returned message and new run", async () => {
  const harness = deferredRoomMutationHarness();
  const sent = {
    id: 11,
    room_id: "room-a",
    content: "sent",
    status: "normal",
    updated_at: "2026-07-20T10:00:04Z",
  };
  const run = {
    id: "run-new",
    room_id: "room-a",
    status: "running",
    created_at: "2026-07-20T10:00:04Z",
    updated_at: "2026-07-20T10:00:04Z",
  };
  const next = harness.applyMutation(harness.state, {
    messages: (current: Array<Record<string, any>>) => [...current, sent],
    room: (current: Record<string, any>) => ({ ...current, active_xiaoce_run: run }),
    xiaoceRun: () => run,
  });
  await Promise.resolve();
  const resolved = harness.reconcileDetail({
    pageMessages: harness.pageMessages,
    currentMessages: next.activeMessages,
    requestStartMessageIds: [10],
    pageRun: null,
    currentRun: next.activeRun,
    requestRevision: harness.requestRevision,
    currentRevision: next.revision,
  });
  assert.deepEqual(resolved.messages.map((message) => message.id), [10, 11]);
  assert.equal(resolved.xiaoceRun, run);
});

test("detail started before cancellation preserves cancellation response state", async () => {
  const harness = deferredRoomMutationHarness();
  const running = {
    id: "run-a",
    room_id: "room-a",
    status: "running",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-20T10:00:02Z",
  };
  harness.state.activeRun = running;
  harness.state.activeRoom = { ...harness.state.activeRoom, active_xiaoce_run: running };
  harness.state.cache.get("room-a").xiaoceRun = running;
  const cancellation = {
    id: 12,
    room_id: "room-a",
    content: "paused",
    status: "normal",
    updated_at: "2026-07-20T10:00:05Z",
  };
  const next = harness.applyMutation(harness.state, {
    messages: (current: Array<Record<string, any>>) => [...current, cancellation],
    room: (current: Record<string, any>) => ({ ...current, active_xiaoce_run: null }),
    xiaoceRun: () => null,
  });
  await Promise.resolve();
  const resolved = harness.reconcileDetail({
    pageMessages: harness.pageMessages,
    currentMessages: next.activeMessages,
    requestStartMessageIds: [10],
    pageRun: running,
    currentRun: next.activeRun,
    requestRevision: harness.requestRevision,
    currentRevision: next.revision,
  });
  assert.deepEqual(resolved.messages.map((message) => message.id), [10, 12]);
  assert.equal(resolved.xiaoceRun, null);
});

test("deferred room A pagination updates only A after selecting room B", async () => {
  const isSelectionCurrent = (xiaoceChatHelpers as Record<string, unknown>)
    .isRoomSelectionCurrent as ((
      activeRoomId: string | null,
      currentGeneration: number,
      targetRoomId: string,
      targetGeneration: number,
    ) => boolean) | undefined;
  const mergeOlderPage = (xiaoceChatHelpers as Record<string, unknown>)
    .mergeOlderRoomPage as ((
      current: { messages: Array<{ id: number }>; hasMoreBefore: boolean; firstItemIndex: number },
      page: { results: Array<{ id: number }>; has_more_before?: boolean },
    ) => { messages: Array<{ id: number }>; hasMoreBefore: boolean; firstItemIndex: number }) | undefined;
  assert.equal(typeof isSelectionCurrent, "function");
  assert.equal(typeof mergeOlderPage, "function");

  let activeRoomId: string | null = "room-a";
  let generation = 12;
  const targetGeneration = generation;
  const cache = new Map([
    ["room-a", { messages: [{ id: 5 }], hasMoreBefore: true, firstItemIndex: 100 }],
    ["room-b", { messages: [{ id: 50 }], hasMoreBefore: false, firstItemIndex: 200 }],
  ]);
  let visible = cache.get("room-a")!;
  let resolvePage!: (page: { results: Array<{ id: number }>; has_more_before: boolean }) => void;
  const pageRequest = new Promise<{ results: Array<{ id: number }>; has_more_before: boolean }>(
    (resolve) => { resolvePage = resolve; },
  );
  const completion = pageRequest.then((page) => {
    const nextA = mergeOlderPage!(cache.get("room-a")!, page);
    cache.set("room-a", nextA);
    if (isSelectionCurrent!(activeRoomId, generation, "room-a", targetGeneration)) {
      visible = nextA;
    }
  });

  activeRoomId = "room-b";
  generation += 1;
  visible = cache.get("room-b")!;
  resolvePage({ results: [{ id: 3 }, { id: 4 }], has_more_before: false });
  await completion;

  assert.deepEqual(cache.get("room-a")!.messages.map((row) => row.id), [3, 4, 5]);
  assert.deepEqual(cache.get("room-b")!.messages.map((row) => row.id), [50]);
  assert.deepEqual(visible.messages.map((row) => row.id), [50]);
});

test("room A async completion cannot mutate room B", async () => {
  const isCurrent = (xiaoceChatHelpers as Record<string, unknown>)
    .isRoomAsyncResultCurrent as ((activeId: string | null, targetId: string) => boolean) | undefined;
  assert.equal(typeof isCurrent, "function");

  let activeId: string | null = "room-a";
  let visibleDraft = "A draft";
  let resolveRequest!: (value: string) => void;
  const request = new Promise<string>((resolve) => { resolveRequest = resolve; });
  const completion = request.then((value) => {
    if (isCurrent!(activeId, "room-a")) visibleDraft = value;
  });

  activeId = "room-b";
  visibleDraft = "B draft";
  resolveRequest("A restored");
  await completion;

  assert.equal(visibleDraft, "B draft");
});

test("pending sends are tracked independently by room", () => {
  const setRoomPending = (xiaoceChatHelpers as Record<string, unknown>)
    .setRoomPending as ((current: ReadonlySet<string>, roomId: string, pending: boolean) => Set<string>) | undefined;
  assert.equal(typeof setRoomPending, "function");

  const roomAStarted = setRoomPending!(new Set(), "room-a", true);
  assert.equal(roomAStarted.has("room-a"), true);
  assert.equal(roomAStarted.has("room-b"), false);
  const roomBStarted = setRoomPending!(roomAStarted, "room-b", true);
  const roomAFinished = setRoomPending!(roomBStarted, "room-a", false);
  assert.deepEqual([...roomAFinished], ["room-b"]);
});

test("room composer transition restores A reply and history reference after A to B to A", () => {
  type ReplyTarget = { id: number; content: string };
  type ReferenceTarget = { id: string; title: string };
  type Composer = {
    draft: string;
    pendingFiles: string[];
    replyingTo: ReplyTarget | null;
    referencedRoom: ReferenceTarget | null;
  };
  const transitionComposer = (xiaoceChatHelpers as Record<string, unknown>)
    .transitionRoomComposer as ((
      cache: ReadonlyMap<string, Composer>,
      previousRoomId: string | null,
      destinationRoomId: string,
      current: Composer,
    ) => { cache: Map<string, Composer>; composer: Composer }) | undefined;
  assert.equal(typeof transitionComposer, "function");

  const replyA = { id: 17, content: "A 基础消息" };
  const referenceA = { id: "room-history", title: "A 历史任务" };
  const emptyCache = new Map<string, Composer>();
  const toB = transitionComposer!(emptyCache, "room-a", "room-b", {
    draft: "A draft",
    pendingFiles: ["a.txt"],
    replyingTo: replyA,
    referencedRoom: referenceA,
  });

  assert.notEqual(toB.cache, emptyCache);
  assert.equal(emptyCache.has("room-a"), false);
  assert.deepEqual(toB.composer, {
    draft: "",
    pendingFiles: [],
    replyingTo: null,
    referencedRoom: null,
  });

  const backToA = transitionComposer!(toB.cache, "room-b", "room-a", {
    draft: "B draft",
    pendingFiles: [],
    replyingTo: null,
    referencedRoom: null,
  });

  assert.equal(backToA.composer.replyingTo, replyA);
  assert.equal(backToA.composer.referencedRoom, referenceA);
  assert.equal(backToA.composer.draft, "A draft");
  assert.deepEqual(backToA.composer.pendingFiles, ["a.txt"]);
});

test("room selection synchronously invalidates an earlier load", async () => {
  const beginSelection = (xiaoceChatHelpers as Record<string, unknown>)
    .beginRoomSelection as ((
      activeRef: { current: string | null },
      generationRef: { current: number },
      roomId: string,
    ) => string | null) | undefined;
  const isGenerationCurrent = (xiaoceChatHelpers as Record<string, unknown>)
    .isLiveGenerationCurrent as ((current: number, expected: number, stopped: boolean) => boolean) | undefined;
  assert.equal(typeof beginSelection, "function");
  assert.equal(typeof isGenerationCurrent, "function");

  const activeRef = { current: "room-a" as string | null };
  const generationRef = { current: 4 };
  const oldGeneration = generationRef.current;
  const previous = beginSelection!(activeRef, generationRef, "room-new");

  await Promise.resolve();
  assert.equal(previous, "room-a");
  assert.equal(activeRef.current, "room-new");
  assert.equal(generationRef.current, 5);
  assert.equal(isGenerationCurrent!(generationRef.current, oldGeneration, false), false);
});

test("stale live generations are rejected after a room switch", async () => {
  const isGenerationCurrent = (xiaoceChatHelpers as Record<string, unknown>)
    .isLiveGenerationCurrent as ((current: number, expected: number, stopped: boolean) => boolean) | undefined;
  assert.equal(typeof isGenerationCurrent, "function");

  let generation = 8;
  let applied = "room-b";
  let resolvePoll!: () => void;
  const poll = new Promise<void>((resolve) => { resolvePoll = resolve; });
  const oldCompletion = poll.then(() => {
    if (isGenerationCurrent!(generation, 8, false)) applied = "room-a";
  });
  generation = 9;
  resolvePoll();
  await oldCompletion;

  assert.equal(applied, "room-b");
  assert.equal(isGenerationCurrent!(9, 9, true), false);
});

test("active Xiaoce running detection prefers live active state", () => {
  const isRunning = (xiaoceChatHelpers as Record<string, unknown>)
    .isXiaoceTaskRunning as ((
      listed: { id: string; active_xiaoce_run?: { status?: string } | null },
      activeRoom: { id: string; active_xiaoce_run?: { status?: string } | null } | null,
      activeRun: { status?: string } | null,
    ) => boolean) | undefined;
  assert.equal(typeof isRunning, "function");

  const listed = { id: "task-a", active_xiaoce_run: null };
  const activeRoom = { id: "task-a", active_xiaoce_run: null };
  assert.equal(isRunning!(listed, activeRoom, { status: "running" }), true);
  assert.equal(isRunning!(listed, { id: "task-b" }, { status: "running" }), false);
  assert.equal(
    isRunning!(
      listed,
      { id: "task-a", active_xiaoce_run: { status: "running" } },
      { status: "completed" },
    ),
    false,
  );
});

test("inactive Xiaoce deletion waits for authoritative running status and exact copy", async () => {
  const resolveDeleteState = (xiaoceChatHelpers as Record<string, unknown>)
    .resolveXiaoceDeleteState as ((
      roomId: string,
      loadRoom: (roomId: string) => Promise<{
        id: string;
        active_xiaoce_run?: { status?: string } | null;
      }>,
    ) => Promise<{ room: { id: string }; running: boolean }>) | undefined;
  const deleteContent = (xiaoceChatHelpers as Record<string, unknown>)
    .xiaoceDeleteContent as ((running: boolean) => string) | undefined;
  assert.equal(typeof resolveDeleteState, "function");
  assert.equal(typeof deleteContent, "function");

  let resolveRoom!: (room: {
    id: string;
    active_xiaoce_run?: { status?: string } | null;
  }) => void;
  const roomRequest = new Promise<{
    id: string;
    active_xiaoce_run?: { status?: string } | null;
  }>((resolve) => { resolveRoom = resolve; });
  let settled = false;
  const statePromise = resolveDeleteState!("task-inactive", async () => roomRequest)
    .then((state) => {
      settled = true;
      return state;
    });

  await Promise.resolve();
  assert.equal(settled, false);
  resolveRoom({ id: "task-inactive", active_xiaoce_run: { status: "running" } });
  const state = await statePromise;

  assert.equal(state.running, true);
  assert.equal(
    deleteContent!(state.running),
    "将永久删除该任务及全部聊天记录，正在处理的任务也会停止。",
  );
});

test("delayed send success cannot regress a completed live run snapshot", () => {
  const mergeSnapshots = (xiaoceChatHelpers as Record<string, unknown>)
    .mergeXiaoceRunSnapshots as ((incoming: Record<string, unknown>, snapshots: Record<string, unknown>[]) => Record<string, unknown>) | undefined;
  assert.equal(typeof mergeSnapshots, "function");
  const delayedRunning = {
    id: "run-a",
    status: "running",
    updated_at: "2026-07-20T10:00:02Z",
  };
  const liveCompleted = {
    ...delayedRunning,
    status: "completed",
    updated_at: "2026-07-20T10:00:05Z",
  };

  const merged = mergeSnapshots!(delayedRunning, [liveCompleted]);

  assert.equal(merged, liveCompleted);
  assert.deepEqual(
    ["rooms", "cache", "ref", "active"].map(() => merged.status),
    ["completed", "completed", "completed", "completed"],
  );
});

test("delayed 409 snapshot cannot regress a completed live run snapshot", () => {
  const mergeSnapshots = (xiaoceChatHelpers as Record<string, unknown>)
    .mergeXiaoceRunSnapshots as ((incoming: Record<string, unknown>, snapshots: Record<string, unknown>[]) => Record<string, unknown>) | undefined;
  assert.equal(typeof mergeSnapshots, "function");
  const delayedPending = {
    id: "run-a",
    status: "running",
    updated_at: "2026-07-20T10:00:03Z",
  };
  const liveCompleted = {
    ...delayedPending,
    status: "completed",
    updated_at: "2026-07-20T10:00:06Z",
  };

  const merged = mergeSnapshots!(delayedPending, [liveCompleted]);

  assert.equal(merged, liveCompleted);
  assert.deepEqual(
    ["rooms", "cache", "ref", "active"].map(() => merged.status),
    ["completed", "completed", "completed", "completed"],
  );
});

test("older running snapshots cannot replace any terminal run state", () => {
  const mergeSnapshots = (xiaoceChatHelpers as Record<string, unknown>)
    .mergeXiaoceRunSnapshots as ((incoming: Record<string, unknown>, snapshots: Record<string, unknown>[]) => Record<string, unknown>) | undefined;
  assert.equal(typeof mergeSnapshots, "function");
  const delayedRunning = {
    id: "run-terminal",
    status: "running",
    updated_at: "2026-07-20T10:00:02Z",
  };

  for (const status of ["completed", "cancelled", "failed"]) {
    const terminal = {
      ...delayedRunning,
      status,
      updated_at: "2026-07-20T10:00:05Z",
    };
    assert.equal(mergeSnapshots!(delayedRunning, [terminal]), terminal);
  }
});

test("process component uses server snapshots and the required collapsed label", () => {
  const source = readFileSync(
    new URL("../src/components/XiaoceProcess.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /查看思考与执行过程（\{visibleSteps\.length\}步）/);
  assert.match(source, /正在理解你的问题/);
  assert.match(source, /live \? \[\{/);
  assert.match(source, /aria-expanded/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test("API types include durable Xiaoce progress and realtime snapshots", () => {
  const source = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.match(source, /export interface XiaoceProgressStep/);
  assert.match(source, /export interface XiaoceRun/);
  assert.match(source, /export interface XiaoceStreamUpdate/);
  assert.match(source, /xiaoce_runs\?: XiaoceRun\[\]/);
  assert.match(source, /xiaoce_streams\?: XiaoceStreamUpdate\[\]/);
  assert.match(source, /cancelXiaoceRun/);
  assert.match(source, /context_room_ids/);
  assert.match(source, /context_rooms\?: CollabContextRoomRef\[\]/);
});

test("collaboration chat wires Xiaoce progress, pause, history, and skill refresh", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  assert.match(source, /activeXiaoceRun/);
  assert.match(source, /cancelXiaoceRun/);
  assert.match(source, /<XiaoceProcess/);
  assert.match(source, /process_steps/);
  assert.match(source, /created_skill/);
  assert.match(source, /refreshKey=\{skillRefreshKey\}/);
  assert.match(source, /aria-label="暂停小策处理"/);
  assert.match(source, /findXiaoceReferenceRooms/);
  assert.match(source, /已引用小策历史任务/);
});

test("collaboration chat wires grouped Xiaoce task actions", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("<XiaoceTaskList"));
  assert.ok(source.includes("partitionXiaoceRooms(rooms)"));
  assert.ok(source.includes("createXiaoceTask()"));
  assert.ok(source.includes("roomComposerCacheRef.current.delete(id)"));
  assert.ok(source.includes("roomViewCacheRef.current.delete(id)"));
  assert.ok(source.includes("xiaoceDeleteContent(running)"));
  assert.ok(source.includes("修改任务名称"));
});

test("collaboration chat targets rename and delete by captured room id", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  assert.match(source, /const roomId = renameTargetId;/);
  assert.match(source, /updateCollabRoom\(roomId, \{ title: next \}\)/);
  assert.match(source, /activeIdRef\.current === roomId/);
  assert.match(source, /const listedTarget = rooms\.find\(\(room\) => room\.id === id\)/);
  assert.match(source, /const target = activeRoom\?\.id === id \? activeRoom : listedTarget;/);
  assert.match(source, /isXiaoceTaskRunning\(/);
  assert.match(source, /activeIdRef\.current === id/);
});

test("collaboration chat wires room-scoped async send and selection guards", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  const selectionSource = source.slice(
    source.indexOf("const selectRoom"),
    source.indexOf("const refreshStats"),
  );
  assert.match(source, /sendingRoomIds/);
  assert.match(source, /targetRoomId/);
  assert.match(source, /isRoomAsyncResultCurrent\(activeIdRef\.current, targetRoomId\)/);
  assert.match(source, /roomsRef\.current\.some\(\(room\) => room\.id === targetRoomId\)/);
  assert.match(source, /beginRoomSelection\(activeIdRef, roomLoadSeqRef, roomId\)/);
  assert.match(selectionSource, /transitionRoomComposer\(/);
  assert.match(selectionSource, /referencedRoom: referencedRoomRef\.current/);
  assert.match(selectionSource, /setStatsLoading\(false\)/);
  assert.match(
    source,
    /sendPlainMessage\([\s\S]*?targetRoomId,[\s\S]*?content,[\s\S]*?files,[\s\S]*?previews,[\s\S]*?replyTarget,[\s\S]*?contextRoom,[\s\S]*?\)/,
  );
  assert.doesNotMatch(source, /const \[sending, setSending\] = useState\(false\)/);
});

test("active room detail loading does not clear a restored reply target", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  const effectStart = source.indexOf("useEffect(() => {\n    if (!activeId) return;\n    setRooms");
  const effectEnd = source.indexOf("// 消息级已读回执");
  assert.ok(effectStart >= 0);
  assert.ok(effectEnd > effectStart);
  const activeRoomEffect = source.slice(effectStart, effectEnd);
  assert.doesNotMatch(activeRoomEffect, /setReplyingTo\(null\)/);
});

test("collaboration chat refreshes Xiaoce state before opening delete confirmation", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  const deleteSource = source.slice(
    source.indexOf("const handleDeleteRoom"),
    source.indexOf("const handleRefreshInsight"),
  );
  const xiaoceBranch = deleteSource.indexOf("if (xiaoceTask) {");
  const authoritativeFetch = deleteSource.indexOf("resolveXiaoceDeleteState(id, getCollabRoom)");
  const confirmation = deleteSource.indexOf("Modal.confirm");
  assert.ok(xiaoceBranch >= 0);
  assert.ok(authoritativeFetch > xiaoceBranch);
  assert.ok(confirmation > authoritativeFetch);
  assert.match(deleteSource, /无法确认任务状态，请重试/);
  assert.match(
    deleteSource.slice(deleteSource.indexOf("catch (error: any)"), confirmation),
    /return;/,
  );
  assert.match(deleteSource, /xiaoceDeleteContent\(running\)/);
});

test("send success and pending failure publish one merged run snapshot to every store", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  const sendSource = source.slice(
    source.indexOf("const sendPlainMessage"),
    source.indexOf("const handleSend"),
  );
  assert.match(sendSource, /mergeXiaoceRunSnapshots/);
  assert.match(sendSource, /mergedRun/);
  assert.match(sendSource, /mergedPendingRun/);
  assert.match(sendSource, /mutateRoomData\(targetRoomId/);
  assert.match(sendSource, /xiaoceRun: \(\) => mergedRun/);
  assert.match(sendSource, /xiaoceRun: \(\) => mergedPendingRun/);
  assert.doesNotMatch(sendSource, /active_xiaoce_run: pendingRun/);
  assert.doesNotMatch(sendSource, /\? res\.room\.active_xiaoce_run/);
});

test("authoritative callbacks use the synchronous room mutation transition", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  const sections = [
    ["const sendPlainMessage", "const handleSend"],
    ["const pauseXiaoce", "const runDraftCoach"],
    ["const handleRecallMessage", "const addFiles"],
    ["const handleDeleteRoom", "const handleRefreshInsight"],
  ];
  for (const [start, end] of sections) {
    const section = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(section, /mutateRoomData\(/, `${start} must use mutateRoomData`);
  }
});

test("collaboration live hook gates every room effect by local generation", () => {
  const source = readFileSync(
    new URL("../src/hooks/useCollabRoomLive.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /generationRef/);
  assert.match(source, /isLiveGenerationCurrent/);
  assert.match(source, /isRoomCurrent\(roomId\)/);
  assert.doesNotMatch(source, /aliveRef/);
});

test("Xiaoce deletion clears caches only after success and after selecting its successor", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  const deleteHandler = source.slice(
    source.indexOf("const handleDeleteRoom"),
    source.indexOf("const handleRefreshInsight"),
  );
  const apiSuccess = deleteHandler.indexOf("await deleteCollabRoom(id)");
  const selectSuccessor = deleteHandler.indexOf("selectRoom(nextTask.id)");
  const composerDelete = deleteHandler.indexOf("roomComposerCacheRef.current.delete(id)");
  const viewDelete = deleteHandler.indexOf("roomViewCacheRef.current.delete(id)");

  assert.ok(apiSuccess >= 0);
  assert.ok(selectSuccessor > apiSuccess);
  assert.ok(composerDelete > selectSuccessor);
  assert.ok(viewDelete > composerDelete);
});

test("collaboration live hook forwards Xiaoce snapshots from websocket and fallback polling", () => {
  const source = readFileSync(
    new URL("../src/hooks/useCollabRoomLive.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /onXiaoceRuns/);
  assert.match(source, /data\.xiaoce_runs/);
  assert.match(source, /active_xiaoce_run/);
  assert.match(source, /onXiaoceStreams/);
  assert.match(source, /data\.xiaoce_streams/);
});

test("collaboration chat stabilizes empty Xiaoce snapshots before rendering", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  assert.match(source, /stabilizeXiaoceRunSnapshot/);
  assert.match(source, /stablePageRun/);
  assert.match(source, /stableNewest/);
});

test("Xiaoce process presentation has dedicated responsive styles", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  assert.match(source, /\.xiaoce-process/);
  assert.match(source, /\.xiaoce-stream-message/);
  assert.match(source, /\.xiaoce-created-skill/);
  const processStyles = source.slice(
    source.indexOf(".xiaoce-stream-footer {"),
    source.indexOf(".collab-agent-composer {"),
  );
  assert.match(processStyles, /xiaoce-stream-bubble/);
  assert.match(processStyles, /var\(--lc-text-muted/);
  assert.match(processStyles, /xiaoce-stream-thinking/);
});

test("Xiaoce bot and user messages anchor left and right while streaming stays in the conversation", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  const streamingSource = readFileSync(
    new URL("../src/components/XiaoceStreamingMessage.tsx", import.meta.url),
    "utf8",
  );
  const theme = readFileSync(
    new URL("../src/styles/xiaoceChatTheme.css", import.meta.url),
    "utf8",
  );
  const layoutStyles = theme.slice(
    theme.indexOf("/* Let message rows"),
    theme.indexOf(".xiaoce-chat-shell .collab-msg.ai"),
  );
  const messageRowRule = layoutStyles.match(
    /\.xiaoce-chat-shell \.collab-virt-item\s*\{([^}]*)\}/,
  )?.[1] || "";
  const boundedControlRule = layoutStyles.match(
    /\.xiaoce-chat-shell \.collab-agent-input-inner\s*\{([^}]*)\}/,
  )?.[1] || "";

  assert.doesNotMatch(source, /className="xiaoce-live-process"/);
  assert.match(source, /<XiaoceStreamingMessage/);
  assert.match(streamingSource, /className="xiaoce-stream-message"/);
  assert.match(streamingSource, /Hermes 正在思考并组织回答/);
  assert.match(source, /className="collab-agent-input-inner"/);
  assert.match(source, /\.collab-msg\.mine\s*\{[^}]*margin-left:\s*auto/);
  assert.match(messageRowRule, /margin-inline:\s*var\(--xiaoce-chat-column-gutter\)/);
  assert.doesNotMatch(messageRowRule, /width:\s*min\(/);
  assert.match(boundedControlRule, /width:\s*min\(/);
  assert.match(boundedControlRule, /calc\(100% - var\(--xiaoce-chat-column-gutter\)/);
  assert.match(boundedControlRule, /margin-inline:\s*auto/);
  assert.match(theme, /--xiaoce-chat-scrollbar-width:\s*10px/);
  assert.match(messageRowRule, /padding-inline:\s*0/);
  assert.match(
    theme,
    /:root\[data-theme\] \.xiaoce-chat-shell \.collab-agent-input,[\s\S]*background:\s*transparent !important/,
  );
  assert.match(
    theme,
    /\.xiaoce-chat-shell \.collab-msg\.ai \.collab-msg-name-text[\s\S]*flex:\s*0 0 auto/,
  );
  assert.match(theme, /\.xiaoce-chat-shell \.xiaoce-stream-footer/);
  assert.match(theme, /@media \(max-width: 860px\)[\s\S]*--xiaoce-chat-column-gutter:\s*10px/);
});
