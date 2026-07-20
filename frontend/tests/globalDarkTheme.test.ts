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
