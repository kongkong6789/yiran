import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  createXiaoceRunId,
  findXiaoceReferenceRooms,
  isXiaoceRoom,
  mergeXiaoceRunSnapshot,
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
