import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAT_THEME_STORAGE_KEY,
  DEFAULT_CHAT_THEME,
  persistChatTheme,
  readChatTheme,
} from "../src/pages/agentChatTheme.ts";

test("defaults to the light theme", () => {
  assert.equal(DEFAULT_CHAT_THEME, "light");
  assert.equal(readChatTheme(null), "light");
});

test("restores only supported themes", () => {
  assert.equal(readChatTheme({ getItem: () => "dark" }), "dark");
  assert.equal(readChatTheme({ getItem: () => "light" }), "light");
  assert.equal(readChatTheme({ getItem: () => "warm" }), "light");
});

test("storage failures fall back without throwing", () => {
  assert.equal(readChatTheme({ getItem: () => { throw new Error("blocked"); } }), "light");
  assert.doesNotThrow(() => persistChatTheme({ setItem: () => { throw new Error("blocked"); } }, "dark"));
});

test("persists with the fixed key", () => {
  const writes: Array<[string, string]> = [];
  persistChatTheme({ setItem: (key, value) => writes.push([key, value]) }, "dark");
  assert.deepEqual(writes, [[CHAT_THEME_STORAGE_KEY, "dark"]]);
});
