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
  assert.match(workspaceSource, /<CollabRisk key="team-chat"/);
  assert.match(workspaceSource, /<Council key="team-roundtable"/);
});

test("chat empty state never mounts the roundtable illustration", () => {
  assert.match(chatSource, /<CollabWelcome/);
  assert.doesNotMatch(chatSource, /<CollabRoundTable/);
  assert.match(
    workspaceStyles,
    /\.team-workspace--chat \.collab-main > \.collab-empty > \.crt\s*\{\s*display:\s*none;/,
  );
});
