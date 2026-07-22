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
const liveSource = readFileSync(
  new URL("../src/hooks/useCollabRoomLive.ts", import.meta.url),
  "utf8",
);
const monitorStyles = chatSource.slice(chatSource.indexOf("const css = `"));
const avatarSource = readFileSync(
  new URL("../src/utils/avatar.ts", import.meta.url),
  "utf8",
);

function sourceBetween(start: string, end: string) {
  const from = layoutSource.indexOf(start);
  const to = layoutSource.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source range ${start} -> ${end}`);
  return layoutSource.slice(from, to);
}

test("navigation hides requested entries while routes remain available", () => {
  const work = sourceBetween("const WORK_GROUPS", "const KNOWLEDGE_GROUPS");
  const knowledge = sourceBetween("const KNOWLEDGE_GROUPS", "const COMMERCE_GROUPS");
  const commerce = sourceBetween("const COMMERCE_GROUPS", "const ADMIN_GROUPS");
  const admin = sourceBetween("const ADMIN_GROUPS", "const LOGS_NAV");

  assert.doesNotMatch(work, /path:\s*"\/agent"/);
  assert.match(work, /label:\s*"团队协作"[\s\S]*label:\s*"消息"[\s\S]*label:\s*"通讯录"/);
  assert.match(work, /label:\s*"任务与待办"[\s\S]*label:\s*"任务中心"[\s\S]*label:\s*"自动化"/);
  assert.match(knowledge, /path:\s*"\/knowledge"[\s\S]*label:\s*"知识库"/);
  assert.doesNotMatch(knowledge, /\/tables|智能表格|\/ontology|\/agent-memory|\/my\/recent/);
  assert.match(commerce, /\/commerce\/loops/);
  assert.match(commerce, /\/commerce\/loops\/diy|回路 DIY/);
  assert.doesNotMatch(commerce, /\/commerce\/bench|label:\s*"经营首页"/);
  assert.doesNotMatch(admin, /\/audit/);

  for (const route of [
    "agent",
    "ontology",
    "agent-memory",
    "commerce",
    "commerce/bench",
    "commerce/loops/diy",
    "tables",
    "datalake",
    "audit",
  ]) {
    assert.match(appSource, new RegExp(`path="${route.replace("/", "\\/")}"`));
  }
  assert.match(appSource, /path="tables"\s+element=\{<Navigate to="\/knowledge"/);
});

test("workspace uses top-level modules and a fixed contextual sidebar", () => {
  assert.match(layoutSource, /className="app-module-nav"/);
  assert.match(layoutSource, /className=\{`app-module-sidebar/);
  assert.match(layoutSource, /activeSection\.groups\.map/);
  assert.match(layoutSource, /type:\s*"group" as const/);
  assert.match(layoutSource, /defaultPath:\s*"\/collab"/);
  assert.match(appSource, /<Route index element=\{<Navigate to="\/collab" replace \/>\}/);
});

test("workspace navigation supports resizing, responsive access, and organization switching", () => {
  assert.match(layoutSource, /className="app-module-sidebar-resizer"/);
  assert.match(layoutSource, /onPointerDown=\{beginSidebarResize\}/);
  assert.match(layoutSource, /onDoubleClick=\{toggleSidebar\}/);
  assert.match(layoutSource, /sidebarHeaderMode/);
  assert.match(layoutSource, /setPointerCapture\(pointerId\)/);
  assert.match(layoutSource, /className="app-mobile-subnav"/);
  assert.match(layoutSource, /setOrganizations\(res\.user\.organizations \|\| \[\]\)/);
  assert.doesNotMatch(layoutSource, /listOrganizations/);
  assert.match(layoutSource, /switchCurrentOrganization/);
  assert.match(layoutSource, /aria-label=\{`切换企业，当前为 \$\{organizationName\}`\}/);
});

test("chat exposes message time and live read receipts", () => {
  assert.match(chatSource, /发送于 \$\{formatChatTimeSep\(m\.created_at\)\}/);
  assert.match(chatSource, /onReadReceipts:\s*mergeLiveReadReceipts/);
  assert.match(chatSource, /activeRoom\.room_kind === "group"[\s\S]*全部已读/);
  assert.match(chatSource, /:\s*\(unreadReceiptCount === 0 \? "已读" : "未读"\)/);
});

test("chat keeps sending stable and exposes the new panel controls", () => {
  assert.match(chatSource, /client_message_key/);
  assert.match(chatSource, /computeItemKey=/);
  assert.match(chatSource, /optimisticIndex/);
  assert.match(chatSource, /className=\{`agent-chat-send-circle\$\{canSendMessage \|\| sending/);
  assert.match(chatSource, /onClose=\{\(\) => setSummaryPanelVisible\(false\)\}/);
  assert.match(chatSource, /aria-label="显示智能纪要"/);
  assert.match(chatSource, /icon=\{<FileTextOutlined \/>\}/);
  assert.match(chatSource, /const existingRoom = findDirectRoom\(username\)/);
  assert.match(chatSource, /primeRoomSnapshot\(room\)/);
  assert.doesNotMatch(chatSource, /EyeOutlined|旁观模式|管理员旁观|旁观者/);
  assert.match(chatSource, /trigger="click"/);
  assert.match(chatSource, /aria-label=\{`查看 \$\{label\} 的资料`\}/);
  assert.doesNotMatch(chatSource, /collab-avatar-preview-modal/);
  assert.match(chatSource, /消息会在这里直接打开，不再加载中转卡片/);
  assert.match(chatSource, /DRAG_ATTACHMENT_TYPE/);
  assert.match(chatSource, /forwardCollabMessages/);
  assert.match(chatSource, /合并转发/);
  assert.match(chatSource, /逐条转发/);
  assert.doesNotMatch(chatSource, /collab-msg-flag-line/);
});

test("chat identity, feedback, and background activity stay polished", () => {
  assert.match(monitorStyles, /\.collab-msg-aside\s*\{[\s\S]*?align-items:\s*flex-start;/);
  assert.match(monitorStyles, /\.collab-msg\.ai \.collab-msg-name,[\s\S]*?justify-content:\s*flex-start;[\s\S]*?text-align:\s*left;/);
  assert.match(monitorStyles, /\.collab-msg:not\(\.system\):hover \.collab-bubble/);
  assert.match(monitorStyles, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(monitorStyles, /\.collab-summary-controls \.ant-btn-primary[\s\S]*?linear-gradient\(135deg, #6d5eea, #5145c7\)/);
  assert.match(chatSource, /if \(document\.visibilityState !== "visible" \|\| beatInFlight\) return;/);
  assert.match(chatSource, /finally \{[\s\S]*?beatInFlight = false;/);
  assert.match(liveSource, /const pageIsVisible = \(\) => document\.visibilityState === "visible"/);
  assert.match(liveSource, /!pageIsVisible\(\) \|\| presenceInFlight/);
  assert.match(liveSource, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(liveSource, /closeWebSocketQuietly\(ws\);[\s\S]*?ws = null;/);
});

test("chat supports stable bottom scrolling, team grouping, translation, and branded avatars", () => {
  const bottomStateStart = chatSource.indexOf("atBottomStateChange={(bottom)");
  const bottomStateEnd = chatSource.indexOf("startReached={()", bottomStateStart);
  assert.ok(bottomStateStart >= 0 && bottomStateEnd > bottomStateStart);
  assert.doesNotMatch(chatSource.slice(bottomStateStart, bottomStateEnd), /scrollToIndex/);
  assert.match(monitorStyles, /\.collab-virtuoso\s*\{[\s\S]*?overscroll-behavior-y:\s*none;/);
  assert.match(chatSource, /listTeams/);
  assert.match(chatSource, /团队分组/);
  assert.match(chatSource, /直接选择团队/);
  assert.match(chatSource, /translateCollabMessages/);
  assert.match(chatSource, /aria-pressed=\{autoTranslate\}/);
  assert.match(chatSource, /中文自动译为英文，英文自动译为中文/);
  assert.match(monitorStyles, /\.collab-message-menu \.ant-dropdown-menu-item-danger/);
  assert.match(avatarSource, /liangce-default-avatar\.png/);
});

test("monitor owns a single complete scroll surface", () => {
  assert.match(monitorStyles, /\.collab-ai\s*\{[\s\S]*?overflow:\s*hidden;/);
  assert.match(monitorStyles, /\.collab-monitor\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(monitorStyles, /\.collab-alert-list\s*\{[\s\S]*?max-height:\s*none;/);
});
