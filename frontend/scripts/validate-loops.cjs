/**
 * Validate loops in data.ts: edge existence, connectivity, R/B polarity heuristics.
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "loopsHierarchy", "data.ts"), "utf8");

function extractLevel(name) {
  const re = new RegExp(`const ${name}: LevelModel = \\{([\\s\\S]*?)\\n\\};`);
  const m = src.match(re);
  if (!m) return null;
  const body = m[1];
  const stockSec = body.split("flows:")[0];
  const flowSec = (body.split("flows:")[1] || "").split("chains:")[0] || "";
  const loopSec = body.split("loops:")[1] || "";
  const stockIds = [...stockSec.matchAll(/id: "([^"]+)"/g)].map((x) => x[1]);
  const flows = [...flowSec.matchAll(/\{ id: "([^"]+)", from: "([^"]+)", to: "([^"]+)", polarity: "([+-])"/g)]
    .map((x) => ({ id: x[1], from: x[2], to: x[3], pol: x[4] }));
  const loops = [...loopSec.matchAll(/\{ code: "([^"]+)", kind: "([RBC])", name: "([^"]+)", path: "([^"]+)"[\s\S]*?edgeIds: \[([^\]]*)\]/g)]
    .map((x) => ({
      code: x[1],
      kind: x[2],
      name: x[3],
      path: x[4],
      edgeIds: [...x[5].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
    }));
  return { stockIds, flows, loops };
}

const levels = ["company", "brand", "platform", "channel", "link", "sku", "fact"];
const issues = [];
const notes = [];

for (const lv of levels) {
  const L = extractLevel(lv);
  if (!L) {
    issues.push(`${lv}: parse fail`);
    continue;
  }
  const flowById = new Map(L.flows.map((f) => [f.id, f]));
  console.log(`\n=== ${lv} loops=${L.loops.length} === ${L.loops.map((l) => l.code).join(", ")}`);

  for (const loop of L.loops) {
    const missing = loop.edgeIds.filter((e) => !flowById.has(e));
    if (missing.length) issues.push(`${lv} ${loop.code} missing: ${missing.join(",")}`);

    const dout = new Map();
    for (const eid of loop.edgeIds) {
      const f = flowById.get(eid);
      if (!f) continue;
      if (!dout.has(f.from)) dout.set(f.from, []);
      dout.get(f.from).push(f.to);
    }
    const nodes = new Set([...dout.keys(), ...[...dout.values()].flat()]);
    let hasCycle = false;
    const color = new Map();
    const dfs = (u) => {
      color.set(u, 1);
      for (const v of dout.get(u) || []) {
        if (color.get(v) === 1) hasCycle = true;
        else if (color.get(v) !== 2) dfs(v);
      }
      color.set(u, 2);
    };
    for (const n of nodes) if (!color.has(n)) dfs(n);
    const pols = loop.edgeIds.map((e) => flowById.get(e)?.pol).filter(Boolean);
    const hasNeg = pols.includes("-");
    if (loop.kind === "R" && !hasCycle) notes.push(`${lv} ${loop.code} R 无有向环`);
    if (loop.kind === "B" && !hasNeg) notes.push(`${lv} ${loop.code} B 无负边`);
  }
}

console.log("\nISSUES", issues.length ? issues : "none");
console.log("NOTES", notes.length ? notes : "none");
