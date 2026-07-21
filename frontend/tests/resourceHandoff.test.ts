import assert from "node:assert/strict";
import test from "node:test";

import {
  XIAOCE_HANDOFF_TARGET,
  buildNasResourceHandoff,
  handoffDestination,
} from "../src/features/agent-handoff/resourceHandoff.ts";


test("defaults NAS handoff to the stable Xiaoce bot id", () => {
  const handoff = buildNasResourceHandoff({
    kind: "folder",
    path: "/经营数据",
    native_path: "\\\\nas\\经营数据",
    name: "经营数据",
  }, XIAOCE_HANDOFF_TARGET);

  assert.equal(handoff.target.id, "xiaoce");
  assert.equal(handoff.resourceKind, "folder");
  assert.match(handoff.prompt, /子目录/);
  assert.equal(handoffDestination(handoff.target), "/collab?bot=xiaoce");
});
