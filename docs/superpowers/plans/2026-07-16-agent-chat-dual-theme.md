# 良策 AI 对话页双主题改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/agent` 改造成可在“温润智囊”和“沉浸指挥”之间切换的高品质 AI 对话工作区，同时保留全部现有聊天能力并确保主题不影响全站其他页面。

**Architecture:** 使用单一 React 组件树；主题状态与本地持久化封装在纯 TypeScript 模块中，受控切换器作为独立组件，页面根节点通过 `data-chat-theme` 暴露状态。新增的样式文件在全局基础样式之后加载，但所有规则均限定在 `.agent-chat-shell` 或专用弹层类下，以局部 `--chat-*` 变量实现两套视觉主题。

**Tech Stack:** React 18、TypeScript 5、Vite 5、Ant Design 5、Node.js 24 内置测试运行器、CSS 自定义属性、Codex in-app Browser。

## Global Constraints

- 主题切换只影响 `/agent` AI 对话页；顶部全站导航和其他路由保持现状。
- 首次进入默认主题必须是 `warm`，深色主题值必须是 `command`。
- 本地存储 key 固定为 `liangce_chat_theme`。
- 主题切换只过渡颜色、背景、边框与阴影，时长固定为 `200ms`。
- 不新增运行时依赖或测试依赖；测试使用当前环境 Node.js `v24.15.0` 的内置 `node:test`。
- 不切换全局 Ant Design theme，不新增后端 API，不维护两套 React 页面。
- 模型、Skill、连接器、附件、管理员只读、Markdown、Mermaid、历史会话和发送逻辑必须保持可用。
- 移动端隐藏历史栏的现有行为继续保留，主题按钮必须可见且可通过键盘操作。

## File Structure

- Create `frontend/src/pages/agentChatTheme.ts`：主题类型、默认值、选项文案、本地存储安全读写。
- Create `frontend/tests/agentChatTheme.test.ts`：主题解析、异常降级、持久化与选项文案测试。
- Create `frontend/src/components/ChatThemeSwitch.tsx`：受控、可访问的太阳/月亮切换器。
- Create `frontend/src/styles/agentChat.css`：仅对话页使用的温润/深色 token 与布局覆盖。
- Create `frontend/tests/agentChatStyles.test.ts`：CSS 作用域、主题选择器、响应式和减弱动画契约测试。
- Modify `frontend/src/pages/AgentChat.tsx`：接入主题状态、切换器、重组页头和空状态，不改变 API 逻辑。
- Modify `frontend/src/main.tsx`：保证对话页覆盖样式在 `index.css` 之后加载。
- Modify `frontend/package.json`：增加零依赖 `npm test` 命令。

---

### Task 1: 建立主题状态与持久化纯逻辑

**Files:**
- Create: `frontend/src/pages/agentChatTheme.ts`
- Create: `frontend/tests/agentChatTheme.test.ts`
- Modify: `frontend/package.json:6-10`

**Interfaces:**
- Consumes: 浏览器 `Storage` 的 `getItem` / `setItem` 接口。
- Produces: `ChatTheme`、`DEFAULT_CHAT_THEME`、`CHAT_THEME_STORAGE_KEY`、`getChatThemeStorage()`、`readChatTheme()`、`persistChatTheme()`，供 Task 2 和 Task 3 使用。

- [ ] **Step 1: 在 package.json 增加测试命令**

将 `scripts` 改为：

```json
"scripts": {
  "dev": "vite --host 0.0.0.0",
  "build": "tsc -b && vite build",
  "test": "node --test tests/*.test.ts",
  "preview": "vite preview"
}
```

- [ ] **Step 2: 写出主题逻辑的失败测试**

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

test("defaults to the warm chat theme", () => {
  assert.equal(DEFAULT_CHAT_THEME, "warm");
  assert.equal(readChatTheme(null), "warm");
});

test("restores only supported stored values", () => {
  assert.equal(readChatTheme({ getItem: () => "command" }), "command");
  assert.equal(readChatTheme({ getItem: () => "warm" }), "warm");
  assert.equal(readChatTheme({ getItem: () => "unknown" }), "warm");
});

test("falls back when storage reads throw", () => {
  assert.equal(readChatTheme({ getItem: () => { throw new Error("blocked"); } }), "warm");
});

test("persists theme with the fixed storage key", () => {
  const writes: Array<[string, string]> = [];
  persistChatTheme({ setItem: (key, value) => writes.push([key, value]) }, "command");
  assert.deepEqual(writes, [[CHAT_THEME_STORAGE_KEY, "command"]]);
});

test("ignores storage write failures", () => {
  assert.doesNotThrow(() => {
    persistChatTheme({ setItem: () => { throw new Error("blocked"); } }, "warm");
  });
});

```

- [ ] **Step 3: 运行测试并确认按预期失败**

Run: `cd frontend && npm test`

Expected: FAIL，错误包含 `Cannot find module '../src/pages/agentChatTheme.ts'`。

- [ ] **Step 4: 实现最小主题逻辑**

创建 `frontend/src/pages/agentChatTheme.ts`：

```ts
export type ChatTheme = "warm" | "command";

export const DEFAULT_CHAT_THEME: ChatTheme = "warm";
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
    return value === "command" || value === "warm" ? value : DEFAULT_CHAT_THEME;
  } catch {
    return DEFAULT_CHAT_THEME;
  }
}

export function persistChatTheme(storage: WritableStorage | null, theme: ChatTheme): void {
  try {
    storage?.setItem(CHAT_THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is best-effort and must never block chat.
  }
}
```

- [ ] **Step 5: 运行单元测试与生产构建**

Run: `cd frontend && npm test && npm run build`

Expected: 5 tests PASS；`tsc -b && vite build` 成功并生成 `frontend/dist`。

- [ ] **Step 6: 提交主题状态逻辑**

```bash
git add frontend/package.json frontend/src/pages/agentChatTheme.ts frontend/tests/agentChatTheme.test.ts
git commit -m "feat: add persisted chat theme state"
```

---

### Task 2: 实现可访问的主题切换器

**Files:**
- Create: `frontend/src/components/ChatThemeSwitch.tsx`
- Modify: `frontend/tests/agentChatTheme.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `ChatTheme` 和 `DEFAULT_CHAT_THEME`。
- Produces: `CHAT_THEME_OPTIONS` 和 `ChatThemeSwitch({ theme, onChange })` 受控组件，Task 3 将组件放入对话页头。

- [ ] **Step 1: 扩展失败测试，锁定受控切换所需选项**

在 `frontend/tests/agentChatTheme.test.ts` 的导入列表加入 `CHAT_THEME_OPTIONS`，并追加：

```ts
test("exposes stable labels for both switch options", () => {
  assert.deepEqual(CHAT_THEME_OPTIONS, [
    { value: "warm", label: "温润智囊", ariaLabel: "切换为温润智囊主题" },
    { value: "command", label: "沉浸指挥", ariaLabel: "切换为沉浸指挥主题" },
  ]);
});

test("keeps the warm option first so first render matches the default", () => {
  assert.equal(CHAT_THEME_OPTIONS[0].value, DEFAULT_CHAT_THEME);
  assert.equal(CHAT_THEME_OPTIONS[1].value, "command");
});
```

- [ ] **Step 2: 运行目标测试并确认失败原因正确**

Run: `cd frontend && npm test`

Expected: FAIL，错误说明 `agentChatTheme.ts` 尚未导出 `CHAT_THEME_OPTIONS`。

- [ ] **Step 3: 恢复正确顺序并创建切换器组件**

先在 `frontend/src/pages/agentChatTheme.ts` 的存储 key 后加入：

```ts
export const CHAT_THEME_OPTIONS = [
  { value: "warm", label: "温润智囊", ariaLabel: "切换为温润智囊主题" },
  { value: "command", label: "沉浸指挥", ariaLabel: "切换为沉浸指挥主题" },
] as const satisfies ReadonlyArray<{
  value: ChatTheme;
  label: string;
  ariaLabel: string;
}>;
```

再创建 `frontend/src/components/ChatThemeSwitch.tsx`：

```tsx
import { MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import type { ReactNode } from "react";
import {
  CHAT_THEME_OPTIONS,
  type ChatTheme,
} from "../pages/agentChatTheme";

type Props = {
  theme: ChatTheme;
  onChange: (theme: ChatTheme) => void;
};

const ICONS = {
  warm: <SunOutlined />,
  command: <MoonOutlined />,
} satisfies Record<ChatTheme, ReactNode>;

export default function ChatThemeSwitch({ theme, onChange }: Props) {
  return (
    <div className="agent-chat-theme-toggle" role="group" aria-label="对话显示主题">
      {CHAT_THEME_OPTIONS.map((option) => {
        const active = option.value === theme;
        return (
          <Tooltip key={option.value} title={option.label} placement="bottom">
            <button
              type="button"
              className={`agent-chat-theme-option${active ? " active" : ""}`}
              aria-label={option.ariaLabel}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
            >
              {ICONS[option.value]}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试和类型构建**

Run: `cd frontend && npm test && npm run build`

Expected: 7 tests PASS；TypeScript 接受 `Record<ChatTheme, ReactNode>` 与受控 props；Vite 构建成功。

- [ ] **Step 5: 提交切换器组件**

```bash
git add frontend/src/pages/agentChatTheme.ts frontend/src/components/ChatThemeSwitch.tsx frontend/tests/agentChatTheme.test.ts
git commit -m "feat: add accessible chat theme switch"
```

---

### Task 3: 将双主题和新信息层级接入 AgentChat

**Files:**
- Modify: `frontend/src/pages/AgentChat.tsx:1-670`

**Interfaces:**
- Consumes: Task 1 的 `getChatThemeStorage()`、`readChatTheme()`、`persistChatTheme()` 和 `ChatTheme`；Task 2 的 `ChatThemeSwitch`。
- Produces: 根节点 `data-chat-theme`、新的页头操作区、空状态任务入口和动态模型弹层类，供 Task 4 CSS 使用。

- [ ] **Step 1: 运行现有测试作为接入前基线**

Run: `cd frontend && npm test && npm run build`

Expected: 7 tests PASS；生产构建成功。

- [ ] **Step 2: 增加导入并将快捷提示改成结构化内容**

在组件导入区增加：

```tsx
import ChatThemeSwitch from "../components/ChatThemeSwitch";
import {
  getChatThemeStorage,
  persistChatTheme,
  readChatTheme,
  type ChatTheme,
} from "./agentChatTheme";
```

同时从 `@ant-design/icons` 导入列表中删除不再使用的 `BulbOutlined`，保留其余现有图标。

用以下内容替换 `QUICK_PROMPTS`：

```ts
const QUICK_PROMPTS = [
  {
    title: "读取企业资料",
    description: "总结企业微信文档并提取行动项",
    prompt: "读取这个企业微信文档并总结：https://doc.weixin.qq.com/...",
  },
  {
    title: "分析经营表现",
    description: "查看 GMV、退款率与异常变化",
    prompt: "昨天 GMV 和退款率怎么样？",
  },
  {
    title: "生成行动方案",
    description: "把经验整理成可执行的业务流程",
    prompt: "帮我梳理采购补货的 SOP 步骤",
  },
] as const;
```

- [ ] **Step 3: 增加局部主题状态和安全持久化 effect**

在 `AgentChat()` 的首组状态中加入：

```tsx
const [chatTheme, setChatTheme] = useState<ChatTheme>(() => (
  readChatTheme(getChatThemeStorage())
));
```

在模型持久化 effect 之后加入：

```tsx
useEffect(() => {
  persistChatTheme(getChatThemeStorage(), chatTheme);
}, [chatTheme]);
```

- [ ] **Step 4: 在根节点暴露主题并替换页头结构**

将根节点改为：

```tsx
<div className="agent-chat-shell" data-chat-theme={chatTheme}>
```

用以下完整页头替换现有 `.agent-chat-header`：

```tsx
<div className="agent-chat-header">
  <div className="agent-chat-identity">
    <Avatar size={42} className="agent-chat-agent-avatar" icon={<RobotOutlined />} />
    <div>
      <Typography.Title level={4} style={{ margin: 0 }}>良策业务智囊</Typography.Title>
      <Typography.Text className="agent-chat-subtitle">
        {viewingOthers
          ? `管理员只读预览 · ${activeSession?.username || "用户"} 的对话`
          : isAdminView
            ? "管理员模式 · 可查看全员对话"
            : "RAG · 图谱 · 企业微信 MCP · 对话自动保存"}
      </Typography.Text>
    </div>
  </div>

  <div className="agent-chat-header-actions">
    {lastMeta && (
      <div className="agent-chat-meta" aria-label="当前对话能力状态">
        <Tag color={lastMeta.llm ? "success" : "default"}>
          {lastMeta.llm ? "LLM 在线" : "演示模式"}
        </Tag>
        {lastMeta.llm_model && <Tag color="geekblue">{lastMeta.llm_model}</Tag>}
        {lastMeta.knowledge_hit && <Tag color="blue">已注入资料</Tag>}
        {lastMeta.mcp?.attempted && (
          <Tag color={lastMeta.mcp.ok ? "success" : "error"}>
            {lastMeta.mcp.ok ? `企微 MCP · ${lastMeta.mcp.tool}` : "企微 MCP 读取失败"}
          </Tag>
        )}
        {(lastMeta.skills || []).map((skill) => (
          <Tag key={skill.skill_id} color="gold">Skill · {skill.name}</Tag>
        ))}
        {(lastMeta.skill_scripts || []).map((script, index) => (
          <Tag
            key={`${script.skill_id}-${index}`}
            color={script.ok ? "success" : "error"}
          >
            {script.ok ? "脚本已执行" : "脚本未执行"}
            {script.error ? ` · ${script.error.slice(0, 24)}` : ""}
          </Tag>
        ))}
      </div>
    )}
    <div className="agent-chat-primary-actions">
      <Button icon={<PlusOutlined />} onClick={newChat}>新对话</Button>
      <ChatThemeSwitch theme={chatTheme} onChange={setChatTheme} />
    </div>
  </div>
</div>
```

删除页头后原有的 `.agent-chat-quick` 区块；快捷任务只出现在空状态。

- [ ] **Step 5: 用任务入口替换空状态**

用以下内容替换 `messages.length === 0` 分支中的 `.agent-chat-empty`：

```tsx
<div className="agent-chat-empty">
  <div className="agent-chat-empty-mark" aria-hidden="true">
    <RobotOutlined />
  </div>
  <Typography.Text className="agent-chat-empty-kicker">LIANGCE INTELLIGENCE</Typography.Text>
  <Typography.Title level={3}>今天想一起解决什么？</Typography.Title>
  <Typography.Text className="agent-chat-empty-copy">
    描述目标，良策会结合业务知识、经营数据与可用技能，给出可执行的结果。
  </Typography.Text>
  <div className="agent-chat-starters">
    {QUICK_PROMPTS.map((item) => (
      <button
        key={item.title}
        type="button"
        className="agent-chat-starter"
        onClick={() => send(item.prompt)}
        disabled={loading || viewingOthers}
      >
        <span>{item.title}</span>
        <small>{item.description}</small>
        <b aria-hidden="true">↗</b>
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 6: 为模型 Portal 增加主题专用类**

将模型 `Select` 的 `popupClassName` 改为：

```tsx
popupClassName={`agent-chat-model-dropdown agent-chat-model-dropdown-${chatTheme}`}
```

- [ ] **Step 7: 运行测试与生产构建**

Run: `cd frontend && npm test && npm run build`

Expected: 7 tests PASS；TypeScript 无未使用导入；Vite 构建成功。现有 API 调用、`send()`、附件和历史逻辑未被编辑。

- [ ] **Step 8: 提交页面接入**

```bash
git add frontend/src/pages/AgentChat.tsx
git commit -m "feat: integrate dual themes into agent chat"
```

---

### Task 4: 实现局部双主题视觉系统与响应式规则

**Files:**
- Create: `frontend/src/styles/agentChat.css`
- Create: `frontend/tests/agentChatStyles.test.ts`
- Modify: `frontend/src/main.tsx:8-11`

**Interfaces:**
- Consumes: Task 3 的 `data-chat-theme`、`.agent-chat-header-actions`、`.agent-chat-empty-mark`、`.agent-chat-starters`、`.agent-chat-theme-toggle` 和模型弹层主题类。
- Produces: 完整温润主题、完整沉浸主题、200ms 过渡、移动端规则和 Portal 模型菜单适配。

- [ ] **Step 1: 写 CSS 作用域失败测试**

创建 `frontend/tests/agentChatStyles.test.ts`：

```ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../src/styles/agentChat.css", import.meta.url);

test("chat styles define both scoped themes", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /\.agent-chat-shell\s*\{/);
  assert.match(css, /\.agent-chat-shell\[data-chat-theme="command"\]/);
  assert.match(css, /--chat-bg:/);
  assert.match(css, /--chat-accent:/);
});

test("chat styles include accessibility and mobile contracts", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
  assert.match(css, /\.agent-chat-theme-option:focus-visible/);
});

test("chat stylesheet does not theme global page roots", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.doesNotMatch(css, /(^|[},]\s*)(html|body|#root)\s*\{/m);
});
```

- [ ] **Step 2: 运行测试并确认因样式文件缺失而失败**

Run: `cd frontend && npm test`

Expected: `agentChatStyles.test.ts` FAIL，错误包含 `ENOENT` 和 `src/styles/agentChat.css`。

- [ ] **Step 3: 创建完整局部主题样式**

创建 `frontend/src/styles/agentChat.css`：

```css
/* Agent chat owns these tokens; no variable escapes this route. */
.agent-chat-shell {
  --chat-bg: #f8f3eb;
  --chat-sidebar: #f1e9de;
  --chat-surface: #fffdf9;
  --chat-surface-soft: #f8f3ec;
  --chat-surface-strong: #eee4d7;
  --chat-text: #2b2925;
  --chat-text-muted: #756f67;
  --chat-text-subtle: #9a9288;
  --chat-border: #e2d7ca;
  --chat-border-strong: #d5c7b7;
  --chat-accent: #cb7359;
  --chat-accent-hover: #b96249;
  --chat-accent-text: #ffffff;
  --chat-accent-soft: rgba(203, 115, 89, 0.12);
  --chat-selection: #e7dbcd;
  --chat-tool: #f1e9df;
  --chat-shadow: 0 18px 48px rgba(72, 54, 37, 0.1);
  --chat-avatar: linear-gradient(145deg, #d88970, #ac5943);
  --chat-code: #f3ece3;
  --chat-success: #2f8d69;

  gap: 0;
  height: calc(100vh - 68px);
  min-height: 540px;
  padding: 0;
  color: var(--chat-text);
  background: var(--chat-bg);
  border-top: 1px solid var(--chat-border);
  transition: background-color 200ms ease, color 200ms ease;
}

.agent-chat-shell[data-chat-theme="command"] {
  --chat-bg: #091321;
  --chat-sidebar: #0b1625;
  --chat-surface: #101d2f;
  --chat-surface-soft: #132238;
  --chat-surface-strong: #1a2b43;
  --chat-text: #eef2f7;
  --chat-text-muted: #a2adbc;
  --chat-text-subtle: #748399;
  --chat-border: #263750;
  --chat-border-strong: #354a68;
  --chat-accent: #d4ad69;
  --chat-accent-hover: #e0bd79;
  --chat-accent-text: #111a25;
  --chat-accent-soft: rgba(212, 173, 105, 0.12);
  --chat-selection: #17273d;
  --chat-tool: #203149;
  --chat-shadow: 0 20px 54px rgba(0, 0, 0, 0.3);
  --chat-avatar: linear-gradient(145deg, #e1c07d, #a8793b);
  --chat-code: #0b1626;
  --chat-success: #58c49a;
}

.agent-chat-history,
.agent-chat-page,
.agent-chat-header,
.agent-chat-input,
.agent-chat-composer,
.agent-chat-bubble,
.agent-chat-starter,
.agent-chat-session,
.agent-report-card,
.agent-md-section,
.agent-md-table th,
.agent-md-table td,
.agent-md-pre,
.agent-md-mermaid,
.agent-chat-pending-image,
.agent-chat-attach-image {
  transition:
    color 200ms ease,
    background-color 200ms ease,
    border-color 200ms ease,
    box-shadow 200ms ease;
}

.agent-chat-history {
  border: 0;
  border-right: 1px solid var(--chat-border);
  border-radius: 0;
  background: var(--chat-sidebar);
  box-shadow: none;
}

.agent-chat-history-head {
  min-height: 68px;
  padding: 14px 16px;
  border-bottom-color: var(--chat-border);
  color: var(--chat-text);
}

.agent-chat-history-head .ant-typography {
  color: var(--chat-text);
}

.agent-chat-history-head .ant-btn-primary {
  color: var(--chat-accent-text);
  background: var(--chat-accent);
  border-color: transparent;
  box-shadow: none;
}

.agent-chat-session-list {
  padding: 10px;
}

.agent-chat-session {
  min-height: 58px;
  margin-bottom: 3px;
  padding: 9px 7px 9px 11px;
  border-radius: 10px;
  color: var(--chat-text-muted);
}

.agent-chat-session:hover,
.agent-chat-session:focus-visible {
  color: var(--chat-text);
  background: color-mix(in srgb, var(--chat-selection) 62%, transparent);
  border-color: transparent;
}

.agent-chat-session.active {
  color: var(--chat-text);
  background: var(--chat-selection);
  border-color: color-mix(in srgb, var(--chat-accent) 24%, transparent);
}

.agent-chat-session strong {
  color: inherit;
  font-size: 13px;
  font-weight: 650;
}

.agent-chat-session span {
  color: var(--chat-text-subtle);
}

.agent-chat-page {
  position: relative;
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: var(--chat-surface);
  box-shadow: none;
}

.agent-chat-shell[data-chat-theme="command"] .agent-chat-page {
  background:
    radial-gradient(circle at 54% 22%, rgba(55, 87, 129, 0.17), transparent 34%),
    var(--chat-surface);
}

.agent-chat-header {
  min-height: 68px;
  padding: 11px 22px;
  border-bottom-color: var(--chat-border);
  background: color-mix(in srgb, var(--chat-surface) 94%, transparent);
  backdrop-filter: blur(14px);
}

.agent-chat-identity,
.agent-chat-header-actions,
.agent-chat-primary-actions,
.agent-chat-meta {
  display: flex;
  align-items: center;
}

.agent-chat-identity {
  gap: 11px;
  min-width: 220px;
}

.agent-chat-agent-avatar {
  flex: 0 0 auto;
  color: var(--chat-accent-text) !important;
  background: var(--chat-avatar) !important;
  box-shadow: 0 8px 20px var(--chat-accent-soft);
}

.agent-chat-identity .ant-typography {
  color: var(--chat-text);
}

.agent-chat-subtitle {
  color: var(--chat-text-muted) !important;
  font-size: 12px;
}

.agent-chat-header-actions {
  justify-content: flex-end;
  gap: 12px;
  min-width: 0;
  margin-left: auto;
}

.agent-chat-meta {
  justify-content: flex-end;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
}

.agent-chat-meta .ant-tag {
  flex: 0 0 auto;
  margin: 0;
}

.agent-chat-primary-actions {
  flex: 0 0 auto;
  gap: 8px;
}

.agent-chat-primary-actions > .ant-btn {
  height: 36px;
  color: var(--chat-text);
  border-color: var(--chat-border);
  background: var(--chat-surface-soft);
  box-shadow: none;
}

.agent-chat-theme-toggle {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--chat-border);
  border-radius: 11px;
  background: var(--chat-surface-soft);
}

.agent-chat-theme-option {
  width: 36px;
  height: 36px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: var(--chat-text-subtle);
  background: transparent;
  cursor: pointer;
}

.agent-chat-theme-option:hover {
  color: var(--chat-text);
  background: var(--chat-tool);
}

.agent-chat-theme-option.active {
  color: var(--chat-accent-text);
  background: var(--chat-accent);
  box-shadow: 0 5px 14px var(--chat-accent-soft);
}

.agent-chat-theme-option:focus-visible {
  outline: 2px solid var(--chat-accent);
  outline-offset: 2px;
}

.agent-chat-body {
  gap: 20px;
  padding: 24px clamp(22px, 6vw, 88px) 160px;
  scrollbar-color: var(--chat-border-strong) transparent;
}

.agent-chat-empty {
  max-width: 760px;
  min-height: 420px;
  margin: auto;
  padding: 28px 0;
}

.agent-chat-empty-mark {
  width: 54px;
  height: 54px;
  display: grid;
  place-items: center;
  margin-bottom: 4px;
  border-radius: 17px;
  color: var(--chat-accent-text);
  background: var(--chat-avatar);
  box-shadow: 0 12px 30px var(--chat-accent-soft);
  font-size: 22px;
}

.agent-chat-empty-kicker {
  margin-top: 8px;
  color: var(--chat-accent) !important;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

.agent-chat-empty .ant-typography {
  color: var(--chat-text);
}

.agent-chat-empty h3.ant-typography {
  margin: 2px 0 0;
  font-size: clamp(24px, 3vw, 34px);
  font-weight: 600;
  letter-spacing: -0.04em;
}

.agent-chat-empty-copy {
  max-width: 560px;
  color: var(--chat-text-muted) !important;
  font-size: 14px;
  line-height: 1.7;
}

.agent-chat-starters {
  width: min(680px, 100%);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 20px;
}

.agent-chat-starter {
  position: relative;
  min-height: 104px;
  padding: 16px 34px 16px 16px;
  border: 1px solid var(--chat-border);
  border-radius: 14px;
  color: var(--chat-text);
  background: var(--chat-surface-soft);
  text-align: left;
  cursor: pointer;
}

.agent-chat-starter:hover,
.agent-chat-starter:focus-visible {
  border-color: color-mix(in srgb, var(--chat-accent) 54%, var(--chat-border));
  background: var(--chat-surface-strong);
  transform: translateY(-2px);
}

.agent-chat-starter:focus-visible {
  outline: 2px solid var(--chat-accent);
  outline-offset: 2px;
}

.agent-chat-starter span,
.agent-chat-starter small {
  display: block;
}

.agent-chat-starter span {
  margin-bottom: 7px;
  color: var(--chat-text);
  font-size: 13px;
  font-weight: 650;
}

.agent-chat-starter small {
  color: var(--chat-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.agent-chat-starter b {
  position: absolute;
  top: 15px;
  right: 15px;
  color: var(--chat-accent);
}

.agent-chat-row {
  gap: 11px;
}

.agent-chat-row.assistant {
  max-width: min(900px, 98%);
}

.agent-chat-row.user {
  max-width: min(640px, 82%);
}

.agent-chat-row.assistant > .ant-avatar {
  color: var(--chat-accent-text);
  background: var(--chat-avatar) !important;
}

.agent-chat-bubble {
  color: var(--chat-text);
  border-color: var(--chat-border);
  background: var(--chat-surface-soft);
  box-shadow: none;
}

.agent-chat-row.user .agent-chat-bubble {
  color: var(--chat-text);
  border-color: color-mix(in srgb, var(--chat-accent) 24%, var(--chat-border));
  background: var(--chat-accent-soft);
}

.agent-chat-row.assistant .agent-chat-bubble:not(.report) {
  border-top-left-radius: 4px;
}

.agent-chat-row.user .agent-chat-bubble {
  border-top-right-radius: 4px;
}

.agent-chat-input {
  position: absolute;
  z-index: 5;
  left: clamp(22px, 6vw, 88px);
  right: clamp(22px, 6vw, 88px);
  bottom: 0;
  padding: 14px 0 18px;
  border-top: 0;
  background: linear-gradient(180deg, transparent, var(--chat-surface) 34%);
  pointer-events: none;
}

.agent-chat-input > * {
  pointer-events: auto;
}

.agent-chat-composer {
  padding: 13px 14px 10px;
  border-color: var(--chat-border-strong);
  border-radius: 17px;
  background: color-mix(in srgb, var(--chat-surface) 94%, transparent);
  box-shadow: var(--chat-shadow);
  backdrop-filter: blur(16px);
}

.agent-chat-composer .ant-input,
.agent-chat-composer-textarea textarea.ant-input {
  color: var(--chat-text) !important;
}

.agent-chat-composer-textarea textarea.ant-input::placeholder {
  color: var(--chat-text-subtle);
}

.agent-chat-model-select .ant-select-selector,
.agent-chat-kind-tag,
.agent-chat-attach-tag {
  color: var(--chat-text) !important;
  border-color: var(--chat-border) !important;
  background: var(--chat-tool) !important;
}

.agent-chat-model-text,
.agent-chat-kind-tag,
.agent-chat-circle-btn {
  color: var(--chat-text-muted) !important;
}

.agent-chat-model-icon,
.agent-chat-circle-btn:hover {
  color: var(--chat-accent) !important;
}

.agent-chat-send-circle {
  color: var(--chat-accent-text) !important;
  background: var(--chat-accent) !important;
  border-color: transparent !important;
  box-shadow: 0 7px 18px var(--chat-accent-soft);
}

.agent-chat-pending-image,
.agent-chat-attach-image {
  border-color: var(--chat-border);
  background: var(--chat-surface-soft);
}

.agent-chat-pending-image span,
.agent-chat-attach-image span {
  color: var(--chat-text-muted);
}

.agent-chat-shell .agent-md-root,
.agent-chat-shell .agent-md-p,
.agent-chat-shell .agent-md-li,
.agent-chat-shell .agent-md-table td {
  color: var(--chat-text);
}

.agent-chat-shell .agent-md-h1,
.agent-chat-shell .agent-md-h2,
.agent-chat-shell .agent-md-h3,
.agent-chat-shell .agent-md-h4,
.agent-chat-shell .agent-md-strong,
.agent-chat-shell .agent-md-table th,
.agent-chat-shell .agent-md-code {
  color: var(--chat-text);
}

.agent-chat-shell .agent-md-h3,
.agent-chat-shell .agent-md-quote {
  border-color: var(--chat-accent);
}

.agent-chat-shell .agent-md-li::marker,
.agent-chat-shell .agent-md-link {
  color: var(--chat-accent);
}

.agent-chat-shell .agent-md-quote,
.agent-chat-shell .agent-md-pre,
.agent-chat-shell .agent-md-mermaid,
.agent-chat-shell .agent-md-code {
  color: var(--chat-text-muted);
  border-color: var(--chat-border);
  background: var(--chat-code);
}

.agent-chat-shell .agent-report-card,
.agent-chat-shell .agent-md-section,
.agent-chat-shell .agent-md-table td {
  border-color: var(--chat-border);
  background: var(--chat-surface-soft);
}

.agent-chat-shell .agent-md-table th,
.agent-chat-shell .agent-md-section.is-lead .agent-md-h1:first-child,
.agent-chat-shell .agent-md-section.is-lead .agent-md-h2:first-child {
  border-color: var(--chat-border);
  background: var(--chat-surface-strong);
}

.agent-chat-shell .agent-report-card {
  box-shadow: none;
}

.agent-chat-shell .agent-md-pre code {
  color: var(--chat-text);
}

.agent-chat-model-dropdown-command .ant-select-dropdown,
.agent-chat-model-dropdown-command {
  color: #eef2f7;
  border: 1px solid #263750;
  background: #101d2f;
}

.agent-chat-model-dropdown-command .ant-select-item,
.agent-chat-model-dropdown-command .ant-select-item-group {
  color: #a2adbc;
}

.agent-chat-model-dropdown-command .ant-select-item-option-selected,
.agent-chat-model-dropdown-command .ant-select-item-option-active {
  color: #eef2f7;
  background: #1a2b43;
}

@media (max-width: 1100px) {
  .agent-chat-header-actions {
    flex-wrap: wrap-reverse;
  }

  .agent-chat-meta {
    order: 2;
    width: 100%;
  }

  .agent-chat-starters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .agent-chat-shell {
    height: calc(100vh - 68px);
    min-height: 560px;
  }

  .agent-chat-page {
    min-height: 100%;
  }

  .agent-chat-header {
    padding: 10px 14px;
  }

  .agent-chat-identity {
    min-width: 0;
  }

  .agent-chat-subtitle,
  .agent-chat-meta {
    display: none;
  }

  .agent-chat-primary-actions > .ant-btn span:not(.anticon) {
    display: none;
  }

  .agent-chat-primary-actions > .ant-btn {
    width: 38px;
    padding-inline: 0;
  }

  .agent-chat-theme-option {
    width: 40px;
    height: 40px;
  }

  .agent-chat-body {
    padding: 18px 14px 154px;
  }

  .agent-chat-input {
    left: 14px;
    right: 14px;
    padding-bottom: 12px;
  }

  .agent-chat-starters {
    grid-template-columns: 1fr;
    width: 100%;
  }

  .agent-chat-starter {
    min-height: 82px;
  }
}

@media (max-width: 560px) {
  .agent-chat-identity .ant-avatar {
    display: none;
  }

  .agent-chat-identity h4.ant-typography {
    font-size: 15px;
  }

  .agent-chat-empty {
    min-height: 360px;
  }

  .agent-chat-empty h3.ant-typography {
    font-size: 24px;
  }

  .agent-chat-composer-left {
    gap: 4px;
  }

  .agent-chat-kind-tag {
    display: none;
  }

  .agent-chat-model-select {
    max-width: 46vw;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-chat-shell,
  .agent-chat-shell * {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 4: 在全局基础样式之后加载局部覆盖**

在 `frontend/src/main.tsx` 的样式导入区改为：

```tsx
import "antd/dist/reset.css";
import "./index.css";
import "./styles/agentChat.css";
```

- [ ] **Step 5: 运行 CSS 契约测试和构建**

Run: `cd frontend && npm test && npm run build`

Expected: 10 tests PASS；CSS 文件无 `html`、`body` 或 `#root` 根级主题规则；生产构建成功。

- [ ] **Step 6: 提交视觉系统**

```bash
git add frontend/src/styles/agentChat.css frontend/tests/agentChatStyles.test.ts frontend/src/main.tsx
git commit -m "feat: style warm and command chat themes"
```

---

### Task 5: 浏览器验证、视觉修整与最终回归

**Files:**
- Modify when evidence requires: `frontend/src/styles/agentChat.css`
- Modify when evidence requires: `frontend/src/pages/AgentChat.tsx`
- Test: `frontend/tests/agentChatTheme.test.ts`
- Test: `frontend/tests/agentChatStyles.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 的完整 `/agent` 页面。
- Produces: 在真实浏览器中验证过的桌面/移动双主题体验；不得改变已确认的 API 与路由边界。

- [ ] **Step 1: 启动后端与前端开发服务**

后端命令：

```bash
cd backend
.venv/bin/python manage.py runserver 127.0.0.1:8000
```

前端命令：

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Expected: Django 监听 `127.0.0.1:8000`；Vite 输出可访问的本地 URL，通常为 `http://127.0.0.1:5173`。

- [ ] **Step 2: 使用 frontend-testing-debugging 技能和 in-app Browser 检查桌面温润主题**

在浏览器执行以下验证：

1. 删除 `localStorage.liangce_chat_theme`。
2. 打开 `/agent`。
3. 确认 `.agent-chat-shell` 的 `data-chat-theme` 为 `warm`。
4. 确认历史栏、空状态或消息状态、输入框、模型/Skill/连接器入口均可见。
5. 确认顶部 `.app-topnav` 仍是原有浅色样式。
6. 以 1440×900 截图检查文本截断、滚动与悬浮输入框遮挡。

Expected: 温润主题首次加载；无横向滚动；输入框不遮住最后一条消息；控制台无新增错误。

- [ ] **Step 3: 检查深色切换、持久化和键盘可访问性**

在浏览器执行以下验证：

1. 用 Tab 聚焦月亮按钮，按 Enter。
2. 确认根节点变为 `data-chat-theme="command"`。
3. 确认深色只覆盖对话工作区，顶部导航不变。
4. 刷新页面，确认仍为 `command`。
5. 检查普通消息、Markdown 标题、表格、代码、附件和加载态的对比度。
6. 用 Tab 聚焦太阳按钮并切回 `warm`。

Expected: 两个按钮都有可见焦点；`aria-pressed` 与当前主题一致；刷新恢复上次选择。

- [ ] **Step 4: 检查移动端布局和现有能力**

将视口设为 390×844，验证：

1. 历史栏按现有规则隐藏。
2. 主题切换器仍完整可见，按钮为 40×40px，控件整体不溢出页头。
3. 新对话按钮保留图标并可点击。
4. 空状态任务入口变为单列。
5. 模型选择、Skill、连接器、附件与发送按钮可操作。
6. 输入框不遮住消息内容，页面无水平滚动。

Expected: 两个主题都通过 390×844 检查。

- [ ] **Step 5: 检查路由隔离**

切换为 `command` 后依次打开 `/home` 和 `/collab`，再返回 `/agent`。

Expected: `/home` 与 `/collab` 没有深色变量或样式泄漏；返回 `/agent` 时恢复 `command`。

- [ ] **Step 6: 根据截图证据做最小修整并回归**

仅修改截图或交互检查暴露的具体问题；每次修改后执行：

```bash
cd frontend
npm test
npm run build
```

Expected: 10 tests PASS；生产构建成功；桌面温润、桌面深色、移动温润、移动深色四个视图均无已知视觉缺陷。

- [ ] **Step 7: 提交浏览器验证后的修整**

若 Task 5 产生代码改动：

```bash
git add frontend/src/styles/agentChat.css frontend/src/pages/AgentChat.tsx frontend/tests
git commit -m "fix: polish dual-theme chat experience"
```

若 Task 5 未产生代码改动，不创建空提交；在执行记录中保存测试命令与浏览器检查结果。

---

## Final Verification

- [ ] Run: `cd frontend && npm test`
  - Expected: 10 tests PASS。
- [ ] Run: `cd frontend && npm run build`
  - Expected: TypeScript 和 Vite 生产构建成功。
- [ ] Run: `git status --short`
  - Expected: 仅保留任务开始前已存在的 `?? .worktrees/`；没有未提交的本功能文件。
- [ ] Browser: `/agent` 默认温润、可切换深色、刷新持久化、移动端可用、其他路由不受影响。
