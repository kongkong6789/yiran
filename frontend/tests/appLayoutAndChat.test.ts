import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const layoutSource = readFileSync(
  new URL("../src/components/AppLayout.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const chatSource = readFileSync(
  new URL("../src/pages/CollabRisk.tsx", import.meta.url),
  "utf8",
);
const monitorStyles = chatSource.slice(chatSource.indexOf("const css = `"));

function sourceBetween(start: string, end: string) {
  const from = layoutSource.indexOf(start);
  const to = layoutSource.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return layoutSource.slice(from, to);
}

test("navigation hides requested entries while routes remain available", () => {
  const work = sourceBetween("const WORK_NAV", "const KNOWLEDGE_NAV");
  const knowledge = sourceBetween("const KNOWLEDGE_NAV", "const COMMERCE_NAV");
  const commerce = sourceBetween("const COMMERCE_NAV", "const ADMIN_NAV");
  const admin = sourceBetween("const ADMIN_NAV", "const SECTIONS");

  assert.doesNotMatch(work, /key:\s*"\/agent"/);
  assert.match(knowledge, /key:\s*"\/tables"[\s\S]*label:\s*"智能表格"/);
  assert.doesNotMatch(knowledge, /\/ontology|\/agent-memory|\/my\/recent/);
  assert.match(commerce, /\/commerce\/loops/);
  assert.doesNotMatch(commerce, /\/commerce\/bench|label:\s*"经营首页"/);
  assert.doesNotMatch(admin, /\/audit/);

  for (const route of [
    "agent",
    "ontology",
    "agent-memory",
    "commerce",
    "commerce/bench",
    "tables",
    "datalake",
    "audit",
  ]) {
    assert.match(appSource, new RegExp(`path="${route.replace("/", "\\/")}"`));
  }
});

test("workspace uses top-level modules and a fixed contextual sidebar", () => {
  assert.match(layoutSource, /className="app-module-nav"/);
  assert.match(layoutSource, /className="app-module-sidebar"/);
  assert.match(layoutSource, /\{SECTIONS\.map\(\(section\) =>/);
  assert.match(
    layoutSource,
    /activeSection\.key === "admin"[\s\S]*?\[\.\.\.activeSection\.items, LOGS_NAV\][\s\S]*?: activeSection\.items[\s\S]*?\)\.map\(\(item\) =>/,
  );
  assert.doesNotMatch(layoutSource, /children:\s*WORK_NAV/);
});

test("chat exposes message time and live read receipts", () => {
  assert.match(chatSource, /发送于 \$\{formatChatTimeSep\(m\.created_at\)\}/);
  assert.match(chatSource, /onReadReceipts:\s*mergeLiveReadReceipts/);
  assert.match(chatSource, /activeRoom\.room_kind === "group"[\s\S]*全部已读/);
  assert.match(chatSource, /:\s*\(unreadReceiptCount === 0 \? "已读" : "未读"\)/);
});

test("monitor owns a single complete scroll surface", () => {
  assert.match(monitorStyles, /\.collab-ai\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(monitorStyles, /\.collab-monitor\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(monitorStyles, /\.collab-alert-list\s*\{[\s\S]*?max-height:\s*none;/);
});
