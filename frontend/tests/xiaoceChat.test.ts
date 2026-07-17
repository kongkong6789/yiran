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

test("global theme tokens drive Xiaoce without changing avatar colors", () => {
  const xiaoceCss = readFileSync(
    new URL("../src/styles/xiaoceChatTheme.css", import.meta.url),
    "utf8",
  );
  const globalCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(globalCss, /:root\s*\{[^}]*--lc-canvas:\s*#fff/s);
  assert.match(globalCss, /:root\[data-theme="dark"\]\s*\{[^}]*--lc-canvas:\s*#000/s);
  assert.match(globalCss, /--lc-muted:\s*rgba\(/);
  assert.doesNotMatch(xiaoceCss, /data-chat-theme/);
  assert.doesNotMatch(xiaoceCss, /filter\s*:/);
  assert.doesNotMatch(xiaoceCss, /avatar/i);
});

test("Collab composer includes pause, global theme, and Skill refresh wiring", () => {
  const source = readFileSync(
    new URL("../src/pages/CollabRisk.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /cancelXiaoceRun/);
  assert.match(source, /aria-label=\{cancellingRunId \? "正在暂停" : xiaoceBusy \? "暂停生成" : "发送"\}/);
  assert.match(source, /useThemeMode/);
  assert.match(source, /const \{ mode, setMode \} = useThemeMode\(\);/);
  assert.match(source, /onClick=\{\(\) => setMode\("light"\)\}/);
  assert.match(source, /onClick=\{\(\) => setMode\("dark"\)\}/);
  assert.doesNotMatch(source, /data-chat-theme=/);
  assert.doesNotMatch(source, /(?:read|persist)ChatTheme|setChatTheme/);
  assert.match(source, /refreshKey=\{skillRefreshKey\}/);
});
