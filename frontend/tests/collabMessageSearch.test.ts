import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const clientSource = readFileSync(
  new URL("../src/api/client.ts", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../src/pages/CollabRisk.tsx", import.meta.url),
  "utf8",
);
const searchSource = readFileSync(
  new URL("../src/components/CollabMessageSearch.tsx", import.meta.url),
  "utf8",
);
const searchCss = readFileSync(
  new URL("../src/styles/collabMessageSearch.css", import.meta.url),
  "utf8",
);

test("chat search API supports global results and around-message loading", () => {
  assert.ok(clientSource.includes('>("/collab/search/", { params: { q: query, limit } })'));
  assert.ok(clientSource.includes("aroundId?: number"));
  assert.ok(clientSource.includes("params.around_id = o.aroundId"));
});

test("message list header exposes a controlled search popover", () => {
  assert.ok(pageSource.includes('aria-label="搜索聊天记录"'));
  assert.ok(pageSource.includes('overlayClassName="collab-search-popover"'));
  assert.ok(pageSource.includes("onOpenChange={setChatSearchOpen}"));
  assert.ok(pageSource.includes("pendingSearchTargetRef"));
  assert.ok(pageSource.includes("targetMessageId: messageId"));
});

test("search panel covers normal conversations and Xiaoce tasks", () => {
  assert.ok(searchSource.includes("普通对话与小策 Bot 任务"));
  assert.ok(searchSource.includes("搜索对话、成员或消息内容"));
  assert.ok(searchSource.includes("小策任务"));
  assert.ok(searchSource.includes('event.key === "Escape"'));
});

test("search popover uses semantic light and dark theme tokens", () => {
  for (const token of [
    "var(--lc-surface-overlay)",
    "var(--lc-surface-raised)",
    "var(--lc-surface-input)",
    "var(--lc-ink)",
    "var(--lc-text-muted)",
    "var(--lc-border-light)",
  ]) {
    assert.ok(searchCss.includes(token), token);
  }
  assert.ok(searchCss.includes(":focus-visible"));
});
