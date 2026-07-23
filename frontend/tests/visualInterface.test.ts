import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../src/pages/VisualInterface.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/pages/VisualInterface.css", import.meta.url), "utf8");

test("VisualInterface dashboard is protected and route-addressable", () => {
  const authRoute = appSource.indexOf('path="/" element={<RequireAuth />}');
  const visualRoute = appSource.indexOf('path="visual-interface"');
  assert.ok(visualRoute >= 0 && visualRoute > authRoute);
  assert.match(appSource, /path="visual-interface" element={<VisualInterface \/>}/);
  assert.match(pageSource, /可视化经营驾驶舱/);
});

test("dashboard expresses Ontology, Loop, and CPD with working controls", () => {
  assert.match(pageSource, /Ontology 对象分布/);
  assert.match(pageSource, /经营 Loop 分布/);
  assert.match(pageSource, /CHECK/);
  assert.match(pageSource, /PLAN/);
  assert.match(pageSource, /DO/);
  assert.match(pageSource, /setRange/);
  assert.match(pageSource, /setActiveStage/);
  assert.match(pageSource, /Promise\.allSettled/);
  assert.match(pageSource, /暂无真实数据/);
  assert.match(pageSource, /auth_permission: "系统权限"/);
  assert.match(pageSource, /dim_sku_inventory_map: "SKU 库存映射"/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /focus-visible/);
});