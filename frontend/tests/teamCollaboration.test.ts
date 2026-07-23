import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceSource = readFileSync(
  new URL("../src/pages/TeamCollaboration.tsx", import.meta.url),
  "utf8",
);
const chatSource = readFileSync(
  new URL("../src/pages/CollabRisk.tsx", import.meta.url),
  "utf8",
);
const workspaceStyles = readFileSync(
  new URL("../src/styles/teamCollaboration.css", import.meta.url),
  "utf8",
);

test("message and roundtable workspaces are mutually exclusive", () => {
  assert.match(
    workspaceSource,
    /view === "chat"[\s\S]*?<CollabRisk[\s\S]*?:[\s\S]*?<Council/,
  );
  assert.match(workspaceSource, /<CollabRisk[\s\S]*?key="team-chat"/);
  assert.match(workspaceSource, /<Council key="team-roundtable"/);
  assert.match(workspaceSource, /panel=\{panel\}/);
  assert.match(workspaceSource, /onPanelChange=\{updatePanel\}/);
});

test("chat empty state never mounts the roundtable illustration", () => {
  assert.match(chatSource, /<CollabWelcome/);
  assert.doesNotMatch(chatSource, /<CollabRoundTable/);
  assert.match(
    workspaceStyles,
    /\.team-workspace--chat \.collab-main > \.collab-empty > \.crt\s*\{\s*display:\s*none;/,
  );
});

test("manual message scrolling locks Virtuoso follow mode until the user returns to the bottom", () => {
  assert.match(chatSource, /const manualMessageScrollLockRef = useRef\(false\);/);
  assert.match(chatSource, /const lockMessageFollow = useCallback\(\(movingAwayFromBottom = false\) => \{[\s\S]*?forceStickUntilRef\.current = 0;/);
  assert.match(chatSource, /onWheelCapture=\{\(event\) => \{\s*if \(event\.deltaY !== 0\) lockMessageFollow\(event\.deltaY < 0\);/);
  assert.match(chatSource, /onTouchMoveCapture=[\s\S]*?lockMessageFollow\(currentY > startY\);/);
  assert.match(chatSource, /onPointerMoveCapture=[\s\S]*?lockMessageFollow\(event\.clientY > start\.y\);/);
  assert.match(
    chatSource,
    /followOutput=\{\(isAtBottom\) => \{[\s\S]*?manualMessageScrollLockRef\.current\) return false;[\s\S]*?isAtBottom && stickBottomRef\.current \? "auto" : false;/,
  );
  assert.match(
    chatSource,
    /function isMessageScrollerAtTrueBottom\([\s\S]*?scrollHeight - scroller\.scrollTop - scroller\.clientHeight[\s\S]*?<= TRUE_BOTTOM_EPSILON_PX;/,
  );
  assert.match(
    chatSource,
    /const syncMessageFollowFromScroller = useCallback\(\(\) => \{[\s\S]*?isMessageScrollerAtTrueBottom\(scroller\)[\s\S]*?if \(!atTrueBottom\) return false;[\s\S]*?manualMessageScrollLockRef\.current = false;/,
  );
  assert.match(chatSource, /scrollerRef=\{setMessageScroller\}/);
  assert.match(
    chatSource,
    /addEventListener\("scroll", syncMessageFollowFromScroller, \{ passive: true \}\)/,
  );
  assert.match(
    chatSource,
    /atBottomStateChange=\{\(bottom\) => \{[\s\S]*?if \(bottom\) \{[\s\S]*?syncMessageFollowFromScroller\(\);/,
  );
  assert.match(
    chatSource,
    /const scrollMessagesToBottomIfFollowing = useCallback\([\s\S]*?if \(manualMessageScrollLockRef\.current\) return false;[\s\S]*?scrollMessagesToBottom\(behavior\);/,
  );
  assert.match(
    chatSource,
    /const intentRevision = \+\+messageScrollIntentRevisionRef\.current;[\s\S]*?requestAnimationFrame\(\(\) => \{[\s\S]*?manualMessageScrollLockRef\.current[\s\S]*?messageScrollIntentRevisionRef\.current !== intentRevision[\s\S]*?\) return;/,
  );
  assert.match(
    chatSource,
    /const res = await sendCollabMessage\([\s\S]*?if \(isRoomAsyncResultCurrent\(activeIdRef\.current, targetRoomId\)\) \{\s*scrollMessagesToBottomIfFollowing\("auto"\);/,
  );
  assert.match(
    chatSource,
    /const response = await cancelXiaoceRun\(roomId, runId\);[\s\S]*?if \(activeIdRef\.current === roomId\) \{\s*scrollMessagesToBottomIfFollowing\("auto"\);/,
  );
  assert.match(
    chatSource,
    /window\.setTimeout\(\(\) => \{\s*void loadRoomDetail\(forwardTargetId, \{ soft: true \}\);\s*scrollMessagesToBottomIfFollowing\("smooth"\);/,
  );
});
