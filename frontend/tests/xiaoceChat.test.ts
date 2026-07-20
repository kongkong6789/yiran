import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  createXiaoceRunId,
  isXiaoceRoom,
  mergeXiaoceRunSnapshot,
  partitionXiaoceRooms,
} from "../src/pages/xiaoceChat.ts";


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

test("API client exposes the dedicated Xiaoce task endpoint", () => {
  const source = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.ok(source.includes("export const createXiaoceTask"));
  assert.ok(source.includes('api.post<CollabRoom>("/collab/xiaoce-tasks/"'));
});

test("Xiaoce task list exposes create, select, rename, delete, and running state", () => {
  const source = readFileSync(
    new URL("../src/components/XiaoceTaskList.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes('aria-label="新建小策bot任务"'));
  assert.ok(source.includes("处理中"));
  assert.ok(source.includes("修改任务名称"));
  assert.ok(source.includes("删除任务"));
  assert.ok(source.includes("onSelect(task.id)"));
});

test("Xiaoce task list styles use semantic theme variables", () => {
  const css = readFileSync(
    new URL("../src/styles/xiaoceTaskList.css", import.meta.url),
    "utf8",
  );
  assert.ok(css.includes("var(--lc-surface"));
  assert.ok(css.includes("var(--lc-border"));
  assert.ok(css.includes("var(--lc-ink)"));
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
  assert.equal(mergeXiaoceRunSnapshot(current, null), null);
});

test("process component uses server snapshots and the required collapsed label", () => {
  const source = readFileSync(
    new URL("../src/components/XiaoceProcess.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /查看处理过程（\{steps\.length\}步）/);
  assert.match(source, /aria-expanded/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test("API types include durable Xiaoce progress and realtime snapshots", () => {
  const source = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.match(source, /export interface XiaoceProgressStep/);
  assert.match(source, /export interface XiaoceRun/);
  assert.match(source, /xiaoce_runs\?: XiaoceRun\[\]/);
  assert.match(source, /cancelXiaoceRun/);
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
});

test("collaboration live hook forwards Xiaoce snapshots from websocket and fallback polling", () => {
  const source = readFileSync(
    new URL("../src/hooks/useCollabRoomLive.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /onXiaoceRuns/);
  assert.match(source, /data\.xiaoce_runs/);
  assert.match(source, /active_xiaoce_run/);
});

test("Xiaoce process presentation has dedicated responsive styles", () => {
  const source = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");
  assert.match(source, /\.xiaoce-process/);
  assert.match(source, /\.xiaoce-live-process/);
  assert.match(source, /\.xiaoce-created-skill/);
  const processStyles = source.slice(
    source.indexOf(".xiaoce-live-process {"),
    source.indexOf(".collab-agent-composer {"),
  );
  assert.match(processStyles, /var\(--lc-bg-elevated/);
  assert.match(processStyles, /var\(--lc-border-light/);
  assert.match(processStyles, /var\(--lc-text-muted/);
  assert.match(processStyles, /var\(--lc-accent-blue/);
});
