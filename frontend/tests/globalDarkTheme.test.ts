import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getAntComponentTokens,
  getAntThemeTokens,
  getThemeCssVariables,
  getThemePalette,
} from "../src/theme/palette.ts";

test("dark palette keeps a pure-black canvas with distinct surfaces", () => {
  const dark = getThemePalette("dark");

  assert.equal(dark.canvas, "#000000");
  assert.notEqual(dark.surface, dark.canvas);
  assert.notEqual(dark.surfaceRaised, dark.surface);
  assert.equal(dark.text, "#f5f5f5");
  assert.match(dark.border, /^rgba\(255, 255, 255,/);
});

test("dark palette exposes restrained semantic states", () => {
  const dark = getThemePalette("dark");

  assert.deepEqual(
    [dark.success, dark.warning, dark.error, dark.info],
    ["#73d89b", "#e5bb69", "#ef8585", "#7eb7e8"],
  );
});

test("CSS variables and Ant tokens share the semantic palette", () => {
  const dark = getThemePalette("dark");
  const vars = getThemeCssVariables("dark");
  const tokens = getAntThemeTokens("dark");

  assert.equal(vars["--lc-canvas"], dark.canvas);
  assert.equal(vars["--lc-surface-raised"], dark.surfaceRaised);
  assert.equal(vars["--lc-status-error"], dark.error);
  assert.equal(tokens.colorBgBase, dark.canvas);
  assert.equal(tokens.colorBgElevated, dark.surfaceRaised);
  assert.equal(tokens.colorText, dark.text);
});

test("Ant component tokens use raised surfaces for overlays and inputs", () => {
  const dark = getThemePalette("dark");
  const components = getAntComponentTokens("dark");

  assert.equal(components.Card.colorBgContainer, dark.surface);
  assert.equal(components.Select.selectorBg, dark.surfaceInput);
  assert.equal(components.Modal.contentBg, dark.surfaceRaised);
  assert.equal(components.Table.headerBg, dark.surfaceRaised);
});

test("the React root applies semantic variables and Ant tokens", () => {
  const source = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

  assert.match(source, /getThemeCssVariables/);
  assert.match(source, /getAntThemeTokens/);
  assert.match(source, /getAntComponentTokens/);
  assert.doesNotMatch(source, /const DARK_TOKENS/);
  assert.doesNotMatch(source, /const LIGHT_TOKENS/);
});

test("the final CSS layer uses semantic raised and input surfaces", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

  assert.match(css, /--lc-surface-raised/);
  assert.match(css, /--lc-surface-input/);
  assert.match(css, /--lc-surface-overlay/);
  assert.match(css, /:root\[data-theme="dark"\] \.ant-table-thead/);
  assert.match(css, /:root\[data-theme="dark"\] \.ant-modal-content/);
});

test("conversation styles use the global pure-black semantic surfaces", () => {
  const chatCss = readFileSync(new URL("../src/styles/agentChatApple.css", import.meta.url), "utf8");
  const teamCss = readFileSync(new URL("../src/styles/teamCollaboration.css", import.meta.url), "utf8");
  const xiaoceCss = readFileSync(new URL("../src/styles/xiaoceChatTheme.css", import.meta.url), "utf8");

  assert.match(chatCss, /--chat-canvas:\s*var\(--lc-canvas\)/);
  assert.match(chatCss, /--chat-rail:\s*var\(--lc-surface\)/);
  assert.match(chatCss, /--chat-surface:\s*var\(--lc-surface-raised\)/);
  assert.match(teamCss, /:root\[data-theme="dark"\] \.team-workspace-bar[\s\S]*background:\s*var\(--lc-surface\)/);
  assert.match(teamCss, /:root\[data-theme="dark"\] \.team-workspace-tab-indicator[\s\S]*background:\s*var\(--lc-surface-raised\)/);
  assert.match(xiaoceCss, /background:\s*var\(--lc-status-error-bg\)/);
  assert.match(xiaoceCss, /background:\s*var\(--lc-status-warning-bg\)/);
});

test("collaboration visual components use theme-aware panel surfaces", () => {
  const meeting = readFileSync(new URL("../src/components/MeetingInviteAlert.tsx", import.meta.url), "utf8");
  const roundTable = readFileSync(new URL("../src/components/CollabRoundTable.tsx", import.meta.url), "utf8");
  const collab = readFileSync(new URL("../src/pages/CollabRisk.tsx", import.meta.url), "utf8");

  assert.match(meeting, /color:\s*"var\(--lc-ink\)"/);
  assert.doesNotMatch(roundTable, /background:\s*#fff(?:fff)?/i);
  assert.doesNotMatch(roundTable, /background:\s*rgba\(255,\s*255,\s*255,\s*0\.9[56]\)/i);
  assert.match(collab, /:root\[data-theme="dark"\] \.collab-insight/);
  assert.match(collab, /var\(--lc-status-warning-bg\)/);
  assert.match(collab, /var\(--lc-status-error-bg\)/);
});
