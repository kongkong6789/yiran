import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { createXiaoceRunId, isXiaoceRoom } from "../src/pages/xiaoceChat.ts";


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

test("creates a UUID v4 for each Xiaoce run", () => {
  const first = createXiaoceRunId();
  const second = createXiaoceRunId();
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first, second);
});

test("theme CSS is scoped to Xiaoce and preserves avatar colors", () => {
  const css = readFileSync(
    new URL("../src/styles/xiaoceChatTheme.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /\.xiaoce-chat-shell\[data-chat-theme="light"\]/);
  assert.match(css, /\.xiaoce-chat-shell\[data-chat-theme="dark"\]/);
  assert.doesNotMatch(css, /(?:^|\n)body\[data-chat-theme=/);
  assert.doesNotMatch(css, /filter\s*:/);
  assert.doesNotMatch(css, /collab-(?:sider|ai)/);
  assert.doesNotMatch(css, /avatar/i);
});

test("Collab composer includes pause, local theme, and Skill refresh wiring", () => {
  const source = readFileSync(
    new URL("../src/pages/CollabRisk.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /cancelXiaoceRun/);
  assert.match(source, /aria-label=\{cancellingRunId \? "正在暂停" : xiaoceBusy \? "暂停生成" : "发送"\}/);
  assert.match(source, /data-chat-theme=\{isXiaoce \? chatTheme : undefined\}/);
  assert.match(source, /refreshKey=\{skillRefreshKey\}/);
});
