import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const logsSource = readFileSync(new URL("../src/pages/Logs.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");

test("legacy audit page redirects to the existing logs center", () => {
  assert.match(appSource, /path="audit" element={<Navigate to="\/logs" replace \/>}/);
  assert.doesNotMatch(appSource, /pages\/Audit/);
});

test("logs detail contains the raw gate evidence", () => {
  for (const field of ["decision", "payload", "checks", "result"]) {
    assert.match(logsSource, new RegExp(`detailRow\\.${field}`));
  }
  assert.match(clientSource, /payload: Record<string, unknown>/);
  assert.doesNotMatch(clientSource, /getAuditLogs/);
});
