# Global Monochrome Theme and PostgreSQL Pause Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Xiaoce pause on PostgreSQL and make its white/black controls switch a readable monochrome theme across the whole site.

**Architecture:** Keep the existing `ThemeModeContext` as the single theme source and remove Xiaoce's duplicate local preference. Root Ant Design tokens and CSS variables define pure white/pure black surfaces; transparent foreground colors supply muted text and borders while semantic status colors and image/avatar colors remain untouched. The cancellation transaction locks only `XiaoceRun`, avoiding PostgreSQL's nullable outer-join lock restriction.

**Tech Stack:** React 18, TypeScript, Ant Design 5, CSS custom properties, Django 5, PostgreSQL, Node test runner, Django TestCase.

## Global Constraints

- Default theme is pure white; the selected black theme persists across refreshes and routes.
- No separate neutral-gray theme or solid gray surface palette; muted UI uses black/white alpha values.
- Brand logo, avatars, online state, success, warning, and risk colors remain unchanged.
- Preserve existing collaboration message, monitor, Skill packaging, WebSocket, and polling logic.
- Run only focused tests, one frontend build, one Django check, and browser acceptance; do not push before user approval.

---

### Task 1: PostgreSQL-safe Xiaoce cancellation

**Files:**
- Modify: `backend/apps/collab/tests/test_xiaoce_runs.py`
- Modify: `backend/apps/collab/xiaoce_runs.py`

**Interfaces:**
- Consumes: `cancel_xiaoce_run(run: XiaoceRun) -> XiaoceRun`
- Produces: the same public function and idempotent response, with no nullable join in its locking query.

- [ ] **Step 1: Write the failing query-shape regression test**

Add a `CaptureQueriesContext` assertion that calls `cancel_xiaoce_run`, selects the `collab_xiaocerun` query, and requires `LEFT OUTER JOIN` to be absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `backend/manage.py test apps.collab.tests.test_xiaoce_runs.XiaoceRunTests.test_cancel_lock_does_not_join_nullable_message -v 2`

Expected: FAIL because the current `select_related("cancel_message")` emits a nullable left outer join.

- [ ] **Step 3: Remove the nullable relation from the row-lock query**

Use:

```python
locked = (
    XiaoceRun.objects.select_for_update()
    .select_related("room")
    .get(id=run.id)
)
```

The existing created/previous `cancel_message` remains accessible through its foreign-key ID after the lock; no response schema changes.

- [ ] **Step 4: Run the focused Xiaoce backend tests and verify GREEN**

Run: `backend/manage.py test apps.collab.tests.test_xiaoce_runs apps.collab.tests.test_xiaoce_api -v 1`

Expected: PASS, including idempotent cancellation and completed-run conflict behavior.

- [ ] **Step 5: Commit the pause fix**

Commit message: `fix: make xiaoce cancellation postgres safe`

### Task 2: Single global monochrome theme source

**Files:**
- Modify: `frontend/tests/xiaoceChat.test.ts`
- Modify: `frontend/src/pages/CollabRisk.tsx`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/styles/xiaoceChatTheme.css`

**Interfaces:**
- Consumes: `useThemeMode(): { mode, setMode, toggle }` and storage key `lc-theme-mode`.
- Produces: Xiaoce white/black buttons that call `setMode("light" | "dark")`; global tokens `--lc-canvas`, `--lc-surface`, `--lc-ink`, `--lc-muted`, `--lc-line`, `--lc-hover`, `--lc-own-bg`, and `--lc-own-ink`.

- [ ] **Step 1: Replace local-theme source assertions with global-theme assertions**

Require `CollabRisk.tsx` to import/use `useThemeMode`, require the root stylesheet to define both theme token sets, and reject Xiaoce's local `data-chat-theme` wiring and `readChatTheme` persistence calls.

- [ ] **Step 2: Run frontend tests and verify RED**

Run: `npm test`

Expected: FAIL because Xiaoce still owns local `chatTheme` state and its CSS is scoped to only the center panel.

- [ ] **Step 3: Wire Xiaoce controls to `ThemeModeContext`**

In `CollabRisk`, replace local state with:

```ts
const { mode, setMode } = useThemeMode();
```

Set the two buttons from `mode` and call `setMode("light")` / `setMode("dark")`. Keep the buttons visible only in the Xiaoce direct room and remove `data-chat-theme` from the center section.

- [ ] **Step 4: Convert root Ant Design and CSS tokens to monochrome**

Use pure `#fff`/`#000` for base/layout/container/text/primary tokens and alpha values for borders, secondary text, hover, and shadows. Remove decorative page gradients. Do not apply filters to images or avatars and do not override semantic success/warning/error colors.

- [ ] **Step 5: Make collaboration surfaces consume the global tokens**

Reduce `xiaoceChatTheme.css` to Xiaoce-specific control/bubble geometry using the root variables. Add collaboration overrides for side list, main messages, Markdown/report blocks, composer, monitor KPIs, menus, and modal/popover surfaces so both themes remain readable across all three columns.

- [ ] **Step 6: Run focused frontend tests and build**

Run: `npm test && npm run build`

Expected: all tests PASS and Vite build succeeds with only the existing chunk-size warning.

- [ ] **Step 7: Commit the global theme change**

Commit message: `fix: apply monochrome theme across the app`

### Task 3: Focused integration and visual acceptance

**Files:**
- Verify only; remove temporary QA artifacts if any.

**Interfaces:**
- Consumes: running Vite preview on `localhost:5174` and Django backend on `127.0.0.1:8000`.
- Produces: evidence for white, black, persistence, route-wide switching, readable Xiaoce content, and a successful pause response.

- [ ] **Step 1: Run focused backend and system checks**

Run the Xiaoce cancellation tests and `backend/manage.py check` with the platform PostgreSQL configuration.

- [ ] **Step 2: Verify both themes in the browser**

Check `/collab` in white and black, then navigate to one other route and confirm the same root theme persists. Inspect header, left list, center Markdown, composer, right monitor, popovers, Logo, and avatars.

- [ ] **Step 3: Verify real pause in the browser**

Start one harmless Xiaoce request, press the square pause control, require exactly one `已暂停本次生成。` response, no failure toast, and no later full reply.

- [ ] **Step 4: Stop before remote integration**

Report the local branch and preview result. Do not fetch/rebase/push until the user approves this preview.
