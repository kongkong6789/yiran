import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("keeps the Apple chat page reachable at /agent", () => {
  assert.match(appSource, /import AgentChat from "\.\/pages\/AgentChat";/);
  assert.match(appSource, /<Route path="agent" element={<AgentChat \/>} \/>/);
  assert.doesNotMatch(appSource, /path="agent" element={<Navigate to="\/collab/);
});
