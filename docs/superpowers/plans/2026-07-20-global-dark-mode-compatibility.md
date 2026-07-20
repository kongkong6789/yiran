# Global Dark Mode Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every formal frontend route and shared visual module honor the existing pure-black dark theme without white islands, unreadable text, missing boundaries, or light-only graph canvases.

**Architecture:** Keep `ThemeModeContext` as the single mode source. Add a typed semantic palette shared by Ant Design configuration and JavaScript-rendered visualizations, expose the same semantics as `--lc-*` CSS variables, then migrate page and canvas hard-coded light colors in bounded groups. Preserve the current light theme and use restrained semantic colors only for business meaning.

**Tech Stack:** React 18, TypeScript 5.5, Vite 5, Ant Design 5, React Router 6, React Flow 12, Force Graph 2D/3D, Node test runner, CSS custom properties.

## Global Constraints

- Preserve the existing pure-black theme; do not add a new theme selector or visual identity.
- Use pure black for the page canvas and near-black semantic surfaces for hierarchy.
- Use low-saturation green, amber, red, and blue only for success, warning, error, information, graph categories, and connector identity.
- Do not change API contracts, permissions, business behavior, navigation, drag/zoom, pagination, or theme persistence.
- Do not add frontend dependencies.
- Keep light mode working and visually stable.
- Normal body text targets at least 4.5:1 contrast; large text, icons, focus outlines, and control boundaries target at least 3:1.
- State must also use text, icon, shape, or border; color alone is insufficient.
- All formal routes listed in `frontend/src/App.tsx` are in scope.

---

## File Map

**Create**

- `frontend/src/theme/palette.ts` — typed light/dark semantic palette, CSS variable mapping, and Ant token/component factories.
- `frontend/src/theme/visualization.ts` — theme values and helpers for Canvas, SVG, React Flow, and HTML graph tooltips.
- `frontend/tests/globalDarkTheme.test.ts` — palette, token, route-coverage, and hard-coded light-surface regression tests.
- `frontend/scripts/audit-dark-mode.mjs` — deterministic audit of inline light-only backgrounds and visualization tooltip markup.

**Modify: theme foundation and global surfaces**

- `frontend/src/main.tsx` — consume the palette factory instead of local light/dark token objects.
- `frontend/src/index.css` — expand semantic variables, narrow the final black/white override layer, and add dark rules for shared Ant components and route shells.
- `frontend/src/components/AppLayout.tsx` — keep the root `data-theme` contract and add stable shell class hooks only where missing.

**Modify: conversation and collaboration**

- `frontend/src/pages/AgentChat.tsx`
- `frontend/src/styles/agentChatApple.css`
- `frontend/src/pages/TeamCollaboration.tsx`
- `frontend/src/pages/CollabRisk.tsx`
- `frontend/src/styles/teamCollaboration.css`
- `frontend/src/styles/xiaoceChatTheme.css`
- `frontend/src/components/MeetingInviteAlert.tsx`
- `frontend/src/components/CollabRoundTable.tsx`

**Modify: memory, work, knowledge, capability, and management surfaces**

- `frontend/src/pages/AgentMemory.tsx`
- `frontend/src/pages/Home.tsx`
- `frontend/src/pages/WorkHub.tsx`
- `frontend/src/pages/WorkTodos.tsx`
- `frontend/src/pages/WorkAutomation.tsx`
- `frontend/src/pages/Knowledge.tsx`
- `frontend/src/pages/SkillsPage.tsx`
- `frontend/src/pages/Connectors.tsx`
- `frontend/src/pages/SmartTable.tsx`
- `frontend/src/pages/DataLake.tsx`
- `frontend/src/pages/Agents.tsx`
- `frontend/src/pages/Accounts.tsx`
- `frontend/src/pages/Audit.tsx`
- `frontend/src/pages/SectionHub.tsx`
- `frontend/src/pages/Login.tsx`

**Modify: ontology and operating visualizations**

- `frontend/src/pages/OntologyGraph.tsx`
- `frontend/src/pages/CommerceHub.tsx`
- `frontend/src/pages/CommerceFusion.tsx`
- `frontend/src/pages/Loops.tsx`
- `frontend/src/components/LoopForceGraph.tsx`
- `frontend/src/components/CommerceFlowCanvas.tsx`
- `frontend/src/components/CompanyOperatingLoopCanvas.tsx`
- `frontend/src/components/LoopCycleCanvas.tsx`
- `frontend/src/components/FusedLoopCanvas.tsx`
- `frontend/src/components/BrandAgencyLoops.tsx`
- `frontend/src/components/BrandStockFlowLoop.tsx`
- `frontend/src/components/HierarchyLoopDiagram.tsx`
- `frontend/src/components/LoopRingDiagram.tsx`
- `frontend/src/components/RealLoopGraphWorkspace.tsx`
- `frontend/src/components/GraphDemoLoops.tsx`

---

### Task 1: Typed semantic palette

**Files:**

- Create: `frontend/src/theme/palette.ts`
- Test: `frontend/tests/globalDarkTheme.test.ts`

**Interfaces:**

- Consumes: `ThemeMode` from `frontend/src/theme/mode.ts`.
- Produces: `ThemePalette`, `THEME_PALETTES`, `getThemePalette(mode)`, `getThemeCssVariables(mode)`, `getAntThemeTokens(mode)`, and `getAntComponentTokens(mode)`.

- [ ] **Step 1: Write the failing palette tests**

Create `frontend/tests/globalDarkTheme.test.ts` with these initial tests:

```ts
import assert from "node:assert/strict";
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd frontend && node --test tests/globalDarkTheme.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/theme/palette.ts`.

- [ ] **Step 3: Implement the semantic palette**

Create `frontend/src/theme/palette.ts` with this public shape and exact dark values:

```ts
import type { ThemeMode } from "./mode";

export interface ThemePalette {
  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceInput: string;
  surfaceOverlay: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  border: string;
  borderSubtle: string;
  borderStrong: string;
  hover: string;
  selected: string;
  focus: string;
  ownBubble: string;
  ownBubbleText: string;
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  error: string;
  errorBg: string;
  info: string;
  infoBg: string;
  graphCanvas: string;
  graphGrid: string;
  graphEdge: string;
  graphTooltipBg: string;
  graphTooltipBorder: string;
  graphTooltipText: string;
}

export const THEME_PALETTES: Record<ThemeMode, ThemePalette> = {
  light: {
    canvas: "#ffffff",
    surface: "#ffffff",
    surfaceRaised: "#f7f7f7",
    surfaceInput: "#ffffff",
    surfaceOverlay: "#ffffff",
    text: "#000000",
    textSecondary: "rgba(0, 0, 0, 0.68)",
    textMuted: "rgba(0, 0, 0, 0.5)",
    textInverse: "#ffffff",
    border: "rgba(0, 0, 0, 0.18)",
    borderSubtle: "rgba(0, 0, 0, 0.1)",
    borderStrong: "rgba(0, 0, 0, 0.3)",
    hover: "rgba(0, 0, 0, 0.06)",
    selected: "rgba(0, 0, 0, 0.1)",
    focus: "#000000",
    ownBubble: "#000000",
    ownBubbleText: "#ffffff",
    success: "#237a45",
    successBg: "#edf8f1",
    warning: "#946618",
    warningBg: "#fff7e7",
    error: "#b53b3b",
    errorBg: "#fff1f0",
    info: "#356f9f",
    infoBg: "#eef6fc",
    graphCanvas: "#f4f7fb",
    graphGrid: "#dfe5ee",
    graphEdge: "#9aa7b8",
    graphTooltipBg: "#ffffff",
    graphTooltipBorder: "#d7e0ec",
    graphTooltipText: "#1a2740",
  },
  dark: {
    canvas: "#000000",
    surface: "#080808",
    surfaceRaised: "#101010",
    surfaceInput: "#121212",
    surfaceOverlay: "#181818",
    text: "#f5f5f5",
    textSecondary: "rgba(255, 255, 255, 0.72)",
    textMuted: "rgba(255, 255, 255, 0.54)",
    textInverse: "#000000",
    border: "rgba(255, 255, 255, 0.2)",
    borderSubtle: "rgba(255, 255, 255, 0.11)",
    borderStrong: "rgba(255, 255, 255, 0.34)",
    hover: "rgba(255, 255, 255, 0.08)",
    selected: "rgba(255, 255, 255, 0.12)",
    focus: "#ffffff",
    ownBubble: "#f2f2f2",
    ownBubbleText: "#080808",
    success: "#73d89b",
    successBg: "rgba(47, 145, 86, 0.18)",
    warning: "#e5bb69",
    warningBg: "rgba(174, 116, 26, 0.2)",
    error: "#ef8585",
    errorBg: "rgba(190, 58, 58, 0.2)",
    info: "#7eb7e8",
    infoBg: "rgba(54, 121, 177, 0.2)",
    graphCanvas: "#050505",
    graphGrid: "#1c1c1c",
    graphEdge: "#555555",
    graphTooltipBg: "#151515",
    graphTooltipBorder: "#383838",
    graphTooltipText: "#f5f5f5",
  },
};

export function getThemePalette(mode: ThemeMode): ThemePalette {
  return THEME_PALETTES[mode];
}

export function getThemeCssVariables(mode: ThemeMode): Record<string, string> {
  const p = getThemePalette(mode);
  return {
    "--lc-canvas": p.canvas,
    "--lc-surface": p.surface,
    "--lc-surface-raised": p.surfaceRaised,
    "--lc-surface-input": p.surfaceInput,
    "--lc-surface-overlay": p.surfaceOverlay,
    "--lc-ink": p.text,
    "--lc-text-secondary": p.textSecondary,
    "--lc-muted": p.textMuted,
    "--lc-line": p.border,
    "--lc-border-light": p.borderSubtle,
    "--lc-border-strong": p.borderStrong,
    "--lc-hover": p.hover,
    "--lc-selected": p.selected,
    "--lc-focus": p.focus,
    "--lc-own-bg": p.ownBubble,
    "--lc-own-ink": p.ownBubbleText,
    "--lc-status-success": p.success,
    "--lc-status-success-bg": p.successBg,
    "--lc-status-warning": p.warning,
    "--lc-status-warning-bg": p.warningBg,
    "--lc-status-error": p.error,
    "--lc-status-error-bg": p.errorBg,
    "--lc-status-info": p.info,
    "--lc-status-info-bg": p.infoBg,
    "--lc-graph-canvas": p.graphCanvas,
    "--lc-graph-grid": p.graphGrid,
    "--lc-graph-edge": p.graphEdge,
    "--lc-graph-tooltip-bg": p.graphTooltipBg,
    "--lc-graph-tooltip-border": p.graphTooltipBorder,
    "--lc-graph-tooltip-text": p.graphTooltipText,
  };
}
```

Add these factories in the same file. Ant global tokens supply Alert and Empty; component overrides provide the surface and interaction details that differ from Ant defaults:

```ts
export function getAntThemeTokens(mode: ThemeMode) {
  const p = getThemePalette(mode);
  return {
    colorPrimary: mode === "dark" ? "#ffffff" : "#000000",
    colorInfo: p.info,
    colorSuccess: p.success,
    colorWarning: p.warning,
    colorError: p.error,
    colorLink: mode === "dark" ? p.text : "#000000",
    colorBgBase: p.canvas,
    colorBgLayout: p.canvas,
    colorBgContainer: p.surface,
    colorBgElevated: p.surfaceOverlay,
    colorFillAlter: p.surfaceRaised,
    colorFillSecondary: p.hover,
    colorFillTertiary: p.hover,
    colorFillQuaternary: p.surfaceInput,
    colorBorder: p.border,
    colorBorderSecondary: p.borderSubtle,
    colorText: p.text,
    colorTextSecondary: p.textSecondary,
    colorTextTertiary: p.textMuted,
    colorTextQuaternary: p.textMuted,
    colorTextDisabled: p.textMuted,
    borderRadius: 10,
    fontSize: 14,
    boxShadowSecondary: mode === "dark" ? "0 18px 48px rgba(0,0,0,.52)" : "0 12px 32px rgba(0,0,0,.12)",
  };
}

export function getAntComponentTokens(mode: ThemeMode) {
  const p = getThemePalette(mode);
  return {
    Layout: { headerBg: p.canvas, siderBg: p.surface, bodyBg: p.canvas },
    Menu: {
      itemBg: "transparent",
      itemSelectedBg: p.selected,
      itemHoverBg: p.hover,
      itemSelectedColor: p.text,
      horizontalItemSelectedColor: p.text,
      activeBarHeight: 0,
    },
    Card: { colorBgContainer: p.surface, headerBg: p.surface },
    Button: {
      primaryShadow: "none",
      defaultBg: p.surfaceInput,
      defaultColor: p.text,
      defaultBorderColor: p.border,
    },
    Tag: { defaultBg: p.hover, defaultColor: p.textSecondary },
    Select: {
      selectorBg: p.surfaceInput,
      optionActiveBg: p.hover,
      optionSelectedBg: p.selected,
      optionSelectedColor: p.text,
    },
    Input: { activeBg: p.surfaceInput, hoverBg: p.surfaceInput },
    InputNumber: { activeBg: p.surfaceInput, hoverBg: p.surfaceInput },
    Table: {
      headerBg: p.surfaceRaised,
      headerColor: p.textSecondary,
      rowHoverBg: p.hover,
      borderColor: p.borderSubtle,
    },
    Tabs: {
      inkBarColor: p.focus,
      itemColor: p.textSecondary,
      itemHoverColor: p.text,
      itemSelectedColor: p.text,
    },
    Modal: { contentBg: p.surfaceOverlay, headerBg: p.surfaceOverlay, titleColor: p.text },
    Drawer: { colorBgElevated: p.surfaceOverlay },
    Popover: { colorBgElevated: p.surfaceOverlay },
    Tooltip: { colorBgSpotlight: p.surfaceOverlay, colorTextLightSolid: p.text },
    Dropdown: { colorBgElevated: p.surfaceOverlay, controlItemBgHover: p.hover },
    Segmented: {
      trackBg: p.surfaceInput,
      itemSelectedBg: p.surfaceRaised,
      itemSelectedColor: p.text,
      itemHoverBg: p.hover,
    },
    Pagination: { itemActiveBg: p.surfaceRaised },
  };
}
```

- [ ] **Step 4: Run the palette tests**

Run:

```bash
cd frontend && node --test tests/globalDarkTheme.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the palette**

```bash
git add frontend/src/theme/palette.ts frontend/tests/globalDarkTheme.test.ts
git commit -m "feat: add semantic dark theme palette"
```

---

### Task 2: Wire the global theme and shared Ant surfaces

**Files:**

- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/AppLayout.tsx`
- Test: `frontend/tests/globalDarkTheme.test.ts`

**Interfaces:**

- Consumes: `getThemeCssVariables()`, `getAntThemeTokens()`, and `getAntComponentTokens()` from Task 1.
- Produces: a single root theme application path and shared dark styling inherited by all formal routes.

- [ ] **Step 1: Add failing root integration assertions**

Append these tests:

```ts
import { readFileSync } from "node:fs";

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
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run `cd frontend && node --test tests/globalDarkTheme.test.ts`.

Expected: FAIL because `main.tsx` still defines `LIGHT_TOKENS`/`DARK_TOKENS` and CSS lacks the new semantic surface contract.

- [ ] **Step 3: Replace local token objects in `main.tsx`**

Import the Task 1 factories. In the mode effect, apply every CSS variable to `document.documentElement.style`, then persist the mode:

```ts
useEffect(() => {
  const root = document.documentElement;
  root.dataset.theme = mode;
  Object.entries(getThemeCssVariables(mode)).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* preference persistence is best-effort */
  }
}, [mode]);
```

Replace the inline token/component branches with:

```ts
theme={{
  algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
  token: getAntThemeTokens(mode),
  components: getAntComponentTokens(mode),
}}
```

- [ ] **Step 4: Replace the broad final CSS layer with semantic layers**

Keep the current selector coverage but separate its responsibilities:

```css
:root[data-theme="dark"] .ant-card,
:root[data-theme="dark"] .ant-table,
:root[data-theme="dark"] .ant-tabs-content-holder {
  color: var(--lc-text);
  background: var(--lc-surface);
  border-color: var(--lc-border-light);
}

:root[data-theme="dark"] .ant-table-thead > tr > th,
:root[data-theme="dark"] .ant-table-cell-fix-left,
:root[data-theme="dark"] .ant-table-cell-fix-right {
  color: var(--lc-text-secondary);
  background: var(--lc-surface-raised) !important;
  border-color: var(--lc-border-light);
}

:root[data-theme="dark"] .ant-input,
:root[data-theme="dark"] .ant-input-affix-wrapper,
:root[data-theme="dark"] .ant-input-number,
:root[data-theme="dark"] .ant-select-selector,
:root[data-theme="dark"] .ant-picker,
:root[data-theme="dark"] .ant-segmented {
  color: var(--lc-text);
  background: var(--lc-surface-input) !important;
  border-color: var(--lc-border);
}

:root[data-theme="dark"] .ant-modal-content,
:root[data-theme="dark"] .ant-drawer-content,
:root[data-theme="dark"] .ant-dropdown-menu,
:root[data-theme="dark"] .ant-popover-inner,
:root[data-theme="dark"] .ant-tooltip-inner,
:root[data-theme="dark"] .ant-select-dropdown {
  color: var(--lc-text);
  background: var(--lc-surface-overlay) !important;
  border-color: var(--lc-border);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.52);
}
```

Replace global `box-shadow: none !important` with the overlay shadow above and narrow remaining `!important` selectors to Ant portal/fixed-column cases. Add `:focus-visible` rules using `--lc-focus` and `--lc-border-strong`.

- [ ] **Step 5: Run tests and production build**

Run:

```bash
cd frontend && npm test && npm run build
```

Expected: all Node tests PASS and Vite reports a successful production build.

- [ ] **Step 6: Commit the global theme wiring**

```bash
git add frontend/src/main.tsx frontend/src/index.css frontend/src/components/AppLayout.tsx frontend/tests/globalDarkTheme.test.ts
git commit -m "fix: unify shared dark mode surfaces"
```

---

### Task 3: Agent chat and team collaboration surfaces

**Files:**

- Modify: `frontend/src/pages/AgentChat.tsx`
- Modify: `frontend/src/styles/agentChatApple.css`
- Modify: `frontend/src/pages/TeamCollaboration.tsx`
- Modify: `frontend/src/pages/CollabRisk.tsx`
- Modify: `frontend/src/styles/teamCollaboration.css`
- Modify: `frontend/src/styles/xiaoceChatTheme.css`
- Modify: `frontend/src/components/MeetingInviteAlert.tsx`
- Modify: `frontend/src/components/CollabRoundTable.tsx`
- Test: `frontend/tests/globalDarkTheme.test.ts`
- Test: `frontend/tests/agentChatTheme.test.ts`

**Interfaces:**

- Consumes: global `--lc-*` semantic variables from Task 2.
- Produces: dark-compatible conversation lists, message bubbles, process panels, composers, summaries, roundtables, and collaboration dialogs.

- [ ] **Step 1: Add failing conversation coverage assertions**

Append:

```ts
test("conversation styles use semantic surfaces instead of dark-mode white islands", () => {
  const chatCss = readFileSync(new URL("../src/styles/agentChatApple.css", import.meta.url), "utf8");
  const teamCss = readFileSync(new URL("../src/styles/teamCollaboration.css", import.meta.url), "utf8");
  const xiaoceCss = readFileSync(new URL("../src/styles/xiaoceChatTheme.css", import.meta.url), "utf8");
  for (const css of [chatCss, teamCss, xiaoceCss]) {
    assert.match(css, /var\(--lc-surface/);
    assert.match(css, /:root\[data-theme="dark"\]/);
  }
});

test("collaboration visual components do not hard-code white panels", () => {
  for (const file of ["MeetingInviteAlert.tsx", "CollabRoundTable.tsx"]) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /background:\s*["'`]#fff(?:fff)?["'`]/i);
    assert.doesNotMatch(source, /background:\s*#fff(?:fff)?/i);
  }
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run `cd frontend && node --test tests/agentChatTheme.test.ts tests/globalDarkTheme.test.ts`.

Expected: FAIL on missing dark selectors and the white roundtable/member panels.

- [ ] **Step 3: Migrate Agent chat states**

Use the following mapping in `agentChatApple.css` and remove conflicting pure-white dark rules:

```css
:root[data-theme="dark"] .agent-chat-sidebar,
:root[data-theme="dark"] .agent-chat-header,
:root[data-theme="dark"] .agent-chat-quick {
  background: var(--lc-surface);
  border-color: var(--lc-border-light);
}

:root[data-theme="dark"] .agent-chat-bubble,
:root[data-theme="dark"] .agent-report-card,
:root[data-theme="dark"] .agent-md-section {
  color: var(--lc-text);
  background: var(--lc-surface-raised);
  border-color: var(--lc-border-light);
}

:root[data-theme="dark"] .agent-chat-row.user .agent-chat-bubble {
  color: var(--lc-own-ink);
  background: var(--lc-own-bg);
  border-color: var(--lc-own-bg);
}

:root[data-theme="dark"] .agent-chat-composer,
:root[data-theme="dark"] .agent-chat-input {
  color: var(--lc-text);
  background: var(--lc-surface-input);
  border-color: var(--lc-border);
}
```

Keep `AgentChat.tsx` bound to `useThemeMode()` and `data-chat-theme={mode}`. Do not restore the obsolete chat-local storage state.

- [ ] **Step 4: Migrate collaboration, Xiaoce, and roundtable surfaces**

Replace light-only pale purple/blue/red surfaces with the appropriate semantic variables. Use `--lc-status-success-bg`, `--lc-status-warning-bg`, `--lc-status-error-bg`, and `--lc-status-info-bg` for state containers. For `MeetingInviteAlert.tsx` and `CollabRoundTable.tsx`, replace embedded white panel values with CSS variables such as `var(--lc-surface-raised)` and `var(--lc-text)`; retain member identity colors and the table's brand-gold physical appearance.

Add complete dark selectors for:

```css
:root[data-theme="dark"] .team-workspace-bar,
:root[data-theme="dark"] .team-workspace-tabs,
:root[data-theme="dark"] .collab-profile-card,
:root[data-theme="dark"] .collab-agent-composer,
:root[data-theme="dark"] .xiaoce-process,
:root[data-theme="dark"] .xiaoce-live-process,
:root[data-theme="dark"] .xiaoce-created-skill {
  color: var(--lc-text);
  background: var(--lc-surface-raised);
  border-color: var(--lc-border-light);
}
```

- [ ] **Step 5: Run conversation tests and build**

Run:

```bash
cd frontend && node --test tests/agentChatTheme.test.ts tests/xiaoceChat.test.ts tests/globalDarkTheme.test.ts && npm run build
```

Expected: all selected tests PASS and the production build succeeds.

- [ ] **Step 6: Commit conversation compatibility**

```bash
git add frontend/src/pages/AgentChat.tsx frontend/src/styles/agentChatApple.css frontend/src/pages/TeamCollaboration.tsx frontend/src/pages/CollabRisk.tsx frontend/src/styles/teamCollaboration.css frontend/src/styles/xiaoceChatTheme.css frontend/src/components/MeetingInviteAlert.tsx frontend/src/components/CollabRoundTable.tsx frontend/tests
git commit -m "fix: adapt chat and collaboration to dark mode"
```

---

### Task 4: Agent memory and standard route surfaces

**Files:**

- Modify: `frontend/src/pages/AgentMemory.tsx`
- Modify: `frontend/src/pages/Home.tsx`
- Modify: `frontend/src/pages/WorkHub.tsx`
- Modify: `frontend/src/pages/WorkTodos.tsx`
- Modify: `frontend/src/pages/WorkAutomation.tsx`
- Modify: `frontend/src/pages/Knowledge.tsx`
- Modify: `frontend/src/pages/SkillsPage.tsx`
- Modify: `frontend/src/pages/Connectors.tsx`
- Modify: `frontend/src/pages/SmartTable.tsx`
- Modify: `frontend/src/pages/DataLake.tsx`
- Modify: `frontend/src/pages/Agents.tsx`
- Modify: `frontend/src/pages/Accounts.tsx`
- Modify: `frontend/src/pages/Audit.tsx`
- Modify: `frontend/src/pages/SectionHub.tsx`
- Modify: `frontend/src/pages/Login.tsx`
- Modify: `frontend/src/index.css`
- Test: `frontend/tests/globalDarkTheme.test.ts`

**Interfaces:**

- Consumes: shared Ant and CSS semantics from Task 2.
- Produces: coherent page shells, cards, tables, forms, empty states, debug output, kanban cards, work console panels, and administration screens.

- [ ] **Step 1: Add failing standard-route assertions**

Append:

```ts
test("Agent memory debug output uses a semantic class", () => {
  const source = readFileSync(new URL("../src/pages/AgentMemory.tsx", import.meta.url), "utf8");
  assert.match(source, /className="agent-memory-debug"/);
  assert.doesNotMatch(source, /#f5f5f5/);
});

test("every formal route has an explicit dark-mode coverage hook", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const routeHooks = [
    "agent-memory-page", "kgv3-page", "task-workspace", "work-todos-page",
    "work-automation-page", "knowledge-console", "skills-page", "connectors-page",
    "st-root", "data-lake-page", "agents-page", "account-admin-page", "audit-page",
    "section-hub", "login-page",
  ];
  for (const hook of routeHooks) {
    assert.match(css, new RegExp(`:root\\[data-theme="dark"\\][\\s\\S]{0,240}\\.${hook}`));
  }
});
```

If a page's existing root class differs, use that exact existing root class in the test and CSS; do not add duplicate wrappers.

- [ ] **Step 2: Run the test and verify failure**

Run `cd frontend && node --test tests/globalDarkTheme.test.ts`.

Expected: FAIL because Agent memory uses an inline light fallback and multiple routes lack explicit dark hooks.

- [ ] **Step 3: Fix Agent memory structure**

Replace the inline `<pre>` style with:

```tsx
<pre className="agent-memory-debug">
  {debug ? JSON.stringify(debug, null, 2) : "尚未加载"}
</pre>
```

Add:

```css
.agent-memory-page {
  min-height: 100%;
  padding: 24px;
  color: var(--lc-text);
  background: var(--lc-canvas);
}

.agent-memory-debug {
  min-height: 72px;
  max-height: 480px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  color: var(--lc-text-secondary);
  background: var(--lc-surface-input);
  border: 1px solid var(--lc-border-light);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
}
```

- [ ] **Step 4: Migrate standard page states by semantic role**

Add `className="data-lake-page"` to the root `Space` in `DataLake.tsx`. Add `className="audit-page"` to the root `Card` in `Audit.tsx`, and replace its expanded-row inline `<pre>` with `<pre className="audit-debug">`.

For each file in this task, remove inline hard-coded light backgrounds when the element participates in a page surface. Use these exact mappings:

```css
:root[data-theme="dark"] .task-workspace,
:root[data-theme="dark"] .work-todos-page,
:root[data-theme="dark"] .work-automation-page,
:root[data-theme="dark"] .skills-page,
:root[data-theme="dark"] .connectors-page,
:root[data-theme="dark"] .st-root,
:root[data-theme="dark"] .data-lake-page,
:root[data-theme="dark"] .agents-page,
:root[data-theme="dark"] .account-admin-page,
:root[data-theme="dark"] .audit-page,
:root[data-theme="dark"] .section-hub,
:root[data-theme="dark"] .login-page {
  color: var(--lc-text);
  background: var(--lc-canvas);
}

:root[data-theme="dark"] .task-console-card,
:root[data-theme="dark"] .work-todos-card,
:root[data-theme="dark"] .work-automation-list-panel,
:root[data-theme="dark"] .work-automation-template-panel,
:root[data-theme="dark"] .source-connect-card,
:root[data-theme="dark"] .dify-card,
:root[data-theme="dark"] .st-kanban-card,
:root[data-theme="dark"] .agents-card,
:root[data-theme="dark"] .account-admin-workspace {
  color: var(--lc-text);
  background: var(--lc-surface);
  border-color: var(--lc-border-light);
}

:root[data-theme="dark"] .knowledge-console,
:root[data-theme="dark"] .kgv3-page {
  color: var(--lc-text);
  background: var(--lc-canvas);
}

:root[data-theme="dark"] .audit-debug,
:root[data-theme="dark"] .data-lake-page code {
  color: var(--lc-text-secondary);
  background: var(--lc-surface-input);
  border: 1px solid var(--lc-border-light);
}
```

Preserve light-mode declarations outside `data-theme="dark"`.

- [ ] **Step 5: Run the standard-route test and build**

Run:

```bash
cd frontend && node --test tests/globalDarkTheme.test.ts && npm run build
```

Expected: tests PASS and the production build succeeds.

- [ ] **Step 6: Commit standard route compatibility**

```bash
git add frontend/src/pages frontend/src/index.css frontend/tests/globalDarkTheme.test.ts
git commit -m "fix: adapt standard routes to dark mode"
```

---

### Task 5: Ontology graph dark rendering

**Files:**

- Create: `frontend/src/theme/visualization.ts`
- Modify: `frontend/src/pages/OntologyGraph.tsx`
- Modify: `frontend/src/index.css`
- Test: `frontend/tests/globalDarkTheme.test.ts`

**Interfaces:**

- Consumes: `ThemePalette` and `ThemeMode` from Task 1.
- Produces: `VisualizationTheme`, `getVisualizationTheme(mode)`, `useVisualizationTheme()`, `semanticSoftColor(accent, mode, lightFallback)`, and `graphTooltipStyle(theme)`.

- [ ] **Step 1: Add failing visualization and ontology tests**

Append:

```ts
import {
  getVisualizationTheme,
  graphTooltipStyle,
  semanticSoftColor,
} from "../src/theme/visualization.ts";

test("visualization theme supplies dark canvas, grid, labels, and tooltip", () => {
  const visual = getVisualizationTheme("dark");
  assert.equal(visual.canvas, "#050505");
  assert.equal(visual.grid, "#1c1c1c");
  assert.equal(visual.tooltipText, "#f5f5f5");
  assert.match(graphTooltipStyle(visual), /background:#151515/);
  assert.equal(semanticSoftColor("#7c53c4", "dark", "#f2ecfd"), "rgba(124, 83, 196, 0.22)");
});

test("ontology graph consumes the shared visualization theme", () => {
  const source = readFileSync(new URL("../src/pages/OntologyGraph.tsx", import.meta.url), "utf8");
  assert.match(source, /useVisualizationTheme/);
  assert.match(source, /visualTheme\.canvas/);
  assert.match(source, /graphTooltipStyle\(visualTheme\)/);
  assert.doesNotMatch(source, /linear-gradient\(180deg, #f4f7fb/);
  assert.doesNotMatch(source, /background:#fff;border:1px solid #d7e0ec/);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run `cd frontend && node --test tests/globalDarkTheme.test.ts`.

Expected: FAIL with missing `theme/visualization.ts`.

- [ ] **Step 3: Implement visualization helpers**

Create `frontend/src/theme/visualization.ts`:

```ts
import { useThemeMode, type ThemeMode } from "./mode";
import { getThemePalette } from "./palette";

export interface VisualizationTheme {
  mode: ThemeMode;
  canvas: string;
  grid: string;
  edge: string;
  labelBg: string;
  labelText: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
}

export function getVisualizationTheme(mode: ThemeMode): VisualizationTheme {
  const p = getThemePalette(mode);
  return {
    mode,
    canvas: p.graphCanvas,
    grid: p.graphGrid,
    edge: p.graphEdge,
    labelBg: p.surfaceRaised,
    labelText: p.text,
    tooltipBg: p.graphTooltipBg,
    tooltipBorder: p.graphTooltipBorder,
    tooltipText: p.graphTooltipText,
  };
}

export function useVisualizationTheme(): VisualizationTheme {
  return getVisualizationTheme(useThemeMode().mode);
}

export function semanticSoftColor(accent: string, mode: ThemeMode, lightFallback: string): string {
  if (mode === "light") return lightFallback;
  const hex = accent.replace("#", "");
  const normalized = hex.length === 3 ? hex.split("").map((v) => v + v).join("") : hex;
  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, 0.22)`;
}

export function graphTooltipStyle(theme: VisualizationTheme): string {
  return `padding:6px 10px;background:${theme.tooltipBg};border:1px solid ${theme.tooltipBorder};border-radius:8px;font-size:12px;color:${theme.tooltipText};max-width:280px;box-shadow:0 12px 32px rgba(0,0,0,0.38);`;
}
```

- [ ] **Step 4: Migrate the ontology canvas and panels**

Inside `OntologyGraph`, call `const visualTheme = useVisualizationTheme()`. Replace the hard-coded toolbar, canvas gradient, grid overlay, loading overlay, tooltip, node label, edge, and particle colors with `visualTheme` fields or semantic CSS variables. Keep category node colors, but ensure labels use `visualTheme.labelBg`/`labelText` and selection rings remain visible.

Move structural inline styles into `.ontology-*` classes where the current inline value is theme-dependent. The main canvas must use:

```tsx
style={{ background: visualTheme.canvas }}
```

The ForceGraph tooltip must concatenate `graphTooltipStyle(visualTheme)` before the existing escaped title/details markup.

- [ ] **Step 5: Run ontology tests and build**

Run:

```bash
cd frontend && node --test tests/globalDarkTheme.test.ts && npm run build
```

Expected: visualization and ontology tests PASS; production build succeeds.

- [ ] **Step 6: Commit ontology compatibility**

```bash
git add frontend/src/theme/visualization.ts frontend/src/pages/OntologyGraph.tsx frontend/src/index.css frontend/tests/globalDarkTheme.test.ts
git commit -m "fix: render ontology graph in dark mode"
```

---

### Task 6: Operating-loop and graph visualization compatibility

**Files:**

- Modify: `frontend/src/components/LoopForceGraph.tsx`
- Modify: `frontend/src/components/CommerceFlowCanvas.tsx`
- Modify: `frontend/src/components/CompanyOperatingLoopCanvas.tsx`
- Modify: `frontend/src/components/LoopCycleCanvas.tsx`
- Modify: `frontend/src/components/FusedLoopCanvas.tsx`
- Modify: `frontend/src/components/BrandAgencyLoops.tsx`
- Modify: `frontend/src/components/BrandStockFlowLoop.tsx`
- Modify: `frontend/src/components/HierarchyLoopDiagram.tsx`
- Modify: `frontend/src/components/LoopRingDiagram.tsx`
- Modify: `frontend/src/components/RealLoopGraphWorkspace.tsx`
- Modify: `frontend/src/components/GraphDemoLoops.tsx`
- Modify: `frontend/src/pages/Home.tsx`
- Modify: `frontend/src/pages/CommerceHub.tsx`
- Modify: `frontend/src/pages/CommerceFusion.tsx`
- Modify: `frontend/src/index.css`
- Test: `frontend/tests/globalDarkTheme.test.ts`

**Interfaces:**

- Consumes: `useVisualizationTheme()`, `semanticSoftColor()`, and `graphTooltipStyle()` from Task 5.
- Produces: dark-aware React Flow backgrounds, Canvas paint functions, SVG fills, edge labels, graph tooltips, legends, and operating-loop page shells.

- [ ] **Step 1: Add failing graph coverage assertions**

Append:

```ts
test("all JavaScript-rendered graph modules consume visualization semantics", () => {
  const files = [
    "LoopForceGraph.tsx", "CommerceFlowCanvas.tsx", "CompanyOperatingLoopCanvas.tsx",
    "LoopCycleCanvas.tsx", "FusedLoopCanvas.tsx", "BrandAgencyLoops.tsx",
    "BrandStockFlowLoop.tsx", "HierarchyLoopDiagram.tsx", "LoopRingDiagram.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
    assert.match(source, /useVisualizationTheme|visualTheme/);
  }
});

test("graph modules no longer emit light-only tooltip or label backgrounds", () => {
  const files = [
    "LoopForceGraph.tsx", "CommerceFlowCanvas.tsx", "CompanyOperatingLoopCanvas.tsx",
    "FusedLoopCanvas.tsx", "BrandAgencyLoops.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /background:#fff;border:1px solid #d7e0ec/i);
    assert.doesNotMatch(source, /labelBgStyle:\s*\{\s*fill:\s*"#ffffff"/i);
  }
});
```

- [ ] **Step 2: Run the test and verify failure**

Run `cd frontend && node --test tests/globalDarkTheme.test.ts`.

Expected: FAIL for every graph component that still has a light-only grid, label background, tooltip, or SVG fill.

- [ ] **Step 3: Migrate React Flow components**

In `CommerceFlowCanvas.tsx`, `CompanyOperatingLoopCanvas.tsx`, and `LoopCycleCanvas.tsx`, call `useVisualizationTheme()`. Replace `<Background ... color="#e2e7ee" />`-style constants with:

```tsx
<Background variant={BackgroundVariant.Dots} gap={26} size={1} color={visualTheme.grid} />
```

Use `visualTheme.labelBg` and `visualTheme.labelText` for `labelBgStyle` and `labelStyle`. Use `semanticSoftColor(meta.color, visualTheme.mode, meta.soft)` for node/icon soft backgrounds.

- [ ] **Step 4: Migrate ForceGraph, Canvas, and SVG components**

In every remaining component listed in this task:

- Read `visualTheme` inside the component.
- Replace white node centers/label pills with `visualTheme.labelBg`.
- Replace dark-navy light-mode label text with `visualTheme.labelText`.
- Replace pale canvas gradients with `visualTheme.canvas` plus `visualTheme.grid` where a grid is rendered.
- Use `graphTooltipStyle(visualTheme)` for HTML tooltips.
- Preserve category/loop colors and negative-edge red, but create dark soft backgrounds with `semanticSoftColor()`.
- Include the mode or `visualTheme` in `useMemo`, `useCallback`, and drawing-effect dependency arrays so a theme switch repaints without a reload.

- [ ] **Step 5: Add dark CSS for legends and graph side panels**

Add complete dark selectors using actual component classes:

```css
:root[data-theme="dark"] .loop-kg-toolbar,
:root[data-theme="dark"] .loop-kg-side,
:root[data-theme="dark"] .loop-kg-map-row,
:root[data-theme="dark"] .brand-sfd-legend > div,
:root[data-theme="dark"] .company-operating-legend,
:root[data-theme="dark"] .company-operating-model-note {
  color: var(--lc-text-secondary);
  background: var(--lc-surface-raised);
  border-color: var(--lc-border-light);
}
```

Do not replace positive/negative/rollup edge colors with white; their semantics must remain visible.

- [ ] **Step 6: Run graph tests and build**

Run:

```bash
cd frontend && node --test tests/globalDarkTheme.test.ts && npm run build
```

Expected: graph coverage tests PASS and the production build succeeds.

- [ ] **Step 7: Commit graph compatibility**

```bash
git add frontend/src/components frontend/src/pages/Home.tsx frontend/src/pages/CommerceHub.tsx frontend/src/pages/CommerceFusion.tsx frontend/src/index.css frontend/tests/globalDarkTheme.test.ts
git commit -m "fix: adapt graph canvases to dark mode"
```

---

### Task 7: Add a repeatable dark-mode hard-code audit

**Files:**

- Create: `frontend/scripts/audit-dark-mode.mjs`
- Modify: `frontend/package.json`
- Test: `frontend/tests/globalDarkTheme.test.ts`

**Interfaces:**

- Consumes: frontend source files after Tasks 1–6.
- Produces: `npm run audit:dark` with a non-zero exit code for new inline white/light surfaces or light-only graph tooltip markup.

- [ ] **Step 1: Add the failing package-script assertion**

Append:

```ts
test("package exposes the dark-mode source audit", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["audit:dark"], "node scripts/audit-dark-mode.mjs");
});
```

- [ ] **Step 2: Run the test and verify failure**

Run `cd frontend && node --test tests/globalDarkTheme.test.ts`.

Expected: FAIL because `audit:dark` is not defined.

- [ ] **Step 3: Implement the audit script**

Create `frontend/scripts/audit-dark-mode.mjs` with these rules:

```js
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = new URL("../src/", import.meta.url);
const extensions = new Set([".ts", ".tsx"]);
const violations = [];
const patterns = [
  { name: "inline white background", regex: /background(?:Color)?:\s*["'`]#(?:fff|ffffff)["'`]/gi },
  { name: "inline pale surface", regex: /background(?:Color)?:\s*["'`]#(?:f8fafc|f5f7fb|f4f7fb|eef2f7)["'`]/gi },
  { name: "light graph tooltip", regex: /background:#fff;border:1px solid #d7e0ec/gi },
  { name: "white graph label", regex: /labelBgStyle:\s*\{\s*fill:\s*["'`]#ffffff["'`]/gi },
];

function walk(path) {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (extensions.has(extname(file))) {
      const source = readFileSync(file, "utf8");
      for (const rule of patterns) {
        for (const match of source.matchAll(rule.regex)) {
          const line = source.slice(0, match.index).split("\n").length;
          violations.push(`${relative(new URL("..", root).pathname, file)}:${line} ${rule.name}`);
        }
      }
    }
  }
}

walk(root.pathname);
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Dark-mode inline color audit passed.");
}
```

If an inline color is legitimately theme-independent, replace it with a named semantic constant rather than adding an audit ignore list.

- [ ] **Step 4: Add and run the package script**

Add to `frontend/package.json`:

```json
"audit:dark": "node scripts/audit-dark-mode.mjs"
```

Run:

```bash
cd frontend && npm run audit:dark && npm test && npm run build
```

Expected: the audit prints `Dark-mode inline color audit passed.`, all tests PASS, and the build succeeds.

- [ ] **Step 5: Commit the audit**

```bash
git add frontend/scripts/audit-dark-mode.mjs frontend/package.json frontend/tests/globalDarkTheme.test.ts
git commit -m "test: audit dark mode color compatibility"
```

---

### Task 8: Full-route visual verification and final cleanup

**Files:**

- Modify only files with observed visual defects from the route pass.
- Update: `docs/superpowers/specs/2026-07-20-global-dark-mode-compatibility-design.md` only if the verified behavior differs from the approved contract.

**Interfaces:**

- Consumes: the complete implementation from Tasks 1–7.
- Produces: verified dark and light local previews with no known visual blockers.

- [ ] **Step 1: Run the complete automated gate**

Run:

```bash
cd frontend && npm run audit:dark && npm test && npm run build
```

Expected: audit PASS, all tests PASS, production build succeeds.

- [ ] **Step 2: Start local services using the repository's documented command**

Use the existing project launch path from `README.md`/current environment; do not introduce a second launcher. Confirm the frontend URL returns HTTP 200 before opening the browser.

- [ ] **Step 3: Inspect every formal route in dark mode**

Visit this exact route set from `frontend/src/App.tsx`:

```text
/login
/home
/agent
/collab
/ontology
/knowledge
/skills
/agent-memory
/commerce
/commerce/bench
/commerce/loops
/work
/connectors
/tables
/datalake
/my/knowledge
/my/favorites
/my/recent
/agents
/accounts
/audit
```

For each route, inspect page canvas, header, cards, tables, forms, hover/focus/selected state, dropdown portal, modal/drawer where available, empty/loading/error states, and scroll boundaries. Record screenshots for `/agent`, `/collab`, `/agent-memory`, `/ontology`, `/commerce/loops`, `/work`, `/knowledge`, `/skills`, `/connectors`, `/tables`, and `/accounts`.

- [ ] **Step 4: Inspect the same critical routes in light mode**

Revisit `/agent`, `/collab`, `/agent-memory`, `/ontology`, `/commerce/loops`, `/work`, `/knowledge`, `/tables`, and `/accounts` in light mode. Confirm that backgrounds, text, graph nodes, tooltips, fixed table columns, and dialogs remain readable and that layout dimensions did not change.

- [ ] **Step 5: Fix observed defects with a failing regression assertion first**

For each discovered defect, add one focused assertion to `frontend/tests/globalDarkTheme.test.ts` or the nearest existing test, run it to observe failure, replace the offending constant/selector with the appropriate semantic token, then rerun the focused test. Do not batch unrelated visual defects under one assertion.

- [ ] **Step 6: Run the final verification gate**

Run:

```bash
git diff --check
cd frontend && npm run audit:dark && npm test && npm run build
```

Expected: no whitespace errors, audit PASS, all tests PASS, and production build succeeds.

- [ ] **Step 7: Commit final visual corrections**

```bash
git add frontend docs/superpowers/specs/2026-07-20-global-dark-mode-compatibility-design.md
git commit -m "fix: complete global dark mode compatibility"
```

- [ ] **Step 8: Report the local preview and validation evidence**

Provide the user with the local preview URL, the branch name, the final commit, the automated test/build results, the routes visually inspected, and any remaining environment-only limitations. Do not claim a route is verified unless it was opened in both the required mode and viewport.
