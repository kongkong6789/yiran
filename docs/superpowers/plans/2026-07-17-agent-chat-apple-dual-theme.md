# 良策对话页 Apple 极简黑白双主题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/agent` 改造成已确认 V3 预览中的 Apple 极简浅色/深色对话界面，同步 GitHub 最新改动并连接现有 PostgreSQL 数据湖，最终停在本地待审核状态。

**Architecture:** 保持一套 `AgentChat` 组件树；纯 TypeScript 模块负责 `light | dark` 解析和本地持久化，页面根节点用 `data-chat-theme` 暴露状态，独立 CSS 文件只在 `.agent-chat-shell` 下覆盖视觉。数据库继续走已有 `PgLake`，只配置被 Git 忽略的 `backend/.env`，不更换 Django 默认 SQLite。

**Tech Stack:** React 18、TypeScript 5、Vite 5、Ant Design 5、Node.js 24 内置测试、CSS 自定义属性、Django 5、psycopg2。

## Global Constraints

- 仅修改 `/agent`；顶部导航和其他路由保持现状。
- 主题值固定为 `light` 和 `dark`，默认 `light`，存储 key 固定为 `liangce_chat_theme`。
- Logo 和用户内容保留原色；对话 UI 只使用 Apple 黑、白和系统灰阶。
- 不新增运行时依赖或测试依赖，不切换全局 Ant Design theme，不修改聊天 API。
- 主题完成并本地提交后才同步 `origin/main`；未经用户审核不得推送。
- PostgreSQL 密码只存在 `backend/.env`，不得写入计划、源码或 Git 历史。
- 只执行目标测试、前端构建、主题冒烟和数据库连通验证。

## File Structure

- Create `frontend/src/pages/agentChatTheme.ts`：主题类型、默认值和安全存取。
- Create `frontend/tests/agentChatTheme.test.ts`：主题默认值、合法值、异常和写入测试。
- Create `frontend/src/styles/agentChatApple.css`：V3 浅色/深色 token 与 `/agent` 局部覆盖。
- Modify `frontend/src/pages/AgentChat.tsx`：接入主题状态、切换器和黑白 Avatar 类。
- Modify `frontend/src/main.tsx`：在全局基础样式后加载局部覆盖。
- Modify `frontend/package.json`：增加 Node 内置测试命令。
- Modify ignored `backend/.env`：写入用户提供的 PostgreSQL 连接参数，不提交。

---

### Task 1: 建立可持久化的主题状态

**Files:**
- Create: `frontend/src/pages/agentChatTheme.ts`
- Create: `frontend/tests/agentChatTheme.test.ts`
- Modify: `frontend/package.json:6-10`

**Interfaces:**
- Produces: `ChatTheme`, `DEFAULT_CHAT_THEME`, `CHAT_THEME_STORAGE_KEY`, `readChatTheme(storage)`, `persistChatTheme(storage, theme)`。
- Consumes: 只需要具备 `getItem` / `setItem` 的浏览器 Storage 子集。

- [ ] **Step 1: 增加零依赖测试命令并写失败测试**

在 `package.json` 增加：

```json
"test": "node --test tests/*.test.ts"
```

创建 `frontend/tests/agentChatTheme.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行目标测试并确认缺少模块**

Run: `cd frontend && npm test`  
Expected: FAIL，错误包含 `Cannot find module '../src/pages/agentChatTheme.ts'`。

- [ ] **Step 3: 实现最小主题模块**

创建 `frontend/src/pages/agentChatTheme.ts`：

```ts
export type ChatTheme = "light" | "dark";

export const DEFAULT_CHAT_THEME: ChatTheme = "light";
export const CHAT_THEME_STORAGE_KEY = "liangce_chat_theme";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function getChatThemeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readChatTheme(storage: ReadableStorage | null): ChatTheme {
  try {
    const value = storage?.getItem(CHAT_THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : DEFAULT_CHAT_THEME;
  } catch {
    return DEFAULT_CHAT_THEME;
  }
}

export function persistChatTheme(storage: WritableStorage | null, theme: ChatTheme): void {
  try {
    storage?.setItem(CHAT_THEME_STORAGE_KEY, theme);
  } catch {
    // Preference persistence is best-effort and must never block chat.
  }
}
```

- [ ] **Step 4: 运行测试**

Run: `cd frontend && npm test`  
Expected: 4 tests PASS。

### Task 2: 接入 V3 页面结构与局部样式

**Files:**
- Create: `frontend/src/styles/agentChatApple.css`
- Modify: `frontend/src/pages/AgentChat.tsx:1-30,115-140,427-760`
- Modify: `frontend/src/main.tsx:8-10`

**Interfaces:**
- Consumes: Task 1 的主题 API。
- Produces: `.agent-chat-shell[data-chat-theme="light|dark"]` 主题根节点和可访问切换器。

- [ ] **Step 1: 在 `AgentChat.tsx` 接入主题状态**

加入图标和主题模块导入：

```tsx
import {
  BulbOutlined, DeleteOutlined, HistoryOutlined, MoonOutlined, PaperClipOutlined,
  PictureOutlined, PlusOutlined, RobotOutlined, SendOutlined, SunOutlined, UserOutlined,
} from "@ant-design/icons";
import {
  getChatThemeStorage,
  persistChatTheme,
  readChatTheme,
  type ChatTheme,
} from "./agentChatTheme";
```

在组件状态区加入：

```tsx
const [chatTheme, setChatTheme] = useState<ChatTheme>(() => (
  readChatTheme(getChatThemeStorage())
));

useEffect(() => {
  persistChatTheme(getChatThemeStorage(), chatTheme);
  document.body.dataset.agentChatTheme = chatTheme;
  return () => {
    delete document.body.dataset.agentChatTheme;
  };
}, [chatTheme]);
```

把根节点改为：

```tsx
<div className="agent-chat-shell" data-chat-theme={chatTheme}>
```

- [ ] **Step 2: 加入可访问切换器并移除彩色内联样式**

在页头操作区最后、新对话按钮之前加入：

```tsx
<div className="agent-chat-theme-switch" role="group" aria-label="对话主题">
  <Tooltip title="白色主题">
    <button
      type="button"
      className={chatTheme === "light" ? "active" : ""}
      aria-label="切换为白色主题"
      aria-pressed={chatTheme === "light"}
      onClick={() => setChatTheme("light")}
    >
      <SunOutlined />
    </button>
  </Tooltip>
  <Tooltip title="黑色主题">
    <button
      type="button"
      className={chatTheme === "dark" ? "active" : ""}
      aria-label="切换为黑色主题"
      aria-pressed={chatTheme === "dark"}
      onClick={() => setChatTheme("dark")}
    >
      <MoonOutlined />
    </button>
  </Tooltip>
</div>
```

移除 `brand` 导入和所有 `brand.gradientGold` / `brand.navyMid` / `brand.gold` 内联颜色；为助手 Avatar 使用 `agent-chat-avatar-assistant`，无照片的用户 Avatar 使用 `agent-chat-avatar-user`，灯泡使用 `agent-chat-quick-icon`。

- [ ] **Step 3: 创建局部主题样式**

创建 `frontend/src/styles/agentChatApple.css`，使用以下 token 和布局契约；所有选择器必须位于 `.agent-chat-shell` 或对话页专用弹层 class 下：

```css
.agent-chat-shell {
  --chat-canvas: #ffffff;
  --chat-rail: #f5f5f7;
  --chat-surface: #fafafc;
  --chat-ink: #1d1d1f;
  --chat-muted: #7a7a7a;
  --chat-line: #e0e0e0;
  --chat-soft-line: #f0f0f0;
  --chat-chip: #f5f5f7;
  --chat-action: #1d1d1f;
  --chat-action-text: #ffffff;
  grid-template-columns: 264px minmax(0, 1fr);
  gap: 0;
  height: calc(100vh - 68px);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
  color: var(--chat-ink);
  background: var(--chat-canvas);
}

.agent-chat-shell[data-chat-theme="dark"] {
  color-scheme: dark;
  --chat-canvas: #000000;
  --chat-rail: #171717;
  --chat-surface: #272729;
  --chat-ink: #ffffff;
  --chat-muted: #cccccc;
  --chat-line: #333333;
  --chat-soft-line: #252527;
  --chat-chip: #272729;
  --chat-action: #ffffff;
  --chat-action-text: #000000;
}

.agent-chat-shell .agent-chat-history,
.agent-chat-shell .agent-chat-page {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.agent-chat-shell .agent-chat-history {
  background: var(--chat-rail);
  border-right: 1px solid var(--chat-line);
}

.agent-chat-shell .agent-chat-page,
.agent-chat-shell .agent-chat-header,
.agent-chat-shell .agent-chat-body,
.agent-chat-shell .agent-chat-input {
  background: var(--chat-canvas);
  color: var(--chat-ink);
}

.agent-chat-shell .agent-chat-header {
  min-height: 60px;
  padding: 10px 22px;
  border-bottom: 1px solid var(--chat-soft-line);
}

.agent-chat-shell .agent-chat-quick {
  padding: 8px 22px;
  border-bottom: 1px solid var(--chat-soft-line);
  background: var(--chat-canvas);
}

.agent-chat-shell .agent-chat-body {
  padding: 44px max(40px, calc((100% - 760px) / 2));
  gap: 36px;
}

.agent-chat-shell .agent-chat-row {
  width: 100%;
  max-width: 760px;
}

.agent-chat-shell .agent-chat-row.assistant .agent-chat-bubble {
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.agent-chat-shell .agent-chat-row.user {
  width: auto;
  max-width: min(560px, 78%);
}

.agent-chat-shell .agent-chat-row.user .agent-chat-bubble {
  padding: 10px 15px;
  border: 0;
  border-radius: 18px;
  background: var(--chat-chip);
  color: var(--chat-ink);
  box-shadow: none;
}

.agent-chat-shell .agent-md-root {
  color: var(--chat-ink);
  font-size: 17px;
  line-height: 1.47;
  letter-spacing: -.374px;
}

.agent-chat-shell .agent-md-h1,
.agent-chat-shell .agent-md-h2,
.agent-chat-shell .agent-md-h3,
.agent-chat-shell .agent-md-h4,
.agent-chat-shell .agent-md-strong,
.agent-chat-shell .agent-md-p {
  color: var(--chat-ink);
}

.agent-chat-shell .agent-md-h1 {
  font: 600 clamp(30px, 3vw, 40px)/1.1 -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
  letter-spacing: -.374px;
}

.agent-chat-shell .agent-chat-input {
  padding: 10px max(40px, calc((100% - 800px) / 2)) 22px;
  border-top: 0;
}

.agent-chat-shell .agent-chat-composer {
  padding: 11px 14px 9px;
  border: 1px solid var(--chat-line);
  border-radius: 18px;
  background: var(--chat-surface);
  box-shadow: none;
}

.agent-chat-shell .agent-chat-composer textarea,
.agent-chat-shell .agent-chat-model-text,
.agent-chat-shell .ant-typography {
  color: var(--chat-ink) !important;
}

.agent-chat-shell .agent-chat-model-select .ant-select-selector,
.agent-chat-shell .agent-chat-kind-tag,
.agent-chat-shell .agent-chat-attach-tag {
  background: var(--chat-chip) !important;
  border-color: var(--chat-line) !important;
  color: var(--chat-muted) !important;
}

.agent-chat-shell .agent-chat-avatar-assistant,
.agent-chat-shell .agent-chat-avatar-user,
.agent-chat-shell .agent-chat-send-circle {
  background: var(--chat-action) !important;
  color: var(--chat-action-text) !important;
  box-shadow: none !important;
}

.agent-chat-theme-switch {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 10px;
  background: var(--chat-chip);
}

.agent-chat-theme-switch button {
  width: 30px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--chat-muted);
  cursor: pointer;
}

.agent-chat-theme-switch button.active {
  background: var(--chat-canvas);
  color: var(--chat-ink);
}

.agent-chat-theme-switch button:focus-visible {
  outline: 2px solid var(--chat-ink);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: no-preference) {
  .agent-chat-shell,
  .agent-chat-shell .agent-chat-history,
  .agent-chat-shell .agent-chat-page,
  .agent-chat-shell .agent-chat-composer {
    transition: color 200ms ease, background-color 200ms ease, border-color 200ms ease;
  }
}

@media (max-width: 900px) {
  .agent-chat-shell { display: flex; min-height: calc(100vh - 68px); }
  .agent-chat-shell .agent-chat-body { padding: 32px 20px; }
  .agent-chat-shell .agent-chat-input { padding: 10px 14px 18px; }
}
```

在同一文件追加 Markdown、会话和专用弹层覆盖；不要修改 CollabRisk 使用的全局 `ChatMarkdown` 样式：

```css
.agent-chat-shell .agent-chat-session:hover,
.agent-chat-shell .agent-chat-session:focus-visible,
.agent-chat-shell .agent-chat-session.active {
  background: var(--chat-chip);
  border-color: transparent;
}

.agent-chat-shell .agent-chat-session strong,
.agent-chat-shell .agent-chat-history-head .ant-typography,
.agent-chat-shell .agent-chat-header .ant-typography {
  color: var(--chat-ink) !important;
}

.agent-chat-shell .agent-chat-session span,
.agent-chat-shell .agent-chat-header .ant-typography-secondary,
.agent-chat-shell .agent-md-em {
  color: var(--chat-muted) !important;
}

.agent-chat-shell .agent-report-card,
.agent-chat-shell .agent-md-section,
.agent-chat-shell .agent-md-table td,
.agent-chat-shell .agent-md-table th,
.agent-chat-shell .agent-md-pre,
.agent-chat-shell .agent-md-code,
.agent-chat-shell .agent-md-mermaid,
.agent-chat-shell .agent-md-quote {
  background: var(--chat-surface);
  border-color: var(--chat-line);
  color: var(--chat-ink);
  box-shadow: none;
}

.agent-chat-shell .agent-report-card,
.agent-chat-shell .agent-md-section.is-lead .agent-md-h1:first-child,
.agent-chat-shell .agent-md-section.is-lead .agent-md-h2:first-child,
.agent-chat-shell .agent-md-root.report .agent-md-h1,
.agent-chat-shell .agent-md-root.report .agent-md-h2:first-child {
  background: var(--chat-surface);
  border-color: var(--chat-line);
}

.agent-chat-shell .agent-md-h3,
.agent-chat-shell .agent-md-quote {
  border-left-color: var(--chat-ink);
}

.agent-chat-shell .agent-md-h3::before,
.agent-chat-shell .agent-md-h4::before,
.agent-chat-shell .agent-md-section .agent-md-h3::before,
.agent-chat-shell .agent-md-section .agent-md-h4::before {
  background: var(--chat-ink);
}

.agent-chat-shell .agent-md-li::marker,
.agent-chat-shell .agent-md-link,
.agent-chat-shell .agent-md-pre code {
  color: var(--chat-ink);
}

.agent-chat-shell .agent-md-img,
.agent-chat-shell .agent-chat-attach-image,
.agent-chat-shell .agent-chat-pending-image {
  border-color: var(--chat-line);
  background: var(--chat-surface);
}

body[data-agent-chat-theme="dark"] .agent-chat-model-dropdown .ant-select-item,
body[data-agent-chat-theme="dark"] .agent-chat-model-dropdown .ant-select-item-group,
body[data-agent-chat-theme="dark"] .chat-skill-popover-wrap .ant-popover-inner {
  background: #272729;
  color: #ffffff;
  border-color: #333333;
}

body[data-agent-chat-theme="dark"] .agent-chat-model-dropdown .ant-select-item-option-selected,
body[data-agent-chat-theme="dark"] .agent-chat-model-dropdown .ant-select-item-option-active {
  background: #333333;
}
```

- [ ] **Step 4: 在 `main.tsx` 的 `index.css` 后加载局部样式**

```ts
import "./index.css";
import "./styles/agentChatApple.css";
```

- [ ] **Step 5: 运行主题测试和生产构建**

Run: `cd frontend && npm test && npm run build`  
Expected: 4 tests PASS；TypeScript 与 Vite 构建成功。

- [ ] **Step 6: 本地提交主题**

```bash
git add frontend/package.json frontend/src/main.tsx frontend/src/pages/AgentChat.tsx frontend/src/pages/agentChatTheme.ts frontend/src/styles/agentChatApple.css frontend/tests/agentChatTheme.test.ts
git commit -m "feat: add apple dual theme to agent chat"
```

### Task 3: 同步 GitHub 最新 main

**Files:**
- Rebase current local commits onto: `origin/main`

**Interfaces:**
- Consumes: Task 2 的干净本地提交。
- Produces: 同时包含 V3 主题和同事最新改动的本地 `main`。

- [ ] **Step 1: 确认工作区干净并同步**

Run: `git status --short && git pull --rebase origin main`  
Expected: 工作区无未提交文件；Git 获取最新 `origin/main` 并重放本地提交。

- [ ] **Step 2: 若发生冲突，只处理冲突文件并继续 rebase**

Run after resolving the conflict hunks reported by Git: `git add --update && git rebase --continue`  
Expected: rebase 完成；不丢失同事业务改动或主题作用域。

- [ ] **Step 3: 重跑最小前端验证**

Run: `cd frontend && npm test && npm run build`  
Expected: 4 tests PASS；生产构建成功。

### Task 4: 配置 PostgreSQL 并停在本地审核状态

**Files:**
- Modify ignored: `backend/.env`

**Interfaces:**
- Consumes: 用户在当前请求中提供的五项 `POSTGRES_*` 凭据。
- Produces: 现有 `PgLake` 能连接 PostgreSQL；Django `DATABASES.default` 仍为 SQLite。

- [ ] **Step 1: 更新本地环境文件**

保留 `backend/.env` 现有其他配置，只新增或替换 `POSTGRES_HOST`、`POSTGRES_PORT`、`POSTGRES_DB`、`POSTGRES_USER`、`POSTGRES_PASSWORD`。密码不复制到本计划，文件继续由 `.gitignore` 排除。

- [ ] **Step 2: 验证敏感文件未进入 Git**

Run: `git status --short --ignored backend/.env`  
Expected: `backend/.env` 显示为 ignored，不显示为可提交文件。

- [ ] **Step 3: 验证 PostgreSQL**

Run: `cd backend && .venv/bin/python scripts/list_pg_tables.py`；若本地虚拟环境不存在，则使用已安装依赖的 `python3`。  
Expected: 输出已脱敏的连接端点、schema 与表数量；命令退出码为 0。

- [ ] **Step 4: 浏览器最小冒烟**

启动现有前后端，打开 `/agent`，检查白色默认、黑色切换、刷新记忆、历史栏、输入区和其他任一路由未被主题污染。  
Expected: 核心交互可用，无横向溢出或不可读文字。

- [ ] **Step 5: 最终边界检查**

Run: `git status --short && git log -6 --oneline --decorate`  
Expected: 无敏感文件；所有改动仅本地存在；不执行 `git push`。
