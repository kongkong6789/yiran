# 监控看板黑白主题修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/collab` 右侧监控看板完整跟随全局纯黑白主题，只在风险标签和告警圆点保留语义色。

**Architecture:** 不改变 `CollabMonitorBoard` 的数据或 DOM 结构，只修正 `CollabRisk.tsx` 中现有监控样式。风险卡、柱图、占比条和空状态直接消费 `--lc-*` 全局变量，避免用更高优先级的旧浅色规则覆盖深色主题。

**Tech Stack:** React 19、TypeScript、Ant Design 5、CSS variables、Node.js test runner

## Global Constraints

- Logo、用户头像与小策bot头像颜色保持不变。
- 页面背景、卡片、文字、边框、图表和空状态使用纯黑白全局变量，不引入中性灰表面。
- 只有“正常 / 注意 / 高风险”标签与告警圆点保留语义色。
- 不改变风险数据、刷新逻辑、消息逻辑或组件结构。
- 验证流程只运行相关前端测试、前端构建和 `/collab` 浏览器预览。

---

### Task 1: 统一监控看板的黑白主题样式

**Files:**
- Modify: `frontend/tests/xiaoceChat.test.ts`
- Modify: `frontend/src/pages/CollabRisk.tsx:3834-3937,4132-4140,4334-4344`

**Interfaces:**
- Consumes: `frontend/src/index.css` 定义的 `--lc-surface`、`--lc-ink`、`--lc-muted`、`--lc-line`、`--lc-hover`。
- Produces: 无新接口；保留 `CollabMonitorBoard` 现有 class names 和风险 `Tag` 行为。

- [ ] **Step 1: 写入失败的样式回归测试**

在 `frontend/tests/xiaoceChat.test.ts` 增加：

```ts
test("Collab monitor uses monochrome tokens outside semantic status markers", () => {
  const source = readFileSync(
    new URL("../src/pages/CollabRisk.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /\.collab-kpi\.risk-green,[\s\S]*?background:\s*var\(--lc-surface\)/);
  assert.match(source, /\.collab-mini-bar-wrap i\s*\{[^}]*background:\s*var\(--lc-ink\)/s);
  assert.match(source, /\.collab-speaker-list \.track i\s*\{[^}]*background:\s*var\(--lc-ink\)/s);
  assert.match(source, /\.collab-hint\s*\{[^}]*background:\s*transparent/s);
  assert.doesNotMatch(source, /\.collab-kpi\.risk-green span,[\s\S]*?color:\s*#000/);
});
```

- [ ] **Step 2: 运行测试并确认因旧颜色规则失败**

Run: `cd frontend && npm test -- --test-name-pattern="Collab monitor uses monochrome"`

Expected: FAIL，失败项指出风险卡、图表或空状态尚未使用 `--lc-*` 变量。

- [ ] **Step 3: 最小化修改现有监控 CSS**

在 `frontend/src/pages/CollabRisk.tsx` 中让三种风险卡共用全局表面和边框：

```css
.collab-kpi.risk-green,
.collab-kpi.risk-yellow,
.collab-kpi.risk-red {
  color: var(--lc-ink);
  background: var(--lc-surface);
  border-color: var(--lc-line);
}
```

把图表前景改为 `var(--lc-ink)`，轨道改为 `var(--lc-hover)`：

```css
.collab-mini-bar-wrap i,
.collab-speaker-list .track i {
  background: var(--lc-ink);
}
.collab-speaker-list .track {
  background: var(--lc-hover);
}
```

把空状态接入全局文字并去掉旧浅蓝填充：

```css
.collab-hint {
  background: transparent;
  color: var(--lc-muted);
}
```

删除末尾把风险卡文字强制设为 `#000` 的规则；风险标签继续由 Ant Design `Tag` 的 `success`、`warning`、`error` 色表达语义。

- [ ] **Step 4: 运行聚焦测试、完整前端测试与构建**

Run: `cd frontend && npm test -- --test-name-pattern="Collab monitor uses monochrome"`

Expected: PASS。

Run: `cd frontend && npm test && npm run build`

Expected: 全部测试 PASS，构建成功；允许保留既有 chunk-size 警告。

- [ ] **Step 5: 浏览器核对并提交**

在 `http://localhost:5174/collab` 切换深色模式，确认四张卡片均为黑底白字、柱图为白色、空状态无浅蓝底，风险小标签仍保留状态色；再切回白色确认反向可读。

```bash
git add frontend/tests/xiaoceChat.test.ts frontend/src/pages/CollabRisk.tsx
git commit -m "fix: unify monitor board theme colors"
```
