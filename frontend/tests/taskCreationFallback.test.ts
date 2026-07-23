import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const consoleSource = readFileSync(new URL("../src/pages/AgentConsole.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");
const executionFieldsSource = readFileSync(new URL("../src/features/task-console/executionFields.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const templatesSource = readFileSync(new URL("../src/pages/WorkTemplates.tsx", import.meta.url), "utf8");

test("ordinary task creation opts into the manual-task fallback", () => {
  assert.match(consoleSource, /mode:\s*"task_create"/);
  assert.match(consoleSource, /sopResult\.action === "task\.manual"/);
  assert.match(consoleSource, /status:\s*manualTask \? "pending"/);
  assert.match(consoleSource, /progress:\s*manualTask \? 0 : 100/);
  assert.match(consoleSource, /任务已创建并分配，等待负责人处理/);
  assert.match(clientSource, /mode\?:\s*"task_create"/);
});

test("matched SOP failures are still treated as execution failures", () => {
  assert.match(consoleSource, /const executionRejected = sopResult\.decision === "block"/);
  assert.match(consoleSource, /SOP_EXECUTION_FAILED/);
});

test("inventory analysis deep link selects the shadow action and snapshot", () => {
  assert.match(consoleSource, /useSearchParams/);
  assert.match(consoleSource, /intent"\) !== "inventory-reorder"/);
  assert.match(consoleSource, /action\.name === "inventory\.reorder\.shadow"/);
  assert.match(consoleSource, /searchParams\.get\("snapshot_id"\)/);
});

test("report tasks support governed multi-brand filters", () => {
  assert.match(clientSource, /\/datalake\/report-options\//);
  assert.match(consoleSource, /getReportOptions/);
  assert.match(executionFieldsSource, /createField\("brand_ids", "list"\)/);
  assert.match(executionFieldsSource, /multiple:\s*true/);
  assert.match(executionFieldsSource, /emptyLabel:\s*"全部品牌"/);
});

test("completed task results can collapse and release editor width", () => {
  assert.match(consoleSource, /resultPanelCollapsed/);
  assert.match(consoleSource, /aria-label=\{resultPanelCollapsed \? "展开任务结果" : "折叠任务结果"\}/);
  assert.match(stylesSource, /\.task-create-layout\.is-result-collapsed\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*52px/);
});

test("task templates are persisted and their defaults flow into task creation", () => {
  assert.match(clientSource, /\/task-templates\//);
  assert.match(templatesSource, /createTaskTemplate/);
  assert.match(templatesSource, /updateTaskTemplate/);
  assert.match(templatesSource, /duplicateTaskTemplate/);
  assert.match(templatesSource, /deleteTaskTemplate/);
  assert.match(templatesSource, /系统内置 · 已自定义/);
  assert.match(templatesSource, /恢复系统默认模板/);
  assert.match(consoleSource, /selectedTemplate\.defaults/);
  assert.match(consoleSource, /action\.name === selectedTemplate\.actionName/);
});
