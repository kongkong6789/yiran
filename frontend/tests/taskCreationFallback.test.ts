import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const consoleSource = readFileSync(new URL("../src/pages/AgentConsole.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");

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
